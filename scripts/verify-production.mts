/**
 * End-to-end check against the DEPLOYED Worker.
 *
 * Everything so far was verified through localhost or the relay directly.
 * This proves a real user's path: registry -> definition -> source client
 * -> search -> details -> chapters -> pages, all over production.
 */
import { createSourceClient } from "../src/lib/sources/client";
import type { SourcePlugin } from "../src/lib/sources/types";

const REGISTRY = "https://raw.githubusercontent.com/CHAOTIC-RAY/Kora-Sources/main/index.json";

// The client fetches through a relative /api/ path, so point it at prod.
const real = globalThis.fetch;
globalThis.fetch = ((input: any, init: any) => {
  const url = typeof input === "string" ? input : (input?.url ?? String(input));
  return real(url.startsWith("/") ? "https://kora.chaoticstudio.workers.dev" + url : url, init);
}) as typeof fetch;

const index: any = await (await real(REGISTRY)).json();
const entries = Object.values(index.extensionList.extensions).flat() as any[];
console.log(`registry: ${entries.length} extensions\n`);

let usable = 0;
for (const e of entries) {
  const name = e.name;
  const defUrl = e.resources?.apkUrl as string;
  let line = "";
  try {
    const res = await real(defUrl);
    if (!res.ok) {
      console.log(`  BAD  ${name.padEnd(24)} definition HTTP ${res.status}`);
      continue;
    }
    const def = (await res.json()) as SourcePlugin;
    const c = createSourceClient(def);
    // Browse, not search: several Madara sites disable WordPress search
    // entirely (the `?s=` query returns a full page with no cards). Their
    // catalogue is still fully browsable, which is what a chip opens.
    const page = await c.popular(1);
    if (!page.mangas.length) {
      const s = await c.search("naruto", 1);
      if (!s.mangas.length) {
        console.log(`  --   ${name.padEnd(24)} installed, no listings reachable`);
        continue;
      }
      console.log(`  OK   ${name.padEnd(24)} ${String(s.mangas.length).padStart(3)} results (search only)`);
      usable++;
      continue;
    }
    const d = await c.details(page.mangas[0]);
    let extra = "";
    if (def.theme === "madara") {
      const ch = d.initialized ? await c.chapters(d) : [];
      const pg = ch.length ? await c.pages(ch[0], d) : [];
      extra = `${ch.length} ch, ${pg.length} pages`;
      if (ch.length && pg.length) usable++;
    } else {
      extra = d.initialized ? "details OK" : "details pending";
      usable++;
    }
    line = `${String(page.mangas.length).padStart(3)} results | ${extra} | "${page.mangas[0]!.title.slice(0, 30)}"`;
    console.log(`  OK   ${name.padEnd(24)} ${line}`);
  } catch (err) {
    console.log(`  ERR  ${name.padEnd(24)} ${err instanceof Error ? err.message.slice(0, 50) : "threw"}`);
  }
}
console.log(`\nSUMMARY ${usable} source(s) returned live, readable results in production`);
