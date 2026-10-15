/**
 * Google Books identity helpers.
 *
 * A cover is only eligible for reuse when metadata identifies the same work.
 * Never infer identity from a fuzzy title alone when both records expose ISBNs.
 */
export interface GoogleBookIdentity {
  id?: string;
  title?: string;
  author?: string | string[];
  authors?: string[];
  isbn?: string;
  industryIdentifiers?: Array<{ type?: string; identifier?: string }>;
  coverUrl?: string | null;
  source?: string;
  isGoogleBook?: boolean;
}

function normalize(value: unknown): string {
  return String(value || "")
    .normalize("NFKD")
    .toLocaleLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function googleBookIsbnSet(book: GoogleBookIdentity): Set<string> {
  const ids = [
    book.isbn,
    ...(book.industryIdentifiers || []).map(identifier => identifier.identifier),
  ];
  return new Set(ids.map(value => String(value || "").replace(/[^0-9Xx]/g, "").toUpperCase()).filter(Boolean));
}

export function sameGoogleBook(a: GoogleBookIdentity, b: GoogleBookIdentity): boolean {
  const aIsbn = googleBookIsbnSet(a);
  const bIsbn = googleBookIsbnSet(b);
  if (aIsbn.size && bIsbn.size && [...aIsbn].some(isbn => bIsbn.has(isbn))) return true;

  const titleA = normalize(a.title);
  const titleB = normalize(b.title);
  if (!titleA || !titleB || titleA !== titleB) return false;

  const authors = (book: GoogleBookIdentity) => normalize(
    Array.isArray(book.authors) ? book.authors.join(" ") :
      Array.isArray(book.author) ? book.author.join(" ") : book.author
  );
  const authorA = authors(a);
  const authorB = authors(b);
  // If both sources identify authors, require an author match. If one lacks
  // author metadata, title equality alone is not strong enough to merge them.
  return !!authorA && !!authorB && (authorA === authorB || authorA.includes(authorB) || authorB.includes(authorA));
}

/** Stable de-duplication: keep the first (highest-ranked) Google Books edition. */
export function dedupeGoogleBooks<T extends GoogleBookIdentity>(books: T[]): T[] {
  const output: T[] = [];
  for (const book of books) {
    if (output.some(existing => sameGoogleBook(existing, book))) continue;
    output.push(book);
  }
  return output;
}

/** Return a Google cover only if the selected book is verified as the same work. */
export function matchingGoogleCover<T extends GoogleBookIdentity>(
  selected: GoogleBookIdentity,
  candidates: T[],
): string | null {
  for (const candidate of candidates) {
    const cover = candidate.coverUrl;
    if (cover && /^https:\/\//i.test(cover) && (candidate.isGoogleBook || candidate.source === "google") && sameGoogleBook(selected, candidate)) {
      return cover;
    }
  }
  return null;
}
