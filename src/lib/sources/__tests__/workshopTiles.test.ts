/**
 * Workshop tile placement — themes are not Workshop tiles.
 *
 * Asserted here rather than in `pluginPlacement.test.ts` because that file
 * pins the `surfaceForCategory` mapping (which still says `theme -> workshop`,
 * owned by another change) and the two must not be confused. This file owns the
 * narrower rule the Workshop *grid* actually renders: integrations and tools
 * only.
 */

import { isWorkshopTile, WORKSHOP_TILE_CATEGORIES } from "../../../components/PluginBentoTiles";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}`, got ?? "");
  }
}

const m = (category: string) => ({ category }) as any;

// ── The grid filter ──────────────────────────────────────────────────────────

check("an integration gets a tile", isWorkshopTile(m("integration")) === true);
check("a tool gets a tile", isWorkshopTile(m("tool")) === true);

// The actual bug: themes used to render in the Workshop bento grid.
check("a theme does NOT get a tile", isWorkshopTile(m("theme")) === false);
check("a source does NOT get a tile", isWorkshopTile(m("source")) === false);

check(
  "the category list is exactly integration + tool",
  JSON.stringify([...WORKSHOP_TILE_CATEGORIES].sort()) ===
    JSON.stringify(["integration", "tool"]),
  [...WORKSHOP_TILE_CATEGORIES]
);

check(
  "no theme category leaked into the filter",
  !(WORKSHOP_TILE_CATEGORIES as readonly string[]).includes("theme"),
  WORKSHOP_TILE_CATEGORIES
);

// ── The grid filter must agree with itself, per category ─────────────────────

for (const cat of ["source", "theme", "integration", "tool", "something-new"]) {
  check(
    `${cat}: matches the list membership exactly`,
    isWorkshopTile(m(cat)) === (WORKSHOP_TILE_CATEGORIES as readonly string[]).includes(cat),
    cat
  );
}

console.log(`\nworkshopTiles: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
