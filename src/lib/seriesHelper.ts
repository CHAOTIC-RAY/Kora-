/**
 * Book series detection, ordering, and progress across the library.
 */

import type { BookMetadata } from "./firebase";

export interface ParsedSeries {
  series: string;
  seriesNumber: string;
  /** Title with series suffix stripped when confidently detected */
  cleanedTitle?: string;
}

function romanToInt(s: string): number | null {
  const map: Record<string, number> = {
    i: 1, ii: 2, iii: 3, iv: 4, v: 5, vi: 6, vii: 7, viii: 8, ix: 9, x: 10,
  };
  return map[s.toLowerCase()] ?? null;
}

/**
 * Comma-safe helpers for volume-style numbering.
 *
 * A comic volume is "Vol. 12", "V12", "Volume Twelve" or "Chapter 41" and a
 * book is "Book 3". They are numbered differently but occupy the same slot
 * in a library, so one shared sort must handle both.
 */

/** Strip leading zeros so "Vol. 07" and "Vol. 7" are the same volume. */
function num(raw: string): number | null {
  const n = Number(raw.replace(/^0+(?=\d)/, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Split a title into a series name and a volume label.
 *
 * Deliberately conservative: a wrong guess merges two unrelated books into
 * one detail page, which is far more disruptive than a missed grouping.
 */
export function parseVolumeFromTitle(title: string): ParsedSeries | null {
  const t = (title || "").trim();
  if (!t) return null;

  // "Name Vol. 12" / "Name v12" / "Name Volume 12" / "Name ch. 41"
  let m = t.match(
    /^(.+?)\s*[,:\-–—]?\s*\b(?:vol(?:ume)?\.?|v|ch(?:apter)?\.?|#)\s*(\d+(?:\.\d+)?)\s*$/i
  );
  if (m) {
    const n = num(m[2]!);
    if (n !== null) return { series: m[1]!.trim(), seriesNumber: String(n) };
  }

  // "Name (Vol. 12)" / "Name (Chapter 41)"
  m = t.match(/^(.+?)\s*[\(\[]\s*(?:vol(?:ume)?\.?|v|ch(?:apter)?\.?|#)?\s*(\d+(?:\.\d+)?)\s*[\)\]]\s*$/i);
  if (m) {
    const n = num(m[2]!);
    // Guard: "Solo Leveling (2018)" must not become series "Solo Leveling"
    // volume 2018, so only accept when the name carries a volume word.
    if (n !== null && /\b(?:vol|volume|ch|chapter|#|book|part)\b/i.test(m[0])) {
      return { series: m[1]!.trim(), seriesNumber: String(n) };
    }
  }

  // "Name, Book 3" / "Name, Part 2"
  m = t.match(/^(.+?),\s*(?:book|vol\.?|volume|part|pt\.?)\s*(\d+(?:\.\d+)?)\s*$/i);
  if (m) {
    const n = num(m[2]!);
    if (n !== null) return { series: m[1]!.trim(), seriesNumber: String(n) };
  }

  return null;
}

/**
 * A book that represents a series in its own right — one entry that owns
 * many volumes, rather than many separate files.
 */
export function isSeriesEntry(book: BookMetadata): boolean {
  return book.kind === "manga" || book.kind === "comic";
}

/** Pull series name + number from a free-form title when fields are empty. */
export function parseSeriesFromTitle(title: string): ParsedSeries | null {
  const t = (title || "").trim();
  if (!t) return null;

  // Pattern: Series Name #N: Rest
  let m = t.match(/^(.+?)\s*(?:#|book\s+)(\d+(?:\.\d+)?)\s*[:\-–—]\s*(.+)$/i);
  if (m) {
    return { series: m[1]!.trim(), seriesNumber: m[2]!, cleanedTitle: m[3]!.trim() };
  }

  // (Series #N) suffix
  m = t.match(/^(.+?)\s*[(\[]\s*(.+?)\s*(?:#|book\s*|vol\.?\s*|volume\s*)(\d+(?:\.\d+)?)\s*[)\]]\s*$/i);
  if (m) {
    return { series: m[2]!.trim(), seriesNumber: m[3]!, cleanedTitle: m[1]!.trim() };
  }

  // ", Book N"
  m = t.match(/^(.+?),\s*(?:book|vol\.?|volume|part)\s+(\d+(?:\.\d+)?)\s*$/i);
  if (m) {
    return { series: m[1]!.trim(), seriesNumber: m[2]!, cleanedTitle: m[1]!.trim() };
  }

  // "Book N" at end — series unknown, number only
  m = t.match(/^(.+?)\s+book\s+(\d+(?:\.\d+)?)\s*$/i);
  if (m) {
    return { series: m[1]!.trim(), seriesNumber: m[2]! };
  }

  // Roman numerals at end: "Title III"
  m = t.match(/^(.+?)\s+(I{1,3}|IV|VI{0,3}|IX|X)\s*$/i);
  if (m) {
    const n = romanToInt(m[2]!);
    if (n) return { series: m[1]!.trim(), seriesNumber: String(n), cleanedTitle: m[1]!.trim() };
  }

  return null;
}

export function normalizeSeriesKey(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/^(the|a|an)\s+/i, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function parseSeriesNumber(raw: string | undefined | null): number {
  if (!raw) return Number.POSITIVE_INFINITY;
  const n = parseFloat(String(raw).replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : Number.POSITIVE_INFINITY;
}

/** Ensure book has series fields when title encodes them. */
export function ensureSeriesFields(book: BookMetadata): BookMetadata {
  if (book.series?.trim() && book.seriesNumber?.trim()) return book;
  // Try the volume grammar first: comics and manga title themselves
  // "Series Vol. 4", which the book-only patterns below would not match.
  const parsed = parseVolumeFromTitle(book.title || "") ?? parseSeriesFromTitle(book.title || "");
  if (!parsed) return book;
  return {
    ...book,
    series: book.series?.trim() || parsed.series,
    seriesNumber: book.seriesNumber?.trim() || parsed.seriesNumber,
  };
}

export function booksInSeries(
  library: BookMetadata[],
  seriesName: string,
  excludeId?: string
): BookMetadata[] {
  const key = normalizeSeriesKey(seriesName);
  if (!key) return [];
  return library
    .map(ensureSeriesFields)
    .filter((b) => normalizeSeriesKey(b.series || "") === key)
    .filter((b) => (excludeId ? b.id !== excludeId : true))
    .sort((a, b) => {
      const na = parseSeriesNumber(a.seriesNumber);
      const nb = parseSeriesNumber(b.seriesNumber);
      if (na !== nb) return na - nb;
      return (a.title || "").localeCompare(b.title || "");
    });
}

export function orderedSeriesBooks(
  library: BookMetadata[],
  seriesName: string
): BookMetadata[] {
  const key = normalizeSeriesKey(seriesName);
  if (!key) return [];
  return library
    .map(ensureSeriesFields)
    .filter((b) => normalizeSeriesKey(b.series || "") === key)
    .sort((a, b) => {
      const na = parseSeriesNumber(a.seriesNumber);
      const nb = parseSeriesNumber(b.seriesNumber);
      if (na !== nb) return na - nb;
      return (a.title || "").localeCompare(b.title || "");
    });
}

export interface SeriesProgress {
  series: string;
  total: number;
  completed: number;
  reading: number;
  toRead: number;
  /** 0–1 fraction of series completed (by count) */
  fraction: number;
  ordered: BookMetadata[];
  /** Highest series number the user has completed, or 0 */
  furthestCompletedNumber: number;
}

export function getSeriesProgress(
  library: BookMetadata[],
  seriesName: string
): SeriesProgress | null {
  const ordered = orderedSeriesBooks(library, seriesName);
  if (!ordered.length) return null;
  let completed = 0;
  let reading = 0;
  let toRead = 0;
  let furthestCompletedNumber = 0;
  for (const b of ordered) {
    if (b.status === "completed") {
      completed++;
      const n = parseSeriesNumber(b.seriesNumber);
      if (Number.isFinite(n) && n > furthestCompletedNumber) furthestCompletedNumber = n;
    } else if (b.status === "reading" || (b.progress?.percent || 0) > 0) {
      reading++;
    } else {
      toRead++;
    }
  }
  return {
    series: ordered[0]?.series || seriesName,
    total: ordered.length,
    completed,
    reading,
    toRead,
    fraction: ordered.length ? completed / ordered.length : 0,
    ordered,
    furthestCompletedNumber,
  };
}

/** Scan library and fill missing series fields from titles (in-memory only). */
export function detectSeriesAcrossLibrary(library: BookMetadata[]): BookMetadata[] {
  return library.map(ensureSeriesFields);
}

/**
 * A library row: either a single book, or a series that owns many volumes.
 *
 * Mihon keeps a Series as a first-class row and hangs chapters off it, so
 * the library shows "Solo Leveling" once rather than once per volume. This
 * is that same shape, derived from what is already in `BookMetadata` rather
 * than a second store, so existing libraries group with no migration.
 */
export interface LibraryGroup {
  /** Stable key: the series name, or the book id for a standalone book. */
  key: string;
  title: string;
  /** True when this row stands for more than one volume. */
  isSeries: boolean;
  /** The representative book — the first volume, or the book itself. */
  representative: BookMetadata;
  /** All volumes, ordered. Equals [representative] for a standalone book. */
  volumes: BookMetadata[];
  total: number;
  completed: number;
  reading: number;
  toRead: number;
  /** 0–1 across the whole series, by count of completed volumes. */
  fraction: number;
  /** Furthest completed volume number, for "continue" style shortcuts. */
  furthestCompletedNumber: number;
  /** Highest volume number present, so the UI can show "3 of 12". */
  highestNumber: number;
}

/**
 * The owning source/plugin for a book, as a grouping scope.
 *
 * Two different plugins can both publish a "Volume 1" of the same name, and
 * merging those hides real books, so the source is part of the group key
 * whenever the entry records one. `source` is where Kora stores the owning
 * source name for entries saved out of a source plugin.
 */
function sourceScope(book: BookMetadata): string {
  return normalizeSeriesKey(book.source || "");
}

/**
 * Collapse the library into one row per series.
 *
 * A series only groups when there is genuinely more than one volume —
 * grouping every book under a shared word would hide real books.
 */
export function buildLibraryGroups(library: BookMetadata[]): LibraryGroup[] {
  const enriched = library.map(ensureSeriesFields);
  const buckets = new Map<string, BookMetadata[]>();

  for (const raw of enriched) {
    // A volume-less title like "Saga" sits alongside "Saga Vol. 1" but
    // carries no series field of its own, so it would be filed as its own
    // book. If the series has numbered siblings, this title is volume 1.
    let book = raw;
    if (!raw.series?.trim()) {
      const selfKey = normalizeSeriesKey(raw.title);
      const claimed = enriched.filter(
        (b) =>
          b.id !== raw.id &&
          // A book with no series of its own must not match: an empty
          // key would otherwise let every ungrouped book claim every
          // other, collapsing the whole library into one series.
          !!b.series?.trim() &&
          normalizeSeriesKey(b.series) === selfKey
      );
      if (claimed.length) {
        book = { ...raw, series: raw.title, seriesNumber: raw.seriesNumber || "1" };
      }
    }

    const seriesName = (book.series || "").trim();
    // A single volume of a series still presents as that series, so the key
    // is the series name even when only one volume is present.
    const key = seriesName ? `s:${normalizeSeriesKey(seriesName)}` : `b:${book.id}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key)!.push(book);
  }

  // Two plugins can both own a "Volume 1" of the same name. Merging those
  // hides real books, so a name bucket that carries more than one distinct
  // source is split by source first. A bucket where every book agrees on the
  // source — or where some books carry none — stays whole, because splitting
  // a real series apart is worse than the rare duplicate name.
  const scopedBuckets = new Map<string, BookMetadata[]>();
  for (const [key, books] of buckets) {
    const distinctSources = new Set(books.map(sourceScope).filter(Boolean));
    if (!key.startsWith("s:") || distinctSources.size <= 1) {
      scopedBuckets.set(key, books);
      continue;
    }
    const bySource = new Map<string, BookMetadata[]>();
    for (const b of books) {
      const scope = sourceScope(b);
      if (!bySource.has(scope)) bySource.set(scope, []);
      bySource.get(scope)!.push(b);
    }
    for (const [scope, scoped] of bySource) {
      scopedBuckets.set(`${key}|${scope}`, scoped);
    }
  }

  const groups: LibraryGroup[] = [];
  for (const [key, books] of scopedBuckets) {
    const volumes = [...books].sort((a, b) => {
      const na = parseSeriesNumber(a.seriesNumber);
      const nb = parseSeriesNumber(b.seriesNumber);
      if (na !== nb) return na - nb;
      return (a.title || "").localeCompare(b.title || "");
    });

    let completed = 0;
    let reading = 0;
    let toRead = 0;
    let furthestCompletedNumber = 0;
    let highestNumber = 0;
    for (const v of volumes) {
      const n = parseSeriesNumber(v.seriesNumber);
      if (Number.isFinite(n) && n > highestNumber) highestNumber = n;
      if (v.status === "completed") {
        completed++;
        if (Number.isFinite(n) && n > furthestCompletedNumber) furthestCompletedNumber = n;
      } else if (v.status === "reading" || (v.progress?.percent || 0) > 0) {
        reading++;
      } else {
        toRead++;
      }
    }

    const representative = volumes[0]!;
    groups.push({
      key,
      title: (representative.series || representative.title || "").trim(),
      isSeries: volumes.length > 1 || isSeriesEntry(representative),
      representative,
      volumes,
      total: volumes.length,
      completed,
      reading,
      toRead,
      fraction: volumes.length ? completed / volumes.length : 0,
      furthestCompletedNumber,
      highestNumber,
    });
  }

  return groups;
}

/** Find the group a book belongs to, for opening it from anywhere. */
export function findGroupForBook(
  groups: LibraryGroup[],
  bookId: string
): LibraryGroup | null {
  return groups.find((g) => g.volumes.some((v) => v.id === bookId)) ?? null;
}
