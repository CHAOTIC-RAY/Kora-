/**
 * Regression tests for defects found in review.
 *
 * Every test here corresponds to a bug that was empirically reproduced before
 * the fix. Each names the failure it prevents, and each asserts an OBSERVABLE
 * outcome — a merged record, a byte on disk, a released lock — rather than
 * re-stating a constant declared nearby (which is what the earlier
 * "must not import" assertions did, and which cannot fail).
 */
import {
  mergeChapterState,
  mergeStateMaps,
  setChapterState,
  toggleBookmark,
  isBookmarked,
  getChapterState,
  clearChapterState,
  loadLocalState,
  toCloudRecord,
  fromCloudRecord,
  MAX_LOCAL_CHAPTERS,
  type ChapterState,
} from "../comicState";
import { createSleepTimer, brightnessSupport } from "../nativeScreen";
import { updateSettings, saveSettings, loadSettings, DEFAULT_SETTINGS } from "../readerSettings";

let passed = 0;
let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) passed++;
  else {
    failed++;
    console.log(`FAIL  ${name}\n        expected ${expected}, got ${actual}`);
  }
}

/** A storage whose quota can be made to fail on demand. */
class MemStorage {
  m = new Map<string, string>();
  failWrites = false;
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) {
    if (this.failWrites) { const e = new Error("QuotaExceededError"); e.name = "QuotaExceededError"; throw e; }
    this.m.set(k, String(v));
  }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
const mem = new MemStorage();
Object.defineProperty(globalThis, "localStorage", { configurable: true, writable: true, value: mem });

const KEY = "plug:https://site/s/ch1";

// ── #1: opening a chapter on device B must not drag device A backwards ──────
{
  const onDeviceA: ChapterState = { pageNumber: 40, totalPages: 40, chapterIndex: 0, updatedAt: 1000, bookmarks: [7] };
  // Device B merely OPENS the chapter: page 1, but written later.
  const justOpened: ChapterState = { pageNumber: 1, totalPages: 40, chapterIndex: 0, updatedAt: 2000, bookmarks: [] };
  const merged = mergeChapterState(onDeviceA, justOpened);
  check("#1 opening a chapter cannot rewind progress", merged.pageNumber, 40);

  // Order must not matter.
  check("#1 merge is order-independent", mergeChapterState(justOpened, onDeviceA).pageNumber, 40);
}

// ── #2: a removed bookmark must stay removed across a merge ─────────────────
{
  const marked: ChapterState = { pageNumber: 5, totalPages: 20, chapterIndex: 0, updatedAt: 1000, bookmarks: [9, 12] };
  const removed: ChapterState = { pageNumber: 5, totalPages: 20, chapterIndex: 0, updatedAt: 5000, bookmarks: [12], removedBookmarks: [9] };
  const merged = mergeChapterState(marked, removed);
  check("#2 removal survives the merge", merged.bookmarks.includes(9), false);
  check("#2 untouched bookmark survives", merged.bookmarks.includes(12), true);

  // …and the reverse order gives the same answer.
  check("#2 removal survives either order", mergeChapterState(removed, marked).bookmarks.includes(9), false);

  // Re-adding AFTER a removal is the user changing their mind: the mark wins.
  const readded: ChapterState = { ...removed, updatedAt: 9000, bookmarks: [9, 12], removedBookmarks: [9] };
  check("#2 re-adding after removal wins", mergeChapterState(removed, readded).bookmarks.includes(9), true);

  // Re-adding BEFORE the removal does not resurrect it.
  const readdedEarly: ChapterState = { ...removed, updatedAt: 2000, bookmarks: [9, 12], removedBookmarks: [] };
  check("#2 re-add before removal does not win", mergeChapterState(removed, readdedEarly).bookmarks.includes(9), false);
}

// ── #3: a chapter must be markable unread again ────────────────────────────
{
  const read: ChapterState = { pageNumber: 40, totalPages: 40, chapterIndex: 0, updatedAt: 1000, bookmarks: [], completed: true };
  const markedUnread: ChapterState = { pageNumber: 40, totalPages: 40, chapterIndex: 0, updatedAt: 5000, bookmarks: [], completed: undefined };
  check("#3 completed can be unset", mergeChapterState(read, markedUnread).completed, undefined);
  check("#3 set stays set", mergeChapterState(markedUnread, read).completed, undefined);
  const stillRead: ChapterState = { ...markedUnread, updatedAt: 9000, completed: true };
  check("#3 and set again", mergeChapterState(markedUnread, stillRead).completed, true);
}

// ── #4: the first bookmark on an unread chapter must stick ──────────────────
{
  clearChapterState();
  const first = toggleBookmark(KEY, 3, 1000, { pageNumber: 1, totalPages: 40 });
  check("#4 first bookmark returns a record", first !== null, true);
  check("#4 first bookmark is stored", isBookmarked(getChapterState(KEY), 3), true);
  // It must survive a reload, not just sit in the cache.
  check("#4 first bookmark survives reload", isBookmarked(loadLocalState()[KEY], 3), true);
}

// ── #5: a failed write must not report success ──────────────────────────────
{
  clearChapterState();
  mem.failWrites = true;
  const result = setChapterState(KEY, { pageNumber: 42, totalPages: 40 }, 1000);
  mem.failWrites = false;
  check("#5 failed write returns null, not a fake success", result, null);
  // And nothing was actually persisted.
  check("#5 nothing reached disk", loadLocalState()[KEY], undefined);
  // Once storage works again, writing succeeds.
  check("#5 write works again after recovery", setChapterState(KEY, { pageNumber: 42, totalPages: 40 }, 2000) !== null, true);
}

// ── #6: the chapter cap is actually enforced on write ───────────────────────
{
  clearChapterState();
  for (let i = 0; i < MAX_LOCAL_CHAPTERS + 25; i++) {
    setChapterState(`chapter-${i}`, { pageNumber: 1, totalPages: 10 }, 1000 + i);
  }
  check("#6 cap enforced by the write path", Object.keys(loadLocalState()).length, MAX_LOCAL_CHAPTERS);
  // The most recent chapters are the ones kept.
  check("#6 newest kept", loadLocalState()[`chapter-${MAX_LOCAL_CHAPTERS + 24}`] !== undefined, true);
  check("#6 oldest dropped", loadLocalState()["chapter-0"], undefined);
  clearChapterState();
}

// ── #7: the brightness probe must not throw with no <body> ─────────────────
{
  const savedDoc = (globalThis as any).document;
  (globalThis as any).document = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  let threw = false;
  try { brightnessSupport(); } catch { threw = true; }
  check("#7 brightnessSupport survives a body-less document", threw, false);
  (globalThis as any).document = savedDoc;
}

// ── #10: a non-finite sleep timer must never be a timer that cannot fire ───
{
  for (const bad of [NaN, Infinity, -Infinity]) {
    const t = createSleepTimer(bad);
    check(`#10 timer(${bad}) is disabled not broken`, t.durationMs, 0);
    check(`#10 timer(${bad}) never expires silently`, t.expired(), false);
    check(`#10 timer(${bad}) remaining is finite`, Number.isFinite(t.remainingMs()), true);
  }
  // A real timer still works.
  check("#10 a real timer has duration", createSleepTimer(5).durationMs, 5 * 60_000);
}

// ── #11: an undefined patch field must not reset a stored preference ───────
{
  saveSettings({ ...DEFAULT_SETTINGS, fitMode: "width" });
  const after = updateSettings({ fitMode: undefined } as any);
  check("#11 undefined patch preserves the preference", after.fitMode, "width");
  check("#11 undefined patch persists", loadSettings().fitMode, "width");
  // An explicit value still applies.
  check("#11 real patch still applies", updateSettings({ fitMode: "height" }).fitMode, "height");
}

// ── Cloud round-trip must carry tombstones ─────────────────────────────────
{
  const withRemoval: ChapterState = {
    pageNumber: 5, totalPages: 20, chapterIndex: 1, updatedAt: 4242,
    bookmarks: [3, 8], removedBookmarks: [9],
  };
  const cloud = toCloudRecord(KEY, withRemoval);
  check("tombstone reaches the cloud record", JSON.stringify(cloud).includes("removedBookmarks"), true);
  const back = fromCloudRecord(cloud)!;
  check("tombstone survives the round-trip", JSON.stringify(back.state.removedBookmarks), "[9]");
  // Merging the round-trip is a no-op — nothing resurrected.
  check("round-trip merge is stable", JSON.stringify(mergeChapterState(withRemoval, back.state).bookmarks), "[3,8]");
}

// ── Map merge inherits the same guarantees ─────────────────────────────────
{
  const local: Record<string, ChapterState> = {
    a: { pageNumber: 30, totalPages: 40, chapterIndex: 0, updatedAt: 1000, bookmarks: [4] },
  };
  const remote: Record<string, ChapterState> = {
    a: { pageNumber: 2, totalPages: 40, chapterIndex: 0, updatedAt: 9000, bookmarks: [], removedBookmarks: [4] },
  };
  const merged = mergeStateMaps(local, remote);
  check("map merge does not rewind", merged.a.pageNumber, 30);
  check("map merge honours the tombstone", JSON.stringify(merged.a.bookmarks), "[]");
}

console.log(`\nregressions: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
