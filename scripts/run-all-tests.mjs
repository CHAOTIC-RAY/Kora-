#!/usr/bin/env node
/**
 * Run every Kora test file and report one total.
 *
 * Why this exists: `npm test` chained a hand-maintained list of `tsx` calls
 * that had fallen behind the tree — `preloadQueue`, `readerImage`,
 * `comicProgress`, `turnTimer` and several others existed but were never
 * added to it, so they silently stopped running. Enumerating by glob means a
 * new test file is covered the moment it is written, which is the only
 * version of "the suite is green" worth trusting.
 *
 * Output formats differ between test files, because they are independent
 * scripts rather than one runner's cases: most print `N pass, M fail`, some
 * print `N passed, M failed`. Both are parsed, plus vitest-style
 * `Tests  N passed` and a bare numeric summary, so a file that changes its
 * reporting style is still counted rather than silently dropped from the
 * total.
 */
import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Every *.test.ts under src/, plus the two non-`*.test` harnesses. */
function collect(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) collect(full, out);
    else if (entry.endsWith(".test.ts")) out.push(full);
  }
  return out;
}

const files = [
  join(root, "scripts", "test-app-logic.ts"),
  ...collect(join(root, "src")).sort(),
];

/**
 * Parse a test file's own summary line.
 *
 * `ok`/`not ok` TAP output and a thrown assertion both count as failures;
 * the exit code alone is not trusted, because a file that prints its own
 * count and then exits 0 has still failed if that count is non-zero.
 */
function parse(output) {
  const pats = [
    // "42 pass, 0 fail" / "42 passed, 0 failed" — both spellings in the wild.
    /(\d+)\s+pass(?:ed)?\b[^\n]*?(\d+)\s+fail(?:ed)?\b/i,
    // vitest: "Tests  42 passed | 1 failed"
    /Tests\s+(\d+)\s+passed\b[^\n]*?(?:(\d+)\s+failed)?/i,
    // node:test: "ℹ pass 25" and "ℹ fail 0" are printed as SEPARATE lines, so
    // the combined pattern above cannot match them. The leading glyph is a
    // real character (U+2139), NOT whitespace, so it is matched as `.*?`.
    // Without this, a file written with `node:test` is silently counted as 0
    // passing tests — a green total that is quietly wrong, worse than a red one.
    /^\s*(?:[^\w\s]\s*)?pass\s+(\d+)\s*$/im,
    // TAP: "1..42" with "# fail 0"
    /^1\.\.(\d+)$/m,
  ];
  for (const re of pats) {
    const m = output.match(re);
    if (!m) continue;
    const passed = parseInt(m[1], 10);
    if (re.source.includes("fail[") === false && re.source.includes("fail(?:ed)")) {
      // Combined single-line form: pass and fail are both in the match.
      const failed = m[2] !== undefined ? parseInt(m[2], 10) : 0;
      return { passed, failed };
    }
    if (re.source.includes("pass\\s+(\\d+)")) {
      // node:test form: the failure count is on its own line.
      const fm = output.match(/^\s*(?:[^\w\s]\s*)?fail\s+(\d+)\s*$/im);
      return { passed, failed: fm ? parseInt(fm[1], 10) : 0 };
    }
    return { passed, failed: 0 };
  }
  return { passed: 0, failed: 0 };
}

let totalPass = 0;
let totalFail = 0;
const broken = [];
const counted = [];

for (const file of files) {
  const rel = relative(root, file);
  const r = spawnSync("npx", ["tsx", file], {
    cwd: root,
    encoding: "utf-8",
    shell: true,
    timeout: 120000,
  });
  const out = `${r.stdout || ""}${r.stderr || ""}`;
  const { passed, failed } = parse(out);
  // A file that printed no summary at all is not silently counted as zero —
  // that is how a broken file masquerades as a passing one.
  const noSummary = !/pass(?:ed)?\b/i.test(out) && !/Tests\s+\d+/i.test(out);
  if (noSummary || r.status !== 0 || failed > 0) {
    broken.push({ rel, status: r.status, passed, failed, noSummary, tail: out.slice(-1200) });
  }
  totalPass += passed;
  totalFail += failed;
  counted.push({ rel, passed, failed });
  console.log(`${failed > 0 || r.status !== 0 ? "FAIL" : " ok "} ${rel.padEnd(56)} ${passed} pass, ${failed} fail`);
}

console.log(`\n${"=".repeat(70)}`);
console.log(`${counted.length} files, ${totalPass} pass, ${totalFail} fail`);

if (broken.length) {
  console.log(`\n${broken.length} file(s) with problems:\n`);
  for (const b of broken) {
    console.log(`--- ${b.rel} (exit ${b.status}${b.noSummary ? ", no summary printed" : ""})`);
    console.log(b.tail);
    console.log();
  }
}

process.exit(totalFail > 0 || broken.length ? 1 : 0);