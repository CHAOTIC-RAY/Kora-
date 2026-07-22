import { resolveApiUrl } from "./capacitorNative";
import { FeedItem, getFeedItems, saveFeedItems } from "./feedStorage";
import { dedupeFeedItems } from "./feedNormalize";

export interface FeedArticlePreview {
  title?: string;
  description?: string;
  imageUrl?: string;
  author?: string;
  siteName?: string;
}

const PREVIEW_PREFIX = "kora_feed_preview_";
const PREVIEW_MAX_AGE_MS = 1000 * 60 * 60 * 6;

function previewKey(itemId: string): string {
  return `${PREVIEW_PREFIX}${itemId}`;
}

function getCachedPreview(itemId: string): FeedArticlePreview | null {
  try {
    const raw = sessionStorage.getItem(previewKey(itemId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as FeedArticlePreview & { fetchedAt: number };
    if (Date.now() - parsed.fetchedAt > PREVIEW_MAX_AGE_MS) {
      sessionStorage.removeItem(previewKey(itemId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function setCachedPreview(itemId: string, preview: FeedArticlePreview): void {
  try {
    sessionStorage.setItem(previewKey(itemId), JSON.stringify({ ...preview, fetchedAt: Date.now() }));
  } catch {
    // session storage full — ignore
  }
}

export async function fetchFeedPreview(url: string): Promise<FeedArticlePreview> {
  const response = await fetch("/api/feed/preview", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url.trim() }),
  });

  if (!response.ok) {
    throw new Error(`Preview failed (${response.status})`);
  }

  return response.json();
}

export function markFeedImageBroken(itemId: string): void {
  try {
    const items = getFeedItems();
    const next = items.map((item) =>
      item.id === itemId ? { ...item, imageUrl: undefined } : item
    );
    if (next.some((item, i) => item.imageUrl !== items[i]?.imageUrl)) {
      saveFeedItems(dedupeFeedItems(next));
    }
  } catch {
    /* ignore */
  }
}

export function resolveFeedImageSrc(url: string | undefined | null): string | null {
  if (!url?.trim()) return null;
  let trimmed = url.trim();
  if (trimmed.startsWith("http://")) {
    trimmed = `https://${trimmed.slice(7)}`;
  }
  if (trimmed.startsWith("data:")) return trimmed;
  // Absolute API / static paths must resolve to the Worker on Capacitor —
  // <img src> bypasses the fetch shim.
  if (trimmed.startsWith("/")) return resolveApiUrl(trimmed);
  if (trimmed.includes("google.com/s2/favicons")) return null;
  return resolveApiUrl(`/api/feed/image?url=${encodeURIComponent(trimmed)}`);
}

export function getFaviconUrl(link: string): string | null {
  try {
    const host = new URL(link).hostname;
    return `https://www.google.com/s2/favicons?domain=${host}&sz=128`;
  } catch {
    return null;
  }
}

export function getItemThumbnail(item: FeedItem): string | null {
  if (item.imageUrl) {
    const resolved = resolveFeedImageSrc(item.imageUrl);
    if (resolved) return resolved;
  }
  return null;
}

function needsPreview(item: FeedItem): boolean {
  const badTitle = /^(article url|comments url|link)$/i.test(item.title.trim());
  const badSummary = !item.summary || /^(article url|comments url)/i.test(item.summary);
  return !item.imageUrl || badTitle || badSummary;
}

export function applyPreviewToItem(item: FeedItem, preview: FeedArticlePreview): FeedItem {
  const badTitle = /^(article url|comments url|link)$/i.test(item.title.trim());
  const badSummary = !item.summary || /^(article url|comments url)/i.test(item.summary);

  return {
    ...item,
    title: badTitle && preview.title ? preview.title : item.title,
    summary: badSummary && preview.description ? preview.description : item.summary,
    imageUrl: item.imageUrl || preview.imageUrl,
    author: item.author || preview.author,
  };
}

export function updateFeedItemFromPreview(itemId: string, preview: FeedArticlePreview): FeedItem[] {
  const items = getFeedItems().map((item) => {
    if (item.id !== itemId) return item;
    return applyPreviewToItem(item, preview);
  });
  const merged = dedupeFeedItems(items);
  saveFeedItems(merged);
  return merged;
}

export async function prefetchFeedPreviews(items: FeedItem[], limit = 16): Promise<FeedItem[]> {
  const targets = items.filter(needsPreview).slice(0, limit);
  if (!targets.length) return getFeedItems();

  const byId = new Map<string, FeedArticlePreview>();

  // Cap concurrency to avoid hammering the preview API + main thread.
  const CONCURRENCY = 3;
  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const index = cursor++;
      const item = targets[index];
      const cached = getCachedPreview(item.id);
      if (cached) {
        byId.set(item.id, cached);
        continue;
      }
      try {
        const preview = await fetchFeedPreview(item.link);
        setCachedPreview(item.id, preview);
        byId.set(item.id, preview);
      } catch {
        // best-effort background prefetch
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, targets.length) }, () => worker()));

  if (!byId.size) return getFeedItems();

  const merged = dedupeFeedItems(
    getFeedItems().map((item) => {
      const preview = byId.get(item.id);
      return preview ? applyPreviewToItem(item, preview) : item;
    })
  );
  saveFeedItems(merged);
  return merged;
}
