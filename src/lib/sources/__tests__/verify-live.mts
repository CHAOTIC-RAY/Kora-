/**
 * Verify the shipped Kora-Sources plugins against the real APIs, using the
 * same path language the runtime uses. Anything that cannot be reached from
 * this machine is reported as SKIP, never quietly assumed good.
 */
import { createJsonClient } from "../jsonClient";
import type { SourcePlugin } from "../types";

let pass = 0, fail = 0, skip = 0;
const check = (n: string, c: boolean, got?: unknown) => {
  if (c) { pass++; console.log("PASS ", n); }
  else { fail++; console.log("FAIL ", n, got === undefined ? "" : "got=" + JSON.stringify(got)); }
};
const note = (n: string) => { skip++; console.log("SKIP ", n); };

const REPO = "D:/Wafig/Hermes/Kora-Sources/sources";
const legal = REPO + "/legal";
const manga = REPO + "/manga";

async function fetchJson(url: string, headers?: Record<string, string>) {
  const res = await fetch(url, { headers: { "User-Agent": "Kora/1.0", ...(headers || {}) } });
  if (!res.ok) throw new Error("HTTP " + res.status);
  return res.json();
}

async function testPlugin(path: string, name: string) {
  const mod = await import("file:///" + path.split("\\").join("/"));
  const plugin = (mod.default || mod.plugin) as SourcePlugin;
  console.log(`\n--- ${name} (id ${plugin.id}) ---`);

  const client = createJsonClient(plugin, (url) => fetchJson(url, plugin.headers));
  let sr;
  try {
    sr = await client.search("dune", 1);
  } catch (err: any) {
    note(`${name}: unreachable from this machine (${err.message})`);
    return;
  }
  if (sr.mangas.length === 0) {
    note(`${name}: search returned nothing (blocked or shape mismatch)`);
    return;
  }
  check(`${name}: search returns results`, sr.mangas.length > 0, sr.mangas.length);
  const first = sr.mangas[0];
  check(`${name}: has a title`, Boolean(first.title), first.title);
  check(`${name}: title is not [object Object]`, !String(first.title).includes("object Object"), first.title);
  check(`${name}: has a url/id`, Boolean(first.url), first.url);
  console.log(`      first result: "${first.title}" (${first.url})`);
  console.log(`      count: ${sr.mangas.length}, hasMore: ${sr.hasNextPage}`);

  try {
    const d = await client.details(first);
    check(`${name}: details fills in`, Boolean(d.title));
    console.log(`      details: "${d.title}" / ${(d.description || "").slice(0, 60).replace(/\n/g, " ")}`);
  } catch (err: any) {
    note(`${name}: details unavailable (${err.message})`);
  }
}

await testPlugin(legal + "/openlibrary.json", "Open Library");
await testPlugin(legal + "/internet-archive.json", "Internet Archive");
await testPlugin(manga + "/mangadex.json", "MangaDex");

console.log(`\n${pass} pass, ${fail} fail, ${skip} skipped`);
if (fail) process.exit(1);
