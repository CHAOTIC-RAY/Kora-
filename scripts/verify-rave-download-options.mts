/**
 * Regression checks for open-access download fallbacks.
 * No network calls are made; URLs are checked against the real option builder.
 */
import { buildRaveDownloadOptions } from "../src/lib/raveDownloadOptions";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

const iaDirect = "https://archive.org/download/gutenberg_text_12345/sample.epub";
const gutenbergDirect = "https://www.gutenberg.org/ebooks/1342.epub3.images";
const iaDetails = "https://archive.org/details/prideandprejudice00aust";

const ia = buildRaveDownloadOptions({ raveDirect: iaDirect, iaId: "prideandprejudice00aust", searchQuery: "Pride and Prejudice Jane Austen" });
const directIa = ia.find((item) => item.isDirect);
check("verified Internet Archive file URL becomes direct option", !!directIa, directIa?.label);
check("Internet Archive direct URL is proxied once", !!directIa && directIa.url === "/api/proxy-file?url=" + encodeURIComponent(iaDirect));
check("Internet Archive item page remains available", ia.some((item) => item.url === iaDetails || item.url.endsWith("/prideandprejudice00aust")));
check("open-access fallbacks include Gutenberg search", ia.some((item) => item.sourceId === "gutenberg" && item.isSearch));

const gutenberg = buildRaveDownloadOptions({ raveDirect: gutenbergDirect, searchQuery: "Pride and Prejudice" });
check("verified Gutenberg EPUB URL becomes direct option", gutenberg.some((item) => item.isDirect && item.sourceId === "gutenberg"));
check("search query is encoded into Gutenberg fallback", gutenberg.some((item) => item.url.includes("Pride%20and%20Prejudice")));

const hashOnly = buildRaveDownloadOptions({ md5: "99C7A862D2DF4FFD872BB51DA21B4FBA" });
check("hash alone never invents a mirror URL", hashOnly.every((item) => !item.isDirect));
check("hash-only case still offers useful catalogues", hashOnly.length > 0);

const untrusted = buildRaveDownloadOptions({
  md5: "99C7A862D2DF4FFD872BB51DA21B4FBA",
  raveDirect: "https://libgen.li/get.php?md5=99c7a862d2df4ffd872bb51da21b4fba&key=example",
  searchQuery: "Dune Frank Herbert",
});
check("third-party mirror URL is not marked as a direct download", untrusted.every((item) => !item.isDirect));
check("Anna's Archive URL is not treated as a direct file", !buildRaveDownloadOptions({ raveDirect: "https://annas-archive.org/dl/example" }).some((item) => item.isDirect));

const all = [...ia, ...gutenberg, ...hashOnly, ...untrusted];
check("no option contains a nested proxy URL", all.every((item) => !/\/api\/proxy-file\?url=%2Fapi%2F/i.test(item.url)));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);
