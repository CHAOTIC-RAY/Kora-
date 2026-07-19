import { CachedFeedArticle, getCachedFeedArticle, setCachedFeedArticle } from "./feedArticleCache";

function normalizeHeadingText(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function titlesMatch(a: string, b: string): boolean {
  const left = normalizeHeadingText(a);
  const right = normalizeHeadingText(b);
  if (!left || !right) return false;
  if (left === right) return true;
  const shorter = left.length <= right.length ? left : right;
  const longer = left.length <= right.length ? right : left;
  // Near-identical titles (trailing site name, punctuation, etc.)
  if (shorter.length >= 16 && longer.startsWith(shorter)) return true;
  if (shorter.length >= 24 && longer.includes(shorter) && longer.length - shorter.length < 40) {
    return true;
  }
  return false;
}

function stripLeadingEmpty(parent: ParentNode) {
  while (parent.firstChild) {
    const node = parent.firstChild;
    if (node.nodeType === Node.TEXT_NODE && !(node.textContent || "").trim()) {
      parent.removeChild(node);
      continue;
    }
    if (node.nodeType === Node.COMMENT_NODE) {
      parent.removeChild(node);
      continue;
    }
    break;
  }
}

function stripLeadingTitleDuplicates(parent: ParentNode, title: string) {
  for (;;) {
    stripLeadingEmpty(parent);
    const el = parent.firstElementChild as HTMLElement | null;
    if (!el) return;

    const tag = el.tagName.toLowerCase();
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();

    if (["h1", "h2", "h3", "h4"].includes(tag) && titlesMatch(text, title)) {
      el.remove();
      continue;
    }

    // Telegram / summary posts often repeat the title as the first paragraph.
    if (tag === "p" && titlesMatch(text, title)) {
      el.remove();
      continue;
    }

    if (["div", "section", "article", "header", "main"].includes(tag)) {
      if (titlesMatch(text, title)) {
        el.remove();
        continue;
      }
      stripLeadingTitleDuplicates(el, title);
      if (!(el.textContent || "").trim() && !el.querySelector("img, figure, iframe, video, svg")) {
        el.remove();
        continue;
      }
    }

    return;
  }
}

/**
 * Prepare clipped article HTML for the in-app news reader.
 * The reader already renders the title as its own <h1>, so strip matching
 * leading headings / title paragraphs from convert-url output.
 */
export function prepareFeedArticleHtml(html: string, title: string): string {
  if (!html.trim() || typeof DOMParser === "undefined") return html;

  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const body = doc.body;
    if (!body) return html;

    body.querySelectorAll("script, style, .author-line").forEach((el) => el.remove());

    // convert-url wraps content in a full document with a top-level <h1>.
    stripLeadingTitleDuplicates(body, title);

    const chapterRoots = body.querySelectorAll(".chapter-content, .chapters-container");
    chapterRoots.forEach((root) => stripLeadingTitleDuplicates(root, title));

    return body.innerHTML.trim() || html;
  } catch {
    return html;
  }
}

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
