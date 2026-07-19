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

/** Site chrome headings / footers that should never appear in the reader body. */
const FOOTER_SECTION_RE =
  /^(topics?|related stories|related articles|related posts|related news|more stories|more news|more from|you may also like|you might also like|recommended|recommended for you|popular|trending|discuss|discussion|comments?|leave a (comment|reply)|join the (conversation|discussion)|sign using|sign in|sign up|log ?in|share this|share article|follow us|newsletter|subscribe|tags?|categories|also read|read more|what to read next|from around the web)$/i;

const LEGAL_OR_META_RE =
  /^(terms of use|terms (of|&) conditions|privacy policy|code of ethics|editorial policy|contact( us)?|cookie policy|about us|advertise|careers?)$/i;

const CHAR_REMAINING_RE = /^\d+\s+characters?\s+remaining$/i;
const BARE_DOMAIN_RE = /^(?:www\.)?[a-z0-9-]+\.(?:com|mv|net|org|io|news|media)$/i;

export function isArticleFooterMarker(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized || normalized.length > 80) return false;
  if (FOOTER_SECTION_RE.test(normalized)) return true;
  if (LEGAL_OR_META_RE.test(normalized)) return true;
  if (CHAR_REMAINING_RE.test(normalized)) return true;
  if (BARE_DOMAIN_RE.test(normalized)) return true;
  return false;
}

/**
 * Cut HTML string at the first footer-section heading / legal chrome.
 * Safe for worker/server string pipelines (no DOM).
 */
export function truncateHtmlAtFooterMarkers(html: string): string {
  if (!html.trim()) return html;

  const headingCut = html.search(
    /<(h[1-6])(?:\s[^>]*)?>\s*(?:Topics?|Related stories|Related articles|Related posts|Related news|More stories|More news|You may also like|Recommended|Discuss|Discussion|Comments?|Leave a (?:comment|reply)|Sign Using|Sign in|Share this|Tags?)\s*<\/\1>/i
  );
  if (headingCut >= 0) return html.slice(0, headingCut).trim();

  const charCut = html.search(
    /<(?:p|div|span|label)(?:\s[^>]*)?>\s*\d+\s+characters?\s+remaining\s*<\/(?:p|div|span|label)>/i
  );
  if (charCut >= 0) return html.slice(0, charCut).trim();

  const legalCut = html.search(
    /<(?:p|div|li|a)(?:\s[^>]*)?>\s*(?:Terms of Use|Privacy Policy|Code of Ethics|Editorial Policy)\s*<\/(?:p|div|li|a)>/i
  );
  if (legalCut >= 0) return html.slice(0, legalCut).trim();

  return html;
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

function elementLooksLikeFooterBlock(el: Element): boolean {
  const text = (el.textContent || "").replace(/\s+/g, " ").trim();
  if (!text) return false;
  const tag = el.tagName.toLowerCase();

  if (["h1", "h2", "h3", "h4", "h5", "h6"].includes(tag) && isArticleFooterMarker(text)) {
    return true;
  }

  if (isArticleFooterMarker(text)) return true;

  // Short link lists that are only legal/nav chrome
  if (["ul", "ol", "nav"].includes(tag)) {
    const links = Array.from(el.querySelectorAll("a"))
      .map((a) => (a.textContent || "").replace(/\s+/g, " ").trim())
      .filter(Boolean);
    if (
      links.length >= 2 &&
      links.length <= 12 &&
      links.every((label) => LEGAL_OR_META_RE.test(label) || isArticleFooterMarker(label))
    ) {
      return true;
    }
  }

  return false;
}

/** Remove Topics / Related / Discuss / legal footer chrome from the end of article HTML. */
function stripTrailingArticleBoilerplate(root: HTMLElement) {
  const visit = (parent: Element): boolean => {
    const kids = Array.from(parent.children);
    for (let i = 0; i < kids.length; i++) {
      const el = kids[i];
      const tag = el.tagName.toLowerCase();

      if (elementLooksLikeFooterBlock(el)) {
        for (let j = kids.length - 1; j >= i; j--) kids[j].remove();
        return true;
      }

      if (["div", "section", "article", "aside", "main", "header", "footer"].includes(tag)) {
        if (visit(el)) {
          for (let j = kids.length - 1; j > i; j--) kids[j].remove();
          if (!(el.textContent || "").trim() && !el.querySelector("img, figure, iframe, video")) {
            el.remove();
          }
          return true;
        }
      }
    }
    return false;
  };

  visit(root);

  // Second pass: drop trailing legal/domain-only nodes left after partial cuts.
  for (;;) {
    const kids = Array.from(root.children);
    const last = kids[kids.length - 1];
    if (!last) break;
    const text = (last.textContent || "").replace(/\s+/g, " ").trim();
    if (
      elementLooksLikeFooterBlock(last) ||
      LEGAL_OR_META_RE.test(text) ||
      BARE_DOMAIN_RE.test(text) ||
      CHAR_REMAINING_RE.test(text)
    ) {
      last.remove();
      continue;
    }
    break;
  }
}

/**
 * Prepare clipped article HTML for the in-app news reader.
 * The reader already renders the title as its own <h1>, so strip matching
 * leading headings / title paragraphs from convert-url output, and cut
 * site footer chrome (Topics, Related, Discuss, legal links, etc.).
 */
export function prepareFeedArticleHtml(html: string, title: string): string {
  if (!html.trim() || typeof DOMParser === "undefined") return html;

  try {
    const truncated = truncateHtmlAtFooterMarkers(html);
    const doc = new DOMParser().parseFromString(truncated, "text/html");
    const body = doc.body;
    if (!body) return truncated;

    body.querySelectorAll("script, style, .author-line").forEach((el) => el.remove());

    // convert-url wraps content in a full document with a top-level <h1>.
    stripLeadingTitleDuplicates(body, title);

    const chapterRoots = body.querySelectorAll(".chapter-content, .chapters-container");
    chapterRoots.forEach((root) => {
      stripLeadingTitleDuplicates(root, title);
      stripTrailingArticleBoilerplate(root as HTMLElement);
    });
    stripTrailingArticleBoilerplate(body);

    return body.innerHTML.trim() || truncated;
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
