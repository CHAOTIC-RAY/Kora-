import { ParsedFeedItem, normalizeFeedArticleLink } from "./rssParser";
import { FeedItem, FeedSubscription } from "./feedStorage";
import { resolveApiUrl } from "./capacitorNative";

export async function discoverFeed(url: string): Promise<{
  title: string;
  siteUrl: string;
  feedUrl: string;
}> {
  const endpoint = resolveApiUrl("/api/feed/discover");
  const response = await fetch(endpoint, {
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
  const endpoint = resolveApiUrl("/api/feed/fetch");
  const response = await fetch(endpoint, {
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
    link: normalizeFeedArticleLink(item.link, subscription.feedUrl),
    summary: item.summary,
    publishedAt: item.publishedAt,
    imageUrl: item.imageUrl,
    category: item.category,
    read: false,
  }));
}

export async function refreshSubscription(subscription: FeedSubscription): Promise<FeedItem[]> {
  // Bound each feed so a single slow/hanging source can't stall the whole refresh.
  const timeout = new Promise<{ title: string; link?: string; items: ParsedFeedItem[] }>((_, reject) =>
    setTimeout(() => reject(new Error("timeout")), 15000)
  );
  const parsed = await Promise.race([fetchFeed(subscription.feedUrl), timeout]);
  return mapParsedItems(subscription, parsed.items);
}

export async function refreshAllSubscriptions(subscriptions: FeedSubscription[]): Promise<FeedItem[]> {
  // Refresh in parallel (was sequential, which let one hanging feed block all others).
  const results = await Promise.allSettled(
    subscriptions.map((sub) => refreshSubscription(sub))
  );
  const batches: FeedItem[] = [];
  results.forEach((res, i) => {
    if (res.status === "fulfilled") {
      batches.push(...res.value);
    } else {
      console.warn(`Feed refresh failed for ${subscriptions[i]?.title}:`, res.reason);
    }
  });
  return batches;
}
