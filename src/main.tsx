import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import * as Sentry from "@sentry/react";
import App from "./App.tsx";
import "./index.css";
import { initAndroidGestureNavigation } from "./lib/androidGestures";
import { initIosTouchGuards } from "./lib/iosPwa";
import { APP_BUILD_ID, fetchRemoteVersion, isNewerBuild } from "./lib/appVersion";
import { initCapacitorShell, isNativeApp } from "./lib/capacitorNative";
import { installNativeHttpShim, isNativeHttpAvailable } from "./lib/nativeHttp";
import { initSentry } from "./lib/sentry";
import { logger } from "./lib/logger";
import { Bug } from "lucide-react";

// Initialize Sentry as early as possible so boot-time errors are captured.
initSentry();

/**
 * Did this crash come from a dynamically imported chunk that would not load?
 *
 * Vite fingerprints each lazy chunk (`BookReaderEPUB-CxGeMh_t.js`). If the
 * page was open across a deploy, the old filename 404s and the import
 * throws "Failed to fetch dynamically imported module". `resetError` cannot
 * recover from that — React re-renders the same broken `import()` promise —
 * so the only real remedy is a reload that picks up the new index.
 */
function isChunkLoadError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? `${error.message} ${(error as Error & { cause?: unknown }).cause ?? ""}`
      : String(error);
  // The browser's wording for this has grown over the years and differs by
  // engine, so match the family rather than one string. A bare "Failed to fetch"
  // is included deliberately: for a stale hashed chunk that IS the error, and
  // excluding it left the user with a dead "Reload" button and no explanation.
  // The reason it is safe to be broad here is that the only consequence is
  // offering a reload, and a reload is harmless when the bundle was fine.
  return /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|Unable to preload CSS|ChunkLoadError|Failed to fetch|Loading chunk \d+ failed|error loading chunk/i.test(
    message
  );
}

initAndroidGestureNavigation();
initIosTouchGuards();

// Install native HTTP bridge synchronously before React mounts so that the
// first feed/news fetch doesn't race with the async initCapacitorShell import.
// The native bridge routes /api/* through HttpURLConnection to bypass the
// Android WebView localhost→external-origin exception.
if (isNativeApp() && isNativeHttpAvailable()) {
  installNativeHttpShim();
}

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
      onError={(error, componentStack, eventId) => {
        // @sentry/react types this as (error, componentStack: string,
        // eventId: string) — NOT React's (error, ErrorInfo). An earlier
        // attempt read `info.componentStack`, which does not exist here.
        // The boundary renders a generic message, so without this handler a
        // crash is invisible: "keep crashing randomly" with nothing to act on.
        // Sentry captures it when a DSN is configured, and console keeps it
        // either way so the shipped diagnostic log names the component.
        console.error("[crash] root boundary caught:", error, componentStack, eventId);
        logger.error("[crash] root boundary caught", {
          message: String((error as Error)?.message || error),
          stack: String((error as Error)?.stack || "").slice(0, 2000),
          componentStack: String(componentStack ?? "").slice(0, 2000),
          eventId: String(eventId ?? ""),
        });
      }}
      fallback={({ resetError, error }) => (
        <div className="min-h-screen bg-kindle-bg text-kindle-text flex flex-col items-center justify-center p-4">
          <h1 className="text-xl font-bold mb-2">Something went wrong</h1>
          <p className="text-sm text-kindle-text-muted mb-4">
            {/* Do not promise a report that was never sent. A build without
                VITE_SENTRY_DSN has Sentry inert, and telling the user we
                received their error is worse than saying nothing. */}
            {import.meta.env.VITE_SENTRY_DSN
              ? "Kora encountered an unexpected error. A report has been sent to the team."
              : "Kora encountered an unexpected error. This build has error reporting turned off."}
          </p>
          {/* A lazily-loaded chunk that fails to import is almost always a
              stale page: the app was open across a deploy, so the hashed
              filename it asked for no longer exists. Reloading once fetches
              the new index and the new chunk. Without this the reader is a
              dead end and the only option is a manual refresh. */}
          {isChunkLoadError(error) && (
            <p className="text-xs text-kindle-text-muted mb-4 max-w-sm text-center">
              A part of the app did not load. Reloading usually fixes this.
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={() => (isChunkLoadError(error) ? window.location.reload() : resetError())}
              className="px-4 py-2 bg-kindle-accent text-white rounded-xl text-sm font-bold"
            >
              Reload
            </button>
            <button
              onClick={() => {
                const build = typeof __KORA_BUILD_ID__ !== "undefined" ? __KORA_BUILD_ID__ : "dev";
                window.open(
                  `https://github.com/CHAOTIC-RAY/Kora-/issues/new?title=Report%20a%20bug%20(v${build})&body=Kora%20build%20ID%3A%20${build}%0A%0A%E2%96%B2%20What%20happened%3F%0A%0A%E2%96%B2%20Steps%20to%20reproduce%0A%0A%E2%96%B2%20Expected%20behavior%0A%0A%E2%96%B2%20Actual%20behavior%0A%0A%E2%96%B2%20Device%20%2F%20OS%20%2F%20browser`,
                  "_blank",
                  "noopener,noreferrer"
                );
              }}
              className="flex items-center gap-1.5 px-3 py-2 border border-kindle-border rounded-xl text-sm font-bold text-kindle-text hover:bg-kindle-card transition-colors"
            >
              <Bug className="w-4 h-4 text-kindle-accent" />
              Report a bug
            </button>
          </div>
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
