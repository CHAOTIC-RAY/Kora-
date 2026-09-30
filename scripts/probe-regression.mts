import { createMadaraClient } from "../src/lib/sources/madara";
import type { SourcePlugin } from "../src/lib/sources/types";

const targets = [
  ["MangaZin", "https://mangazin.org", "https://mangazin.org/manga/beauty-and-the-beasts/"],
  ["MangaZin", "https://mangazin.org", "https://mangazin.org/manga/return-of-the-mount-hua-sect/"],
  ["S2Read", "https://s2read.com", "https://s2read.com/manga/solo-leveling/"],
  ["S2Read", "https://s2read.com", "https://s2read.com/manga/return-of-the-mount-hua-sect/"],
  ["MangaReadOrg", "https://mangaread.org", "https://mangaread.org/manga/"],
  ["ManhuaPlus", "https://manhuaplus.com", "https://manhuaplus.com/"],
  ["Manhuaus", "https://manhuaus.com", "https://manhuaus.com/"],
] as const;

const relay = async (url: string) => {
  const r = await fetch("https://kora.chaoticstudio.workers.dev/api/source-fetch?u=" + encodeURIComponent(url));
  return ((await r.json()) as { body?: string }).body || "";
};

for (const [id, baseUrl, probe] of targets) {
  const def = {
    id, name: id, baseUrl, version: "1", lang: "en", theme: "madara", kind: "manga",
    piracy: true, enabled: false, icon: "",
    madara: { mangaSubString: "manga", popularOrderBy: "views", latestOrderBy: "update" },
  } as unknown as SourcePlugin;
  const c = createMadaraClient(def, relay);
  try {
    if (probe.endsWith("/manga/") || probe === "https://manhuaplus.com/" || probe === "https://manhuaus.com/") {
      const l = await c.popular(1);
      const sample = l.mangas[0];
      console.log(
        `${id.padEnd(14)} listing n=${String(l.mangas.length).padEnd(3)} hasNext=${l.hasNextPage} ` +
        `title=${JSON.stringify(sample?.title)} cover=${JSON.stringify(sample?.thumbnailUrl?.slice(0, 70))} ` +
        `badCover=${!!sample?.thumbnailUrl && /\.(js|css|json|php)(\?|#|$)/i.test(sample.thumbnailUrl)}`
      );
    } else {
      const d = await c.details({ url: probe, id: probe, title: "", initialized: false } as never);
      console.log(
        `${id.padEnd(14)} ${probe.replace(/^https?:\/\/[^/]+/, "")}\n` +
        `   title       ${JSON.stringify(d.title)} (len ${(d.title || "").length})\n` +
        `   author      ${JSON.stringify((d.author || "").slice(0, 60))}\n` +
        `   status      ${d.status}\n` +
        `   thumbnail   ${JSON.stringify(d.thumbnailUrl?.slice(0, 90))}\n` +
        `   genres      ${JSON.stringify((d as { genres?: string[] }).genres)}\n` +
        `   desc[0:110] ${JSON.stringify((d.description || "").slice(0, 110))} (len ${(d.description || "").length})`
      );
    }
  } catch (e) {
    console.log(`${id.padEnd(14)} ${probe}  ERROR ${(e as Error).message}`);
  }
}
