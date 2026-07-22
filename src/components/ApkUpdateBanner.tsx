import React, { useCallback, useEffect, useState } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { toast } from "react-hot-toast";
import {
  ApkReleaseInfo,
  downloadAndInstallApk,
  getCachedRemoteRelease,
  isApkAutoUpdateEnabled,
  isApkUpdateSnoozed,
  maybeAutoCheckApkUpdate,
  snoozeApkUpdate,
} from "../lib/apkUpdater";
import { isNativeAndroid } from "../lib/capacitorNative";

/**
 * Floating banner when a newer GitHub Release APK is available.
 * Only mounts meaningfully inside the Capacitor Android app.
 */
export default function ApkUpdateBanner() {
  const [release, setRelease] = useState<ApkReleaseInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [percent, setPercent] = useState(0);

  useEffect(() => {
    if (!isNativeAndroid()) return;

    const cached = getCachedRemoteRelease();
    if (cached && !isApkUpdateSnoozed()) setRelease(cached);

    const onUpdate = (event: Event) => {
      const detail = (event as CustomEvent<ApkReleaseInfo>).detail;
      if (detail?.apkUrl) setRelease(detail);
    };
    window.addEventListener("kora-apk-update", onUpdate as EventListener);

    // Deferred auto-check so first paint isn't blocked.
    const t = window.setTimeout(() => {
      if (!isApkAutoUpdateEnabled()) return;
      void maybeAutoCheckApkUpdate({ notify: true }).then((info) => {
        if (info) setRelease(info);
      });
    }, 4000);

    const onVis = () => {
      if (document.visibilityState !== "visible") return;
      if (!isApkAutoUpdateEnabled()) return;
      void maybeAutoCheckApkUpdate({ minIntervalMs: 6 * 60 * 60 * 1000, notify: true }).then(
        (info) => {
          if (info) setRelease(info);
        }
      );
    };
    document.addEventListener("visibilitychange", onVis);

    return () => {
      window.clearTimeout(t);
      window.removeEventListener("kora-apk-update", onUpdate as EventListener);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  const dismiss = useCallback(() => {
    snoozeApkUpdate(24);
    setRelease(null);
  }, []);

  const install = useCallback(async () => {
    if (!release || busy) return;
    setBusy(true);
    setPercent(0);
    try {
      await downloadAndInstallApk(release, (p) => setPercent(p.percent));
      toast.success("Opening installer…");
    } catch (err: any) {
      toast.error(err?.message || "Update install failed");
    } finally {
      setBusy(false);
    }
  }, [release, busy]);

  if (!isNativeAndroid() || !release) return null;

  return (
    <div className="fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] left-3 right-3 z-[91] flex flex-col gap-2 pointer-events-none md:left-auto md:right-6 md:w-[360px]">
      <div className="pointer-events-auto rounded-2xl border border-kindle-border bg-kindle-card shadow-lg p-3.5 flex flex-col gap-2.5">
        <div className="flex items-start gap-2">
          <div className="p-1.5 rounded-lg bg-kindle-bg border border-kindle-border shrink-0">
            <Download className="w-4 h-4 text-kindle-accent" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-bold text-kindle-text">Update ready</p>
            <p className="text-[11px] text-kindle-text-muted leading-snug mt-0.5">
              Kora {release.versionName} is available from GitHub Releases.
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            className="p-1 rounded-lg text-kindle-text-muted hover:text-kindle-text cursor-pointer"
            aria-label="Dismiss update"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {busy && (
          <div className="h-1.5 rounded-full bg-kindle-bg overflow-hidden">
            <div
              className="h-full bg-kindle-accent transition-all duration-200"
              style={{ width: `${Math.max(2, percent)}%` }}
            />
          </div>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            onClick={install}
            disabled={busy}
            className="flex-1 py-2 rounded-xl bg-kindle-text text-kindle-bg text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 disabled:opacity-60 cursor-pointer"
          >
            {busy ? (
              <>
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                {percent > 0 ? `${percent}%` : "Preparing…"}
              </>
            ) : (
              <>
                <Download className="w-3.5 h-3.5" />
                Install
              </>
            )}
          </button>
          <button
            type="button"
            onClick={dismiss}
            disabled={busy}
            className="px-3 py-2 rounded-xl border border-kindle-border text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted cursor-pointer"
          >
            Later
          </button>
        </div>
      </div>
    </div>
  );
}
