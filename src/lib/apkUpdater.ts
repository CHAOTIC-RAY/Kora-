/**
 * APK auto-update from GitHub Releases (Capacitor Android only).
 * Checks latest release, downloads the APK, and hands off to the system installer.
 */

import { registerPlugin } from "@capacitor/core";
import { APP_CHANNEL } from "./appChannel";
import { isNativeAndroid, showNativeNotification } from "./capacitorNative";

const GITHUB_REPO = "CHAOTIC-RAY/Kora-";
const AUTO_UPDATE_KEY = "kora_apk_auto_update";
const SNOOZE_KEY = "kora_apk_update_snooze_until";
const LAST_CHECK_KEY = "kora_apk_last_check_at";
const LAST_KNOWN_KEY = "kora_apk_last_known_remote";

export type ApkReleaseInfo = {
  tagName: string;
  versionName: string;
  versionCode: number;
  name: string;
  htmlUrl: string;
  publishedAt: string;
  apkUrl: string;
  apkName: string;
  apkSize: number;
  prerelease: boolean;
};

export type ApkUpdateCheckResult = {
  currentVersion: string;
  currentBuild: string;
  update: ApkReleaseInfo | null;
  checkedAt: number;
};

type ApkInstallPluginApi = {
  canInstall(): Promise<{ allowed: boolean }>;
  openInstallPermissionSettings(): Promise<void>;
  install(options: { path: string }): Promise<{ ok?: boolean }>;
  downloadAndInstall(options: {
    url: string;
    fileName?: string;
  }): Promise<{ ok?: boolean; path?: string; bytes?: number }>;
  addListener(
    eventName: "apkDownloadProgress",
    listenerFunc: (event: { percent: number; bytes?: number; total?: number }) => void
  ): Promise<{ remove: () => Promise<void> }>;
};

const ApkInstall = registerPlugin<ApkInstallPluginApi>("ApkInstall");

function readFlag(key: string, fallback: boolean): boolean {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    return raw === "1" || raw === "true";
  } catch {
    return fallback;
  }
}

export function isApkAutoUpdateEnabled(): boolean {
  return readFlag(AUTO_UPDATE_KEY, true);
}

export function setApkAutoUpdateEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(AUTO_UPDATE_KEY, enabled ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function snoozeApkUpdate(hours = 24): void {
  try {
    localStorage.setItem(SNOOZE_KEY, String(Date.now() + hours * 60 * 60 * 1000));
  } catch {
    /* ignore */
  }
}

export function isApkUpdateSnoozed(): boolean {
  try {
    const until = Number(localStorage.getItem(SNOOZE_KEY) || 0);
    return Date.now() < until;
  } catch {
    return false;
  }
}

export function getLastApkCheckAt(): number {
  try {
    return Number(localStorage.getItem(LAST_CHECK_KEY) || 0);
  } catch {
    return 0;
  }
}

function rememberRemote(info: ApkReleaseInfo | null): void {
  try {
    if (!info) {
      localStorage.removeItem(LAST_KNOWN_KEY);
      return;
    }
    localStorage.setItem(LAST_KNOWN_KEY, JSON.stringify(info));
  } catch {
    /* ignore */
  }
}

export function getCachedRemoteRelease(): ApkReleaseInfo | null {
  try {
    const raw = localStorage.getItem(LAST_KNOWN_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as ApkReleaseInfo;
  } catch {
    return null;
  }
}

function parseVersionCode(tagOrName: string): number {
  const m = String(tagOrName).match(/(\d+)\s*$/);
  if (!m) return 0;
  return parseInt(m[1], 10) || 0;
}

function parseVersionName(tagOrName: string): string {
  const raw = String(tagOrName).replace(/^apk-v/i, "").replace(/^v/i, "").trim();
  return raw || tagOrName;
}

async function getLocalAppInfo(): Promise<{ version: string; build: string }> {
  const baked =
    (import.meta.env.VITE_APK_VERSION as string | undefined)?.trim() ||
    (import.meta.env.VITE_APP_VERSION as string | undefined)?.trim() ||
    "";
  try {
    const { App } = await import("@capacitor/app");
    const info = await App.getInfo();
    return {
      version: info.version || baked || "0",
      build: info.build || String(parseVersionCode(info.version || baked)),
    };
  } catch {
    return {
      version: baked || "0",
      build: String(parseVersionCode(baked)),
    };
  }
}

function pickApkAsset(assets: Array<Record<string, unknown>> | undefined): {
  url: string;
  name: string;
  size: number;
} | null {
  if (!Array.isArray(assets)) return null;
  const apk = assets.find((a) => {
    const name = String(a.name || "").toLowerCase();
    const content = String(a.content_type || "").toLowerCase();
    return name.endsWith(".apk") || content.includes("android.package-archive");
  });
  if (!apk?.browser_download_url) return null;
  return {
    url: String(apk.browser_download_url),
    name: String(apk.name || "Kora.apk"),
    size: Number(apk.size || 0),
  };
}

function releaseFromGithubJson(json: Record<string, unknown>): ApkReleaseInfo | null {
  const asset = pickApkAsset(json.assets as Array<Record<string, unknown>> | undefined);
  if (!asset) return null;
  const tagName = String(json.tag_name || "");
  return {
    tagName,
    versionName: parseVersionName(tagName || String(json.name || "")),
    versionCode: parseVersionCode(tagName || String(json.name || "")),
    name: String(json.name || tagName),
    htmlUrl: String(json.html_url || ""),
    publishedAt: String(json.published_at || ""),
    apkUrl: asset.url,
    apkName: asset.name,
    apkSize: asset.size,
    prerelease: Boolean(json.prerelease),
  };
}

/** Fetch newest GitHub release that includes an APK asset. */
export async function fetchLatestApkRelease(): Promise<ApkReleaseInfo | null> {
  const headers: HeadersInit = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };

  if (APP_CHANNEL === "beta") {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/releases?per_page=8`,
      { headers, cache: "no-store" }
    );
    if (!res.ok) throw new Error(`GitHub releases failed (${res.status})`);
    const list = (await res.json()) as Array<Record<string, unknown>>;
    for (const item of list) {
      const parsed = releaseFromGithubJson(item);
      if (parsed) return parsed;
    }
    return null;
  }

  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers,
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`GitHub latest release failed (${res.status})`);
  return releaseFromGithubJson((await res.json()) as Record<string, unknown>);
}

export function isRemoteNewer(
  remote: ApkReleaseInfo,
  local: { version: string; build: string }
): boolean {
  const localCode = parseInt(local.build, 10) || parseVersionCode(local.version);
  if (remote.versionCode > 0 && localCode > 0) {
    return remote.versionCode > localCode;
  }
  return (
    remote.versionName.localeCompare(local.version, undefined, {
      numeric: true,
      sensitivity: "base",
    }) > 0
  );
}

/** Check GitHub for a newer APK than the one currently installed. */
export async function checkForApkUpdate(): Promise<ApkUpdateCheckResult> {
  const local = await getLocalAppInfo();
  const checkedAt = Date.now();
  try {
    localStorage.setItem(LAST_CHECK_KEY, String(checkedAt));
  } catch {
    /* ignore */
  }

  const remote = await fetchLatestApkRelease();
  if (!remote || !isRemoteNewer(remote, local)) {
    rememberRemote(null);
    return { currentVersion: local.version, currentBuild: local.build, update: null, checkedAt };
  }

  rememberRemote(remote);
  return { currentVersion: local.version, currentBuild: local.build, update: remote, checkedAt };
}

export async function ensureInstallPermission(): Promise<boolean> {
  if (!isNativeAndroid()) return false;
  const { allowed } = await ApkInstall.canInstall();
  if (allowed) return true;
  await ApkInstall.openInstallPermissionSettings();
  return false;
}

export type DownloadProgress = { percent: number; bytes?: number; total?: number };

/** Download APK to cache and launch the system package installer. */
export async function downloadAndInstallApk(
  release: ApkReleaseInfo,
  onProgress?: (p: DownloadProgress) => void
): Promise<void> {
  if (!isNativeAndroid()) {
    throw new Error("APK install is only available in the Android app.");
  }

  const allowed = await ensureInstallPermission();
  if (!allowed) {
    throw new Error("Allow Kora to install updates, then try again.");
  }

  onProgress?.({ percent: 0 });

  const handle = await ApkInstall.addListener("apkDownloadProgress", (event) => {
    onProgress?.({
      percent: event.percent ?? 0,
      bytes: event.bytes,
      total: event.total,
    });
  });

  try {
    await ApkInstall.downloadAndInstall({
      url: release.apkUrl,
      fileName: release.apkName || `Kora-${release.versionName}.apk`,
    });
    onProgress?.({ percent: 100 });
  } finally {
    await handle.remove();
  }
}

/** Background check used on app launch / resume when auto-update is on. */
export async function maybeAutoCheckApkUpdate(options?: {
  minIntervalMs?: number;
  notify?: boolean;
}): Promise<ApkReleaseInfo | null> {
  if (!isNativeAndroid()) return null;
  if (!isApkAutoUpdateEnabled()) return null;
  if (isApkUpdateSnoozed()) return getCachedRemoteRelease();

  const minInterval = options?.minIntervalMs ?? 6 * 60 * 60 * 1000;
  const last = getLastApkCheckAt();
  if (last && Date.now() - last < minInterval) {
    return getCachedRemoteRelease();
  }

  try {
    const result = await checkForApkUpdate();
    if (result.update && options?.notify !== false) {
      void showNativeNotification({
        title: "Kora update ready",
        body: `Version ${result.update.versionName} is available. Tap Install in Settings or the update banner.`,
        id: 71001,
        extra: { type: "apk-update", version: result.update.versionName },
      });
      window.dispatchEvent(new CustomEvent("kora-apk-update", { detail: result.update }));
    }
    return result.update;
  } catch (err) {
    console.warn("[ApkUpdater] auto-check failed", err);
    return null;
  }
}

export async function getInstalledApkLabel(): Promise<string> {
  const info = await getLocalAppInfo();
  if (!info.version || info.version === "0") return "Kora (dev)";
  return `Kora ${info.version}`;
}
