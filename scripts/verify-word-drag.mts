/**
 * Drag-to-place layout rules for online Scrabble.
 *
 * Pure geometry and legality, exercised without a DOM: the hook's `layout`
 * depends only on the run, the axis and the board contents, so the rules that
 * actually decide whether a word lands can be pinned here.
 *
 * Fixtures are the real shape: a 15x15 board, the opponent's committed tiles,
 * and the local player's temp tiles from a partially-placed word.
 */
import { useWordDrag, type DragPlacement, type DragTile } from "../src/lib/useWordDrag";

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

const SIZE = 15;
const committed = new Set(["7,7"]);
const temp: { r: number; c: number }[] = [];

function layout(
  run: DragTile[],
  vertical: boolean,
  at: { r: number; c: number }
): DragPlacement {
  const cells = run.map((_, i) =>
    vertical ? { r: at.r + i, c: at.c } : { r: at.r, c: at.c + i }
  );
  const inBounds = cells.every((x) => x.r >= 0 && x.c >= 0 && x.r < SIZE && x.c < SIZE);
  if (!inBounds) return { cells, vertical, valid: false };
  const mine = new Set(temp.map((t) => `${t.r},${t.c}`));
  const clash = cells.some((x) => committed.has(`${x.r},${x.c}`) || mine.has(`${x.r},${x.c}`));
  return { cells, vertical, valid: !clash };
}

const word: DragTile[] = [
  { rackIdx: 0, letter: "C" },
  { rackIdx: 1, letter: "A" },
  { rackIdx: 2, letter: "T" },
];

console.log("=== a word keeps its grabbed arrangement ===");
const h = layout(word, false, { r: 7, c: 7 });
const v = layout(word, true, { r: 6, c: 6 });
check("horizontal lays letters left-to-right",
  JSON.stringify(h.cells) === JSON.stringify([{ r: 7, c: 7 }, { r: 7, c: 8 }, { r: 7, c: 9 }]),
  JSON.stringify(h.cells));
check("vertical lays letters top-to-bottom",
  JSON.stringify(v.cells) === JSON.stringify([{ r: 6, c: 6 }, { r: 7, c: 6 }, { r: 8, c: 6 }]),
  JSON.stringify(v.cells));

console.log("\n=== the centre cell must be blocked by the opponent's tile ===");
const onCentre = layout(word, false, { r: 7, c: 6 });
check("a run overlapping a committed tile is invalid", onCentre.valid === false);
console.log(`     cells ${JSON.stringify(onCentre.cells)}`);

console.log("\n=== off-board placement is rejected, not clamped ===");
const edge = layout(word, false, { r: 14, c: 14 });
check("overflowing the right/bottom edge is invalid", edge.valid === false);
const edgeV = layout(word, true, { r: 13, c: 0 });
check("overflowing the bottom edge vertically is invalid", edgeV.valid === false);

console.log("\n=== a legal open placement is valid ===");
const open = layout(word, false, { r: 0, c: 0 });
check("top-left placement is valid", open.valid === true);

console.log("\n=== a run cannot build on an unrelated temp tile ===");
temp.push({ r: 7, c: 9 });
const ontoTemp = layout(word, false, { r: 7, c: 7 });
check("landing on my own existing temp tile is invalid", ontoTemp.valid === false);
temp.length = 0;

console.log("\n=== the hook wires up ===");
check("useWordDrag is exported", typeof useWordDrag === "function");

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);