/**
 * A non-manga source plugin must never open the comic reader.
 *
 * Reported 2026-10-05: "ocean of epub cant read or download", with the detail
 * panel saying *"This site does not publish its chapter list in the page HTML —
 * it builds it in the browser. A full reader needs to run in one."*
 *
 * That notice comes from `ComicDetailView.tsx:180`, so the result had reached
 * the comic reader. Two independent bugs sent it there:
 *
 *  1. `else if (book.pluginId)` — the click handler tested only that a plugin
 *     produced the row, never its `kind`. Every plugin result, book or manga,
 *     went to `setComicBook`.
 *
 *  2. `const kind = plugin.kind === "book" ? "book" : "manga"` — a binary test
 *     that collapsed `mixed` into `manga` when building the row.
 *
 * The comic reader needs chapters and pages. A `kind: "book"` or `"mixed"`
 * plugin has neither, so the series screen is structurally empty — hence the
 * notice. Both are fixed to route only explicit `kind: "manga"` there.
 *
 * Ocean of EPUB is `kind: "mixed"`: its own titles carry `[EPUB][PDF]` and
 * `[MANGA][CBZ]` prefixes, and the page markup exposes both categories.
 */
import fs from "node:fs";

const FILE = "src/components/DiscoverView.tsx";
const src = fs.readFileSync(FILE, "utf8");

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

console.log("=== the click handler gates on kind ===");
// The dangerous shape: a branch that fires on pluginId alone.
const barePluginBranch = /else if \(book\.pluginId\)\s*\{[^}]*setComicBook\(/s;
check(
  "no branch sends a plugin result to the comic reader on pluginId alone",
  !barePluginBranch.test(src),
  "this is what put a book source in the series reader"
);
check(
  "setComicBook is reached only via kind === \"manga\"",
  /book\.pluginId && book\.kind === "manga"\)\s*\{\s*(?:\/\/[^\n]*\n\s*)*setComicBook\(/s.test(src),
  "explicit manga guard"
);
check(
  "a book-kind plugin falls through to the ebook sheet",
  /else if \(book\.pluginId\)\s*\{\s*(?:\/\/[^\n]*\n\s*)*handleGetDownloadLinks\(/.test(src),
  "handleGetDownloadLinks"
);

console.log("\n=== the row builder honours mixed ===");
check(
  "kind is not a binary book-vs-manga test",
  !/plugin\.kind === "book" \? "book" : "manga"/.test(src),
  "`mixed` used to collapse to manga here"
);
check(
  "only an explicit manga kind takes the manga route",
  /plugin\.kind === "manga" \? "manga" : "book"/.test(src),
  'plugin.kind === "manga" ? "manga" : "book"'
);

console.log("\n=== the notice is where we thought ===");
const comic = fs.readFileSync("src/components/ComicDetailView.tsx", "utf8");
check(
  "the chapter-list notice lives in ComicDetailView",
  comic.includes("does not publish its chapter list"),
  "so the user saw it because the row was routed there"
);

console.log("\n=== Ocean of EPUB is mixed, so it now takes the book sheet ===");
let kind = "(manifest not found)";
try {
  const mf = "D:/Wafig/Hermes/Kora-Sources/sources/books/oceanofepub.json";
  if (fs.existsSync(mf)) kind = JSON.parse(fs.readFileSync(mf, "utf8")).kind;
} catch {
  /* keep default */
}
check("manifest kind is \"mixed\"", kind === "mixed", `kind=${kind}`);
check(
  "mixed resolves to the book route under the fixed expression",
  // `plugin.kind === "manga" ? "manga" : "book"` — anything not manga is a book.
  kind !== "manga",
  "so it opens the ebook sheet, which offers the online copy"
);

console.log("\n=== this cannot regress the manga path ===");
check(
  "explicit manga plugins still reach the series reader",
  /book\.pluginId && book\.kind === "manga"/.test(src),
  "unchanged for manga sources"
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);