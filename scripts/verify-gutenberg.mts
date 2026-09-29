/** Live check the Project Gutenberg source through the real JSON runtime. */
import { createSourceClient } from "../src/lib/sources/client";
import type { SourcePlugin } from "../src/lib/sources/types";

const def = JSON.parse(
  await (await import("node:fs/promises")).readFile(
    "D:/Wafig/Hermes/Kora-Sources/sources/legal/gutenberg.json",
    "utf8"
  )
) as SourcePlugin;

// The client fetches through the Worker relay at a relative /api/ path,
// which does not exist outside a deployed origin. Point it at the live
// Worker so this verifies the real relay rather than a stub.
const real = globalThis.fetch;
globalThis.fetch = ((input: any, init: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  return real(
    url.startsWith("/") ? "https://kora.chaoticstudio.workers.dev" + url : url,
    init
  );
}) as typeof fetch;

const c = createSourceClient(def);
const page = await c.search("dune", 1);
console.log("search results:", page.mangas.length);
for (const m of page.mangas.slice(0, 3)) {
  console.log("  -", m.title, "|", m.author || "?", "|", (m.thumbnailUrl || "none").slice(0, 62));
}
if (page.mangas.length) {
  const d = await c.details(page.mangas[0]);
  console.log("details title:", d.title);
  console.log("  author:", d.author, "| initialised:", d.initialized);
  console.log("  desc:", (d.description || "").slice(0, 80));
  console.log("  genres:", (d.genres || []).slice(0, 3).join(" | "));
}
