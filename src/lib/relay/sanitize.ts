/**
 * Filename sanitisation for the e-reader relay.
 *
 * THIS IS THE WHOLE ATTACK SURFACE, and croc's advisory history is the reason
 * it is written this way. The advisories this endpoint would be vulnerable to
 * are all one sentence repeated: a malicious sender attacking the RECEIVER's
 * filesystem.
 *
 *   GHSA-wmw5-q587-gx56  path traversal in the received filename
 *   GHSA-m6m7-376m-rr8g  symlink / out-of-tree write
 *   GHSA-pcm6-vvg3-3xmh  case-normalisation bypass of a `.ssh` guard
 *   GHSA-x89h-7h96-v88f  reserved device names treated as ordinary files
 *
 * So the rules, and why each exists:
 *
 *  1. Reduce to a BASENAME first. `a/b/../../c.epub` and `..\\..\\x` both
 *     become `c.epub` / `x`. Nothing upstream of this function may treat the
 *     input as a path; it is a path *fragment*, and the only legal output is a
 *     single segment.
 *  2. Reject `..` and `.` outright rather than trying to strip them. A name
 *     that is only dots has no safe interpretation.
 *  3. Normalise BEFORE comparing. `.SSH` and `.Ssh` must fail the same guard
 *     as `.ssh`; comparing the raw string is GHSA-pcm6-vvg3-3xmh.
 *  4. Reject Windows RESERVED DEVICE NAMES. `CON.epub` is a directory-ish
 *     object on Windows and never a file — GHSA-x89h-7h96-v88f. The name is
 *     reserved on the base OR before the first dot (`NUL.txt` is still NUL).
 *  5. Reject the dotfile/config guard set case-insensitively: writing
 *     `.bashrc` into a device that later sources it is the payoff of a
 *     successful write, so the relay refuses to be the writer.
 *  6. Strip control characters and NUL. A NUL in a header or a filename is a
 *     truncation primitive in C-based receivers.
 *  7. Bound the length so the sanitised name still fits a filesystem's 255-byte
 *     component limit after any further transformation downstream.
 *
 * WHAT THIS IS NOT: a guarantee that a hostile receiver cannot be hurt. It is
 * the part Kora can control — what the relay is willing to write, print, and
 * hand back as a Content-Disposition.
 */

/** Names that must never appear, even case-varied. Compared post-normalise. */
const FORBIDDEN_NAMES = new Set([
  // Config/dotfile guard set (case-insensitive, trailing dots/spaces trimmed).
  ".ssh",
  ".gnupg",
  ".aws",
  ".config",
  ".bashrc",
  ".bash_profile",
  ".profile",
  ".netrc",
  ".npmrc",
  ".env",
  "authorized_keys",
  "known_hosts",
  "id_rsa",
  "id_ed25519",
]);

/** Windows reserved device names. Reserved before the first dot, forever. */
const RESERVED_DEVICE_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  "com1",
  "com2",
  "com3",
  "com4",
  "com5",
  "com6",
  "com7",
  "com8",
  "com9",
  "lpt1",
  "lpt2",
  "lpt3",
  "lpt4",
  "lpt5",
  "lpt6",
  "lpt7",
  "lpt8",
  "lpt9",
]);

/** Characters no mainstream filesystem tolerates in a name. */
const ILLEGAL_CHARS = /[/\\:*?"<>|]/g;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f-\u009f]/g;

export const MAX_FILENAME_LENGTH = 120;

/** Extensions the relay will carry. Anything else is stored with no name. */
export const RELAY_EXTENSIONS = [
  "epub",
  "mobi",
  "azw3",
  "azw",
  "kfx",
  "pdf",
  "txt",
  "cbz",
  "cbr",
  "cb7",
  "zip",
  "docx",
  "html",
  "htm",
] as const;

export const DEFAULT_MIME = "application/octet-stream";

const MIMES: Record<string, string> = {
  epub: "application/epub+zip",
  mobi: "application/x-mobipocket-ebook",
  azw3: "application/vnd.amazon.ebook",
  azw: "application/vnd.amazon.ebook",
  kfx: "application/vnd.amazon.ebook",
  pdf: "application/pdf",
  txt: "text/plain",
  cbz: "application/vnd.comicbook+zip",
  cbr: "application/vnd.comicbook-rar",
  cb7: "application/x-cb7",
  zip: "application/zip",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  html: "text/html",
  htm: "text/html",
};

export function mimeForRelayExtension(ext: string): string {
  return MIMES[ext] || DEFAULT_MIME;
}

export function extensionOf(fileName: string): string {
  const base = fileName.split(/[/\\]/).pop() || "";
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return "";
  return base.slice(dot + 1).toLowerCase();
}

/** Reduce anything path-shaped to its last segment. The only place this happens. */
function toBaseName(raw: string): string {
  const segs = raw.split(/[/\\]/);
  return segs[segs.length - 1] ?? "";
}

/**
 * Is this basename forbidden outright?
 *
 * Comparison is done on a normalised form — trimmed, lower-cased, with trailing
 * dots and spaces removed — because those are the equivalences a filesystem
 * performs and the ones an attacker uses to slip past a naive string compare.
 */
export function isForbiddenRelayFilename(raw: string): boolean {
  const base = toBaseName(String(raw ?? ""));
  if (!base) return true;

  // Rule 2: a name made only of dots has no safe reading.
  if (/^\.+$/.test(base)) return true;

  // Rule 6: NUL and friends are truncation primitives, not names.
  if (CONTROL_CHARS.test(base)) return true;
  CONTROL_CHARS.lastIndex = 0; // regex is global; reset for the next caller

  // Rule 4: reserved device name, on the stem before the first dot.
  const stem = base.split(".")[0].toLowerCase().replace(/[ .]+$/g, "");
  if (RESERVED_DEVICE_NAMES.has(stem)) return true;

  // Rule 3: forbidden-name guard, normalised, then compared — and compared
  // against the name with its final extension peeled off as well. `.ssh` and
  // `.ssh.txt` are different files on a filesystem, but a receiver that
  // renames, appends, or strips an extension turns one into the other, and
  // the cost of refusing is a book named `book.epub`. Refusing is the cheap
  // side of that trade. (Note the peel is on the LAST extension only, so
  // `The.profile.epub` keeps its stem `The.profile` and is still allowed.)
  const normalized = base.toLowerCase().replace(/[ .]+$/g, "");
  if (FORBIDDEN_NAMES.has(normalized)) return true;
  const lastDot = normalized.lastIndexOf(".");
  if (lastDot > 0) {
    const peeled = normalized.slice(0, lastDot).replace(/[ .]+$/g, "");
    if (FORBIDDEN_NAMES.has(peeled)) return true;
  }

  return false;
}

/**
 * Turn a client-supplied filename into a safe single-segment name.
 *
 * Never throws and never returns a path: on any rejection it falls back to
 * `book.<ext>`. A relay that 400s on a weird title is worse than one that
 * delivers the book under a dull name — the bytes are what the user wanted.
 */
export function sanitizeRelayFilename(raw: unknown, ext?: string): string {
  const fallbackExt = (ext || "").replace(/^\./, "").toLowerCase();
  const fallback = fallbackExt ? `book.${fallbackExt}` : "book";

  if (typeof raw !== "string") return fallback;

  let base = toBaseName(raw);
  if (!base) return fallback;

  base = base.replace(CONTROL_CHARS, "");
  base = base.replace(ILLEGAL_CHARS, "_");
  // Trailing dots/spaces are silently dropped by Windows, which turns
  // "book.epub " into "book.epub" and "book." into "book" — normalise here so
  // what we store is what a receiver will actually create.
  base = base.replace(/[ .]+$/g, "");

  // The extension is read AFTER that normalisation, not before. Reading it
  // first meant "book.epub " reported an extension of "epub " (with the space),
  // the stem could not be identified, and the result came out as
  // "book.epub.epub" — a wrong filename rather than a refusal, which is worse.
  // It is also scrubbed to alphanumerics, because the extension ends up in both
  // the name and the MIME lookup and neither can carry punctuation.
  const extFromName = extensionOf(base);
  const useExt = (extFromName || fallbackExt || "")
    .replace(/^\./, "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  // Leading dots are legal but a pure-dotfile is not; one leading dot survives
  // (".hidden.epub" is a real, harmless file) unless it leaves an empty stem.
  base = base.replace(/^\.+/, (dots) => (dots.length > 1 ? "." : dots));
  if (!base || /^\.+$/.test(base)) return fallback;
  if (isForbiddenRelayFilename(base)) return fallback;

  // Rule 7: bound the length, keeping the extension.
  const stem = extFromName && base.toLowerCase().endsWith("." + extFromName)
    ? base.slice(0, base.length - extFromName.length - 1)
    : base;
  const suffix = useExt ? "." + useExt : "";
  const maxStem = Math.max(1, MAX_FILENAME_LENGTH - suffix.length);
  let out = (stem.length > maxStem ? stem.slice(0, maxStem) : stem).replace(/[ .]+$/g, "");
  if (!out) out = "book";

  const finalName = out + suffix;
  // Belt and braces: the composed name is re-checked, because stem
  // truncation can expose a new configuration (e.g. ".ssh" -> "" -> "book").
  if (isForbiddenRelayFilename(finalName)) return fallback;
  return finalName;
}

export interface RelayFileDescriptor {
  /** Sanitised, single-segment, filesystem-safe. */
  name: string;
  /** Lower-case, no dot, or "" when unknown. */
  ext: string;
  /** Never client-chosen: derived from `ext` via a fixed table. */
  mime: string;
  byteLength: number;
}

/**
 * Normalise what a receiver will be told to write.
 *
 * The MIME is looked up from the extension rather than trusted from the
 * client: a client claiming `text/html` for a `.epub` is either confused or
 * probing, and the receiver's sniffing rules should not be the thing that
 * decides.
 */
export function describeRelayFile(rawName: unknown, byteLength: number, extHint?: string): RelayFileDescriptor {
  const ext = (extHint || extensionOf(typeof rawName === "string" ? rawName : "") || "")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "")
    .slice(0, 8);
  const name = sanitizeRelayFilename(rawName, ext);
  return {
    name,
    ext: ext || extensionOf(name),
    mime: mimeForRelayExtension(ext || extensionOf(name)),
    byteLength,
  };
}

/**
 * Build the Content-Disposition for the download.
 *
 * RFC 6266 `filename*` carries the real name in UTF-8; the plain `filename=`
 * is a sanitised ASCII fallback for the ancient parsers on e-ink devices, and
 * is itself quoted and stripped of quotes and backslashes so a crafted name
 * cannot break out of the header value.
 */
export function contentDispositionFor(fileName: string): string {
  const safeAscii = fileName
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/["\\]/g, "_")
    .slice(0, MAX_FILENAME_LENGTH);
  const encoded = encodeURIComponent(fileName);
  return `attachment; filename="${safeAscii}"; filename*=UTF-8''${encoded}`;
}

/** Escape for interpolation into HTML text/attribute context. */
export function escapeHtml(raw: unknown): string {
  return String(raw ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
