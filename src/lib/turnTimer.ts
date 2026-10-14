/**
 * Turn-clock tick logic for the Game Score Tracker.
 *
 * Extracted as a pure function because the in-component version used to treat
 * expiry as a per-tick *condition* (`remaining <= 1`) while the interval kept
 * running. Once `remaining` hit 0 every following tick re-satisfied the
 * condition, so the "Turn Time Expired" toast and beep fired once per second
 * for the rest of the match.
 *
 * The fix makes expiry an *event*: the state carries whether expiry has already
 * been reported for the current turn, and once it is true the function is
 * idempotent — it returns no events and never re-fires. Callers are expected
 * to stop the interval on `expired`.
 */

export type TurnTimerEvent =
  /** A normal second elapsed. */
  | "tick"
  /** One of the final five seconds — short countdown beep. */
  | "countdown"
  /** The turn clock hit zero. Fires at most once per turn. */
  | "expired";

export interface TurnTimerState {
  /** Seconds left on the clock. Never negative. */
  remaining: number;
  /** Whether expiry has already been reported for this turn. */
  expired: boolean;
}

/** Number of leading seconds that trigger the countdown beep. */
export const COUNTDOWN_SECONDS = 5;

export function createTurnTimerState(remaining: number): TurnTimerState {
  const safe = Number.isFinite(remaining) ? Math.max(0, Math.floor(remaining)) : 0;
  return { remaining: safe, expired: false };
}

/**
 * Advance the turn clock by one second.
 *
 * Contract:
 * - Re-entrant calls after expiry are no-ops: `{ remaining: 0, expired: true }`
 *   stays exactly that and returns `[]`, so a single expiry fires once.
 * - The returned state is a new object only when something changed.
 * - The caller must clear its interval when `events` includes `"expired"`.
 */
export function advanceTurnTimer(state: TurnTimerState): {
  state: TurnTimerState;
  events: TurnTimerEvent[];
} {
  if (state.expired) {
    // Already reported for this turn. Stay silent for the rest of the ticks.
    return { state, events: [] };
  }

  if (state.remaining <= 0) {
    // Clock already at zero when the turn began (or was zeroed by a reset).
    return { state: { remaining: 0, expired: true }, events: ["expired"] };
  }

  const next = state.remaining - 1;
  const events: TurnTimerEvent[] = ["tick"];

  if (next <= 0) {
    // No countdown beep at zero — the expiry beep is the sound for that second.
    return { state: { remaining: 0, expired: true }, events: ["tick", "expired"] };
  }
  if (next <= COUNTDOWN_SECONDS) events.push("countdown");

  return { state: { remaining: next, expired: false }, events };
}

/**
 * Reset the clock for a new turn. Always clears the expiry latch so the next
 * turn can report its own expiry exactly once.
 */
export function resetTurnTimer(remaining: number): TurnTimerState {
  return createTurnTimerState(remaining);
}
