import { parseSeriesFromTitle, normalizeSeriesKey } from "./seriesHelper";
import { fetchLibgenSeries } from "./shadowSources";
export { fetchLibgenSeries };

export interface SeriesCatalogBook {
  id: string;
  title: string;
  author: string;
  series: string;
  seriesNumber?: string;
  year?: string;
  publisher?: string;
  pages?: string;
  format?: string;
  filesize?: number;
  isbn?: string;
  language?: string;
  coverUrl?: string;
  description?: string;
  categories?: string[];
  googleVolumeId?: string;
  metadataSource: string;
}

export interface SeriesCatalogResult {
  series: string;
  author?: string;
  source: string;
  books: SeriesCatalogBook[];
}

const REQUEST_TIMEOUT_MS = 6500;

function clean(value: unknown): string {
  return String(value ?? "").replace(/<[^>]*>/g, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&").replace(/\s+/g, " ").trim();
}

function norm(value: unknown): string {
  return clean(value).normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function isbnOf(value: unknown): string {
  return clean(value).match(/(?:97[89][\d\s-]{10,16}|\d[\d\s-]{8,14}[\dXx])/g)?.map((candidate) => candidate.replace(/[\s-]/g, "").toUpperCase()).find((candidate) =>
    /^97[89]\d{10}$/.test(candidate) || /^\d{9}[\dX]$/.test(candidate)
  ) || "";
}

function mapGoogleVolume(item: any, series: string, authorHint: string, requireSeriesMatch = true, fallbackNumber = ""): SeriesCatalogBook | null {
  const info = item?.volumeInfo || {};
  const title = clean(info.title);
  const author = Array.isArray(info.authors) ? info.authors.join(", ") : authorHint;
  if (!title) return null;
  const fromSeriesInfo = info.seriesInfo;
  const parsed = parseSeriesFromTitle([title, info.subtitle].filter(Boolean).join(": "));
  const detectedSeries = clean(fromSeriesInfo?.series || fromSeriesInfo?.title || parsed?.series);
  const number = clean(fromSeriesInfo?.bookDisplayNumber || fromSeriesInfo?.volumeNumber || parsed?.seriesNumber);
  if (requireSeriesMatch && (!detectedSeries || normalizeSeriesKey(detectedSeries) !== normalizeSeriesKey(series))) return null;
  const id = String(item.id || `${norm(title)}|${norm(author)}`);
  return {
    id: `google-series:${id}`,
    title,
    author: author || "Unknown author",
    series,
    seriesNumber: number || fallbackNumber || undefined,
    year: String(info.publishedDate || "").slice(0, 4) || undefined,
    publisher: clean(info.publisher) || undefined,
    pages: Number(info.pageCount) > 0 ? String(info.pageCount) : undefined,
    isbn: Array.isArray(info.industryIdentifiers) ? (info.industryIdentifiers.find((entry: any) => entry.type === "ISBN_13")?.identifier || info.industryIdentifiers[0]?.identifier) : undefined,
    language: clean(info.language) || undefined,
    coverUrl: info.imageLinks?.extraLarge || info.imageLinks?.large || info.imageLinks?.thumbnail?.replace(/^http:/i, "https:") || undefined,
    description: clean(info.description) || undefined,
    categories: Array.isArray(info.categories) ? info.categories : undefined,
    googleVolumeId: id,
    metadataSource: "Google Books",
  };
}

export async function searchGoogleBooksBySeries(series: string, author: string, apiKey = ""): Promise<SeriesCatalogBook[]> {
  const quotedSeries = `intitle:"${series.replace(/[\"\\]/g, " ").trim()}"`;
  const queries = [author ? `inauthor:"${author.replace(/[\"\\]/g, " ").trim()}" ${quotedSeries}` : quotedSeries, [series, author].filter(Boolean).join(" ")];
  const found = new Map<string, SeriesCatalogBook>();
  for (const query of queries) {
    for (let startIndex = 0; startIndex < 80; startIndex += 40) {
      const url = new URL("https://www.googleapis.com/books/v1/volumes");
      url.searchParams.set("q", query);
      url.searchParams.set("maxResults", "40");
      url.searchParams.set("startIndex", String(startIndex));
      if (apiKey) url.searchParams.set("key", apiKey);
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        if (!response.ok) break;
        const data = await response.json() as { items?: any[]; totalItems?: number };
        for (const item of data.items || []) {
          const mapped = mapGoogleVolume(item, series, author, false);
          if (!mapped) continue;
          const info = item.volumeInfo || {};
          const parsed = parseSeriesFromTitle([info.title, info.subtitle].filter(Boolean).join(": "));
          const explicitSeries = clean(info.seriesInfo?.series || info.seriesInfo?.title);
          const detectedName = normalizeSeriesKey(explicitSeries || parsed?.series || "");
          const seriesKey = normalizeSeriesKey(series);
          const titleKey = norm(info.title);
          const lexicalMatch = Boolean(norm(series)) && titleKey.includes(norm(series));
          const authors = norm((info.authors || []).join(" "));
          const authorMatch = !author || authors.includes(norm(author)) || norm(author).includes(authors);
          if ((detectedName && detectedName !== seriesKey) || (!detectedName && !(lexicalMatch && authorMatch))) continue;
          const number = clean(info.seriesInfo?.volumeNumber || info.seriesInfo?.bookDisplayNumber || parsed?.seriesNumber);
          mapped.seriesNumber = number || undefined;
          mapped.series = series;
          const key = isbnOf(mapped.isbn) || `${norm(mapped.title)}|${norm(mapped.author)}`;
          if (!found.has(key)) found.set(key, mapped);
        }
        if ((data.totalItems || 0) <= startIndex + 40 || !(data.items || []).length) break;
      } catch { break; }
    }
  }
  return [...found.values()].sort((a, b) => {
    const na = Number.parseFloat(a.seriesNumber || "");
    const nb = Number.parseFloat(b.seriesNumber || "");
    if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
    return a.title.localeCompare(b.title);
  });
}

async function fetchGoogleEdition(book: SeriesCatalogBook, apiKey: string): Promise<SeriesCatalogBook | undefined> {
  const isbn = isbnOf(book.isbn);
  const query = isbn ? `isbn:${isbn}` : `intitle:${book.title} inauthor:${book.author}`;
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", "5");
  if (apiKey) url.searchParams.set("key", apiKey);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) return undefined;
    const data = await response.json() as { items?: any[] };
    const titleKey = norm(book.title);
    const authorKey = norm(book.author);
    const candidates = (data.items || []).map((item) => {
      const info = item.volumeInfo || {};
      const identifiers = Array.isArray(info.industryIdentifiers) ? info.industryIdentifiers.map((entry: any) => isbnOf(entry.identifier)).filter(Boolean) : [];
      const titleScore = norm(info.title) === titleKey ? 4 : norm(info.title).includes(titleKey) || titleKey.includes(norm(info.title)) ? 2 : 0;
      const authorText = norm((info.authors || []).join(" "));
      const authorScore = !authorKey || authorText.includes(authorKey) || authorKey.includes(authorText) ? 2 : 0;
      const isbnScore = isbn && identifiers.includes(isbn) ? 10 : 0;
      return { item, score: isbnScore + titleScore + authorScore, isbnMatch: !isbn || identifiers.includes(isbn), titleMatch: titleScore >= 2, authorMatch: authorScore > 0 };
    }).sort((a, b) => b.score - a.score);
    const best = candidates[0];
    if (!best || (isbn ? !best.isbnMatch : !(best.titleMatch && best.authorMatch))) return undefined;
    return mapGoogleVolume(best.item, book.series, book.author, false, book.seriesNumber);
  } catch { return undefined; }
}

async function mapWithLimit<T, R>(items: T[], limit: number, mapper: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await mapper(items[index]);
    }
  });
  await Promise.all(workers);
  return results;
}

function mergeGoogleMetadata(base: SeriesCatalogBook, candidate: SeriesCatalogBook | undefined): SeriesCatalogBook {
  if (!candidate) return base;
  const baseIsbn = isbnOf(base.isbn);
  const googleIsbn = isbnOf(candidate.isbn);
  const titleMatches = norm(base.title) === norm(candidate.title);
  const authorMatches = !base.author || base.author === "Unknown author" || norm(base.author).includes(norm(candidate.author)) || norm(candidate.author).includes(norm(base.author));
  if (!(baseIsbn && googleIsbn === baseIsbn) && !(titleMatches && authorMatches)) return base;
  return {
    ...base,
    publisher: base.publisher || candidate.publisher,
    year: base.year || candidate.year,
    pages: base.pages || candidate.pages,
    format: base.format || candidate.format,
    filesize: base.filesize || candidate.filesize,
    isbn: base.isbn || candidate.isbn,
    language: base.language || candidate.language,
    coverUrl: base.coverUrl || candidate.coverUrl,
    description: candidate.description,
    categories: candidate.categories,
    googleVolumeId: candidate.googleVolumeId,
    metadataSource: "LibGen series catalog + Google Books",
  };
}

export async function fetchSeriesCatalog(options: {
  series: string;
  author?: string;
  seriesId?: string;
  googleBooksApiKey?: string;
}): Promise<SeriesCatalogResult> {
  const series = clean(options.series);
  const author = clean(options.author);
  if (!series) throw new Error("Series title is required.");

  const libgenResult = options.seriesId ? await fetchLibgenSeries(options.seriesId, series) : null;

  if (libgenResult?.books.length) {
    const books = [...libgenResult.books];
    const candidates = await mapWithLimit(books.slice(0, 16), 3, (book) => fetchGoogleEdition(book, options.googleBooksApiKey || ""));
    const enriched = books.map((book, index) => mergeGoogleMetadata(book, candidates[index]));
    return { ...libgenResult, author: author || undefined, books: enriched };
  }

  const googleBooks = await searchGoogleBooksBySeries(series, author, options.googleBooksApiKey || "");
  const unique = new Map<string, SeriesCatalogBook>();
  for (const book of googleBooks) {
    const key = isbnOf(book.isbn) || `${norm(book.title)}|${norm(book.author)}`;
    if (!unique.has(key)) unique.set(key, book);
  }
  return {
    series,
    author: author || undefined,
    source: unique.size ? "Google Books (series inferred from title metadata)" : "No catalog series records found",
    books: [...unique.values()].sort((a, b) => {
      const na = Number.parseFloat(a.seriesNumber || "");
      const nb = Number.parseFloat(b.seriesNumber || "");
      if (Number.isFinite(na) && Number.isFinite(nb) && na !== nb) return na - nb;
      return a.title.localeCompare(b.title);
    }),
  };
}
