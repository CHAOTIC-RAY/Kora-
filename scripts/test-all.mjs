#!/usr/bin/env node
/**
 * Run every suite in the project and fail on ANY non-zero pass/fail.
 *
 * This exists because of a specific, repeated failure mode in this repo: the
 * suite emits two different summary formats —
 *
 *     src/lib/__tests__/foo.test.ts  ::  34 pass, 0 fail      <- the "pass, fail" style
 *     koboKindleSender: 150 passed, 0 failed                    <- the "passed, failed" style
 *
 * and a runner that greps only one of them reads a silent all-clear off a run
 * where half the files never reported at all. That is worse than a red build:
 * it is a green build that proves nothing. So this parses BOTH, and — the
 * part that actually matters — it fails when a suite prints no summary line
 * whatsoever, because a suite that did not report has not passed.
 */
// This file has a .mjs extension, so it is an ES module: `require` is not
// defined here. Using it threw `ReferenceError: require is not defined`
// on line 17 before the runner executed anything, so the script exited 1
// while printing only the unrelated "stdin is not a tty" noise from tsx.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// __dirname does not exist in ES modules either.
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.resolve(__dirname, "..");

function walk(dir, out = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (/\.test\.(ts|tsx|mts)$/.test(e.name)) out.push(full);
  }
  return out;
}

// Write the report from inside the process. Piping stdout to tee/from a
// background process loses it in this environment, and a runner whose report
// can vanish is exactly the runner whose silence has been read as a pass.
const LOG = path.join(ROOT, "..", "cache", "scratch", "test-all-report.txt");
const lines = [];
const say = (l) => { lines.push(l); console.log(l); };

const files = [
  ...walk(path.join(ROOT, "src")),
  ...walk(path.join(ROOT, "scripts")),
].sort();

// `npx` with shell:true fails under MSYS ("stdin is not a tty"), so call the
// tsx binary directly with node. Same runner, no shell, no npx resolution.
const TSX = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const run = (file) =>
  new Promise((resolve) => {
    const p = spawn(process.execPath, [TSX, file], { cwd: ROOT });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (out += d));
    p.on("close", (code) => resolve({ file, code, out }));
  });

(async () => {
  let totalPass = 0;
  let totalFail = 0;
  const broken = [];
  const failed = [];

  for (const file of files) {
    const { code, out } = await run(file);
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");

    // BOTH formats, deliberately.
    const m =
      /(\d+)\s+pass(?:ed)?\s*,\s*(\d+)\s+fail(?:ed)?/i.exec(out) ||
      /(\d+)\s+pass\s*;\s*(\d+)\s+fail/i.exec(out);

    if (!m) {
      broken.push(rel);
      say(`NO-SUMMARY  ${rel}  (exit ${code})`);
      continue;
    }
    const pass = Number(m[1]);
    const fail = Number(m[2]);
    totalPass += pass;
    totalFail += fail;
    if (fail > 0 || code !== 0) failed.push(rel);
    say(`${String(pass).padStart(5)} ${fail === 0 ? "ok  " : "FAIL"} ${String(fail).padStart(3)} fail   ${rel}`);
  }

  say(`\nfiles=${files.length}  ${totalPass} pass, ${totalFail} fail`);
  if (failed.length) say(`FAILED SUITES:\n  ${failed.join("\n  ")}`);
  if (broken.length) say(`NO SUMMARY REPORTED (not a pass):\n  ${broken.join("\n  ")}`);
  const red = failed.length || broken.length || totalFail > 0;
  say(`\nRESULT: ${red ? "RED" : "GREEN"}`);
  try { fs.writeFileSync(LOG, lines.join("\n"), "utf8"); } catch {}
  process.exit(red ? 1 : 0);
})();