/**
 * A non-Madara HTML source must actually produce results.
 *
 * Ocean of EPUB was published as v1 with its rules nested under `endpoints.json`
 * using invented key names — `list`, `url_`, `type` — none of which the client
 * reads. It also set `api: "json"`, which makes the runtime hard-code
 * `JSON.parse` on an HTML page. So installing it returned nothing at all, while
 * looking perfectly well-formed.
 *
 * Two lessons pinned here:
 *
 *  1. **The generic HTML runtime already exists** (`fetchListing` -> `parseListing`
 *     -> `readField`). It is not Madara-only; Madara is a separate, *earlier*
 *     branch taken when `theme === "madara"`. A source that declares neither
 *     `theme` nor `api` falls through to the generic path. No new client was
 *     needed — only a correct manifest.
 *
 *  2. **Key names must match `ListingRule`.** `selector` / `title` / `url` /
 *     `thumb`, at `endpoints.search` and `endpoints.popular` (not under
 *     `endpoints.json`, which is for JSON APIs).
 *
 * This asserts the contract against the real app types, and — when the live
 * fixture is present — against the real site HTML.
 */
import fs from "node:fs";
import type {
  FieldSelector,
  ListingRule,
  SourceEndpoints,
} from "../src/lib/sources/types";

const MANIFEST = "D:/Wafig/Hermes/Kora-Sources/sources/books/oceanofepub.json";
const FIXTURE = "D:/Wafig/Hermes/cache/scratch/v2.html";

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

if (!fs.existsSync(MANIFEST)) {
  console.error(`  manifest not found: ${MANIFEST}`);
  process.exit(1);
}
const m = JSON.parse(fs.readFileSync(MANIFEST, "utf8"));

console.log("=== it must not claim to be a JSON API ===");
// `api: "json"` makes client.ts do `JSON.parse(res.body)` unconditionally.
check("no `api` flag", m.api === undefined, m.api ? `api=${m.api} would throw on HTML` : "");
check("no `theme` flag (so it takes the generic HTML path)", m.theme === undefined);

console.log("\n=== rules live at the top level, not under endpoints.json ===");
const ep: SourceEndpoints = m.endpoints;
check("endpoints.json is absent", ep.json === undefined, "that branch is JSON-only");
check("endpoints.search exists", Boolean(ep.search));
check("endpoints.popular exists", Boolean(ep.popular));

console.log("\n=== the keys match ListingRule exactly ===");
for (const name of ["search", "popular"] as const) {
  const e = ep[name];
  if (!e) {
    check(`${name} present`, false);
    continue;
  }
  const r = (e as { mangas?: ListingRule }).mangas;
  check(`${name}.mangas exists`, Boolean(r));
  if (!r) continue;
  check(`${name} uses "selector" (not "list")`, Boolean(r.selector), r.selector || "");
  check(`${name} has title`, Boolean(r.title), String(r.title || "").slice(0, 44));
  check(`${name} has url`, Boolean(r.url), String(r.url || "").slice(0, 44));
  check(`${name} has thumb`, Boolean(r.thumb));
  // The v1 mistake, named so it cannot silently return.
  const legacy = r as unknown as Record<string, unknown>;
  check(`${name} has no invented "list" key`, legacy.list === undefined);
  check(`${name} has no invented "url_" key`, legacy.url_ === undefined);
  check(`${name} has no invented "type" key`, legacy.type === undefined);
}

console.log("\n=== details uses a variable the runtime supplies ===");
check("details.url present", Boolean(ep.details?.url), ep.details?.url || "");
// client.ts substitutes {mangaUrl}; v1 used {mangaId}, which is the JSON path's
// variable and is never expanded for HTML details.
check(
  "details uses {mangaUrl}, not the JSON-only {mangaId}",
  ep.details?.url?.includes("{mangaUrl}") === true,
  ep.details?.url || ""
);

console.log("\n=== it is published honestly ===");
check("readable is false", m.readable === false, "the site serves no files");
check("readableNote explains why", (m.readableNote || "").length > 80);

console.log("\n=== the runtime branch it relies on exists in the app ===");
const client = fs.readFileSync("src/lib/sources/client.ts", "utf8");
check("generic fetchListing exists", /async function fetchListing|fetchListing\(/.test(client));
check("it calls parseListing", /parseListing\(/.test(client));
check("search falls through to fetchListing", /fetchListing\(ep, page/.test(client));
check(
  "madara is a SEPARATE earlier branch, not the only HTML path",
  /plugin\.theme === "madara"/.test(client) && /plugin\.api === "json"/.test(client),
  "no theme + no api => generic HTML"
);

if (fs.existsSync(FIXTURE)) {
  console.log("\n=== live HTML: the rules match real cards ===");
  // Loaded lazily so this file still runs without cheerio/fixture present.
  const { load } = await import("cheerio");
  const $ = load(fs.readFileSync(FIXTURE, "utf8"));
  const rule = (ep.search as { mangas: ListingRule }).mangas;
  const cards = $(rule.selector);
  check("cards matched", cards.length > 0, `${cards.length} cards`);

  let withTitle = 0;
  let withUrl = 0;
  let withThumb = 0;
  /**
   * Reduce a FieldSelector to a CSS selector.
   *
   * FieldSelector is a union: a `selector@attr` shorthand string, or an object
   * with an explicit `selector`. The manifest uses the string form, but this
   * must not assume it — a future object form would silently type-error here
   * rather than quietly testing nothing.
   */
  const bare = (field: FieldSelector): string => {
    const sel = typeof field === "string" ? field : field.selector;
    return (sel || "").split("@")[0];
  };
  cards.each((_i, el) => {
    const c = $(el);
    if (c.find(bare(rule.title)).text().trim()) withTitle++;
    if (c.find(bare(rule.url)).attr("href")) withUrl++;
    if (c.find(bare(rule.thumb)).attr("src")) withThumb++;
  });
  check("every card yields a title", withTitle === cards.length, `${withTitle}/${cards.length}`);
  check("every card yields a url", withUrl === cards.length, `${withUrl}/${cards.length}`);
  check("every card yields a cover", withThumb === cards.length, `${withThumb}/${cards.length}`);
} else {
  console.log("\n=== live HTML fixture absent — skipping DOM assertions ===");
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);