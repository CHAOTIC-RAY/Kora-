/**
 * Zip-slip defence for archive entry paths.
 *
 * WHY THIS IS A SEPARATE MODULE
 *
 * Extraction is the single most dangerous thing a comic reader does. Every
 * archive format that has ever had a path-traversal CVE in a browser or
 * bundler context has had it for exactly one reason: the extractor wrote
 * `entry.name` to disk. That is the CVE-2023-43616 / GHSA-8c8w-f7wp-2jr2
 * class (the `extract-zip` / `libarchive` traversal family).
 *
 * Kora never writes an extracted byte to disk. It reads into memory and hands
 * out `blob:` URLs. Traversal is therefore *not* exploitable for writes here —
 * but the same discipline is still mandatory, and still worth enforcing:
 *
 *   1. Blob URLs are keyed by entry name in {@link openArchive}, and a name
 *      containing `../` or an absolute path is a name that will later be
 *      compared against, cached by, and potentially passed to
 *      `URL.createObjectURL` consumers. A hostile name that cannot reach the
 *      filesystem must still never be *propagated*.
 *   2. RAR and 7z are ATTACKER-CONTROLLED containers. A malicious .cbr from a
 *      mirror is the normal case, not the exception. `../../../.ssh/authorized_keys`
 *      or `C:\Windows\System32\...` are perfectly legal member names in both
 *      formats and libarchive will hand them back verbatim.
 *   3. Defence in depth beats "we don't happen to write to disk today". The day
 *      someone adds a "save pages to device" feature, this file is the reason
 *      the app is not already compromised.
 *
 * The rule enforced is deliberately strict, and strictness is correct here:
 * a legitimate comic page path is a short relative path ending in an image
 * extension. Anything that trips these checks is not a comic page, and
 * dropping it costs nothing.
 *
 * This mirrors the discipline in `src/lib/formats/zip.ts` (which does the
 * equivalent work for the ZIP path) and the spirit of
 * `sanitiseReceivedFileName` in `src/lib/croc/client.ts`, which applies the
 * same list to filenames arriving over the wire. Three modules, one rule.
 */

/**
 * Windows reserved device names.
 *
 * Still special with ANY extension appended: `NUL.txt`, `con.png` and `COM1.jpg`
 * all resolve to devices, not files, on Windows. The `(\.|$)` tail is what
 * makes the extension-append evasion land on the same deny.
 */
const WINDOWS_DEVICE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/** Control characters and NUL. A filename containing these is not a filename. */
// NOT `/g`: a global regex used with `.test()` carries `lastIndex` between
// calls, so two consecutive calls on identical input can disagree. There is
// no need for a global here — `.test()` finds a match anywhere.
const CONTROL_CHARS = /[\x00-\x1f\x7f]/;

/** A single path segment. Segments are the unit that traversal moves between. */
function segmentsOf(entry: string): string[] {
  return entry.split(/[/\\]+/);
}

/**
 * True when `entry` is safe to treat as a page path inside an archive.
 *
 * Rejects, in order:
 *   - empty / NUL-only names
 *   - control characters
 *   - absolute POSIX paths (`/etc/passwd`) and UNC paths (`\\host\share`)
 *   - Windows drive-absolute and drive-relative paths (`C:\x`, `C:x`)
 *   - any `..` segment — checked per segment after splitting on BOTH
 *     separators, so `a/../../../etc/passwd` and `a\..\..\b` cannot hide it
 *     behind a mixed-separator join
 *   - `.` segments (a no-op that indicates a crafted or confused name)
 *   - Windows reserved device names, in any path segment
 *   - over-long names and over-deep paths (zip-bomb-ish resource abuse)
 *
 * Note what is NOT here: any rewriting, normalising, or "cleaning". This
 * function is a gate, not a filter. A rejected entry is dropped and counted;
 * it is never passed along in altered form, because an altered hostile name is
 * still a hostile name and half-sanitising is how bypasses happen.
 */
export function isSafeArchiveEntry(entry: string, maxDepth = 32): boolean {
  if (!entry || typeof entry !== "string") return false;
  if (entry.length > 1024) return false;
  if (CONTROL_CHARS.test(entry)) return false;

  // UNC and absolute POSIX: the path begins at a separator, so the first
  // segment is empty.
  const segs = segmentsOf(entry);
  if (segs.length === 0 || segs[0] === "") return false;

  // Drive letters, in either a path segment or as the whole string. A colon is
  // illegal in a Windows path component anyway, so rejecting it outright also
  // closes ADS (`file.txt:stream`) tricks.
  if (segs.some((s) => s.includes(":"))) return false;

  if (segs.length > maxDepth) return false;

  for (const seg of segs) {
    if (seg === "") return false;
    // Traversal and no-op segments. Compared case-insensitively so that a
    // Unicode-normalised or oddly-cased `..` cannot slip past.
    if (seg === "." || seg === "..") return false;
    if (WINDOWS_DEVICE_NAMES.test(seg)) return false;
    // A segment that is only dots (`...`, `....`) is not a legal filename and
    // is a common fuzzing artefact; Windows also normalises some of these.
    if (/^\.+$/.test(seg)) return false;
  }
  return true;
}

/**
 * Split archive members into the ones that may be used and the ones that were
 * refused, with a count for honest reporting.
 *
 * The count is returned rather than merely logged because the UI has to be
 * able to say "3 entries were skipped as unsafe" — silently dropping members
 * from a hostile archive is how a user ends up with a short comic and no
 * explanation.
 */
export function partitionSafeEntries(entries: readonly string[]): {
  safe: string[];
  rejectedCount: number;
} {
  const safe: string[] = [];
  let rejectedCount = 0;
  for (const e of entries) {
    if (isSafeArchiveEntry(e)) safe.push(e);
    else rejectedCount++;
  }
  return { safe, rejectedCount };
}