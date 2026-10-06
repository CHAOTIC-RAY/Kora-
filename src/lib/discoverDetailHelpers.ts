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

/** True when `v` is a syntactically valid ISBN-10, checksum included. */
function isValidIsbn10(v: string): boolean {
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
 * Pick a usable ISBN out of a Google Books `industryIdentifiers` array.
 *
 * The array mixes ISBN-10, ISBN-13, and other Google-assigned identifiers, and
 * the first entry is not guaranteed to be an ISBN. Prefer ISBN-13, then a
 * checksum-valid ISBN-10, and return "" when nothing qualifies so callers skip
 * the lookup entirely rather than requesting a URL that cannot exist.
 *
 * The ISBN-10 checksum matters: a bare 10-digit number passes a length test but
 * is usually just an opaque Google identifier, and requesting a cover for it
 * 404s into the same blank grey card this function exists to prevent.
 */
export function pickRealIsbn(
  identifiers: Array<{ type?: string; identifier?: string }> | undefined | null
): string {
  if (!Array.isArray(identifiers)) return "";
  const cleaned = identifiers
    .map((i) => String(i?.identifier || "").replace(/-/g, "").trim())
    .filter(Boolean);
  return (
    cleaned.find((v) => /^\d{13}$/.test(v)) ||
    cleaned.find(isValidIsbn10) ||
    ""
  );
}

/**
 * Canonical identity of a mirror URL, for de-duplication.
 *
 * The Worker hands back the SAME LibGen mirror repeatedly with a different
 * `key=` value each time, so exact-string dedupe let three identical mirror
 * rows render. Normalize away everything that does not identify the
 * *host + resource*: scheme, `www.`, host case, trailing slash, query-param
 * order, and volatile tracking keys.
 *
 * Falls back to the raw lowercased URL when the string does not parse, so a
 * malformed link is still deduped rather than silently kept.
 */
export function canonicalMirrorKey(rawUrl: string): string {
  const url = (rawUrl || "").trim().toLowerCase();
  if (!url) return "";
  try {
    const u = new URL(url);
    const host = u.host.replace(/^www\./, "");
    // These identify the file, not the session — keep them.
    const KEEP = new Set(["md5", "id", "path", "file", "name"]);
    const params = [...u.searchParams.entries()]
      .filter(([k]) => KEEP.has(k))
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join("&");
    const pathname = u.pathname.replace(/\/+$/, "");
    return `${host}${pathname}${params ? `?${params}` : ""}`;
  } catch {
    return url;
  }
}
