/**
 * The Firestore SDK must appear exactly ONCE in the client bundle.
 *
 * Diagnostic logs (2026-10-04/05) were flooded, every ~5s, with an UNCAUGHT:
 *
 *   @firebase/firestore: Firestore (12.15.0) INTERNAL ASSERTION FAILED:
 *   Unexpected state (ID: b815) CONTEXT: {"el":"TypeError: n.tc.get is not a
 *   function or its return value is not iterable ... enqueueRetryable ...
 *
 * That assertion is the SDK's private-component registry rejecting a component
 * it does not own — the signature of two SDK instances sharing one Firebase app.
 * Nothing in src/ imports `firebase/compat` or `@firebase/firestore-compat`; it
 * arrives transitively through `@capacitor-firebase/authentication`.
 *
 * Fixed by dropping the compat build (a legacy shim over the same v8 API that no
 * app code touches) and deduping the shared Firebase packages in vite.config.
 *
 * COUNTING CORRECTLY — the trap that made this check lie at first:
 * grepping for "INTERNAL ASSERTION FAILED" returns 5 hits in a CORRECT build.
 * Those are string references (formatting the message, re-matching it in error
 * text, an ignore-list regex), not five SDK copies. Only counting the assert
 * helper's *definition* measures the real thing, so that is what this does.
 */
import fs from "node:fs";
import path from "node:path";

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

const distDir = path.resolve("dist/assets");
if (!fs.existsSync(distDir)) {
  console.error("  dist/assets not found — run the production build first.");
  process.exit(1);
}

const bundles = fs
  .readdirSync(distDir)
  .filter((f) => f.endsWith(".js"))
  .map((f) => path.join(distDir, f));

// The big entry chunk is where the SDK lands.
const target = bundles
  .map((f) => ({ f, size: fs.statSync(f).size }))
  .sort((a, b) => b.size - a.size)[0];
const src = fs.readFileSync(target.f, "utf8");

console.log(`=== ${target.f} (${(target.size / 1024).toFixed(0)} KB) ===\n`);

console.log("=== the SDK is bundled once ===");
// The assert helper's definition — mangled name, so match the template literal
// that can only appear where the helper is DEFINED.
const defs = (src.match(/function [A-Za-z0-9_$]+\(t,e,n\)\{let [A-Za-z0-9_$]+=`FIRESTORE/g) || []).length;
check(
  "exactly one Firestore assert-helper definition",
  defs === 1,
  `${defs} definition(s) — 1 is correct`
);

console.log("\n=== the compat shim is not bundled ===");
const compatRefs = (src.match(/getFirestoreCompat/g) || []).length;
check("no firestore-compat entry point", compatRefs === 0, `${compatRefs} reference(s)`);

console.log("\n=== vite config still protects against regression ===");
const cfg = fs.readFileSync("vite.config.ts", "utf8");
check(
  "resolve.dedupe lists the shared Firebase packages",
  /dedupe:\s*\[/.test(cfg) && cfg.includes("'@firebase/firestore'"),
  "dedupe present"
);
check(
  "the compat build is stripped at build time",
  /@firebase\/firestore-compat/.test(cfg) && /export \{\}/.test(cfg),
  "filter plugin present"
);

console.log("\n=== the misleading string-count is documented ===");
const scriptPath = "scripts/verify-single-firestore.mts";
const self = fs.existsSync(scriptPath) ? fs.readFileSync(scriptPath, "utf8") : "";
check(
  "this script explains why a raw grep is not a copy count",
  /COUNTING CORRECTLY/.test(self),
  "trap is written down"
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);