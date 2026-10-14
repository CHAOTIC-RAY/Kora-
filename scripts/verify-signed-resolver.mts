/**
 * Does resolveLibgenSigned now return a key that actually serves bytes?
 *
 * Root cause (2026-10-03): the resolver scraped `get.php?md5=` (no key), which
 * now answers 307 with an EMPTY body. It found no key there, fell through to
 * another host, and returned a link that 500'd on use — so the modal offered
 * "Search open catalogs" for a book Rave had a perfect LibGen link for.
 * `ads.php` is the page that still embeds a live signed key.
 *
 * This hits the real network and asserts the returned key serves a real file.
 */
import { resolveLibgenSigned } from "../src/lib/libgenSigned";

const MD5 = "649cbeeec91055459c251e1d0ac65440"; // Capture or Kill (LibGen)
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36";

console.log("=== bare get.php?md5= (what the resolver used to scrape) ===");
try {
  const r = await fetch(`https://libgen.li/get.php?md5=${MD5}`, {
    headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15000),
  });
  const body = await r.text();
  console.log(`  status=${r.status} bytes=${body.length}  <- empty means unusable`);
} catch (e) {
  console.log("  fetch error:", String(e).slice(0, 60));
}

console.log("\n=== ads.php?md5= (the page that still embeds a key) ===");
try {
  const r = await fetch(`https://libgen.li/ads.php?md5=${MD5}`, {
    headers: { "User-Agent": UA }, redirect: "follow", signal: AbortSignal.timeout(15000),
  });
  const body = await r.text();
  const keys = [...body.matchAll(/get\.php\?md5=[a-f0-9]+&key=[A-Za-z0-9]+/gi)].map((m) => m[0]);
  console.log(`  status=${r.status} bytes=${body.length} embeddedKeys=${keys.length}`);
} catch (e) {
  console.log("  fetch error:", String(e).slice(0, 60));
}

console.log("\n=== resolveLibgenSigned() — then does the key serve real bytes? ===");
const t0 = Date.now();
const signed = await resolveLibgenSigned(MD5);
console.log(`  resolved in ${Date.now() - t0}ms`);
console.log(`  ${signed || "(empty)"}`);

if (!signed) {
  console.log("\nFAIL — resolver returned nothing");
  process.exit(1);
}

let ok = false;
let detail = "";
try {
  const r = await fetch(signed, {
    headers: { "User-Agent": UA, Referer: `${new URL(signed).origin}/` },
    redirect: "follow", signal: AbortSignal.timeout(60000),
  });
  const buf = new Uint8Array(await r.arrayBuffer());
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  const isHtml = buf[0] === 0x3c;
  detail = `status=${r.status} bytes=${buf.length} zip=${isZip} html=${isHtml}`;
  ok = r.ok && buf.length > 1000 && !isHtml;
} catch (e) {
  detail = "fetch error: " + String(e).slice(0, 60);
}

console.log(`  result: ${detail}`);
console.log(ok ? "\nPASS — resolver yields a working key" : "\nFAIL — resolved key does not serve a file");
process.exit(ok ? 0 : 1);