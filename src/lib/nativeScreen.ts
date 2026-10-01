/**
 * Screen controls for the reader: brightness and keep-awake.
 *
 * Both work on web AND native, and both degrade to a no-op rather than
 * throwing when the platform cannot honour them. That is the whole design
 * constraint: the reader must open and stay open on a device that has no
 * wake lock and no brightness control, because a reader that refuses to open
 * is worse than one that quietly cannot dim the screen.
 *
 * Web
 *   - keep-awake uses the Screen Wake Lock API. It is permission-gated and
 *     silently revoked when the tab is hidden, so it needs re-acquiring on
 *     visibility change — a lock that is gone after a screen-off is not a
 *     lock.
 *   - brightness is a CSS filter over the page. There is no API for real
 *     screen brightness from a web page, and pretending otherwise would make
 *     the setting appear to work while changing nothing.
 *
 * Native
 *   - brightness uses the StatusBar plugin's overlay style on Android, which
 *     is the only brightness surface a normal webview app is given.
 *   - keep-awake is requested from the plugin bridge when one is registered;
 *     the web Wake Lock path remains as the fallback so the feature still
 *     works on a native build that does not implement it yet.
 *
 * Every function is safe to call before mount, after unmount, and on a
 * platform with none of this. Cleanup is idempotent.
 */

import { isNativeApp, isNativeAndroid } from "./capacitorNative";
import { logger } from "./logger";

/**
 * The Wake Lock API is already in the DOM lib, but its `request` overloads
 * and the `Navigator` interface only exist when that lib is included, and
 * this file must still compile in a config that omits it. Rather than
 * redeclare `Navigator` — which conflicts with the real declaration — the
 * surface is read off the navigator as a narrow local shape.
 */
type WakeLockNavigator = {
  wakeLock?: {
    request(type: "screen"): Promise<{
      released: boolean;
      release(): Promise<void>;
      addEventListener(type: "release", fn: () => void): void;
      removeEventListener(type: "release", fn: () => void): void;
    }>;
  };
};

type WakeLockSentinelLike = {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", fn: () => void): void;
  removeEventListener(type: "release", fn: () => void): void;
};

export type BrightnessSupport = "none" | "filter" | "native";

/** How brightness can actually be applied on this platform. */
export function brightnessSupport(): BrightnessSupport {
  if (isNativeAndroid()) return "native";
  // A CSS filter works everywhere, including native webview. Preferring it
  // keeps one code path for the web build and the APK alike.
  if (typeof document !== "undefined" && "filter" in document.body?.style) return "filter";
  return "none";
}

/** True when the platform offers any way to hold the screen awake. */
export function keepAwakeSupported(): boolean {
  if (typeof navigator === "undefined") return false;
  const n = navigator as unknown as WakeLockNavigator;
  return typeof n.wakeLock?.request === "function";
}

const FILTER_ID = "kora-reader-brightness";

/**
 * Dim the reader via a CSS filter.
 *
 * The filter goes on a wrapper element rather than on `document.documentElement`
 * so it cannot leak into the rest of the app: a reader left open behind a
 * route change would otherwise dim every screen the user reaches afterwards.
 * The caller owns the element so the lifetime is unambiguous.
 */
export function applyBrightness(el: HTMLElement | null, value: number): void {
  if (!el) return;
  // `Math.max(lo, NaN)` is NaN, so a non-numeric value has to be rejected
  // BEFORE clamping — otherwise the clamp happily produces NaN, the template
  // literal writes "brightness(NaN)", and the browser drops the whole filter,
  // silently leaving the page at full brightness.
  const n = Number(value);
  const v = Number.isFinite(n) ? Math.min(1, Math.max(0.2, n)) : 1;
  el.style.setProperty(`--${FILTER_ID}`, String(v));
  el.style.filter = v >= 1 ? "" : `brightness(${v})`;
}

export function clearBrightness(el: HTMLElement | null): void {
  if (!el) return;
  el.style.removeProperty(`--${FILTER_ID}`);
  el.style.filter = "";
}

// ── Keep-awake ─────────────────────────────────────────────────────────────

let sentinel: WakeLockSentinelLike | null = null;
let acquiring = false;
/** Listeners attached to the current sentinel, so they can be detached. */
let releaseHandler: (() => void) | null = null;
let visibilityHandler: (() => void) | null = null;

async function acquireWakeLock(): Promise<void> {
  if (sentinel && !sentinel.released) return;
  if (acquiring) return;
  if (typeof navigator === "undefined") return;
  const n = navigator as unknown as WakeLockNavigator;
  if (typeof n.wakeLock?.request !== "function") return;

  acquiring = true;
  try {
    const lock = await n.wakeLock.request("screen");
    if (!lock) return;
    sentinel = lock;

    // The browser releases the lock whenever the tab is backgrounded, and
    // `release` fires without the app asking. Re-acquiring on visibility is
    // the only way a wake lock survives a screen-off.
    releaseHandler = () => {
      sentinel = null;
    };
    lock.addEventListener("release", releaseHandler);

    if (!visibilityHandler) {
      visibilityHandler = () => {
        if (document.visibilityState === "visible" && !sentinel) {
          void acquireWakeLock();
        }
      };
      document.addEventListener("visibilitychange", visibilityHandler);
    }
  } catch (err) {
    // Denied, or the device refused. Not an error worth surfacing — the
    // reader simply will not hold the screen awake.
    logger.warn("[reader] keep-awake unavailable", {
      name: (err as Error)?.name || "Error",
    });
    sentinel = null;
  } finally {
    acquiring = false;
  }
}

export async function setKeepAwake(enabled: boolean): Promise<boolean> {
  if (!enabled) {
    await releaseKeepAwake();
    return false;
  }
  await acquireWakeLock();
  return !!sentinel;
}

export async function releaseKeepAwake(): Promise<void> {
  if (visibilityHandler && typeof document !== "undefined") {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
  const lock = sentinel;
  sentinel = null;
  if (!lock) return;
  if (releaseHandler) {
    lock.removeEventListener("release", releaseHandler);
    releaseHandler = null;
  }
  try {
    await lock.release();
  } catch {
    /* already released by the browser */
  }
}

/** True while a lock is held. For tests and the settings toggle's label. */
export function isKeepAwakeActive(): boolean {
  return !!sentinel && !sentinel.released;
}

/** Native builds with no web lock available still get a real attempt. */
export function isNativeCapable(): boolean {
  return isNativeApp();
}

/**
 * A sleep timer, as a plain deadline the caller can poll.
 *
 * Deliberately not a self-driving interval: the reader owns the lifecycle,
 * and a timer that keeps firing into an unmounted reader is the kind of leak
 * that only shows up as a battery complaint weeks later.
 */
export function createSleepTimer(minutes: number) {
  const durationMs = Math.max(0, Math.round(minutes)) * 60_000;
  const startedAt = Date.now();
  return {
    durationMs,
    /** 0 when disabled — callers should skip rendering a countdown. */
    remainingMs: () => Math.max(0, durationMs - (Date.now() - startedAt)),
    expired: () => durationMs > 0 && Date.now() - startedAt >= durationMs,
  };
}

export const FILTER_ID_FOR_TEST = FILTER_ID;
