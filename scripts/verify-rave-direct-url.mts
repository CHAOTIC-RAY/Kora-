/**
 * Does `isRaveDirectUpstreamUrl` accept what search actually returns?
 *
 * Rave hands back `libgen.li/ads.php?md5=…` as `downloadUrl` — an ADS landing
 * page, not a file. If the builder accepts it, the Worker proxies an HTML ad
 * page and the user gets "did not serve a file". If it rejects it, the md5
 * re-mint path takes over, which is correct.
 *
 * So `ads.php` must be REJECTED, and the signed `get.php?md5=..&key=..` form
 * ACCEPTED. This pins both directions.
 */
import { isRaveDirectUpstreamUrl } from "../src/lib/raveDownloadOptions";

let failures = 0;
const check = (label: string, got: boolean | string, want: boolean) => {
  const ok = Boolean(got) === want;
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}`);
  if (!ok) console.log(`        got ${got}, want ${want}`);
};

// ── Must be ACCEPTED: real file endpoints ──
check(
  "signed libgen get.php",
  isRaveDirectUpstreamUrl("https://libgen.li/get.php?md5=99c7a862d2df4ffd872bb51da21b4fba&key=JHUZHJRLTH2RPMJT"),
  true
);
// ── Must be REJECTED: pages that are not files ──
// Rave returns `ads.php` as downloadUrl. That is an ad landing page, so it must
// be rejected — proxying it yields HTML and "did not serve a file". The md5
// re-mint path takes over instead, which is the correct outcome.
// (A key appended to ads.php does NOT make it a file endpoint, so it is
// rejected too — only the get.php form carries a fetchable signed link.)
check("bare ads.php (no key) — the actual search value", isRaveDirectUpstreamUrl("https://libgen.li/ads.php?md5=99C7A862D2DF4FFD872BB51DA21B4F"), false);
check("ads.php even with a key — still an ad page", isRaveDirectUpstreamUrl("https://libgen.li/ads.php?md5=abc&key=JHUZ"), false);
check("booksdl.lc CDN", isRaveDirectUpstreamUrl("https://booksdl.lc/get.php?md5=abc&key=K"), true);
check(
  "anna's archive (non-slow)",
  isRaveDirectUpstreamUrl("https://annas-archive.org/dl/xyz"),
  true
);
check("archive.org /download/ path", isRaveDirectUpstreamUrl("https://archive.org/download/id/f.epub"), true);

// ── Must be REJECTED: pages that are not files ──
// This is the real regression: Rave returns ads.php as downloadUrl.
check("archive.org /details/ page", isRaveDirectUpstreamUrl("https://archive.org/details/duneherb00herb"), false);
check("anna's slow_download", isRaveDirectUpstreamUrl("https://annas-archive.org/slow_download/xyz"), false);
check("rave homepage", isRaveDirectUpstreamUrl("https://ravebooksearch.com"), false);
check("malformed", isRaveDirectUpstreamUrl("not a url"), false);
check("empty", isRaveDirectUpstreamUrl(""), false);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);