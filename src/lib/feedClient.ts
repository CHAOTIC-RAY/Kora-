import { ParsedFeedItem } from "./rssParser";
import { FeedItem, FeedSubscription } from "./feedStorage";

export async function discoverFeed(url: string): Promise<{
  title: string;
  siteUrl: string;
  feedUrl: string;
}> {
  const response = await fetch("/api/feed/discover", {
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

export async function fetchFeed(feedUrl: string): Promise<{
  title: string;
  link?: string;
  items: ParsedFeedItem[];
}> {
  const response = await fetch("/api/feed/fetch", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feedUrl }),
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
    link: item.link,
    summary: item.summary,
    publishedAt: item.publishedAt,
    imageUrl: item.imageUrl,
    read: false,
  }));
}

export async function refreshSubscription(subscription: FeedSubscription): Promise<FeedItem[]> {
  const parsed = await fetchFeed(subscription.feedUrl);
  return mapParsedItems(subscription, parsed.items);
}

export async function refreshAllSubscriptions(subscriptions: FeedSubscription[]): Promise<FeedItem[]> {
  const batches: FeedItem[] = [];
  for (const subscription of subscriptions) {
    try {
      const items = await refreshSubscription(subscription);
      batches.push(...items);
    } catch (error) {
      console.warn(`Feed refresh failed for ${subscription.title}:`, error);
    }
  }
  return batches;
}
