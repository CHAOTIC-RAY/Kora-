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

  Sentry.init({
    dsn:
      import.meta.env.VITE_SENTRY_DSN ||
      "https://448617ca76507b39cdf227cd0aec7f6c@o4511839938150400.ingest.de.sentry.io/4511839944376400",

    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],

    // Tracing — capture 100% of transactions in dev, 10% in production
    tracesSampleRate: import.meta.env.PROD ? 0.1 : 1.0,

    // Only propagate tracing for local dev and the Kora API origin
    tracePropagationTargets: [
      "localhost",
      "127.0.0.1",
      /^https:\/\/.*\.workers\.dev\/api/,
      /^https:\/\/kora\.chaoticstudio\.workers\.dev\/api/,
    ],

    // Session Replay — 10% of sessions, 100% of sessions with errors
    replaysSessionSampleRate: 0.1,
    replaysOnErrorSampleRate: 1.0,

    // Tag releases with the build ID so Sentry issues can be correlated
    // to a specific Kora deployment.
    beforeSend(event) {
      event.tags = {
        ...(event.tags || {}),
        buildId: typeof __KORA_BUILD_ID__ !== "undefined" ? __KORA_BUILD_ID__ : undefined,
        appChannel: import.meta.env.VITE_APP_CHANNEL || "production",
      };
      return event;
    },

    // Don't capture console noise from known dev-only warnings
    ignoreErrors: [
      "Network Error",
      "Failed to execute 'insertBefore' on 'Node'",
      "ResizeObserver loop limit exceeded",
    ],
  });
}
