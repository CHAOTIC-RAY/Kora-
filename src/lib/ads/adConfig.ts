/**
 * Display banner configuration (build-time via VITE_*).
 * Defaults keep ads off with no publisher keys baked into the bundle.
 */

import { isNativeApp } from "../capacitorNative";

export type AdProvider = "adsterra" | "placeholder" | "custom";
export type DesktopBannerSize = "728x90" | "468x60";

export interface AdBannerRuntimeConfig {
  enabled: boolean;
  provider: AdProvider;
  mobileZoneKey: string;
  desktopZoneKey: string;
  desktopSize: DesktopBannerSize;
  scriptOrigin: string;
  allowOnNative: boolean;
  cspExtraOrigins: string[];
}

function readViteEnv(key: keyof ImportMetaEnv): string | undefined {
  try {
    return import.meta.env?.[key];
  } catch {
    return undefined;
  }
}

function truthy(v: string | undefined): boolean {
  return (v || "").trim().toLowerCase() === "true" || (v || "").trim() === "1";
}

function parseProvider(raw: string | undefined): AdProvider {
  const p = (raw || "adsterra").trim().toLowerCase();
  if (p === "placeholder" || p === "adsterra" || p === "custom") return p;
  return "adsterra";
}

function parseDesktopSize(raw: string | undefined): DesktopBannerSize {
  return (raw || "").trim() === "468x60" ? "468x60" : "728x90";
}

function parseCspExtras(raw: string | undefined): string[] {
  return (raw || "")
    .split(/[,;\s]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Resolved config from Vite env (empty keys when disabled). */
export function resolveAdBannerConfig(): AdBannerRuntimeConfig {
  const enabled = truthy(readViteEnv("VITE_ADS_ENABLED"));
  return {
    enabled,
    provider: parseProvider(readViteEnv("VITE_ADS_PROVIDER")),
    mobileZoneKey: (readViteEnv("VITE_ADS_ZONE_MOBILE") || "").trim(),
    desktopZoneKey: (readViteEnv("VITE_ADS_ZONE_DESKTOP") || "").trim(),
    desktopSize: parseDesktopSize(readViteEnv("VITE_ADS_DESKTOP_SIZE")),
    scriptOrigin: (readViteEnv("VITE_ADS_SCRIPT_ORIGIN") || "https://www.highperformanceformat.com").replace(/\/$/, ""),
    allowOnNative: truthy(readViteEnv("VITE_ADS_ALLOW_NATIVE")),
    cspExtraOrigins: parseCspExtras(readViteEnv("VITE_ADS_CSP_EXTRA")),
  };
}

export type AdViewport = "mobile" | "desktop";

/** Fixed slot size (avoids layout shift). */
export function adSlotDimensions(viewport: AdViewport, desktopSize: DesktopBannerSize): { width: number; height: number } {
  if (viewport === "mobile") return { width: 320, height: 50 };
  if (desktopSize === "468x60") return { width: 468, height: 60 };
  return { width: 728, height: 90 };
}

/** Whether a banner may render for this placement (native shell gated separately). */
export function shouldShowAdBanner(
  config: AdBannerRuntimeConfig,
  opts: { nativeApp?: boolean } = {},
): boolean {
  if (!config.enabled) return false;
  const native = opts.nativeApp ?? false;
  if (native && !config.allowOnNative) return false;
  if (config.provider === "placeholder") return true;
  return Boolean(config.mobileZoneKey || config.desktopZoneKey);
}

/** Zone key for the active viewport. */
export function resolveZoneKeyForViewport(config: AdBannerRuntimeConfig, viewport: AdViewport): string {
  if (config.provider === "placeholder") return "placeholder";
  return viewport === "mobile" ? config.mobileZoneKey : config.desktopZoneKey;
}

/** SSR-safe native check for tests. */
export function isNativeAppForAds(): boolean {
  try {
    return isNativeApp();
  } catch {
    return false;
  }
}
