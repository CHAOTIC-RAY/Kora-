/**
 * Resume-where-you-left-off.
 *
 * `resumePage` is pure and this is the part worth pinning: a stored page
 * has to be clamped to the chapter's *current* length, or a source that
 * removed or renumbered pages leaves the reader past the last page — a
 * blank screen with no way back.
 */
import { progressKey, resumePage, type ComicProgressMap } from "../comicProgress";
import { indexForDisplayed, displayedPage, initialIndex } from "../readingDirection";

let pass = 0;
let fail = 0;
function ok(name: string, cond: boolean, detail?: unknown) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log("FAIL ", name, detail === undefined ? "" : JSON.stringify(detail));
  }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/* ---- the key must match ComicDetailView's `pluginId:url` ---- */
ok("key is pluginId:url", progressKey("mangakat", "/ch/1") === "mangakat:/ch/1", progressKey("mangakat", "/ch/1"));
ok("key tolerates an empty plugin id", progressKey("", "/ch/1") === ":/ch/1");

const map: ComicProgressMap = {
  "src:/ch/1": { chapterIndex: 0, pageNumber: 7, totalPages: 20 },
  "src:/ch/2": { chapterIndex: 1, pageNumber: 1, totalPages: 12 },
};

/* ---- resume at the stored page ---- */
ok("resumes at the stored page", resumePage(map, "src:/ch/1", 20) === 7);
ok("resumes a chapter started at page 1", resumePage(map, "src:/ch/2", 12) === 1);

/* ---- an unstarted chapter resumes nowhere, not at page 0 ---- */
ok("an unknown chapter resumes nowhere", resumePage(map, "src:/ch/9", 20) === 0);
ok("a null-prototype lookup is safe", resumePage(Object.create(null), "src:/ch/1", 20) === 0);

/* ---- a chapter that got shorter must not strand the reader ---- */
ok("clamped to a shorter chapter", resumePage(map, "src:/ch/1", 5) === 5, resumePage(map, "src:/ch/1", 5));
ok("clamped to a single-page chapter", resumePage(map, "src:/ch/1", 1) === 1);
ok("clamped to a zero-page chapter", resumePage(map, "src:/ch/1", 0) === 1);
ok("a longer chapter keeps the stored page", resumePage(map, "src:/ch/1", 400) === 7);

/* ---- garbage in storage must not produce a garbage index ---- */
const dirty: ComicProgressMap = {
  a: { chapterIndex: 0, pageNumber: 0, totalPages: 10 }, // never started
  b: { chapterIndex: 0, pageNumber: -4, totalPages: 10 },
  c: { chapterIndex: 0, pageNumber: 3.6, totalPages: 10 }, // fractional
  d: { chapterIndex: 0, pageNumber: Number.NaN, totalPages: 10 },
  e: { chapterIndex: 0, pageNumber: Number.POSITIVE_INFINITY, totalPages: 10 },
};
ok("page 0 is treated as unstarted", resumePage(dirty, "a", 10) === 0);
ok("a negative page is not resumed", resumePage(dirty, "b", 10) === 0);
ok("a fractional page rounds and is floored at 1", resumePage(dirty, "c", 10) === 4, resumePage(dirty, "c", 10));
ok("NaN page is not resumed", resumePage(dirty, "d", 10) === 0);
ok("Infinity page is not resumed", resumePage(dirty, "e", 10) === 0);

ok("resume output is always a safe index", eq([resumePage(map, "src:/ch/1", 20) >= 0, resumePage(dirty, "d", 10) >= 0], [true, true]));

/* ---- the round trip that actually matters: store a page, reopen on it ----
 *
 * The reader hands the detail view a source array index; the store keeps a
 * displayed page number. If the conversion is wrong, resuming silently opens
 * the wrong page — so close the loop over a whole chapter rather than
 * asserting one point in it.
 */
{
  const total = 20;
  const key = "src:/ch/3";
  const stored: ComicProgressMap = {};

  for (let index = 0; index < total; index++) {
    const page = displayedPage({ rtl: true, total, index });
    stored[key] = { chapterIndex: 2, pageNumber: page, totalPages: total };
    // Reopen, exactly as ComicDetailView does.
    const reopenedPage = resumePage(stored, key, total);
    const reopenedIndex = indexForDisplayed({ rtl: true, total, page: reopenedPage });
    ok(`rtl round-trips index ${index}`, reopenedIndex === index, {
      index,
      page,
      reopenedPage,
      reopenedIndex,
    });
  }
}

/* ---- index 0 is a real resume position in RTL and must not be lost ---- */
{
  // In a right-to-left book the last source index IS the first page, and
  // its array index is 0. If the detail view treated initialIndex 0 as
  // "nothing stored", it would fall back to the RTL default — which happens
  // to be the same page here, but for a chapter resumed at page 1 of a
  // 1-page chapter it is the difference between resuming and restarting.
  const total = 1;
  const key = "src:/ch/one";
  const map: ComicProgressMap = {
    [key]: { chapterIndex: 0, pageNumber: 1, totalPages: 1 },
  };
  const page = resumePage(map, key, total);
  const index = indexForDisplayed({ rtl: true, total, page });
  ok("a one-page chapter resumes at index 0", index === 0, { page, index });
  ok("a one-page chapter still reports a page", page === 1, page);
}

/* ---- an unstarted RTL chapter falls back to the direction default ---- */
{
  // The reader's own rule: RTL opens on the last page. Resume must not
  // override that with 0, which would open a manga on its final page.
  ok(
    "unstarted falls back to the RTL default",
    initialIndex({ rtl: true, total: 20 }) === 19,
    initialIndex({ rtl: true, total: 20 })
  );
  ok(
    "resumePage returns 0 for unstarted, so the fallback applies",
    resumePage({}, "nope", 20) === 0
  );
}

console.log(`${pass} pass, ${fail} fail`);
if (fail) process.exit(1);
