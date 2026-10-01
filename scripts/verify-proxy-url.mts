/**
 * Pins the proxy-of-a-proxy fix.
 *
 * The Worker returns some mirrors as an ALREADY-RELATIVE proxy URL
 * (`/api/proxy-file?url=https%3A%2F%2Farchive.org%2F…`). Wrapping that again
 * produced a proxy-of-a-proxy whose inner `url` is a path, not an absolute URL,
 * so the Worker 502'd — identically to a dead mirror, which is why every
 * mirror in a list "failed" and retrying could not help.
 *
 * Run: npx tsx scripts/verify-proxy-url.mts
 */
import { proxyUrlForMirror, isProxyUrl } from "../src/lib/downloadProxy";

let failures = 0;
const check = (label: string, got: string, want: string) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) {
    console.log(`        got:  ${got}`);
    console.log(`        want: ${want}`);
  }
};

// 1. The exact shape the Worker emits — must NOT be wrapped.
const workerRelative =
  "/api/proxy-file?url=https%3A%2F%2Farchive.org%2Fdownload%2Fshatterme0000mafi%2Fshatterme0000mafi.epub";
check(
  "already-proxied relative URL is left alone",
  proxyUrlForMirror(workerRelative),
  workerRelative
);

// 2. A plain upstream URL — wrapped exactly once.
const upstream = "https://libgen.li/get.php?md5=abc&key=DEF";
check(
  "upstream URL wrapped once",
  proxyUrlForMirror(upstream),
  `/api/proxy-file?url=${encodeURIComponent(upstream)}`
);

// 3. Absolute same-origin proxy URL — left alone.
const absoluteProxy = "https://kora.chaoticstudio.workers.dev/api/proxy-file?url=https%3A%2F%2Flibgen.li%2Fx";
check("absolute proxy URL left alone", proxyUrlForMirror(absoluteProxy), absoluteProxy);

// 4. Regression: no output may contain a nested proxy path.
for (const u of [workerRelative, upstream, absoluteProxy]) {
  const out = proxyUrlForMirror(u);
  const nested = /\/api\/proxy-file\?url=%2Fapi%2F/i.test(out);
  console.log(`${nested ? "FAIL" : "PASS"}  no nested proxy for ${u.slice(0, 42)}…`);
  if (nested) failures++;
}

// 5. Idempotence: wrapping an already-wrapped URL is a no-op, so a re-run
//    through the same helper can never accumulate another layer.
const once = proxyUrlForMirror(upstream);
const twice = proxyUrlForMirror(once);
check("wrapping is idempotent", twice, once);

// 6. Empty input must not throw.
check("empty string is passthrough", proxyUrlForMirror(""), "");
check("isProxyUrl('') is false", String(isProxyUrl("")), "false");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
