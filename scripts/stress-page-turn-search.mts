/**
 * Stress checks for Discover format ranking + LibGen signed-link picking.
 * Run: npx tsx scripts/stress-page-turn-search.mts
 */
import assert from "node:assert/strict";

const FORMATS = ["epub", "azw3", "mobi", "fb2", "pdf"];

function formatRank(v: { extension?: string; format?: string }): number {
  const raw = (v.extension || v.format || "").toString().trim().toLowerCase().replace(/^\./, "");
  const idx = FORMATS.indexOf(raw);
  return idx === -1 ? FORMATS.length : idx;
}

function sortVariants(variants: any[]) {
  return [...variants].sort((a, b) => formatRank(a) - formatRank(b));
}

function pickBestLibgenSignedHref(links: string[], md5: string): string {
  const matched = links
    .map((href) => href.replace(/&amp;/g, "&"))
    .filter((href) => href.toLowerCase().includes(md5.toLowerCase()) && /[?&]key=[^&]+/i.test(href));
  if (!matched.length) return "";
  const epub = matched.find((href) => /\.epub\b|format=epub|ext=epub/i.test(href));
  return epub || matched[0];
}

const variants = [
  { title: "Dune", format: "pdf" },
  { title: "Dune", extension: "epub" },
  { title: "Dune", format: "mobi" },
  { title: "Dune", format: "azw3" },
];
const sorted = sortVariants(variants);
assert.equal((sorted[0].extension || sorted[0].format).toLowerCase(), "epub");
assert.equal((sorted[1].extension || sorted[1].format).toLowerCase(), "azw3");
assert.equal((sorted[sorted.length - 1].extension || sorted[sorted.length - 1].format).toLowerCase(), "pdf");

const md5 = "aabbccddeeff00112233445566778899";
const links = [
  `get.php?md5=${md5}&key=AAA&filename=dune.pdf`,
  `get.php?md5=${md5}&key=BBB&filename=dune.epub`,
  `get.php?md5=${md5}&key=CCC`,
];
assert.match(pickBestLibgenSignedHref(links, md5), /\.epub\b/);

// Synthetic page-turn budget: ensure constrained readers skip paper-flip.
function effectiveTransition(ua: string, width: number, preferred: string) {
  const constrained = /android/i.test(ua) || width < 768;
  if (constrained && (preferred === "paper-flip" || preferred === "spring")) return "none";
  return preferred;
}
assert.equal(effectiveTransition("Mozilla/5.0 Android 14", 390, "paper-flip"), "none");
assert.equal(effectiveTransition("Mozilla/5.0 iPhone", 390, "paper-flip"), "none");
assert.equal(effectiveTransition("Mozilla/5.0 Macintosh", 1440, "paper-flip"), "paper-flip");

console.log("PASS stress-page-turn-search checks");
