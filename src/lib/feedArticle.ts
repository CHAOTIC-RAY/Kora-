import { CachedFeedArticle, getCachedFeedArticle, setCachedFeedArticle } from "./feedArticleCache";

export async function fetchArticleContent(url: string): Promise<{
  title: string;
  author?: string;
  description?: string;
  htmlContent: string;
}> {
  const response = await fetch("/api/convert-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: url.trim() }),
  });

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}));
    throw new Error(errData.error || `HTTP error ${response.status}`);
  }

  const data = await response.json();
  return {
    title: data.title || "Article",
    author: data.author,
    description: data.description,
    htmlContent: data.htmlContent,
  };
}

export async function loadFeedArticle(itemId: string, url: string): Promise<CachedFeedArticle> {
  const cached = getCachedFeedArticle(itemId);
  if (cached) return cached;

  const data = await fetchArticleContent(url);
  const article: CachedFeedArticle = {
    url,
    title: data.title,
    author: data.author,
    description: data.description,
    htmlContent: data.htmlContent,
    fetchedAt: Date.now(),
  };
  setCachedFeedArticle(itemId, article);
  return article;
}

export async function prefetchFeedArticles(
  items: { id: string; link: string }[],
  limit = 5
): Promise<void> {
  const targets = items.slice(0, limit);
  await Promise.all(
    targets.map(async (item) => {
      if (getCachedFeedArticle(item.id)) return;
      try {
        await loadFeedArticle(item.id, item.link);
      } catch {
        // best-effort background prefetch
      }
    })
  );
}
