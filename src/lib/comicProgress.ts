/**
 * Where the reader was, per chapter, so reopening a series lands on the page
 * you left rather than page 1.
 *
 * `ComicDetailView` already takes a `progress` prop of the shape
 * `{ chapterIndex, pageNumber, totalPages }` keyed by `pluginId:url`, but
 * nothing was passing it, so the resume path was dead code. This is the
 * store that fills it: one localStorage key, the same key shape, no second
 * store to drift from the first.
 *
 * `pageNumber` is the *displayed* page (counted in reading order), not the
 * source array index — that is the only form a human means by "page 7", and
 * in a right-to-left book it is the mirror of the array index. Conversion to
 * an index happens in the reader via `indexForDisplayed`.
 *
 * Writes are best-effort: a full or disabled localStorage must not break
 * reading, so every read and write is guarded and a failed write silently
 * degrades to "no resume" rather than throwing inside a render.
 */

const STORAGE_KEY = "kora_comic_progress";

export interface ComicProgressEntry {
  chapterIndex: number;
  pageNumber: number;
  totalPages: number;
}

export type ComicProgressMap = Record<string, ComicProgressEntry>;

/** Key one chapter's position. Must match `chapterKey` in ComicDetailView. */
export function progressKey(pluginId: string, chapterUrl: string): string {
  return `${pluginId}:${chapterUrl}`;
}

function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    // Private-mode Safari and a locked-down WebView both expose localStorage
    // and then throw on use, so the probe has to be an actual write.
    const probe = `${STORAGE_KEY}__probe`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

/** Every stored position, or an empty map if storage is unusable or corrupt. */
export function loadProgress(): ComicProgressMap {
  const store = safeStorage();
  if (!store) return {};
  try {
    const raw = store.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: ComicProgressMap = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      const e = sanitizeEntry(value);
      if (e) out[key] = e;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Store one chapter's position.
 *
 * Page 0 is dropped rather than written: it is not a real position, and
 * keeping it would make a fully unread chapter render a "page 0/9" badge.
 */
export function saveProgress(key: string, entry: ComicProgressEntry): void {
  if (!key) return;
  const clean = sanitizeEntry(entry);
  const all = loadProgress();
  if (!clean || clean.pageNumber < 1) {
    delete all[key];
  } else {
    all[key] = clean;
  }
  const store = safeStorage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* quota or private mode — reading must not break because of it */
  }
}

/** Forget one chapter, or everything. */
export function clearProgress(key?: string): void {
  const store = safeStorage();
  if (!store) return;
  try {
    if (key) {
      const all = loadProgress();
      delete all[key];
      store.setItem(STORAGE_KEY, JSON.stringify(all));
    } else {
      store.removeItem(STORAGE_KEY);
    }
  } catch {
    /* ignore */
  }
}

/**
 * The page to reopen a chapter at, as a *displayed* page number, or 0 when
 * the chapter was never started.
 *
 * Clamped to the chapter's current length: a source that renumbers or
 * removes pages between visits must not be able to leave the reader past the
 * last page, which is how you get a blank screen with no way back.
 */
export function resumePage(
  progress: ComicProgressMap,
  key: string,
  totalPages: number
): number {
  const entry = progress[key];
  if (!entry || !Number.isFinite(entry.pageNumber) || entry.pageNumber < 1) return 0;
  return Math.min(Math.max(1, Math.round(entry.pageNumber)), Math.max(1, totalPages));
}

function sanitizeEntry(value: unknown): ComicProgressEntry | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Record<string, unknown>;
  const chapterIndex = Number(v.chapterIndex);
  const pageNumber = Number(v.pageNumber);
  const totalPages = Number(v.totalPages);
  if (!Number.isFinite(chapterIndex) || !Number.isFinite(pageNumber) || !Number.isFinite(totalPages)) {
    return null;
  }
  return {
    chapterIndex: Math.max(0, Math.round(chapterIndex)),
    pageNumber: Math.max(0, Math.round(pageNumber)),
    totalPages: Math.max(0, Math.round(totalPages)),
  };
}
