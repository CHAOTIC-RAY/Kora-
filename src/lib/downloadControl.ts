/**
 * Download Control — the logic behind the Settings control surface.
 *
 * Kora's download queue is not a simulated list. `App.tsx` owns the live one
 * (`globalDownloads`, mirrored into `kora_downloads_log` by `downloadsLog.ts`)
 * and hands every entry a real `status`. The service worker
 * (`public/sw.js`) is what actually moves bytes, and it reports progress,
 * completion, pause and failure back over `postMessage`.
 *
 * So this module deliberately contains no queue of its own. It contains the
 * three things that are genuinely derivable from the real queue and are
 * worth pinning with tests:
 *
 *  1. `clampConcurrency` — how many downloads may run at once, bounded to a
 *     range that is safe on a phone and useful on a desktop.
 *  2. `summarizeDownloads` — counts and byte totals, read off the real entries.
 *  3. `supportsBackgroundDownloads` — whether the browser can keep a download
 *     running after the app is closed at all. This is a capability question,
 *     not a preference question, and the Settings UI must not offer a toggle
 *     the platform cannot honour.
 *
 * Nothing here mutates storage. The control surface drives the real queue
 * through the callbacks App already exposes (`cancel` / `retry`), so there is
 * no second source of truth to drift out of sync with the library grid.
 */

import { loadDownloadsLog } from "./downloadsLog";

/* ── Concurrency ─────────────────────────────────────────────────────── */

/**
 * Bounds for simultaneous downloads.
 *
 * The floor is 1 because 0 would mean "never download", which is not a
 * concurrency setting — it is a broken app. The ceiling is 4: past that a
 * phone is holding four live Range streams plus a reader, and progress
 * reporting gets noisy enough that the numbers stop being readable. Two is
 * the default because it keeps the network busy without starving the fetch
 * the rest of the UI is doing.
 */
export const MIN_CONCURRENT_DOWNLOADS = 1;
export const MAX_CONCURRENT_DOWNLOADS = 4;
export const DEFAULT_CONCURRENT_DOWNLOADS = 2;

const LS_CONCURRENCY = "kora.downloadConcurrency.v1";

/**
 * Coerce anything to a usable concurrency value.
 *
 * This is the only place the range is enforced, and it is enforced on read as
 * well as on write. A stored value can be stale (written by an older build
 * with a wider range), hand-edited, or absent, and a slider bound to a
 * garbage number is a real bug rather than a cosmetic one. `NaN`, `null`,
 * `Infinity` and non-numeric strings all collapse to the default.
 */
export function clampConcurrency(value: unknown): number {
  if (value === null || value === undefined) return DEFAULT_CONCURRENT_DOWNLOADS;
  const raw = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(raw) || Number.isNaN(raw)) return DEFAULT_CONCURRENT_DOWNLOADS;
  const whole = Math.round(raw);
  if (whole < MIN_CONCURRENT_DOWNLOADS) return MIN_CONCURRENT_DOWNLOADS;
  if (whole > MAX_CONCURRENT_DOWNLOADS) return MAX_CONCURRENT_DOWNLOADS;
  return whole;
}

/** Read the stored concurrency, clamped. Never throws on a broken store. */
export function getDownloadConcurrency(): number {
  try {
    if (typeof localStorage === "undefined") return DEFAULT_CONCURRENT_DOWNLOADS;
    return clampConcurrency(localStorage.getItem(LS_CONCURRENCY));
  } catch {
    return DEFAULT_CONCURRENT_DOWNLOADS;
  }
}

/** Persist a concurrency value, clamped on the way in. Returns what was stored. */
export function setDownloadConcurrency(value: unknown): number {
  const clamped = clampConcurrency(value);
  try {
    localStorage.setItem(LS_CONCURRENCY, String(clamped));
  } catch {
    /* private mode — the value still applies for this session */
  }
  return clamped;
}

/* ── Reading the real queue ──────────────────────────────────────────── */

/**
 * The statuses that mean "this download is still in flight".
 *
 * `paused` counts as in-flight on purpose: a paused download still owns a
 * partial file and a slot in the queue, and treating it as finished would let
 * "clear finished" silently throw away resumable work. `cancelled` and
 * `error` are terminal; `completed` is the success terminal.
 */
export const ACTIVE_DOWNLOAD_STATUSES = ["downloading", "paused", "queued"] as const;
export const FAILED_DOWNLOAD_STATUSES = ["error", "cancelled"] as const;

export type DownloadStatus = string;

export interface DownloadEntry {
  id?: string;
  title?: string;
  author?: string;
  status?: DownloadStatus;
  percent?: number | null;
  size?: string | number;
  transferred?: string;
  speed?: string;
  eta?: string;
  errorMessage?: string;
  [k: string]: unknown;
}

export function isActiveDownload(dl: DownloadEntry): boolean {
  return ACTIVE_DOWNLOAD_STATUSES.includes(dl.status as never);
}

export function isFailedDownload(dl: DownloadEntry): boolean {
  return FAILED_DOWNLOAD_STATUSES.includes(dl.status as never);
}

/** Terminal and not a failure — i.e. what "clear finished" should remove. */
export function isFinishedDownload(dl: DownloadEntry): boolean {
  return dl.status === "completed" || isFailedDownload(dl);
}

/**
 * Split the real queue into the three buckets the control surface renders.
 *
 * Failed comes out first because a failed download is the only one that is
 * actionable: it has a Retry button. Active is the progress list. Everything
 * else is finished and is what "clear finished" drops.
 */
export function partitionDownloads(downloads: DownloadEntry[]): {
  active: DownloadEntry[];
  failed: DownloadEntry[];
  finished: DownloadEntry[];
} {
  const active: DownloadEntry[] = [];
  const failed: DownloadEntry[] = [];
  const finished: DownloadEntry[] = [];
  for (const dl of downloads) {
    if (isFailedDownload(dl)) failed.push(dl);
    else if (isActiveDownload(dl)) active.push(dl);
    else finished.push(dl);
  }
  return { active, failed, finished };
}

/**
 * Drop the finished entries, keeping every in-flight one.
 *
 * Deliberately keeps `paused`: it is resumable work, and the user asking to
 * tidy the list did not ask to abandon half a book. The caller is responsible
 * for telling the service worker to forget anything it was holding; this
 * function only decides what stays in the log.
 */
export function clearFinishedDownloads(downloads: DownloadEntry[]): DownloadEntry[] {
  return downloads.filter((dl) => !isFinishedDownload(dl));
}

/* ── Size accounting ─────────────────────────────────────────────────── */

/**
 * Parse a human size into bytes.
 *
 * The queue stores sizes as display strings ("4.2 MB") because they come
 * straight from a source's file listing, so a real total has to parse them.
 * Unparseable entries are skipped rather than guessed at — a wrong total is
 * worse than an obviously partial one.
 */
export function parseSizeToBytes(size: unknown): number | null {
  if (typeof size === "number") return Number.isFinite(size) ? size : null;
  if (typeof size !== "string") return null;
  const m = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(B|KB|MB|GB|TB|KiB|MiB|GiB)\s*$/i.exec(size);
  if (!m) return null;
  const n = Number(m[1]);
  if (!Number.isFinite(n)) return null;
  const unit = m[2].toLowerCase();
  const mult =
    unit === "b" ? 1
    : unit === "kb" || unit === "kib" ? 1024
    : unit === "mb" || unit === "mib" ? 1024 ** 2
    : unit === "gb" || unit === "gib" ? 1024 ** 3
    : 1024 ** 4;
  return n * mult;
}

/** Format bytes back to a short human string, for the summary line. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export interface DownloadSummary {
  total: number;
  active: number;
  failed: number;
  finished: number;
  /** Bytes across every entry whose size could be parsed. */
  totalBytes: number;
  /** How many entries contributed to `totalBytes`. */
  sizedCount: number;
  /** Bytes still to go on the active entries, from their `percent`. */
  remainingBytes: number | null;
}

/**
 * Build the data/size summary the Settings section shows.
 *
 * `remainingBytes` is null when it cannot be stated honestly — which is the
 * case as soon as any active entry has an unknown size or a missing percent.
 * A partial "about 12 MB left" would be worse than saying nothing.
 */
export function summarizeDownloads(downloads: DownloadEntry[]): DownloadSummary {
  const { active, failed, finished } = partitionDownloads(downloads);
  let totalBytes = 0;
  let sizedCount = 0;
  for (const dl of downloads) {
    const b = parseSizeToBytes(dl.size);
    if (b !== null) {
      totalBytes += b;
      sizedCount++;
    }
  }

  let remainingBytes: number | null = 0;
  for (const dl of active) {
    const b = parseSizeToBytes(dl.size);
    const pct = typeof dl.percent === "number" ? dl.percent : null;
    if (b === null || pct === null || !Number.isFinite(pct)) {
      remainingBytes = null;
      break;
    }
    remainingBytes += b * (1 - clampPercent(pct) / 100);
  }
  if (remainingBytes !== null) remainingBytes = Math.max(0, Math.round(remainingBytes));

  return {
    total: downloads.length,
    active: active.length,
    failed: failed.length,
    finished: finished.length,
    totalBytes,
    sizedCount,
    remainingBytes,
  };
}

/** Percent is attacker-of-typed-data territory: it comes off a progress event. */
export function clampPercent(pct: unknown): number {
  const n = typeof pct === "number" ? pct : Number(pct);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 100) return 100;
  return n;
}

/* ── Background continuation: a capability, not a preference ──────────── */

/**
 * Whether this browser can keep a download running after the tab is closed.
 *
 * Background Fetch is the mechanism the service worker actually uses
 * (`registration.backgroundFetch.fetch` in `public/sw.js`), and it is
 * Chromium-only. Background Sync alone can resume a *failed* download, but it
 * cannot be relied on to keep a healthy one moving with the app gone.
 *
 * So on a browser without Background Fetch the honest answer is "no", and the
 * Settings UI must say so rather than offering a switch that quietly does
 * nothing. This returns the capability, not a stored preference, deliberately:
 * a stored flag would let a device that once had BGF keep claiming support
 * after a browser update removed it.
 */
export function supportsBackgroundDownloads(): boolean {
  try {
    // `serviceWorker` is a property of navigator, not a global — checking
    // `typeof serviceWorker` referenced an identifier that does not exist,
    // so it threw a ReferenceError into the catch and this reported false
    // on every device. The `in navigator` test below is the real check.
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return false;
    return "backgroundFetch" in (ServiceWorkerRegistration.prototype as object);
  } catch {
    return false;
  }
}

/**
 * The real queue as it stands right now, straight from the log App persists.
 *
 * Exposed so the control surface can render on a cold mount (Settings is a
 * keep-alive tab that is often mounted before the first download happens) and
 * so a test can assert the section is pointed at the real store rather than a
 * fixture list.
 */
export function readDownloadQueue(): DownloadEntry[] {
  const log = loadDownloadsLog();
  return Array.isArray(log) ? (log as DownloadEntry[]) : [];
}
