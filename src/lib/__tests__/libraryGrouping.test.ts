/**
 * Library grid tile tests.
 *
 * The grid collapses multi-volume series into one tile. Two failure modes
 * matter and they pull in opposite directions: hiding a real book inside a
 * group (bad) and failing to collapse a 30-volume shelf (also bad). The
 * tests pin both, plus the toggle and the sort.
 */
import type { BookMetadata } from "../../lib/firebase";
import {
  buildLibraryTiles,
  readGroupingPreference,
  sortLibraryTiles,
  writeGroupingPreference,
  LIBRARY_GROUPING_STORAGE_KEY,
  type LibraryTile,
} from "../libraryGrouping";

let pass = 0;
let fail = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log("PASS ", name);
  } catch (e) {
    fail++;
    console.log("FAIL ", name, "—", e instanceof Error ? e.message : e);
  }
}

function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`);
}

function book(over: Partial<BookMetadata> & { id: string }): BookMetadata {
  return {
    title: over.id,
    author: "A",
    extension: "epub",
    size: "1",
    tags: [],
    status: "to-read",
    progress: { percent: 0, lastReadTime: 0 },
    dateAdded: 0,
    ...over,
  } as BookMetadata;
}

/** 30 volumes of one manga, the exact case grouping exists for. */
function onePiece(count: number): BookMetadata[] {
  return Array.from({ length: count }, (_, i) =>
    book({ id: `op${i + 1}`, title: `One Piece Volume ${i + 1}` })
  );
}

function kinds(tiles: LibraryTile[]) {
  return tiles.map((t) => t.kind);
}

test("30 volumes collapse into one tile", () => {
  const tiles = buildLibraryTiles(onePiece(30), true);
  eq(tiles.length, 1, "tile count:");
  eq(tiles[0]!.kind, "series");
  const group = (tiles[0] as { kind: "series"; group: any }).group;
  eq(group.total, 30);
  eq(group.title, "One Piece");
});

test("a lone book stays a plain tile", () => {
  const tiles = buildLibraryTiles([book({ id: "a", title: "Dune" })], true);
  eq(kinds(tiles), ["book"]);
});

test("a single volume of a series stays a plain tile", () => {
  const tiles = buildLibraryTiles([book({ id: "v1", title: "Solo Leveling Vol. 1" })], true);
  eq(kinds(tiles), ["book"], "one volume is not a group:");
});

test("mixed shelf groups only the multi-volume entries", () => {
  const tiles = buildLibraryTiles(
    [...onePiece(3), book({ id: "dune", title: "Dune" }), book({ id: "hob", title: "The Hobbit" })],
    true
  );
  eq(kinds(tiles), ["series", "book", "book"]);
});

test("no book is lost or duplicated by grouping", () => {
  const books = [...onePiece(3), book({ id: "a", title: "Dune" }), book({ id: "b", title: "Berserk Vol. 1" })];
  const tiles = buildLibraryTiles(books, true);
  const seen = tiles.flatMap((t) =>
    t.kind === "series" ? t.group.volumes.map((v) => v.id) : [t.book.id]
  );
  eq(seen.sort(), books.map((b) => b.id).sort(), "every book appears exactly once:");
});

test("turning grouping off restores one tile per book", () => {
  const books = onePiece(30);
  const tiles = buildLibraryTiles(books, false);
  eq(tiles.length, 30);
  eq(kinds(tiles).every((k) => k === "book"), true);
});

test("different sources with the same series name stay apart", () => {
  // Two plugins each publish a "Volume 1" of the same name. Merging them
  // would hide one of the books.
  const tiles = buildLibraryTiles(
    [
      book({ id: "a", title: "Solo Leveling Vol. 1", source: "MangaDex" }),
      book({ id: "b", title: "Solo Leveling Vol. 1", source: "Mangakat" }),
    ],
    true
  );
  eq(tiles.length, 2, "distinct sources do not merge:");
  eq(kinds(tiles), ["book", "book"]);
});

test("one source's volumes still group", () => {
  const tiles = buildLibraryTiles(
    [
      book({ id: "a", title: "Solo Leveling Vol. 1", source: "MangaDex" }),
      book({ id: "b", title: "Solo Leveling Vol. 2", source: "MangaDex" }),
    ],
    true
  );
  eq(tiles.length, 1);
  eq(tiles[0]!.kind, "series");
});

test("grouping defaults to on", () => {
  eq(readGroupingPreference(), true);
});

test("the toggle round-trips through storage", () => {
  const store = new Map<string, string>();
  const fake = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
  };
  writeGroupingPreference(false, fake);
  eq(store.get(LIBRARY_GROUPING_STORAGE_KEY), "0");
  eq(readGroupingPreference(fake), false, "persisted off:");
  writeGroupingPreference(true, fake);
  eq(readGroupingPreference(fake), true, "persisted on:");
});

test("title sort orders series by series name", () => {
  const tiles = sortLibraryTiles(
    buildLibraryTiles(
      [
        ...onePiece(2),
        book({ id: "b", title: "Berserk Vol. 1" }),
        book({ id: "c", title: "Berserk Vol. 2" }),
      ],
      true
    ),
    "title"
  );
  // Two Berserk volumes collapse into ONE series tile, so the result is
  // two tiles, not three. An earlier version of this assertion expected
  // both volumes to survive as separate tiles, which described the very
  // behaviour the grouping exists to remove.
  eq(tiles.map((t) => (t.kind === "series" ? t.group.title : t.book.title)), [
    "Berserk",
    "One Piece",
  ]);
});

test("newest sort floats a series up when a volume is added", () => {
  const tiles = sortLibraryTiles(
    buildLibraryTiles(
      [
        book({ id: "old", title: "Saga Vol. 1", dateAdded: 10 }),
        book({ id: "new", title: "Saga Vol. 2", dateAdded: 99 }),
        book({ id: "dune", title: "Dune", dateAdded: 50 }),
      ],
      true
    ),
    "dateAdded"
  );
  // The group is dated by its newest volume (99), so it leads.
  eq(tiles[0]!.kind, "series");
  eq(tiles[1]!.kind, "book");
});

test("progress sort uses the furthest-read volume", () => {
  const tiles = sortLibraryTiles(
    buildLibraryTiles(
      [
        book({ id: "a", title: "Berserk Vol. 1", progress: { percent: 10, lastReadTime: 1 } }),
        book({ id: "b", title: "Berserk Vol. 2", progress: { percent: 80, lastReadTime: 1 } }),
        book({ id: "c", title: "Dune", progress: { percent: 40, lastReadTime: 1 } }),
      ],
      true
    ),
    "progress"
  );
  eq(tiles.map((t) => t.kind), ["series", "book"]);
});

test("group tile carries the series name, count and representative", () => {
  const tile = buildLibraryTiles(onePiece(3), true)[0]!;
  if (tile.kind !== "series") throw new Error("expected a series tile");
  eq(tile.group.title, "One Piece");
  eq(tile.group.total, 3);
  eq(tile.group.representative.title, "One Piece Volume 1");
});

test("an empty library is not an error", () => {
  eq(buildLibraryTiles([], true), []);
  eq(buildLibraryTiles([], false), []);
});

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
