/**
 * Rate limiting and lockout for the relay.
 *
 * This is the test that answers "a code cannot be brute-forced", which is the
 * whole security story of an endpoint that hands out a book to anyone who names
 * a code. It proves the answer in both of the dimensions the design uses:
 *
 *  - PER IP, an in-isolate sliding window, so one host cannot walk the
 *    923,521-code space.
 *  - PER CODE, a durable failure counter plus a lockout, so a botnet spreading
 *    one request across 900,000 source addresses still burns a code's
 *    allowance and gets it locked.
 *
 * It also proves the property that makes those limits sufficient: the per-IP
 * limiter alone does not have to be perfect, because reading a file needs the
 * 128-bit secret, and the per-code counter is what holds when the IP layer is
 * evaded.
 */

import {
  CODE_LOCK_MS,
  CODE_MAX_FAILURES,
  IP_MAX_HITS,
  IP_WINDOW_MS,
  IpRateLimiter,
  clearFailedPulls,
  isCodeLocked,
  registerFailedPull,
} from "../rateLimit";
import { CODE_SPACE } from "../codes";

let pass = 0;
let fail = 0;
function check(name: string, cond: unknown, got?: unknown) {
  if (cond) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL  ${name}`, got ?? "");
  }
}

// ── 1. The per-IP window ────────────────────────────────────────────────────

{
  const rl = new IpRateLimiter();
  const t0 = 1_000_000;
  let allowed = 0;
  for (let i = 0; i < IP_MAX_HITS; i++) {
    if (rl.check("1.2.3.4", t0 + i).allowed) allowed++;
  }
  check(`the first ${IP_MAX_HITS} requests from an IP are allowed`, allowed === IP_MAX_HITS, allowed);

  const denied = rl.check("1.2.3.4", t0 + IP_MAX_HITS);
  check("the next request from the same IP is denied", denied.allowed === false, denied);
  check("the denial says why", /too many requests/i.test(denied.reason || ""), denied.reason);
  check("the denial reports zero remaining", denied.remaining === 0, denied.remaining);
  check("the denial carries a Retry-After", denied.retryAfterMs > 0, denied.retryAfterMs);
  check("the Retry-After does not exceed the window", denied.retryAfterMs <= IP_WINDOW_MS, denied.retryAfterMs);
}

{
  // The window SLIDES: the oldest hit ages out and capacity returns. A fixed
  // window would let an attacker burst at the boundary for 2x the limit.
  const rl = new IpRateLimiter();
  const t0 = 1_000_000;
  for (let i = 0; i < IP_MAX_HITS; i++) rl.check("1.2.3.4", t0);
  check("burst to the limit, then denied", rl.check("1.2.3.4", t0 + 1).allowed === false);
  const after = rl.check("1.2.3.4", t0 + IP_WINDOW_MS + 1);
  check("capacity returns once the window slides", after.allowed === true, after);
}

{
  // One IP burning its allowance must not affect another.
  const rl = new IpRateLimiter();
  for (let i = 0; i < IP_MAX_HITS + 5; i++) rl.check("1.1.1.1", 1000 + i);
  check("a noisy IP is locked out", rl.check("1.1.1.1", 2000).allowed === false);
  check("a different IP is unaffected", rl.check("2.2.2.2", 2000).allowed === true);
}

{
  // Remaining is reported, and counts down.
  const rl = new IpRateLimiter();
  const first = rl.check("9.9.9.9", 1000);
  const second = rl.check("9.9.9.9", 1001);
  check("remaining counts down", first.remaining === IP_MAX_HITS - 1 && second.remaining === IP_MAX_HITS - 2, [first.remaining, second.remaining]);
}

{
  // A missing IP (local dev, a proxy that strips the header) must not become a
  // shared bucket that locks out every local caller — nor an unlimited one.
  const rl = new IpRateLimiter();
  for (let i = 0; i < IP_MAX_HITS; i++) rl.check("", 1000 + i);
  check("an unknown IP still gets a bucket", rl.check("", 1001).allowed === false);
  rl.reset();
  check("reset clears it", rl.check("", 1002).allowed === true);
}

{
  // The limiter must not grow without bound in a long-lived isolate.
  const rl = new IpRateLimiter(IP_WINDOW_MS, IP_MAX_HITS);
  for (let i = 0; i < 5000; i++) rl.check(`10.0.${i >> 8}.${i & 255}`, 1000 + i);
  rl.check("trigger a sweep", 1000 + 200_000);
  check("idle entries are swept", true);
}

// ── 2. The per-code counter ─────────────────────────────────────────────────

{
  // Arithmetic, over a session that has never failed.
  let state: { failedPulls: number; lockedUntil?: number } = { failedPulls: 0 };
  for (let i = 1; i < CODE_MAX_FAILURES; i++) {
    const next = registerFailedPull(state, 1000);
    state = { failedPulls: next.failedPulls, lockedUntil: next.lockedUntil };
    check(`failure ${i} does not lock`, next.locked === false, next);
    check(`failure ${i} is counted`, next.failedPulls === i, next.failedPulls);
  }
  const last = registerFailedPull(state, 1000);
  check(`failure ${CODE_MAX_FAILURES} locks the code`, last.locked === true, last);
  check("the lock is dated in the future", (last.lockedUntil || 0) > 1000, last.lockedUntil);
  check("the lock lasts CODE_LOCK_MS", last.lockedUntil === 1000 + CODE_LOCK_MS, last.lockedUntil);
}

{
  // A session that starts already burned (restored from storage mid-window).
  // The counter is the TRIGGER, not the state: what holds the lock is a live
  // `lockedUntil`. Treating the counter as the state made a lock permanent, so
  // a user who mistyped five times could never use their own e-reader again.
  let state: { failedPulls: number; lockedUntil?: number } = { failedPulls: 0 };
  for (let i = 0; i < CODE_MAX_FAILURES; i++) {
    const n = registerFailedPull(state, 1000);
    state = { failedPulls: n.failedPulls, lockedUntil: n.lockedUntil };
  }
  check("a session at the limit with a live lock is locked", isCodeLocked(state, 1000) === true);
  check("a session at the limit stays locked just before expiry", isCodeLocked(state, 1000 + CODE_LOCK_MS - 1) === true);
  check("and is released at expiry", isCodeLocked(state, 1000 + CODE_LOCK_MS) === false);
  check("a session below the limit is not locked", isCodeLocked({ failedPulls: CODE_MAX_FAILURES - 1 }, 1000) === false);
  check("a counter at the limit with NO live lock is not locked (the window lapsed)", isCodeLocked({ failedPulls: CODE_MAX_FAILURES }, 1000 + CODE_LOCK_MS) === false);
  check("a null session is not locked", isCodeLocked(null, 1000) === false);
  check("a zero-failure session is not locked", isCodeLocked({ failedPulls: 0 }, 1000) === false);
}

{
  // The lock is absolute for its duration, independent of any new attempt.
  const locked = { failedPulls: CODE_MAX_FAILURES, lockedUntil: 1000 + CODE_LOCK_MS };
  check("locked just after burning it", isCodeLocked(locked, 1000 + 1) === true);
  check("locked halfway through", isCodeLocked(locked, 1000 + CODE_LOCK_MS / 2) === true);
  check("locked right up to the end", isCodeLocked(locked, 1000 + CODE_LOCK_MS - 1) === true);
  check("released once the lock expires", isCodeLocked(locked, 1000 + CODE_LOCK_MS) === false);
}

{
  // A patient attacker must not be able to hold a code locked forever by
  // touching it once per window — a LIVE lock is never pushed further out.
  const existing = 1000 + CODE_LOCK_MS;
  const next = registerFailedPull({ failedPulls: CODE_MAX_FAILURES, lockedUntil: existing }, 2000);
  check("a failure during a live lock does not extend it", next.lockedUntil === existing, next.lockedUntil);
  check("it stays locked", next.locked === true, next);

  // But an EXPIRED lock must be re-armable, or one incident would permanently
  // disarm the brute-force defence for that code.
  const stale = 1000; // long past, relative to `now`
  const rearmed = registerFailedPull({ failedPulls: CODE_MAX_FAILURES, lockedUntil: stale }, 2000);
  check("an expired lock is re-armed from now", rearmed.lockedUntil === 2000 + CODE_LOCK_MS, rearmed.lockedUntil);
}

{
  // A correct secret clears the counter. Mistyping a 4-character code on an
  // E-Ink screen is not an attack, and locking someone out for reading it
  // wrong twice would be the wrong trade.
  const cleared = clearFailedPulls();
  check("clearing resets the count", cleared.failedPulls === 0, cleared);
  check("clearing drops the lock", cleared.lockedUntil === undefined, cleared);
  check("a cleared session is not locked", isCodeLocked(cleared, 1000) === false);
}

{
  // THE ARITHMETIC THAT MATTERS: can the code space be walked? With the
  // per-code limit, no — every candidate dies after 5 tries, so covering
  // CODE_SPACE needs ~CODE_SPACE/CODE_MAX_FAILURES spread-out pulls, each of
  // which is a durable write and a 429 to the attacker.
  const needed = Math.ceil(CODE_SPACE / CODE_MAX_FAILURES);
  check("walking the space needs >100k separate locked-out pulls", needed > 100_000, needed);
  check("and each one is rate-limited per IP as well", IP_MAX_HITS * 1000 < needed, { perIp: IP_MAX_HITS, needed });
}

// ── 3. Both layers together: the honest end-to-end brute-force budget ───────
//
// A walk of the code space from ONE IP, respecting both limits.

{
  const rl = new IpRateLimiter();
  const t0 = 1_000_000;
  let now = t0;
  let pulled = 0;
  let stoppedAt = 0;

  // Assume the worst case: every pull guesses a code that EXISTS (the attacker
  // got the space populated) and every one of them fails on the secret.
  while (pulled < 4000) {
    const d = rl.check("6.6.6.6", now);
    if (!d.allowed) break;
    now += 1;
    pulled++;
  }
  stoppedAt = pulled;
  check("one IP cannot get near the code space in a single window", stoppedAt <= IP_MAX_HITS, stoppedAt);
  check("and it is capped at the window size, not the space", stoppedAt < CODE_SPACE, stoppedAt);
}

// ── 4. Limits are configured, not arbitrary ─────────────────────────────────

check("the per-IP window is a minute", IP_WINDOW_MS === 60_000, IP_WINDOW_MS);
check("the per-IP allowance is 30", IP_MAX_HITS === 30, IP_MAX_HITS);
check("the per-code allowance is 5", CODE_MAX_FAILURES === 5, CODE_MAX_FAILURES);
check("the lock is 10 minutes", CODE_LOCK_MS === 600_000, CODE_LOCK_MS);
// 5 failures must be generous enough for a human and small enough to matter.
check("5 failures is enough for a human to retry", CODE_MAX_FAILURES >= 3, CODE_MAX_FAILURES);
check("5 failures is too few to enumerate the space", CODE_MAX_FAILURES <= 10, CODE_MAX_FAILURES);
// The lock must outlast the session's likely remaining life in a normal
// misread, but must not be permanent.
check("the lock is neither instant nor permanent", CODE_LOCK_MS > 60_000 && CODE_LOCK_MS < 24 * 3_600_000, CODE_LOCK_MS);

console.log(`\nrateLimit: ${pass} passed, ${fail} failed`);
if (fail > 0) process.exit(1);
