/**
 * Turn-clock expiry tests.
 *
 * The bug this pins: "Turn Time Expired!" fired once per second, forever,
 * because the interval was never cleared and expiry was a condition rather
 * than an event. The critical case is a 1-second turn — the tightest window
 * where the first expiry and the next tick land in the same place.
 */
import {
  advanceTurnTimer,
  createTurnTimerState,
  resetTurnTimer,
  type TurnTimerEvent,
  type TurnTimerState,
} from "../turnTimer";

let pass = 0;
let fail = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log("PASS ", name);
  } catch (e) {
    fail++;
    console.log("FAIL ", name, "—", e instanceof Error ? e.message : e);
  }
}

function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`);
}

/** Run `ticks` seconds on a fresh clock and collect every event emitted. */
function runTurn(seconds: number, ticks: number): { events: TurnTimerEvent[]; state: TurnTimerState } {
  let state = createTurnTimerState(seconds);
  const events: TurnTimerEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const res = advanceTurnTimer(state);
    state = res.state;
    events.push(...res.events);
  }
  return { events, state };
}

test("a 1-second turn fires expiry exactly once", () => {
  const first = advanceTurnTimer(createTurnTimerState(1));
  eq(first.events.includes("expired"), true, "first tick should expire:");
  eq(first.state, { remaining: 0, expired: true });

  // The interval must not be cleared by the pure function, so simulate it
  // firing anyway: the following ticks stay silent.
  let state = first.state;
  for (let i = 0; i < 10; i++) {
    const res = advanceTurnTimer(state);
    eq(res.events, [], `tick ${i + 2} after expiry should emit nothing:`);
    eq(res.state, { remaining: 0, expired: true });
    state = res.state;
  }
});

test("only one 'expired' event across a whole 60s turn plus 20 extra ticks", () => {
  const { events, state } = runTurn(60, 80);
  eq(
    events.filter((e) => e === "expired").length,
    1,
    "expired event count:"
  );
  eq(state, { remaining: 0, expired: true });
});

test("a 0-second clock expires on its first tick and then goes quiet", () => {
  const first = advanceTurnTimer(createTurnTimerState(0));
  eq(first.events, ["expired"]);
  eq(advanceTurnTimer(first.state).events, []);
});

test("countdown beep fires on the final five seconds and not before", () => {
  // Record the clock value at which each countdown beep was emitted.
  const beeps: number[] = [];
  let state = createTurnTimerState(10);
  for (let i = 0; i < 10; i++) {
    const res = advanceTurnTimer(state);
    if (res.events.includes("countdown")) beeps.push(res.state.remaining);
    state = res.state;
  }
  eq(beeps, [5, 4, 3, 2, 1], "countdown beep clock values:");
  eq(state, { remaining: 0, expired: true });
});

test("no countdown beep duplicates the expiry beep at zero", () => {
  const res = advanceTurnTimer(createTurnTimerState(1));
  eq(res.events.includes("countdown"), false, "zero should not countdown-beep:");
  eq(res.events.filter((e) => e === "expired").length, 1);
});

test("tick events decrement remaining by one and never go negative", () => {
  let state = createTurnTimerState(3);
  const seen: number[] = [state.remaining];
  for (let i = 0; i < 3; i++) {
    const res = advanceTurnTimer(state);
    state = res.state;
    seen.push(state.remaining);
  }
  eq(seen, [3, 2, 1, 0]);
  eq(state.expired, true);
});

test("resetting for the next turn re-arms expiry exactly once", () => {
  const firstTurn = runTurn(1, 5);
  eq(firstTurn.events.filter((e) => e === "expired").length, 1);

  // "Next player turn" resets the clock.
  const armed = resetTurnTimer(1);
  eq(armed, { remaining: 1, expired: false });

  const secondTurn = runTurn(1, 5);
  eq(secondTurn.events.filter((e) => e === "expired").length, 1);
  eq(secondTurn.state, { remaining: 0, expired: true });
});

test("createTurnTimerState clamps junk input to a safe clock", () => {
  eq(createTurnTimerState(-5), { remaining: 0, expired: false });
  eq(createTurnTimerState(NaN), { remaining: 0, expired: false });
  eq(createTurnTimerState(30.7), { remaining: 30, expired: false });
});

test("advanceTurnTimer never mutates the state it is given", () => {
  const state = createTurnTimerState(1);
  advanceTurnTimer(state);
  eq(state, { remaining: 1, expired: false });
});

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
