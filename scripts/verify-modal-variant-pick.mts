/**
 * The modal picked `searchResult.books[0]` — RAW API order — as the active
 * variant. Rave returns RoyalLib HTML pages first for most queries, so the modal
 * opened on a page with no md5 and could only offer "Search open catalogs",
 * even when the same response contained real LibGen EPUBs further down.
 *
 * Reported 2026-10-03 for "Vince Flynn Capture or Kill": the edition list showed
 * HTML/EPUB/EBOOK, but the mirrors said "Search open catalogs".
 *
 * This asserts the property that actually matters — THE SELECTED VARIANT MUST
 * CARRY AN md5 — rather than asserting on labels.
 *
 * Rows are the real ones from the live response to that query.
 */
import { matchesEditionStrictly, isRelevantMirrorResult } from "../src/lib/mirrorRelevance";

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

interface Row { title: string; author: string; source: string; ext: string; md5: string | null }

// Real payload for "Vince Flynn Capture or Kill Don Bentley", in API order.
const BOOKS: Row[] = [
  { title: "First to Kill", author: "", source: "RoyalLib", ext: "HTML", md5: null },
  { title: "The Kill", author: "", source: "RoyalLib", ext: "HTML", md5: null },
  { title: "I Capture the Castle", author: "E. Nesbit", source: "RoyalLib", ext: "HTML", md5: null },
  { title: "Capture or Kill: A Mitch Rapp Novel", author: "Vince Flynn; Don Bentley", source: "Library Genesis", ext: "EPUB", md5: "649CBEEEC91055459C251E1D0AC65440" },
  { title: "Capture Or Kill Mitch Rapp 23", author: "Vince Flynn & Don Bentley", source: "Library Genesis", ext: "EPUB", md5: "3A07E6DC86B2196CFFBE7FE10FD5CC19" },
  { title: "Capture or Kill", author: "Vince Flynn & Don Bentley", source: "Library Genesis", ext: "EPUB", md5: "863603C2117B0A786F83144BBB40D7B9" },
  { title: "Math 125: Hope College", author: "", source: "LibreTexts", ext: "PDF", md5: null },
];

const TITLE = "Vince Flynn Capture or Kill";
const AUTHOR = "Don Bentley";
const Q = "Vince Flynn Capture or Kill Don Bentley";

// --- old behaviour ---
const oldPick = BOOKS[0];
console.log("=== OLD: books[0] ===");
console.log(`  picked: ${oldPick.title} [${oldPick.source}] md5=${oldPick.md5 ? "Y" : "NONE"}`);
check("old code picked a variant with no md5", !oldPick.md5, "=> mirrors can only be a search page");

// --- new behaviour (mirrors the shipped fix) ---
const strict = BOOKS.filter((b) =>
  matchesEditionStrictly({ title: TITLE, author: AUTHOR, candidateTitle: b.title, candidateAuthor: b.author })
);
const relaxed = BOOKS.filter((b) =>
  isRelevantMirrorResult({
    query: Q, bookTitle: TITLE, bookAuthor: AUTHOR,
    candidateTitle: b.title, candidateAuthor: b.author,
  })
);
const usable = strict.length > 0 ? strict : relaxed;
const chosen = usable.length > 0 ? usable : BOOKS;

// rankVariants, transcribed.
const langRank = (v: Row) => { const l = ""; return l ? 1 : 1; };
const sourceRank = (v: Row) => { const s = v.source.toLowerCase(); if (s.includes("rave")) return 0; if (s.includes("libgen")) return 1; return 2; };
const FORMATS = ["epub", "azw3", "mobi", "fb2", "pdf"];
const formatRank = (v: Row) => { const i = FORMATS.indexOf(v.ext.toLowerCase()); return i === -1 ? FORMATS.length : i; };
chosen.sort((a, b) => langRank(a) - langRank(b) || sourceRank(a) - sourceRank(b) || formatRank(a) - formatRank(b));

console.log("\n=== NEW: filtered + ranked ===");
chosen.forEach((b, i) => console.log(`  ${i + 1}. [${b.source}] ${b.ext} md5=${b.md5 ? "Y" : "n"}  ${b.title}`));
const pick = chosen[0];
console.log(`\n  picked: ${pick.title} [${pick.source}] md5=${pick.md5 ? "Y" : "NONE"}`);

console.log("\n=== assertions ===");
check("selected variant HAS an md5", Boolean(pick.md5), pick.md5 || "");
check("selected variant is a real file source", pick.source === "Library Genesis");
check("selected variant is the right book", /capture or kill/i.test(pick.title));
check("all 3 real EPUBs survive", chosen.filter((b) => b.md5).length === 3, `${chosen.filter((b) => b.md5).length}/3`);
check("RoyalLib pages excluded", !chosen.some((b) => b.source === "RoyalLib"));
check("LibreTexts math textbook excluded", !chosen.some((b) => /Hope College/.test(b.title)));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);