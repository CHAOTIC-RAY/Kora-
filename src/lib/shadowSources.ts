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

type ShadowBook = {
  title: string;
  author: string;
  year?: string;
  format?: string;
  filesize?: number;
  language?: string;
  source: string;
  md5?: string;
  downloadUrl: string;
  directUrl?: string;
  directReady?: boolean;
  coverUrl?: string;
  identifier?: string;
  pageUrl?: string;
  extension?: string;
};

const timeout = (ms: number) => AbortSignal.timeout(ms);

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

function fetchHtml(url: string, signal?: AbortSignal): Promise<string> {
  return fetch(url, { headers: { "User-Agent": UA }, signal })
    .then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.text();
    });
}

function parseLibgenSearch(html: string, baseUrl: string): ShadowBook[] {
  const $ = cheerio.load(html);
  const books: ShadowBook[] = [];

  // LibGen search results table rows
  $("table tr").each((_, row) => {
    const cells = $(row).find("td");
    if (cells.length < 7) return;

    // Column structure varies by mirror; look for the MD5 in a link
    const md5Link = $(row).find("a[href*='md5=']").first();
    const md5Href = md5Link.attr("href") || "";
    const md5Match = md5Href.match(/md5=([a-fA-F0-9]{32})/i);
    if (!md5Match) return;

    const title = clean(cells.eq(2).text()) || clean($(row).find("a").first().text());
    if (!title) return;

    const author = clean(cells.eq(1).text());
    const year = clean(cells.eq(3).text()) || undefined;
    const publisher = clean(cells.eq(4).text());
    const format = clean(cells.eq(5).text());
    const sizeText = clean(cells.eq(6).text());
    const filesize = parseSize(sizeText);

    const downloadUrl = new URL(md5Href, baseUrl).toString();
    const mirrorHost = new URL(baseUrl).hostname;

    books.push({
      title,
      author,
      year,
      format,
      filesize,
      source: `LibGen (${mirrorHost})`,
      md5: md5Match[1].toLowerCase(),
      downloadUrl,
      directUrl: downloadUrl,
      directReady: false,
      extension: format ? format.toUpperCase() : undefined,
      pageUrl: downloadUrl,
      identifier: md5Match[1].toLowerCase(),
    });
  });

  return books;
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
      md5: md5Match[1].toLowerCase(),
      downloadUrl: `https://annas-archive.org/md5/${md5Match[1]}`,
      directUrl: pageUrl,
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

async function searchLibgen(query: string, page = 1): Promise<ShadowBook[]> {
  const results: ShadowBook[] = [];
  const errors: string[] = [];

  // Race mirrors — first one to return valid results wins.
  const mirrorPromises = LIBGEN_MIRRORS.map(async (mirror) => {
    try {
      const url = `${mirror}/search.php?req=${encodeURIComponent(query)}&view=detailed&res=25`;
      const html = await fetchHtml(url, timeout(12000));
      return parseLibgenSearch(html, mirror);
    } catch (err: any) {
      errors.push(`${mirror}: ${err?.message || String(err)}`);
      return [];
    }
  });

  const settled = await Promise.all(mirrorPromises);
  for (const books of settled) {
    results.push(...books);
    if (results.length >= 25) break;
  }

  // Deduplicate by MD5
  const seen = new Set<string>();
  return results.filter((b) => {
    if (!b.md5 || seen.has(b.md5)) return false;
    seen.add(b.md5);
    return true;
  });
}

async function searchAnnasArchive(query: string, page = 1): Promise<ShadowBook[]> {
  const results: ShadowBook[] = [];

  for (const host of ANNAS_ARCHIVE_HOSTS) {
    try {
      const url = `${host}/search?q=${encodeURIComponent(query)}`;
      const html = await fetchHtml(url, timeout(12000));
      const books = parseAnnasArchiveSearch(html, host);
      results.push(...books);
      if (results.length >= 25) break;
    } catch (err: any) {
      // Try next host
      continue;
    }
  }

  // Deduplicate by MD5
  const seen = new Set<string>();
  return results.filter((b) => {
    if (!b.md5 || seen.has(b.md5)) return false;
    seen.add(b.md5);
    return true;
  });
}

/**
 * Search Anna's Archive and LibGen independently. Each source is fetched in
 * parallel; failures on one source do not prevent results from the other.
 */
export async function searchShadowBooks(
  query: string,
  mode: string,
  source: string,
  page: number,
  _env: unknown,
  _headers: Record<string, string> = {}
): Promise<{ results: ShadowBook[]; meta: Record<string, any> }> {
  const q = query.trim();
  if (!q) return { results: [], meta: {} };

  const requested = source.toLowerCase();
  const jobs: Array<[string, Promise<ShadowBook[]>]> = [];

  const isEbooks = mode !== "audiobooks";

  if (requested === "all" || ["annas", "annas-archive", "anna"].includes(requested)) {
    jobs.push(["annas-archive", searchAnnasArchive(q, page)]);
  }
  if (isEbooks && (requested === "all" || ["libgen", "genesis"].includes(requested))) {
    jobs.push(["libgen", searchLibgen(q, page)]);
  }

  const settled = await Promise.allSettled(jobs.map(([id, promise]) => promise.then((rows) => [id, rows] as const)));

  const counts: Record<string, number> = {};
  const all: ShadowBook[] = [];
  for (const result of settled) {
    if (result.status === "fulfilled") {
      const [id, rows] = result.value;
      counts[id] = rows.length;
      all.push(...rows);
    }
    // Rejected jobs are silently dropped — one source failing does not block another.
  }

  // Deduplicate by MD5 across sources
  const seen = new Set<string>();
  const deduped = all.filter((b) => {
    if (!b.md5 || seen.has(b.md5)) return false;
    seen.add(b.md5);
    return true;
  });

  return {
    results: deduped.slice(0, 25),
    meta: {
      sources: counts,
      total: deduped.length,
      mode,
      query: q,
      page,
      hasMore: deduped.length >= 25,
    },
  };
}
