/**
 * Sentry initialization for Kora.
 *
 * Initialized as early as possible in the app lifecycle (called from src/main.tsx
 * before React renders) so errors during boot — including the service-worker
 * registration and PWA version probe — are captured.
 *
 * The DSN is read from VITE_SENTRY_DSN at build time so it can be overridden
 * per-environment; we fall back to the production DSN from the Sentry project.
 */
import * as Sentry from "@sentry/react";

export function initSentry() {
  // Avoid double-init during HMR / StrictMode dev double-render.
  if ((window as { __sentryInitialized?: boolean }).__sentryInitialized) return;
  (window as { __sentryInitialized?: boolean }).__sentryInitialized = true;

  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn) {
    // No Sentry DSN configured for this build (e.g. a fresh checkout or an
    // APK/web build that didn't pass VITE_SENTRY_DSN at build time). Skip
    // Sentry entirely rather than calling Sentry.init with a placeholder DSN,
    // which would log "Invalid Sentry Dsn" on every load.
    return;
  }

  Sentry.init({
    dsn:
      import.meta.env.VITE_SENTRY_DSN ||
      "https://448617...7f6c@o4511839938150400.ingest.de.sentry.io/4511839944376400",

    integrations: [
      Sentry.browserTracingIntegration(),
      Sentry.replayIntegration(),
      Sentry.feedbackIntegration({
        colorScheme: "system",
      }),
    ],

    // Tracing — capture 100% of transactions in dev, 10% in production
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,

    // Only propagate tracing for local dev and the Kora API origin
    tracePropagationTargets: [
      "localhost",
      "127.0.0.1",
      /^https:\/\/.*\.workers\.dev\/api\//,
      /^https:\/\/kora\.chaoticstudio\.workers\.dev\/api\//,
    ],

    // Session Replay — 10% of sessions, 100% of sessions with errors
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    // Suppress AbortError / Firestore assertion events at the event level so they
    // never reach Sentry even if they slip past ignoreErrors (e.g. non-standard shapes).
    // Also tags releases with the build ID so Sentry issues can be correlated.
    beforeSend(event) {
      const msg = event.exception?.values?.[0]?.value;
      if (msg && (
        msg.includes("AbortError") ||
        msg.includes("signal is aborted without reason") ||
        // Firestore assertion failures are handled by logger.ts recovery; suppress noise.
        (msg.includes("FIRESTORE") && msg.includes("INTERNAL ASSERTION FAILED")) ||
        msg.includes("Attempt to iterate a cursor that doesn't exist") ||
        msg.includes("The database is not running a version change transaction") ||
        msg.includes("The database connection is closing") ||
        msg.includes("Database deleted by request of the user")
      )) {
        return null;
      }
      event.tags = {
        ...(event.tags || {}),
        buildId: typeof __KORA_BUILD_ID__ !== "undefined" ? __KORA_BUILD_ID__ : undefined,
        appChannel: import.meta.env.VITE_APP_CHANNEL || "production",
      };
      return event;
    },

    // Don't capture console noise from known dev-only warnings.
    // Strings are substring-matched; RegExp objects are tested with .test().
    ignoreErrors: [
      "Network Error",
      "Failed to execute 'insertBefore' on 'Node'",
      "ResizeObserver loop limit exceeded",
      // Firestore SDK internal assertion failures (12.15.0) — known bug triggered by
      // rapid tab switching / app backgrounding / network interruption mid-write.
      // The global unhandledrejection handler in logger.ts will reinit Firestore on these.
      /FIRESTORE.*INTERNAL ASSERTION FAILED/,
      "Attempt to iterate a cursor that doesn't exist",
      // IndexedDB lifecycle noise — handled by indexedDB.ts guards
      "The database is not running a version change transaction",
      "The database connection is closing",
      "Database deleted by request of the user",
      // Benign AbortError from Firestore stream cancellation (nav, reconnect)
      "AbortError",
      "signal is aborted without reason",
    ],
  });
}
