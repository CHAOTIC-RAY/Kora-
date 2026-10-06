/**
 * Pure helpers for the Discover detail panel.
 *
 * These were previously inline in `DiscoverView.tsx`, where they could not be
 * tested — and both had real defects that a test would have caught:
 *
 *   - `pickRealIsbn` took `industryIdentifiers[0]`, which is not guaranteed to
 *     be an ISBN. A non-ISBN value flowed into
 *     `covers.openlibrary.org/b/isbn/<value>`, 404'd, and left the search grid
 *     showing a blank grey card where the cover should be.
 *   - `canonicalMirrorKey` is what stops the Worker returning the same LibGen
 *     mirror three times (each with a different `key=`) from rendering three
 *     identical "Libgen Mirror (libgen.li)" rows.
 */

/** True when `v` is a valid ISBN-10: 10 chars, digits with an optional X check digit, mod-11 clean. */
export function isValidIsbn10(v: string): boolean {
  if (!/^[\dX]{10}$/i.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const ch = v[i];
    // The final position is the check digit; "X" is legal there and means 10.
    const val = ch.toUpperCase() === "X" ? 10 : Number(ch);
    sum += (10 - i) * val;
  }
  return sum % 11 === 0;
}

/**
 * True when `v` is a valid ISBN-13: 13 digits whose mod-10 alternating-weight
 * check digit agrees.
 *
 * The checksum is what separates a real ISBN-13 from an opaque 13-digit Google
 * identifier. Without it, `1234567890123` passes a length test, is requested from
 * Open Library, 404s, and produces the exact blank grey card that `isValidIsbn10`
 * exists to prevent on the 10-digit side. Both checksums must exist, or the
 * validation is only half a guard — and that half was the bug: the caller
 * preferred a bare-length `isbn13` sibling over this function's validated result.
 */
export function isValidIsbn13(v: string): boolean {
  if (!/^\d{13}$/.test(v)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    // Weights alternate 1,3 from the left; the trailing digit is the check.
    const weight = i % 2 === 0 ? 1 : 3;
    sum += weight * Number(v[i]);
  }
  // The check digit is chosen so the total lands on a multiple of 10.
  return sum % 10 === 0;
}

/** True when `v` is a valid ISBN in either length. */
export function isValidIsbn(v: string): boolean {
  return isValidIsbn10(v) || isValidIsbn13(v);
}

/**
 * Pick a usable ISBN out of a Google Books `industryIdentifiers` array.
 *
 * The array mixes ISBN-10, ISBN-13, and other Google-assigned identifiers, and
 * the first entry is not guaranteed to be an ISBN. Prefer a checksum-valid
 * ISBN-13, then a checksum-valid ISBN-10, and return "" when nothing qualifies so
 * callers skip the lookup entirely rather than requesting a URL that cannot
 * exist.
 *
 * Checksum validation is the entire point: a bare length test lets opaque Google
 * identifiers through, and those produce exactly the blank cover this function
 * exists to prevent.
 */
export function pickRealIsbn(
  identifiers: Array<{ type?: string; identifier?: string }> | undefined | null
): string {
  if (!Array.isArray(identifiers)) return "";
  const cleaned = identifiers
    .map((i) => String(i?.identifier || "").replace(/-/g, "").trim())
    .filter(Boolean);
  return cleaned.find(isValidIsbn13) || cleaned.find(isValidIsbn10) || "";
}

/**
 * Query parameters that carry a session or cache-buster rather than identity.
 *
 * This is a DENY-list on purpose. An earlier version used an allow-list of
 * `{md5, id, path, file, name}`, which collapsed every mirror identified only by
 * some other query parameter down to bare `host + pathname` — including the app's
 * own `ravebooksearch.com/search?q=<title>` hand-off, so a second search link
 * looked like a duplicate of the first and was silently dropped. Anything we
 * cannot prove is volatile must be treated as identity-bearing.
 */
const VOLATILE_QUERY_PARAMS = new Set([
  "key",
  "token",
  "session",
  "sessionid",
  "sid",
  "auth",
  "signature",
  "sig",
  "expires",
  "exp",
  "timestamp",
  "t",
  "_",
  "nocache",
  "cb",
  "rand",
  "cachebuster",
]);

/**
 * Canonical identity of a mirror URL, for de-duplication.
 *
 * The Worker hands back the SAME LibGen mirror repeatedly with a different
 * `key=` value each time, so exact-string dedupe let three identical mirror rows
 * render. Normalize away only what does not identify the resource:
 *
 *   - the scheme — `http` and `https` address the same resource, and a mirror
 *     that arrives over one protocol must still dedupe against the other,
 *   - host case (case-insensitive per RFC) and a leading `www.`,
 *   - a trailing slash on the path,
 *   - query-param ORDER — the params themselves are kept, minus the volatile
 *     deny-list above.
 *
 * The PATH is left case-sensitive. `/md5/<hex>` is effectively case-insensitive in
 * practice, but a slug-like path is not, and lowercasing the whole URL collapsed
 * genuinely distinct resources there.
 *
 * Falls back to the raw lowercased URL when the string does not parse, so a
 * malformed link is still deduped rather than being kept N times.
 */
export function canonicalMirrorKey(rawUrl: string): string {
  const url = (rawUrl || "").trim();
  if (!url) return "";
  try {
    const u = new URL(url);
    const host = u.host.toLowerCase().replace(/^www\./, "");
    const params = [...u.searchParams.entries()]
      .filter(([k]) => !VOLATILE_QUERY_PARAMS.has(k.toLowerCase()))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k.toLowerCase()}=${v}`)
      .join("&");
    const pathname = u.pathname.replace(/\/+$/, "");
    return `${host}${pathname}${params ? `?${params}` : ""}`;
  } catch {
    return url.toLowerCase();
  }
}
