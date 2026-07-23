import React, { useEffect, useState } from "react";
import { Download, Loader2 } from "lucide-react";
import {
  ApkReleaseInfo,
  fetchLatestApkRelease,
  getCachedRemoteRelease,
} from "../lib/apkUpdater";
import { isNativeAndroid } from "../lib/capacitorNative";

const RELEASES_FALLBACK = "https://github.com/CHAOTIC-RAY/Kora-/releases/latest";

/**
 * Website footer CTA that always points at the latest GitHub Release APK.
 * Hidden inside the native Android app (use ApkUpdateBanner there instead).
 */
export default function FooterApkBanner() {
  const [release, setRelease] = useState<ApkReleaseInfo | null>(() => getCachedRemoteRelease());
  const [loading, setLoading] = useState(!getCachedRemoteRelease());

  useEffect(() => {
    if (isNativeAndroid()) return;
    let cancelled = false;
    void fetchLatestApkRelease()
      .then((info) => {
        if (!cancelled && info) setRelease(info);
      })
      .catch(() => {
        /* keep cache / fallback */
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (isNativeAndroid()) return null;

  const href = release?.apkUrl || RELEASES_FALLBACK;
  const versionLabel = release?.versionName ? `v${release.versionName}` : null;

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="group w-full max-w-md mx-auto flex items-center gap-3 rounded-2xl border border-kindle-border bg-kindle-card px-4 py-3 text-left transition hover:border-kindle-text/30 hover:bg-kindle-bg"
    >
      <div className="p-2 rounded-xl bg-kindle-bg border border-kindle-border shrink-0 group-hover:border-kindle-text/20 transition">
        {loading && !release ? (
          <Loader2 className="w-4 h-4 text-kindle-text-muted animate-spin" />
        ) : (
          <Download className="w-4 h-4 text-kindle-text" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-bold uppercase tracking-[0.14em] text-kindle-text">
          Download Android APK
        </p>
        <p className="text-[10px] text-kindle-text-muted mt-0.5 truncate">
          {versionLabel
            ? `Latest release ${versionLabel} · auto-updates from GitHub`
            : loading
              ? "Fetching latest release…"
              : "Get the latest build from GitHub Releases"}
        </p>
      </div>
      <span className="shrink-0 text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted group-hover:text-kindle-text transition">
        Get
      </span>
    </a>
  );
}
