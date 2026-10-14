/**
 * Run the real Madara client against a live details page and report what
 * each field actually comes back as.
 *
 * The user sees no synopsis even though the page clearly contains one, so
 * the failure is somewhere between fetch and render. This prints the parsed
 * values so the gap is visible rather than guessed at.
 */
import { createMadaraClient } from "../src/lib/sources/madara";
import type { SourcePlugin } from "../src/lib/sources/types";

const target = process.argv[2] || "https://mangazin.org/manga/beauty-and-the-beasts/";

const def = {
  id: "MangaZin",
  name: "MangaZin",
  baseUrl: "https://mangazin.org",
  version: "1",
  lang: "en",
  theme: "madara",
  kind: "manga",
  piracy: true,
  enabled: false,
  icon: "",
  madara: { mangaSubString: "manga", popularOrderBy: "views", latestOrderBy: "update" },
} as unknown as SourcePlugin;

const relay = async (url: string) => {
  const r = await fetch(
    "https://kora.chaoticstudio.workers.dev/api/source-fetch?u=" + encodeURIComponent(url)
  );
  return (await r.json()).body || "";
};

const c = createMadaraClient(def, relay);
const d = await c.details({ url: target, id: target, title: "", initialized: false });

const show = (k: string, v: unknown) => {
  const s = v === undefined || v === null ? "" : String(v);
  console.log(`  ${k.padEnd(12)} ${s ? `len=${s.length}  "${s.slice(0, 90)}"` : "*** EMPTY ***"}`);
};

console.log("details() for", target);
show("title", d.title);
show("author", d.author);
show("status", d.status);
show("description", d.description);
show("thumbnail", d.thumbnailUrl);
show("genres", (d as unknown as { genres?: string[] }).genres);
