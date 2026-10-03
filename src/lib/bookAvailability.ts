/**
 * Book availability helpers.
 *
 * Two rules the UI needs before it renders a book as actionable:
 *  - does this book have a cover we can actually show?
 *  - can this book be downloaded at all?
 *
 * Both are pure so they can be unit tested without a DOM.
 */

/** A search/catalog result, or any variant of one. Deliberately loose. */
export interface AvailabilityBook {
  title?: string;
  coverUrl?: string | null;
  book_image?: string | null;
  image?: string | null;
  downloadUrl?: string | null;
  directUrl?: string | null;
  md5?: string | null;
  hash?: string | null;
  id?: string | null;
  iaId?: string | null;
  sourceId?: string | null;
  source?: string | null;
  extension?: string | null;
  searchQuery?: string | null;
  isGoogleBook?: boolean;
  isNYTBook?: boolean;
  isNYTBestseller?: boolean;
  audiobookSourceUrl?: string | null;
  audiobookTracks?: unknown[] | null;
  /**
   * Set by the Worker when `downloadUrl` is a WEB PAGE (needs a real browser or
   * login) rather than a file. Such a row must not be presented as downloadable.
   */
  needsBrowser?: boolean;
  variants?: AvailabilityBook[] | null;
}

/** Cover URL off any of the field names the scrapers use. */
export function getCoverCandidate(book: AvailabilityBook | null | undefined): string | null {
  if (!book) return null;
  const raw = book.coverUrl || book.book_image || book.image;
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

/** True when the book has a cover URL that could plausibly load. */
export function hasCoverCandidate(book: AvailabilityBook | null | undefined): boolean {
  return getCoverCandidate(book) !== null;
}

/** Sources whose hits carry no file of their own and must be re-searched. */
const ARCHIVE_SEARCH_SOURCES = new Set(["nyt", "google", "goodreads", "audiobook"]);

/** True when this record resolves to something we could fetch a file from. */
function isDirectlyFetchable(book: AvailabilityBook): boolean {
  const url = typeof book.downloadUrl === "string" ? book.downloadUrl.trim() : "";

  // A real LibGen record: the md5 is the file. It must win before any
  // needsBrowser reasoning.
  //
  // The Worker's `needsBrowser` flag is derived from the URL shape, and a genuine
  // LibGen hit carries `ads.php?md5=<hash>` — a page shape it therefore flags as
  // browser-only. Those rows DO download: verified 2026-10-03, an ads.php md5
  // fetched 2,055,605 B of valid EPUB through the proxy. Trusting the flag
  // blindly dropped all 14 real EPUBs from the "capture or kill" feed and left
  // only LibreTexts — strictly worse than before.
  const hasLibgenId =
    (typeof book.md5 === "string" && book.md5.trim()) ||
    (typeof book.hash === "string" && book.hash.trim()) ||
    (typeof book.iaId === "string" && book.iaId.trim());

  // Authoritative: an id we can resolve to a file, regardless of URL shape.
  if (hasLibgenId) return true;

  if (book.audiobookSourceUrl && String(book.audiobookSourceUrl).trim()) return true;
  if (Array.isArray(book.audiobookTracks) && book.audiobookTracks.length > 0) return true;

  // A URL we can fetch. Trust the Worker's needsBrowser flag when present...
  if (book.needsBrowser) return false;
  // ...and fall back to sniffing when it is not (older cached rows).
  if (/^https?:\/\//i.test(url) && !needsBrowserUrl(url)) return true;
  if (typeof book.directUrl === "string" && book.directUrl.trim()) return true;
  return false;
}

/**
 * URL shapes that are a page rather than a file.
 *
 * Only consulted when the row has no resolvable id and the Worker sent no
 * `needsBrowser` flag. Extensionless LibreTexts endpoints are treated as files
 * because they do serve a real `application/pdf`.
 */
const FILE_URL_RE =
  /\.(epub|pdf|mobi|azw3?|djvu|cbz|cbr|zip)(\?|$)|\/(pdf|epub|full|zip)$|get\.php\?[^#]*\bmd5=|ads\.php\?[^#]*\bmd5=|\/download\//i;

function needsBrowserUrl(url: string): boolean {
  if (/royallib\.com|z-lib\.|\/book\/.+\.html$/i.test(url)) return true;
  return !FILE_URL_RE.test(url);
}

function isArchiveSearchable(book: AvailabilityBook): boolean {
  if (book.isGoogleBook || book.isNYTBook || book.isNYTBestseller) return true;
  const source = (book.source || book.sourceId || "").trim().toLowerCase();
  if (ARCHIVE_SEARCH_SOURCES.has(source)) return true;
  // A searchQuery means we can go re-resolve the file on demand.
  return typeof book.searchQuery === "string" && book.searchQuery.trim().length > 0;
}

/**
 * True when a book is worth showing as downloadable: either it already
 * resolves to a file, or it is a catalog entry we can run an archive search
 * for when the user opens it.
 */
export function hasDownloadableSource(book: AvailabilityBook | null | undefined): boolean {
  if (!book) return false;

  if (isDirectlyFetchable(book)) return true;
  if (isArchiveSearchable(book)) return true;

  // A grouped result is only as good as its best variant.
  const variants = Array.isArray(book.variants) ? book.variants : [];
  return variants.some((v) => v && (isDirectlyFetchable(v) || isArchiveSearchable(v)));
}

/** Drop books we could never hand a file for. */
export function filterDownloadableBooks<T extends AvailabilityBook>(books: T[] | null | undefined): T[] {
  if (!Array.isArray(books)) return [];
  return books.filter((b) => b && hasDownloadableSource(b));
}

export interface CoverSafeOptions {
  /** Upper bound on returned books. */
  limit?: number;
  /** Identifies a book across shuffles/re-renders. */
  keyOf?: (book: AvailabilityBook) => string;
}

/**
 * Keep only books that have a cover, skipping ones already known-broken so a
 * dead cover is replaced by the next candidate rather than left as a gap.
 */
export function pickBooksWithWorkingCovers<T extends AvailabilityBook>(
  books: T[] | null | undefined,
  opts: CoverSafeOptions & { isBroken?: (book: AvailabilityBook) => boolean } = {},
): T[] {
  const { limit, keyOf, isBroken } = opts;
  if (!Array.isArray(books)) return [];

  const seen = new Set<string>();
  const out: T[] = [];

  for (const book of books) {
    if (!book) continue;
    if (!hasCoverCandidate(book)) continue;
    if (isBroken?.(book)) continue;

    const key = keyOf ? keyOf(book) : (book.title || "").trim().toLowerCase();
    if (key) {
      if (seen.has(key)) continue;
      seen.add(key);
    }
    out.push(book);
    if (typeof limit === "number" && out.length >= limit) break;
  }

  return out;
}
