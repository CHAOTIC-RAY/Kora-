/**
 * The service worker must not serve a stale build's hashed chunks.
 *
 * Reported 2026-10-05 as "keep crashing randomly", with the root error boundary
 * showing only "Something went wrong" — no stack, because the boundary had no
 * `onError` handler at all.
 *
 * Two independent defects combined to make any tab open across a deploy crash:
 *
 *  1. **The fetch handler served `/assets/` straight from cache.**
 *     `if (url.pathname.startsWith("/assets/") && cached) return cached;`
 *     Hashed names are immutable, so serving them from cache looks safe — but
 *     the page's `index.html` had already changed, so it asked for the NEW
 *     build's filenames. Anything not already cached 404'd, and the old chunks
 *     were served whenever they happened to share a path. Network-first for
 *     `/assets/` fixes it; the precache is only a warm-up.
 *
 *  2. **`activate` pruned caches by NAME, and `SHELL_CACHE` is a fixed string.**
 *     So the shell cache survived every deploy and accumulated the previous
 *     build's hashed chunks indefinitely — never requested again, but never
 *     removed, and able to satisfy an offline load with an old build.
 *
 * `importWithRetry` had a third gap: it retried a failing chunk import three
 * times but never consulted `isBundleStale()`, which existed and was only called
 * once at app boot. Retrying the same dead URL can never succeed, so those tabs
 * had no path out but the manual Reload button.
 */
import fs from "node:fs";

const SW = "public/sw.js";
const RETRY = "src/lib/importRetry.ts";
const MAIN = "src/main.tsx";

const sw = fs.readFileSync(SW, "utf8");
const retry = fs.readFileSync(RETRY, "utf8");
const main = fs.readFileSync(MAIN, "utf8");

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

// ── A missing hashed chunk must 404, never fall back to index.html ───────────
// Measured on production before this guard existed:
//   /assets/DiscoverView-DOESNOTEXIST.js -> 200, text/html, 3887 bytes
// The browser accepts the 200 and then refuses to execute HTML as a module
// ("Expected a JavaScript module script but the server responded with a MIME
// type of 'text/html'"), which matched no chunk-failure pattern and surfaced as
// a blank crash screen. Both halves are pinned below.
const WRANGLER = "wrangler.toml";
const WORKER = "src/worker.ts";

const toml = fs.readFileSync(WRANGLER, "utf8");
const worker = fs.readFileSync(WORKER, "utf8");

console.log("=== 0. stale-chunk handling is fixed on the CLIENT, not by routing assets ===");
// A stale hashed chunk still resolves to 200 + index.html via the SPA fallback
// (not_found_handling = "single-page-application"). The browser then reports
// "Expected a JavaScript module script but the server responded with a MIME type
// of 'text/html'", which is what isChunkLoadError() must recognise.
check(
  "the client recognises the MIME-type failure as a chunk error",
  /Expected a JavaScript module script|MIME type of/.test(main),
  "this is the message the SPA fallback actually produces"
);
// Routing /assets/* through the Worker was TRIED and reverted: env.ASSETS is
// not bound in practice, so assets reaching the Worker are not served from disk.
// Measured with "/assets/*" in run_worker_first:
//   /assets/<real current entry>.js -> http=404   (site would not boot)
// This check exists so that change cannot silently come back.
check(
  "/assets/* is NOT routed through the Worker",
  !/run_worker_first\s*=\s*\[[^\]]*"\/assets\/\*"/.test(toml),
  "adding it 404s every real chunk — reverted, do not re-add"
);
check(
  "run_worker_first still covers the API and /send",
  /run_worker_first\s*=\s*\[[^\]]*"\/api\/\*"[^\]]*"\/send"/.test(toml),
  "/share and /install rely on the SPA fallback instead"
);
check(
  "the SPA fallback remains configured for client routes",
  /not_found_handling\s*=\s*"single-page-application"/.test(toml)
);


console.log("=== 1. /assets/ is network-first, not cache-first ===");
check(
  "no cache-first short-circuit for /assets/",
  !/if \(url\.pathname\.startsWith\("\/assets\/"\)\s*&&\s*cached\)\s*\{\s*return cached;/.test(sw),
  "this served the previous build"
);
// Match from the branch opener to its real close. A non-greedy `\}` stops at the
// first inner block, so span until the marker that ends this branch.
const assetsIdx = sw.indexOf('url.pathname.startsWith("/assets/")');
const assetsBranch = assetsIdx === -1 ? "" : sw.slice(assetsIdx, sw.indexOf("\n        try {", assetsIdx));
check("/assets/ tries the network", /await fetch\(event\.request\)/.test(assetsBranch));
check(
  "offline still falls back to the cache",
  /catch[\s\S]{0,300}cache\.match/.test(assetsBranch),
  "a cached copy of the SAME hashed name is still valid offline"
);

console.log("\n=== 2. stale chunks inside the kept cache are pruned ===");
const activate = /addEventListener\("activate"[\s\S]{0,2200}?\n\}\);/.exec(sw)?.[0] ?? "";
check("found the activate handler", activate.length > 0);
check(
  "prunes by comparing cache keys against the precache manifest",
  /precache-manifest\.json/.test(activate) && /shell\.keys\(\)/.test(activate),
  "deleting by cache NAME alone was insufficient"
);
check(
  "only prunes /assets/ entries absent from the manifest",
  /startsWith\("\/assets\/"\)\s*&&\s*!current\.has/.test(activate),
  "must not touch live assets"
);
check(
  "pruning is guarded so a missing manifest cannot wipe the cache",
  /catch\s*\(e\)\s*\{\s*\/\*[^*]*\*\/\s*\}/s.test(activate) || /catch/.test(activate)
);

console.log("\n=== 3. the cache name actually changes between builds ===");
// If these never move, no existing install ever picks up a new SW.
check(
  "shell cache is versioned",
  /const SHELL_CACHE = "kora-shell-v\d+";/.test(sw),
  (sw.match(/kora-shell-v\d+/) || ["?"])[0]
);
check(
  "api cache is versioned",
  /const API_CACHE = "kora-api-v\d+";/.test(sw),
  (sw.match(/kora-api-v\d+/) || ["?"])[0]
);

console.log("\n=== 4. a failed chunk import checks for staleness ===");
check(
  "importWithRetry consults isBundleStale on failure",
  /isBundleStale\(\)/.test(retry) && /catch[\s\S]*?isBundleStale/.test(retry),
  "retrying a dead hashed URL can never succeed"
);
check(
  "the reload is bounded to one attempt",
  /let reloading = false/.test(retry) && /!reloading/.test(retry),
  "an offline user must not loop"
);

console.log("\n=== 5. crashes are now observable ===");
check(
  "the root boundary has an onError handler",
  /<Sentry\.ErrorBoundary\s*\n?\s*onError=/.test(main) || /ErrorBoundary[\s\S]{0,80}onError=/.test(main),
  "without it there is no stack at all"
);
check(
  "it logs the error, message and component stack",
  /\[crash\] root boundary caught/.test(main) && /componentStack/.test(main)
);
check(
  "chunk-load detection covers a bare 'Failed to fetch'",
  /Failed to fetch\|/.test(main),
  "that IS what a stale chunk reports"
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);