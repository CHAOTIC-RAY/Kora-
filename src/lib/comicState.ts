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
  /**
   * Pages the user explicitly REMOVED a bookmark from.
   *
   * Bookmarks merge by union, and a union cannot express a removal: without a
   * tombstone, un-bookmarking on one device was silently undone by the merge
   * with any other device that still had the mark — verified, the user could
   * never delete a bookmark on a two-device account. A removal therefore has
   * to be recorded as a fact, not as an absence.
   */
  removedBookmarks?: number[];
  /** Marked finished by the user rather than inferred from progress. */
  completed?: boolean;
}

export type ComicStateMap = Record<string, ChapterState>;

/**
 * The storage handle, memoised.
 *
 * The probe is a write+remove on every call, which is what the original did,
 * and it is measurably wrong on the hot path: this module's hot path is a
 * page turn, and a probe write per page turn is a synchronous, main-thread
 * localStorage mutation per page turn for a question (`does storage work?`)
 * whose answer cannot change while the page is alive.
 *
 * Memoising on the IDENTITY of the `localStorage` object — not on a boolean —
 * keeps the failure mode correct: a replaced or re-created storage (tests
 * swapping in a fake, a WebView tearing the origin down and rebuilding it) is
 * a different object, so it gets probed again rather than inheriting a verdict
 * formed against storage that no longer exists.
 */
let probed: Storage | null = null;

function safeStorage(): Storage | null {
  try {
    if (typeof localStorage === "undefined") return null;
    if (probed === localStorage) return probed;
    const probe = `${STORAGE_KEY}__probe`;
    localStorage.setItem(probe, "1");
    localStorage.removeItem(probe);
    probed = localStorage;
    return probed;
  } catch {
    // Do not remember the failure as a verdict about storage we may never see
    // again — but also do not keep a stale success: `probed` is only ever
    // compared by identity, so leaving it is safe either way.
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

  // Clamp to the chapter so a stale mark on a page that no longer exists
  // cannot render as a broken marker, and drop anything already tombstoned.
  const removedRaw = Array.isArray(raw.removedBookmarks) ? raw.removedBookmarks : [];
  const removedBookmarks = [
    ...new Set(
      removedRaw
        .map((n) => Number(n))
        .filter((n) => Number.isFinite(n) && n >= 1)
        .map((n) => Math.round(n))
    ),
  ]
    .filter((n) => !bookmarks.includes(n))
    .sort((a, b) => a - b);

  return {
    pageNumber: Math.round(page),
    totalPages: Number.isFinite(total) && total > 0 ? Math.round(total) : page,
    chapterIndex: Number.isFinite(Number(raw.chapterIndex)) ? Math.round(Number(raw.chapterIndex)) : 0,
    updatedAt: Number.isFinite(Number(raw.updatedAt)) ? Number(raw.updatedAt) : 0,
    bookmarks,
    removedBookmarks,
    completed: raw.completed === true ? true : undefined,
  };
}

/**
 * Parsed-state cache.
 *
 * `setChapterState` used to call `loadLocalState()` on every page turn, and
 * `loadLocalState()` is a full `JSON.parse` plus a `sanitizeChapterState` per
 * chapter. On a long series that is O(chapters) of allocation and validation
 * per page turn — the one operation in this module that must stay cheap,
 * because it runs synchronously in the middle of a swipe.
 *
 * The cache is keyed on the raw serialized string, not on a dirty flag. That
 * distinction is the whole correctness argument: a dirty flag would make this
 * module blind to a write from another tab (or another frame) that happened
 * between two reads, and cross-tab readers are exactly the case this module
 * exists to serve. Reading the raw string is a single cheap `getItem`; the
 * expensive `JSON.parse` only happens when the bytes actually differ, and the
 * identity fast path means the common case — the string this module itself
 * just wrote — is not even a memcmp.
 */
let cachedState: ComicStateMap | null = null;
let cachedJson: string | null = null;

/** Parse + validate the stored payload. Shared by the cold and warm paths. */
function parseState(raw: string | null): ComicStateMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
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

/** The live cache. Internal callers mutate this and then persist. */
function stateForRead(): ComicStateMap {
  const store = safeStorage();
  if (!store) {
    cachedState = {};
    cachedJson = null;
    return cachedState;
  }
  let raw: string | null = null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    cachedState = {};
    cachedJson = null;
    return cachedState;
  }
  if (cachedState && raw === cachedJson) return cachedState;
  cachedState = parseState(raw);
  cachedJson = raw;
  return cachedState;
}

/**
 * The live map for a caller that is about to mutate it.
 *
 * Deliberately not `loadLocalState()`, which returns a defensive deep-ish copy
 * so external callers can never mutate the cache by accident. Internal writers
 * DO want the live object — copying the whole map on every page turn is the
 * cost this cache exists to remove — so they take it through here, where the
 * risk is visible.
 */
function stateForWrite(): ComicStateMap {
  return stateForRead();
}

export function loadLocalState(): ComicStateMap {
  // A snapshot, not the cache itself: this is public API and callers have
  // always been free to mutate what they get back without corrupting storage.
  const live = stateForRead();
  const out: ComicStateMap = {};
  for (const [key, value] of Object.entries(live)) out[key] = { ...value, bookmarks: [...value.bookmarks] };
  return out;
}

/**
 * Persist the map. Returns false when the bytes did NOT reach storage.
 *
 * The return value is load-bearing. `setChapterState` used to return the new
 * state unconditionally, so a full quota produced a truthy "saved" result
 * while nothing reached disk: the UI advanced, the tab closed, and the reader
 * lost their place with no error anywhere. A silent failure here is worse than
 * a thrown one, because nothing above it is looking for one.
 */
function persistLocalState(state: ComicStateMap): boolean {
  // Adopt the caller's map as the cache BEFORE the write, so reads within this
  // session stay consistent with what the caller was just told.
  cachedState = state;
  const store = safeStorage();
  if (!store) {
    cachedJson = null;
    return false;
  }
  let json: string;
  try {
    json = JSON.stringify({ version: SCHEMA_VERSION, state });
  } catch {
    cachedJson = null;
    return false;
  }
  try {
    store.setItem(STORAGE_KEY, json);
    cachedJson = json;
    return true;
  } catch {
    // Quota, or private mode. Poison the raw key so the next read re-parses
    // from storage rather than trusting a cache that a reload will discard.
    cachedJson = null;
    return false;
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
 * Merge two records for the same chapter.
 *
 * Position and bookmarks are merged by DIFFERENT rules, because they mean
 * different things.
 *
 * Bookmarks are facts about pages, so they UNION. Losing one because another
 * device held a stale copy is strictly worse than keeping a stale mark.
 *
 * Position is progress, and progress must never go backwards. A plain
 * last-write-wins is wrong here: opening a chapter on a second device writes
 * page 1 with a fresh timestamp, which would drag a reader who was on page 40
 * back to the start — verified, that was exactly the bug. So the position
 * only advances within a chapter, and a device that merely *opened* the
 * chapter can never undo real reading.
 *
 * `completed` follows the newer record in both directions, so a user can
 * mark a chapter unread again. Sticky-true was wrong: un-marking is a
 * deliberate act and must stick.
 */
export function mergeChapterState(a: ChapterState, b: ChapterState): ChapterState {
  if (!a) return b;
  if (!b) return a;
  const aNewer = b.updatedAt >= a.updatedAt;
  const newer = aNewer ? b : a;
  const older = aNewer ? a : b;

  // Monotonic within a chapter: the furthest page read wins, never the most
  // recently written one.
  const pageNumber = Math.max(a.pageNumber, b.pageNumber);

  // Union first, then subtract the tombstones. Which side's tombstones win is
  // decided by recency: a removal recorded later than the mark that created
  // it is the user's latest intent, and a mark re-added later than a removal
  // is the user changing their mind back.
  const union = new Set([...a.bookmarks, ...b.bookmarks]);
  const removals = [
    ...(a.removedBookmarks || []).map((p) => ({ p, at: a.updatedAt })),
    ...(b.removedBookmarks || []).map((p) => ({ p, at: b.updatedAt })),
  ];
  const marks = [
    ...(a.bookmarks || []).map((p) => ({ p, at: a.updatedAt })),
    ...(b.bookmarks || []).map((p) => ({ p, at: b.updatedAt })),
  ];
  const latestRemoval = new Map<number, number>();
  for (const { p, at } of removals) latestRemoval.set(p, Math.max(latestRemoval.get(p) ?? 0, at));
  for (const { p, at } of marks) {
    const removedAt = latestRemoval.get(p);
    if (removedAt === undefined || at >= removedAt) latestRemoval.delete(p);
  }
  const bookmarks = [...union].filter((p) => !latestRemoval.has(p)).sort((x, y) => x - y);

  return {
    ...newer,
    pageNumber,
    bookmarks,
    removedBookmarks: [...latestRemoval.keys()].sort((x, y) => x - y),
    completed: newer.completed === true ? true : undefined,
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

/** Cap how many chapters one device keeps locally, oldest first. */
export const MAX_LOCAL_CHAPTERS = 400;

export function pruneLocalState(state: ComicStateMap): ComicStateMap {
  const entries = Object.entries(state);
  if (entries.length <= MAX_LOCAL_CHAPTERS) return state;
  entries.sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  const kept = entries.slice(entries.length - MAX_LOCAL_CHAPTERS);
  return Object.fromEntries(kept);
}

/**
 * Write one chapter's state locally, immediately.
 *
 * Synchronous, so it survives a dropped connection or a killed tab. Returns
 * the state that was persisted, or null when nothing reached storage — a
 * caller that trusts a non-null return is correct about what was saved.
 *
 * `seed` creates a record for a chapter that has none yet. Bookmarking a page
 * of a chapter whose progress was never recorded used to bail out and persist
 * nothing at all, so the very first bookmark a user set simply vanished.
 */
export function setChapterState(
  key: string,
  patch: Partial<Omit<ChapterState, "updatedAt">>,
  now: number = Date.now(),
  seed?: { pageNumber?: number; totalPages?: number }
): ChapterState | null {
  if (!key) return null;
  const all = stateForWrite();
  const existing = all[key];
  const base: ChapterState = existing ?? {
    pageNumber: seed?.pageNumber ?? 1,
    totalPages: seed?.totalPages ?? seed?.pageNumber ?? 1,
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
  // Enforce the cap on the way in, not in a helper nothing calls: unbounded
  // growth is what eventually trips the quota failure above.
  return persistLocalState(pruneLocalState(all)) ? next : null;
}

/**
 * Toggle a page bookmark.
 *
 * Creates the record when absent, so a bookmark can be the first thing a user
 * does with a chapter — bookmarking page 3 of a chapter they have not read
 * yet is a legitimate action, not an error.
 */
export function toggleBookmark(
  key: string,
  page: number,
  now: number = Date.now(),
  seed?: { pageNumber?: number; totalPages?: number }
): ChapterState | null {
  const all = stateForWrite();
  const existing = all[key];
  const p = Math.round(Number(page));
  if (!Number.isFinite(p) || p < 1) return null;

  const current = existing?.bookmarks ?? [];
  const removed = existing?.removedBookmarks ?? [];
  const has = current.includes(p);
  // Both directions are recorded as facts, because a union cannot carry a
  // removal and a merge must not resurrect a mark the user deleted.
  const bookmarks = has
    ? current.filter((n) => n !== p)
    : [...current, p].sort((a, b) => a - b);
  const removedBookmarks = has
    ? [...new Set([...removed, p])].sort((a, b) => a - b)
    : removed.filter((n) => n !== p);

  const next = setChapterState(key, { bookmarks, removedBookmarks }, now, seed);
  if (!next) return null;

  // A bookmark removal only exists as an absence, so with no prior record the
  // toggle-off has nothing to remove and there is genuinely nothing to store.
  if (!existing && has) return next;
  return next;
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
    ...(state.removedBookmarks?.length ? { removedBookmarks: state.removedBookmarks } : {}),
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


export { SCHEMA_VERSION as COMIC_STATE_SCHEMA_VERSION, clamp as _clamp };
export const STORAGE_KEY_FOR_TEST = STORAGE_KEY;
export const CLOUD_DEBOUNCE_MS_FOR_TEST = CLOUD_DEBOUNCE_MS;
