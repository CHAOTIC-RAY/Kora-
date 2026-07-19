export interface FeedSubscription {
  id: string;
  title: string;
  siteUrl: string;
  feedUrl: string;
  favicon?: string;
  folder?: string;
  addedAt: number;
  lastFetchedAt?: number;
}

export interface FeedItem {
  id: string;
  subscriptionId: string;
  subscriptionTitle: string;
  title: string;
  author?: string;
  link: string;
  summary?: string;
  publishedAt: number;
  imageUrl?: string;
  read: boolean;
  savedBookId?: string;
  clippedAt?: number;
}

const SUBSCRIPTIONS_KEY = "kora_feed_subscriptions";
const ITEMS_KEY = "kora_feed_items";

export const DEFAULT_FEED_SUBSCRIPTIONS: Omit<FeedSubscription, "id" | "addedAt">[] = [
  {
    title: "Hacker News",
    siteUrl: "https://news.ycombinator.com",
    feedUrl: "https://hnrss.org/frontpage",
  },
  {
    title: "ArXiv CS",
    siteUrl: "https://arxiv.org/list/cs/recent",
    feedUrl: "https://rss.arxiv.org/rss/cs",
  },
  {
    title: "The Verge",
    siteUrl: "https://www.theverge.com",
    feedUrl: "https://www.theverge.com/rss/index.xml",
  },
];

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson<T>(key: string, value: T): void {
  localStorage.setItem(key, JSON.stringify(value));
}

export function getFeedSubscriptions(): FeedSubscription[] {
  return readJson<FeedSubscription[]>(SUBSCRIPTIONS_KEY, []);
}

export function saveFeedSubscriptions(subscriptions: FeedSubscription[]): void {
  writeJson(SUBSCRIPTIONS_KEY, subscriptions);
}

export function getFeedItems(): FeedItem[] {
  return readJson<FeedItem[]>(ITEMS_KEY, []);
}

export function saveFeedItems(items: FeedItem[]): void {
  const trimmed = items.sort((a, b) => b.publishedAt - a.publishedAt).slice(0, 500);
  writeJson(ITEMS_KEY, trimmed);
}

export function ensureDefaultSubscriptions(): FeedSubscription[] {
  const existing = getFeedSubscriptions();
  if (existing.length) return existing;

  const seeded = DEFAULT_FEED_SUBSCRIPTIONS.map((sub) => ({
    ...sub,
    id: `feed-${sub.feedUrl.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}`,
    addedAt: Date.now(),
  }));
  saveFeedSubscriptions(seeded);
  return seeded;
}

export function addFeedSubscription(sub: Omit<FeedSubscription, "id" | "addedAt">): FeedSubscription {
  const subscriptions = getFeedSubscriptions();
  const duplicate = subscriptions.find((entry) => entry.feedUrl === sub.feedUrl);
  if (duplicate) return duplicate;

  const entry: FeedSubscription = {
    ...sub,
    id: `feed-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    addedAt: Date.now(),
  };
  saveFeedSubscriptions([entry, ...subscriptions]);
  return entry;
}

export function removeFeedSubscription(subscriptionId: string): void {
  saveFeedSubscriptions(getFeedSubscriptions().filter((sub) => sub.id !== subscriptionId));
  saveFeedItems(getFeedItems().filter((item) => item.subscriptionId !== subscriptionId));
}

export function mergeFeedItems(incoming: FeedItem[]): FeedItem[] {
  const current = getFeedItems();
  const map = new Map(current.map((item) => [item.id, item]));

  for (const item of incoming) {
    const existing = map.get(item.id);
    map.set(item.id, {
      ...item,
      read: existing?.read ?? item.read,
      savedBookId: existing?.savedBookId,
      clippedAt: existing?.clippedAt,
    });
  }

  const merged = Array.from(map.values()).sort((a, b) => b.publishedAt - a.publishedAt);
  saveFeedItems(merged);
  return merged;
}

export function markFeedItemRead(itemId: string, read = true): void {
  const items = getFeedItems().map((item) => (item.id === itemId ? { ...item, read } : item));
  saveFeedItems(items);
}

export function markFeedItemSaved(itemId: string, bookId: string): void {
  const items = getFeedItems().map((item) =>
    item.id === itemId ? { ...item, savedBookId: bookId, read: true, clippedAt: Date.now() } : item
  );
  saveFeedItems(items);
}

export function getUnreadFeedCount(): number {
  return getFeedItems().filter((item) => !item.read).length;
}
