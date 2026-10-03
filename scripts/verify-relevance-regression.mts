/**
 * Regression: every book showed "No download link found" after the relevance
 * gate landed (reported 2026-10-03). Two independent causes, both of which made
 * the gate reject EVERYTHING rather than just the junk:
 *
 *  A. sortMirrors gated mirrors on `m.title`. A mirror only ever carries
 *     {label, url, isDirect, sourceId} — so candidateTitle was undefined for all
 *     of them and the filter emptied the list. Mirrors are already derived from
 *     relevance-filtered variants, so an untitled mirror must pass through.
 *
 *  B. The bulk-word rule required >= 2 query words, so a ONE-word title could
 *     never match: "dune" -> words.length === 1 -> the rule could not fire.
 *
 * Fixtures are real titles from the live Rave response for "dune".
 */
import { isRelevantMirrorResult } from "../src/lib/mirrorRelevance";

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

// ── B. single-word queries must match ──
console.log("=== single-word query 'dune' (real Rave titles) ===");
for (const t of ["Dune", "Dune Encyclopedia", "Dune Saga Books 1-6", "Dune (Dune Chronicles, Book 1)"]) {
  check(
    `accepts "${t.slice(0, 38)}"`,
    isRelevantMirrorResult({ query: "dune", bookTitle: "Dune", candidateTitle: t })
  );
}
// ...but SUBSTRING matches must not slip through. "MicroDune" contains the
// letters "dune" without being the book; word-boundary matching is what stops
// it. (A title like "Dune Enviroment" DOES contain the word "dune" and is
// deliberately accepted — it is a plausible Dune title, and refusing it would
// re-introduce the empty-results regression this test exists to prevent.)
for (const t of ["MicroDune", "Dunescape", "Sanddunes"]) {
  check(
    `rejects substring-only "${t}"`,
    !isRelevantMirrorResult({ query: "dune", bookTitle: "Dune", candidateTitle: t })
  );
}

console.log("\n=== the junk from the original report must STILL be rejected ===");
const junk: [string, string, string | null, string | null][] = [
  ["capture or kill", "Computational Cognitive Neuroscience", "Vince Flynn", null],
  ["capture or kill", "Statistical Thinking for the 21st Century", "Vince Flynn", null],
  ["capture or kill", "Capture the Saint", "Vince Flynn", null],
  ["capture or kill", "Quake II - Capture the Flag", "Vince Flynn", null],
  ["capture or kill", "Capture or Kill", "Vince Flynn", "Agatha Christie"],
];
for (const [q, t, ba, ca] of junk) {
  check(
    `rejects "${t.slice(0, 40)}"`,
    !isRelevantMirrorResult({ query: q, bookTitle: "Capture or Kill", bookAuthor: ba, candidateTitle: t, candidateAuthor: ca })
  );
}

console.log("\n=== multi-word queries keep working ===");
for (const t of [
  "Capture or Kill: A Mitch Rapp Novel",
  "Kill or Capture",
  "Capture Or Kill Mitch Rapp 23",
]) {
  check(
    `accepts "${t.slice(0, 38)}"`,
    isRelevantMirrorResult({ query: "capture or kill", bookTitle: "Capture or Kill", bookAuthor: "Vince Flynn", candidateTitle: t })
  );
}

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);