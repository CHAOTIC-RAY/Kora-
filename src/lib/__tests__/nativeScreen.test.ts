/**
 * Screen-control tests.
 *
 * The load-bearing claim: every one of these is safe to call on a platform
 * that cannot honour it, and cleanup is idempotent. A reader that throws on
 * mount because the device has no wake lock is a reader nobody can open.
 *
 * Node has no `document`/`navigator.wakeLock`, which is precisely the
 * worst-case environment these need to survive, so the tests run with a
 * minimal DOM rather than a real one.
 */
import {
  applyBrightness,
  clearBrightness,
  brightnessSupport,
  keepAwakeSupported,
  setKeepAwake,
  releaseKeepAwake,
  isKeepAwakeActive,
  createSleepTimer,
  FILTER_ID_FOR_TEST,
} from "../nativeScreen";

let passed = 0;
let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) passed++;
  else {
    failed++;
    console.log(`FAIL  ${name}\n        expected ${expected}, got ${actual}`);
  }
}

// ── A DOM just real enough ─────────────────────────────────────────────────
class FakeStyle {
  props = new Map<string, string>();
  filter = "";
  setProperty(k: string, v: string) { this.props.set(k, v); }
  removeProperty(k: string) { this.props.delete(k); }
}
const body = { style: new FakeStyle() as any };
(globalThis as any).document = {
  body,
  visibilityState: "visible",
  addEventListener() {},
  removeEventListener() {},
};

// ── Brightness: must never throw, must clamp, must be reversible ───────────
check("apply to null element is safe", (() => { applyBrightness(null, 0.5); return true; })(), true);

applyBrightness(body as any, 0.5);
check("filter applied", body.style.filter, "brightness(0.5)");
check("custom property set", body.style.props.get(`--${FILTER_ID_FOR_TEST}`), "0.5");

applyBrightness(body as any, 1);
check("full brightness clears the filter", body.style.filter, "");

applyBrightness(body as any, 0);
check("below-minimum clamped", body.style.filter, "brightness(0.2)");
applyBrightness(body as any, 5);
check("above-maximum clamped", body.style.filter, "");
applyBrightness(body as any, NaN);
check("NaN falls back to 1 (no filter)", body.style.filter, "");
applyBrightness(body as any, undefined as any);
check("undefined falls back to 1 (no filter)", body.style.filter, "");

applyBrightness(body as any, 0.4);
clearBrightness(body as any);
check("clear removes the filter", body.style.filter, "");
check("clear removes the custom property", body.style.props.has(`--${FILTER_ID_FOR_TEST}`), false);
check("clear on null is safe", (() => { clearBrightness(null); return true; })(), true);
check("double clear is safe", (() => { clearBrightness(body as any); return true; })(), true);

// ── Support probes must not throw on a bare platform ────────────────────────
const support = brightnessSupport();
check("brightness support is a known value", ["none", "filter", "native"].includes(support), true);
check("keepAwake reports false with no navigator.wakeLock", keepAwakeSupported(), false);

// ── Keep-awake without the API must be a quiet no-op ───────────────────────
const result = await setKeepAwake(true);
check("setKeepAwake resolves false when unsupported", result, false);
check("not active", isKeepAwakeActive(), false);
await releaseKeepAwake();
await releaseKeepAwake();
check("repeat release is safe", true, true);

// ── Keep-awake WITH the API: the revoke-on-hide path ───────────────────────
// Node 26 defines `navigator` as a getter-only global, so it cannot be
// assigned. Redefine it as a configurable property instead — a plain
// assignment throws "Cannot set property navigator".
let requestCount = 0;
let listeners: Record<string, () => void> = {};
let released = false;
const fakeSentinel = {
  get released() { return released; },
  release: async () => { released = true; },
  addEventListener: (t: string, fn: () => void) => { listeners[t] = fn; },
  removeEventListener: (t: string) => { delete listeners[t]; },
};
Object.defineProperty(globalThis, "navigator", {
  configurable: true,
  writable: true,
  value: {
    wakeLock: {
      request: async () => { requestCount++; return fakeSentinel; },
    },
  },
});
check("support detected once API exists", keepAwakeSupported(), true);

const acquired = await setKeepAwake(true);
check("acquired", acquired, true);
check("active after acquire", isKeepAwakeActive(), true);
check("release listener attached", typeof listeners.release, "function");

// Re-requesting while held must not stack locks.
await setKeepAwake(true);
check("second acquire is a no-op", requestCount, 1);

// The browser revokes on tab-hide; the reader must notice and not claim
// it is still awake.
released = true;
listeners.release?.();
check("revoke clears active state", isKeepAwakeActive(), false);

await releaseKeepAwake();
check("release after revoke is safe", true, true);

console.log(`\nnativeScreen: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
