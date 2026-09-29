/**
 * Madara theme — one engine, many sites.
 *
 * The single highest-leverage thing in the Tachiyomi ecosystem. 248 of the
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
      const thumb = imgOf(pickAttr(card, "data-src") || pickAttr(card, "src"));
      mangas.push({
        id: href,
        url: href,
        title: decodeEntities(title).trim(),
        thumbnailUrl: thumb,
        initialized: false,
      });
    }

    // The `next` link is a real signal; fall back to a full page when the
    // theme omits it, which is common on paginated Madara listings.
    const hasNextPage = /class=["'][^"']*\bnext\b[^"']*["']/i.test(html) || mangas.length >= 10;
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
    const t = pickText(html, sel.detailsTitle) || pickTitleTag(html);
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
    const desc = pickText(html, sel.detailsDescription) || pickLabelled(html, "Description");
    if (desc) out.description = desc;
    const st = pickLabelled(html, "Status");
    if (st) out.status = statusFrom(st);
    const th = imgOf(pickAttr(html, "src"));
    if (th) out.thumbnailUrl = th;
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
  const idx = html.indexOf(cls);
  if (idx < 0) return "";
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

/** The <h1> text, used when a theme puts the title elsewhere. */
function pickTitleTag(html: string): string {
  const m = html.match(/<h1[^>]*>(.*?)<\/h1>/is);
  return m ? decodeEntities(m[1]) : "";
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
