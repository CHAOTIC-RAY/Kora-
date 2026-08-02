import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App.tsx";
import "./index.css";
import { initAndroidGestureNavigation } from "./lib/androidGestures";
import { initIosTouchGuards } from "./lib/iosPwa";
import { APP_BUILD_ID, fetchRemoteVersion, isNewerBuild } from "./lib/appVersion";
import { initCapacitorShell, isNativeApp } from "./lib/capacitorNative";
import { initSentry } from "./lib/sentry";

// Initialize Sentry as early as possible so boot-time errors are captured.
initSentry();

initAndroidGestureNavigation();
initIosTouchGuards();
void initCapacitorShell();

// Apply Performance Mode immediately if the user enabled it previously,
// so nothing animates before Settings mounts.
try {
  if (localStorage.getItem("kora_performance_mode") === "true") {
    document.documentElement.classList.add("perf-mode");
  }
} catch {}

// Register the service worker that keeps downloads alive in the background
// and shows progress notifications. Updates are detected by PwaLifecycleBanner
// which prompts (and can auto-apply) a reload — avoid blind reload loops here.
// Capacitor Android already has native offline/IndexedDB; still register SW when supported.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register("/sw.js", { updateViaCache: "none" })
      .then((reg) => {
        const ping = () => {
          void reg.update().catch(() => {});
        };
        ping();
        document.addEventListener("visibilitychange", () => {
          if (document.visibilityState === "visible") ping();
        });
      })
      .catch((err) => {
        console.warn("[SW] registration failed:", err);
      });

    // Skip auto-reload probe inside the APK (version.json is bundled).
    if (isNativeApp()) return;

    // Early version probe — if deploy landed while this tab was open/cached,
    // kick a reload before the React tree mounts deeply. Guarded against loops.
    void fetchRemoteVersion().then((remote) => {
      if (!isNewerBuild(remote)) return;
      const last = Number(sessionStorage.getItem("kora_pwa_last_reload_at") || 0);
      if (Date.now() - last < 12_000) return;
      sessionStorage.setItem("kora_pwa_last_reload_at", String(Date.now()));
      console.info("[PWA] New build detected on load", remote?.buildId, "local", APP_BUILD_ID);
      window.location.reload();
    });
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Sentry.ErrorBoundary
      fallback={({ resetError }) => (
        <div className="min-h-screen bg-kindle-bg text-kindle-text flex flex-col items-center justify-center p-4">
          <h1 className="text-xl font-bold mb-2">Something went wrong</h1>
          <p className="text-sm text-kindle-text-muted mb-4">
            Kora encountered an unexpected error. A report has been sent to the team.
          </p>
          <button
            onClick={resetError}
            className="px-4 py-2 bg-kindle-accent text-white rounded-xl text-sm font-bold"
          >
            Reload
          </button>
        </div>
      )}
      beforeCapture={(error) => {
        // Tag the error with build context for Sentry issue grouping
        Sentry.withScope((scope) => {
          scope.setTag("kora_build", typeof __KORA_BUILD_ID__ !== "undefined" ? __KORA_BUILD_ID__ : "dev");
        });
        return error;
      }}
    >
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>,
);
