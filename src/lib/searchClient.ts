const SEARCH_CACHE_KEY = "kora_search_cache_v1";
const CACHE_TTL_MS = 30 * 60 * 1000;
const MAX_CACHE_ENTRIES = 50;

interface SearchCacheEntry {
  results: any[];
  expires: number;
  type: "audiobook" | "ebook";
}

let searchAbortController: AbortController | null = null;
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

export function setCachedSearch(query: string, type: "audiobook" | "ebook", results: any[]) {
  const key = `${type}:${query.toLowerCase().trim()}`;
  const store = loadCache();
  store[key] = { results, expires: Date.now() + CACHE_TTL_MS, type };
  saveCache(store);
}

export function abortActiveSearch() {
  searchAbortController?.abort();
  searchAbortController = null;
}

export function createSearchSignal(): AbortSignal {
  abortActiveSearch();
  searchAbortController = new AbortController();
  return searchAbortController.signal;
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
    const res = await fetch(`/api/audiobooks/search?q=${encodeURIComponent(query)}`, { signal });
    const data = await res.json();
    const results = Array.isArray(data) ? data : [];
    onChunk("fallback", results);
    all.push(...results);
  }

  setCachedSearch(query, "audiobook", all);
  return all;
}

export async function streamEbookSearch(
  query: string,
  onSource: (source: string, books: any[]) => void,
  signal?: AbortSignal
): Promise<{ books: any[]; totalCount: number; hasMore: boolean }> {
  const cached = getCachedSearch(query, "ebook");
  if (cached?.length) {
    onSource("cache", cached);
    return { books: cached, totalCount: cached.length, hasMore: false };
  }

  const all: any[] = [];
  try {
    const res = await fetch(`/api/search/stream?q=${encodeURIComponent(query)}&page=1`, { signal });
    if (!res.ok || !res.body) throw new Error("Stream failed");

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let totalCount = 0;
    let hasMore = false;

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
          if (chunk.done) {
            totalCount = chunk.totalCount ?? all.length;
            hasMore = !!chunk.hasMore;
            continue;
          }
          const books = chunk.books || [];
          if (books.length) {
            all.push(...books);
            onSource(chunk.source || "unknown", books);
          }
        } catch {
          /* skip */
        }
      }
    }

    setCachedSearch(query, "ebook", all);
    return { books: all, totalCount: totalCount || all.length, hasMore };
  } catch {
    return { books: all, totalCount: all.length, hasMore: false };
  }
}
