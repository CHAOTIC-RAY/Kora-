/**
 * JSON-API source runtime.
 *
 * The best sources (MangaDex, OpenLibrary) are JSON APIs, not HTML. Scraping
 * them with CSS selectors is hopeless — their data isn't in markup at all —
 * so they get an explicit path language instead.
 *
 * Paths are dot-separated with array helpers:
 *   data                 -> the array
 *   data.attributes.title -> nested object access
 *   data[0]              -> index into an array
 *   data[]               -> "for each element of this array"
 *   data[].relationships -> the same relative path inside each element
 *   rel[]                -> the first non-empty value of that path per element
 *
 * `rel[]` is what makes mapped lists work: a field path is suffixed with `[]`
 * and read from every element rather than the array as a whole.
 */

import type { Chapter, JsonListing, JsonRule, Manga, Page, SourcePlugin } from "./types";

export type Json = any;

/**
 * Resolve a path against a decoded JSON value.
 *
 * Returns an array because callers iterate anyway — a `[]` path fans out to
 * one result per element, everything else yields at most one.
 */
export function resolvePath(root: Json, path: string): Json[] {
  if (!path) return [root];

  // `x[]` or `x[].y` — the segment carrying `[]` decides the fan-out.
  const fanOutAt = path.indexOf("[]");
  if (fanOutAt >= 0) {
    const head = path.slice(0, fanOutAt);
    const tail = path.slice(fanOutAt + 2).replace(/^\./, "");
    const parents = head ? resolvePath(root, head) : [root];

    const out: Json[] = [];
    for (const p of parents) {
      const arr = Array.isArray(p) ? p : [p];
      for (const item of arr) {
        if (item === null || item === undefined) continue;
        if (!tail) {
          out.push(item);
        } else {
          for (const v of resolvePath(item, tail)) {
            if (v !== null && v !== undefined) out.push(v);
          }
        }
      }
    }
    return out;
  }

  const segments = path.split(".");
  const last = segments.length - 1;
  let current: Json = root;

  for (let i = 0; i <= last; i++) {
    const raw = segments[i];
    if (current === null || current === undefined) return [];

    // `items[0]` — index into an array.
    const indexed = raw.match(/^([^[\]]+)\[(\d+)\]$/);
    if (indexed) {
      const key = indexed[1];
      const arr = Array.isArray(current) ? current : current[key];
      if (!Array.isArray(arr)) return [];
      const v = arr[Number(indexed[2])];
      if (i === last) return Array.isArray(v) ? v : (v == null ? [] : [v]);
      // Not terminal: keep walking with that element.
      current = v;
      continue;
    }

    // A segment landing on an array: the path continues *inside each element*.
    // `data.attributes.status` must reach `.status` on both elements, so
    // non-final segments fan out and recurse rather than returning the
    // intermediate objects.
    if (Array.isArray(current)) {
      const collected: Json[] = [];
      for (const item of current) {
        const v = item?.[raw];
        if (v === null || v === undefined) continue;
        if (i === last) {
          if (Array.isArray(v)) collected.push(...v);
          else collected.push(v);
        } else {
          for (const deeper of resolvePath(v, segments.slice(i + 1).join("."))) {
            collected.push(deeper);
          }
        }
      }
      return collected;
    }

    current = current[raw];
  }

  // The path ended on an array: return its elements, so a caller asking for
  // "the list" gets a list rather than the array object.
  if (Array.isArray(current)) return current;
  return current === null || current === undefined ? [] : [current];
}

/** First value at `path`, coerced to a trimmed string. */
function readStr(root: Json, path: string | undefined, baseUrl = ""): string {
  if (!path) return "";
  const values = resolvePath(root, path);
  for (const v of values) {
    const s = toText(v);
    if (s) return s;
  }
  return "";
}

/**
 * Coerce a JSON value to display text.
 *
 * Localised fields are objects (`{en: "One Piece", ja: "ワンピース"}`), so an
 * object value has to be unwrapped rather than stringified — otherwise every
 * MangaDex title would read "[object Object]". Prefers English, then any
 * Latin-script value, then the first available.
 */
function toText(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) {
    for (const item of v) {
      const s = toText(item);
      if (s) return s;
    }
    return "";
  }
  if (typeof v === "object") {
    if (typeof v.en === "string") return v.en.trim();
    for (const val of Object.values(v)) {
      if (typeof val === "string" && val.trim()) return val.trim();
    }
  }
  return "";
}

function toAbs(baseUrl: string, u: string): string {
  if (!u) return "";
  if (/^https?:\/\//i.test(u)) return u;
  if (u.startsWith("//")) return "https:" + u;
  return baseUrl.replace(/\/+$/, "") + "/" + u.replace(/^\/+/, "");
}

/**
 * Attach paging params and caller variables to a url template.
 *
 * The caller's vars (notably `query`) must be folded in *here* rather than
 * expanded beforehand — expanding `{query}` without a query in scope silently
 * produces `?q=`, which looks like a valid request and returns nothing.
 */
function withPaging(
  template: string,
  page: number,
  rule: { pageParam?: string; limit?: number },
  extra: Record<string, string | number | undefined> = {}
): string {
  let out = expandJsonTemplate(template, { ...extra, page, limit: rule.limit });
  if (rule.pageParam) {
    const sep = out.includes("?") ? "&" : "?";
    out += `${sep}${rule.pageParam}=${page}`;
  }
  return out;
}

function expandJsonTemplate(template: string, vars: Record<string, string | number | undefined>): string {
  return template.replace(/\{(\w+)\}/g, (_m, key: string) => {
    const v = vars[key];
    if (v === undefined || v === null) return "";
    const raw = String(v);
    return key === "query" ? encodeURIComponent(raw) : raw;
  });
}

/**
 * Build a client for a JSON source.
 *
 * `fetcher` is injected so the test suite can run this offline, and so the
 * production path can route through the Worker relay.
 */
export function createJsonClient(
  plugin: SourcePlugin,
  fetcher: (url: string) => Promise<Json>
) {
  const j = plugin.endpoints.json;
  if (!j) throw new Error(`${plugin.name} has no json endpoints`);
  const baseUrl = plugin.baseUrl;

  async function loadJson(url: string): Promise<Json | null> {
    try {
      // A relative path in a plugin means "relative to the source's baseUrl".
      const full = /^https?:\/\//i.test(url) ? url : toAbs(baseUrl, url);
      const res = await fetcher(full);
      return res && typeof res === "object" ? res : null;
    } catch {
      return null;
    }
  }

  function parseList(rule: JsonListing, data: Json): Manga[] {
    const items = resolvePath(data, rule.path);
    const out: Manga[] = [];

    for (const item of items) {
      if (item === null || item === undefined) continue;
      // A field path may or may not carry `[]` depending on whether it points
      // at a scalar inside each element. Try the element first, then the
      // mapped form, so both spellings work.
      const pick = (p: string | undefined): string => {
        if (!p) return "";
        const direct = readStr(item, p);
        if (direct) return direct;
        return readStr(data, p.endsWith("[]") ? p : p + "[]");
      };

      const title = pick(rule.title);
      const rawUrl = pick(rule.url_);
      if (!title || !rawUrl) continue;

      out.push({
        url: rawUrl,
        title,
        thumbnailUrl: pick(rule.thumb) ? toAbs(baseUrl, pick(rule.thumb)) : undefined,
        author: pick(rule.author) || undefined,
        description: pick(rule.description) || undefined,
        initialized: false,
        sourceId: plugin.id,
      });
    }

    if (rule.transform?.includes("reverse")) out.reverse();
    return out;
  }

  async function list(
    rule: JsonListing | undefined,
    page: number,
    extra: Record<string, string | number | undefined> = {}
  ) {
    if (!rule) return { mangas: [] as Manga[], hasNextPage: false };
    // Caller vars and paging are expanded together in one pass — see withPaging.
    const url = withPaging(rule.url, page, rule, extra);
    const data = await loadJson(url);
    if (!data) return { mangas: [] as Manga[], hasNextPage: false };

    const mangas = parseList(rule, data);
    // A short page is the universal "no more results" signal; honour an
    // explicit flag when the API offers one.
    const more = rule.hasMore
      ? Boolean(resolvePath(data, rule.hasMore)[0])
      : mangas.length >= (rule.limit ?? mangas.length);
    return { mangas, hasNextPage: more && mangas.length > 0 };
  }

  return {
    async popular(page = 1) {
      return list(j.popular, page);
    },

    async latest(page = 1) {
      return list(j.latest, page);
    },

    async search(query: string, page = 1) {
      return list(j.search, page, { query });
    },

    async details(manga: Manga) {
      const rule = j.details;
      if (!rule) return manga;
      const url = expandJsonTemplate(rule.url, {
        mangaId: manga.url,
        mangaUrl: manga.url,
        pageId: manga.url,
      });
      const data = await loadJson(url);
      if (!data) return manga;

      // `path` unwraps the envelope (MangaDex nests everything under `data`).
      // An empty path means the response *is* the object.
      const obj = rule.path ? resolvePath(data, rule.path)[0] : data;
      if (obj === null || obj === undefined) return manga;

      const out: Manga = { ...manga };
      const title = readStr(obj, rule.title);
      if (title) out.title = title;
      const author = readStr(obj, rule.author);
      if (author) out.author = author;
      const artist = readStr(obj, rule.artist);
      if (artist) out.artist = artist;
      const desc = readStr(obj, rule.description);
      if (desc) out.description = desc;
      const thumb = readStr(obj, rule.thumbnail);
      if (thumb) out.thumbnailUrl = toAbs(baseUrl, thumb);
      if (rule.status) {
        const raw = readStr(obj, rule.status.path);
        const mapped = rule.status.map[raw];
        if (mapped) out.status = mapped as Manga["status"];
      }
      const genres = readStr(obj, rule.genres);
      if (genres) out.genres = genres.split(",").map((s) => s.trim()).filter(Boolean);
      out.initialized = true;
      return out;
    },

    async chapters(manga: Manga) {
      const rule = j.chapters;
      if (!rule) return [] as Chapter[];
      const url = expandJsonTemplate(rule.url, {
        mangaId: manga.url,
        mangaUrl: manga.url,
      });
      const data = await loadJson(url);
      if (!data) return [];

      const items = resolvePath(data, rule.path);
      const out: Chapter[] = [];

      for (const item of items) {
        if (item === null || item === undefined) continue;
        const pick = (p: string | undefined): string => {
          if (!p) return "";
          const direct = readStr(item, p);
          return direct || readStr(data, p.endsWith("[]") ? p : p + "[]");
        };
        const name = pick(rule.title);
        const id = pick(rule.url_);
        if (!name || !id) continue;
        out.push({
          url: id,
          name,
          // APIs rarely number cleanly; -1 is Tachiyomi's "unnumbered" marker.
          chapterNumber: -1,
        });
      }

      if (rule.transform?.includes("reverse")) out.reverse();
      return out;
    },

    async pages(chapter: Chapter, manga: Manga): Promise<Page[]> {
      const rule = j.pages;
      if (!rule) return [];
      const url = expandJsonTemplate(rule.url, {
        pageId: chapter.url,
        chapterUrl: chapter.url,
        mangaId: manga.url,
        mangaUrl: manga.url,
      });
      const data = await loadJson(url);
      if (!data) return [];

      const imagePath = rule.image || "url";
      const items = resolvePath(data, rule.path);
      const out: Page[] = [];

      items.forEach((item, index) => {
        if (item === null || item === undefined) return;
        const raw = readStr(item, imagePath) || (typeof item === "string" ? item : "");
        if (!raw) return;
        out.push({ index, image: toAbs(baseUrl, raw) });
      });

      return out;
    },
  };
}

export type JsonSourceClient = ReturnType<typeof createJsonClient>;
