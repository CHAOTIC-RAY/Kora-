/**
 * Live-test every Madara source from the Inkdex 0.9 index.
 *
 * Proves each site actually returns parseable, downloadable titles before it
 * is offered as a Kora plugin. A site that yields nothing is reported as a
 * failure rather than shipped, because a dead card is worse than no card.
 *
 * Fetches through the live Worker relay: the client uses a relative
 * /api/ path that does not exist outside a deployed origin.
 */
import { createSourceClient } from "../src/lib/sources/client";
import type { SourcePlugin } from "../src/lib/sources/types";

const RELAY = "https://kora.chaoticstudio.workers.dev";
const real = globalThis.fetch;
globalThis.fetch = ((input: any, init: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  return real(url.startsWith("/") ? RELAY + url : url, init);
}) as typeof fetch;

interface IndexSource {
  name: string;
  description: string;
  version: string;
  icon: string;
  language: string;
  contentRating?: string;
  id: string;
}

/** The site is named in the description, e.g. "...from allporncomic.com." */
function baseUrlOf(desc: string): string | null {
  const m = desc.match(/https?:\/\/[^\s.]+(?:\.[^\s.]+)+/);
  if (m) return m[0].replace(/[.,)]+$/, "");
  const bare = desc.match(/\b((?:www\.)?[a-z0-9-]+(?:\.[a-z0-9-]+)+)\b/i);
  return bare ? `https://${bare[1]}` : null;
}

const res = await real("https://inkdex.github.io/madara-extensions/0.9/stable/versioning.json");
const index = (await res.json()) as { sources: IndexSource[] };

const only = process.argv[2];
const targets = only
  ? index.sources.filter((s) => s.name.toLowerCase() === only.toLowerCase())
  : index.sources;

const ok: string[] = [];
const failed: { name: string; base: string | null; why: string }[] = [];

for (const s of targets) {
  const base = baseUrlOf(s.description);
  if (!base) {
    failed.push({ name: s.name, base: null, why: "no url in description" });
    continue;
  }
  const plugin = {
    id: `4503604${String(Math.abs([...s.name].reduce((a, c) => a * 31 + c.charCodeAt(0) | 0, 7)))}`,
    name: s.name,
    baseUrl: base,
    version: s.version,
    lang: s.language,
    theme: "madara",
    kind: "manga",
    piracy: true,
    nsfw: s.contentRating === "ADULT",
    enabled: false,
    icon: "",
    website: base,
    madara: { mangaPath: "/manga/", popularPath: "/manga/?status=hot&page=1" },
  } as unknown as SourcePlugin;

  try {
    const c = createSourceClient(plugin);
    const page = await c.popular(1);
    if (!page.mangas.length) {
      failed.push({ name: s.name, base, why: "0 listings parsed" });
      continue;
    }
    // A source is only usable if a title can be opened AND a chapter read.
    // Parsing a listing grid proves nothing: several sites render the grid
    // from a different theme section than their chapter list.
    const detail = await c.details(page.mangas[0]);
    const chapters = detail.initialized ? await c.chapters(detail) : [];
    let pages = 0;
    if (chapters.length) pages = (await c.pages(chapters[0], detail)).length;
    if (!chapters.length) {
      failed.push({ name: s.name, base, why: "listings but no chapters" });
      continue;
    }
    if (!pages) {
      failed.push({ name: s.name, base, why: `${chapters.length} ch but no page images` });
      continue;
    }
    ok.push(
      `${s.name}\t${base}\t${page.mangas.length} listings\t` +
        `${chapters.length} ch\t${pages} pages`
    );
  } catch (e) {
    failed.push({ name: s.name, base, why: e instanceof Error ? e.message.slice(0, 60) : "threw" });
  }
}

console.log("=== USABLE ===");
for (const line of ok) console.log(line);
console.log("=== NOT USABLE ===");
for (const f of failed) console.log(`${f.name}\t${f.base}\t${f.why}`);
console.log(`\nSUMMARY ${ok.length} usable / ${failed.length} not usable / ${index.sources.length} total`);
