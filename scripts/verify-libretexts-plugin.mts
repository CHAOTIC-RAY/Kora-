/**
 * Live check that the LibreTexts manifest parses through the REAL client.
 *
 * Uses the same createSourceClient + /api/source-fetch relay the app uses, so a
 * pass here means the manifest works in production, not just that the JSON
 * looked right in a scratch file.
 */
import { createSourceClient } from "../src/lib/sources/client";
import type { SourcePlugin } from "../src/lib/sources/types";
import { readFileSync } from "node:fs";

const RELAY = "https://kora.chaoticstudio.workers.dev";
const real = globalThis.fetch;
globalThis.fetch = ((input: any, init: any) => {
  const url = typeof input === "string" ? input : input?.url ?? String(input);
  return real(url.startsWith("/") ? RELAY + url : url, init);
}) as typeof fetch;

const def: SourcePlugin = JSON.parse(
  readFileSync("D:/Wafig/Hermes/Kora-Sources/sources/legal/libretexts-chem.json", "utf8")
);

const client = createSourceClient(def);
console.log(`plugin: ${def.name}  kind=${def.kind}  api=${def.api}\n`);

for (const q of ["thermodynamics", "acid base equilibrium"]) {
  const t0 = Date.now();
  const r = await client.search(q, 1);
  const ms = Date.now() - t0;
  console.log(`search "${q}" -> ${r.mangas.length} results in ${ms}ms (hasNext=${r.hasNextPage})`);
  for (const m of r.mangas.slice(0, 3)) {
    console.log(`   id=${String(m.url).padEnd(8)} ${m.title.slice(0, 52)}`);
    console.log(`      author=${(m.author || "-").slice(0, 24)}  desc=${(m.description || "-").slice(0, 50)}`);
  }
  console.log();
}

// Prove the PDF URL derived from a returned id is a real file.
const first = (await client.search("entropy", 1)).mangas[0];
if (first) {
  const pdf = `https://downloads.libretexts.org/api/v1/download/chem-${first.url}/pdf`;
  const res = await real(pdf, { headers: { "User-Agent": "Mozilla/5.0" } });
  const buf = Buffer.from(await res.arrayBuffer());
  console.log(`PDF check id=${first.url} -> ${res.status} ${res.headers.get("content-type")}`);
  console.log(`   bytes=${buf.length} magic=${buf.subarray(0, 5).toString("latin1")} valid=${buf.subarray(0, 5).toString() === "%PDF-"}`);
}
