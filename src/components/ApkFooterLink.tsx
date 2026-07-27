import React, { useEffect, useState } from "react";
import { Download, Smartphone } from "lucide-react";
import { fetchLatestApkDownloadUrl } from "../lib/apkUpdater";

/**
 * Desktop-footer "get the Android app" link. Fetches the latest GitHub Release
 * APK URL and links straight to the download (opens the APK in a new tab).
 */
export default function ApkFooterLink() {
  const [apk, setApk] = useState<{ url: string; versionName: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetchLatestApkDownloadUrl()
      .then((info) => {
        if (alive && info?.url) setApk({ url: info.url, versionName: info.versionName });
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  return (
    <a
      href="/install"
      className="inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted hover:text-kindle-accent transition-colors"
    >
      <Smartphone className="w-3.5 h-3.5 text-kindle-accent" />
      <Download className="w-3 h-3" />
      {apk ? `Get Android App (v${apk.versionName})` : "Get Android App"}
    </a>
  );
}
