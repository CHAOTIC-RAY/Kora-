import { FeedItem } from "./feedStorage";

export const FEED_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

export function isFeedItemWithinRetention(item: Pick<FeedItem, "publishedAt">): boolean {
  return Date.now() - item.publishedAt <= FEED_MAX_AGE_MS;
}

export function canonicalFeedItemId(link: string): string {
  try {
    const url = new URL(link.trim());
    const path = url.pathname.replace(/\/$/, "") || "/";
    return `${url.origin}${path}`.toLowerCase();
  } catch {
    return link.trim().toLowerCase();
  }
}

export function isRemovedFeedItem(item: Pick<FeedItem, "title" | "link" | "subscriptionTitle">): boolean {
  const haystack = `${item.subscriptionTitle} ${item.link} ${item.title}`.toLowerCase();
  return /hacker\s*news|hnrss|ycombinator|news\.ycombinator\.com|arxiv/i.test(haystack);
}

function hasMeaningfulTitle(title?: string): boolean {
  const trimmed = title?.trim() || "";
  return Boolean(trimmed) && !/^(article url|comments url|link|untitled)$/i.test(trimmed);
}

function feedItemScore(item: FeedItem): number {
  let score = 0;
  if (hasMeaningfulTitle(item.title)) score += 20;
  if (item.summary?.trim()) score += 8;
  if (item.imageUrl?.trim()) score += 6;
  if (item.author?.trim()) score += 2;
  score += Math.min(5, Math.floor(item.publishedAt / 1_000_000_000_000));
  return score;
}

export function normalizeFeedItem(item: FeedItem): FeedItem {
  const id = canonicalFeedItemId(item.link);
  return {
    ...item,
    id,
    title: item.title?.trim() || "",
    summary: item.summary?.trim() || undefined,
    imageUrl: item.imageUrl?.trim() || undefined,
  };
}

export function dedupeFeedItems(items: FeedItem[]): FeedItem[] {
  const map = new Map<string, FeedItem>();

  for (const raw of items) {
    if (isRemovedFeedItem(raw)) continue;
    const item = normalizeFeedItem(raw);
    if (!item.link) continue;

    const existing = map.get(item.id);
    if (!existing) {
      map.set(item.id, item);
      continue;
    }

    const preferred = feedItemScore(item) >= feedItemScore(existing) ? item : existing;
    const fallback = preferred === item ? existing : item;
    map.set(item.id, {
      ...preferred,
      read: existing.read || item.read,
      savedBookId: existing.savedBookId || item.savedBookId,
      clippedAt: existing.clippedAt || item.clippedAt,
      title: hasMeaningfulTitle(preferred.title) ? preferred.title : fallback.title,
      summary: preferred.summary || fallback.summary,
      imageUrl: preferred.imageUrl || fallback.imageUrl,
      author: preferred.author || fallback.author,
      category: preferred.category || fallback.category,
      publishedAt: Math.max(preferred.publishedAt, fallback.publishedAt),
    });
  }

  return Array.from(map.values())
    .filter((item) => hasMeaningfulTitle(item.title))
    .filter(isFeedItemWithinRetention)
    .sort((a, b) => b.publishedAt - a.publishedAt);
}
