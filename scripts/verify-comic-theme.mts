/**
 * The comic reader must not reintroduce hardcoded alpha-white chrome.
 *
 * It was built with a fixed dark palette (`text-white/*`, `bg-white/*`,
 * `bg-black/*`) regardless of the selected reading theme, so it ignored the app
 * theme entirely and read as a different app from the EPUB reader. Its own
 * loading/error chrome in ReaderPageImage had the same problem — and a
 * `text-white/40` spinner over a now-light reader background is unreadable on
 * Paper/Sepia.
 *
 * The EPUB reader is deliberately NOT covered by this rule: it has its own
 * `neutral-*` branches and the two are not required to be byte-identical.
 */
import fs from "node:fs";

const COMIC_FILES = [
  "src/components/ComicReader.tsx",
  "src/components/ReaderPageImage.tsx",
];

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

// The one permitted exception: the top bar keeps light/dark surface branches
// exactly as the EPUB reader's own prev/next buttons do (`bg-white` vs
// `bg-neutral-900`), because a themed surface alone cannot carry a translucent
// bar that reads on both.
const ALLOWED: Record<string, RegExp> = {
  "src/components/ComicReader.tsx": /^bg-white\/80$/,
};

console.log("=== comic chrome uses theme tokens ===");
for (const f of COMIC_FILES) {
  const src = fs.readFileSync(f, "utf-8");
  const allow = ALLOWED[f];
  const found: string[] = [];
  for (const m of src.matchAll(/(?:text|bg|border|accent)-(?:white|black)(?:\/[0-9]+)?|text-black/g)) {
    if (allow && allow.test(m[0])) continue;
    found.push(m[0]);
  }
  check(`${f}: no hardcoded white/black chrome`, found.length === 0, found.join(", "));
}

console.log("\n=== tokens actually present ===");
const comic = fs.readFileSync(COMIC_FILES[0], "utf-8");
for (const t of [
  "bg-kindle-card",
  "border-kindle-border",
  "text-kindle-text-muted",
  "activeTheme",
  "READER_THEMES",
  "--kora-safe-bottom",
]) {
  check(`ComicReader uses ${t}`, comic.includes(t));
}

console.log("\n=== theme pref is validated ===");
const prefs = fs.readFileSync("src/lib/comicReaderSettings.ts", "utf-8");
check("ComicReaderPrefs declares theme", /theme:\s*string/.test(prefs));
check("sanitizer rejects unknown theme keys", prefs.includes("in READER_THEMES"));

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);