import type { AudiobookDetail } from "./audiobookScraper";

const STORAGE_KEY = "kora_audiobook_detail_cache_v1";
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

export function getCachedAudiobookDetailClient(book: any): AudiobookDetail | null {
  const key = cacheKeyForBook(book);
  const mem = memoryCache.get(key);
  if (mem && mem.expires > Date.now()) return mem.detail;

  const store = loadStorage();
  const entry = store[key];
  if (entry && entry.expires > Date.now()) {
    memoryCache.set(key, entry);
    return entry.detail;
  }
  return null;
}

export function setCachedAudiobookDetailClient(book: any, detail: AudiobookDetail) {
  const key = cacheKeyForBook(book);
  const entry = { detail, expires: Date.now() + CACHE_TTL_MS };
  memoryCache.set(key, entry);
  const store = loadStorage();
  store[key] = entry;
  saveStorage(store);
}

export function buildProbeUrls(book: any): string[] {
  return [
    book.link,
    book.listenUrl,
    book.listenUrlAlt,
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
    return result || stale;
  }

  const urls = buildProbeUrls(book);
  const promise = (async () => {
    try {
      const res = await fetch(
        `/api/audiobooks/detail?urls=${encodeURIComponent(urls.join(","))}`,
        { signal: options?.signal }
      );
      if (!res.ok) return stale;
      const data = await res.json();
      if (data?.tracks?.length) {
        setCachedAudiobookDetailClient(book, data);
        return data as AudiobookDetail;
      }
      return stale;
    } catch (err: any) {
      if (err?.name === "AbortError") return stale;
      return stale;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, promise);

  if (stale) {
    promise.then((fresh) => {
      if (fresh && fresh !== stale) {
        window.dispatchEvent(new CustomEvent("kora-audiobook-detail-updated", { detail: { key, data: fresh } }));
      }
    });
    return stale;
  }

  return promise;
}

export function prefetchAudiobookDetail(book: any): void {
  if (getCachedAudiobookDetailClient(book)) return;
  const key = cacheKeyForBook(book);
  if (inflight.has(key)) return;
  fetchAudiobookDetail(book, { staleWhileRevalidate: false }).catch(() => {});
}
