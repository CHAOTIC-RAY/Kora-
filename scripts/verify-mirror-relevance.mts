/**
 * Does the relevance gate reject the junk Rave actually returned?
 *
 * Every "reject" case below is a REAL title from the 2026-10-03 query
 * "capture or kill" (a Vince Flynn thriller) — the LibreTexts bucket held open
 * textbooks and RoyalLib held unrelated books, all matching on one keyword. The
 * app was promoting those to "LibreTexts Direct Download".
 *
 * The "accept" cases are the LibGen results from that same response, which are
 * genuinely the book and must survive the filter.
 */
import { isRelevantMirrorResult } from "../src/lib/mirrorRelevance";

let failures = 0;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  ${detail}` : ""}`);
};

const QUERY = "capture or kill";
const BOOK = "Capture or Kill";
const AUTHOR = "Vince Flynn";

// ── Must REJECT: real junk from that response ──
const junk = [
  "Computational Cognitive Neuroscience",
  "Statistical Thinking for the 21st Century",
  "Laboratory Manual - Computer Programming",
  "The Politics of Sports",
  "Capture the Saint",
  "The Capture of Cerberus",
  "I Capture the Castle",
  "Quake II - Capture the Flag",
  "The 3 Kingdoms, The Water Margin, & the",
  "King Arthur & his Noble Knights of the Round Table",
  "Batman: Knightfall (Volumes 1-3)",
];
for (const t of junk) {
  check(
    `rejects "${t.slice(0, 38)}"`,
    !isRelevantMirrorResult({ query: QUERY, bookTitle: BOOK, bookAuthor: AUTHOR, candidateTitle: t })
  );
}

// ── Must ACCEPT: the genuine LibGen hits from the same response ──
const real = [
  "Capture or Kill: A Mitch Rapp Novel",
  "Capture Or Kill Mitch Rapp 23",
  "Kill or Capture",
  "Capture or Kill",
];
for (const t of real) {
  check(
    `accepts "${t.slice(0, 38)}"`,
    isRelevantMirrorResult({ query: QUERY, bookTitle: BOOK, bookAuthor: AUTHOR, candidateTitle: t })
  );
}

// ── Author-only rescue: a differently-formatted edition by the right author ──
check(
  "author match rescues a reformatted title",
  isRelevantMirrorResult({
    query: QUERY, bookTitle: BOOK, bookAuthor: AUTHOR,
    candidateTitle: "Mitch Rapp 23",
    candidateAuthor: "Vince Flynn",
  }),
  '"Mitch Rapp 23" by Vince Flynn'
);

// ── A wrong-author book that happens to share words stays rejected ──
check(
  "same words but a different author stays rejected",
  !isRelevantMirrorResult({
    query: QUERY, bookTitle: BOOK, bookAuthor: AUTHOR,
    candidateTitle: "Capture or Kill",
    candidateAuthor: "Agatha Christie",
  })
);

// ── Edge cases ──
check("empty candidate is rejected", !isRelevantMirrorResult({ query: QUERY, bookTitle: BOOK, candidateTitle: "" }));
check("missing candidate is rejected", !isRelevantMirrorResult({ query: QUERY, bookTitle: BOOK }));
check(
  "no query context does not block",
  isRelevantMirrorResult({ candidateTitle: "Anything At All" }),
  "no book/query to contradict"
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);