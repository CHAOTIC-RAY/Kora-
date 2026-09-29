/**
 * Kora source runtime — executes a plugin against a live site.
 *
 * Every network call goes through the Worker relay (`/api/source-fetch`) rather
 * than straight from the page. Two reasons, both load-bearing:
 *
 *  1. Bot walls. Roughly half the sites behind these plugins sit behind
 *     Cloudflare, which will not serve a bare browser fetch from an unknown
 *     origin. The relay is a first-party request.
 *  2. CORS. Sites do not send `Access-Control-Allow-Origin`, so a direct
 *     `fetch()` from the SPA cannot read the HTML at all.
 *
 * The relay *relays*: it does not store, index, or re-publish. Bytes go
 * origin -> relay -> reader and are cached only in the reader's own IndexedDB.
 * That distinction is what keeps this a reader rather than a mirror.
 */

import * as cheerio from "cheerio";
import { load } from "cheerio";
import {
  absUrl,
  expandTemplate,
  selectAll,
  toRelativeUrl,
  nodeText,
} from "./selector";
import type {
  Chapter,
  FieldSelector,
  ListingRule,
  Manga,
  MangasPage,
  Page,
  SourcePlugin,
} from "./types";

/** Ask the Worker to fetch a url and hand back the body as text. */
async function relayFetch(
  url: string,
  opts: { referer?: string; headers?: Record<string, string> } = {}
): Promise<{ ok: boolean; status: number; body: string; finalUrl: string; error?: string }> {
  const params = new URLSearchParams({ u: url });
  if (opts.referer) params.set("r", opts.referer);

  const res = await fetch(`/api/source-fetch?${params.toString()}`, {
    headers: opts.headers ? { "X-Source-Headers": JSON.stringify(opts.headers) } : undefined,
  });
  if (!res.ok) {
    return { ok: false, status: res.status, body: "", finalUrl: url, error: await res.text() };
  }
  const data = await res.json();
  return {
    ok: true,
    status: data.status ?? 200,
    body: data.body ?? "",
    finalUrl: data.finalUrl ?? url,
    error: data.error,
  };
}

/** `$` that returns an empty selection for a malformed selector, never throws. */
function safeFind($: cheerio.CheerioAPI, scope: cheerio.Cheerio<any> | null, selector: string): cheerio.Cheerio<any> {
  try {
    return scope ? scope.find(selector) : $(selector);
  } catch {
    return (scope ?? $.root()).slice(0, 0) as unknown as cheerio.Cheerio<any>;
  }
}

/**
 * Read one field out of a matched element.
 *
 * `scope` is a Cheerio-wrapped node (a single result card). Field selectors are
 * resolved *within that node* so `h2` inside one card never leaks another
 * card's title. Falls back to the whole document when the card has no match.
 */
function readField(
  $: cheerio.CheerioAPI,
  scope: cheerio.Cheerio<any>,
  field: FieldSelector | undefined,
  baseUrl: string
): string {
  if (!field) return "";
  const spec = typeof field === "string" ? { selector: field } : field;
  if (spec.literal !== undefined) return spec.literal;
  if (!spec.selector) return "";

  // Shorthand `img@src` means "read this attribute"; `@text` (used throughout
  // the Tachiyomi sources for the element's text content) means read text.
  let sel = spec.selector;
  let attr = spec.attr;
  let wantsText = Boolean(spec.text);
  if (!attr && !spec.text && sel.includes("@")) {
    const at = sel.lastIndexOf("@");
    const part = sel.slice(at + 1);
    if (part === "text") wantsText = true;
    else attr = part;
    sel = sel.slice(0, at);
  }

  // An empty selector means "this node itself" — that's what `@text` on a
  // matched <a> resolves to. Don't hand an empty string to the engine.
  const inScope = sel ? safeFind($, scope, sel) : scope;
  const nodes = inScope.length ? inScope : (sel ? safeFind($, null, sel) : inScope);
  if (!nodes.length) return "";

  const first = nodes.first();
  const raw = wantsText || !attr ? first.text() : first.attr(attr) || "";
  return finish(raw, spec, baseUrl);
}

function finish(
  value: string,
  spec: { capture?: number; split?: string; resolve?: boolean },
  baseUrl: string
): string {
  let out = (value || "").replace(/\s+/g, " ").trim();

  if (spec.capture !== undefined) {
    // Tachiyomi extracts chapter numbers with substringAfterLast(/). We model
    // that as "take the Nth numeric group" rather than a full regex engine.
    const nums = out.match(/\d+(?:\.\d+)?/g) || [];
    out = nums[spec.capture] ?? "";
  }
  if (spec.split) {
    out = out
      .split(spec.split)
      .map((s) => s.trim())
      .filter(Boolean)
      .join(", ");
  }
  if (spec.resolve) out = absUrl(baseUrl, out);
  return out;
}

/** Parse a listing page into manga records. */
function parseListing(
  html: string,
  pageUrl: string,
  rule: ListingRule,
  source: SourcePlugin,
  nextPageSelector?: string
): MangasPage {
  const $ = load(html);
  const cards = safeFind($, null, rule.selector);
  const mangas: Manga[] = [];

  cards.each((_i, el) => {
    const card = $(el);
    const title = readField($, card, rule.title, pageUrl);
    const relUrl = readField($, card, rule.url, pageUrl);
    if (!title || !relUrl) return;

    const thumb = rule.thumb ? readField($, card, rule.thumb, pageUrl) : "";
    const author = rule.author ? readField($, card, rule.author, pageUrl) : "";

    mangas.push({
      // Store the path, not the absolute url — this is Tachiyomi's
      // setUrlWithoutDomain behaviour and lets the source survive a move.
      url: toRelativeUrl(source.baseUrl, absUrl(pageUrl, relUrl)),
      title,
      thumbnailUrl: thumb ? absUrl(pageUrl, thumb) : undefined,
      author: author || undefined,
      initialized: false,
      sourceId: source.id,
    });
  });

  const hasNextPage = nextPageSelector ? safeFind($, null, nextPageSelector).length > 0 : false;
  return { mangas, hasNextPage };
}

/** Build a request url for an endpoint, substituting its variables. */
function buildUrl(
  template: string,
  source: SourcePlugin,
  vars: Record<string, string | number | undefined>
): string {
  const expanded = expandTemplate(template, vars);
  return absUrl(source.baseUrl, expanded);
}

export interface SourceClient {
  plugin: SourcePlugin;
  popular(page?: number): Promise<MangasPage>;
  latest(page?: number): Promise<MangasPage>;
  search(query: string, page?: number, filters?: Record<string, string>): Promise<MangasPage>;
  details(manga: Manga): Promise<Manga>;
  chapters(manga: Manga): Promise<Chapter[]>;
  pages(chapter: Chapter, manga?: Manga): Promise<Page[]>;
}

/**
 * Build a client for one plugin.
 *
 * Every method is defensive: a broken selector yields an empty page rather
 * than an exception, because a single dead source must never break the feed.
 */
export function createSourceClient(plugin: SourcePlugin): SourceClient {
  const get = (url: string, referer?: string) =>
    relayFetch(url, { referer: referer || plugin.baseUrl, headers: plugin.headers });

  async function fetchListing(
    endpoint: { url: string; nextPage?: string; mangas: ListingRule } | undefined,
    page: number,
    extraVars: Record<string, string | number | undefined> = {}
  ): Promise<MangasPage> {
    if (!endpoint) return { mangas: [], hasNextPage: false };
    const url = buildUrl(endpoint.url, plugin, { page, ...extraVars });
    const res = await get(url);
    if (!res.ok || !res.body) return { mangas: [], hasNextPage: false };
    return parseListing(res.body, res.finalUrl || url, endpoint.mangas, plugin, endpoint.nextPage);
  }

  return {
    plugin,

    popular: (page = 1) => fetchListing(plugin.endpoints.popular, page),
    latest: (page = 1) => fetchListing(plugin.endpoints.latest, page),

    async search(query, page = 1, filters = {}) {
      const ep = plugin.endpoints.search;
      if (!ep) return { mangas: [], hasNextPage: false };

      // Fold filter values into the url template. A `select` filter with key
      // `genre` and value "Action" is substituted into `{genre}`.
      const filterVars: Record<string, string> = {};
      for (const f of plugin.filters || []) {
        const chosen = filters[f.key];
        if (chosen && chosen !== f.default) filterVars[f.key] = chosen;
      }
      return fetchListing(ep, page, { query, ...filterVars });
    },

    async details(manga: Manga) {
      const ep = plugin.endpoints.details;
      const out: Manga = { ...manga };
      if (!ep) return out;

      const url = buildUrl(ep.url, plugin, { mangaUrl: manga.url });
      const res = await get(url);
      if (!res.ok || !res.body) return out;
      const pageUrl = res.finalUrl || url;
      const $ = load(res.body);
      const root = $.root();

      if (ep.title) out.title = readField($, root, ep.title, pageUrl) || out.title;
      if (ep.author) out.author = readField($, root, ep.author, pageUrl) || out.author;
      if (ep.artist) out.artist = readField($, root, ep.artist, pageUrl) || out.artist;
      if (ep.description) out.description = readField($, root, ep.description, pageUrl);
      if (ep.thumbnail) {
        const t = readField($, root, ep.thumbnail, pageUrl);
        if (t) out.thumbnailUrl = absUrl(pageUrl, t);
      }
      if (ep.genres) {
        // Genre lists are several links, so join their text. The def may be a
        // bare selector string or a FieldSelector object.
        const genreSel =
          typeof ep.genres === "string" ? ep.genres : ep.genres.selector || "";
        const nodes = genreSel ? safeFind($, root, genreSel) : $("");
        const g = nodes.length
          ? nodes
              .map((_i, el) => $(el).text().replace(/\s+/g, " ").trim())
              .get()
              .filter(Boolean)
              .join(", ")
          : "";
        if (g) out.genres = g.split(",").map((s) => s.trim()).filter(Boolean);
      }
      if (ep.status) {
        const raw = readField($, root, ep.status.selector, pageUrl);
        if (raw) out.status = (ep.status.map?.[raw] ?? out.status ?? 1) as Manga["status"];
      }
      out.initialized = true;
      return out;
    },

    async chapters(manga: Manga) {
      const ep = plugin.endpoints.chapters;
      if (!ep) return [];

      const url = buildUrl(ep.url, plugin, { mangaUrl: manga.url });
      const res = await get(url);
      if (!res.ok || !res.body) return [];
      const pageUrl = res.finalUrl || url;
      const $ = load(res.body);

      let list: Chapter[] = [];
      safeFind($, null, ep.selector).each((_i, el) => {
        const node = $(el);
        const name = readField($, node, ep.name, pageUrl);
        const rel = readField($, node, ep.url_, pageUrl);
        if (!name || !rel) return;
        const abs = absUrl(pageUrl, rel);
        const tail = abs.split("/").pop() || "";
        const numeric = parseFloat(tail.replace(/[^\d.]/g, ""));
        list.push({
          url: toRelativeUrl(plugin.baseUrl, abs),
          name,
          // -1 is Tachiyomi's marker for "no numbering" (one-shots, albums).
          chapterNumber: Number.isFinite(numeric) ? numeric : -1,
        });
      });

      if (ep.transform?.includes("distinct")) {
        const seen = new Set<string>();
        list = list.filter((c) => {
          if (seen.has(c.url)) return false;
          seen.add(c.url);
          return true;
        });
      }
      if (ep.transform?.includes("reverse")) list.reverse();
      return list;
    },

    async pages(chapter: Chapter, manga?: Manga) {
      const ep = plugin.endpoints.pages;
      if (!ep) return [];

      const url = buildUrl(ep.url, plugin, {
        chapterUrl: chapter.url,
        mangaUrl: manga?.url ?? "",
      });
      const res = await get(url, chapter.url);
      if (!res.ok || !res.body) return [];
      const pageUrl = res.finalUrl || url;
      const $ = load(res.body);

      const out: Page[] = [];
      $(ep.selector).each((index, el) => {
        let raw = readField($, $(el), ep.image, pageUrl);
        if (!raw) return;
        if (ep.prefix) raw = ep.prefix + raw;
        out.push({ index, url: absUrl(pageUrl, raw) });
      });
      return out;
    },
  };
}

export { nodeText };
