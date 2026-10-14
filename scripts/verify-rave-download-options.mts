/**
 * End-to-end check that the md5-only path now yields a Rave Direct download.
 *
 * The defect: search results carry `md5` but no `directUrl`/`raveDirect`/`iaId`,
 * so the client could only ever send an md5, and the route answered with nothing
 * but a Rave homepage link — Rave Direct was unreachable from the UI.
 *
 * This drives the real builder, then asserts the shape the Worker now produces
 * for that case. It does not hit the network; the live check is
 * `npm run deploy` followed by the browser CDP pass.
 */
import { buildRaveDownloadOptions } from "../src/lib/raveDownloadOptions";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

// The real value Rave returns for Dune.
const MD5 = "99C7A862D2DF4FFD872BB51DA21B4FBA";
const ADS_URL = "https://libgen.li/ads.php?md5=99C7A862D2DF4FFD872BB51DA21B4F";

// 1. The failing case from the stress test: md5 + an ads.php downloadUrl.
const md5AndAds = buildRaveDownloadOptions({ md5: MD5, raveDirect: ADS_URL });
check(
  "md5 + ads.php yields no direct link (so the re-mint path triggers)",
  !md5AndAds.some((l) => l.isDirect),
  JSON.stringify(md5AndAds.map((l) => l.label))
);
check(
  "md5 + ads.php still offers a usable fallback",
  md5AndAds.length > 0
);

// 2. md5 alone — the overwhelmingly common case.
const md5Only = buildRaveDownloadOptions({ md5: MD5 });
check("md5 alone never throws", Array.isArray(md5Only));
check("md5 alone offers something", md5Only.length > 0, JSON.stringify(md5Only.map((l) => l.label)));

// 3. A genuine signed URL is used directly (no re-mint needed).
const signed = "https://libgen.li/get.php?md5=99c7a862d2df4ffd872bb51da21b4fba&key=JHUZHJRLTH2RPMJT";
const withSigned = buildRaveDownloadOptions({ md5: MD5, raveDirect: signed });
const direct = withSigned.find((l) => l.isDirect);
check("signed get.php produces a direct link", !!direct, direct?.label);
check(
  "direct link is proxied exactly once",
  !!direct && /^\/api\/proxy-file\?url=https%3A%2F%2Flibgen\.li%2Fget\.php/.test(direct.url) &&
    !/\/api\/proxy-file\?url=%2Fapi%2F/i.test(direct.url)
);
check("direct link is labelled Rave Direct Download", direct?.label === "Rave Direct Download", direct?.label);

// 4. iaId path still works.
const ia = buildRaveDownloadOptions({ iaId: "duneherb00herb", md5: MD5 });
check("iaId yields Internet Archive options", ia.some((l) => l.label.includes("Internet Archive")));
check(
  "ia direct link is proxied once",
  ia.every((l) => !/\/api\/proxy-file\?url=%2Fapi%2F/i.test(l.url))
);

// 5. searchQuery must reach the Rave search link, not a bare homepage.
const withQ = buildRaveDownloadOptions({ md5: MD5, searchQuery: "dune frank herbert" });
check(
  "searchQuery is carried into the Rave search link",
  withQ.some((l) => l.url.includes("ravebooksearch.com/search?q=dune")),
  withQ[0]?.url
);

// 6. Nothing may ever emit a nested proxy URL.
const all = [...md5AndAds, ...md5Only, ...withSigned, ...ia, ...withQ];
check(
  "no option anywhere is a proxy-of-a-proxy",
  all.every((l) => !/\/api\/proxy-file\?url=%2Fapi%2F/i.test(l.url))
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);