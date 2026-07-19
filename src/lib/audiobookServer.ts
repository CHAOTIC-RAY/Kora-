import {
  parseAudiobookDetailHtml,
  extractFirstBookLinkFromSearch,
  isAudiobookSearchUrl,
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
  const urls = [
    input.link,
    input.listenUrl,
    input.listenUrlAlt,
    input.title ? `https://hdaudiobooks.com/?s=${encodeURIComponent(input.title)}` : "",
    input.title ? `https://fulllengthaudiobooks.com/?s=${encodeURIComponent(input.title)}` : "",
  ].filter(Boolean) as string[];
  return [...new Set(urls)];
}

export async function resolveAudiobookDetailFromPage(
  pageUrl: string,
  fetchHtml: (url: string) => Promise<string>
): Promise<AudiobookDetail | null> {
  const cacheKey = pageUrl.split("?")[0];
  const cached = getCachedAudiobookDetail(cacheKey);
  if (cached) return cached;

  const html = await fetchHtml(pageUrl);
  let resolvedUrl = pageUrl;
  let detail = parseAudiobookDetailHtml(html, pageUrl);

  if (detail.tracks.length === 0 && isAudiobookSearchUrl(pageUrl)) {
    const baseUrl = new URL(pageUrl).origin;
    const bookLink = extractFirstBookLinkFromSearch(html, baseUrl);
    if (bookLink) {
      const bookHtml = await fetchHtml(bookLink);
      resolvedUrl = bookLink;
      detail = parseAudiobookDetailHtml(bookHtml, bookLink);
    }
  }

  if (detail.tracks.length === 0) return null;

  const result = { ...detail, sourceUrl: resolvedUrl };
  setCachedAudiobookDetail(cacheKey, result);
  if (resolvedUrl !== pageUrl) setCachedAudiobookDetail(resolvedUrl.split("?")[0], result);
  return result;
}

/** Probe multiple URLs in parallel; returns first successful detail. */
export async function resolveAudiobookDetailParallel(
  urls: string[],
  fetchHtml: (url: string) => Promise<string>
): Promise<AudiobookDetail | null> {
  const unique = [...new Set(urls.filter(Boolean))];
  if (unique.length === 0) return null;

  for (const url of unique) {
    const cached = getCachedAudiobookDetail(url.split("?")[0]);
    if (cached?.tracks?.length) return cached;
  }

  return new Promise((resolve) => {
    let settled = false;
    let pending = unique.length;

    unique.forEach(async (url) => {
      try {
        const detail = await resolveAudiobookDetailFromPage(url, fetchHtml);
        if (!settled && detail?.tracks?.length) {
          settled = true;
          resolve(detail);
        }
      } catch {
        /* try others */
      } finally {
        pending--;
        if (!settled && pending === 0) resolve(null);
      }
    });
  });
}
