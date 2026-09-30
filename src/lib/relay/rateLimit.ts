/**
 * Rate limiting for the relay's UNAUTHENTICATED endpoints.
 *
 * The threat, stated plainly: `GET /api/relay/pull?code=XXXX` hands out a book
 * to anyone who can name a code, and there are 31^4 = 923,521 of them. Left
 * alone that is a free file store for anyone willing to run a 900k-request
 * loop. So guessing has to be expensive, and it has to be expensive in two
 * independent directions:
 *
 *  1. PER IP — a sliding window, so one host cannot enumerate the space.
 *  2. PER CODE — a failure counter persisted with the session, so a botnet
 *     spreading one request across 900,000 source addresses still burns
 *     through a code's allowance and gets it locked.
 *
 * Per-IP state is in-isolate and therefore best-effort (true of every
 * rate limit that is not a KV write; a determined attacker with many PoPs
 * exceeds it). Per-code state is stored with the session, so it is durable and
 * shared. The design does not depend on the per-IP layer for correctness: a
 * successful brute force still needs the 128-bit `secret` held by the
 * e-reader page, and every failed pull increments the code's counter.
 *
 * LOCKOUT IS DELIBERATE AND IT IS THE POINT. When a code burns its allowance
 * it is locked until the session would have expired anyway. The victim is the
 * person who mistypes their own code 10 times, and they fix it by opening the
 * e-reader page again — which is one tap, and does not touch their book.
 * Failing open instead would mean the 4-character code is the only thing
 * standing between a stranger and someone's library.
 */

export interface RateLimitDecision {
  allowed: boolean;
  /** Attempts left in this window. For the caller's own diagnostics only. */
  remaining: number;
  /** Milliseconds until the next attempt would be allowed. */
  retryAfterMs: number;
  reason?: string;
}

interface WindowEntry {
  /** Timestamps (ms) of hits inside the window. */
  hits: number[];
}

/** Per-IP sliding window: 30 requests / 60s. */
export const IP_WINDOW_MS = 60_000;
export const IP_MAX_HITS = 30;

/**
 * Failed pulls tolerated per code before it is locked.
 *
 * 5 is generous for a human who is reading a 4-character code off an e-ink
 * screen and typing it, and small enough that 923,521 candidates cannot be
 * walked through one code at a time before the lock.
 */
export const CODE_MAX_FAILURES = 5;

/** How long a burned code stays locked. */
export const CODE_LOCK_MS = 10 * 60 * 1000;

export class IpRateLimiter {
  private byIp = new Map<string, WindowEntry>();
  private lastSweep = 0;

  constructor(
    private windowMs: number = IP_WINDOW_MS,
    private maxHits: number = IP_MAX_HITS
  ) {}

  check(ip: string, now: number = Date.now()): RateLimitDecision {
    this.sweep(now);
    const key = ip || "unknown";
    const entry = this.byIp.get(key) || { hits: [] };
    entry.hits = entry.hits.filter((t) => now - t < this.windowMs);

    if (entry.hits.length >= this.maxHits) {
      const oldest = entry.hits[0];
      this.byIp.set(key, entry);
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, this.windowMs - (now - oldest)),
        reason: "too many requests from this address",
      };
    }
    entry.hits.push(now);
    this.byIp.set(key, entry);
    return { allowed: true, remaining: this.maxHits - entry.hits.length, retryAfterMs: 0 };
  }

  reset(ip?: string): void {
    if (ip === undefined) this.byIp.clear();
    else this.byIp.delete(ip);
  }

  /** Drop idle entries so a long-lived isolate does not grow without bound. */
  private sweep(now: number): void {
    if (now - this.lastSweep < this.windowMs) return;
    this.lastSweep = now;
    for (const [key, entry] of this.byIp) {
      entry.hits = entry.hits.filter((t) => now - t < this.windowMs);
      if (entry.hits.length === 0) this.byIp.delete(key);
    }
  }
}

/**
 * Is this code currently locked out?
 *
 * A lock is absolute for its DURATION, not a counter that resets on a new
 * window: once a code burns CODE_MAX_FAILURES, an attacker must wait
 * CODE_LOCK_MS even if their failures were spread over hours.
 *
 * Note what is NOT here: `failedPulls >= CODE_MAX_FAILURES` on its own. The
 * counter is a TRIGGER, not the state — treating it as the state made a lock
 * permanent, so a user who mistyped their code five times could never use
 * their own e-reader again. The window has to expire for real. The two are
 * always written together by `registerFailedPull`, so in practice a session
 * at the limit has a `lockedUntil` in the future and this reads true; the
 * distinction only shows up after the window lapses, which is the case that
 * has to work.
 */
export function isCodeLocked(session: { failedPulls: number; lockedUntil?: number } | null, now: number = Date.now()): boolean {
  if (!session) return false;
  return (session.lockedUntil ?? 0) > now;
}

/**
 * Record a failed pull and return the updated session fields.
 *
 * Pure, so the caller persists exactly one thing and the test can assert the
 * arithmetic without a store.
 */
export function registerFailedPull(
  // The type names `lockedUntil` because the function reads it — the lock it
  // may decline to extend lives there. Typing the input as just
  // `{ failedPulls }` made every caller with a lock a type error while the code
  // plainly handled it, which is how the "never extend a live lock" branch
  // ends up unreachable in practice.
  session: { failedPulls: number; lockedUntil?: number },
  now: number = Date.now()
): { failedPulls: number; lockedUntil?: number; locked: boolean } {
  const failedPulls = (session.failedPulls || 0) + 1;
  const locked = failedPulls >= CODE_MAX_FAILURES;
  // Do not push a LIVE lock further out: otherwise a patient attacker holds a
  // code locked forever by touching it once a window. An EXPIRED timestamp is
  // not honoured, though — otherwise the lock could never be re-armed, and a
  // user who burned their code once could never be attacked-and-recovered
  // from a second time.
  const existing = session.lockedUntil ?? 0;
  let lockedUntil = session.lockedUntil;
  if (locked) {
    // A lock that is ALIVE is left exactly where it is. If each further guess
    // pushed it another CODE_LOCK_MS, a patient attacker with one request a
    // minute could hold a code locked indefinitely — the lock would become a
    // permanent DoS on a legitimate user, handed to them by the defence.
    // An EXPIRED timestamp is discarded instead, so the next burst re-arms it
    // from now; otherwise one incident would permanently disarm this.
    lockedUntil = existing > now ? existing : now + CODE_LOCK_MS;
  }
  return { failedPulls, lockedUntil, locked };
}

/** A successful pull clears the failure count — typos are not attacks. */
export function clearFailedPulls(): { failedPulls: number; lockedUntil?: number } {
  return { failedPulls: 0, lockedUntil: undefined };
}
