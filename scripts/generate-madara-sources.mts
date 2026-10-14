/**
 * Generate Kora source definitions for the Madara sites that passed a live
 * end-to-end test (listings -> details -> chapters -> page images).
 *
 * Only sites with working page images are written. A card that opens to an
 * empty reader is worse than no card, so the test is the gate, not the
 * index.
 *
 * Reads: /d/Wafig/Hermes/Kora-Sources/sources/manga/
 */
import { createSourceClient } from "../src/lib/sources/client";
import type { SourcePlugin } from "../src/lib/sources/types";
import { writeFileSync, mkdirSync } from "node:fs";

const RELAY = "https://kora.chaoticstudio.workers.dev";
const real = globalThis.fetch;
globalThis.fetch = ((input: any, init: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  return real(url.startsWith("/") ? RELAY + url : url, init);
}) as typeof fetch;

const OUT = "D:/Wafig/Hermes/Kora-Sources/sources/manga";
mkdirSync(OUT, { recursive: true });

/** name, baseUrl, slug, icon path (under static/), optional overrides */
const VERIFIED: {
  name: string;
  base: string;
  slug: string;
  version: string;
  icon: string;
  madara?: Record<string, string>;
}[] = [
  { name: "MangaZin", base: "https://mangazin.org", slug: "mangazin", version: "1.0.0-alpha.92", icon: "mangazin.png" },
  { name: "MangaReadOrg", base: "https://mangaread.org", slug: "mangaread-org", version: "1.0.0-alpha.92", icon: "mangaread-org.png" },
  { name: "ManhuaPlus", base: "https://manhuaplus.com", slug: "manhuaplus", version: "1.0.0-alpha.92", icon: "manhuaplus.png" },
  { name: "Manhuaus", base: "https://manhuaus.com", slug: "manhuaus", version: "1.0.0-alpha.92", icon: "manhuaus.png" },
];

/**
 * Gen 2 ids are 64-bit. These are synthetic but stable per slug:
 * a source must keep its id forever, because the id is how an installed
 * plugin is recognised across app versions.
 */
function idFor(slug: string): string {
  let h1 = 0x811c9dc5;
  for (let i = 0; i < slug.length; i++) {
    h1 ^= slug.charCodeAt(i);
    h1 = Math.imul(h1, 0x01000193) >>> 0;
  }
  return `4503604${String(h1).padStart(12, "0")}`.slice(0, 19);
}

for (const v of VERIFIED) {
  const id = idFor(v.slug);
  const def = {
    // Quoted: a 64-bit Gen 2 id is 19 digits, which JSON.parse cannot hold
    // exactly. As a number it silently rounds, and the installed plugin no
    // longer matches its registry entry.
    id,
    name: v.name,
    baseUrl: v.base,
    version: v.version,
    lang: "en",
    theme: "madara",
    kind: "manga",
    piracy: true,
    nsfw: false,
    enabled: false,
    website: v.base,
    icon: `https://github.com/CHAOTIC-RAY/Kora-Sources/raw/main/sources/manga/icons/${v.icon}`,
    description: `${v.name} — a Madara-hosted manga site, read through the shared Kora Madara engine.`,
    madara: { mangaPath: "/manga/", popularPath: "/manga/?status=hot&page=1", ...(v.madara || {}) },
  } as unknown as SourcePlugin;

  // Re-verify at generation time so a file is only written for a site that
  // still works right now, not when the list was first scraped.
  const c = createSourceClient(def);
  const page = await c.popular(1);
  if (!page.mangas.length) {
    console.log(`SKIP ${v.name}: no listings`);
    continue;
  }
  const d = await c.details(page.mangas[0]);
  const ch = d.initialized ? await c.chapters(d) : [];
  const pg = ch.length ? await c.pages(ch[0], d) : [];
  if (!ch.length || !pg.length) {
    console.log(`SKIP ${v.name}: ${ch.length} ch, ${pg.length} pages`);
    continue;
  }

  writeFileSync(
    `${OUT}/${v.slug}.json`,
    JSON.stringify(def, null, 2) + "\n",
    "utf8"
  );
  console.log(
    `OK ${v.name} -> ${v.slug}.json  id=${id}  ${page.mangas.length} listings, ${ch.length} ch, ${pg.length} pages`
  );
}
