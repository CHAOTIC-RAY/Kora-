/**
 * Run the Madara engine against live sites.
 *
 * A Madara source is only shippable if listing, details, chapters AND pages
 * all come back non-empty. Anything short of that is reported as a failure
 * with the stage that broke, not silently skipped.
 */
import { createMadaraClient } from "../madara";
import type { SourcePlugin } from "../types";

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36";

let pass = 0, fail = 0;
const ok = (n: string, c: boolean, got?: unknown) => {
  if (c) { pass++; console.log("  PASS ", n); }
  else { fail++; console.log("  FAIL ", n, got === undefined ? "" : `-> ${JSON.stringify(got)}`); }
};

async function fetchHtml(url: string, referer?: string) {
  const headers: Record<string, string> = { "User-Agent": UA, Accept: "text/html" };
  if (referer) headers.Referer = referer;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 25000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error("HTTP " + res.status);
    return await res.text();
  } finally {
    clearTimeout(t);
  }
}

const SITES: Array<[string, string, string?]> = [
  ["ManhwaHot", "https://manhuahot.com"],
  ["S2Read", "https://s2read.com"],
  ["MangaZin", "https://mangazin.org"],
  ["MHS Scans", "https://mhscans.com"],
];

for (const [name, baseUrl, sub] of SITES) {
  console.log(`\n=== ${name} (${baseUrl}) ===`);
  const plugin = {
    id: name, name, lang: "en", version: 1, nsfw: false, kind: "manga",
    baseUrl, theme: "madara", endpoints: {},
    ...(sub ? { madara: { mangaSubString: sub } } : {}),
  } as unknown as SourcePlugin;

  const c = createMadaraClient(plugin, fetchHtml);

  let first: any = null;
  try {
    const sr = await c.popular(1);
    ok("listing returns manga", sr.mangas.length > 0, sr.mangas.length);
    console.log(`         count=${sr.mangas.length} hasNext=${sr.hasNextPage}`);
    if (sr.mangas[0]) {
      first = sr.mangas[0];
      ok("card has a title", Boolean(first.title) && first.title !== "Untitled", first.title);
      ok("card title is real text", !/^https?:/.test(first.title), first.title);
      ok("card has a cover", Boolean(first.thumbnailUrl), first.thumbnailUrl?.slice(0, 60));
      console.log(`         first: "${first.title}" -> ${first.url}`);
    }
  } catch (e: any) { ok("listing returns manga", false, e.message); }

  if (!first) { fail++; continue; }

  try {
    const d = await c.details(first);
    ok("details fills title", Boolean(d.title) && d.title.length > 1, d.title);
    ok("details fills status", typeof d.status === "number" && d.status > 0, d.status);
    console.log(`         author=${(d.author || "-").slice(0, 28)} status=${d.status}`);
  } catch (e: any) { ok("details", false, e.message); }

  let chs: any[] = [];
  try {
    chs = (await c.chapters(first)).filter((ch) => ch.url && ch.url !== "#");
    ok("chapters found", chs.length > 0, chs.length);
    if (chs[0]) {
      ok("chapter has a url", /^https?:/.test(chs[0].url), chs[0].url?.slice(0, 50));
      ok("chapter name is text", Boolean(chs[0].name) && !/^https?:/.test(chs[0].name), chs[0].name?.slice(0, 40));
    }
  } catch (e: any) { ok("chapters found", false, e.message); }

  if (chs[0]) {
    try {
      // Many sites gate the newest chapters; a locked chapter renders as an
      // ad placeholder with no panels, which would read as "0 pages" and
      // wrongly fail a perfectly good source. Walk forward to a chapter that
      // actually has images.
      let pg: any[] = [];
      let used = chs[0];
      for (const ch of chs.slice(0, 6)) {
        const attempt = await c.pages(ch);
        if (attempt.length > 0) { pg = attempt; used = ch; break; }
      }
      ok("pages found", pg.length > 0, pg.length);
      ok("page images are urls", pg.every((p) => /^https?:/.test(p.image)), pg[0]?.image?.slice(0, 55));
      ok("no placeholder images", !pg.some((p) => /dflazy|placeholder|thumbnail/i.test(p.image)));
      console.log(`         chapter="${used.name?.slice(0, 34)}" pages=${pg.length} first=${pg[0]?.image?.slice(0, 70)}`);
    } catch (e: any) { ok("pages found", false, e.message); }
  }
}

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
