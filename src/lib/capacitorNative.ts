/**
 * Capacitor / Android runtime helpers.
 * Provides API base rewriting, native permission requests, notifications,
 * and filesystem access when running inside the Kora APK.
 */

import { Capacitor } from "@capacitor/core";

export function isNativeAndroid(): boolean {
  try {
    return Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";
  } catch {
    return false;
  }
}

export function isNativeApp(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/** Production Worker / API origin for Capacitor builds (no trailing slash). */
export function getApiBaseUrl(): string {
  const fromEnv = (import.meta.env.VITE_API_BASE_URL || "").trim().replace(/\/$/, "");
  if (fromEnv) return fromEnv;
  // Fallback: relative paths (web / PWA)
  return "";
}

/** Prefix relative /api paths when the SPA is bundled inside the APK. */
export function resolveApiUrl(input: string): string {
  if (!input) return input;
  const base = getApiBaseUrl();
  if (!base) return input;
  if (input.startsWith("/api/") || input === "/api") {
    return `${base}${input}`;
  }
  // Absolute same-origin API style used in some places
  try {
    const u = new URL(input, typeof window !== "undefined" ? window.location.origin : "https://localhost");
    if (u.pathname.startsWith("/api/")) {
      return `${base}${u.pathname}${u.search}${u.hash}`;
    }
  } catch {
    /* ignore */
  }
  return input;
}

/**
 * Patch global fetch so relative /api/* calls reach the Cloudflare Worker
 * when the app is running from Capacitor's local https://localhost origin.
 */
export function installCapacitorApiFetchShim(): void {
  if (typeof window === "undefined") return;
  if (!isNativeApp()) return;
  const base = getApiBaseUrl();
  if (!base) {
    console.warn("[Kora/Capacitor] VITE_API_BASE_URL is empty — /api calls may fail offline.");
    return;
  }

  const originalFetch = window.fetch.bind(window);
  window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
    try {
      if (typeof input === "string") {
        return originalFetch(resolveApiUrl(input), init);
      }
      if (input instanceof URL) {
        return originalFetch(resolveApiUrl(input.toString()), init);
      }
      if (input instanceof Request) {
        const nextUrl = resolveApiUrl(input.url);
        if (nextUrl !== input.url) {
          return originalFetch(new Request(nextUrl, input), init);
        }
      }
    } catch (err) {
      console.warn("[Kora/Capacitor] fetch shim error", err);
    }
    return originalFetch(input as RequestInfo, init);
  }) as typeof fetch;

  console.info("[Kora/Capacitor] API base →", base);
}

/** Request Android permissions needed by Kora (storage, notifications, mic for narrator). */
export async function requestKoraNativePermissions(): Promise<void> {
  if (!isNativeAndroid()) return;

  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    const notif = await LocalNotifications.checkPermissions();
    if (notif.display !== "granted") {
      await LocalNotifications.requestPermissions();
    }
  } catch (err) {
    console.warn("[Kora/Capacitor] notification permission", err);
  }

  // Web Notification API (progress / brief) — also request when available
  try {
    if (typeof Notification !== "undefined" && Notification.permission === "default") {
      await Notification.requestPermission();
    }
  } catch {
    /* ignore */
  }

  // Microphone for future voice features / Web Speech (narrator is TTS-out, but keep access ready)
  try {
    if (navigator.mediaDevices?.getUserMedia) {
      // Soft-probe: don't actually open mic on launch — only ensure permission entry exists via Settings
    }
  } catch {
    /* ignore */
  }
}

/** Schedule / show a local notification (download progress, daily brief). */
export async function showNativeNotification(opts: {
  title: string;
  body: string;
  id?: number;
  extra?: Record<string, unknown>;
}): Promise<void> {
  if (!isNativeAndroid()) {
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification(opts.title, { body: opts.body });
      }
    } catch {
      /* ignore */
    }
    return;
  }

  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.schedule({
      notifications: [
        {
          id: opts.id ?? Math.floor(Date.now() % 1_000_000_000),
          title: opts.title,
          body: opts.body,
          schedule: { at: new Date(Date.now() + 250) },
          extra: opts.extra,
          channelId: "kora_default",
        },
      ],
    });
  } catch (err) {
    console.warn("[Kora/Capacitor] showNativeNotification", err);
  }
}

/** Ensure notification channel exists (Android 8+). */
export async function ensureNotificationChannel(): Promise<void> {
  if (!isNativeAndroid()) return;
  try {
    const { LocalNotifications } = await import("@capacitor/local-notifications");
    await LocalNotifications.createChannel({
      id: "kora_default",
      name: "Kora",
      description: "Downloads, reading reminders, and daily news briefs",
      importance: 5,
      visibility: 1,
      sound: "default",
      vibration: true,
      lights: true,
    });
    await LocalNotifications.createChannel({
      id: "kora_downloads",
      name: "Downloads",
      description: "Book and audiobook download progress",
      importance: 4,
      visibility: 1,
      vibration: false,
    });
  } catch (err) {
    console.warn("[Kora/Capacitor] notification channel", err);
  }
}

/** Init Capacitor shell: status bar, splash, permissions, fetch shim. */
export async function initCapacitorShell(): Promise<void> {
  if (!isNativeApp()) return;

  installCapacitorApiFetchShim();

  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setBackgroundColor({ color: "#18181B" });
  } catch {
    /* ignore */
  }

  // Mirror dark chrome on the system navigation bar (gesture indicator strip).
  // Capacitor has no NavigationBar plugin here — use the CSS/env insets +
  // MainActivity Java theme. Also ensure the WebView document fills the bar area.
  try {
    document.documentElement.style.backgroundColor = "#18181B";
    if (document.body) document.body.style.backgroundColor = "#18181B";
  } catch {
    /* ignore */
  }

  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    await SplashScreen.hide();
  } catch {
    /* ignore */
  }

  try {
    const { App } = await import("@capacitor/app");
    App.addListener("backButton", ({ canGoBack }) => {
      if (canGoBack) {
        window.history.back();
      } else {
        // Let Android gesture nav / existing back-layer stack handle exit
        window.dispatchEvent(new CustomEvent("kora-android-back"));
      }
    });
  } catch {
    /* ignore */
  }

  await ensureNotificationChannel();
  // Defer permission prompts slightly so first paint isn't blocked
  window.setTimeout(() => {
    void requestKoraNativePermissions();
  }, 1200);
}
