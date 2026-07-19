/** Parse a human-readable rating count like "5,600,000 ratings". */
export function parseRatingCount(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;
  if (typeof value === "string") {
    const digits = value.replace(/[^\d]/g, "");
    if (!digits) return null;
    const parsed = parseInt(digits, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }
  return null;
}

function normalizeRating(value: unknown): number | null {
  const rating = typeof value === "string" ? parseFloat(value) : value;
  if (typeof rating !== "number" || !Number.isFinite(rating)) return null;
  if (rating < 1 || rating > 5) return null;
  return rating;
}

export interface DisplayRating {
  value: string;
  title?: string;
}

/** Return a displayable rating only when the data is trustworthy. */
export function getDisplayRating(book: {
  rating?: number | string | null;
  ratingCount?: string | number | null;
  ratingVerified?: boolean;
  ratingsCount?: number | null;
  averageRating?: number | null;
}): DisplayRating | null {
  const verified = book.ratingVerified === true;
  const rating = normalizeRating(book.rating);
  const count = parseRatingCount(book.ratingCount);

  if (verified && rating) {
    return {
      value: rating.toFixed(1),
      title: count ? `${count.toLocaleString()} ratings` : undefined,
    };
  }

  const googleRating = normalizeRating(book.averageRating ?? book.rating);
  const googleCount = parseRatingCount(book.ratingsCount ?? book.ratingCount);
  if (googleRating && googleCount && googleCount >= 10) {
    return {
      value: googleRating.toFixed(1),
      title: `${googleCount.toLocaleString()} ratings`,
    };
  }

  return null;
}

export async function lookupGoogleBooksRating(
  title: string,
  author: string,
  titlesMatch: (a: string, b: string) => boolean
): Promise<{ averageRating: number; ratingsCount: number } | null> {
  const authorPart = (author || "").split(",")[0].trim();
  const q = encodeURIComponent(`intitle:${title} inauthor:${authorPart}`);
  try {
    const res = await fetch(`/api/google-books/search?q=${q}&maxResults=1`);
    if (!res.ok) return null;
    const data = await res.json();
    const info = data.items?.[0]?.volumeInfo;
    if (!info) return null;
    if (!titlesMatch(title, info.title || "")) return null;

    const averageRating = normalizeRating(info.averageRating);
    const ratingsCount = parseRatingCount(info.ratingsCount);
    if (!averageRating || !ratingsCount || ratingsCount < 10) return null;

    return { averageRating, ratingsCount };
  } catch {
    return null;
  }
}

export async function enrichBooksWithRatings<T extends { title: string; author?: string }>(
  books: T[],
  titlesMatch: (a: string, b: string) => boolean,
  limit = 8
): Promise<T[]> {
  const targets = books.slice(0, limit);
  const enriched = await Promise.all(
    targets.map(async (book) => {
      if (getDisplayRating(book as any)) return book;
      const lookup = await lookupGoogleBooksRating(book.title, book.author || "", titlesMatch);
      if (!lookup) return book;
      return {
        ...book,
        averageRating: lookup.averageRating,
        ratingsCount: lookup.ratingsCount,
      };
    })
  );

  return [...enriched, ...books.slice(limit)];
}
