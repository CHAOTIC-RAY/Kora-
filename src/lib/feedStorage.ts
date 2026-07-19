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
    title: "Maldives Independent",
    siteUrl: "https://maldivesindependent.com",
    feedUrl: "https://maldivesindependent.com/api/rss/news",
  },
  {
    title: "PSM News",
    siteUrl: "https://psmnews.mv/en/",
    feedUrl: "https://psmnews.mv/en/feed/",
  },
  {
    title: "Edition",
    siteUrl: "https://edition.mv/",
    feedUrl: "kora://edition.mv/latest",
  },
  {
    title: "Mihaaru",
    siteUrl: "https://mihaaru.com/",
    feedUrl: "kora://mihaaru.com/latest",
  },
];

const REMOVED_DEFAULT_FEED_URLS = new Set([
  "https://hnrss.org/frontpage",
  "https://rss.arxiv.org/rss/cs",
  "https://news.ycombinator.com",
  "https://arxiv.org/list/cs/recent",
  "https://feeds.feedburner.com/ycombinator",
]);

const FEED_MIGRATION_KEY = "kora_feed_migration_v3";

function isRemovedFeedSubscription(sub: FeedSubscription): boolean {
  if (REMOVED_DEFAULT_FEED_URLS.has(sub.feedUrl)) return true;
  const haystack = `${sub.title} ${sub.feedUrl} ${sub.siteUrl}`.toLowerCase();
  return /hacker\s*news|hnrss|ycombinator|arxiv/i.test(haystack);
}

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
  if (!existing.length) {
    const seeded = DEFAULT_FEED_SUBSCRIPTIONS.map((sub) => ({
      ...sub,
      id: `feed-${sub.feedUrl.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}`,
      addedAt: Date.now(),
    }));
    saveFeedSubscriptions(seeded);
    localStorage.setItem(FEED_MIGRATION_KEY, "1");
    return seeded;
  }

  if (!localStorage.getItem(FEED_MIGRATION_KEY)) {
    const filtered = existing.filter((sub) => !isRemovedFeedSubscription(sub));
    const removedIds = new Set(
      existing.filter((sub) => isRemovedFeedSubscription(sub)).map((sub) => sub.id)
    );
    if (removedIds.size) {
      saveFeedItems(getFeedItems().filter((item) => !removedIds.has(item.subscriptionId)));
    }
    const knownUrls = new Set(filtered.map((sub) => sub.feedUrl));
    const additions = DEFAULT_FEED_SUBSCRIPTIONS.filter((sub) => !knownUrls.has(sub.feedUrl)).map((sub) => ({
      ...sub,
      id: `feed-${sub.feedUrl.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}`,
      addedAt: Date.now(),
    }));
    const migrated = [...additions, ...filtered];
    saveFeedSubscriptions(migrated);
    localStorage.setItem(FEED_MIGRATION_KEY, "1");
    return migrated;
  }

  return existing;
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
