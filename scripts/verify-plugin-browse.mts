/**
 * Live check that a Madara source's popular listing parses through the client.
 *
 * Runs against a real site so the chip-browse path is proven, not assumed.
 */
import { createSourceClient } from "../src/lib/sources/client";
import type { SourcePlugin } from "../src/lib/sources/types";

const s2: SourcePlugin = {
  id: "4503604211283903000",
  name: "S2Read",
  baseUrl: "https://s2read.com",
  version: "1.4.0",
  lang: "en",
  theme: "madara",
  kind: "manga",
  piracy: true,
  enabled: false,
  icon: "",
  website: "https://s2read.com",
  madara: { mangaPath: "/manga/", popularPath: "/manga/?status=hot&page=1" },
} as unknown as SourcePlugin;

// The client fetches through the Worker relay at a relative `/api/` path,
// which does not exist outside a deployed origin. Point the global fetch at
// the live Worker so this verifies the real relay, not a stub.
const RELAY = "https://kora.chaoticstudio.workers.dev";
if (!process.env.SOURCE_RELAY_OFF) {
  const real = globalThis.fetch;
  globalThis.fetch = ((input: any, init: any) => {
    const url = typeof input === "string" ? input : input?.url ?? String(input);
    return real(url.startsWith("/") ? RELAY + url : url, init);
  }) as typeof fetch;
}

const c = createSourceClient(s2);
const page = await c.popular(1);
console.log("popular items:", page.mangas.length);
for (const m of page.mangas.slice(0, 4)) {
  console.log(" -", m.title, "|", m.author || "?", "|", (m.thumbnailUrl || "").slice(0, 60));
}
if (page.mangas.length) {
  const d = await c.details(page.mangas[0]);
  const ch = await c.chapters(d);
  console.log("details initialised:", d.initialized, "| chapters:", ch.length);
  if (ch.length) {
    const pg = await c.pages(ch[0], d);
    console.log("pages:", pg.length, "| first:", (pg[0]?.image || "").slice(0, 70));
  }
}
