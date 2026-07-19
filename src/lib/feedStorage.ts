import { dedupeFeedItems, isFeedItemWithinRetention, isRemovedFeedItem } from "./feedNormalize";

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
  category?: string;
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
    feedUrl: "https://maldivesindependent.com/api/rss",
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
  {
    title: "MV Crisis",
    siteUrl: "https://t.me/MvCrisis",
    feedUrl: "kora://telegram/MvCrisis",
  },
];

export const INTERNATIONAL_FEED_OPTIONS: Omit<FeedSubscription, "id" | "addedAt">[] = [
  {
    title: "BBC World",
    siteUrl: "https://www.bbc.com/news/world",
    feedUrl: "https://feeds.bbci.co.uk/news/world/rss.xml",
  },
  {
    title: "The Guardian World",
    siteUrl: "https://www.theguardian.com/world",
    feedUrl: "https://www.theguardian.com/world/rss",
  },
  {
    title: "Reuters World",
    siteUrl: "https://www.reuters.com/world/",
    feedUrl: "https://www.reutersagency.com/feed/?taxonomy=best-topics&post_type=best",
  },
  {
    title: "Al Jazeera",
    siteUrl: "https://www.aljazeera.com/",
    feedUrl: "https://www.aljazeera.com/xml/rss/all.xml",
  },
  {
    title: "NPR News",
    siteUrl: "https://www.npr.org/",
    feedUrl: "https://feeds.npr.org/1001/rss.xml",
  },
  {
    title: "The Verge",
    siteUrl: "https://www.theverge.com/",
    feedUrl: "https://www.theverge.com/rss/index.xml",
  },
];

export const CURATED_FEED_OPTIONS: Omit<FeedSubscription, "id" | "addedAt">[] = [
  ...DEFAULT_FEED_SUBSCRIPTIONS,
  ...INTERNATIONAL_FEED_OPTIONS,
];

export function makeFeedSubscriptionId(feedUrl: string): string {
  return `feed-${feedUrl.replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}`;
}

/** Replace default seeding with an explicit selection of curated feed URLs. */
export function applySelectedFeedSources(feedUrls: string[]): FeedSubscription[] {
  const selected = CURATED_FEED_OPTIONS.filter((option) => feedUrls.includes(option.feedUrl));
  const sources = selected.length ? selected : DEFAULT_FEED_SUBSCRIPTIONS;
  const seeded = sources.map((sub) => ({
    ...sub,
    id: makeFeedSubscriptionId(sub.feedUrl),
    addedAt: Date.now(),
  }));
  saveFeedSubscriptions(seeded);
  localStorage.setItem(FEED_MIGRATION_KEY, "1");
  return seeded;
}

const REMOVED_DEFAULT_FEED_URLS = new Set([
  "https://hnrss.org/frontpage",
  "https://rss.arxiv.org/rss/cs",
  "https://news.ycombinator.com",
  "https://arxiv.org/list/cs/recent",
  "https://feeds.feedburner.com/ycombinator",
]);

const FEED_MIGRATION_KEY = "kora_feed_migration_v7";
const MALDIVES_INDEPENDENT_OLD_FEED = "https://maldivesindependent.com/api/rss/news";
const MALDIVES_INDEPENDENT_FEED = "https://maldivesindependent.com/api/rss";

function isRemovedFeedSubscription(sub: FeedSubscription): boolean {
  if (REMOVED_DEFAULT_FEED_URLS.has(sub.feedUrl)) return true;
  const haystack = `${sub.title} ${sub.feedUrl} ${sub.siteUrl}`.toLowerCase();
  return /hacker\s*news|hnrss|ycombinator|news\.ycombinator|arxiv/i.test(haystack);
}

function migrateMaldivesIndependentFeed(subscriptions: FeedSubscription[]): FeedSubscription[] {
  return subscriptions.map((sub) => {
    if (sub.feedUrl !== MALDIVES_INDEPENDENT_OLD_FEED) return sub;
    return {
      ...sub,
      feedUrl: MALDIVES_INDEPENDENT_FEED,
    };
  });
}

function purgeRemovedFeedData(subscriptions: FeedSubscription[]): FeedSubscription[] {
  const filtered = subscriptions.filter((sub) => !isRemovedFeedSubscription(sub));
  const removedIds = new Set(
    subscriptions.filter((sub) => isRemovedFeedSubscription(sub)).map((sub) => sub.id)
  );
  if (removedIds.size) {
    saveFeedItems(
      dedupeFeedItems(getFeedItems().filter((item) => !removedIds.has(item.subscriptionId)))
    );
  }
  return filtered;
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
  return dedupeFeedItems(readJson<FeedItem[]>(ITEMS_KEY, [])).filter(isFeedItemWithinRetention);
}

export function saveFeedItems(items: FeedItem[]): void {
  const trimmed = dedupeFeedItems(items).slice(0, 500);
  writeJson(ITEMS_KEY, trimmed);
}

export function ensureDefaultSubscriptions(): FeedSubscription[] {
  const raw = purgeRemovedFeedData(getFeedSubscriptions());
  let existing = migrateMaldivesIndependentFeed(raw);

  const subscriptionsChanged =
    existing.length !== raw.length ||
    existing.some((sub, idx) => sub.feedUrl !== raw[idx]?.feedUrl);
  if (subscriptionsChanged) {
    saveFeedSubscriptions(existing);
    saveFeedItems(dedupeFeedItems(readJson<FeedItem[]>(ITEMS_KEY, [])));
  }

  if (!existing.length) {
    const seeded = DEFAULT_FEED_SUBSCRIPTIONS.map((sub) => ({
      ...sub,
      id: makeFeedSubscriptionId(sub.feedUrl),
      addedAt: Date.now(),
    }));
    saveFeedSubscriptions(seeded);
    saveFeedItems(dedupeFeedItems(getFeedItems()));
    localStorage.setItem(FEED_MIGRATION_KEY, "1");
    return seeded;
  }

  if (!localStorage.getItem(FEED_MIGRATION_KEY)) {
    const knownUrls = new Set(existing.map((sub) => sub.feedUrl));
    const additions = DEFAULT_FEED_SUBSCRIPTIONS.filter((sub) => !knownUrls.has(sub.feedUrl)).map((sub) => ({
      ...sub,
      id: makeFeedSubscriptionId(sub.feedUrl),
      addedAt: Date.now(),
    }));
    existing = migrateMaldivesIndependentFeed([...additions, ...existing]).map((sub) =>
      // Force re-fetch for Telegram sources after parser fixes (e.g. MV Crisis).
      /^kora:\/\/telegram\//i.test(sub.feedUrl) ? { ...sub, lastFetchedAt: undefined } : sub
    );
    saveFeedSubscriptions(existing);
    saveFeedItems(dedupeFeedItems(readJson<FeedItem[]>(ITEMS_KEY, [])));
    localStorage.setItem(FEED_MIGRATION_KEY, "1");
    return existing;
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
  const current = readJson<FeedItem[]>(ITEMS_KEY, []);
  const combined = [...current, ...incoming.filter((item) => !isRemovedFeedItem(item))];
  const merged = dedupeFeedItems(combined);
  writeJson(ITEMS_KEY, merged.slice(0, 500));
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
