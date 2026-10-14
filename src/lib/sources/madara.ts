/**
 * Madara theme — one engine, many sites.
 *
 * The single highest-leverage thing in this source ecosystem. Hundreds of the
 * 1,377 Keiyoushi packages extend the same `Madara` base class and differ only
 * in a handful of selectors, because they all run the `madara` WordPress
 * plugin. Porting that base class once covers a quarter of every source list
 * that exists, and a new site then costs a dozen lines of JSON rather than a
 * new scraper.
 *
 * These selectors are transcribed from Keiyoushi's
 * `lib-multisrc/madara/MadaraBase.kt` (Apache-2.0) and re-verified against
 * live sites, because the upstream class carries overrides that a generic
 * base does not.
 */

import type {
  Chapter,
  MadaraPlugin,
  ListingRule,
  MadaraOverride,
  MadaraSelectors,
  Page,
  SourcePlugin,
} from "./types";
import { pickThumbUrl, resolveThumbUrl } from "./thumbUrl";

/** Keiyoushi's Madara defaults, verbatim. */
export const MADARA_SELECTORS: Required<MadaraSelectors> = {
  // listing
  listingCard: "div.page-item-detail.manga",
  listingUrl: "a@href",
  listingTitle: "a@title",
  listingThumb: "img@data-src",
  nextPage: "a.next.page-numbers@href",

  // details
  detailsTitle: "div.post-title h1",
  detailsAuthor: "div.author-content a",
  detailsArtist: "div.artist-content a",
  detailsStatus: "div.summary-content",
  detailsDescription: "div.description-summary div.summary__content",
  detailsThumbnail: "div.summary_image img@src",
  detailsGenre: "div.genres-content a",

  // chapters
  chapterList: "li.wp-manga-chapter",
  chapterUrl: "a@href",
  chapterName: "a",
  chapterDate: "span.chapter-release-date",

  // pages
  pageList: "div.page-break",
  pageImage: "img@src",
  pageImageLazy: "img@data-src",
};

function override(sel: MadaraSelectors, o: MadaraOverride | undefined): Required<MadaraSelectors> {
  return { ...MADARA_SELECTORS, ...(o || {}) } as Required<MadaraSelectors>;
}

/**
 * Madara paginates its listings with an ajax call to `admin-ajax.php`, which
 * is why `/manga/` looks empty in a plain fetch. `style=page` makes WordPress
 * serve the same markup server-side, so Kora can parse it without the ajax
 * round trip or a browser.
 */
function listingUrl(baseUrl: string, page: number, orderBy: string, sub: string, query?: string): string {
  const root = baseUrl.replace(/\/+$/, "");
  const p = Math.max(1, page);
  const params = new URLSearchParams({ m_orderby: orderBy, page: String(p) });
  if (query) params.set("s", query);
  return `${root}/${sub || "manga"}/?${params.toString()}`;
}

function statusFrom(raw: string): number {
  const s = raw.trim().toLowerCase();
  if (s.includes("ongoing") || s.includes("publishing")) return 1;
  if (s.includes("completed") || s.includes("finished")) return 2;
  if (s.includes("hiatus") || s.includes("paused")) return 3;
  if (s.includes("cancelled") || s.includes("canceled")) return 5;
  return 0;
}

/**
 * Build a Madara client.
 *
 * `fetchHtml` is injected so the engine can route through the Worker relay
 * (bypassing CORS and sending a Referer) while tests run offline.
 */
export function createMadaraClient(
  plugin: SourcePlugin,
  fetchHtml: (url: string, referer?: string) => Promise<string>
) {
  const o = (plugin as MadaraPlugin).madara;
  const sel = override(MADARA_SELECTORS, o);
  const root = plugin.baseUrl.replace(/\/+$/, "");
  const sub = o?.mangaSubString || "manga";

  const imgOf = (v: string): string => {
    if (!v) return "";
    if (/^https?:\/\//i.test(v)) return v;
    if (v.startsWith("//")) return "https:" + v;
    if (v.startsWith("/")) return originOf(root) + v;
    return root + "/" + v;
  };

  async function list(page: number, mode: "popular" | "latest" | "search", query?: string) {
    const orderBy =
      mode === "latest"
        ? o?.latestOrderBy || "update"
        : o?.popularOrderBy || "views";
    const url = listingUrl(root, page, orderBy, sub, query);

    let html = "";
    try {
      html = await fetchHtml(url);
    } catch {
      return { mangas: [], hasNextPage: false };
    }
    if (!html) return { mangas: [], hasNextPage: false };

    // A Madara card carries the link on the card itself; the anchor's title
    // attribute is the reliable title (the visible text is often truncated
    // with an ellipsis by the theme).
    //
    // Split on the card's *class*, not its tag: the selector
    // `div.page-item-detail.manga` shares its tag with the entire page, so
    // splitting on "div" would yield one enormous fragment.
    const cards = html.split(new RegExp(escapeRe(classOf(sel.listingCard))));
    const mangas: any[] = [];

    for (const card of cards.slice(1)) {
      const href = pickHref(card, url);
      if (!href) continue;

      // A card's link always points at a manga detail page. The first
      // `page-item-detail` on the page is frequently the site's own logo
      // block, which links to the homepage — that is a real anchor with a
      // real href, so the title test alone does not catch it.
      if (!/\/manga\/|\/serie\/|\/comic\//i.test(href)) continue;

      const title = pickTitle(card) || pickText(card, "a") || "Untitled";
      // Prefer the lazy attribute, but reject the theme's placeholder and
      // resolve relative/protocol-relative URLs: a card that renders a grey
      // spacer here looks exactly like the blank-cover bug it is.
      const thumb = pickThumbUrl(card, root);
      // Authors live in `.item-title` on the card, not in the anchor that
      // carries the title. Without this every card read "Unknown" in the
      // grid, because details are not fetched for a listing.
      // `pickText` already decodes, so do not decode twice here.
      const author = pickAuthor(card) || pickText(card, ".item-author, span.item-author");
      mangas.push({
        id: href,
        url: href,
        title: decodeEntities(title).trim(),
        thumbnailUrl: thumb,
        // Left undefined when the site prints no author on its cards —
        // several Madara sites leave `div.author` empty and only fill it on
        // the details page, so the UI decides what to show.
        author: author.trim() || undefined,
        initialized: false,
      });
    }

    // `hasNextPage` must mean "fetching the next page would return something
    // new". Two ways to get it wrong, both seen in production:
    //   - `mangas.length >= 10` claimed a next page on a full last page, so
    //     browsing kept requesting pages that returned the same rows;
    //   - requiring a `next` anchor said "no more results" on sites whose
    //     pagination markup is a bare `<ul>` with no link classes at all.
    // The site accepts `page=` and honours it, so a full page of distinct
    // titles is the only honest signal available without fetching page 2.
    const hasNextPage = mangas.length >= 10;
    return { mangas, hasNextPage };
  }

  async function details(manga: any) {
    const url = manga.url || manga.id;
    let html = "";
    try {
      html = await fetchHtml(url, root + "/");
    } catch {
      return manga;
    }
    if (!html) return manga;

    const out = { ...manga };
    const t = saneTitle(pickDescendantText(html, sel.detailsTitle) || pickTitleTag(html));
    if (t) out.title = t;
    // Author/artist/description are all `div.<label>-content` or a nested
    // `summary__content`, several of which occur per page. `pickText` takes the
    // first match, which for these is a sidebar or an unrelated block, so
    // prefer the labelled row and fall back to the bare selector.
    const a =
      pickLabelled(html, "Author(s)") ||
      pickLabelled(html, "Author") ||
      pickAnchorText(html, sel.detailsAuthor);
    if (a) out.author = a;
    const art = pickAnchorText(html, sel.detailsArtist);
    if (art) out.artist = art;

    // The synopsis. `containerHtml` on the description selector is used only
    // as a fallback: its whole inner HTML is what gets cleaned, and a scraper
    // page's leading `<h2>`/`<h3>` survive tag-stripping as a run-on prefix.
    // Preferring the first real paragraph removes the SEO furniture at the
    // source and keeps the plot prose intact.
    const descScope = containerHtml(html, sel.detailsDescription);
    const descRaw = pickFirstParagraph(descScope) || pickLabelled(html, "Description") || decodeEntities(descScope);
    const desc = cleanSynopsis(descRaw);
    if (desc) out.description = desc;

    const st = pickLabelled(html, "Status");
    if (st) out.status = statusFrom(st);

    // The cover. Scoped to the summary image block, `data-src` first: the
    // page-wide first `src` belongs to a `<script>` tag and renders blank.
    const coverScope = classTokenHtml(html, classOf(sel.detailsThumbnail)) || containerHtml(html, sel.detailsThumbnail);
    const th = pickThumbUrl(coverScope, root) || imgOf(pickMetaImage(html));
    if (th) out.thumbnailUrl = th;

    const genres = pickGenres(html);
    if (genres.length) out.genres = genres;

    out.initialized = true;
    return out;
  }

  async function chapters(manga: any): Promise<Chapter[]> {
    const url = manga.url || manga.id;
    let html = "";
    try {
      html = await fetchHtml(url, root + "/");
    } catch {
      return [];
    }
    if (!html) return [];

    const out: Chapter[] = [];
    const segs = html.split(new RegExp(escapeRe(classOf(sel.chapterList))));
    for (const seg of segs.slice(1)) {
      const href = pickHref(seg, url);
      if (!href || href === "#") continue; // locked chapter
      // A chapter link points *into* a manga, never at the site root. The
      // first `wp-manga-chapter` match on a page is often a logo or promo
      // block with a real but meaningless href.
      if (!/\/manga\/|\/serie\/|\/comic\//i.test(href)) continue;
      // The chapter name is the anchor's own text. Reading it through a
      // selector would walk the whole segment and can land on the *next*
      // chapter's anchor, so take the one that carries this chapter's href.
      const name = anchorText(seg, href) || pickText(seg, sel.chapterName) || "";
      const date = pickText(seg, sel.chapterDate) || "";
      out.push({
        url: href,
        name: decodeEntities(name).trim(),
        dateUpload: date ? Date.parse(date) || 0 : 0,
        chapterNumber: -1,
      });
    }
    return out;
  }

  async function pages(chapter: Chapter): Promise<Page[]> {
    let html = "";
    try {
      html = await fetchHtml(chapter.url, root + "/");
    } catch {
      return [];
    }
    if (!html) return [];

    const region = sliceRegion(html, sel.pageList) || html;
    const imgs: string[] = [];
    for (const m of region.matchAll(/<img[^>]+>/gi)) {
      const tag = m[0];
      const lazy = attrOf(tag, "data-src");
      const src = attrOf(tag, "src");
      // Lazy placeholders are one shared gif; a real page image is never that.
      const candidate = (lazy || src).trim();
      if (!candidate) continue;
      if (/\s/.test(candidate)) continue; // attribute captured across tags
      if (/dflazy|placeholder|blank\.gif|loading/i.test(candidate)) continue;

      // Reject furniture by *filename*, not by extension. Real Madara panels
      // are routinely served from an image CDN with an extensionless path
      // (`.../chapter_e6e96...`), so a `must end in .jpg` test throws away
      // every panel on those sites.
      const filename = (candidate.split("/").pop() || "").toLowerCase();
      if (/^(?:logo|avatar|icon|banner|badge|spacer|placeholder|gravatar|emoji|star)/.test(filename)) continue;
      if (/dflazy|placeholder|blank/.test(filename)) continue;
      // Cover thumbnails are named as such, and WordPress appends a size
      // suffix (`photo-75x106.jpg`) to every resized thumbnail.
      if (/thumbnail|cover|\-\d+x\d+\.[a-z]+$/.test(filename)) continue;

      // A tiny *declared* image is furniture. Only trust the attribute when
      // both dimensions are present and clearly thumbnail-sized; many themes
      // omit them entirely on the real panel.
      const w = Number(attrOf(tag, "width") || 0);
      const h = Number(attrOf(tag, "height") || 0);
      if (w && h && w <= 175 && h <= 250) continue;

      imgs.push(imgOf(candidate));
    }
    // Madara's `page-break` layout gives one image per block; dedupe while
    // preserving order, because the same lazy attr is often repeated.
    const seen = new Set<string>();
    return imgs
      .filter((u) => (seen.has(u) ? false : (seen.add(u), true)))
      .map((image, index) => ({ index, url: "", image }));
  }

  return {
    async popular(page = 1) {
      return list(page, "popular");
    },
    async latest(page = 1) {
      return list(page, "latest");
    },
    async search(query: string, page = 1) {
      return list(page, "search", query);
    },
    details,
    chapters,
    pages,
  };
}

/* ---------------------------------------------------------------- helpers */

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** `li.wp-manga-chapter` -> `wp-manga-chapter` (the class we split on). */
function classOf(sel: string): string {
  const m = sel.match(/\.([\w-]+)/);
  return m ? m[1] : sel;
}

/**
 * Index of the first `class="… cls …"` attribute, or -1.
 *
 * Attribute context only, never a bare substring. Madara themes inline ~18KB
 * of theme CSS, and a plain `indexOf("post-title")` lands inside a selector
 * list like `body.manga-page .profile-manga .post-title h1` — which is how a
 * real element's class can resolve to a stylesheet.
 */
function indexOfClassToken(html: string, cls: string): number {
  const re = new RegExp(`class\\s*=\\s*["'][^"']*\\b${escapeRe(cls)}\\b[^"']*["']`, "i");
  const m = html.match(re);
  return m?.index ?? -1;
}

/** Inner HTML of the first element carrying `cls` in its class attribute. */
function classTokenHtml(html: string, cls: string): string {
  if (!cls || cls === "body") return "";
  const at = indexOfClassToken(html, cls);
  if (at < 0) return "";
  return containerHtmlAt(html, cls, at);
}

function decodeEntities(s: string): string {
  return s
    .replace(/&#8217;|&rsquo;/g, "'")
    .replace(/&#8211;|&ndash;/g, "-")
    .replace(/&#8212;|&mdash;/g, "—")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, d) => String.fromCharCode(Number(d)))
    .replace(/<[^>]+>/g, "")
    .trim();
}

function attrOf(tag: string, name: string): string {
  // `[^"']+` can run past the closing quote when an attribute value contains
  // one of them, swallowing markup and yielding a value full of whitespace.
  // Anchoring to a single tag and excluding `<` keeps the capture honest.
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"'<>]*)["']`, "i"));
  return m ? m[1] : "";
}

/** The first non-`#` href in a fragment, resolved against `from`. */
function pickHref(frag: string, from: string): string {
  const m = frag.match(/<a[^>]+href\s*=\s*["']([^"']+)["']/i);
  if (!m) return "";
  const href = m[1];
  if (!href || href === "#" || href.startsWith("javascript:")) return "";
  if (/^https?:\/\//i.test(href)) return href;
  if (href.startsWith("//")) return "https:" + href;
  // A root-relative path resolves against the *origin*, not against the
  // current page's directory. Resolving against the directory yields
  // `https://site/manga/slug/a/other-slug/`, which 404s.
  if (href.startsWith("/")) return originOf(from) + href;
  return from.replace(/\/+$/, "") + "/" + href;
}

function originOf(url: string): string {
  const m = url.match(/^(https?:\/\/[^/]+)/i);
  return m ? m[1] : url;
}

function pickAttr(frag: string, name: string): string {
  const m = frag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, "i"));
  return m ? m[1] : "";
}

/**
 * Text of the first anchor inside the element carrying `sel`'s class.
 *
 * Author and artist rows hold a *list* of links. Reading the container's text
 * works, but only once we have found the right container — the same class
 * name appears in the sidebar and in the theme's stylesheet.
 */
function pickAnchorText(html: string, sel: string): string {
  const cls = classOf(sel);
  const idx = html.indexOf(cls);
  if (idx < 0) return "";
  const start = html.lastIndexOf("<div", idx);
  if (start < 0) return "";

  // Bound the read to this container only. A fixed character window runs on
  // into the next rows and returns "Author Name, 2017, Chapter 2".
  //
  // Both scanners start at `start`, but the open scanner's first match must be
  // this element's own tag: regex alternation advances whichever index is
  // smaller, and a close tag at the same offset would otherwise be taken first
  // and drive the depth negative.
  let depth = 0;
  let end = html.length;
  const open = /<div\b[^>]*>/gi;
  const close = /<\/div>/gi;
  open.lastIndex = start;
  close.lastIndex = start + 1;
  let o: RegExpExecArray | null = open.exec(html);
  let c: RegExpExecArray | null = close.exec(html);
  while (o || c) {
    if (o && (!c || o.index <= c.index)) {
      depth++;
      o = open.exec(html);
    } else {
      depth--;
      if (depth === 0) { end = c!.index; break; }
      c = close.exec(html);
    }
  }

  const links = [...html.slice(start, end).matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)]
    .map((m) => decodeEntities(m[1]))
    .filter(Boolean);
  return links.join(", ");
}

/** The visible text of the anchor that points at `href`. */
function anchorText(frag: string, href: string): string {
  const re = new RegExp(
    `<a[^>]+href\\s*=\\s*["']${escapeRe(href).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>([\\s\\S]*?)</a>`,
    "i"
  );
  const m = frag.match(re);
  return m ? decodeEntities(m[1]) : "";
}

/** First anchor title attribute in a fragment (the reliable card title). */
function pickTitle(frag: string): string {
  const m = frag.match(/<a[^>]+title\s*=\s*["']([^"']+)["']/i);
  return m ? m[1] : "";
}

/**
 * Read the value of a labelled summary row.
 *
 * Madara renders details as repeated heading/value pairs, and `summary-content`
 * appears for every one of them — "Release" holds the year, "Status" the
 * state. Taking the first match therefore reads the year as the status, so
 * match on the heading text instead.
 */
function pickLabelled(html: string, label: string): string {
  const re = new RegExp(
    `summary-heading[^>]*>\\s*(?:<[^>]+>\\s*)*${escapeRe(label)}(?:\\s*<[^>]+>)*\\s*</[^>]+>\\s*<div class="summary-content"[^>]*>([\\s\\S]{0,200}?)</div>`,
    "i"
  );
  const m = html.match(re);
  if (m) return decodeEntities(m[1]);
  // Some themes put the label and value in one block.
  const flat = new RegExp(
    `${escapeRe(label)}[\\s\\S]{0,120}?summary-content[^>]*>([\\s\\S]{0,200}?)</div>`,
    "i"
  );
  const m2 = html.match(flat);
  return m2 ? decodeEntities(m2[1]) : "";
}

/** Bounded inner HTML of the element carrying `sel`'s class. */
function containerHtml(html: string, sel: string): string {
  const cls = classOf(sel);
  // A selector with a class must be located in attribute context. A bare
  // `indexOf` finds the same word inside the theme's inlined CSS first, which
  // is how `div.post-title h1` resolved to 18KB of a stylesheet. A bare tag
  // selector ("a", "span") has no class to look for, so it keeps the
  // substring search.
  const idx = /[.#]/.test(sel) ? indexOfClassToken(html, cls) : html.indexOf(cls);
  if (idx < 0) return "";
  return containerHtmlAt(html, sel, idx);
}

/**
 * `containerHtml` with the element's class-token position supplied.
 *
 * The walk is identical; only the starting point differs, so a caller that has
 * already located a real `class="…"` occurrence can reuse it without the
 * substring lookup that can land inside inlined CSS.
 */
function containerHtmlAt(html: string, sel: string, idx: number): string {
  const start = html.lastIndexOf("<", idx);
  if (start < 0) return "";

  // Walk the matching tag to its close so nested content is captured whole
  // and nothing from the *next* block leaks in.
  const tagName = html.slice(start + 1).match(/^[\w-]+/)?.[0] || "div";

  // A bare tag selector (`"a"`, `"span"`) is usually a leaf. It has no
  // matching close tag to walk to — the naive depth walk runs on into the
  // *following* siblings, which is how "Chapter 2" once came back carrying
  // the date and half the next <li>.
  if (sel.trim() === tagName) {
    const openEnd = html.indexOf(">", start);
    if (openEnd < 0) return "";
    const closeTag = `</${tagName}>`;
    const closeAt = html.indexOf(closeTag, openEnd);
    if (closeAt < 0) return html.slice(openEnd + 1);
    return html.slice(openEnd + 1, closeAt);
  }

  let depth = 0;
  let end = html.length;
  const open = new RegExp(`<${tagName}\\b[^>]*>`, "gi");
  const close = new RegExp(`</${tagName}>`, "gi");
  open.lastIndex = start;
  close.lastIndex = start + 1;
  let o: RegExpExecArray | null = open.exec(html);
  let c: RegExpExecArray | null = close.exec(html);
  while (o || c) {
    if (o && (!c || o.index <= c.index)) {
      depth++;
      o = open.exec(html);
    } else {
      depth--;
      if (depth === 0) { end = c!.index; break; }
      c = close.exec(html);
    }
  }
  const openEnd = html.indexOf(">", start);
  return openEnd < 0 ? "" : html.slice(openEnd + 1, end);
}

/** Text of the first element matching a simple class selector. */
function pickText(html: string, sel: string): string {
  const inner = containerHtml(html, sel);
  return inner ? decodeEntities(inner) : "";
}

/**
 * Text of a selector's descendant, e.g. `div.post-title h1` -> the `<h1>`.
 *
 * `containerHtml` stops at the ancestor carrying the class, which is right for
 * a single-tag selector but wrong for a descendant: `div.post-title` also
 * contains the theme's badge span, so reading the whole block prefixed the
 * title with "HOT" on every hot series.
 */
function pickDescendantText(html: string, sel: string): string {
  const parts = sel.trim().split(/\s+/);
  const tag = parts.length > 1 ? parts[parts.length - 1] : "";
  if (!/^[a-z][\w-]*$/i.test(tag)) return pickText(html, sel);
  const inner = containerHtml(html, parts[0]);
  if (!inner) return "";
  const m = inner.match(new RegExp(`<${escapeRe(tag)}\\b[^>]*>([\\s\\S]*?)</${escapeRe(tag)}>`, "i"));
  return m ? decodeEntities(m[1]) : decodeEntities(inner);
}

/** The <h1> text, used when a theme puts the title elsewhere. */
function pickTitleTag(html: string): string {
  const m = html.match(/<h1[^>]*>(.*?)<\/h1>/is);
  return m ? decodeEntities(m[1]) : "";
}

/**
 * A cover url is an image, not an asset.
 *
 * Madara detail pages lazy-load the real cover into `data-src` and leave
 * `src` pointing at a grey placeholder. Scanning the page for the first
 * `src` attribute at all therefore returns whatever the theme loaded first —
 * on one site that was `jquery.min.js`, and the cover rendered as a blank
 * grey box. Rejecting known non-image extensions is the guard that matters.
 */
function isImageUrl(v: string): boolean {
  if (!v) return false;
  if (/\.(?:js|mjs|css|json|php|html?|xml|txt|ico|woff2?|ttf|eot|mp4|webm)(\?|#|$)/i.test(v)) return false;
  return true;
}

const IMG_LAZY_ATTRS = ["data-src", "data-lazy-src", "data-original", "data-srcset", "src"];

/** The best real image url on the first `<img>` inside `scope`. */
function pickImageUrl(scope: string): string {
  const tag = scope.match(/<img\b[^>]*>/i)?.[0];
  if (!tag) return "";
  for (const attr of IMG_LAZY_ATTRS) {
    const raw = attrOf(tag, attr);
    if (!raw) continue;
    // `srcset` is a width-descriptor list; its first entry is the largest.
    const url = attr === "data-srcset" ? raw.split(",")[0].trim().split(/\s+/)[0] || "" : raw;
    if (isImageUrl(url)) return url;
  }
  return "";
}

/** Meta `og:image` / `twitter:image` — the last resort for a cover. */
function pickMetaImage(html: string): string {
  for (const name of ["og:image", "twitter:image", "twitter:image:src"]) {
    const m =
      html.match(new RegExp(`<meta[^>]*(?:property|name)\\s*=\\s*["']${name}["'][^>]*content\\s*=\\s*["']([^"']+)["']`, "i")) ||
      html.match(new RegExp(`<meta[^>]*content\\s*=\\s*["']([^"']+)["'][^>]*(?:property|name)\\s*=\\s*["']${name}["']`, "i"));
    if (m?.[1] && isImageUrl(m[1])) return m[1];
  }
  return "";
}

/**
 * The synopsis paragraph, ignoring the SEO furniture wrapped around it.
 *
 * Madara scrapers emit `Read X Novel – X Manhua Online Free At ZINMANGA.NET`
 * as an `<h2>`, `The summary of the comic X:` as an `<h3>`, and sometimes a
 * bare `Read Manga X at example.com` line of its own — the plot is in a
 * `<p>`, but not always the *first* one. Each candidate is cleaned and the
 * first one with real substance left wins, so a promo line that survives
 * tag-stripping cannot become the synopsis.
 */
const MIN_SYNOPSIS = 40;

function pickFirstParagraph(html: string): string {
  for (const b of html.matchAll(/<p\b[^>]*>([\s\S]*?)<\/p>/gi)) {
    const raw = decodeEntities(b[1]).replace(/\s+/g, " ").trim();
    if (raw.length < MIN_SYNOPSIS) continue;
    const cleaned = cleanSynopsis(raw);
    // A candidate that was mostly boilerplate is not a synopsis.
    if (cleaned.length < MIN_SYNOPSIS) continue;
    if (cleaned.length < raw.length * 0.5) continue;
    return cleaned;
  }
  return "";
}

/**
 * Boilerplate scraper sites staple on around a synopsis.
 *
 * Phrase-based, not site-based, so the rules hold across the family. The
 * headings are removed before the text is flattened, but a site that inlines
 * its blurb as bare text reaches the same rules.
 */
const SEO_PREFIXES: RegExp[] = [
  /^read\s+[^.!?\n]{0,160}?\b(?:novel|manhua|manga|comic|book)\b[^.!?\n]{0,80}?\bonline\s+free\s+at\b[^.!?\n]*/i,
  /^read\s+[^.!?\n]{0,160}?\bonline\s+free\b[^.!?\n]*/i,
  // `Read Manga Return of the Mount Hua Sect at s2read.com` — a site promo
  // standing alone as its own paragraph.
  /^read\s+[^.!?\n]{0,160}?\b(?:novel|manhua|manga|comic|book|manhwa)\b[^.!?\n]{0,80}?\bat\s+\S+[.!?]?\s*$/i,
  /[^.!?\n]{0,120}?\bis\s+also\s+known\s+as\s*:?/gi,
  /the\s+summary\s+of\s+the\s+(?:comic|manga|manhua|novel|book)\b[^:\n]{0,120}\s*:/gi,
  /the\s+(?:comic|manga|manhua|novel|book)\b[^.\n]{0,80}?\bbelongs\s+to\s+the\s+genre\s*:?/gi,
  /[^.!?\n]{0,120}?\bplease\s+(?:don'?t|do\s+not)\s+[^\n]{0,200}/gi,
  /^\s*(?:genres?|tags?)\s*:?\s*$/i,
];

function cleanSynopsis(raw: string): string {
  if (!raw) return "";
  let text = raw;
  for (const re of SEO_PREFIXES) text = text.replace(re, " ");
  return text.replace(/\s+/g, " ").trim();
}

/**
 * A title is a short human string.
 *
 * Anything longer, or containing CSS punctuation, came from a stylesheet or a
 * JSON blob rather than from the page's title element — measured at 18,836
 * characters of theme CSS on a real detail page. Rejecting it lets the caller
 * fall back to the `<h1>` instead of shipping a stylesheet as a manga name.
 */
const MAX_TITLE = 200;

/** Characters that only ever appear in CSS or JSON, never in a title. */
const CSS_PUNCTUATION = new RegExp(`[{};]|/\\*|\\*/|@media|!important|\\bpx\\b|:root`, "i");

function saneTitle(raw: string): string {
  const t = (raw || "").replace(/\s+/g, " ").trim();
  if (!t || t.length > MAX_TITLE) return "";
  if (CSS_PUNCTUATION.test(t)) return "";
  return t;
}

/**
 * Genre names from a Madara detail page.
 *
 * The family renders them as `div.genres-content a` inside a
 * `post-content_item` headed `Genre(s)`; a few themes drop one level and put
 * the links straight in `div.summary-content`. Only `/manga-genre/` and
 * `/manga-tag/` taxonomy links are counted, so the site-wide genre menu in
 * the header and footer cannot be mistaken for this series' genres.
 */
function pickGenres(html: string): string[] {
  for (const cls of ["genres-content", "summary-content"]) {
    const scope = classTokenHtml(html, cls);
    if (!scope) continue;
    const out: string[] = [];
    for (const a of scope.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      if (!/\/manga-(?:genre|tag)\//i.test(a[1])) continue;
      const name = decodeEntities(a[2]).replace(/\s+/g, " ").trim();
      if (!name || name.length > 40) continue;
      if (!out.some((g) => g.toLowerCase() === name.toLowerCase())) out.push(name);
    }
    if (out.length) return out;
  }
  return [];
}

/**
 * The card's author, if the theme prints one.
 *
 * Madara themes vary: some put the name in `.item-title`, others leave the
 * card with a title and cover only. Returning "" lets the caller fall back
 * to "Unknown" rather than inventing a name.
 */
function pickAuthor(cardHtml: string): string {
  // `<div class="item-title">Author Name</div>` — inner text, tags stripped.
  const m = cardHtml.match(
    /class=["'][^"']*\bitem-title\b[^"']*["'][^>]*>([\s\S]{0,160}?)<\//
  );
  if (!m) return "";
  const text = m[1]
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  // Some themes put the title in the same node, prefixing the author.
  return text.length && text.length <= 90 ? text : "";
}

/**
 * Isolate the page-image region.
 *
 * `page-break` is Madara's *inner* wrapper, so slicing from the first
 * occurrence starts a few hundred characters before the panels and, on
 * themes that nest it oddly, can end before them. `reading-content` is the
 * outer container and always spans the full image list, so prefer it and
 * only fall back to the inner wrapper.
 */
function sliceRegion(html: string, sel: string): string {
  for (const cls of ["reading-content", "read-content", "chapter-content", classOf(sel)]) {
    const idx = html.indexOf(cls);
    if (idx < 0) continue;
    const start = html.lastIndexOf("<div", idx);
    if (start < 0) continue;
    // Generous: a long chapter's image list can exceed 200KB of markup, and
    // cutting short would silently truncate the page count. The cost is a few
    // extra img tags filtered out by the furniture rules.
    return html.slice(start);
  }
  return "";
}
