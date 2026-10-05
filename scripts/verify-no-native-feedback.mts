/**
 * The floating Sentry "Report a bug" button must never render in the APK.
 *
 * Reported twice: "apk is still showing the sentry report bug icon", and again
 * after an earlier fix. That fix only REPOSITIONED the button on native — it
 * never stopped the widget being created. `feedbackIntegration` injects its host
 * element during `Sentry.init`, so:
 *
 *   - the actor renders before any of our code can react, and
 *   - page stylesheet rules cannot hide it, because it lives inside a shadow root
 *     that CSS cannot select into.
 *
 * The only correct fix is to not create the integration on native at all.
 * `isNativeApp()` already exists in src/lib/capacitorNative.ts.
 */
import fs from "node:fs";

const FILE = "src/lib/sentry.ts";
const src = fs.readFileSync(FILE, "utf-8");

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

console.log("=== native detection is used ===");
check(
  "imports isNativeApp from capacitorNative",
  /import\s*\{\s*isNativeApp\s*\}\s*from\s*["']\.\/capacitorNative["']/.test(src),
  "src/lib/capacitorNative.ts"
);
check(
  "isNativeApp is actually CALLED",
  /isNativeApp\(\)/.test(src),
  "not just imported"
);

console.log("\n=== the widget is not created on native ===");
check(
  "the feedback integration is behind a condition",
  !/^\s*Sentry\.feedbackIntegration\(/m.test(src),
  "no unconditional call"
);
check(
  "the gate inverts the native check",
  /const showFeedbackWidget\s*=\s*!isNativeApp\(\)/.test(src),
  "showFeedbackWidget = !isNativeApp()"
);
check(
  "the integration is spread conditionally",
  /showFeedbackWidget\s*\?\s*\[Sentry\.feedbackIntegration/.test(src),
  "...(showFeedbackWidget ? [feedbackIntegration()] : [])"
);

console.log("\n=== crash reporting survives the change ===");
// The button is cosmetic; error capture must still work in the APK.
check(
  "Sentry.init still called unconditionally",
  /Sentry\.init\(\{/.test(src),
  "native crashes still reported"
);
check(
  "browserTracingIntegration kept",
  /browserTracingIntegration\(\)/.test(src)
);
check(
  "replayIntegration kept",
  /replayIntegration\(\)/.test(src)
);

console.log("\n=== no wasted work on native ===");
check(
  "the placement observer is skipped when there is no widget",
  /if\s*\(showFeedbackWidget\)\s*installFeedbackWidgetPlacer\(\)/.test(src),
  "no body-wide MutationObserver for a host that never exists"
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);