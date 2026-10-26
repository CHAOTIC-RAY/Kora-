import { ParsedFeedItem, normalizeFeedArticleLink } from "./rssParser";
import { FeedItem, FeedSubscription } from "./feedStorage";
import { resolveApiUrl } from "./capacitorNative";

export async function discoverFeed(url: string): Promise<{
  title: string;
  siteUrl: string;
  feedUrl: string;
}> {
  const response = await fetch(resolveApiUrl("/api/feed/discover"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url }),
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Could not discover feed (${response.status})`);
  }
  return response.json();
}

export async function fetchFeed(feedUrl: string, signal?: AbortSignal): Promise<{
  title: string;
  link?: string;
  items: ParsedFeedItem[];
}> {
  const response = await fetch(resolveApiUrl("/api/feed/fetch"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feedUrl }),
    signal,
  });
  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error(err.error || `Could not fetch feed (${response.status})`);
  }
  return response.json();
}

export function mapParsedItems(
  subscription: FeedSubscription,
  parsedItems: ParsedFeedItem[]
): FeedItem[] {
  return parsedItems.map((item) => ({
    id: item.id,
    subscriptionId: subscription.id,
    subscriptionTitle: subscription.title,
    title: item.title,
    author: item.author,
    link: normalizeFeedArticleLink(item.link, subscription.feedUrl),
    summary: item.summary,
    publishedAt: item.publishedAt,
    imageUrl: item.imageUrl,
    category: item.category,
    read: false,
  }));
}

export async function refreshSubscription(subscription: FeedSubscription): Promise<FeedItem[]> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error("Feed request timed out")), 18_000);
  try {
    const parsed = await fetchFeed(subscription.feedUrl, controller.signal);
    return mapParsedItems(subscription, parsed.items);
  } finally {
    clearTimeout(timeout);
  }
}

export async function refreshAllSubscriptions(subscriptions: FeedSubscription[]): Promise<FeedItem[]> {
  const batches: FeedItem[] = [];
  const concurrency = Math.min(4, subscriptions.length);
  let cursor = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    while (cursor < subscriptions.length) {
      const index = cursor++;
      const subscription = subscriptions[index];
      try {
        const items = await refreshSubscription(subscription);
        batches.push(...items);
      } catch (error) {
        console.warn(`Feed refresh failed for ${subscription.title}:`, error);
      }
    }
  });
  await Promise.all(workers);
  return batches;
}
