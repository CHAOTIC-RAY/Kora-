/**
 * Two user-visible bugs reported together on 2026-10-05:
 *
 *  1. "on loading screen kora animation blinks in and out"
 *  2. "i tried downloading a book it got library and was stuck ad 0 and
 *      disspeard and after a while it showed up in library downloaded"
 *
 * Both are regressions of a feature working where it should not, which is why
 * they are pinned by structure rather than by a runtime test.
 */
import fs from "node:fs";

const WORDMARK = "src/components/KoraWordmarkReveal.tsx";
const LOADING = "src/components/KoraLoading.tsx";
const INSTALL = "src/components/InstallView.tsx";
const APP = "src/App.tsx";
const LIBRARY = "src/components/LibraryManager.tsx";

const wordmark = fs.readFileSync(WORDMARK, "utf8");
const loading = fs.readFileSync(LOADING, "utf8");
const install = fs.readFileSync(INSTALL, "utf8");
const app = fs.readFileSync(APP, "utf8");
const library = fs.readFileSync(LIBRARY, "utf8");

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

console.log("=== 1. the boot wordmark reveals once and never replays ===");
// The component resets `done` -> false in two places, which unmounts the
// already-revealed subtitle to opacity:0 and replays the ink animation:
//   a) IntersectionObserver on leaving the viewport
//   b) onResize whenever wrap.clientWidth changes (scrollbar, rotation, keyboard)
// Both are correct for InstallView, a section you scroll past. On the boot
// screen there is nothing to scroll back to, so replaying can only blink.
check(
  "replay is opt-in and defaults to false",
  /replay\s*=\s*false/.test(wordmark) && /replay\?\s*:/.test(wordmark),
  "a default of true re-introduces the blink everywhere"
);
check(
  "the resize restart is gated on replay",
  /if\s*\(!replay\)\s*return;[\s\S]{0,80}clearTimeout\(t\)/.test(wordmark),
  "a scrollbar or rotation must not replay the boot animation"
);
check(
  "the IntersectionObserver is only installed when replaying",
  /const io = replay\s*\?[\s\S]{0,80}new IntersectionObserver/.test(wordmark) &&
    /if \(io\) io\.observe\(wrap\);/.test(wordmark),
  "otherwise the reset path is still live on boot"
);
check(
  "non-replay reveals immediately instead of waiting to intersect",
  /else start\(\);/.test(wordmark),
  "without this a boot screen that never intersects never reveals at all"
);
check(
  "cleanup tolerates a null observer",
  /io\?\.disconnect\(\)/.test(wordmark),
  "io.disconnect() would throw on the boot screen"
);
check(
  "the boot screen (KoraLoading) does NOT opt into replay",
  !/KoraWordmarkReveal[^>]*\breplay\b/.test(loading),
  "this is the call site that was blinking"
);
check(
  "InstallView still opts into replay",
  /<KoraWordmarkReveal\s+replay>/.test(install),
  "it is a scroll-past section; losing the replay would be a regression"
);

console.log("\n=== 2. a completed download stops shadowing the real library row ===");
// LibraryManager renders synthetic tiles from the downloads queue and hides the
// real book while a matching download is "active" (booksWithoutActiveDownloads).
// Completed entries were never removed from that queue, so the stub kept winning
// indefinitely: the real book existed but was masked by a stale 0% tile. That is
// the reported "stuck at 0, disappears, then shows up downloaded".
check(
  "LibraryManager still suppresses the real row while a download is active",
  /booksWithoutActiveDownloads/.test(library),
  "the mechanism being fixed, not removed"
);
check(
  "the synthetic tile is flagged so it is distinguishable",
  /isDownloadingCard:\s*true/.test(library)
);
check(
  "success marks the entry completed",
  /status:\s*"completed",\s*percent:\s*100/.test(app)
);
const completionBlock = app.slice(
  app.indexOf('status: "completed", percent: 100'),
  app.indexOf("success = true;")
);
check(
  "success then REMOVES the queue entry so the stub stops masking the book",
  /prev\.filter\(\s*dl\s*=>\s*dl\.id\s*!==\s*downloadId\s*\)/.test(completionBlock),
  "a completed entry left in the queue keeps the real book invisible"
);
check(
  "the removal is persisted so a reload cannot resurrect the stub",
  /persistDownloadsLogNow\(updated\)/.test(completionBlock)
);
// Compare within THIS completion block only. A file-wide indexOf would match
// the first refreshLibrary() anywhere, which is not the call site under test.
// Matched with a regex rather than a literal: the source is formatted
// `prev.filter((dl) => dl.id !== downloadId)`, and a literal string with the
// wrong spacing silently reported a false failure.
const blockStart = app.indexOf('status: "completed", percent: 100');
const refreshIdx = app.indexOf("refreshLibrary()", blockStart);
const removeMatch = /prev\.filter\(\(?dl\)?\s*=>\s*dl\.id\s*!==\s*downloadId\)/.exec(app.slice(blockStart));
check(
  "refreshLibrary runs before the stub is removed",
  refreshIdx !== -1 && !!removeMatch && refreshIdx < blockStart + removeMatch.index,
  "otherwise the real row appears one frame late, which reads as the 'disappear'"
);
// The user's standing decision: books are added on completion, never early.
// A 1%-progress gate must not creep back in.
check(
  "no early library insert on first bytes (books add on completion)",
  !/onFirstBytes[\s\S]{0,400}refreshLibrary\(\)/.test(app),
  "user decision: 'Books add on completion, which is already safe'"
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);