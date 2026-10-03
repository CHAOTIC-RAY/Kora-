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
import "./sentryFeedback.css";

export function initSentry() {
  // Avoid double-init during HMR / StrictMode dev double-render.
  if ((window as { __sentryInitialized?: boolean }).__sentryInitialized) return;
  (window as { __sentryInitialized?: boolean }).__sentryInitialized = true;

  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || !/^https:\/\/[a-zA-Z0-9]+@[a-zA-Z0-9.-]+\/\d+$/.test(dsn)) {
    console.warn(
      "[sentry] VITE_SENTRY_DSN is not set or is invalid — error reporting is DISABLED for " +
        "this build. Pass a valid DSN at build time to enable it."
    );
    return;
  }

  Sentry.init({
    dsn,

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

  installFeedbackWidgetPlacer();
}

/* ─────────────────────────────────────────────────────────────────────
 * Feedback widget placement
 *
 * The actor button lives inside the widget's shadow root, so page CSS cannot
 * select it. Custom properties inherit through the shadow boundary, and the
 * static half of the styling lives in `sentryFeedback.css`. What CSS cannot do
 * is know how tall the floating app chrome currently is.
 *
 * Both prior attempts hardcoded `--kora-mobile-nav-offset` into the inset.
 * That is wrong in two ways that are both visible:
 *
 *   - The floating footer nav is `md:hidden`. On desktop the offset still
 *     applies, so the button hovers ~96px up with nothing underneath it,
 *     reading as detached from the corner it is supposed to sit in.
 *   - `.kora-mobile-media-dock` (the audiobook mini player / Continue dock)
 *     sits ABOVE that offset. Lifting by the nav offset alone drops the button
 *     straight into the dock.
 *
 * So measure instead. For each piece of chrome that is actually rendered, take
 * its distance from the viewport bottom and clear the highest one. Elements
 * that are `display:none` (the footer on desktop) report a zero rect and are
 * skipped, which handles the responsive case for free — no media query, and no
 * assumption about which breakpoint hides what.
 * ───────────────────────────────────────────────────────────────────── */

const FEEDBACK_HOST_ID = "sentry-feedback";

/** Bottom-anchored app chrome the button must not overlap. */
const FEEDBACK_OBSTRUCTIONS = [
  ".kora-mobile-footer",
  ".kora-mobile-media-dock",
  ".kora-audiobook-mini",
  ".kora-mobile-fab",
];

/** Gap between the button and whatever it is lifted above. */
const FEEDBACK_CLEARANCE = 12;

/** Resolve a `--kora-safe-*` custom property (defined on `:root`) to px. */
function readSafeInset(name: string): number {
  const raw = getComputedStyle(document.documentElement)
    .getPropertyValue(name)
    .trim();
  if (!raw) return 0;
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : 0;
}

/**
 * The actor's own resolved bottom margin, in px.
 *
 * Read from the element rather than from `--page-margin`, because
 * `getPropertyValue` on a custom property hands back the specified token
 * (`0.75rem`) — parseFloat would read that as 0.75px. Returns 0 when the
 * shadow root or actor is not there yet, which is harmless: the first pass
 * just uses the un-lifted inset.
 */
function readActorMargin(): number {
  const actor = document
    .getElementById(FEEDBACK_HOST_ID)
    ?.shadowRoot?.querySelector<HTMLElement>(".widget__actor");
  if (!actor) return 0;
  const m = parseFloat(getComputedStyle(actor).marginBottom);
  return Number.isFinite(m) ? m : 0;
}

function placeFeedbackWidget() {
  const host = document.getElementById(FEEDBACK_HOST_ID);
  if (!host) return;

  const viewportH = window.innerHeight;
  let lift = 0;

  for (const selector of FEEDBACK_OBSTRUCTIONS) {
    for (const el of Array.from(document.querySelectorAll(selector))) {
      const rect = el.getBoundingClientRect();
      // `display:none` collapses to a zero rect; ignoring those is what makes
      // the desktop case fall back to a plain corner offset.
      if (rect.width === 0 || rect.height === 0) continue;
      lift = Math.max(lift, viewportH - rect.top);
    }
  }

  // `.widget__actor` sets `margin: var(--page-margin)` *and* `inset:`, and both
  // apply, so the distance from the viewport edge is margin + inset. The inset
  // therefore subtracts the margin to land the button at exactly `lift +
  // clearance`.
  //
  // The margin is read off the actor's own computed style, NOT off
  // `--page-margin` on the host: `getPropertyValue` returns the *specified*
  // token (`0.75rem`), and parseFloat on that silently yields 0.75 — read as
  // 0.75px instead of 12px. Reading the resolved `marginBottom` sidesteps the
  // unit problem and stays correct if the token changes.
  const margin = readActorMargin();

  const safeBottom = readSafeInset("--kora-safe-bottom");
  const safeRight = readSafeInset("--kora-safe-right");

  // No chrome in the way: sit at the corner, clear of the home indicator.
  const targetBottom = lift > 0 ? lift + FEEDBACK_CLEARANCE : safeBottom;
  const bottom = Math.max(0, Math.round(targetBottom - margin));
  const right = Math.max(0, Math.round(safeRight));

  const style = host.style;
  if (style.getPropertyValue("--kora-feedback-bottom") !== `${bottom}px`) {
    style.setProperty("--kora-feedback-bottom", `${bottom}px`);
  }
  if (style.getPropertyValue("--kora-feedback-right") !== `${right}px`) {
    style.setProperty("--kora-feedback-right", `${right}px`);
  }
}

/**
 * Keep the widget positioned against the real chrome.
 *
 * The widget host is injected by Sentry during `init`, but the app chrome that
 * has to be cleared mounts with React and changes as the user moves around
 * (dock appears, audio starts, tab switches). So re-measure on resize and on
 * DOM churn, coalesced into one rAF so a burst of mutations costs one pass.
 */
function installFeedbackWidgetPlacer() {
  let frame = 0;

  const schedule = () => {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0;
      placeFeedbackWidget();
    });
  };

  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
  // Android WebView reports soft-keyboard / inset changes here.
  window.visualViewport?.addEventListener("resize", schedule);

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["class", "style"],
  });

  schedule();
}
