/**
 * Pins the Cloudflare-challenge detector.
 *
 * This heuristic has produced TWO false positives in a row, both of which
 * reported a healthy page as a blocked mirror:
 *
 *   1. `text.includes("Cloudflare")` — matches the footer link that every
 *      Cloudflare-fronted site carries.
 *   2. matching `challenge-platform` — Cloudflare injects
 *      /cdn-cgi/challenge-platform/scripts/jsd/main.js (its JS-detection
 *      beacon) into ORDINARY 200 pages, so that token is not a challenge
 *      signal at all.
 *
 * So: a healthy page must NOT be flagged, and a real interstitial MUST be.
 */

/** The detector, copied from src/worker.ts. Kept in sync by hand on purpose:
 *  worker.ts cannot be imported here without pulling in the whole Worker env. */
function isChallengePage(text: string): boolean {
  return (
    /<title>\s*(just a moment|attention required|attention needed|checking your browser|please wait)/i.test(text) ||
    /<h1[^>]*>\s*(just a moment|attention required|checking your browser)/i.test(text) ||
    /(__cf_chl_|_cf_chl_opt|cf_chl_opt_|captcha-delivery|g-recaptcha|h-captcha)/i.test(text)
  );
}

let failures = 0;
const check = (label: string, got: boolean, want: boolean) => {
  const ok = got === want;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
};

// ── Must NOT be flagged: real, healthy pages ──

// The actual body of https://ravebooksearch.com (a live 200 that was wrongly
// reported as a challenge). Truncated to the parts that matter.
const raveRealPage = `
<!doctype html><html><head><title>Rave Book Search: Free eBook &amp; Audiobook Finder</title>
<meta name="generator" content="cloudflare"></head><body>
<p>Free ebook and audiobook search.</p>
<script>d.createElement('script');d.innerHTML="window.__CF$cv$params={r:'a43b592a',t:'MTc5MDg1NjQ1OQ=='};
var a=document.createElement('script');a.src='/cdn-cgi/challenge-platform/scripts/jsd/main.js';
document.getElementsByTagName('head')[0].appendChild(a);";</script>
<footer>Powered by <a href="https://www.cloudflare.com/">Cloudflare</a></footer>
</body></html>`;
check("healthy page mentioning Cloudflare in footer", isChallengePage(raveRealPage), false);
check("healthy page with the challenge-platform JSD beacon", isChallengePage(raveRealPage), false);

check(
  "plain html page",
  isChallengePage("<html><head><title>Library Genesis</title></head><body>books</body></html>"),
  false
);
check("ad landing page mentioning captcha in prose", isChallengePage("<html><body>Please solve the captcha to continue</body></html>"), false);

// ── MUST be flagged: genuine interstitials ──

check(
  '"Just a moment..." title',
  isChallengePage("<html><head><title>Just a moment...</title></head><body>Checking your browser</body></html>"),
  true
);
check(
  '"Attention Required" title',
  isChallengePage("<html><head><title>Attention Required! | Cloudflare</title></head><body></body></html>"),
  true
);
check(
  "h1 'Just a moment...' without a title",
  isChallengePage("<html><body><h1>Just a moment...</h1><div id='cf-please-wait'></div></body></html>"),
  true
);
check(
  "__cf_chl_opt token present",
  isChallengePage("<html><body><script>window._cf_chl_opt_={}</script></body></html>"),
  true
);
check("g-recaptcha widget", isChallengePage("<html><body><div class='g-recaptcha'></div></body></html>"), true);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
