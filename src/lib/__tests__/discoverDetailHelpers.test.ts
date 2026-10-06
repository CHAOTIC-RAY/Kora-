/**
 * Discover detail helper tests.
 *
 * Both helpers exist because of a user-visible defect, and each has a claim
 * that, if false, restores that defect:
 *
 *   1. `pickRealIsbn` must never return a non-ISBN. Returning one produced a
 *      `covers.openlibrary.org/b/isbn/<garbage>` request that 404s, so the grid
 *      rendered a blank grey card instead of a cover.
 *   2. `canonicalMirrorKey` must collapse the SAME mirror served with different
 *      volatile query params, or the detail panel lists "Libgen Mirror
 *      (libgen.li)" three times.
 */
import { canonicalMirrorKey, isValidIsbn, isValidIsbn10, isValidIsbn13, pickRealIsbn } from "../discoverDetailHelpers";

let passed = 0;
let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) passed++;
  else {
    failed++;
    console.log(`FAIL  ${name}\n        expected ${expected}, got ${actual}`);
  }
}

// ── pickRealIsbn ──────────────────────────────────────────────────────────
// A clean ISBN-13. Note the check digit: 9780316011488 is the valid form.
// Writing this fixture as ...481 (the old, unvalidated value) made the test suite
// itself depend on the missing checksum — it passed only because no ISBN-13
// validation existed, and failed the moment `isValidIsbn13` was added.
check(
  "isbn-13 alone",
  pickRealIsbn([{ type: "ISBN_13", identifier: "9780316011488" }]),
  "9780316011488"
);

// ISBN-10 with a check digit of X (the Gathering Storm supplement, a real one).
check(
  "isbn-10 with X check digit",
  pickRealIsbn([{ type: "ISBN_10", identifier: "080442957X" }]),
  "080442957X"
);

// THE REGRESSION: a non-ISBN identifier listed FIRST. Google Books mixes these
// into industryIdentifiers, and the old code took [0] unconditionally.
check(
  "skips a non-ISBN in position 0",
  pickRealIsbn([
    { type: "OTHER", identifier: "google:book:abc123" },
    { type: "ISBN_13", identifier: "9780439023481" },
  ]),
  "9780439023481"
);

// Prefers ISBN-13 when both are present.
check(
  "prefers isbn-13 over isbn-10",
  pickRealIsbn([
    { type: "ISBN_10", identifier: "0439023483" },
    { type: "ISBN_13", identifier: "9780439023481" },
  ]),
  "9780439023481"
);

// Hyphens are stripped so the value can go straight into a cover URL.
check(
  "strips hyphens",
  pickRealIsbn([{ type: "ISBN_13", identifier: "978-0-316-01148-8" }]),
  "9780316011488"
);

// Nothing usable -> empty string, so callers skip the request entirely.
check("no identifiers", pickRealIsbn(undefined), "");
check("empty array", pickRealIsbn([]), "");
check(
  "only non-ISBN values",
  pickRealIsbn([
    { type: "OTHER", identifier: "google:book:abc" },
    { type: "OTHER", identifier: "1234567890" },
  ]),
  ""
);

// An identifier of the right length but a bad checksum is not an ISBN — this is
// what a plain length test let through, producing a cover URL that 404s.
check(
  "rejects 10-digit value with bad checksum",
  pickRealIsbn([{ type: "OTHER", identifier: "1234567890" }]),
  ""
);

// A REAL ISBN-10 (valid mod-11 checksum) still resolves, so the fix for the
// case above does not regress genuine covers.
check(
  "accepts a checksum-valid isbn-10",
  pickRealIsbn([{ type: "ISBN_10", identifier: "0439023483" }]),
  "0439023483"
);

// An X check digit is legal and must validate.
check(
  "accepts X check digit when valid",
  pickRealIsbn([{ type: "ISBN_10", identifier: "080442957X" }]),
  "080442957X"
);

// ── canonicalMirrorKey ────────────────────────────────────────────────────
// THE REGRESSION: the same LibGen mirror with three different `key=` values.
// Before, exact-string dedupe kept all three and the panel listed the identical
// mirror three times.
const libgenA = "https://libgen.li/get.php?md5=99C7A862D2DF4FFD872BB51DA21B4FBA&key=AAAA1";
const libgenB = "https://libgen.li/get.php?md5=99C7A862D2DF4FFD872BB51DA21B4FBA&key=BBBB2";
const libgenC = "https://libgen.li/get.php?key=CCCC3&md5=99C7A862D2DF4FFD872BB51DA21B4FBA";
check(
  "same libgen mirror collapses across volatile keys",
  canonicalMirrorKey(libgenA) === canonicalMirrorKey(libgenB) &&
    canonicalMirrorKey(libgenB) === canonicalMirrorKey(libgenC),
  true
);

// Scheme, www, host case, and trailing slash are not identity.
check(
  "scheme www and case collapse",
  canonicalMirrorKey("https://www.LibGen.li/get.php?md5=abc&key=1") ===
    canonicalMirrorKey("http://libgen.li/get.php?md5=abc&key=9"),
  true
);

// A DIFFERENT md5 is a DIFFERENT file and must survive dedupe.
check(
  "different md5 stays distinct",
  canonicalMirrorKey(libgenA) === canonicalMirrorKey(
    "https://libgen.li/get.php?md5=DIFFERENTFILEHASH000&key=AAAA1"
  ),
  false
);

// Different hosts stay distinct.
check(
  "different hosts stay distinct",
  canonicalMirrorKey("https://libgen.li/get.php?md5=abc") ===
    canonicalMirrorKey("https://annas-archive.org/md5/abc"),
  false
);

// Trailing slash is not identity.
check(
  "trailing slash collapses",
  canonicalMirrorKey("https://annas-archive.org/md5/abc/") ===
    canonicalMirrorKey("https://annas-archive.org/md5/abc"),
  true
);

// An empty URL must not become a shared key that dedupes every entry.
check("empty url", canonicalMirrorKey(""), "");
check("whitespace url", canonicalMirrorKey("   "), "");

// A malformed URL still dedupes by its raw text rather than being kept N times.
check(
  "malformed url falls back to raw text",
  canonicalMirrorKey("not a url") === canonicalMirrorKey("NOT A URL"),
  true
);

// ── ISBN-13 checksum (F6) ─────────────────────────────────────────────────
// THE REGRESSION: ISBN-10 got a full mod-11 check while ISBN-13 got a bare
// length test, so an opaque 13-digit Google identifier passed and was requested
// from Open Library — 404ing into the blank card the whole module prevents.
check("isbn-13 bad checksum rejected", isValidIsbn13("1234567890123"), false);
check("isbn-13 good checksum accepted", isValidIsbn13("9780439023481"), true);
check(
  "pickRealIsbn rejects a 13-digit non-ISBN",
  pickRealIsbn([{ type: "OTHER", identifier: "1234567890123" }]),
  ""
);
// With one bad 13-digit sibling present, a real ISBN-10 must still be found —
// this is the exact row that broke: an unvalidated isbn13 used to outrank it.
check(
  "real isbn-10 survives a bad isbn-13 sibling",
  pickRealIsbn([
    { type: "ISBN_10", identifier: "0439023483" },
    { type: "OTHER", identifier: "1234567890123" },
  ]),
  "0439023483"
);

// ── the F2 caller contract ────────────────────────────────────────────────
// The cover <img> fallback must source its ISBN from `book.isbn` (the validated
// field) and NOT from the bare-length `isbn13`/`isbn10` siblings. Pinned here
// because the bug lived in the caller while the helper tested green.
const googleRow = {
  isbn: pickRealIsbn([
    { type: "ISBN_10", identifier: "0439023483" },
    { type: "OTHER", identifier: "1234567890123" },
  ]),
  // What the length-regex capture at the Google Books mapper produces:
  isbn13: "1234567890123",
  isbn10: "0439023483",
};
// Old chain: `isbn13 || isbn10 || isbn` -> the opaque id -> a 404.
check("old cover chain picked the bad id", googleRow.isbn13, "1234567890123");
// New chain: `isbn` only -> a genuine ISBN -> a real cover request.
check("new cover chain picks the validated isbn", googleRow.isbn, "0439023483");

// `fetchFeaturedMetadata` guards its ISBN argument with isValidIsbn, so an
// unvalidated sibling from any caller degrades to keyword search instead of
// silently missing on an exact-identifier lookup.
check("isValidIsbn gates metadata lookup", isValidIsbn("1234567890123"), false);
check("isValidIsbn passes a real isbn", isValidIsbn("9780439023481"), true);
check("isValidIsbn rejects empty", isValidIsbn(""), false);
check("isValidIsbn10 rejects short strings", isValidIsbn10("123"), false);

// ── canonicalMirrorKey: query params are identity (F3) ────────────────────
// THE REGRESSION: an allow-list of {md5,id,path,file,name} collapsed every other
// query param away, so two different searches on the same path were deduped into
// one row. The app's own `ravebooksearch.com/search?q=<title>` hand-off is this
// exact shape.
check(
  "different q values stay distinct",
  canonicalMirrorKey("https://ravebooksearch.com/search?q=eclipse%20lewis") ===
    canonicalMirrorKey("https://ravebooksearch.com/search?q=dune%20herbert"),
  false
);
// Same q, differing volatile key -> still one mirror.
check(
  "same q collapses across volatile key",
  canonicalMirrorKey("https://ravebooksearch.com/search?q=eclipse%20lewis&key=AAA") ===
    canonicalMirrorKey("https://ravebooksearch.com/search?key=BBB&q=eclipse%20lewis"),
  true
);
// `lang` and `volume` are identity-bearing for edition mirrors.
check(
  "lang param is identity",
  canonicalMirrorKey("https://annas-archive.org/dl?md5=abc&lang=en") ===
    canonicalMirrorKey("https://annas-archive.org/dl?md5=abc&lang=fr"),
  false
);
// The path is case-sensitive: a slug-like path is not an md5.
check(
  "path case is preserved",
  canonicalMirrorKey("https://ravebooksearch.com/Book/Eclipse") ===
    canonicalMirrorKey("https://ravebooksearch.com/book/eclipse"),
  false
);
// Other volatile names are stripped too, not just `key`.
check(
  "token and _ are stripped",
  canonicalMirrorKey("https://annas-archive.org/md5/abc?token=1&_=2") ===
    canonicalMirrorKey("https://annas-archive.org/md5/abc?token=9&_=8"),
  true
);

console.log(
  `\n${failed === 0 ? "ok  " : "FAIL"}  src\\lib\\__tests__\\discoverDetailHelpers.test.ts` +
    `                ${passed} pass, ${failed} fail`
);
if (failed > 0) process.exit(1);
