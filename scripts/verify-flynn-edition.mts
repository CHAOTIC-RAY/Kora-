/**
 * The books from the bug reports, tested with the EXACT phrase the app uses.
 *
 * Reported 2026-10-03: searching "Vince Flynn Capture or Kill Don Bentley" in
 * Rave gives good results, but Kora showed only a RoyalLib HTML page.
 *
 * Rave is not the difference — the identical query returns the 3 LibGen EPUBs.
 * The loss happens in the client filter, which called
 * `titlesRoughlyMatch(title, b.title, author)` with only the BOOK's author.
 * titlesRoughlyMatch then saw an author mismatch on every row and demanded 60%
 * title-word overlap, which no real edition can reach when the author's name is
 * part of the stored title.
 *
 * Titles are the real ones from the live Rave payloads.
 */
import { titlesRoughlyMatch } from "../src/lib/audiobookScraper";
import { isRelevantMirrorResult, matchesEditionStrictly } from "../src/lib/mirrorRelevance";

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

interface Row { title: string; author: string; source: string; ext?: string }

const CAPTURE: Row[] = [
  { title: "Capture or Kill: A Mitch Rapp Novel", author: "Vince Flynn; Don Bentley", source: "Library Genesis", ext: "EPUB" },
  { title: "Capture Or Kill Mitch Rapp 23", author: "Vince Flynn & Don Bentley", source: "Library Genesis", ext: "EPUB" },
  { title: "Capture or Kill", author: "Vince Flynn & Don Bentley", source: "Library Genesis", ext: "EPUB" },
  { title: "Computational Cognitive Neuroscience", author: "", source: "LibreTexts" },
  { title: "Math 125: Hope College", author: "", source: "LibreTexts" },
  { title: "I Capture the Castle", author: "E. Nesbit", source: "RoyalLib", ext: "HTML" },
  { title: "The Capture of Cerberus", author: "", source: "RoyalLib", ext: "HTML" },
  { title: "Capture the Saint", author: "", source: "RoyalLib", ext: "HTML" },
];

const DUNE: Row[] = [
  { title: "Dune", author: "Frank Herbert", source: "Library Genesis", ext: "EPUB" },
  { title: "Dune Encyclopedia", author: "", source: "RoyalLib", ext: "HTML" },
  { title: "Children of Dune", author: "Frank Herbert", source: "Library Genesis", ext: "EPUB" },
];

// Exactly how the app builds it: `${cleanTitle} ${cleanAuthor}`.
const q = "Vince Flynn Capture or Kill Don Bentley";
const TITLE = "Vince Flynn Capture or Kill";
const AUTHOR = "Don Bentley";

console.log(`search phrase sent to Rave: "${q}"`);
console.log(`title field: "${TITLE}"   author field: "${AUTHOR}"\n`);

console.log("=== OLD behaviour: titlesRoughlyMatch(title, b.title, author) ===");
let oldKept = 0;
for (const b of CAPTURE) {
  const m = titlesRoughlyMatch(TITLE, b.title, AUTHOR || undefined);
  if (m) oldKept++;
  const flag = b.source === "Library Genesis" ? " <- real EPUB" : "";
  console.log(`  ${m ? "KEEP" : "DROP"}  [${b.source}] ${b.title}${flag}`);
}
console.log(`  -> ${oldKept} kept`);

console.log("\n=== NEW behaviour: matchesEditionStrictly ===");
let newKept = 0;
const libgenKept: Row[] = [];
for (const b of CAPTURE) {
  const m = matchesEditionStrictly({
    title: TITLE, author: AUTHOR, candidateTitle: b.title, candidateAuthor: b.author,
  });
  if (m) {
    newKept++;
    if (b.source === "Library Genesis") libgenKept.push(b);
  }
  const flag = b.source === "Library Genesis" ? " <- real EPUB" : "";
  console.log(`  ${m ? "KEEP" : "DROP"}  [${b.source}] ${b.title}${flag}`);
}
console.log(`  -> ${newKept} kept, of which ${libgenKept.length} are real EPUBs`);

console.log("\n=== assertions ===");
check("old code dropped every genuine EPUB", oldKept === 0, `${oldKept} kept`);
check("new code keeps all 3 genuine EPUBs", libgenKept.length === 3, `${libgenKept.length}/3`);
check("LibreTexts math textbook still rejected",
  !CAPTURE.some((b) => b.title === "Computational Cognitive Neuroscience" &&
    matchesEditionStrictly({ title: TITLE, author: AUTHOR, candidateTitle: b.title, candidateAuthor: b.author })));
check("RoyalLib 'I Capture the Castle' still rejected",
  !CAPTURE.some((b) => b.title === "I Capture the Castle" &&
    matchesEditionStrictly({ title: TITLE, author: AUTHOR, candidateTitle: b.title, candidateAuthor: b.author })));
check("wrong-author same-title book still rejected",
  !matchesEditionStrictly({
    title: TITLE, author: AUTHOR,
    candidateTitle: "Capture or Kill", candidateAuthor: "Agatha Christie",
  }));

console.log("\n=== a second reported book: Dune (one-word title, author present) ===");
let dKept = 0;
for (const b of DUNE) {
  const m = matchesEditionStrictly({
    title: "Dune", author: "Frank Herbert",
    candidateTitle: b.title, candidateAuthor: b.author,
  });
  if (m) dKept++;
  console.log(`  ${m ? "KEEP" : "DROP"}  [${b.source}] ${b.title}`);
}
check("Dune keeps its real editions", dKept >= 2, `${dKept}/3`);

console.log("\n=== the relaxed gate still backs it up ===");
const relaxed = CAPTURE.filter((b) =>
  isRelevantMirrorResult({
    query: q, bookTitle: TITLE, bookAuthor: AUTHOR,
    candidateTitle: b.title, candidateAuthor: b.author,
  })
);
console.log(`  relaxed keeps: ${relaxed.map((b) => b.title).join(" | ")}`);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);