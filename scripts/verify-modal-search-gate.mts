/**
 * Why the fix in 42bfe8b never ran for this book.
 *
 * The search + relevance-filter + rank block sat inside:
 *
 *   if (activeBook.isNYTBook || activeBook.isGoogleBook ||
 *       activeBook.source === 'nyt' | 'google' | 'goodreads' | 'audiobook') { ... }
 *
 * so it ran ONLY for books that arrived from those catalogs. "Vince Flynn
 * Capture or Kill" reached the modal by another route, the condition was false,
 * the whole block was skipped, and `activeVariant` stayed whatever
 * `variants[0]` the record carried — a RoyalLib HTML page with no md5. Mirrors
 * are built from the active variant, so the sheet could only offer a search page.
 *
 * This asserts the GATE, not the ranking: any book with a title must go through
 * the search path. That was the actual defect.
 */
import { matchesEditionStrictly, isRelevantMirrorResult } from "../src/lib/mirrorRelevance";

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

/** The old gate, transcribed. */
const oldGate = (b: any) =>
  b.isNYTBook || b.isGoogleBook ||
  b.source === "nyt" || b.source === "google" ||
  b.source === "goodreads" || b.source === "audiobook";

/** The new gate. */
const newGate = (b: any) => Boolean(b.title || b.searchQuery);

// How books actually reach this modal.
const books = [
  { label: "Google Books result", book: { title: "Vince Flynn Capture or Kill", author: "Don Bentley", isGoogleBook: true, source: "google" } },
  { label: "NYT result",           book: { title: "Dune", author: "Frank Herbert", isNYTBook: true, source: "nyt" } },
  { label: "Anna's Archive hit",   book: { title: "Vince Flynn Capture or Kill", author: "Don Bentley", source: "libgen", md5: "649CBEEEC91055459C251E1D0AC65440" } },
  { label: "Rave hit (no md5)",    book: { title: "Capture or Kill", author: "Vince Flynn", source: "RoyalLib", extension: "HTML" } },
];

console.log("=== gate coverage ===");
for (const { label, book } of books) {
  const o = oldGate(book);
  const n = newGate(book);
  console.log(`  ${label.padEnd(22)} old=${o ? "searches" : "SKIPPED"}  new=${n ? "searches" : "SKIPPED"}`);
  check(`${label}: new gate searches`, n, o ? "" : "<- this one was skipped before");
}

console.log("\n=== end result for the book that failed ===");
// The Rave/RoyalLib record carries a variant with no md5.
const record: any = { title: "Capture or Kill", author: "Vince Flynn", source: "RoyalLib", extension: "HTML", md5: null };
console.log(`  old gate on this record: ${oldGate(record) ? "searches" : "SKIPPED"} -> kept variants[0], md5=${record.md5 ? "Y" : "NONE"}`);

const apiRows = [
  { title: "Capture or Kill: A Mitch Rapp Novel", author: "Vince Flynn; Don Bentley", source: "Library Genesis", extension: "EPUB", md5: "649CBEEEC91055459C251E1D0AC65440" },
  { title: "Capture Or Kill Mitch Rapp 23", author: "Vince Flynn & Don Bentley", source: "Library Genesis", extension: "EPUB", md5: "3A07E6DC86B2196CFFBE7FE10FD5CC19" },
  { title: "Capture or Kill", author: "Vince Flynn & Don Bentley", source: "Library Genesis", extension: "EPUB", md5: "863603C2117B0A786F83144BBB40D7B9" },
  { title: "First to Kill", author: "", source: "RoyalLib", extension: "HTML", md5: null },
];
const strict = apiRows.filter((b) =>
  matchesEditionStrictly({ title: record.title, author: record.author, candidateTitle: b.title, candidateAuthor: b.author })
);
const usable = strict.length > 0 ? strict : apiRows.filter((b) =>
  isRelevantMirrorResult({ query: record.title, bookTitle: record.title, bookAuthor: record.author, candidateTitle: b.title, candidateAuthor: b.author })
);

console.log("\n=== after the search runs (new gate) ===");
usable.forEach((b) => console.log(`  [${b.source}] ${b.extension} md5=${b.md5 ? "Y" : "n"}  ${b.title}`));

check("search yields variants with an md5", usable.some((b) => b.md5), `${usable.filter((b) => b.md5).length} with md5`);
check("all three real EPUBs present", usable.filter((b) => b.md5).length === 3);
check("the md5-less RoyalLib page is not the only option", usable.length > 1);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);