/**
 * Independent shadow-source search adapters for Anna's Archive and LibGen.
 *
 * These scrapers run entirely inside the Cloudflare Worker — no dependency on
 * the retired Rave deployment. Each source is fetched independently; one source
 * timing out or being challenged cannot prevent the other from returning results.
 *
 * Results include MD5 hashes and download URLs so the caller can resolve direct
 * download links via /api/download or /api/annas-archive/download.
 */

import * as cheerio from "cheerio";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

const LIBGEN_MIRRORS = [
  "https://libgen.li",
  "https://libgen.be",
  "https://libgen.lc",
  "https://libgen.gs",
  "https://libgen.st",
  "https://libgen.rocks",
];

const ANNAS_ARCHIVE_HOSTS = [
  "https://annas-archive.org",
  "https://annas-archive.gl",
  "https://annas-archive.se",
  "https://annas-archive.li",
];

export type ShadowBook = {
  title: string;
  author: string;
  year?: string;
  publisher?: string;
  pages?: string;
  isbn?: string;
  format?: string;
  filesize?: number;
  language?: string;
  source: string;
  series?: string;
  seriesUrl?: string;
  seriesId?: string;
  md5?: string;
  downloadUrl: string;
  directUrl?: string;
  directReady?: boolean;
  coverUrl?: string;
  identifier?: string;
  pageUrl?: string;
  extension?: string;
};

export type LibgenSeriesVolume = {
  id: string;
  title: string;
  author: string;
  series: string;
  seriesNumber?: string;
  year?: string;
  publisher?: string;
  pages?: string;
  isbn?: string;
  coverUrl?: string;
  format?: string;
  filesize?: number;
  metadataSource: string;
};

export type LibgenSeriesResult = { series: string; source: string; books: LibgenSeriesVolume[] };

const timeout = (ms: number) => AbortSignal.timeout(ms);
const sourceHealth = new Map<string, { failures: number; lastError?: string }>();

function clean(value: unknown): string {
  return String(value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function norm(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function isbnOf(value: string): string {
  const candidates = String(value || "").match(/(?:97[89][\s-]?[0-9\s-]{10,15}|[0-9][\s-]?[0-9\s-]{8}[0-9Xx])/g) || [];
  for (const candidate of candidates) {
    const isbn = candidate.replace(/[\s-]/g, "").toUpperCase();
    if (isbn.length === 13 && /^97[89]\d{10}$/.test(isbn)) {
      const check = [...isbn.slice(0, 12)].reduce((sum, digit, index) => sum + Number(digit) * (index % 2 ? 3 : 1), 0);
      if ((10 - (check % 10)) % 10 === Number(isbn[12])) return isbn;
    }
    if (isbn.length === 10 && /^\d{9}[\dX]$/.test(isbn)) {
      const check = [...isbn.slice(0, 9)].reduce((sum, digit, index) => sum + Number(digit) * (10 - index), 0);
      const expected = (11 - (check % 11)) % 11;
      if ((expected === 10 ? "X" : String(expected)) === isbn[9]) return isbn;
    }
  }
  return "";
}

export function libgenSearchParams(query: string, mode = "ebooks"): URLSearchParams {
  const params = new URLSearchParams();
  const isbn = isbnOf(query);
  params.set("req", isbn || query.trim());
  for (const topic of (mode === "audiobooks" ? ["a", "m"] : ["l", "c", "f", "a", "m", "r", "s"])) {
    params.append("topics[]", topic);
  }
  for (const column of (isbn ? ["i"] : ["t", "a"])) params.append("columns[]", column);
  params.set("res", "50");
  params.set("page", "1");
  return params;
}

export function parseFilesizeBytes(value: string, unit: string): number {
  const number = Number.parseFloat(String(value || "").replace(",", "."));
  if (!Number.isFinite(number) || number < 0) return 0;
  const normalizedUnit = String(unit || "").trim().toLowerCase();
  const multiplier = normalizedUnit.startsWith("g") ? 1_000_000_000
    : normalizedUnit.startsWith("m") ? 1_000_000
      : normalizedUnit.startsWith("b") ? 1
        : 1_000;
  return Math.round(number * multiplier);
}

export function parseLibgenTitleCell(html: string): { title: string; isbn: string } {
  const source = String(html || "").replace(/\s+title=(['"])[\s\S]*?\1/gi, "");
  const $ = cheerio.load(`<div>${source}</div>`);
  const container = $("div").first();
  const isbn = isbnOf(container.find("font[color], span[style*='color']").filter((_, el) => {
    const color = `${$(el).attr("color") || ""} ${$(el).attr("style") || ""}`.toLowerCase();
    return color.includes("green");
  }).text()) || isbnOf(container.text());
  container.find("font[color], span[style*='color']").each((_, el) => {
    const color = `${$(el).attr("color") || ""} ${$(el).attr("style") || ""}`.toLowerCase();
    if (color.includes("green")) $(el).remove();
  });
  container.find("font[size='1'], small").remove();
  container.find(".badge, nobr").remove();
  const hasSeriesLink = container.find("a[href*='series.php']").length > 0;
  container.find("a[href*='series.php']").remove();
  if (hasSeriesLink) {
    const titleLink = container.find("a[href*='edition.php']").toArray().reverse().find((el) => {
      const text = clean($(el).text());
      return text && !isbnOf(text) && !/^(?:\d{4}[-/ ]|.*\b(?:vol(?:ume)?|iss(?:ue)?|pp\.?\s*\d)\b)/i.test(text);
    });
    if (titleLink) return { title: clean($(titleLink).text()), isbn };
  }
  const segments = container.html().split(/<br\s*\/?>/i).map((line) => clean(line)).filter(Boolean);
  const unique = segments.filter((line, index) => !segments.slice(index + 1).some((later) => norm(later) === norm(line)));
  const title = unique.filter((line) => !isbnOf(line)).join(" · ").trim();
  return { title: title.replace(/\s+/g, " "), isbn };
}

export function relevance(book: { title?: string; author?: string }, query: string): number {
  const stop = new Set(["the", "a", "an", "of", "and", "to", "in", "for"]);
  const terms = norm(query).split(/\s+/).filter((term) => term && !stop.has(term));
  if (!terms.length) return 0;
  const searchable = new Set(norm(`${book.title || ""} ${book.author || ""}`).split(/\s+/).filter(Boolean));
  return terms.filter((term) => searchable.has(term)).length / terms.length;
}

function fetchHtml(url: string, signal?: AbortSignal): Promise<string> {
  return fetch(url, { headers: { "User-Agent": UA }, signal })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    });
}

export function parseLibgenResultsHtml(html: string, baseUrl: string): ShadowBook[] {
  const $ = cheerio.load(html);
  const books: ShadowBook[] = [];
  const table = $("#tablelibgen");
  if (!table.length) return books;

  table.find("tr").each((_, row) => {
    const cells = $(row).children("td");
    if (cells.length < 7) return;
    const titleIndex = cells.toArray().findIndex((cell) => {
      const text = clean($(cell).text());
      return !!text && $(cell).find("a[href*='book/index.php'], a[href*='edition.php']").length > 0;
    });
    if (titleIndex < 0) return;
    const titleCell = cells.eq(titleIndex);
    const parsedTitle = parseLibgenTitleCell(titleCell.html() || titleCell.text());
    if (!parsedTitle.title) return;
    const seriesLink = titleCell.find("a[href*='series.php']").first();
    const series = clean(seriesLink.text()) || undefined;
    const seriesHref = seriesLink.attr("href") || "";
    const seriesUrl = seriesHref ? new URL(seriesHref, baseUrl).toString() : undefined;
    const seriesId = seriesHref ? new URL(seriesHref, baseUrl).searchParams.get("id") || undefined : undefined;

    const headers = table.find("tr").first().children("td, th").map((_, cell) => norm(clean($(cell).text()))).get();
    const headerTitle = headers.findIndex((header) => header === "title");
    const shiftedLegacyColumns = headerTitle >= titleIndex + 2;
    const indexFor = (pattern: RegExp, relativeOffset: number) => {
      if (shiftedLegacyColumns) return titleIndex + relativeOffset;
      const index = headers.findIndex((header) => pattern.test(header));
      return index >= 0 ? index : titleIndex + relativeOffset;
    };
    const cellText = (pattern: RegExp, relativeOffset: number) => clean(cells.eq(indexFor(pattern, relativeOffset)).text());
    const author = cellText(/author|creator/, 1);
    const publisher = cellText(/publisher/, 2) || undefined;
    const year = cellText(/^year$|publication year/, 3) || undefined;
    const language = cellText(/^language$|lang/, 4) || undefined;
    const pages = cellText(/^pages?$|page count/, 5) || undefined;
    const sizeText = cellText(/size|filesize/, 6);
    const sizeMatch = sizeText.match(/([\d,.]+)\s*([a-z]+)/i);
    const filesize = sizeMatch ? parseFilesizeBytes(sizeMatch[1], sizeMatch[2]) : 0;
    const format = cellText(/^(?:ext|extension|format)$/, 7).replace(/^\./, "").toLowerCase();
    const idHref = titleCell.find("a[href*='book/index.php'], a[href*='edition.php']").first().attr("href") || "";
    const identifier = titleCell.find("a[id]").first().attr("id") || new URL(idHref, baseUrl).searchParams.get("id") || "";
    const md5Link = $(row).find("a[href*='md5=']").first().attr("href") || "";
    const md5 = md5Link.match(/md5=([a-f0-9]{32})/i)?.[1]?.toUpperCase() || "";
    const adsUrl = md5 ? new URL(`/ads.php?md5=${md5}`, baseUrl).toString() : "";
    const pagePath = idHref.replace(/(?:book\/)?index\.php/i, "index.php");
    const pageUrl = idHref ? new URL(pagePath, baseUrl).toString() : "";
    const imageSrc = $(row).find("img").first().attr("src") || "";
    const coverUrl = imageSrc
      ? new URL(imageSrc, baseUrl).toString()
      : md5 ? new URL(`/covers/0/${md5.toLowerCase()}-s.jpg`, baseUrl).toString() : "";

    books.push({
      title: parsedTitle.title,
      author,
      year,
      publisher,
      pages,
      language: language || undefined,
      isbn: parsedTitle.isbn || isbnOf(clean($(row).text())) || undefined,
      format,
      filesize,
      source: "Library Genesis",
      series,
      seriesUrl,
      seriesId,
      md5,
      downloadUrl: adsUrl,
      directReady: false,
      coverUrl,
      pageUrl,
      identifier: String(identifier),
    });
  });

  return books;
}

/** Fetch and parse the public series catalog page. Returns catalog metadata only. */
export async function fetchLibgenSeries(seriesId: string, seriesName = "Series"): Promise<LibgenSeriesResult | null> {
  if (!/^\d{1,12}$/.test(String(seriesId || ""))) return null;
  const parsePage = (html: string, baseUrl: string): LibgenSeriesVolume[] => {
    const $ = cheerio.load(html);
    const table = $("#tablelibgen").first().length ? $("#tablelibgen").first() : $("table").filter((_, node) => /title/i.test($(node).text())).first();
    if (!table.length) return [];
    const rows = table.find("tr").toArray();
    const header = rows.find((row) => /title/i.test($(row).text()) && /author/i.test($(row).text()));
    const headers = header ? $(header).children("th,td").map((_, cell) => norm(clean($(cell).text()))).get() : [];
    const col = (pattern: RegExp, fallback: number) => {
      const index = headers.findIndex((value) => pattern.test(value));
      return index >= 0 ? index : fallback;
    };
    const yearCol = col(/^year$|publication year/, 1);
    const numberCol = col(/total number|issue|number|volume/, 2);
    const titleCol = col(/^title$|edition title/, 3);
    const authorCol = col(/author|creator/, 4);
    const publisherCol = col(/publisher/, 5);
    const pagesCol = col(/pages?/, 6);
    const isbnCol = col(/isbn/, 7);
    const formatCol = col(/^(?:ext|extension|format)$/, -1);
    const sizeCol = col(/size|filesize/, -1);
    const pageTitle = clean($("h1").first().text() || $("title").first().text()) || seriesName;
    const books: LibgenSeriesVolume[] = [];
    for (const row of rows) {
      if (row === header) continue;
      const cells = $(row).children("td");
      if (cells.length < 4) continue;
      const titleCell = cells.eq(titleCol);
      const title = clean(titleCell.find("a[href*='edition.php'], a[href*='book/index.php']").first().text() || titleCell.text());
      if (!title || /^title$/i.test(title)) continue;
      const author = clean(cells.eq(authorCol).text()) || "Unknown author";
      const isbn = isbnOf(clean(cells.eq(isbnCol).text()) || clean($(row).text()));
      const image = $(row).find("img").first().attr("src") || "";
      let coverUrl: string | undefined;
      try { if (image) coverUrl = new URL(image, baseUrl).toString(); } catch { /* invalid cover */ }
      const sizeText = sizeCol >= 0 ? clean(cells.eq(sizeCol).text()) : "";
      const sizeMatch = sizeText.match(/([\d,.]+)\s*([a-z]+)/i);
      const amount = sizeMatch ? Number.parseFloat(sizeMatch[1].replace(",", ".")) : 0;
      const unit = sizeMatch?.[2]?.toLowerCase() || "";
      const filesize = sizeMatch && Number.isFinite(amount) ? Math.round(amount * (unit.startsWith("g") ? 1e9 : unit.startsWith("m") ? 1e6 : unit.startsWith("k") ? 1e3 : 1)) : undefined;
      const identifier = isbn || `${norm(title)}|${norm(author)}|${clean(cells.eq(yearCol).text())}`;
      books.push({
        id: `libgen-series:${identifier}`,
        title,
        author,
        series: pageTitle,
        seriesNumber: clean(cells.eq(numberCol).text()).match(/\d+(?:\.\d+)?/)?.[0],
        year: clean(cells.eq(yearCol).text()) || undefined,
        publisher: clean(cells.eq(publisherCol).text()) || undefined,
        pages: clean(cells.eq(pagesCol).text()) || undefined,
        isbn: isbn || undefined,
        coverUrl,
        format: formatCol >= 0 ? clean(cells.eq(formatCol).text()).replace(/^\./, "").toLowerCase() || undefined : undefined,
        filesize,
        metadataSource: "LibGen series catalog",
      });
    }
    return books;
  };
  const attempts = LIBGEN_MIRRORS.map(async (mirror) => {
    const url = `${mirror}/series.php?id=${encodeURIComponent(seriesId)}`;
    const html = await fetchHtml(url, timeout(6500));
    const books = parsePage(html, url);
    if (!books.length) throw new Error("No series volumes parsed");
    return { series: books[0].series || seriesName, source: "LibGen series catalog", books };
  });
  try { return await Promise.any(attempts); } catch { return null; }
}

function parseLibgenSearch(html: string, baseUrl: string): ShadowBook[] {
  return parseLibgenResultsHtml(html, baseUrl);
}

function parseAnnasArchiveSearch(html: string, baseUrl: string): ShadowBook[] {
  const $ = cheerio.load(html);
  const books: ShadowBook[] = [];

  // Anna's Archive result cards/links contain md5 in href like /md5/<hash>
  $("a[href*='/md5/']").each((_, el) => {
    const href = $(el).attr("href") || "";
    const md5Match = href.match(/\/md5\/([a-fA-F0-9]{32})/i);
    if (!md5Match) return;

    const card = $(el).closest(".result, .book, .item, .search-result");
    const title = clean(card.length ? card.find("h3, h4, .title, .book-title").first().text() : $(el).text());
    if (!title) return;

    const author = clean(card.length ? card.find(".author, .creator, .by").first().text() : "");
    const year = clean(card.length ? card.find(".year, .date").first().text() : "") || undefined;
    const format = clean(card.length ? card.find(".format, .extension, .filetype").first().text() : "") || undefined;
    const filesize = parseSize(clean(card.length ? card.find(".size, .filesize").first().text() : ""));

    const pageUrl = new URL(href, baseUrl).toString();

    books.push({
      title,
      author,
      year,
      format,
      filesize,
      source: "Anna's Archive",
      md5: md5Match[1].toUpperCase(),
      downloadUrl: `https://annas-archive.org/md5/${md5Match[1]}`,
      directReady: false,
      extension: format ? format.toUpperCase() : undefined,
      pageUrl,
      identifier: md5Match[1].toLowerCase(),
    });
  });

  return books;
}

function parseSize(text: string): number | undefined {
  if (!text) return undefined;
  const match = text.match(/([\d.]+)\s*([KMGT]?B)/i);
  if (!match) return undefined;
  const num = parseFloat(match[1]);
  const unit = match[2].toUpperCase();
  const multipliers: Record<string, number> = { B: 1, KB: 1024, MB: 1048576, GB: 1073741824, TB: 1099511627776 };
  return Math.round(num * (multipliers[unit] || 1));
}

async function searchLibgen(query: string, page = 1, mode = "ebooks"): Promise<ShadowBook[]> {
  let responded = false;
  const controller = new AbortController();

  // Race mirrors — first one to return valid results wins.
  const mirrorPromises = LIBGEN_MIRRORS.map(async (mirror) => {
    const params = libgenSearchParams(query, mode);
    params.set("page", String(Math.max(1, page)));
    const url = `${mirror}/index.php?${params.toString()}`;
    const html = await fetchHtml(url, AbortSignal.any([timeout(9000), controller.signal]));
    responded = true;
    const books = parseLibgenSearch(html, mirror);
    if (!books.length) throw new Error("Mirror returned no matching books");
    return books;
  });

  try {
    const results = await Promise.any(mirrorPromises);
    controller.abort();
    // Deduplicate by MD5.
    const seen = new Set<string>();
    return results.filter((book) => {
      if (!book.md5 || seen.has(book.md5)) return false;
      seen.add(book.md5);
      return true;
    });
  } catch {
    controller.abort();
    if (!responded) throw new Error("Library Genesis mirrors are unavailable");
    return [];
  }
}

export function parseAnnasResultsHtml(html: string, baseUrl: string): ShadowBook[] {
  const $ = cheerio.load(html);
  const books: ShadowBook[] = [];
  const seen = new Set<string>();
  $("a[href*='/md5/']").each((_, anchor) => {
    const href = $(anchor).attr("href") || "";
    const md5 = href.match(/\/md5\/([a-f0-9]{32})/i)?.[1]?.toUpperCase();
    if (!md5 || seen.has(md5)) return;
    const card = $(anchor).closest("div.flex");
    const links = card.find("a[href*='/md5/']").toArray();
    const titleLink = links.find((link) => clean($(link).text())) || anchor;
    const title = clean($(titleLink).text());
    if (!title) return;
    const author = clean(card.find("a[href*='/search?q=']").first().text());
    const metaText = clean(card.find("div").last().text());
    const parts = metaText.split(/[·•]/).map((part) => clean(part)).filter(Boolean);
    const language = parts.find((part) => /^[a-z][a-z -]*(?:\s+\[[a-z-]+\])?$/i.test(part))?.replace(/\s*\[[^\]]+\]/, "").trim();
    const format = parts.find((part) => /^(?:epub|pdf|mobi|azw3?|fb2|djvu|txt|zip)$/i.test(part))?.toLowerCase();
    const sizePart = parts.find((part) => /^[\d,.]+\s*(?:kb|mb|gb|b)$/i.test(part)) || "";
    const sizeMatch = sizePart.match(/([\d,.]+)\s*([a-z]+)/i);
    const year = parts.find((part) => /^\d{4}$/.test(part));
    const imageSrc = card.find("img").first().attr("src") || "";
    const pageUrl = `https://annas-archive.org/md5/${md5}`;
    seen.add(md5);
    books.push({
      title,
      author,
      year,
      publisher: parts.find((part) => part !== language && part.toLowerCase() !== format && part !== sizePart && part !== year && !/^[a-z]+\s*\[[a-z-]+\]$/i.test(part)),
      language,
      format,
      filesize: sizeMatch ? parseFilesizeBytes(sizeMatch[1], sizeMatch[2]) : 0,
      source: "Anna's Archive",
      md5,
      downloadUrl: pageUrl,
      pageUrl,
      directReady: false,
      coverUrl: imageSrc ? new URL(imageSrc, baseUrl).toString() : "",
    });
  });
  return books;
}

async function searchAnnasArchive(query: string, page = 1): Promise<ShadowBook[]> {
  let responded = false;
  const controller = new AbortController();
  const hostPromises = ANNAS_ARCHIVE_HOSTS.map(async (host) => {
      const url = `${host}/search?q=${encodeURIComponent(query)}&page=${Math.max(1, page)}`;
      const html = await fetchHtml(url, AbortSignal.any([timeout(9000), controller.signal]));
      responded = true;
      const books = parseAnnasResultsHtml(html, host);
      if (!books.length) throw new Error("Mirror returned no matching books");
      return books;
  });

  try {
    const results = await Promise.any(hostPromises);
    controller.abort();
    const seen = new Set<string>();
    return results.filter((book) => {
      if (!book.md5 || seen.has(book.md5)) return false;
      seen.add(book.md5);
      return true;
    });
  } catch {
    controller.abort();
    if (!responded) throw new Error("Anna's Archive search mirrors are unavailable");
    return [];
  }
}

export function resetShadowSourceState(): void {
  sourceHealth.clear();
}

export async function resolveLibgenDirectLinks(books: ShadowBook[], timeoutMs = 5000): Promise<ShadowBook[]> {
  return Promise.all(books.map(async (book) => {
    if (!/(?:libgen|library\s+genesis)/i.test(book.source) || !book.md5 || book.directReady) return book;
    const resolved = await Promise.allSettled(LIBGEN_MIRRORS.map(async (mirror) => {
      const html = await fetchHtml(`${mirror}/ads.php?md5=${encodeURIComponent(book.md5!)}`, timeout(Math.max(timeoutMs, 1000)));
      const links = [...html.matchAll(/href=["']([^"']*get\.php\?md5=[^"']+)["']/gi)];
      for (const [, href] of links) {
        if (href.toLowerCase().includes(book.md5!.toLowerCase()) && /[?&]key=[^&]+/i.test(href)) return new URL(href.replace(/&amp;/g, "&"), mirror).toString();
      }
      return "";
    }));
    const directUrl = resolved.find((result) => result.status === "fulfilled" && result.value)?.status === "fulfilled"
      ? (resolved.find((result) => result.status === "fulfilled" && result.value) as PromiseFulfilledResult<string>).value
      : "";
    if (directUrl) return { ...book, directUrl, directReady: true };
    return book;
  }));
}

/**
 * Search LibGen and Anna's Archive independently. Each source is fetched in
 * parallel; failures on one source do not prevent results from the other.
 */
export async function searchShadowBooks(
  query: string,
  mode = "ebooks",
  source = "all",
  page = 1,
  _env: unknown = null,
  _headers: Record<string, string> = {}
): Promise<{ results: ShadowBook[]; meta: Record<string, any> }> {
  const q = query.trim();
  if (!q) return { results: [], meta: { sources: {}, total: 0, degraded: true, notes: ["Enter a search query."], directResolved: 0 } };

  const requested = source.toLowerCase();
  const jobs: Array<[string, Promise<ShadowBook[]>]> = [];

  const isEbooks = mode !== "audiobooks";

  if (isEbooks && (requested === "all" || ["libgen", "genesis"].includes(requested))) {
    jobs.push(["libgen", searchLibgen(q, page, mode)]);
  }
  if (requested === "all" || ["annas", "annas-archive", "anna"].includes(requested)) {
    jobs.push(["annas", searchAnnasArchive(q, page)]);
  }

  const settled = await Promise.allSettled(jobs.map(([id, promise]) => promise.then((rows) => [id, rows] as const)));

  const counts: Record<string, number> = {};
  const notes: string[] = [];
  const all: ShadowBook[] = [];
  for (let resultIndex = 0; resultIndex < settled.length; resultIndex++) {
    const result = settled[resultIndex];
    if (result.status === "fulfilled") {
      const [id, rows] = result.value;
      counts[id] = rows.length;
      all.push(...rows);
    } else {
      const id = jobs[resultIndex]?.[0] || "source";
      counts[id] = 0;
      notes.push(`${id} search failed: ${String(result.reason?.message || result.reason || "unavailable")}`);
    }
  }

  // Deduplicate by MD5 across sources
  const seen = new Set<string>();
  const deduped = all.filter((b) => {
    if (!b.md5 || seen.has(b.md5)) return false;
    seen.add(b.md5);
    return true;
  });

  const relevant = deduped.filter((book) => relevance(book, q) > 0);
  const firstLibgen = relevant.findIndex((book) => /(?:libgen|library\s+genesis)/i.test(book.source));
  const resolved = firstLibgen >= 0
    ? await resolveLibgenDirectLinks([relevant[firstLibgen]], 1200)
    : [];
  if (firstLibgen >= 0 && resolved[0]) relevant[firstLibgen] = resolved[0];
  const directResolved = resolved.filter((book) => book.directReady).length;
  return {
    results: relevant.slice(0, 25),
    meta: {
      sources: counts,
      total: relevant.length,
      mode,
      query: q,
      page,
      hasMore: deduped.length >= 25,
      degraded: notes.length === jobs.length && jobs.length > 0,
      notes,
      directResolved,
    },
  };
}
