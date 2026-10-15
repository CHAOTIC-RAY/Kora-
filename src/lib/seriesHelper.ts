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
  const parsed = parseSeriesFromTitle(book.title || "");
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
