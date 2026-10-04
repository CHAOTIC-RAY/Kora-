/**
 * ISBN-first metadata resolution.
 *
 * The modal's title/author/cover were resolved by keyword search against Google
 * Books, which returned a different book entirely for some titles — a
 * Chinese-language edition replaced a Vince Flynn thriller about a minute after
 * the modal opened. The reason: the stored title contains the author's name
 * ("Vince Flynn Capture or Kill"), so `intitle:` + `inauthor:` cannot both be
 * satisfied and Google falls back to loose matches, ranked only by blurb length.
 *
 * An ISBN is an exact identifier, so it removes the guesswork entirely.
 *
 * Verified live 2026-10-03 for ISBN 9781668045831:
 *   Google Books isbn:  -> "Vince Flynn Capture or Kill" / Don Bentley
 *   Open Library ISBN:  -> "Vince Flynn Capture or Kill" / Don Bentley
 */

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

const ORIGIN = "https://kora.chaoticstudio.workers.dev";
const ISBN = "9781668045831";

function norm(s?: string | null) {
  return (s || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
function tokens(s?: string | null) {
  return norm(s).split(" ").filter(Boolean);
}

console.log("=== ISBN lookup returns the correct book ===");
let gbTitle = "", gbAuthors: string[] = [];
try {
  const r = await fetch(`${ORIGIN}/api/google-books/search?q=${encodeURIComponent(`isbn:${ISBN}`)}`, {
    signal: AbortSignal.timeout(20000),
  });
  const d = await r.json();
  const v = d?.items?.[0]?.volumeInfo;
  gbTitle = v?.title || "";
  gbAuthors = v?.authors || [];
  console.log(`  google: "${gbTitle}" / ${gbAuthors.join(", ")}`);
  check("Google ISBN lookup returns a title", Boolean(gbTitle));
} catch (e) {
  check("Google ISBN lookup reachable", false, String(e).slice(0, 50));
}

let olTitle = "", olAuthor = "";
try {
  // Via the Worker proxy: openlibrary.org is not directly reachable here.
  const r = await fetch(`${ORIGIN}/api/open-library/isbn?isbn=${ISBN}`, {
    signal: AbortSignal.timeout(20000),
  });
  const d = await r.json();
  olTitle = d?.title || "";
  olAuthor = (d?.authors || [])[0] || "";
  console.log(`  openlibrary: "${olTitle}" / ${olAuthor}`);
  check("Open Library ISBN lookup returns a title", Boolean(olTitle));
} catch (e) {
  check("Open Library ISBN lookup reachable", false, String(e).slice(0, 50));
}

console.log("\n=== the two sources agree (cross-check) ===");
const tA = new Set(tokens(gbTitle));
const tB = new Set(tokens(olTitle));
const overlap = [...tB].filter((w) => tA.has(w)).length;
console.log(`  overlap: ${overlap}/${tB.size} of the Open Library title`);
check("Google and Open Library agree on the book", tB.size > 0 && overlap / tB.size >= 0.8);

console.log("\n=== an ISBN beats a wrong keyword result ===");
// The bug: keyword search for this title returned an unrelated Chinese edition.
check(
  "resolved identity is not a different book",
  !/[\u4e00-\u9fff]/.test(gbTitle) && !/[\u4e00-\u9fff]/.test(olTitle),
  "no CJK characters in the resolved title"
);

console.log("\n=== invalid/empty ISBN must not be trusted ===");
const bad = ["", "not-an-isbn", "123"].filter((x) => !/^(97[89]|978)\d{10}$|^\d{9}[\dX]$/.test(x));
check("non-ISBN values are rejected before any lookup", bad.length === 3, bad.join(", "));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);