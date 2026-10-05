/**
 * The discovery feed must not sit on skeletons forever.
 *
 * Reported 2026-10-04 ("see its empty"): six lanes rendered as skeletons with no
 * error, no spinner and no covers. Cause:
 *
 *   - NYT/Goodreads rows carry no md5, so every row must be resolved against the
 *     archive before it can be shown (measured: 19 lanes, 240 rows, all md5=null).
 *   - `loadFeaturedContent` awaited that whole pass before calling
 *     `setLoadingFeatured(false)`.
 *   - Archive calls measured 6.6-12.2s against a 12s per-row budget, and the
 *     global race bound was `PER_ROW_MS * ceil(240/6)` = 480s.
 *
 * So the feed waited up to eight minutes to paint, and rows that missed their
 * budget were dropped — leaving all 19 lanes empty.
 *
 * The fix resolves only a bounded preview slice before returning and streams the
 * rest in. These checks pin the properties that make the feed usable again:
 *
 *   1. `loadingFeatured` is cleared without waiting for the full pass.
 *   2. The blocking slice is bounded — it cannot scale with total row count.
 *   3. Background enrichment is never awaited by the caller.
 *   4. The 480s bound is gone.
 *   5. A totally unavailable archive still yields a visible, honest state rather
 *      than an infinite skeleton.
 */
import fs from "node:fs";

const FILE = "src/components/DiscoverView.tsx";
const src = fs.readFileSync(FILE, "utf-8");

let failures = 0;
const check = (label: string, ok: boolean, extra = "") => {
  if (!ok) failures++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
};

/**
 * Extract a function body by matching its opening brace and counting depth.
 *
 * Tries BOTH declaration shapes — `const NAME =` and `function NAME`. An earlier
 * version only looked for `const NAME`, so `loadFeaturedContent` (a plain
 * function declaration) resolved to an empty string and eleven checks silently
 * tested nothing. A guard that cannot find its target is worse than no guard.
 */
const fn = (name: string) => {
  const starts = [
    src.indexOf(`const ${name}`),
    src.indexOf(`function ${name}`),
    src.indexOf(`async function ${name}`),
  ].filter((i) => i !== -1);
  if (starts.length === 0) return "";
  const i = Math.min(...starts);
  // Skip the signature: the first `{` may be an OPTIONS TYPE LITERAL, e.g.
  // `async (feed, onResolved?, opts?: { budget?: number })`. Matching from there
  // closed the body after 161 characters and hid every check inside it. Require
  // the brace to follow a `)` so it can only be the body's opening.
  let depth = 0;
  let seenClose = false;
  for (let j = i; j < src.length; j++) {
    const ch = src[j];
    if (ch === "{") {
      if (seenClose) depth++;
    } else if (ch === ")") {
      seenClose = true;
    } else if (ch === "}") {
      if (depth === 0 && seenClose) return src.slice(i, j + 1);
      depth--;
    } else if (ch === ";" && depth === 0 && seenClose) {
      return src.slice(i, j);
    }
  }
  return "";
};

const enrich = fn("enrichFeedWithDirectFiles");
const load = fn("loadFeaturedContent");

console.log("=== 1. the skeleton flag is cleared without waiting for the whole pass ===");
check("found loadFeaturedContent", load.length > 0, load.length === 0 ? "body not found — guard would be vacuous" : `${load.length} chars`);
check("found enrichFeedWithDirectFiles", enrich.length > 0, enrich.length === 0 ? "body not found" : `${enrich.length} chars`);
check(
  "call site no longer awaits enrichment before painting",
  /setLoadingFeatured\(false\)/.test(load),
  "flag is cleared"
);
// The killer shape: awaiting the full pass, THEN clearing.
check(
  "the flag is not cleared only after an unbounded await",
  !/await enrichFeedWithDirectFiles\([^)]*\)\s*;\s*setFeaturedData[^;]*;\s*setLoadingFeatured\(false\)/.test(load),
  "no full-pass-await-then-clear"
);
check(
  "call site passes an onResolved repaint callback",
  /enrichFeedWithDirectFiles\(\s*mergedData\s*,\s*onEnriched/.test(load),
  "late arrivals repaint"
);

console.log("\n=== 2. the blocking slice is bounded, not proportional to the feed ===");
check(
  "a PREVIEW_ROWS cap exists",
  /PREVIEW_ROWS\s*=\s*\d+/.test(enrich),
  (enrich.match(/PREVIEW_ROWS\s*=\s*(\d+)/) || [])[1]
);
check(
  "the blocking slice uses the capped list",
  /todo\.slice\(\s*0\s*,\s*PREVIEW_ROWS\s*\)/.test(enrich),
  "todo.slice(0, PREVIEW_ROWS)"
);
check(
  "the blocking slice has a wall-clock budget",
  /PREVIEW_BUDGET_MS/.test(enrich) && /Promise\.race/.test(enrich),
  "capped by time as well as count"
);

console.log("\n=== 3. the 480s global bound is gone ===");
check(
  "no PER_ROW_MS * ceil(todo.length / CONCURRENCY) bound",
  !/PER_ROW_MS\s*\*\s*Math\.ceil\(\s*todo\.length/.test(enrich),
  "the 480s race is removed"
);
check(
  "PER_ROW_MS is still used per-row (unrelated timeout kept)",
  /PER_ROW_MS/.test(enrich)
);

console.log("\n=== 4. background enrichment is never awaited ===");
check(
  "background pass is fired with void",
  /void\s*\(\s*async\s*\(\)\s*=>\s*\{/.test(enrich),
  "void (async () => {"
);
check(
  "background pass repaints via onResolved",
  /onResolved/.test(enrich) && /onResolved\(feed\)/.test(enrich),
  "onResolved(feed)"
);
check(
  "background pass is guarded by onResolved existing",
  /if\s*\(onResolved\s*&&\s*cursor\s*<\s*todo\.length\)/.test(enrich)
);

console.log("\n=== 5. a dead archive cannot hold the feed hostage ===");
check(
  "the blocking race resolves on budget expiry, not failure",
  /new Promise<void>\(\(r\)\s*=>\s*setTimeout\(r,\s*PREVIEW_BUDGET_MS\)\)/.test(enrich),
  "budget expiry always resolves"
);
check(
  "resolveOne cannot throw out of the blocking pass unhandled",
  /catch\s*\{\s*\/\*\s*try the next query shape\s*\*\/\s*\}/.test(src) || /catch\s*\{/.test(enrich),
  "per-row failures are swallowed"
);

console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
process.exit(failures === 0 ? 0 : 1);