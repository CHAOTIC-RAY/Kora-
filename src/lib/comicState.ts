/**
 * Comic reading state: position + bookmarks, on device and in the cloud.
 *
 * What syncs and what does not is a hard boundary in this codebase:
 *
 *   - THIS module (position, bookmarks) syncs. It is the user's data and
 *     belongs on every device they sign in on.
 *   - `readerSettings` does not sync. It is a property of the screen.
 *
 * `readerSettings` must never be imported here; a test asserts it.
 *
 * Sync shape. Firestore path is `users/{uid}/comicState/{key}`, which the
 * existing rules already permit (`match /users/{userId}/{document=**}` allows
 * read+write to the owner), so this needs no rules change.
 *
 * Conflict resolution is last-write-wins on `updatedAt`. That is enough here
 * and deliberately simple: a reader has one place they can be, and two
 * devices opened on the same chapter are almost always advancing the same
 * way. A CRDT would buy correctness for a case that does not occur and cost
 * a merge layer nobody asked for.
 *
 * Offline-first. The local write is synchronous and always happens; the cloud
 * write is debounced and best-effort. A reader on a plane must be able to
 * turn pages and keep their place, and coming back online must eventually
 * push what it accumulated rather than losing it.
 */

const STORAGE_KEY = "kora_comic_state";
const SCHEMA_VERSION = 1;

/** Debounce for the cloud write. Long enough to coalesce a page-turn storm. */
export const CLOUD_DEBOUNCE_MS = 4000;

/** One chapter's reading state. */
export interface ChapterState {
  /** Displayed page (1-based) the reader stopped on. */
  pageNumber: number;
  totalPages: number;
  chapterIndex: number;
  /** Epoch ms of the last local change — the conflict-resolution clock. */
  updatedAt: number;
  /** Pages the user bookmarked, 1-based, ascending. */
  bookmarks: number[];
  /** Marked finished by the user rather than inferred from progress. */
  completed?: boolean;
}

export type ComicStateMap = Record<string, ChapterState>;

function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const probe = `${STORAGE_KEY}__probe`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));

/** Coerce one record, or return null if it is not usable. Exported so the
 *  validation contract can be tested directly — every untrusted value into
 *  this store (storage, cloud records) passes through it. */
export function sanitizeChapterState(input: unknown): ChapterState | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;

  const page = Number(raw.pageNumber);
  if (!Number.isFinite(page) || page < 1) return null;

  const total = Number(raw.totalPages);
  const bookmarksRaw = Array.isArray(raw.bookmarks) ? raw.bookmarks : [];
  const bookmarks = Array.isArray(bookmarksRaw)
    ? [
        // Round BEFORE deduping. Deduping first lets 4.6 and 5 collapse onto
        // each other after rounding, silently dropping a bookmark the user
        // actually set — and page numbers arriving from a cloud record or an
        // older build are exactly where fractional values turn up.
        ...new Set(
          bookmarksRaw
            .map((n) => Number(n))
            .filter((n) => Number.isFinite(n) && n >= 1)
            .map((n) => Math.round(n))
        ),
      ].sort((a, b) => a - b)
    : [];

  return {
    pageNumber: Math.round(page),
    totalPages: Number.isFinite(total) && total > 0 ? Math.round(total) : page,
    chapterIndex: Number.isFinite(Number(raw.chapterIndex)) ? Math.round(Number(raw.chapterIndex)) : 0,
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : 0,
    bookmarks,
    completed: raw.completed === true ? true : undefined,
  };
}

export function loadLocalState(): ComicStateMap {
  const store = safeStorage();
  if (!store) return {};
  try {
    const parsed = JSON.parse(store.getItem(STORAGE_KEY) || "null");
    if (!parsed || typeof parsed !== "object") return {};
    const record = parsed as { version?: number; state?: unknown };
    if (record.version !== SCHEMA_VERSION) return {};
    const out: ComicStateMap = {};
    for (const [key, value] of Object.entries((record.state || {}) as Record<string, unknown>)) {
      const clean = sanitizeChapterState(value);
      if (clean) out[key] = clean;
    }
    return out;
  } catch {
    return {};
  }
}

function persistLocalState(state: ComicStateMap): void {
  const store = safeStorage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify({ version: SCHEMA_VERSION, state }));
  } catch {
    /* quota — reading must not break because of it */
  }
}

/** Everything known locally, unchanged. */
export function getChapterState(key: string): ChapterState | undefined {
  if (!key) return undefined;
  return loadLocalState()[key];
}

/** Every chapter with recorded state, for a series view. */
export function allChapterState(): ComicStateMap {
  return loadLocalState();
}

/**
 * Merge two records for the same chapter, newest wins.
 *
 * Exported because it is the only interesting decision in this module and it
 * is the one that has to be right when two devices meet. Bookmarks UNION
 * rather than replace: a bookmark is a fact about a page, not a mutable
 * setting, so losing one because another device had an older copy is
 * strictly worse than keeping one the user has since deleted. Progress, by
 * contrast, is positional, so the newer record simply wins.
 */
export function mergeChapterState(a: ChapterState, b: ChapterState): ChapterState {
  if (!a) return b;
  if (!b) return a;
  const newer = b.updatedAt >= a.updatedAt ? b : a;
  const older = newer === b ? a : b;
  return {
    ...newer,
    bookmarks: [...new Set([...a.bookmarks, ...b.bookmarks])].sort((x, y) => x - y),
    completed: newer.completed === true ? true : older.completed === true ? true : undefined,
  };
}

/** Merge a whole map — used when the cloud copy arrives. */
export function mergeStateMaps(local: ComicStateMap, remote: ComicStateMap): ComicStateMap {
  const out: ComicStateMap = { ...local };
  for (const [key, value] of Object.entries(remote)) {
    const clean = sanitizeChapterState(value);
    if (!clean) continue;
    out[key] = out[key] ? mergeChapterState(out[key], clean) : clean;
  }
  return out;
}

/**
 * Write one chapter's state locally, immediately.
 *
 * Always synchronous and never fails: this is the write that has to survive
 * a dropped connection, a killed tab, or a full quota. The cloud push is a
 * separate, debounced concern.
 */
export function setChapterState(
  key: string,
  patch: Partial<Omit<ChapterState, "updatedAt">>,
  now: number = Date.now()
): ChapterState | null {
  if (!key) return null;
  const all = loadLocalState();
  const existing = all[key];
  const base: ChapterState = existing ?? {
    pageNumber: 1,
    totalPages: 1,
    chapterIndex: 0,
    updatedAt: 0,
    bookmarks: [],
  };

  const next = sanitizeChapterState({
    ...base,
    ...patch,
    pageNumber: patch.pageNumber ?? base.pageNumber,
    totalPages: patch.totalPages ?? base.totalPages,
    bookmarks: patch.bookmarks ?? base.bookmarks,
    updatedAt: now,
  });
  if (!next) return null;

  all[key] = next;
  persistLocalState(all);
  return next;
}

/** Toggle a page bookmark. Returns the new state, or null if unknown key. */
export function toggleBookmark(
  key: string,
  page: number,
  now: number = Date.now()
): ChapterState | null {
  const all = loadLocalState();
  const existing = all[key];
  if (!existing) return null;
  const p = Math.round(Number(page));
  if (!Number.isFinite(p) || p < 1) return null;

  const has = existing.bookmarks.includes(p);
  const bookmarks = has
    ? existing.bookmarks.filter((n) => n !== p)
    : [...existing.bookmarks, p].sort((a, b) => a - b);

  return setChapterState(key, { bookmarks }, now);
}

export function isBookmarked(state: ChapterState | undefined, page: number): boolean {
  if (!state) return false;
  return state.bookmarks.includes(Math.round(page));
}

/** Drop one chapter's state, or everything when no key is given. */
export function clearChapterState(key?: string): void {
  if (!key) {
    persistLocalState({});
    return;
  }
  const all = loadLocalState();
  delete all[key];
  persistLocalState(all);
}

/**
 * Firestore document id for one chapter.
 *
 * The raw key is `pluginId:chapterUrl`, and a chapter URL is a full URL —
 * full of slashes and colons that Firestore rejects in a document id. The
 * map key is preserved separately so the two halves can be recomputed and
 * matched without re-encoding on every read.
 */
export function firestoreDocId(key: string): string {
  let hash = 5381;
  for (let i = 0; i < key.length; i++) {
    hash = ((hash << 5) + hash + key.charCodeAt(i)) | 0;
  }
  const slug = key
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(-48);
  return `${slug || "chapter"}-${(hash >>> 0).toString(36)}`;
}

/**
 * Convert a local record to the cloud shape.
 *
 * `key` is carried in the document so a round-trip can rebuild the map key
 * without depending on the hash being reversible.
 */
export function toCloudRecord(key: string, state: ChapterState) {
  return {
    key,
    pageNumber: state.pageNumber,
    totalPages: state.totalPages,
    chapterIndex: state.chapterIndex,
    updatedAt: state.updatedAt,
    bookmarks: state.bookmarks,
    ...(state.completed ? { completed: true } : {}),
  };
}

export function fromCloudRecord(record: unknown): { key: string; state: ChapterState } | null {
  if (!record || typeof record !== "object") return null;
  const raw = record as Record<string, unknown>;
  const key = typeof raw.key === "string" ? raw.key : "";
  if (!key) return null;
  const state = sanitizeChapterState(raw);
  return state ? { key, state } : null;
}

/** Cap how many chapters one device keeps locally, oldest first. */
export const MAX_LOCAL_CHAPTERS = 400;

export function pruneLocalState(state: ComicStateMap): ComicStateMap {
  const entries = Object.entries(state);
  if (entries.length <= MAX_LOCAL_CHAPTERS) return state;
  entries.sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  const kept = entries.slice(entries.length - MAX_LOCAL_CHAPTERS);
  return Object.fromEntries(kept);
}

export { SCHEMA_VERSION as COMIC_STATE_SCHEMA_VERSION, clamp as _clamp };
export const STORAGE_KEY_FOR_TEST = STORAGE_KEY;
export const CLOUD_DEBOUNCE_MS_FOR_TEST = CLOUD_DEBOUNCE_MS;
