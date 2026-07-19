import type { AudiobookDetail } from "./audiobookScraper";
import { titlesRoughlyMatch } from "./audiobookScraper";
import { normalizeMediaUrl } from "./mediaUrl";

const STORAGE_KEY = "kora_audiobook_detail_cache_v3";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

const memoryCache = new Map<string, { detail: AudiobookDetail; expires: number }>();
const inflight = new Map<string, Promise<AudiobookDetail | null>>();

function cacheKeyForBook(book: { title?: string; author?: string; link?: string; listenUrl?: string }): string {
  const parts = [
    (book.title || "").toLowerCase().trim(),
    (book.author || "").toLowerCase().trim(),
    (book.link || book.listenUrl || "").toLowerCase().trim(),
  ].filter(Boolean);
  return parts.join("|") || "unknown";
}

export { cacheKeyForBook };

function loadStorage(): Record<string, { detail: AudiobookDetail; expires: number }> {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveStorage(data: Record<string, { detail: AudiobookDetail; expires: number }>) {
  try {
    const keys = Object.keys(data);
    if (keys.length > 80) {
      keys.sort((a, b) => (data[a].expires || 0) - (data[b].expires || 0));
      keys.slice(0, keys.length - 80).forEach((k) => delete data[k]);
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    /* quota */
  }
}

function normalizeDetailTracks(detail: AudiobookDetail): AudiobookDetail {
  if (!detail.tracks?.length) return detail;
  return {
    ...detail,
    tracks: detail.tracks.map((t) => ({ ...t, src: normalizeMediaUrl(t.src) })),
  };
}

function isValidCachedDetail(book: any, detail: AudiobookDetail | null): detail is AudiobookDetail {
  if (!detail?.tracks?.length) return false;
  if (!book?.title) return true;
  return titlesRoughlyMatch(book.title, detail.title);
}

export function getCachedAudiobookDetailClient(book: any): AudiobookDetail | null {
  const key = cacheKeyForBook(book);
  const mem = memoryCache.get(key);
  if (mem && mem.expires > Date.now() && isValidCachedDetail(book, mem.detail)) return mem.detail;

  const store = loadStorage();
  const entry = store[key];
  if (entry && entry.expires > Date.now() && isValidCachedDetail(book, entry.detail)) {
    memoryCache.set(key, entry);
    return entry.detail;
  }
  return null;
}

export function setCachedAudiobookDetailClient(book: any, detail: AudiobookDetail) {
  const normalized = normalizeDetailTracks(detail);
  if (!isValidCachedDetail(book, normalized)) return;
  const key = cacheKeyForBook(book);
  const entry = { detail: normalized, expires: Date.now() + CACHE_TTL_MS };
  memoryCache.set(key, entry);
  const store = loadStorage();
  store[key] = entry;
  saveStorage(store);
}

export function buildProbeUrls(book: any): string[] {
  const direct = [book.link, book.listenUrl, book.listenUrlAlt].filter(Boolean);
  if (direct.length > 0) return [...new Set(direct)];

  return [
    book.title ? `https://fulllengthaudiobooks.com/?s=${encodeURIComponent(book.title)}` : "",
    book.title ? `https://hdaudiobooks.com/?s=${encodeURIComponent(book.title)}` : "",
  ].filter(Boolean);
}

export async function fetchAudiobookDetail(
  book: any,
  options?: { signal?: AbortSignal; staleWhileRevalidate?: boolean }
): Promise<AudiobookDetail | null> {
  const key = cacheKeyForBook(book);
  const stale = options?.staleWhileRevalidate !== false ? getCachedAudiobookDetailClient(book) : null;

  if (inflight.has(key)) {
    const result = await inflight.get(key)!;
    return isValidCachedDetail(book, result) ? result : stale;
  }

  const urls = buildProbeUrls(book);
  const titleParam = book.title ? `&title=${encodeURIComponent(book.title)}` : "";
  const promise = (async () => {
    try {
      const res = await fetch(
        `/api/audiobooks/detail?urls=${encodeURIComponent(urls.join(","))}${titleParam}`,
        { signal: options?.signal }
      );
      if (!res.ok) return stale && isValidCachedDetail(book, stale) ? stale : null;
      const data = await res.json();
      if (isValidCachedDetail(book, data)) {
        const normalized = normalizeDetailTracks(data as AudiobookDetail);
        setCachedAudiobookDetailClient(book, normalized);
        return normalized;
      }
      return stale && isValidCachedDetail(book, stale) ? stale : null;
    } catch (err: any) {
      if (err?.name === "AbortError") return stale && isValidCachedDetail(book, stale) ? stale : null;
      return stale && isValidCachedDetail(book, stale) ? stale : null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);

  if (stale) {
    promise.then((fresh) => {
      if (fresh && fresh !== stale && isValidCachedDetail(book, fresh)) {
        window.dispatchEvent(new CustomEvent("kora-audiobook-detail-updated", { detail: { key, data: fresh } }));
      }
    });
    return stale;
  }

  return promise;
}

export function prefetchAudiobookDetail(book: any): void {
  if (!book?.link && !book?.listenUrl) return;
  if (getCachedAudiobookDetailClient(book)) return;
  const key = cacheKeyForBook(book);
  if (inflight.has(key)) return;
  fetchAudiobookDetail(book, { staleWhileRevalidate: false }).catch(() => {});
}
