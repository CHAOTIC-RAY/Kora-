/**
 * Is the signed-URL race reliable, or intermittently empty?
 *
 * The regression this guards: every host is raced at once, so one hanging mirror
 * burns the shared budget and the whole race fails intermittently — the caller
 * then falls back to a bare "search Rave" link, which is the dead end the re-mint
 * exists to prevent. A single passing call proves nothing about a race.
 */
import { resolveLibgenSigned } from "../src/lib/libgenSigned";

const MD5 = "99c7a862d2df4ffd872bb51da21b4fba";
const RUNS = 6;

const results: { ms: number; ok: boolean }[] = [];
for (let i = 0; i < RUNS; i++) {
  const t = Date.now();
  const signed = await resolveLibgenSigned(MD5);
  results.push({ ms: Date.now() - t, ok: Boolean(signed) });
}

const passed = results.filter((r) => r.ok).length;
const times = results.map((r) => r.ms);

console.log(`resolveLibgenSigned x${RUNS}`);
for (const [i, r] of results.entries()) {
  console.log(`  run ${i + 1}: ${r.ok ? "OK   " : "EMPTY"} ${r.ms}ms`);
}
console.log(`\n${passed}/${RUNS} resolved`);

let failures = 0;
if (passed < RUNS) {
  failures++;
  console.log(`FAIL  intermittent: ${RUNS - passed} call(s) returned empty`);
} else {
  console.log("PASS  every call resolved");
}

// A healthy mirror answers well inside the budget; a hang would show as a
// multi-second outlier that eventually resolves, so flag anything unreasonable.
const slowest = Math.max(...times);
if (slowest > 20000) {
  failures++;
  console.log(`FAIL  slowest call ${slowest}ms — a mirror is likely hanging again`);
} else {
  console.log(`PASS  slowest call ${slowest}ms is within budget`);
}

process.exit(failures === 0 ? 0 : 1);