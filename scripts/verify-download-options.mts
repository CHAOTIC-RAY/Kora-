import { buildRaveDownloadOptions } from "../src/lib/raveDownloadOptions";

let failures = 0;
function check(name: string, condition: boolean) {
  console.log(`${condition ? "PASS" : "FAIL"} ${name}`);
  if (!condition) failures++;
}

const signed = "https://booksdl.lc/get.php?md5=0123456789abcdef0123456789abcdef&key=validKey";
const options = buildRaveDownloadOptions({
  md5: "0123456789abcdef0123456789abcdef",
  raveDirect: signed,
  searchQuery: "Example Author",
});
check("signed upstream URL remains an upstream URL", options.some((o) => o.url === signed));
check("LibGen fallback remains an upstream URL", options.some((o) => o.url === "https://libgen.li/get.php?md5=0123456789abcdef0123456789abcdef"));
check("builder does not pre-wrap options in /api/proxy-file", options.every((o) => !o.url.includes("/api/proxy-file")));
check("search fallbacks remain available", options.some((o) => o.sourceId === "google-books" && o.isSearch));
check("duplicate URLs are removed", new Set(options.map((o) => o.url)).size === options.length);

const noDirect = buildRaveDownloadOptions({ searchQuery: "A title" });
check("search-only results are still available", noDirect.length >= 3 && noDirect.every((o) => o.isSearch));

if (failures) {
  console.error(`\n${failures} download option regression test(s) failed.`);
  process.exit(1);
}
console.log("\nALL PASS");
