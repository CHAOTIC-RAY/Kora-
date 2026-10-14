/**
 * Prove the book-file path end to end against the LIVE site.
 *
 * Fetches through Kora's own /api/source-fetch relay rather than straight from
 * this machine — that is how the app reaches a plugin, and it matters here:
 * LibreTexts rate-limits the per-page PDF endpoint by client IP, so a direct
 * fetch from one host returned a sustained 429 while the relay, on Cloudflare
 * egress, returned the same URL as a real PDF. Verifying the direct way would
 * have measured this machine's quota, not the product.
 *
 * NOTE: keep this comment free of both backticks (they open a template literal
 * that swallows the rest of the file) and of a slash-star pair, which closes
 * the comment early. Either one makes the parser fail on some unrelated line
 * far below, which is a genuinely miserable thing to debug.
 */
import { createSourceClient } from "../src/lib/sources/client";
import { resolveBookFileUrl } from "../src/lib/sources/bookFile";
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

/**
 * Fetch through the relay, the same egress the app uses for plugin targets.
 *
 * The relay answers JSON ({status, ok, body, finalUrl}), not the file — `body`
 * holds the upstream text. That matters for the check below: the HTTP status to
 * trust is the one INSIDE the payload, not the 200 the relay itself returns.
 */
const REFERER = "https://chem.libretexts.org/";
async function viaRelay(url: string): Promise<{ status: number; body: string }> {
  const target = RELAY + "/api/source-fetch?u=" + encodeURIComponent(url)
    + "&r=" + encodeURIComponent(REFERER);
  const r = await real(target);
  const payload = (await r.json()) as { status?: number; body?: string };
  return { status: payload.status ?? r.status, body: payload.body || "" };
}

const res = await createSourceClient(def).search("thermodynamics", 1);
console.log(`listed ${res.mangas.length} results\n`);

let ok = 0;
const SAMPLE = 3;
for (const m of res.mangas.slice(0, SAMPLE)) {
  const url = resolveBookFileUrl(def, String(m.url), m.title);
  const { status, body } = await viaRelay(url);
  const valid = body.startsWith("%PDF-");
  if (valid && status === 200) ok++;
  console.log(`${valid && status === 200 ? "OK " : "BAD"} ${status} ${String(body.length).padStart(9)}B  ${m.title.slice(0, 36)}`);
  console.log(`     ${url.slice(0, 104)}`);
  // Be gentle: this endpoint rate-limits per client IP.
  await new Promise((r) => setTimeout(r, 2500));
}
console.log(`\n${ok}/${SAMPLE} resolved to a real PDF via the app relay`);
if (ok < SAMPLE) process.exit(1);
