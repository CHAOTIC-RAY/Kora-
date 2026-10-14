/**
 * Prove every registry source can actually be READ, using the same engine
 * the app uses.
 *
 * This started as a scraper inside the Kora-Sources repo and was the wrong
 * call. It re-implemented listing and chapter parsing in ~150 lines, and
 * within one run it disagreed with itself: it passed S2Read and ManhuaPlus
 * with a loose href test, then failed both once the test was tightened. A
 * gate that re-implements the thing it is gating will drift from it, and a
 * gate that gives the wrong answer gets ignored.
 *
 * So the check lives here, in the app, and drives `createMadaraClient` —
 * the same 46-test parser the user reads with. If this says a source works,
 * the app agrees by construction.
 *
 *   node node_modules/tsx/dist/cli.mjs scripts/verify-registry-readable.mts
 *   node node_modules/tsx/dist/cli.mjs scripts/verify-registry-readable.mts --write
 *
 * Output: sources-readable.json, which Kora-Sources' build-index consumes so
 * an unreadable source cannot be published.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { join, dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { createMadaraClient } from "../src/lib/sources/madara";
import { createSourceClient } from "../src/lib/sources/client";
import type { SourcePlugin } from "../src/lib/sources/types";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");

/**
 * Where the registry definitions live. Configurable, because the sibling app
 * checkout is the only place this script can reach and a hardcoded absolute
 * path (D:/Wafig/Hermes/Kora-Sources) works on exactly one machine and fails
 * on CI. Kora-Sources' scripts/verify-readable.mjs sets this and is the
 * supported entry point; a bare run defaults to a sibling ../Kora-Sources.
 */
const SOURCES = resolve(process.env.KORA_SOURCES_DIR || join(ROOT, "..", "Kora-Sources", "sources"));
const OUT = process.env.KORA_READABLE_OUT || join(ROOT, "sources-readable.json");

const argv = process.argv.slice(2);
const WRITE = argv.includes("--write");
const ONLY = argv.filter((a) => !a.startsWith("--"));

const TIMEOUT = 25_000;
const PRODUCTION = "https://kora.chaoticstudio.workers.dev";

/**
 * Fetch through the deployed Worker relay, which is how the app reaches
 * these sites — including the Referer the Madara CDNs need and the
 * cloud-metadata block. Fetching straight from here instead would test a
 * code path the app never uses.
 */
async function relay(url: string, referer: string): Promise<string> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const r = await fetch(
      `${PRODUCTION}/api/source-fetch?u=${encodeURIComponent(url)}&r=${encodeURIComponent(referer)}`,
      { signal: ac.signal }
    );
    const j = (await r.json()) as { body?: string };
    return j.body || "";
  } finally {
    clearTimeout(t);
  }
}

/** Is this thing actually an image, or an error page dressed as one? */
async function imageIsServed(url: string, referer: string): Promise<{ ok: boolean; why: string }> {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT);
  try {
    const r = await fetch(url, { signal: ac.signal, redirect: "follow", headers: { Referer: referer } });
    const type = r.headers.get("content-type") || "";
    if (r.status !== 200) return { ok: false, why: `HTTP ${r.status}` };
    if (!/^image\//i.test(type)) return { ok: false, why: `content-type ${type || "none"}` };
    return { ok: true, why: type };
  } catch (e) {
    const m = String((e as Error)?.message || e);
    return { ok: false, why: /fetch failed/i.test(m) ? "network/TLS failure" : m.slice(0, 40) };
  } finally {
    clearTimeout(t);
  }
}

type Verdict = "readable" | "unreadable" | "unreachable" | "not-applicable";

interface Result {
  id: string;
  name: string;
  file: string;
  verdict: Verdict;
  stage: string;
  detail: string;
  checkedAt: string;
}

async function verify(def: any, file: string): Promise<Result> {
  const base = { id: String(def.id), file, name: def.name, checkedAt: new Date().toISOString() };
  const category = def.category || "source";
  if (category !== "source") {
    return { ...base, verdict: "not-applicable", stage: "category", detail: category };
  }

  // A JSON book source is addressed by API; there are no panels to fetch.
  if (def.theme !== "madara" && !def.madara) {
    return { ...base, verdict: "not-applicable", stage: "kind", detail: "api source" };
  }

  const client = createMadaraClient(def as unknown as SourcePlugin, relay);

  let page: { mangas?: any[]; hasNextPage?: boolean };
  try {
    page = await client.popular(1);
  } catch (e) {
    const m = String((e as Error)?.message || e);
    return {
      ...base,
      verdict: /fetch failed|abort/i.test(m) ? "unreachable" : "unreadable",
      stage: "listing",
      detail: m.slice(0, 60),
    };
  }
  if (!page.mangas?.length) {
    return { ...base, verdict: "unreadable", stage: "listing", detail: "no series returned" };
  }

  const manga = page.mangas[0];
  let chapters: any[];
  try {
    chapters = await client.chapters(manga);
  } catch (e) {
    return { ...base, verdict: "unreadable", stage: "chapters", detail: String((e as Error)?.message).slice(0, 50) };
  }
  if (!chapters.length) {
    return { ...base, verdict: "unreadable", stage: "chapters", detail: "series lists no chapters" };
  }

  // Try up to three chapters: a site can serve one and 404 the rest, and a
  // single unlucky pick would fail a source that mostly works.
  const tried: string[] = [];
  for (const ch of chapters.slice(0, 3)) {
    let pages: any[];
    try {
      pages = await client.pages(ch);
    } catch (e) {
      return { ...base, verdict: "unreadable", stage: "pages", detail: String((e as Error)?.message).slice(0, 50) };
    }
    if (!pages.length) continue;
    const url = pages[0].image;
    tried.push(url);
    const r = await imageIsServed(url, ch.url);
    if (r.ok) {
      return {
        ...base,
        verdict: "readable",
        stage: "ok",
        detail: `${pages.length} pages in "${ch.name}", ${r.why}`,
      };
    }
  }

  const reason = tried.length
    ? `panel not served for ${tried.length} chapter(s)`
    : "chapters returned no page images";
  return { ...base, verdict: "unreadable", stage: "panels", detail: reason };
}

/* ------------------------------------------------------------------ run */

async function collect(dir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: string[];
  try {
    entries = await readdir(dir, { withFileTypes: true } as any).then((e: any) => e.map((x: any) => x.name));
  } catch {
    return out;
  }
  // readdir above loses the dirent type; re-read properly.
  let dirents: any[];
  try {
    dirents = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of dirents) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await collect(p)));
    else if (e.name.endsWith(".json")) out.push(p);
  }
  return out;
}

const files = (await collect(SOURCES)).sort();
const results: Result[] = [];

for (const file of files) {
  let def: any;
  try {
    def = JSON.parse(await readFile(file, "utf8"));
  } catch {
    continue;
  }
  if (ONLY.length && !ONLY.some((o) => String(def.name).toLowerCase().includes(o.toLowerCase()))) continue;

  // Store the path relative to the sources root, not the absolute path it was
  // read from. The output file is committed and shared, so an absolute path
  // leaks the maintainer's machine layout (D:/Wafig/...) into the repo and makes
  // the record meaningless to anyone else. The `id` is the real key anyway.
  const rel = relative(SOURCES, file).split(/[\\/]/).join("/");
  const r = await verify(def, rel);
  results.push(r);
  const tag =
    r.verdict === "readable" ? " ok " : r.verdict === "unreadable" ? "FAIL" : r.verdict === "unreachable" ? "warn" : "skip";
  console.log(`${tag}  ${String(r.name).padEnd(22)} [${r.stage}] ${r.detail}`);
}

const counts = results.reduce<Record<string, number>>((a, r) => {
  a[r.verdict] = (a[r.verdict] || 0) + 1;
  return a;
}, {});

console.log(
  `\n${results.length} sources: ${counts.readable || 0} readable, ${counts.unreadable || 0} unreadable, ` +
    `${counts.unreachable || 0} unreachable, ${counts["not-applicable"] || 0} not applicable`
);

if (WRITE) {
  await writeFile(OUT, JSON.stringify({ generatedAt: new Date().toISOString(), results }, null, 2) + "\n", "utf8");
  console.log(`\nwrote ${OUT}`);

  // Stamp each definition, so the registry itself records the verdict and
  // not only this run's console output.
  for (const r of results) {
    if (!r.file) continue;
    const f = r.file;
    let def: any;
    try {
      def = JSON.parse(await readFile(f, "utf8"));
    } catch {
      continue;
    }
    def.readable = r.verdict === "readable" || r.verdict === "not-applicable";
    def.readableCheckedAt = r.checkedAt;
    if (r.verdict === "unreadable") def.readableNote = `${r.stage}: ${r.detail}`;
    else delete def.readableNote;
    await writeFile(f, JSON.stringify(def, null, 2) + "\n", "utf8");
  }
  console.log("stamped each definition with readable / readableNote");
}

if (counts.unreadable) {
  console.log(
    "\nA source that lists series and chapters but serves no page image is not\n" +
      "readable, and must not be published as working. Remove it, or mark it\n" +
      "unreadable in the registry with the reason recorded."
  );
  process.exitCode = 1;
}
