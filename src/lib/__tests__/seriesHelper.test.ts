/**
 * Series/volume grouping tests.
 *
 * The library groups a series into one row the way Mihon does, so the
 * grouping rules decide what a user sees as one book versus many. A wrong
 * merge hides real books, which is worse than a missed grouping, so the
 * conservative cases are pinned here.
 */
import type { BookMetadata } from "../../lib/firebase";
import {
  parseVolumeFromTitle,
  buildLibraryGroups,
  findGroupForBook,
  parseSeriesNumber,
} from "../../lib/seriesHelper";

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

test("parses 'Series Vol. 12'", () => {
  eq(parseVolumeFromTitle("Solo Leveling Vol. 12"), {
    series: "Solo Leveling",
    seriesNumber: "12",
  });
});

test("parses 'Series Volume 3'", () => {
  eq(parseVolumeFromTitle("Chainsaw Man Volume 3")?.seriesNumber, "3");
});

test("parses 'Series ch. 41'", () => {
  eq(parseVolumeFromTitle("Berserk ch. 41")?.series, "Berserk");
});

test("normalises leading zeros", () => {
  eq(parseVolumeFromTitle("Naruto Vol. 07")?.seriesNumber, "7");
});

test("parses parenthesised volume", () => {
  eq(parseVolumeFromTitle("One Piece (Vol. 4)")?.series, "One Piece");
});

test("does NOT treat a year as a volume", () => {
  // "Solo Leveling (2018)" is a title, not series "Solo Leveling" vol 2018.
  eq(parseVolumeFromTitle("Solo Leveling (2018)"), null);
});

test("does not invent a series from a plain title", () => {
  eq(parseVolumeFromTitle("The Hobbit"), null);
});

test("unnumbered series is its own group", () => {
  const g = buildLibraryGroups([book({ id: "a", title: "Dune" })]);
  eq(g.length, 1);
  eq(g[0]!.isSeries, false);
});

test("two volumes collapse into one group", () => {
  const g = buildLibraryGroups([
    book({ id: "v1", title: "Solo Leveling Vol. 1" }),
    book({ id: "v2", title: "Solo Leveling Vol. 2" }),
  ]);
  eq(g.length, 1);
  eq(g[0]!.isSeries, true);
  eq(g[0]!.title, "Solo Leveling");
  eq(g[0]!.total, 2);
  eq(g[0]!.volumes.map((v) => v.id), ["v1", "v2"]);
});

test("volumes sort numerically, not lexically", () => {
  const g = buildLibraryGroups([
    book({ id: "a", title: "Saga Vol. 10" }),
    book({ id: "b", title: "Saga Vol. 2" }),
  ]);
  // Lexical order would put Vol. 10 first.
  eq(g[0]!.volumes.map((v) => v.seriesNumber), ["2", "10"]);
});

test("different series stay separate", () => {
  const g = buildLibraryGroups([
    book({ id: "a", title: "Berserk Vol. 1" }),
    book({ id: "b", title: "Naruto Vol. 1" }),
  ]);
  eq(g.length, 2);
});

test("series key is case-insensitive", () => {
  const g = buildLibraryGroups([
    book({ id: "a", title: "Berserk Vol. 1" }),
    book({ id: "b", title: "BERSERK Vol. 2" }),
  ]);
  eq(g.length, 1);
  eq(g[0]!.total, 2);
});

test("progress counts across the whole series", () => {
  const g = buildLibraryGroups([
    book({ id: "a", title: "Saga Vol. 1", status: "completed" }),
    book({ id: "b", title: "Saga Vol. 2", status: "reading", progress: { percent: 40, lastReadTime: 1 } }),
    book({ id: "c", title: "Saga Vol. 3" }),
  ]);
  eq(
    { completed: g[0]!.completed, reading: g[0]!.reading, toRead: g[0]!.toRead },
    { completed: 1, reading: 1, toRead: 1 }
  );
  eq(g[0]!.furthestCompletedNumber, 1);
  eq(g[0]!.highestNumber, 3);
});

test("explicit series fields beat the title", () => {
  const g = buildLibraryGroups([
    book({ id: "a", title: "Odd Name Vol. 1", series: "Correct Series", seriesNumber: "1" }),
    book({ id: "b", title: "Other Vol. 1", series: "correct series", seriesNumber: "2" }),
  ]);
  eq(g.length, 1);
  eq(g[0]!.total, 2);
});

test("a manga kind entry counts as a series", () => {
  const g = buildLibraryGroups([book({ id: "a", title: "Solo Leveling", kind: "manga" })]);
  eq(g[0]!.isSeries, true);
});

test("findGroupForBook resolves a volume to its series", () => {
  const g = buildLibraryGroups([
    book({ id: "v1", title: "Naruto Vol. 1" }),
    book({ id: "v2", title: "Naruto Vol. 2" }),
  ]);
  eq(findGroupForBook(g, "v2")?.title, "Naruto");
});

test("findGroupForBook returns null for an unknown id", () => {
  eq(findGroupForBook(buildLibraryGroups([book({ id: "a" })]), "zzz"), null);
});

test("an unnumbered title joins the series as volume 1", () => {
  // "Saga" and "Saga Vol. 1" are the same series; the bare title is vol 1
  // and therefore sorts first, not last.
  const g = buildLibraryGroups([
    book({ id: "a", title: "Saga" }),
    book({ id: "b", title: "Saga Vol. 1" }),
  ]);
  eq(g.length, 1);
  eq(g[0]!.total, 2);
  eq(g[0]!.volumes.map((v) => v.id), ["a", "b"]);
});

test("a bare title does not absorb a volume that names a different series", () => {
  const g = buildLibraryGroups([
    book({ id: "a", title: "Dune" }),
    book({ id: "b", title: "Dune Messiah" }),
  ]);
  // "Dune Messiah" has no volume marker, so it is its own book. Only a
  // title that is exactly the series name may claim a numbered sibling.
  eq(g.length, 2);
});

test("a bare title with no siblings stays standalone", () => {
  const g = buildLibraryGroups([book({ id: "a", title: "Dune" })]);
  eq(g.length, 1);
  eq(g[0]!.isSeries, false);
});

test("parseSeriesNumber treats missing as last", () => {
  eq(parseSeriesNumber(undefined) === Number.POSITIVE_INFINITY, true);
});

console.log(`\n${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
