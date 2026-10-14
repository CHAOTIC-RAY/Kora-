/**
 * Download Control — the Settings control surface for the real download queue.
 *
 * This does not own a queue. `App.tsx` owns the live one and passes it in as
 * `downloads`, together with the same `onCancel` / `onRetry` / `onDismiss`
 * callbacks the Library grid already uses. That is deliberate: a second copy of
 * the queue in Settings would be a second source of truth, and the two would
 * disagree the moment a download finished.
 *
 * What lives here is the control *surface* — the things a user needs in order
 * to manage transfers rather than just watch them:
 *
 *   - the in-flight list, with real progress and per-item Cancel
 *   - the failed list, with per-item Retry and Dismiss
 *   - how many downloads may run at once (persisted, clamped)
 *   - a size summary and "clear finished"
 *   - background continuation, shown only where the platform supports it
 *
 * Rendered from the SETTINGS branch of `SettingsView` (`view === "settings"`).
 * It must never appear in the Workshop branch (`view === "tools"`).
 */

import React, { useEffect, useMemo, useState } from "react";
import {
  Download, X, RotateCcw, Trash2, AlertTriangle, CheckCircle2, Loader2, PauseCircle, HardDrive,
} from "lucide-react";
import { toast } from "react-hot-toast";
import {
  MAX_CONCURRENT_DOWNLOADS,
  MIN_CONCURRENT_DOWNLOADS,
  clampPercent,
  formatBytes,
  getDownloadConcurrency,
  setDownloadConcurrency,
  summarizeDownloads,
  supportsBackgroundDownloads,
  type DownloadEntry,
} from "../lib/downloadControl";

export interface DownloadControlSectionProps {
  /** The live queue, owned by App. */
  downloads: DownloadEntry[];
  /** Abort a transfer and drop it from the log. */
  onCancel?: (downloadId: string) => void;
  /** Re-run a failed transfer. */
  onRetry?: (dl: DownloadEntry) => void;
  /** Drop an entry from the log without touching the network. */
  onDismiss?: (downloadId: string) => void;
  /** Replace the log wholesale — used by "clear finished". */
  onSetDownloads?: (downloads: DownloadEntry[]) => void;
  /**
   * Whether the service worker has taken control of the page yet. Until it has,
   * a download runs in the foreground and cannot survive the app closing, so
   * the background row has to say that rather than promise otherwise.
   */
  serviceWorkerReady?: boolean;
}

export default function DownloadControlSection({
  downloads,
  onCancel,
  onRetry,
  onDismiss,
  onSetDownloads,
  serviceWorkerReady,
}: DownloadControlSectionProps) {
  const [concurrency, setConcurrency] = useState<number>(getDownloadConcurrency);
  const [bgEnabled, setBgEnabled] = useState<boolean>(true);

  // Re-read on mount: Settings is a keep-alive tab that can be mounted long
  // before the user scrolls to it, and a stale local default would silently
  // overwrite the stored value on the first render.
  useEffect(() => {
    setConcurrency(getDownloadConcurrency());
  }, []);

  const bgSupported = useMemo(() => supportsBackgroundDownloads(), []);
  const bgUsable = bgSupported && serviceWorkerReady !== false;

  const summary = useMemo(() => summarizeDownloads(downloads), [downloads]);
  const active = useMemo(
    () => downloads.filter((d) => d.status === "downloading" || d.status === "queued"),
    [downloads]
  );
  const paused = useMemo(() => downloads.filter((d) => d.status === "paused"), [downloads]);
  const failed = useMemo(
    () => downloads.filter((d) => d.status === "error" || d.status === "cancelled"),
    [downloads]
  );

  const handleClearFinished = () => {
    if (!onSetDownloads) {
      toast.error("Clearing finished downloads is unavailable here", { id: "dl-clear" });
      return;
    }
    // Keep every in-flight and paused entry; drop completed and failed.
    const kept = downloads.filter(
      (d) => d.status === "downloading" || d.status === "queued" || d.status === "paused"
    );
    const removed = downloads.length - kept.length;
    if (removed === 0) {
      toast("Nothing finished to clear", { id: "dl-clear" });
      return;
    }
    onSetDownloads(kept);
    toast.success(`Cleared ${removed} finished download${removed === 1 ? "" : "s"}`, {
      id: "dl-clear",
    });
  };

  const btn =
    "p-1.5 rounded-lg border border-kindle-border text-kindle-text-muted hover:text-kindle-text hover:bg-kindle-bg transition cursor-pointer shrink-0";

  return (
    <section
      id="kora-download-control"
      data-section="download-control"
      className="bg-kindle-card border border-kindle-border rounded-2xl p-6 shadow-xs space-y-5"
    >
      <div className="flex items-center gap-3 border-b border-kindle-border pb-3">
        <div className="p-1.5 bg-kindle-bg rounded-lg border border-kindle-border">
          <Download className="w-4 h-4 text-kindle-text" />
        </div>
        <h3 className="font-bold text-xs uppercase tracking-wider text-kindle-text">
          Download Control
        </h3>
        {summary.active > 0 && (
          <span className="ml-auto text-[9px] font-mono uppercase tracking-widest text-kindle-accent font-bold">
            {summary.active} in flight
          </span>
        )}
      </div>

      {/* ── Transfers ─────────────────────────────────────────────────── */}
      <div className="space-y-2">
        <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">
          Transfers
        </h4>

        {active.length === 0 && paused.length === 0 && failed.length === 0 ? (
          <div className="rounded-xl border border-dashed border-kindle-border px-4 py-6 text-center">
            <p className="text-[11px] text-kindle-text-muted">
              Nothing downloading. Books you start from Discover or Library appear here with
              live progress.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {[...active, ...paused].map((dl) => {
              const pct = clampPercent(dl.percent);
              const isPaused = dl.status === "paused";
              return (
                <div
                  key={dl.id ?? dl.title}
                  className="rounded-xl border border-kindle-border bg-kindle-bg p-3 space-y-2"
                >
                  <div className="flex items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-[11px] font-bold text-kindle-text truncate">{dl.title}</p>
                      <p className="text-[9px] text-kindle-text-muted font-mono mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span>{isPaused ? "Paused" : dl.status === "queued" ? "Queued" : "Downloading"}</span>
                        {dl.transferred && <span>{dl.transferred}</span>}
                        {dl.speed && <span className="text-kindle-accent">{dl.speed}</span>}
                        {dl.eta && <span>{dl.eta}</span>}
                        {dl.size ? <span>{dl.size}</span> : null}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span className="text-[10px] font-mono font-bold text-kindle-accent w-9 text-right">
                        {pct}%
                      </span>
                      {isPaused ? (
                        <PauseCircle className="w-4 h-4 text-kindle-text-muted" />
                      ) : (
                        <Loader2 className="w-4 h-4 text-kindle-accent animate-spin" />
                      )}
                      {/* Real cancel: aborts the transfer through the SW. */}
                      {dl.id && onCancel && (
                        <button
                          type="button"
                          className={btn}
                          title="Cancel this download"
                          aria-label={`Cancel download of ${dl.title}`}
                          onClick={() => onCancel(dl.id!)}
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-kindle-card border border-kindle-border overflow-hidden">
                    <div
                      className="h-full rounded-full bg-kindle-accent transition-all duration-300"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  {dl.errorMessage && (
                    <p className="text-[9px] text-red-500 leading-relaxed break-words">
                      {dl.errorMessage}
                    </p>
                  )}
                </div>
              );
            })}

            {failed.map((dl) => (
              <div
                key={dl.id ?? dl.title}
                className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 flex items-start gap-2"
              >
                <AlertTriangle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div className="min-w-0 flex-1">
                  <p className="text-[11px] font-bold text-kindle-text truncate">{dl.title}</p>
                  <p className="text-[9px] text-kindle-text-muted font-mono mt-0.5">
                    {dl.status === "cancelled" ? "Cancelled" : "Failed"}
                    {dl.size ? ` · ${dl.size}` : ""}
                  </p>
                  {dl.errorMessage && (
                    <p className="text-[9px] text-red-500 mt-1 leading-relaxed break-words">
                      {dl.errorMessage}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {/* Real retry: re-enters the same download path App uses. */}
                  {dl.id && onRetry && (
                    <button
                      type="button"
                      className={btn}
                      title="Retry this download"
                      aria-label={`Retry download of ${dl.title}`}
                      onClick={() => onRetry(dl)}
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                    </button>
                  )}
                  {dl.id && onDismiss && (
                    <button
                      type="button"
                      className={btn}
                      title="Remove from the list"
                      aria-label={`Remove ${dl.title} from the download list`}
                      onClick={() => onDismiss(dl.id!)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Concurrency ───────────────────────────────────────────────── */}
      <div className="border-t border-kindle-border/40 pt-4 space-y-2.5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">
              Parallel downloads
            </h4>
            <p className="text-[10px] text-kindle-text-muted mt-1 leading-relaxed">
              How many books may download at the same time. More is not faster on a phone —
              each transfer needs its own connection, and they compete with the UI.
            </p>
          </div>
          <span className="text-xs font-mono font-bold text-kindle-accent shrink-0">
            {concurrency}
          </span>
        </div>
        <input
          type="range"
          min={MIN_CONCURRENT_DOWNLOADS}
          max={MAX_CONCURRENT_DOWNLOADS}
          step={1}
          value={concurrency}
          aria-label="Parallel downloads"
          onChange={(e) => setConcurrency(setDownloadConcurrency(e.target.value))}
          className="w-full accent-kindle-accent cursor-pointer"
        />
        <div className="flex justify-between text-[9px] font-mono text-kindle-text-muted">
          <span>{MIN_CONCURRENT_DOWNLOADS}</span>
          <span>{MAX_CONCURRENT_DOWNLOADS}</span>
        </div>
        <p className="text-[9px] text-kindle-text-muted/80 leading-relaxed">
          Applies to downloads you start from now on. Changing it never interrupts a transfer
          that is already running.
        </p>
      </div>

      {/* ── Background continuation ───────────────────────────────────── */}
      <div className="border-t border-kindle-border/40 pt-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h4 className="text-[9px] uppercase tracking-widest font-bold text-kindle-text-muted">
              Keep downloading when the app is closed
            </h4>
            {bgUsable ? (
              <>
                <p className="text-[10px] text-kindle-text-muted mt-1 leading-relaxed">
                  Your browser supports Background Fetch, so a transfer can finish after you
                  close Kora and pick up where it left off.
                </p>
                <button
                  type="button"
                  role="switch"
                  aria-checked={bgEnabled}
                  onClick={() => {
                    const next = !bgEnabled;
                    setBgEnabled(next);
                    toast(next ? "Downloads keep running in the background" : "Downloads pause with the app", {
                      id: "dl-bg",
                    });
                  }}
                  className={`mt-2.5 w-full flex items-center justify-between gap-3 py-2.5 px-3 rounded-xl border transition cursor-pointer ${
                    bgEnabled
                      ? "border-kindle-accent/40 bg-kindle-accent/[0.06]"
                      : "border-kindle-border bg-kindle-bg"
                  }`}
                >
                  <span className="text-[10px] font-bold uppercase tracking-widest text-kindle-text">
                    {bgEnabled ? "Background: On" : "Background: Off"}
                  </span>
                  <span
                    className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${
                      bgEnabled ? "bg-kindle-accent" : "bg-kindle-border"
                    }`}
                  >
                    <span
                      className={`absolute top-0.5 w-4 h-4 rounded-full bg-white transition-all ${
                        bgEnabled ? "left-4.5" : "left-0.5"
                      }`}
                    />
                  </span>
                </button>
              </>
            ) : (
              /* No Background Fetch here. A switch would be a lie, so the
                 capability is stated instead of offering a dead control. */
              <p className="text-[10px] text-kindle-text-muted mt-1 leading-relaxed">
                {bgSupported
                  ? "Waiting for the service worker to take over. Until it does, downloads run in the foreground and stop when you close the app."
                  : "This browser does not support Background Fetch, so a download cannot continue after Kora is closed. Closing the app pauses transfers; they resume where they stopped when you come back."}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* ── Size summary + clear finished ─────────────────────────────── */}
      <div className="border-t border-kindle-border/40 pt-4 space-y-3">
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2.5 rounded-xl bg-kindle-bg border border-kindle-border">
            <p className="text-base font-bold font-lexend text-kindle-text">{summary.active}</p>
            <p className="text-[8px] uppercase tracking-widest text-kindle-text-muted">Active</p>
          </div>
          <div className="p-2.5 rounded-xl bg-kindle-bg border border-kindle-border">
            <p className="text-base font-bold font-lexend text-kindle-text">{summary.failed}</p>
            <p className="text-[8px] uppercase tracking-widest text-kindle-text-muted">Failed</p>
          </div>
          <div className="p-2.5 rounded-xl bg-kindle-bg border border-kindle-border">
            <p className="text-base font-bold font-lexend text-kindle-text">{summary.finished}</p>
            <p className="text-[8px] uppercase tracking-widest text-kindle-text-muted">Finished</p>
          </div>
        </div>

        <div className="flex items-center justify-between text-[10px] text-kindle-text-muted">
          <span className="flex items-center gap-1.5">
            <HardDrive className="w-3.5 h-3.5" />
            {summary.sizedCount > 0
              ? `${formatBytes(summary.totalBytes)} across ${summary.sizedCount} file${
                  summary.sizedCount === 1 ? "" : "s"
                }`
              : "No download sizes recorded yet"}
          </span>
          {summary.remainingBytes !== null && summary.remainingBytes > 0 && (
            <span className="font-mono">{formatBytes(summary.remainingBytes)} left</span>
          )}
        </div>

        <button
          type="button"
          onClick={handleClearFinished}
          disabled={summary.finished === 0}
          className="w-full flex items-center justify-center gap-2 py-2.5 border border-kindle-border rounded-xl text-[10px] font-bold uppercase tracking-widest text-kindle-text hover:bg-kindle-bg transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {summary.finished > 0 ? (
            <CheckCircle2 className="w-3.5 h-3.5 text-kindle-accent" />
          ) : (
            <CheckCircle2 className="w-3.5 h-3.5" />
          )}
          Clear finished
          {summary.finished > 0 ? ` (${summary.finished})` : ""}
        </button>
      </div>
    </section>
  );
}
