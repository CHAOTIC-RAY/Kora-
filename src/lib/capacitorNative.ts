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
  // Capacitor APK must never fall back to relative /api (that hits https://localhost).
  if (isNativeApp()) return "https://kora.chaoticstudio.workers.dev";
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
}

/**
 * Provision Kora storage according to the user's chosen mode:
 *  - "virtual" (old way): nothing to pick; the app uses its internal virtual
 *    directory. No SAF picker, so no SAF-related crash surface.
 *  - "saf" (new way): open the folder picker only if no folder is stored yet.
 * Callers (App.tsx) must resolve the first-run choice before calling this.
 */
export async function provisionKoraStorage(): Promise<void> {
  if (!isNativeAndroid()) return;
  try {
    const { getKoraStorageMode, hasKoraFolder, pickKoraFolder, requestBatteryExemption } =
      await import("./koraStorage");
    const mode = await getKoraStorageMode();
    if (mode !== "virtual" && !(await hasKoraFolder())) {
      await pickKoraFolder();
    }
    await requestBatteryExemption();
  } catch (err) {
    console.warn("[Kora/Capacitor] storage provisioning", err);
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

  // Route /api/* requests through the native HTTP bridge to bypass Android
  // WebView's localhost→external-origin exception (Chromium 128+). The native
  // bridge uses HttpURLConnection, not the WebView, so CORS/origin policies do
  // not block the requests. When the native plugin is unavailable (or fails to
  // install), fall back to the URL-rewriting shim below.
  let nativeHttpInstalled = false;
  try {
    const { installNativeHttpShim, isNativeHttpAvailable } = await import("./nativeHttp");
    if (isNativeHttpAvailable()) {
      installNativeHttpShim();
      nativeHttpInstalled = true;
    }
  } catch (err) {
    console.warn("[Kora/Capacitor] native HTTP shim install failed", err);
  }

  // Fallback URL-rewriting shim: rewrites relative /api/* to the absolute
  // worker origin. Only installed when the native bridge is unavailable, to
  // avoid wrapping fetch twice (the native shim already rewrites /api URLs).
  if (!nativeHttpInstalled) {
    installCapacitorApiFetchShim();
  }

  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    // Keep the WebView below the system status bar (don't draw behind it),
    // so the notification/clock strip never overlaps app content.
    await StatusBar.setOverlaysWebView({ overlay: false });
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

  // Prime Android native TTS (and WebView speech as fallback) early.
  try {
    const { primeSpeechVoices, usesNativeTts } = await import("./ttsSettings");
    if (usesNativeTts()) {
      const { refreshNativeVoices } = await import("./koraTts");
      await refreshNativeVoices();
    }
    primeSpeechVoices();
    window.setTimeout(() => primeSpeechVoices(), 500);
    window.setTimeout(() => primeSpeechVoices(), 1500);
  } catch {
    /* ignore */
  }

  // Re-prime voices on first user gesture (required on some WebViews).
  try {
    const once = () => {
      void import("./ttsSettings").then(({ primeSpeechVoices }) => primeSpeechVoices());
      window.removeEventListener("pointerdown", once);
      window.removeEventListener("touchstart", once);
    };
    window.addEventListener("pointerdown", once, { once: true, passive: true });
    window.addEventListener("touchstart", once, { once: true, passive: true });
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
    const { popTopAndroidBackLayer, getAndroidBackStackDepth } = await import("./androidGestures");
    App.addListener("backButton", () => {
      // Drive the in-app back stack first (closes the top modal/sheet).
      if (popTopAndroidBackLayer()) return;
      // Nothing stacked: ask the app shell whether it can go back (e.g. switch
      // tab / close reader). If not, exit the app gracefully.
      const evt = new CustomEvent("kora-android-back");
      window.dispatchEvent(evt);
      // As a final fallback, let Android handle exit if nothing consumed it.
      window.setTimeout(() => {
        if (getAndroidBackStackDepth() === 0) {
          try { App.exitApp(); } catch { /* ignore */ }
        }
      }, 0);
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
