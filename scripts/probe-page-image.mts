/**
 * Why does a chapter page image fail to load?
 *
 * The reader shows an error card, and before the retry UI existed it just
 * showed black. This fetches a real chapter's page list through the Worker
 * relay, then tries each image the way the browser would — and with a
 * Referer, because Madara CDNs are known to hotlink-protect.
 */
import { createMadaraClient } from "../src/lib/sources/madara";
import type { SourcePlugin } from "../src/lib/sources/types";

const site = process.argv[2] || "MangaZin";
const base = site === "S2Read" ? "https://s2read.com" : "https://mangazin.org";
const sub = site === "S2Read" ? "manga" : "manga";

const def = {
  id: site,
  name: site,
  baseUrl: base,
  version: "1",
  lang: "en",
  theme: "madara",
  kind: "manga",
  piracy: true,
  enabled: false,
  icon: "",
  madara: { mangaSubString: sub, popularOrderBy: "views", latestOrderBy: "update" },
} as unknown as SourcePlugin;

const relay = async (url: string) => {
  const r = await fetch(
    "https://kora.chaoticstudio.workers.dev/api/source-fetch?u=" + encodeURIComponent(url)
  );
  return (await r.json()).body || "";
};

const c = createMadaraClient(def, relay);
const pop = await c.popular(1);
const first = pop.mangas[0];
console.log("series:", first?.title, "\n  ", first?.url);

const chs = await c.chapters(first!);
console.log("chapters:", chs.length);

// `pages()` takes only the chapter — the series is already bound by the
// client created above. Passing it a second time is a type error and would
// have silently ignored the series had the signature been looser.
const pages = await c.pages(chs[0]!);
console.log("pages:", pages.length);
if (!pages.length) {
  console.log("NO PAGES RETURNED — nothing to test");
  process.exit(0);
}

for (const p of pages.slice(0, 4)) {
  const url = p.image;
  const bare = await fetch(url, { method: "GET" });
  const withRef = await fetch(url, { method: "GET", headers: { Referer: base + "/" } });
  const bytes = bare.headers.get("content-length") || "?";
  console.log(
    `  ${bare.status} bare / ${withRef.status} withRef  ${bare.headers.get("content-type")}  len=${bytes}  ${url.slice(0, 62)}`
  );
}

// Also try the relay itself, which is how the app could fetch if direct
// loading is blocked by CORS or hotlinking.
const firstUrl = pages[0]!.image;
const relayed = await fetch(
  "https://kora.chaoticstudio.workers.dev/api/source-fetch?u=" +
    encodeURIComponent(firstUrl) +
    "&r=" +
    encodeURIComponent(base + "/")
);
const body = await relayed.text();
console.log("via worker relay:", relayed.status, relayed.headers.get("content-type"), "bytes:", body.length);
