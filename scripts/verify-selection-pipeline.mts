/**
 * Full pipeline on live-shaped data: how many of Rave's results survive, and is
 * the answer empty?
 *
 * The regression that prompted this reported "No download link found" on EVERY
 * book. This replays the real selection logic (strict title match, then the
 * relevance-gated fallback) over actual Rave payloads for a one-word query
 * ("dune") and the multi-word query from the original report.
 *
 * Empty output is the failure this guards against.
 */
import { titlesRoughlyMatch } from "../src/lib/audiobookScraper";
import { isRelevantMirrorResult } from "../src/lib/mirrorRelevance";

// Real titles from the live Rave response for "dune" (mode=ebooks, 45 results).
const DUNE = [
  "Dune", "Dune Encyclopedia", "Dune Saga Books 1-6", "Janet of the Dunes",
  "Dune (Dune Chronicles, Book 1)", "Dune: The Movie Art", "Children of Dune",
  "Dune: The Manuscript Collection", "God Emperor of Dune", "Dune: Prophecy",
  "Dune Messiah", "Dune: The Complete Collection",
];
// Real titles from the "capture or kill" response.
const CAPTURE = [
  "Capture or Kill: A Mitch Rapp Novel", "Capture Or Kill Mitch Rapp 23",
  "Capture or Kill", "Capture or Kill: The Pursuit of the 9/11 Mastermind",
  "Computational Cognitive Neuroscience", "Statistical Thinking for the 21st Century",
  "Capture the Saint", "Quake II - Capture the Flag", "I Capture the Castle",
  "The Capture of Cerberus", "Kill Me If You Can", "First to Kill",
];

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

function select(raw: string[], title: string, author: string | null, query: string) {
  const strict = raw.filter((t) => titlesRoughlyMatch(title, t, author || undefined));
  if (strict.length > 0) return { kept: strict, via: "strict" };
  const relaxed = raw.filter((t) =>
    isRelevantMirrorResult({
      query, bookTitle: title, bookAuthor: author || undefined,
      candidateTitle: t, candidateAuthor: undefined,
    })
  );
  return { kept: relaxed, via: "relaxed" };
}

console.log("=== one-word query: 'Dune' (must NOT be empty) ===");
const d = select(DUNE, "Dune", "Frank Herbert", "dune");
console.log(`  via ${d.via}: ${d.kept.length}/${DUNE.length} kept`);
d.kept.slice(0, 6).forEach((t) => console.log(`    + ${t}`));
check("dune returns results", d.kept.length > 0, `${d.kept.length} kept`);
check("exact 'Dune' survives", d.kept.includes("Dune"));

console.log("\n=== multi-word query: 'capture or kill' ===");
const c = select(CAPTURE, "Capture or Kill", "Vince Flynn", "capture or kill");
console.log(`  via ${c.via}: ${c.kept.length}/${CAPTURE.length} kept`);
c.kept.forEach((t) => console.log(`    + ${t}`));
check("capture or kill returns results", c.kept.length > 0, `${c.kept.length} kept`);
check("the real book survives", c.kept.includes("Capture or Kill"));
check(
  "math textbook is gone",
  !c.kept.includes("Computational Cognitive Neuroscience")
);

console.log("\n=== unknown book must NOT invent results ===");
// If nothing plausibly matches, an empty result is CORRECT — that is the whole
// point of the gate. It must not be "fixed" by re-admitting everything.
const junkOnly = select(
  ["Computational Cognitive Neuroscience", "The Politics of Sports"],
  "The Atlantis Gene",
  "A thr Reun",
  "the atlantis gene"
);
console.log(`  kept: ${junkOnly.kept.length}`);
check("genuinely unrelated query stays empty", junkOnly.kept.length === 0);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);