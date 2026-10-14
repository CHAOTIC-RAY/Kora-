/**
 * Why the strict filter let "capture or kill" through to LibreTexts.
 *
 * DiscoverView filters variants with titlesRoughlyMatch, then — if nothing
 * matches — FALLS BACK to the entire raw list. That fallback is what put open
 * textbooks and RoyalLib titles into a Vince Flynn thriller's download sheet.
 *
 * These are the real titles from the 2026-10-03 response.
 */
import { titlesRoughlyMatch } from "../src/lib/audiobookScraper";
import { isRelevantMirrorResult } from "../src/lib/mirrorRelevance";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

const TITLE = "Capture or Kill";
const AUTHOR = "Vince Flynn";

// The exact junk Rave returned for this query.
const junk = [
  "Computational Cognitive Neuroscience",
  "Statistical Thinking for the 21st Century",
  "Laboratory Manual - Computer Programming",
  "The Politics of Sports",
  "Capture the Saint",
  "The Capture of Cerberus",
  "Quake II - Capture the Flag",
];

console.log("=== titlesRoughlyMatch (the existing strict filter) ===");
for (const t of junk) {
  const loose = titlesRoughlyMatch(TITLE, t, AUTHOR);
  const strict = isRelevantMirrorResult({
    query: "capture or kill", bookTitle: TITLE, bookAuthor: AUTHOR, candidateTitle: t,
  });
  check(
    `strict gate rejects "${t.slice(0, 36)}"`,
    !strict,
    `| titlesRoughlyMatch=${loose}`,
  );
}

// The genuine editions must survive BOTH filters.
console.log("\n=== genuine editions survive ===");
for (const t of ["Capture or Kill: A Mitch Rapp Novel", "Kill or Capture", "Capture Or Kill Mitch Rapp 23"]) {
  check(
    `accepts "${t.slice(0, 36)}"`,
    isRelevantMirrorResult({ query: "capture or kill", bookTitle: TITLE, bookAuthor: AUTHOR, candidateTitle: t })
  );
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);