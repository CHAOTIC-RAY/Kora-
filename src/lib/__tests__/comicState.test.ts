/**
 * Comic state tests — the dual-sync decision layer.
 *
 * The load-bearing claim: reading state survives being written twice by two
 * devices that disagree, and never regresses to an older position. Getting
 * merge wrong is how a reader loses their place, and it is invisible until
 * someone opens the app on a second device.
 *
 * Also asserted: reader SETTINGS never leak into this module's records.
 */
import {
  sanitizeChapterState,
  loadLocalState,
  setChapterState,
  toggleBookmark,
  isBookmarked,
  clearChapterState,
  mergeChapterState,
  mergeStateMaps,
  firestoreDocId,
  toCloudRecord,
  fromCloudRecord,
  pruneLocalState,
  MAX_LOCAL_CHAPTERS,
  type ChapterState,
  type ComicStateMap,
} from "../comicState";

let passed = 0;
let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) passed++;
  else {
    failed++;
    console.log(`FAIL  ${name}\n        expected ${expected}, got ${actual}`);
  }
}

class MemStorage {
  private m = new Map<string, string>();
  get length() { return this.m.size; }
  key(i: number) { return [...this.m.keys()][i] ?? null; }
  getItem(k: string) { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string) { this.m.set(k, String(v)); }
  removeItem(k: string) { this.m.delete(k); }
  clear() { this.m.clear(); }
}
(globalThis as any).localStorage = new MemStorage();

const KEY = "mangadex:https://site/series/chapter-1";
const base: ChapterState = {
  pageNumber: 5, totalPages: 40, chapterIndex: 0, updatedAt: 1000, bookmarks: [3],
};

// ── Sanitize ───────────────────────────────────────────────────────────────
check("valid record survives", sanitizeChapterState(base)?.pageNumber, 5);
check("null rejected", sanitizeChapterState(null), null);
check("array rejected", sanitizeChapterState([]), null);
check("page 0 rejected", sanitizeChapterState({ ...base, pageNumber: 0 }), null);
check("negative page rejected", sanitizeChapterState({ ...base, pageNumber: -3 }), null);
check("missing page rejected", sanitizeChapterState({ totalPages: 9 }), null);
check("NaN page rejected", sanitizeChapterState({ ...base, pageNumber: NaN }), null);
check("string page coerced", sanitizeChapterState({ ...base, pageNumber: "7" })?.pageNumber, 7);

const messy = sanitizeChapterState({
  ...base,
  // 4.6 rounds to 5, which the record already contains — so it must collapse
  // onto that 5 rather than appear as a separate page. "x"/NaN/-2 drop out.
  bookmarks: [5, 3, 3, 1, "x", -2, NaN, 4.6],
})!;
check("bookmarks deduped + rounded + sorted", JSON.stringify(messy.bookmarks), "[1,3,5]");
check("fractional page rounds into existing", messy.bookmarks.includes(5), true);
check("no fractional survives", messy.bookmarks.includes(4.6), false);
check("garbage bookmarks dropped", messy.bookmarks.includes(NaN), false);
check("negative bookmarks dropped", messy.bookmarks.includes(-2), false);
// A fractional value that does NOT collide must still be kept, rounded.
const frac = sanitizeChapterState({ ...base, bookmarks: [2.4, 9.7] })!;
check("non-colliding fractions kept rounded", JSON.stringify(frac.bookmarks), "[2,10]");
check("non-array bookmarks tolerated", sanitizeChapterState({ ...base, bookmarks: "nope" })?.bookmarks.length, 0);
check("completed false drops flag", sanitizeChapterState({ ...base, completed: false })?.completed, undefined);

// ── Local persistence ──────────────────────────────────────────────────────
clearChapterState();
check("cleared state is empty", Object.keys(loadLocalState()).length, 0);
const written = setChapterState(KEY, { pageNumber: 7, totalPages: 40, chapterIndex: 2 }, 5000)!;
check("write returns record", written.pageNumber, 7);
check("write stamps updatedAt", written.updatedAt, 5000);
check("write persists", loadLocalState()[KEY]?.pageNumber, 7);

const moved = setChapterState(KEY, { pageNumber: 12 }, 6000)!;
check("partial patch merges", moved.pageNumber, 12);
check("partial patch keeps total", moved.totalPages, 40);
check("partial patch keeps chapterIndex", moved.chapterIndex, 2);

check("unknown key returns undefined", loadLocalState()["nope"], undefined);
check("empty key write refused", setChapterState("", { pageNumber: 2 }), null);

// Page 1 is a real position here (unlike comicProgress's page-0 drop).
setChapterState(KEY, { pageNumber: 1 }, 7000);
check("page 1 is stored", loadLocalState()[KEY]?.pageNumber, 1);

// ── Bookmarks ──────────────────────────────────────────────────────────────
clearChapterState();
setChapterState(KEY, { pageNumber: 5, totalPages: 40 }, 1000);
const marked = toggleBookmark(KEY, 12, 2000)!;
check("bookmark added", marked.bookmarks.includes(12), true);
check("isBookmarked true", isBookmarked(marked, 12), true);
const unmarked = toggleBookmark(KEY, 12, 3000)!;
check("bookmark toggled off", unmarked.bookmarks.includes(12), false);
// An unknown key no longer bails: bookmarking a page of a chapter with no
// recorded state is a legitimate first action, and it used to persist nothing.
// The seed argument supplies the context it needs.
check("toggle on unknown key without seed still creates a record", toggleBookmark("nope", 3) !== null, true);
check("toggle bad page", toggleBookmark(KEY, 0), null);
check("toggle NaN page", toggleBookmark(KEY, NaN), null);
check("isBookmarked on undefined", isBookmarked(undefined, 5), false);
check("isBookmarked false", isBookmarked(marked, 99), false);
const multi = setChapterState(KEY, { bookmarks: [7, 3, 9] }, 4000)!;
check("multi bookmarks stored sorted", JSON.stringify(multi.bookmarks), "[3,7,9]");

// ── Merge: the two-device case ─────────────────────────────────────────────
const older: ChapterState = { pageNumber: 10, totalPages: 40, chapterIndex: 0, updatedAt: 1000, bookmarks: [1, 2] };
const newer: ChapterState = { pageNumber: 20, totalPages: 40, chapterIndex: 0, updatedAt: 9000, bookmarks: [5] };

const m1 = mergeChapterState(older, newer);
check("newer position wins", m1.pageNumber, 20);
check("bookmarks union", JSON.stringify(m1.bookmarks), "[1,2,5]");

const m2 = mergeChapterState(newer, older);
check("merge is order-independent (position)", m2.pageNumber, 20);
check("merge is order-independent (bookmarks)", JSON.stringify(m2.bookmarks), "[1,2,5]");

const equalA: ChapterState = { ...older, updatedAt: 5000, bookmarks: [1] };
const equalB: ChapterState = { ...older, updatedAt: 5000, bookmarks: [2] };
check("equal timestamps merge without loss", JSON.stringify(mergeChapterState(equalA, equalB).bookmarks), "[1,2]");

check("merge with missing local", mergeChapterState(null as any, newer).pageNumber, 20);
check("merge with missing remote", mergeChapterState(older, null as any).pageNumber, 10);

const doneOlder: ChapterState = { ...older, completed: true };
const notDoneNewer: ChapterState = { ...newer, completed: false };
// NOT sticky: un-marking a chapter read is a deliberate act and must stick.
// The old behaviour made `completed` write-once, which is what it was before.
check("completed can be unset by a newer record", mergeChapterState(doneOlder, notDoneNewer).completed, undefined);
// `notDoneNewer` is the NEWER record, so its "not completed" is the user's
// latest intent and wins regardless of argument order. To check that a later
// "completed: true" still sticks, the newer record has to be the true one.
const doneNewer: ChapterState = { ...doneOlder, updatedAt: 9000 };
check("completed set by the newer record wins", mergeChapterState(notDoneNewer, doneNewer).completed, true);

// ── Merge maps ─────────────────────────────────────────────────────────────
const localMap: ComicStateMap = { a: older, b: { ...newer, bookmarks: [] } };
const remoteMap: ComicStateMap = { a: newer, c: { ...older, pageNumber: 3, bookmarks: [8] } };
const merged = mergeStateMaps(localMap, remoteMap);
check("merged keys", Object.keys(merged).sort().join(","), "a,b,c");
check("merged value updated", merged.a.pageNumber, 20);
check("local-only key survives", merged.b.pageNumber, 20);
check("remote-only key arrives", merged.c.pageNumber, 3);
check("corrupt remote record dropped", mergeStateMaps(localMap, { d: null as any }).d, undefined);

// ── Firestore doc id ───────────────────────────────────────────────────────
// A chapter URL contains slashes and colons, both illegal in a Firestore
// document id, so the raw key can never be used directly.
const docId = firestoreDocId(KEY);
check("doc id has no slash", docId.includes("/"), false);
check("doc id has no colon", docId.includes(":"), false);
check("doc id is url-safe", /^[A-Za-z0-9._-]+$/.test(docId), true);
check("doc id is stable", firestoreDocId(KEY), docId);
check("different keys differ", firestoreDocId(`${KEY}a`) === docId, false);
check("short key still produces an id", firestoreDocId("x").length > 0, true);
check("empty key survives", typeof firestoreDocId(""), "string");

// A hash collision must not silently merge two chapters.
const ids = new Set<string>();
for (let i = 0; i < 500; i++) ids.add(firestoreDocId(`plugin:https://site/s/series-${i}/chapter-${i}`));
check("500 distinct keys -> 500 ids", ids.size, 500);

// ── Cloud round-trip ───────────────────────────────────────────────────────
const cloud = toCloudRecord(KEY, multi);
check("cloud record keeps key", cloud.key, KEY);
check("cloud record has page", cloud.pageNumber, 5);
const back = fromCloudRecord(cloud)!;
check("round-trip key", back.key, KEY);
check("round-trip page", back.state.pageNumber, 5);
check("round-trip bookmarks", JSON.stringify(back.state.bookmarks), "[3,7,9]");
check("missing key rejected", fromCloudRecord({ pageNumber: 3 }), null);
check("null record rejected", fromCloudRecord(null), null);
check("corrupt record rejected", fromCloudRecord({ key: KEY, pageNumber: -1 }), null);

// ── Prune ──────────────────────────────────────────────────────────────────
const small: ComicStateMap = { a: { ...base, updatedAt: 1 } };
check("small map untouched", Object.keys(pruneLocalState(small)).length, 1);
const big: ComicStateMap = {};
for (let i = 0; i < MAX_LOCAL_CHAPTERS + 20; i++) {
  big[`k${i}`] = { ...base, updatedAt: i };
}
const pruned = pruneLocalState(big);
check("pruned to cap", Object.keys(pruned).length, MAX_LOCAL_CHAPTERS);
check("prune kept newest", pruned[`k${MAX_LOCAL_CHAPTERS + 19}`] !== undefined, true);
check("prune dropped oldest", pruned["k0"], undefined);

// ── Settings must never sync through here ──────────────────────────────────
// If a refactor ever starts persisting reader settings into these records,
// preferences would silently follow the user across devices.
const rec = JSON.stringify(toCloudRecord(KEY, multi));
check("no brightness in cloud record", rec.includes("brightness"), false);
check("no fitMode in cloud record", rec.includes("fitMode"), false);
check("no autoHide in cloud record", rec.includes("autoHide"), false);
check("no keepAwake in cloud record", rec.includes("keepAwake"), false);

console.log(`\ncomicState: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
