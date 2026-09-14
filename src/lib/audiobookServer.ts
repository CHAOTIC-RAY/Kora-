import {
  parseAudiobookDetailHtml,
  extractBestBookLinkFromSearch,
  extractFirstBookLinkFromSearch,
  isAudiobookSearchUrl,
  titlesRoughlyMatch,
  type AudiobookDetail,
} from "./audiobookScraper";

const DETAIL_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const SEARCH_CACHE_TTL_MS = 6 * 60 * 60 * 1000;

interface CacheEntry<T> {
  data: T;
  expires: number;
}

const detailCache = new Map<string, CacheEntry<AudiobookDetail>>();
const searchCache = new Map<string, CacheEntry<any[]>>();

function cacheGet<T>(map: Map<string, CacheEntry<T>>, key: string): T | null {
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    map.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet<T>(map: Map<string, CacheEntry<T>>, key: string, data: T, ttlMs: number) {
  map.set(key, { data, expires: Date.now() + ttlMs });
  if (map.size > 500) {
    const oldest = map.keys().next().value;
    if (oldest) map.delete(oldest);
  }
}

export function getCachedAudiobookDetail(key: string): AudiobookDetail | null {
  return cacheGet(detailCache, key);
}

export function setCachedAudiobookDetail(key: string, detail: AudiobookDetail) {
  cacheSet(detailCache, key, detail, DETAIL_CACHE_TTL_MS);
}

export function getCachedAudiobookSearch(q: string): any[] | null {
  return cacheGet(searchCache, q.toLowerCase().trim());
}

export function setCachedAudiobookSearch(q: string, results: any[]) {
  cacheSet(searchCache, q.toLowerCase().trim(), results, SEARCH_CACHE_TTL_MS);
}

export function buildAudiobookProbeUrls(input: {
  link?: string;
  listenUrl?: string;
  listenUrlAlt?: string;
  title?: string;
}): string[] {
  const direct = [input.link, input.listenUrl, input.listenUrlAlt].filter(Boolean) as string[];
  const uniqueDirect = [...new Set(direct)];
  if (uniqueDirect.length > 0) return uniqueDirect;

  return [
    input.title ? `https://fulllengthaudiobooks.com/?s=${encodeURIComponent(input.title)}` : "",
    input.title ? `https://hdaudiobooks.com/?s=${encodeURIComponent(input.title)}` : "",
  ].filter(Boolean) as string[];
}

function isValidDetail(
  detail: AudiobookDetail | null,
  expectedTitle?: string,
  expectedAuthor?: string
): detail is AudiobookDetail {
  if (!detail?.tracks?.length) return false;
  if (!expectedTitle) return true;
  return titlesRoughlyMatch(
    expectedTitle,
    detail.title,
    expectedAuthor || detail.author
  );
}

export async function resolveAudiobookDetailFromPage(
  pageUrl: string,
  fetchHtml: (url: string) => Promise<string>,
  expectedTitle?: string,
  expectedAuthor?: string
): Promise<AudiobookDetail | null> {
  const cacheKey = pageUrl.split("?")[0];
  const cached = getCachedAudiobookDetail(cacheKey);
  if (isValidDetail(cached, expectedTitle)) return cached;

  const html = await fetchHtml(pageUrl);
  let resolvedUrl = pageUrl;
  let detail = parseAudiobookDetailHtml(html, pageUrl);

  if (detail.tracks.length === 0 && isAudiobookSearchUrl(pageUrl)) {
    const baseUrl = new URL(pageUrl).origin;
    // Don't blindly follow the FIRST link on a search page — that's how
    // "Out of the Dawn Light" ends up on a "Clare Alys" page. Use the
    // title-aware extractor, falling back to the first plausible link only
    // when nothing matches the expected book.
    const bookLink =
      expectedTitle
        ? (() => {
            const best = extractBestBookLinkFromSearch(html, baseUrl, expectedTitle);
            if (best) return best;
            // extractBestBookLinkFromSearch already falls back to
            // extractFirstBookLinkFromSearch internally — if it returned null,
            // there is genuinely nothing on the page.
            return null;
          })()
        : extractFirstBookLinkFromSearch(html, baseUrl);
    if (!bookLink) return null;
    const bookHtml = await fetchHtml(bookLink);
    resolvedUrl = bookLink;
    detail = parseAudiobookDetailHtml(bookHtml, bookLink);
  }

  if (!isValidDetail(detail, expectedTitle, expectedAuthor)) return null;

  const result = { ...detail, sourceUrl: resolvedUrl };
  setCachedAudiobookDetail(cacheKey, result);
  if (resolvedUrl !== pageUrl)
    setCachedAudiobookDetail(resolvedUrl.split("?")[0], result);
  return result;
}

/** Probe URLs sequentially — direct detail pages first, search fallbacks last. */
export async function resolveAudiobookDetailParallel(
  urls: string[],
  fetchHtml: (url: string) => Promise<string>,
  expectedTitle?: string,
  expectedAuthor?: string
): Promise<AudiobookDetail | null> {
  const unique = [...new Set(urls.filter(Boolean))];
  if (unique.length === 0) return null;

  // Score each URL: 0 = title match, >0 = no title (search URL), high = presumptively wrong
  const scored = unique.map((u) => ({
    url: u,
    score: expectedTitle && isAudiobookSearchUrl(u) ? 0 : 1,
  }));

  // Search URLs without a title parameter are the most likely to return the wrong book.
  // Sort so exact/title-bearing URLs are tried first; fall back to search URLs only
  // when nothing else resolves.
  scored.sort((a, b) => a.score - b.score);

  for (const { url } of scored) {
    const cacheKey = url.split("?")[0];
    const cached = getCachedAudiobookDetail(cacheKey);
    if (isValidDetail(cached, expectedTitle, expectedAuthor)) return cached;

    try {
      const detail = await resolveAudiobookDetailFromPage(
        url,
        fetchHtml,
        expectedTitle,
        expectedAuthor
      );
      if (isValidDetail(detail, expectedTitle, expectedAuthor)) return detail;
    } catch {
      /* try next URL */
    }
  }

  return null;
}
