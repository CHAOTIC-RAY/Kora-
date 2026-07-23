/**
 * FictionDB series placement lookup (order + siblings).
 * FictionDB sits behind Cloudflare; we fetch HTML directly when possible,
 * then fall back to the Jina reader HTML proxy.
 */

import * as cheerio from "cheerio";

export interface FictionDbSeriesBook {
  order: number;
  title: string;
  date?: string;
  bookId?: string;
  url?: string;
}

export interface FictionDbSeriesPlacement {
  seriesId: string;
  seriesName: string;
  seriesUrl: string;
  position: number | null;
  total: number;
  books: FictionDbSeriesBook[];
  bookUrl?: string;
  bookTitle?: string;
  source: "FictionDB";
}

interface SeriesCandidate {
  seriesName: string;
  seriesUrl: string;
  position: number | null;
  label: string;
  mustRead: boolean;
  bestRead: boolean;
}

interface BookSearchHit {
  title: string;
  author: string;
  url: string;
  bookId?: string;
}

const FICTIONDB_ORIGIN = "https://www.fictiondb.com";
const JINA_PREFIX = "https://r.jina.ai/";
const CACHE_TTL_MS = 1000 * 60 * 60 * 12;
const placementCache = new Map<string, { at: number; value: FictionDbSeriesPlacement | null }>();

const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
};

function absUrl(href: string | undefined | null): string {
  if (!href) return "";
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("//")) return `https:${href}`;
  return `${FICTIONDB_ORIGIN}${href.startsWith("/") ? "" : "/"}${href}`;
}

function cacheKey(title: string, author: string): string {
  return `${normalizeKey(title)}::${normalizeKey(author)}`;
}

function normalizeKey(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

function stripSubtitle(title: string): string {
  return (title || "").split(/[:–—]/)[0]!.trim();
}

export function titlesRoughlyEqual(a: string, b: string): boolean {
  const na = normalizeKey(stripSubtitle(a));
  const nb = normalizeKey(stripSubtitle(b));
  if (!na || !nb) return false;
  if (na === nb) return true;
  if (na.includes(nb) || nb.includes(na)) return true;
  // tolerate "Percy Jackson and the Lightning Thief" vs "The Lightning Thief"
  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  return shorter.length >= 10 && longer.includes(shorter);
}

function isCloudflareChallenge(html: string): boolean {
  const h = (html || "").toLowerCase();
  return (
    h.includes("just a moment") ||
    h.includes("cf-challenge") ||
    h.includes("challenges.cloudflare.com") ||
    h.includes("cf-browser-verification")
  );
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const direct = await fetch(url, { headers: BROWSER_HEADERS });
    if (direct.ok) {
      const text = await direct.text();
      if (text && !isCloudflareChallenge(text) && text.length > 500) {
        return text;
      }
    }
  } catch {
    /* fall through */
  }

  try {
    // Keep Jina headers minimal — Chrome-like UAs can trigger upstream 403s.
    const jina = await fetch(`${JINA_PREFIX}${url}`, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        "X-Return-Format": "html",
        "X-Timeout": "45",
      },
    });
    if (!jina.ok) return null;
    const text = await jina.text();
    if (!text || isCloudflareChallenge(text)) return null;
    return text;
  } catch {
    return null;
  }
}

function parseSeriesIdFromUrl(url: string): string {
  const m = url.match(/~(\d+)\.htm/i);
  return m?.[1] || "";
}

function parseSeriesPage(html: string, seriesUrl: string): {
  seriesName: string;
  seriesId: string;
  books: FictionDbSeriesBook[];
} {
  const $ = cheerio.load(html);
  const section = $("#books, [data-series-id]").first();
  const seriesId =
    section.attr("data-series-id") || parseSeriesIdFromUrl(seriesUrl) || "";

  let seriesName =
    $("h1").first().text().trim() ||
    $(".section-title").first().text().trim() ||
    "";
  seriesName = seriesName
    .replace(/\s+Series\s+in\s+Order\s*$/i, "")
    .replace(/\s+Books\s+in\s+Order\s*$/i, "")
    .trim();

  const books: FictionDbSeriesBook[] = [];
  const rows = section.find(".list-row").length
    ? section.find(".list-row")
    : $(".list-row");

  rows.each((_, el) => {
    const $row = $(el);
    const orderRaw =
      $row.find(".col-order").first().text().trim() ||
      $row.attr("data-sort-series") ||
      "";
    const order = parseInt(orderRaw.replace(/[^\d]/g, ""), 10);
    if (!Number.isFinite(order) || order <= 0) return;

    const titleLink = $row.find("a.book-title").first();
    const title =
      titleLink.text().trim() ||
      $row.find(".book-title, .book-main-text").first().text().trim();
    if (!title) return;

    const href = titleLink.attr("href");
    const bookId = $row.attr("data-book-id") || undefined;
    const date = $row.find(".col-date").first().text().trim() || undefined;

    books.push({
      order,
      title,
      date,
      bookId,
      url: href ? absUrl(href) : undefined,
    });
  });

  books.sort((a, b) => a.order - b.order);
  return { seriesName, seriesId, books };
}

function parseSearchResults(html: string): BookSearchHit[] {
  const $ = cheerio.load(html);
  const hits: BookSearchHit[] = [];
  const seen = new Set<string>();

  $("a[href*='/book/']").each((_, el) => {
    const href = $(el).attr("href") || "";
    if (!/\/book\/.+~\d+\.htm/i.test(href)) return;
    const url = absUrl(href);
    if (seen.has(url)) return;
    seen.add(url);

    const title = $(el).text().trim();
    if (!title || title.length < 2) return;

    const row = $(el).closest(".list-row, tr, li, .result, article, div");
    const author =
      row.find(".col-author, .author, .book-author").first().text().trim() ||
      "";

    const idMatch = href.match(/~(\d+)\.htm/i);
    hits.push({
      title,
      author,
      url,
      bookId: idMatch?.[1],
    });
  });

  return hits;
}

function parseBookSeriesCandidates(html: string): SeriesCandidate[] {
  const $ = cheerio.load(html);
  const out: SeriesCandidate[] = [];
  const seen = new Set<string>();

  const pushFrom = ($el: ReturnType<typeof $>, fallbackLabel: string) => {
    const text = $el.text().replace(/\s+/g, " ").trim();
    const link = $el
      .find('a[href*="/series/"]')
      .filter((_, a) => /~\d+\.htm/i.test($(a).attr("href") || ""))
      .first();
    const href = link.attr("href");
    if (!href) return;

    const seriesUrl = absUrl(href);
    const key = parseSeriesIdFromUrl(seriesUrl) || seriesUrl;
    if (seen.has(key)) return;
    seen.add(key);

    let seriesName =
      link.text().replace(/\s+/g, " ").trim() ||
      $el.find(".book-hero-series-value").first().text().replace(/\s+/g, " ").trim();
    seriesName = seriesName
      .replace(/\s*Book\s+\d+\s*$/i, "")
      .replace(/^View\s+(the\s+)?full\s+/i, "")
      .replace(/\s+series\s+order.*$/i, "")
      .trim();

    const numText =
      $el.find(".book-hero-series-num, .series-fit-num").first().text().trim() ||
      text;
    const posMatch = numText.match(/Book\s+#?\s*(\d+)/i) || text.match(/Book\s+#?\s*(\d+)/i);
    const position = posMatch ? parseInt(posMatch[1]!, 10) : null;

    const label =
      $el.find(".book-hero-series-label").first().text().trim() ||
      (/also appears/i.test(text) ? "Also Appears In" : fallbackLabel);

    out.push({
      seriesName,
      seriesUrl,
      position: Number.isFinite(position as number) ? position : null,
      label,
      mustRead: /must read in order/i.test(text),
      bestRead: /best read in order/i.test(text),
    });
  };

  $(".book-hero-series-item").each((_, el) => pushFrom($(el), "Series"));
  $(".series-fit-card").each((_, el) => pushFrom($(el), "Series"));

  // Fallback: any series deep-links with nearby "Book N"
  if (out.length === 0) {
    $('a[href*="/series/"]').each((_, a) => {
      const href = $(a).attr("href") || "";
      if (!/~\d+\.htm/i.test(href)) return;
      const parent = $(a).parent();
      const text = `${$(a).text()} ${parent.text()}`.replace(/\s+/g, " ");
      const posMatch = text.match(/Book\s+#?\s*(\d+)/i);
      const seriesUrl = absUrl(href);
      const key = parseSeriesIdFromUrl(seriesUrl) || seriesUrl;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({
        seriesName: $(a).text().replace(/\s+/g, " ").trim(),
        seriesUrl,
        position: posMatch ? parseInt(posMatch[1]!, 10) : null,
        label: "Series",
        mustRead: /must read/i.test(text),
        bestRead: /best read/i.test(text),
      });
    });
  }

  return out;
}

function scoreSeriesCandidate(c: SeriesCandidate, queryTitle: string): number {
  let score = 0;
  const name = (c.seriesName || "").toLowerCase();
  const q = (queryTitle || "").toLowerCase();

  if (/universe|crossover|omnibus|collection|anthology/.test(name)) score -= 45;
  if (/graphic/.test(name) && !/graphic/.test(q)) score -= 35;
  if (c.mustRead) score += 20;
  if (c.bestRead) score += 8;
  if (/also appears/i.test(c.label)) score += 12;
  if (c.position != null) score += 6;

  const seriesTokens = name
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 3 && !["series", "book", "novel", "with"].includes(t));
  const titleTokens = normalizeKey(q);
  for (const t of seriesTokens) {
    if (titleTokens.includes(t.replace(/[^a-z0-9]/g, ""))) score += 3;
  }

  return score;
}

function pickSearchHit(hits: BookSearchHit[], title: string, author: string): BookSearchHit | null {
  if (!hits.length) return null;
  const wantsGraphic = /graphic/i.test(title);

  const scored = hits.map((hit) => {
    let score = 0;
    if (titlesRoughlyEqual(hit.title, title)) score += 50;
    else if (normalizeKey(hit.title).includes(normalizeKey(stripSubtitle(title)))) score += 25;

    if (author && normalizeKey(hit.author).includes(normalizeKey(author.split(/[,&]/)[0] || ""))) {
      score += 15;
    }

    const isGraphic = /graphic/i.test(hit.title);
    if (isGraphic && !wantsGraphic) score -= 40;
    if (!isGraphic && wantsGraphic) score -= 10;

    return { hit, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored[0]!.score > 0 ? scored[0]!.hit : hits[0]!;
}

function findPositionInSeries(
  books: FictionDbSeriesBook[],
  title: string,
  hinted: number | null
): number | null {
  const match = books.find((b) => titlesRoughlyEqual(b.title, title));
  if (match) return match.order;
  if (hinted != null && books.some((b) => b.order === hinted)) return hinted;
  return hinted;
}

/**
 * Look up FictionDB series placement for a title + author.
 * Returns ordered siblings and "book N of M" when found.
 */
export async function lookupFictionDbSeriesPlacement(
  title: string,
  author: string = ""
): Promise<FictionDbSeriesPlacement | null> {
  const cleanTitle = (title || "").trim();
  if (!cleanTitle) return null;

  const key = cacheKey(cleanTitle, author);
  const cached = placementCache.get(key);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return cached.value;
  }

  try {
    const titleQ = stripSubtitle(cleanTitle);
    const searchUrls = [
      `${FICTIONDB_ORIGIN}/search/searchresults.php?` +
        `author=${encodeURIComponent(author || "")}` +
        `&title=${encodeURIComponent(titleQ)}` +
        `&styp=6`,
      `${FICTIONDB_ORIGIN}/search/?` +
        `srchtxt=${encodeURIComponent(`${titleQ} ${author || ""}`.trim())}` +
        `&styp=5`,
    ];

    let hits: BookSearchHit[] = [];
    for (const searchUrl of searchUrls) {
      const searchHtml = await fetchHtml(searchUrl);
      if (!searchHtml) continue;
      hits = parseSearchResults(searchHtml);
      if (hits.length) break;
    }

    // Last-resort discovery: DuckDuckGo → FictionDB book/series URL
    if (!hits.length) {
      const ddgHits = await discoverViaDuckDuckGo(cleanTitle, author);
      hits = ddgHits;
    }

    const hit = pickSearchHit(hits, cleanTitle, author);
    if (!hit) {
      placementCache.set(key, { at: Date.now(), value: null });
      return null;
    }

    // If DDG returned a series URL directly, skip book page
    if (/\/series\/.+~\d+\.htm/i.test(hit.url) && !hit.bookId) {
      const seriesHtml = await fetchHtml(hit.url);
      if (!seriesHtml) {
        placementCache.set(key, { at: Date.now(), value: null });
        return null;
      }
      const parsed = parseSeriesPage(seriesHtml, hit.url);
      const position = findPositionInSeries(parsed.books, cleanTitle, null);
      const placement: FictionDbSeriesPlacement = {
        seriesId: parsed.seriesId || parseSeriesIdFromUrl(hit.url),
        seriesName: parsed.seriesName || hit.title,
        seriesUrl: hit.url,
        position,
        total: parsed.books.length,
        books: parsed.books,
        source: "FictionDB",
      };
      placementCache.set(key, { at: Date.now(), value: placement });
      return placement;
    }

    const bookHtml = await fetchHtml(hit.url);
    if (!bookHtml) {
      placementCache.set(key, { at: Date.now(), value: null });
      return null;
    }

    const candidates = parseBookSeriesCandidates(bookHtml);
    if (!candidates.length) {
      placementCache.set(key, { at: Date.now(), value: null });
      return null;
    }

    const ranked = [...candidates].sort(
      (a, b) => scoreSeriesCandidate(b, cleanTitle) - scoreSeriesCandidate(a, cleanTitle)
    );
    const best = ranked[0]!;

    const seriesHtml = await fetchHtml(best.seriesUrl);
    if (!seriesHtml) {
      placementCache.set(key, { at: Date.now(), value: null });
      return null;
    }

    const parsed = parseSeriesPage(seriesHtml, best.seriesUrl);
    const books = parsed.books;
    const position = findPositionInSeries(books, cleanTitle, best.position);
    const total = books.length || (position ?? 0);

    const placement: FictionDbSeriesPlacement = {
      seriesId: parsed.seriesId || parseSeriesIdFromUrl(best.seriesUrl),
      seriesName: parsed.seriesName || best.seriesName,
      seriesUrl: best.seriesUrl,
      position,
      total,
      books,
      bookUrl: hit.url,
      bookTitle: hit.title,
      source: "FictionDB",
    };

    placementCache.set(key, { at: Date.now(), value: placement });
    return placement;
  } catch (err) {
    console.error("[FictionDB] series lookup failed:", err);
    placementCache.set(key, { at: Date.now(), value: null });
    return null;
  }
}

async function discoverViaDuckDuckGo(
  title: string,
  author: string
): Promise<BookSearchHit[]> {
  try {
    const q = `site:fictiondb.com/book ${stripSubtitle(title)} ${author || ""}`.trim();
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": BROWSER_HEADERS["User-Agent"]! },
    });
    if (!res.ok) return [];
    const html = await res.text();
    const decoded = [
      ...html.matchAll(/uddg=([^&"]+)/g),
    ].map((m) => decodeURIComponent(m[1]!));

    const hits: BookSearchHit[] = [];
    const seen = new Set<string>();
    for (const u of decoded) {
      if (!/fictiondb\.com\/(book|series)\//i.test(u)) continue;
      const clean = u.split("&")[0]!;
      if (seen.has(clean)) continue;
      seen.add(clean);
      const idMatch = clean.match(/~(\d+)\.htm/i);
      hits.push({
        title: stripSubtitle(title),
        author: author || "",
        url: clean,
        bookId: /\/book\//i.test(clean) ? idMatch?.[1] : undefined,
      });
      if (hits.length >= 6) break;
    }
    return hits;
  } catch {
    return [];
  }
}
