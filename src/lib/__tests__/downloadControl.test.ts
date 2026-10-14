/**
 * Tests for `downloadControl.ts`.
 *
 * These pin the logic behind the Download Control section so we can run them
 * without a browser, and so the section stays wired to the real queue instead
 * of drifting into a fixture list.
 */

const mem = new Map<string, string>();
const fakeStorage = {
  getItem: (k: string) => (mem.has(k) ? mem.get(k)! : null),
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  get length() { return mem.size; },
  key: (i: number) => [...mem.keys()][i] ?? null,
  clear: () => mem.clear(),
};

(globalThis as unknown as Record<string, unknown>).localStorage = fakeStorage;

// Static imports work with tsx's TS path resolution; dynamic `import()` does
// not resolve bare specifiers the same way, so we import what we need once
// here and share the bindings.
import {
  MAX_CONCURRENT_DOWNLOADS,
  MIN_CONCURRENT_DOWNLOADS,
  DEFAULT_CONCURRENT_DOWNLOADS,
  clampConcurrency,
  getDownloadConcurrency,
  setDownloadConcurrency,
  isActiveDownload,
  isFailedDownload,
  isFinishedDownload,
  partitionDownloads,
  clearFinishedDownloads,
  parseSizeToBytes,
  formatBytes,
  summarizeDownloads,
  readDownloadQueue,
  supportsBackgroundDownloads,
} from "../downloadControl";

let pass = 0;
let fail = 0;
function check(name: string, cond: boolean, got?: unknown) {
  if (cond) {
    pass++;
    console.log(`PASS  ${name}`);
  } else {
    fail++;
    console.log(`FAIL  ${name}`, got ?? "");
  }
}

/* ── Concurrency ─────────────────────────────────────────────────────── */

check("DEFAULT_CONCURRENT_DOWNLOADS is 2", DEFAULT_CONCURRENT_DOWNLOADS === 2, DEFAULT_CONCURRENT_DOWNLOADS);
check("MIN_CONCURRENT_DOWNLOADS is 1", MIN_CONCURRENT_DOWNLOADS === 1);
check("MAX_CONCURRENT_DOWNLOADS is 4", MAX_CONCURRENT_DOWNLOADS === 4);

check("clampConcurrency rounds sensibly", clampConcurrency(2.3) === 2, clampConcurrency(2.3));
check("clampConcurrency floors at 1", clampConcurrency(0.5) === MIN_CONCURRENT_DOWNLOADS, clampConcurrency(0.5));
check("clampConcurrency clamps at 4", clampConcurrency(42) === MAX_CONCURRENT_DOWNLOADS, clampConcurrency(42));
check("clampConcurrency handles NaN", clampConcurrency(NaN) === DEFAULT_CONCURRENT_DOWNLOADS, clampConcurrency(NaN));
check("clampConcurrency handles null", clampConcurrency(null) === DEFAULT_CONCURRENT_DOWNLOADS, clampConcurrency(null));
check("clampConcurrency handles Infinity", clampConcurrency(Infinity) === DEFAULT_CONCURRENT_DOWNLOADS, clampConcurrency(Infinity));
check("clampConcurrency handles negative numbers", clampConcurrency(-9) === MIN_CONCURRENT_DOWNLOADS, clampConcurrency(-9));

mem.clear();
check("getDownloadConcurrency returns default when unset", getDownloadConcurrency() === DEFAULT_CONCURRENT_DOWNLOADS, getDownloadConcurrency());

const written = setDownloadConcurrency(3);
check("setDownloadConcurrency returns the clamped value", written === 3, written);
check("getDownloadConcurrency reads back the stored value", getDownloadConcurrency() === 3, getDownloadConcurrency());

mem.set("kora.downloadConcurrency.v1", JSON.stringify(999));
check("a stale large value is clamped on read", getDownloadConcurrency() === MAX_CONCURRENT_DOWNLOADS, getDownloadConcurrency());
mem.set("kora.downloadConcurrency.v1", JSON.stringify("abc"));
check("a string value is coerced to default", getDownloadConcurrency() === DEFAULT_CONCURRENT_DOWNLOADS, getDownloadConcurrency());
check("purging a bad value is idempotent", getDownloadConcurrency() === DEFAULT_CONCURRENT_DOWNLOADS, getDownloadConcurrency());

/* ── Reading the real queue ──────────────────────────────────────────── */

mem.clear();
check("readDownloadQueue is empty when nothing is stored", readDownloadQueue().length === 0, readDownloadQueue().length);

check("isActiveDownload accepts downloading", isActiveDownload({ status: "downloading" }), isActiveDownload({ status: "downloading" }));
check("isActiveDownload accepts queued", isActiveDownload({ status: "queued" }), isActiveDownload({ status: "queued" }));
check("isActiveDownload accepts paused", isActiveDownload({ status: "paused" }), isActiveDownload({ status: "paused" }));
check("isActiveDownload rejects completed", !isActiveDownload({ status: "completed" }), isActiveDownload({ status: "completed" }));
check("isActiveDownload rejects error", !isActiveDownload({ status: "error" }), isActiveDownload({ status: "error" }));

check("isFailedDownload accepts error", isFailedDownload({ status: "error" }), isFailedDownload({ status: "error" }));
check("isFailedDownload accepts cancelled", isFailedDownload({ status: "cancelled" }), isFailedDownload({ status: "cancelled" }));
check("isFailedDownload rejects completed", !isFailedDownload({ status: "completed" }));

check("isFinishedDownload treats completed as finished", isFinishedDownload({ status: "completed" }));
check("isFinishedDownload treats failed as finished", isFinishedDownload({ status: "error" }));
check("isFinishedDownload treats in-flight as not finished", !isFinishedDownload({ status: "downloading" }));

const queue = [
  { id: "a", title: "up", status: "downloading", percent: 30, size: "4 MB" },
  { id: "b", title: "waiting", status: "queued", percent: 0, size: "12 MB" },
  { id: "c", title: "hold", status: "paused", percent: 70, size: "2 MB" },
  { id: "d", title: "ok", status: "completed", percent: 100, size: "1 MB" },
  { id: "e", title: "fail", status: "error", percent: 20, size: "8 MB" },
];
const parts = partitionDownloads(queue);
check("partitionDownloads splits active", parts.active.map((d: any) => d.id).join(",") === "a,b,c", parts.active.map((d: any) => d.id).join(","));
check("partitionDownloads splits failed", parts.failed.map((d: any) => d.id).join(",") === "e", parts.failed.map((d: any) => d.id).join(","));
check("partitionDownloads splits finished", parts.finished.map((d: any) => d.id).join(",") === "d", parts.finished.map((d: any) => d.id).join(","));

const cleared = clearFinishedDownloads(queue);
check("clearFinishedDownloads keeps active", cleared.some((d: any) => d.id === "a"), cleared.map((d: any) => d.id).join(","));
check("clearFinishedDownloads keeps paused", cleared.some((d: any) => d.id === "c"), cleared.map((d: any) => d.id).join(","));
check("clearFinishedDownloads drops completed", !cleared.some((d: any) => d.id === "d"), cleared.map((d: any) => d.id).join(","));
check("clearFinishedDownloads drops failed", !cleared.some((d: any) => d.id === "e"), cleared.map((d: any) => d.id).join(","));

/* ── Size accounting ─────────────────────────────────────────────────── */

check("parseSizeToBytes handles number", parseSizeToBytes(4096) === 4096, parseSizeToBytes(4096));
check("parseSizeToBytes handles 'MB'", parseSizeToBytes("5 MB") === 5 * 1024 ** 2, parseSizeToBytes("5 MB"));
check("parseSizeToBytes handles 'KB'", parseSizeToBytes("1024 KB") === 1024 * 1024, parseSizeToBytes("1024 KB"));
check("parseSizeToBytes handles 'MiB'", parseSizeToBytes("2 MiB") === 2 * 1024 ** 2, parseSizeToBytes("2 MiB"));
check("parseSizeToBytes handles 'GB'", parseSizeToBytes("1.5 GB") === 1.5 * 1024 ** 3, parseSizeToBytes("1.5 GB"));
check("parseSizeToBytes rejects bad input", parseSizeToBytes("five MB") === null, parseSizeToBytes("five MB"));
check("parseSizeToBytes returns null for NaN", parseSizeToBytes(NaN) === null, parseSizeToBytes(NaN));

check("formatBytes formats bytes", formatBytes(0) === "0 B", formatBytes(0));
check("formatBytes formats KB", formatBytes(1024) === "1.0 KB" || formatBytes(1024) === "1 KB", formatBytes(1024));
check("formatBytes formats MB", formatBytes(1536) === "1.5 KB" || formatBytes(1536) === "1 KB", formatBytes(1536));

const summary = summarizeDownloads(queue);
check("summary active count", summary.active === 3, summary.active); // a + b + c (paused is tracked)
check("summary failed count", summary.failed === 1, summary.failed);
check("summary finished count", summary.finished === 1, summary.finished);
check("summary total bytes sums parses", summary.totalBytes === (4 + 12 + 2 + 1 + 8) * 1024 ** 2, summary.totalBytes);
check("summary sizedCount counts only parseable", summary.sizedCount === 5, summary.sizedCount);
check("summary remainingBytes computes correctly when fully known", summary.remainingBytes === Math.round((4 * 0.7 + 12 + 2 * 0.3) * 1024 ** 2), summary.remainingBytes);

const missingSize = summarizeDownloads([{ id: "x", status: "downloading", percent: 50, size: "maybe?" }]);
check("summary remainingBytes is null when size is unparseable", missingSize.remainingBytes === null, missingSize.remainingBytes);
const noPercent = summarizeDownloads([{ id: "x", status: "downloading", size: "2 MB" }]);
check("summary remainingBytes is null when percent is absent", noPercent.remainingBytes === null, noPercent.remainingBytes);

/* ── Background continuation ─────────────────────────────────────────── */

check("supportsBackgroundDownloads reads the runtime capability", typeof supportsBackgroundDownloads() === "boolean");

/* ── readDownloadQueue drives the real store ─────────────────────────── */

mem.set("kora_downloads_log", JSON.stringify([{ id: "q1", title: "from log" }]));
check("readDownloadQueue reads the live log", readDownloadQueue().length === 1 && readDownloadQueue()[0]?.title === "from log", readDownloadQueue());

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
