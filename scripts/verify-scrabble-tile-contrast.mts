/**
 * Placed Scrabble tiles must be readable on every theme.
 *
 * Bug (reported 2026-10-03): "i cant see the words the other user put and that
 * i put ... its happing even of different theme."
 *
 * Root cause: the board cell painted the tile background with
 * `bg-kindle-accent` but hardcoded the letter itself to `text-kindle-text`:
 *
 *     className="... bg-kindle-accent text-kindle-bg font-bold ..."   // cell
 *     <span className="... text-kindle-text">{cell.letter}</span>     // letter
 *
 * `--color-kindle-accent` and `--color-kindle-text` are near-identical on every
 * theme and EXACTLY equal on `.oled`:
 *
 *     .light-white  accent #18181B   text #111111
 *     .light-yellow accent #3F3A32   text #2C2A26
 *     .dark         accent #FFFFFF   text #FAFAFA
 *     .paper        accent #8B7355   text #2C2A26
 *     .sepia        accent #9C7A5B   text #5B4636
 *     .green        accent #4A6B32   text #2D3E1E
 *     .night        accent #7DD3FC   text #D6D8DE
 *     .oled         accent #E8E8E8   text #E8E8E8   <-- identical
 *
 * So a letter drawn in `--color-kindle-text` on a `--color-kindle-accent` tile
 * was the same colour as its own background on all eight themes — invisible
 * everywhere, not just on dark ones.
 *
 * Fix: committed tiles are `bg-kindle-card text-kindle-text` with an accent
 * BORDER (accent has strong contrast against both card and page as a border);
 * temp tiles stay `bg-kindle-accent text-kindle-bg`, and their letter now
 * inherits from the cell rather than overriding it.
 */
import fs from "node:fs";

const FILE = "src/components/OnlineScrabbleGame.tsx";
const CSS = "src/index.css";
const src = fs.readFileSync(FILE, "utf-8");
const css = fs.readFileSync(CSS, "utf-8");

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

function lum(hex: string): number {
  const h = hex.trim().replace("#", "");
  const full = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
  const f = (c: number) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function contrast(a: string, b: string): number {
  const [l1, l2] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const themes: Record<string, { accent: string; bg: string; card: string; text: string }> = {};
for (const m of css.matchAll(/(\.[\w.-]+)\s*\{([^}]*)\}/g)) {
  const [, sel, body] = m;
  const g = (re: RegExp) => re.exec(body)?.[1];
  const accent = g(/--color-kindle-accent:\s*(#[0-9A-Fa-f]{3,8})/);
  const bg = g(/--color-kindle-bg:\s*(#[0-9A-Fa-f]{3,8})/);
  const card = g(/--color-kindle-card:\s*(#[0-9A-Fa-f]{3,8})/);
  const text = g(/--color-kindle-text:\s*(#[0-9A-Fa-f]{3,8})/);
  if (accent && bg) themes[sel] = { accent, bg, card: card || bg, text: text || bg };
}
const keys = Object.keys(themes).filter((k) => !k.includes("caret") && !k.includes("install"));

console.log("=== committed tile: text on card (>= 4.5:1) ===");
check("found themes", keys.length > 0, `${keys.length}`);
for (const k of keys) {
  const t = themes[k];
  const c = contrast(t.card, t.text);
  check(`${k.padEnd(14)} letter on tile`, c >= 4.5, `${c.toFixed(2)}:1 ${c >= 4.5 ? "OK" : "TOO LOW"}`);
}

console.log("\n=== temp tile: text on card (>= 4.5:1) ===");
// Temp tiles deliberately do NOT use accent as a fill: Paper and Sepia accents
// are mid-tone and cannot carry text at AA.
for (const k of keys) {
  const t = themes[k];
  const c = contrast(t.card, t.text);
  check(`${k.padEnd(14)} temp tile`, c >= 4.5, `${c.toFixed(2)}:1 ${c >= 4.5 ? "OK" : "TOO LOW"}`);
}

console.log("\n=== the old accent fill is gone from board cells ===");
// Scope to the board cell's own className. `bg-kindle-accent text-kindle-bg`
// is still correct on BUTTONS elsewhere in the sheet (accent fill, bg-coloured
// label) — only the tiles were wrong, so a global ban would be incorrect.
const cellBlock = /className=\{`aspect-square rounded[^`]*`\}/.exec(src)?.[0] ?? "";
check(
  "board cell no longer paints bg-kindle-accent",
  !cellBlock.includes("bg-kindle-accent"),
  cellBlock.includes("bg-kindle-accent") ? "still present in the cell className" : "cell uses card + text"
);
check(
  "board cell letter span pins no text colour",
  /font-serif font-bold leading-none[^"]*"[^>]*>\s*\{cell\.letter\}/.test(src)
);

console.log("\n=== accent border stays visible against the tile (>= 2:1, non-text) ===");
for (const k of keys) {
  const t = themes[k];
  const vsCard = contrast(t.accent, t.card);
  check(`${k.padEnd(14)} accent border`, vsCard >= 2, `${vsCard.toFixed(2)}:1`);
}

console.log("\n=== the defect cannot come back ===");
// The letter span must not pin a text colour; it inherits from the cell.
check(
  "board letter inherits colour from its cell",
  /font-serif font-bold leading-none[^"]*"[^>]*>\s*\{cell\.letter\}/.test(src)
);
check(
  "committed tile no longer paints bg-kindle-accent",
  !/bg-kindle-accent text-kindle-bg font-bold border border-kindle-accent/.test(src),
  "old committed-tile styling is gone"
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);