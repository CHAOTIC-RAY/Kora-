/**
 * The discovery feed showed books with no direct download link.
 *
 * The Worker already flags web pages with `needsBrowser: true` (RoyalLib, and
 * any reader view that needs a real browser/login). The client's
 * isDirectlyFetchable ignored that field and accepted any http(s) downloadUrl,
 * so those rows were counted as downloadable and rendered with a "Direct" badge
 * that resolved to an HTML page.
 *
 * Fixtures are the real rows returned by /api/annas-archive/search.
 */
import { hasDownloadableSource, filterDownloadableBooks } from "../src/lib/bookAvailability";

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

// ── Real RoyalLib row (needsBrowser: true, .html page) ──
const royalLib: any = {
  id: "bce92be37c18a80f4c31854fc0fd73bb175389e706d4effedd0c1db4676005e7",
  hasRealMd5: false,
  title: "Capture the Saint",
  author: "Charteris Leslie",
  extension: "HTML",
  size: "Unknown",
  source: "RoyalLib",
  downloadUrl: "https://royallib.com/book/Charteris_Leslie/capture_the_saint.html",
  needsBrowser: true,
};

// ── Real LibGen row (signed md5) ──
const libgen: any = {
  title: "Capture or Kill: A Mitch Rapp Novel",
  author: "Vince Flynn; Don Bentley",
  extension: "EPUB",
  size: "1.9 MB",
  source: "Library Genesis",
  md5: "649cbeeec91055459c251e1d0ac65440",
  hasRealMd5: true,
  downloadUrl: "https://libgen.li/get.php?md5=649cbeeec91055459c251e1d0ac65440&key=9YVXW8FNGGAB07QW",
  needsBrowser: false,
};

// ── Real Internet Archive row ──
const archive: any = {
  title: "The Hobbit",
  author: "J.R.R. Tolkien",
  extension: "EPUB",
  source: "Internet Archive",
  iaId: "hobbit_tolkien",
  downloadUrl: "https://archive.org/download/hobbit_tolkien/hobbit_tolkien.epub",
  needsBrowser: false,
};

// ── Real LibreTexts PDF: extensionless but a genuine file ──
const libretexts: any = {
  title: "Math 125: Hope College",
  extension: "PDF",
  source: "LibreTexts",
  downloadUrl: "https://downloads.libretexts.org/api/v1/download/med-12554/pdf",
  needsBrowser: false,
};

// ── A NYT/Google catalog row: not direct, but re-searchable on open ──
const nyt: any = {
  title: "Project Hail Mary",
  author: "Andy Weir",
  isNYTBook: true,
  source: "nyt",
  searchQuery: "Project Hail Mary Andy Weir",
};

console.log("=== rows the feed must NOT show as downloadable ===");
check("RoyalLib HTML page is not downloadable", !hasDownloadableSource(royalLib));
check(
  "  ...even though it has an http downloadUrl",
  !hasDownloadableSource({ ...royalLib, needsBrowser: undefined }),
  "fallback URL sniffing"
);

console.log("\n=== rows the feed MUST keep ===");
check("LibGen signed EPUB is downloadable", hasDownloadableSource(libgen));
check("Internet Archive row is downloadable", hasDownloadableSource(archive));
check("LibreTexts extensionless PDF is downloadable", hasDownloadableSource(libretexts));
check("NYT catalog row stays (searchable on open)", hasDownloadableSource(nyt));

console.log("\n=== filterDownloadableBooks on a mixed feed ===");
const feed = [royalLib, libgen, archive, libretexts, nyt];
const kept = filterDownloadableBooks(feed);
console.log(`  kept: ${kept.map((b: any) => b.title).join(" | ")}`);
check("RoyalLib dropped from the feed", !kept.some((b: any) => b.title === "Capture the Saint"));
check("LibGen kept", kept.some((b: any) => b.title.startsWith("Capture or Kill")));
check("LibreTexts PDF kept", kept.some((b: any) => b.title === "Math 125: Hope College"));
check("archive kept", kept.some((b: any) => b.title === "The Hobbit"));

console.log("\n=== the real 'capture or kill' payload: 7 LibreTexts + 20 RoyalLib gone? ===");
// Real counts from that response: 14 LibGen, 7 LibreTexts, 20 RoyalLib.
const real: any[] = [
  ...Array.from({ length: 14 }, (_, i) => ({ ...libgen, title: `Capture or Kill ${i}` })),
  ...Array.from({ length: 7 }, (_, i) => ({ ...libretexts, title: `Math ${i}` })),
  ...Array.from({ length: 20 }, (_, i) => ({ ...royalLib, title: `Junk ${i}` })),
];
const realKept = filterDownloadableBooks(real);
console.log(`  ${real.length} in -> ${realKept.length} kept`);
console.log(`  kept titles all from LibGen: ${realKept.every((b: any) => b.title.startsWith("Capture or Kill"))}`);
check("all 14 real EPUBs kept", realKept.filter((b: any) => b.title.startsWith("Capture or Kill")).length === 14);
check("all 20 RoyalLib pages dropped", !realKept.some((b: any) => b.title.startsWith("Junk")));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);