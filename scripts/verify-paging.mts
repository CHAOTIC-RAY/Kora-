/**
 * Does a Madara source actually have more than one page, and does it name
 * authors on its cards?
 *
 * Both were wrong in production: the grid showed "Unknown" for every
 * author, and browsing stopped after page 1 with a "no more results"
 * message that was hardcoded rather than derived.
 */
import { createMadaraClient } from "../src/lib/sources/madara";
import type { SourcePlugin } from "../src/lib/sources/types";

const real = globalThis.fetch;
globalThis.fetch = ((i: any, init: any) => {
  const u = typeof i === "string" ? i : (i?.url ?? String(i));
  return real(u.startsWith("/") ? "https://kora.chaoticstudio.workers.dev" + u : u, init);
}) as typeof fetch;

const SITES: { name: string; base: string; sub: string }[] = [
  { name: "S2Read", base: "https://s2read.com", sub: "manga" },
  { name: "MangaZin", base: "https://mangazin.org", sub: "manga" },
  { name: "MangaReadOrg", base: "https://mangaread.org", sub: "manga" },
];

for (const s of SITES) {
  const def = {
    id: s.name,
    name: s.name,
    baseUrl: s.base,
    version: "1",
    lang: "en",
    theme: "madara",
    kind: "manga",
    piracy: true,
    enabled: false,
    icon: "",
    madara: { mangaSubString: s.sub, popularOrderBy: "views", latestOrderBy: "update" },
  } as unknown as SourcePlugin;

  const relay = async (url: string) => {
    const r = await fetch(`/api/source-fetch?u=${encodeURIComponent(url)}&r=${encodeURIComponent(s.base)}`);
    return (await r.json()).body || "";
  };
  const c = createMadaraClient(def, relay);

  const p1 = await c.popular(1);
  const p2 = p1.hasNextPage ? await c.popular(2) : null;
  const overlap = p2 ? p1.mangas.filter((a) => p2.mangas.some((b) => b.url === a.url)).length : 0;
  const withAuthor = p1.mangas.filter((m) => !!m.author).length;

  console.log(
    `${s.name.padEnd(14)} p1=${String(p1.mangas.length).padStart(2)}` +
      ` hasNext=${p1.hasNextPage ? "yes" : "no "}` +
      ` p2=${p2 ? p2.mangas.length : "-"}` +
      ` overlap=${overlap}` +
      ` authors=${withAuthor}/${p1.mangas.length}`
  );
  if (p1.mangas[0]) {
    console.log(`   e.g. "${p1.mangas[0].title}" — ${p1.mangas[0].author ?? "(none)"}`);
  }
}
