/**
 * Library grid tile construction.
 *
 * The library grid used to render one tile per saved entry, which turns a
 * thirty-volume manga into thirty near-identical covers. This collapses those
 * into a single series tile (cover + name + "30 VOLS" badge) that opens the
 * series detail screen already used elsewhere in the app.
 *
 * Grouping itself lives in seriesHelper — this module only decides which
 * groups become tiles and how those tiles sort next to the plain book tiles.
 * A group only becomes a tile when it really owns more than one entry;
 * everything else stays a plain book tile exactly as it was.
 */
import type { BookMetadata } from "./firebase";
import { buildLibraryGroups, type LibraryGroup } from "./seriesHelper";

/** localStorage key for the grouped/every-volume toggle. */
export const LIBRARY_GROUPING_STORAGE_KEY = "kora_library_group_by_series";

export type LibraryTile =
  /** A standalone entry — never part of a multi-volume group. */
  | { kind: "book"; key: string; book: BookMetadata }
  /** Two or more volumes of one series, collapsed into one tile. */
  | { kind: "series"; key: string; group: LibraryGroup };

/**
 * Reading the user's grouping preference. Defaults to grouped: a shelf of
 * thirty near-identical volumes is the worse failure, and the toggle is
 * always visible to undo it.
 */
export function readGroupingPreference(storage?: Pick<Storage, "getItem">): boolean {
  try {
    const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
    const raw = store?.getItem(LIBRARY_GROUPING_STORAGE_KEY);
    return raw === null || raw === undefined ? true : raw === "1";
  } catch {
    return true;
  }
}

export function writeGroupingPreference(
  grouped: boolean,
  storage?: Pick<Storage, "setItem">
): void {
  try {
    const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : undefined);
    store?.setItem(LIBRARY_GROUPING_STORAGE_KEY, grouped ? "1" : "0");
  } catch {
    /* private mode / quota — the toggle still works for this session */
  }
}

/**
 * Turn a filtered book list into render tiles.
 *
 * With `grouped` false every book gets its own tile, so the grid is exactly
 * what it was before grouping existed.
 */
export function buildLibraryTiles(
  books: BookMetadata[],
  grouped: boolean
): LibraryTile[] {
  if (!grouped) {
    return books.map((book) => ({ kind: "book" as const, key: `b:${book.id}`, book }));
  }

  const groups = buildLibraryGroups(books);
  const tiles: LibraryTile[] = [];
  const consumed = new Set<string>();

  for (const group of groups) {
    // One volume is not a series on screen — it stays a plain tile so a lone
    // "Solo Leveling Vol. 1" keeps its own cover, menu and download button.
    if (group.total < 2) continue;
    for (const volume of group.volumes) consumed.add(volume.id);
    tiles.push({ kind: "series", key: `s:${group.key}`, group });
  }

  for (const book of books) {
    if (consumed.has(book.id)) continue;
    tiles.push({ kind: "book", key: `b:${book.id}`, book });
  }

  return tiles;
}

/** Sort key per option, so a series lands where its books would have. */
function sortValue(tile: LibraryTile, sortBy: string): number {
  const volumes =
    tile.kind === "series" ? tile.group.volumes : [tile.book];
  switch (sortBy) {
    case "progress":
      // The furthest-read volume decides, matching what a user expects to
      // see first when sorting a shelf by progress.
      return Math.max(...volumes.map((v) => v.progress?.percent ?? 0));
    case "rating":
      return Math.max(...volumes.map((v) => v.rating ?? 0));
    case "dateAdded":
      // Newest volume wins, so saving a new volume floats the series up.
      return Math.max(...volumes.map((v) => v.dateAdded ?? 0));
    default:
      return 0;
  }
}

/**
 * Sort tiles with the same options the book grid already offers, so grouped
 * and ungrouped shelves read identically. Title sorts on the displayed name
 * (series name for a group, book title otherwise).
 */
export function sortLibraryTiles(
  tiles: LibraryTile[],
  sortBy: string
): LibraryTile[] {
  const name = (t: LibraryTile) =>
    t.kind === "series" ? t.group.title || "" : t.book.title || "";

  return [...tiles].sort((a, b) => {
    if (sortBy === "title") return name(a).localeCompare(name(b));
    return sortValue(b, sortBy) - sortValue(a, sortBy);
  });
}
