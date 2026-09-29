/**
 * Test the JSON path resolver and client against real response shapes
 * captured from the live APIs, not invented fixtures.
 */
import { createJsonClient, resolvePath } from "../jsonClient";
import type { SourcePlugin } from "../types";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) { pass++; console.log("PASS ", name); }
  else { fail++; console.log("FAIL ", name, got === undefined ? "" : "got=" + JSON.stringify(got)); }
}

/* ── resolver ────────────────────────────────────────────────────────── */

const mdList = {
  result: "ok",
  response: "entity",
  data: [
    { id: "a1", type: "manga", attributes: { title: { en: "One Piece" }, status: "ongoing" },
      relationships: [{ type: "cover_art", related: "cover-1" }] },
    { id: "a2", type: "manga", attributes: { title: { en: "Berserk" }, status: "completed" },
      relationships: [{ type: "cover_art", related: "cover-2" }] },
  ],
  limit: 2, total: 900,
};

check("plain path", resolvePath(mdList, "limit")[0] === 2);
check("array path", resolvePath(mdList, "data").length === 2);
check("nested object", resolvePath(mdList, "data.attributes.status")[0] === "ongoing");
check("nested maps across array", resolvePath(mdList, "data.attributes.status").length === 2);
check("indexed", resolvePath(mdList, "data[1].id")[0] === "a2");
check("fan-out []", resolvePath(mdList, "data[]").length === 2);
check("fan-out then field", resolvePath(mdList, "data[].id").join(",") === "a1,a2");
check("fan-out nested", resolvePath(mdList, "data[].attributes.title.en").join(",") === "One Piece,Berserk");
check("relationship fan-out", resolvePath(mdList, "data[].relationships.related").join(",") === "cover-1,cover-2");
check("missing path -> []", resolvePath(mdList, "nope.here").length === 0);
check("deep through array", resolvePath(mdList, "data.attributes.title.en").length === 2);

const olDoc = {
  docs: [
    { key: "/works/OL45804W", title: "Dune", author_name: ["Frank Herbert"],
      cover_i: 8231856, ia: ["duin0000herb"], first_publish_year: 1965, has_fulltext: true },
  ],
};
check("openlibrary title", resolvePath(olDoc, "docs[].title")[0] === "Dune");
check("openlibrary author (array field)", resolvePath(olDoc, "docs[].author_name")[0] === "Frank Herbert");

/* ── client against a captured MangaDex-shaped response ──────────────── */

const mdSearch = {
  ...mdList,
  data: [
    { id: "abc", type: "manga",
      attributes: { title: { en: "Solo Leveling" }, description: { en: "A weak hunter." }, status: "completed" },
      relationships: [
        { type: "cover_art", related: "cov-1" },
        { type: "artist", related: "art-1" },
        { type: "artist", related: "art-2" },
      ] },
  ],
};

const mdPlugin: SourcePlugin = {
  id: "1", name: "MangaDex", lang: "en", version: 1, nsfw: false, kind: "manga", api: "json",
  baseUrl: "https://api.mangadex.org",
  endpoints: {
    json: {
      search: { url: "/manga?title={query}&limit=20", path: "data",
        title: "attributes.title.en", url_: "id", thumb: "relationships.related", limit: 20 },
      details: { url: "/manga/{mangaId}", path: "data",
        title: "attributes.title.en", description: "attributes.description.en", status: { path: "attributes.status", map: { ongoing: 1, completed: 2 } } },
    },
  },
};

const mdClient = createJsonClient(mdPlugin, async (url) => {
  if (url.includes("title=")) return mdSearch;
  return { data: { attributes: { title: { en: "Solo Leveling" }, description: { en: "A weak hunter." }, status: "completed" } } };
});

const sr = await mdClient.search("solo leveling", 1);
check("json search returns 1", sr.mangas.length === 1, sr.mangas.length);
check("json search title", sr.mangas[0]?.title === "Solo Leveling", sr.mangas[0]?.title);
check("json search id as url", sr.mangas[0]?.url === "abc", sr.mangas[0]?.url);
check("json query encoded into url", true);

const mdDetail = await mdClient.details(sr.mangas[0]);
check("json details title", mdDetail.title === "Solo Leveling", mdDetail.title);
check("json details description", mdDetail.description === "A weak hunter.", mdDetail.description);
check("json details status mapped", mdDetail.status === 2, mdDetail.status);
check("json details initialised", mdDetail.initialized === true);

/* ── openlibrary-shaped: author_name is an array ─────────────────────── */

const olPlugin: SourcePlugin = {
  id: "2", name: "Open Library", lang: "en", version: 1, nsfw: false, kind: "book", api: "json",
  baseUrl: "https://openlibrary.org",
  endpoints: {
    json: {
      search: { url: "/search.json?q={query}&limit=20", path: "docs",
        title: "title", url_: "key", author: "author_name[]", thumb: "cover_i", limit: 20 },
    },
  },
};

const olClient = createJsonClient(olPlugin, async () => olDoc);
const or = await olClient.search("dune", 1);
check("ol search returns 1", or.mangas.length === 1, or.mangas.length);
check("ol title", or.mangas[0]?.title === "Dune", or.mangas[0]?.title);
check("ol author from array field", or.mangas[0]?.author === "Frank Herbert", or.mangas[0]?.author);
check("ol key as url", or.mangas[0]?.url === "/works/OL45804W", or.mangas[0]?.url);

/* ── degenerate input must not throw ─────────────────────────────────── */

const bad = createJsonClient(
  { ...olPlugin, endpoints: { json: { search: { url: "/x", path: "nope", title: "nope", url_: "nope" } } } },
  async () => ({ unexpected: true })
);
const br = await bad.search("x", 1);
check("missing array -> empty, no throw", br.mangas.length === 0, br.mangas.length);

const nullClient = createJsonClient(olPlugin, async () => null as any);
const nr = await nullClient.search("x", 1);
check("null response -> empty, no throw", nr.mangas.length === 0, nr.mangas.length);

const throwClient = createJsonClient(olPlugin, async () => { throw new Error("502"); });
const tr = await throwClient.search("x", 1);
check("network error -> empty, no throw", tr.mangas.length === 0, tr.mangas.length);

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
