/**
 * Tracker surface tests: the derived tournament bracket and the split between
 * a live match's rounds and the archive of finished matches.
 *
 * The behaviours pinned here are ones that used to be one-shot state:
 *
 *  - The bracket was a snapshot written by a "Generate" click, so it went
 *    stale the moment a player was added, and it outlived competition mode.
 *    It is now derived from the roster every render.
 *  - The live match was unshifted into the same array as past matches, which
 *    put a running match among the archives and let the round log resolve to
 *    another match's rounds.
 */
import {
  buildHistorySurface,
  deriveBracket,
  resolveRoundSource,
  sanitizeStoredBracket,
  shouldShowTournament,
  type HistorySurface,
} from "../trackerSurfaces";

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

function ok(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

const ROSTER = ["Alice", "Bob", "Carol", "Dave"];

/* -------------------------------------------------------------------------- */
/* Tournament tab visibility                                                   */
/* -------------------------------------------------------------------------- */

test("the tournament tab exists only when competition mode is on", () => {
  eq(shouldShowTournament(true), true);
  eq(shouldShowTournament(false), false);
});

test("no bracket is derived while competition mode is off", () => {
  // The flag is the single source of truth, so the tab and the bracket can
  // never disagree.
  eq(deriveBracket(ROSTER, false), null);
});

test("a bracket is derived with no generate step", () => {
  const b = deriveBracket(ROSTER, true);
  ok(b, "expected a bracket");
  eq(b!.players, ROSTER);
  eq(b!.round1, [
    { p1: "Alice", p2: "Bob" },
    { p1: "Carol", p2: "Dave" },
  ]);
  eq(b!.finals, { p1: "Winner M1", p2: "Winner M2" });
});

/* -------------------------------------------------------------------------- */
/* The bracket tracks the roster                                               */
/* -------------------------------------------------------------------------- */

test("adding a player re-derives the bracket", () => {
  const three = deriveBracket(["Alice", "Bob", "Carol"], true)!;
  const four = deriveBracket(["Alice", "Bob", "Carol", "Dave"], true)!;
  // Three players still pair as two matchups (the third takes the bye); a
  // fourth player fills that empty seat rather than adding a pairing.
  eq(three.round1.length, 2);
  eq(three.round1[1], { p1: "Carol", p2: "" });
  eq(four.round1.length, 2);
  eq(four.round1[1], { p1: "Carol", p2: "Dave" }, "the bye seat is filled");
  eq(four.finals.p2, "Winner M2");
});

test("removing a player re-derives the bracket", () => {
  // The stale-snapshot bug: four players were paired, then one was removed
  // and the old bracket was still on screen.
  const after = deriveBracket(["Alice", "Bob", "Carol"], true)!;
  eq(after.players.length, 3);
  eq(after.round1, [{ p1: "Alice", p2: "Bob" }, { p1: "Carol", p2: "" }]);
});

test("deriving twice from the same roster gives the same bracket", () => {
  eq(deriveBracket(ROSTER, true), deriveBracket(ROSTER, true));
});

test("two players go straight to a final", () => {
  const b = deriveBracket(["Alice", "Bob"], true)!;
  eq(b.round1, [], "no semi-finals for a two-player field");
  eq(b.finals, { p1: "Alice", p2: "Bob" });
});

test("an odd field leaves a bye rather than dropping the pairing", () => {
  const b = deriveBracket(["A", "B", "C"], true)!;
  eq(b.round1, [{ p1: "A", p2: "B" }, { p1: "C", p2: "" }]);
});

test("blank and unnamed roster slots are ignored", () => {
  const b = deriveBracket(["Alice", "   ", "Bob", ""], true)!;
  eq(b.players, ["Alice", "Bob"]);
});

test("fewer than two named players yields no bracket", () => {
  eq(deriveBracket([], true), null);
  eq(deriveBracket(["Alice"], true), null);
  eq(deriveBracket(["", "  "], true), null);
});

test("a five-player field pairs into three matchups", () => {
  const b = deriveBracket(["A", "B", "C", "D", "E"], true)!;
  eq(b.round1.length, 3);
  eq(b.finals.p2, "Winner M3");
});

/* -------------------------------------------------------------------------- */
/* Stored bracket degradation                                                  */
/* -------------------------------------------------------------------------- */

test("a stored bracket is readable", () => {
  const b = sanitizeStoredBracket({
    players: ["A", "B"],
    round1: [{ p1: "A", p2: "B", winner: "A" }],
    finals: { p1: "A", p2: "Winner M2" },
  });
  eq(b!.round1[0].winner, "A");
});

test("a stored bracket from an older build does not throw", () => {
  // The untick case: a bracket left behind in localStorage after competition
  // mode was switched off must degrade, not crash the tracker.
  const cases: unknown[] = [
    null,
    undefined,
    "nonsense",
    42,
    [],
    {},
    { players: ["A"] }, // no finals
    { players: "not an array", finals: { p1: "A", p2: "B" } },
    { players: ["A"], finals: null },
    { players: ["A"], finals: { p1: 1, p2: 2 } },
  ];
  for (const c of cases) {
    let out;
    try {
      out = sanitizeStoredBracket(c);
    } catch (e) {
      throw new Error(`sanitizeStoredBracket threw on ${JSON.stringify(c)}: ${e}`);
    }
    eq(out, null, `expected null for ${JSON.stringify(c)}`);
  }
});

test("a stored bracket with a bad round1 degrades to empty rounds", () => {
  const b = sanitizeStoredBracket({
    players: ["A", "B"],
    round1: [{ p1: "A" }, { p2: "B" }, { p1: "A", p2: "B" }],
    finals: { p1: "A", p2: "B" },
  });
  ok(b, "the usable parts should survive");
  eq(b!.round1, [{ p1: "A", p2: "B" }], "only well-formed matchups survive");
});

test("turning competition mode off removes the bracket even with a stored one", () => {
  // deriveBracket is the only thing that feeds the rendered bracket, and it
  // returns null when the flag is off — a stored value cannot resurrect it.
  const stored = sanitizeStoredBracket({
    players: ["A", "B"],
    round1: [{ p1: "A", p2: "B", winner: "A" }],
    finals: { p1: "A", p2: "Winner M2" },
  });
  ok(stored, "stored bracket should parse");
  eq(deriveBracket(ROSTER, false), null, "flag off means no bracket regardless");
});

/* -------------------------------------------------------------------------- */
/* History surface: live rounds vs archives                                    */
/* -------------------------------------------------------------------------- */

const LIVE_ROUNDS = [
  { roundNumber: 1, timestamp: 1 },
  { roundNumber: 2, timestamp: 2 },
];

const ARCHIVES = [
  { id: "match_1", gameName: "Old Carrom" },
  { id: "match_2", gameName: "Old Chess" },
];

test("a live match's rounds are kept out of the archive list", () => {
  // The mixing the user objected to: the running match rendered as a card
  // among every past match.
  const s = buildHistorySurface({
    matchActive: true,
    liveRounds: LIVE_ROUNDS,
    archives: ARCHIVES,
    competitionMode: true,
  });
  eq(s.archives.map((a) => a.id), ["match_1", "match_2"], "only past matches");
  ok(
    !s.archives.some((a) => a.id === "__live__"),
    "the live match must never appear as an archive"
  );
});

test("live rounds contain only that match's rounds", () => {
  const s = buildHistorySurface({
    matchActive: true,
    liveRounds: LIVE_ROUNDS,
    archives: ARCHIVES,
    competitionMode: true,
  });
  eq(s.liveRounds, LIVE_ROUNDS);
  eq(s.liveRounds!.length, 2);
});

test("archives are hidden when competition mode is off", () => {
  const s = buildHistorySurface({
    matchActive: false,
    liveRounds: [],
    archives: ARCHIVES,
    competitionMode: false,
  });
  eq(s.showArchives, false);
  eq(s.archives, [], "no other-match list to leak into the view at all");
});

test("archives are shown when competition mode is on", () => {
  const s = buildHistorySurface({
    matchActive: false,
    liveRounds: [],
    archives: ARCHIVES,
    competitionMode: true,
  });
  eq(s.showArchives, true);
  eq(s.archives, ARCHIVES);
});

test("there are no live rounds when no match is running", () => {
  const s = buildHistorySurface({
    matchActive: false,
    liveRounds: LIVE_ROUNDS, // stale buffer
    archives: [],
    competitionMode: true,
  });
  eq(s.liveRounds, null);
});

/* -------------------------------------------------------------------------- */
/* Round source resolution                                                     */
/* -------------------------------------------------------------------------- */

test("while a match is live the round log reads the live match only", () => {
  const s: HistorySurface = buildHistorySurface({
    matchActive: true,
    liveRounds: LIVE_ROUNDS,
    archives: ARCHIVES,
    competitionMode: true,
  });
  // Even when an archive id is requested, the live match wins — otherwise
  // clicking a past match could swap the live round log underneath you.
  eq(resolveRoundSource(s, null), { matchId: "__live__", rounds: LIVE_ROUNDS });
  eq(resolveRoundSource(s, "match_1"), { matchId: "__live__", rounds: LIVE_ROUNDS });
});

test("with no live match only an explicit archive resolves", () => {
  const s = buildHistorySurface({
    matchActive: false,
    liveRounds: [],
    archives: ARCHIVES,
    competitionMode: true,
  });
  eq(resolveRoundSource(s, null), null, "nothing requested, nothing shown");
  eq(resolveRoundSource(s, "match_1"), { matchId: "match_1", rounds: [] });
});

test("an unknown archive id resolves to nothing", () => {
  const s = buildHistorySurface({
    matchActive: false,
    liveRounds: [],
    archives: ARCHIVES,
    competitionMode: true,
  });
  eq(resolveRoundSource(s, "match_999"), null, "no silent fallback to another match");
});

test("with competition mode off no archive id can resolve", () => {
  const s = buildHistorySurface({
    matchActive: false,
    liveRounds: [],
    archives: ARCHIVES,
    competitionMode: false,
  });
  eq(resolveRoundSource(s, "match_1"), null);
});

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);