const CACHE_PREFIX = "kora_feed_article_";
const MAX_AGE_MS = 1000 * 60 * 60 * 6;

export interface CachedFeedArticle {
  url: string;
  title: string;
  author?: string;
  description?: string;
  htmlContent: string;
  fetchedAt: number;
}

function cacheKey(itemId: string): string {
  return `${CACHE_PREFIX}${itemId}`;
}

export function getCachedFeedArticle(itemId: string): CachedFeedArticle | null {
  try {
    const raw = sessionStorage.getItem(cacheKey(itemId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedFeedArticle;
    if (Date.now() - parsed.fetchedAt > MAX_AGE_MS) {
      sessionStorage.removeItem(cacheKey(itemId));
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function setCachedFeedArticle(itemId: string, article: CachedFeedArticle): void {
  try {
    sessionStorage.setItem(cacheKey(itemId), JSON.stringify(article));
  } catch {
    // session storage full — ignore
  }
}
