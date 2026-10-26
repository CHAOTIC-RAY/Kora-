import * as cheerio from "cheerio";
import { parseSeriesFromTitle, normalizeSeriesKey } from "./seriesHelper";

export interface SeriesCatalogBook {
  id: string;
  title: string;
  author: string;
  series: string;
  seriesNumber?: string;
  year?: string;
  publisher?: string;
  pages?: string;
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

const LIBGEN_HOSTS = ["libgen.li", "libgen.be", "libgen.lc", "libgen.gs", "libgen.st", "libgen.rocks"];
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

function parseSeriesRow(html: string, baseUrl: string, expectedSeries: string): SeriesCatalogBook[] {
  const $ = cheerio.load(html);
  const table = $("#tablelibgen").first().length ? $("#tablelibgen").first() : $("table").filter((_, node) => /title/i.test($(node).text())).first();
  if (!table.length) return [];

  const rows = table.find("tr").toArray();
  const headerRow = rows.find((row) => /title/i.test($(row).text()) && /author/i.test($(row).text()));
  const headers = headerRow ? $(headerRow).children("th,td").map((_, cell) => norm($(cell).text())).get() : [];
  const column = (pattern: RegExp, fallback: number) => {
    const found = headers.findIndex((header) => pattern.test(header));
    return found >= 0 ? found : fallback;
  };
  const yearCol = column(/^year$|publication year/, 1);
  const numberCol = column(/total number|issue|number|volume/, 2);
  const titleCol = column(/^title$|edition title/, 3);
  const authorCol = column(/author|creator/, 4);
  const publisherCol = column(/publisher/, 5);
  const pagesCol = column(/pages?/, 6);
  const isbnCol = column(/isbn/, 7);
  const title = clean($("h1").first().text() || $("title").first().text()) || expectedSeries;
  const books: SeriesCatalogBook[] = [];

  for (const row of rows) {
    if (row === headerRow) continue;
    const cells = $(row).children("td");
    if (cells.length < 4) continue;
    const titleCell = cells.eq(titleCol);
    const titleLink = titleCell.find("a[href*='edition.php'], a[href*='book/index.php']").first();
    const bookTitle = clean(titleLink.text() || titleCell.text());
    if (!bookTitle || /^title$/i.test(bookTitle)) continue;
    const author = clean(cells.eq(authorCol).text());
    const rawOrder = clean(cells.eq(numberCol).text()).match(/\d+(?:\.\d+)?/)?.[0];
    const isbn = isbnOf(cells.eq(isbnCol).text() || $(row).text());
    const image = $(row).find("img").first().attr("src") || "";
    let coverUrl = "";
    try { if (image) coverUrl = new URL(image, baseUrl).toString(); } catch { /* ignore invalid cover */ }
    const identifier = isbn || `${norm(bookTitle)}|${norm(author)}|${clean(cells.eq(yearCol).text())}`;
    books.push({
      id: `libgen-series:${identifier}`,
      title: bookTitle,
      author: author || "Unknown author",
      series: title || expectedSeries,
      seriesNumber: rawOrder,
      year: clean(cells.eq(yearCol).text()) || undefined,
      publisher: clean(cells.eq(publisherCol).text()) || undefined,
      pages: clean(cells.eq(pagesCol).text()) || undefined,
      isbn: isbn || undefined,
      coverUrl: coverUrl || undefined,
      metadataSource: "LibGen series catalog",
    });
  }
  return books;
}

async function fetchLibgenSeries(seriesId: string, seriesName: string): Promise<SeriesCatalogResult | null> {
  if (!/^\d{1,12}$/.test(seriesId)) return null;
  const attempts = LIBGEN_HOSTS.map(async (host) => {
    const url = `https://${host}/series.php?id=${encodeURIComponent(seriesId)}`;
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; KoraCatalog/1.0)", Accept: "text/html,application/xhtml+xml" },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Series catalog returned HTTP ${response.status}`);
    const html = await response.text();
    const books = parseSeriesRow(html, url, seriesName);
    if (!books.length) throw new Error("No series entries parsed");
    return { series: books[0].series || seriesName, source: "LibGen series catalog", books };
  });
  try { return await Promise.any(attempts); } catch { return null; }
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

async function fetchGoogleSeries(series: string, author: string, apiKey: string): Promise<SeriesCatalogBook[]> {
  const query = [series, author].filter(Boolean).join(" ");
  const url = new URL("https://www.googleapis.com/books/v1/volumes");
  url.searchParams.set("q", query);
  url.searchParams.set("maxResults", "40");
  if (apiKey) url.searchParams.set("key", apiKey);
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) return [];
    const data = await response.json() as { items?: any[] };
    return (data.items || []).map((item) => mapGoogleVolume(item, series, author)).filter((book): book is SeriesCatalogBook => Boolean(book));
  } catch { return []; }
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

  const googleBooks = await fetchGoogleSeries(series, author, options.googleBooksApiKey || "");
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
