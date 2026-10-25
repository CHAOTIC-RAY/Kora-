// v3 switches ebook results from Google Books-first catalog records to
// source-native editions, so prior result entries must not mask that search.
const SEARCH_CACHE_KEY = "kora_search_cache_v4";
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;

import { resolveApiUrl } from "./capacitorNative";

type SearchChannel = "audiobook" | "ebook";

interface SearchCacheEntry {
  results: any[];
  expires: number;
  type: SearchChannel;
  totalCount?: number;
  hasMore?: boolean;
}

const searchAbortControllers: Partial<Record<SearchChannel, AbortController>> = {};
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function loadCache(): Record<string, SearchCacheEntry> {
  try {
    return JSON.parse(localStorage.getItem(SEARCH_CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}

function saveCache(data: Record<string, SearchCacheEntry>) {
  try {
    const keys = Object.keys(data);
    if (keys.length > MAX_CACHE_ENTRIES) {
      keys.sort((a, b) => data[a].expires - data[b].expires);
      keys.slice(0, keys.length - MAX_CACHE_ENTRIES).forEach((k) => delete data[k]);
    }
    localStorage.setItem(SEARCH_CACHE_KEY, JSON.stringify(data));
  } catch {
    /* quota */
  }
}

export function getCachedSearch(query: string, type: "audiobook" | "ebook"): any[] | null {
  const key = `${type}:${query.toLowerCase().trim()}`;
  const store = loadCache();
  const entry = store[key];
  if (entry && entry.expires > Date.now()) return entry.results;
  return null;
}

export function getCachedSearchMeta(
  query: string,
  type: SearchChannel
): { totalCount?: number; hasMore?: boolean } | null {
  const key = `${type}:${query.toLowerCase().trim()}`;
  const entry = loadCache()[key];
  if (!entry || entry.expires <= Date.now()) return null;
  return { totalCount: entry.totalCount, hasMore: entry.hasMore };
}

export function setCachedSearch(
  query: string,
  type: SearchChannel,
  results: any[],
  meta?: { totalCount?: number; hasMore?: boolean }
) {
  const key = `${type}:${query.toLowerCase().trim()}`;
  const store = loadCache();
  store[key] = { results, expires: Date.now() + CACHE_TTL_MS, type, ...meta };
  saveCache(store);
}

export function abortActiveSearch(channel?: SearchChannel) {
  const channels = channel ? [channel] : (["audiobook", "ebook"] as SearchChannel[]);
  for (const key of channels) {
    searchAbortControllers[key]?.abort();
    delete searchAbortControllers[key];
  }
}

export function createSearchSignal(channel: SearchChannel = "ebook"): AbortSignal {
  abortActiveSearch(channel);
  const controller = new AbortController();
  searchAbortControllers[channel] = controller;
  controller.signal.addEventListener("abort", () => {
    if (searchAbortControllers[channel] === controller) delete searchAbortControllers[channel];
  }, { once: true });
  return controller.signal;
}

export function debouncedSearch(fn: () => void, delayMs = 300) {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(fn, delayMs);
}

export async function streamAudiobookSearch(
  query: string,
  onChunk: (source: string, results: any[]) => void,
  signal?: AbortSignal
): Promise<any[]> {
  const cached = getCachedSearch(query, "audiobook");
  if (cached) {
    onChunk("cache", cached);
    return cached;
  }

  const all: any[] = [];
  const seen = new Set<string>();

  try {
    const res = await fetch(`/api/audiobooks/search/stream?q=${encodeURIComponent(query)}`, { signal });
    if (!res.ok || !res.body) throw new Error("Stream failed");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const chunk = JSON.parse(line);
          if (chunk.done) continue;
          const batch = (chunk.results || []).filter((r: any) => {
            if (seen.has(r.link)) return false;
            seen.add(r.link);
            return true;
          });
          if (batch.length) {
            all.push(...batch);
            onChunk(chunk.source || "unknown", batch);
          }
        } catch {
          /* skip bad line */
        }
      }
    }
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    // Graceful fallback to the non-streaming endpoint.
    try {
      const res = await fetch(`/api/audiobooks/search?q=${encodeURIComponent(query)}`, { signal });
      const text = await res.text();
      const data = text ? JSON.parse(text) : [];
      const results = Array.isArray(data) ? data : [];
      onChunk("fallback", results);
      all.push(...results);
    } catch {
      /* both stream and fallback failed — return whatever we have */
    }
  }

  setCachedSearch(query, "audiobook", all);
  return all;
}

export async function streamEbookSearch(
  query: string,
  onSource: (source: string, books: any[]) => void,
  signal?: AbortSignal,
  page = 1
): Promise<{ books: any[]; totalCount: number; hasMore: boolean }> {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.floor(page)) : 1;
  if (safePage === 1) {
    const cached = getCachedSearch(query, "ebook");
    if (cached?.length) {
      const meta = getCachedSearchMeta(query, "ebook");
      onSource("cache", cached);
      return { books: cached, totalCount: meta?.totalCount ?? cached.length, hasMore: meta?.hasMore ?? false };
    }
  }
  const all: any[] = [];
  let totalCount = 0;
  let hasMore = false;
  const consumeChunk = (chunk: any) => {
    if (chunk?.done) {
      totalCount = Number(chunk.totalCount) || all.length;
      hasMore = Boolean(chunk.hasMore);
      return;
    }
    const books = Array.isArray(chunk?.books) ? chunk.books : [];
    if (books.length) {
      all.push(...books);
      onSource(chunk.source || "unknown", books);
    }
  };
  try {
    const endpoint = `/api/search/stream?q=${encodeURIComponent(query)}&page=${safePage}`;
    const res = await fetch(resolveApiUrl(endpoint), { signal });
    if (!res.ok || !res.body) throw new Error(`Stream failed (${res.status})`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        try { consumeChunk(JSON.parse(line)); } catch { /* Ignore malformed stream chunks. */ }
      }
    }
    if (buffer.trim()) {
      try { consumeChunk(JSON.parse(buffer)); } catch { /* Ignore a truncated final line. */ }
    }
    totalCount = totalCount || all.length;
    if (safePage === 1) setCachedSearch(query, "ebook", all, { totalCount, hasMore });
    return { books: all, totalCount, hasMore };
  } catch (err: any) {
    if (err?.name === "AbortError") throw err;
    return { books: all, totalCount: totalCount || all.length, hasMore: false };
  }
}
