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
  buildWizardRail,
  COMPETITION_STEP_SKIP_MESSAGE,
  deriveBracket,
  deriveCompetitionField,
  describeFieldChange,
  isWizardStepSkipped,
  regenerateCompetitionField,
  resolveRoundSource,
  sanitizeStoredBracket,
  shouldShowTournament,
  wizardStepIndicator,
  WIZARD_STEPS,
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
  // among every past match. While live the archive list is suppressed
  // outright — the requirement is round history only, not "past matches too".
  const s = buildHistorySurface({
    matchActive: true,
    liveRounds: LIVE_ROUNDS,
    archives: ARCHIVES,
    competitionMode: true,
  });
  eq(s.archives.map((a) => a.id), [], "no list of other matches while one is live");
  eq(s.showArchives, false);
  ok(
    !s.archives.some((a) => a.id === "__live__"),
    "the live match must never appear as an archive"
  );
});

test("past matches come back once no match is live", () => {
  const s = buildHistorySurface({
    matchActive: false,
    liveRounds: LIVE_ROUNDS,
    archives: ARCHIVES,
    competitionMode: true,
  });
  eq(s.archives.map((a) => a.id), ["match_1", "match_2"], "only past matches");
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

/* -------------------------------------------------------------------------- */
/* No match history alongside a live match                                      */
/* -------------------------------------------------------------------------- */

test("a live match shows no other matches at all", () => {
  // The explicit ask: while a match is in progress, show ONLY that match's
  // rounds. Competition mode is on here — the strongest case, because that is
  // when an archive list would otherwise be rendered next to the live log.
  const s = buildHistorySurface({
    matchActive: true,
    liveRounds: LIVE_ROUNDS,
    archives: ARCHIVES,
    competitionMode: true,
  });
  eq(s.showArchives, false, "archive list suppressed while live");
  eq(s.archives, [], "no other matches carried into the live view");
  eq(s.liveRounds, LIVE_ROUNDS);
  eq(s.liveRounds!.map((r) => r.roundNumber), [1, 2], "only this match's rounds");
});

test("archives return once the match is finished", () => {
  // The gate is "no match in play", not a one-way latch — finishing a match
  // must bring the archive list back rather than lose it permanently.
  const live = buildHistorySurface({
    matchActive: true,
    liveRounds: LIVE_ROUNDS,
    archives: ARCHIVES,
    competitionMode: true,
  });
  const done = buildHistorySurface({
    matchActive: false,
    liveRounds: LIVE_ROUNDS,
    archives: ARCHIVES,
    competitionMode: true,
  });
  eq(live.showArchives, false);
  eq(done.showArchives, true);
  eq(done.archives, ARCHIVES);
  eq(done.liveRounds, null);
});

test("a live match with competition off also shows only its own rounds", () => {
  const s = buildHistorySurface({
    matchActive: true,
    liveRounds: LIVE_ROUNDS,
    archives: ARCHIVES,
    competitionMode: false,
  });
  eq(s.showArchives, false);
  eq(s.archives, []);
  eq(resolveRoundSource(s, null), { matchId: "__live__", rounds: LIVE_ROUNDS });
});

test("the tournament tab does not exist at all when competition mode is off", () => {
  // Not hidden, not disabled — `shouldShowTournament` is the single gate the
  // button's render is bound to, so there is nothing to click into.
  eq(shouldShowTournament(true), true);
  eq(shouldShowTournament(false), false);
});

/* -------------------------------------------------------------------------- */
/* Wizard step list                                                            */
/* -------------------------------------------------------------------------- */

test("the wizard has six steps in the agreed order", () => {
  eq(WIZARD_STEPS.length, 6);
  eq(
    WIZARD_STEPS.map((s) => s.id),
    ["preset", "rules", "timer", "roster", "competition-roster", "launch"]
  );
  // The competition-mode toggle moved onto the timer step; there is no longer
  // a standalone "mode" step.
  eq(WIZARD_STEPS.some((s) => s.id === "mode"), false);
  eq(WIZARD_STEPS[2].title, "Turn Timer");
  eq(WIZARD_STEPS[4].conditional, true);
});

test("with competition mode off step 5 is marked skipped, not removed", () => {
  const rail = buildWizardRail(0, false);
  eq(rail.length, 6, "the rail still has six entries");
  eq(rail.map((s) => s.number), [1, 2, 3, 4, 5, 6], "numbering does not jump");
  eq(
    rail.map((s) => s.id),
    WIZARD_STEPS.map((s) => s.id),
    "the step list itself is identical either way"
  );
  eq(rail.filter((s) => s.skipped).map((s) => s.number), [5]);
  eq(rail[4].state, "skipped");
  ok(rail[4].label.includes("Skipped"), "the skipped step says so in its label");
  ok(rail[4].label.includes("Competition Roster"), "and still names the step");
});

test("with competition mode on step 5 is a real step", () => {
  const rail = buildWizardRail(0, true);
  eq(rail.length, 6);
  eq(rail.filter((s) => s.skipped).length, 0, "nothing skipped");
  eq(rail[4].id, "competition-roster");
  eq(rail[4].state, "upcoming");
  eq(isWizardStepSkipped("competition-roster", true), false);
  eq(isWizardStepSkipped("competition-roster", false), true);
  eq(isWizardStepSkipped("roster", false), false, "the general roster is never skipped");
});

test("a skipped step standing on itself stays current", () => {
  // Navigating to step 5 with the mode off must not leave the rail claiming
  // the step is not there; it is current, and dimmed, and labelled skipped.
  const rail = buildWizardRail(4, false);
  eq(rail[4].state, "current");
  eq(rail[4].skipped, true);
  eq(rail[5].state, "upcoming");
});

test("step numbering is identical in both modes", () => {
  for (let i = 0; i < 6; i++) {
    eq(buildWizardRail(i, true).map((s) => s.number), [1, 2, 3, 4, 5, 6]);
    eq(buildWizardRail(i, false).map((s) => s.number), [1, 2, 3, 4, 5, 6]);
  }
});

test("the indicator counts all six steps and flags the skip", () => {
  eq(wizardStepIndicator(0, false), "Step 1 of 6");
  eq(wizardStepIndicator(4, false), "Step 5 of 6 · Skipped");
  eq(wizardStepIndicator(4, true), "Step 5 of 6");
  ok(COMPETITION_STEP_SKIP_MESSAGE.includes("competition mode is off"), "the skip is explained in the panel");
});

/* -------------------------------------------------------------------------- */
/* Seeded competition field + regenerate                                       */
/* -------------------------------------------------------------------------- */

const FIELD_NAMES = ["Ana", "Ben", "Cleo", "Dev", "Esi", "Fay"];
const SIDES = [
  { id: "t1", label: "Red", size: 3 },
  { id: "t2", label: "Blue", size: 3 },
];

test("the same seed always derives the same field", () => {
  const a = deriveCompetitionField(FIELD_NAMES, 7, SIDES);
  const b = deriveCompetitionField(FIELD_NAMES, 7, SIDES);
  eq(a.field!.order, b.field!.order);
  eq(a.field!.allocation, b.field!.allocation);
});

test("a derived field covers every player exactly once", () => {
  const r = deriveCompetitionField(FIELD_NAMES, 3, SIDES);
  eq(r.ok, true);
  eq(r.field!.order.slice().sort(), FIELD_NAMES.slice().sort());
  const allocated = r.field!.allocation.flatMap((a) => a.players);
  eq(allocated.slice().sort(), FIELD_NAMES.slice().sort(), "every player lands on a side");
  eq(r.field!.seed, 3);
});

test("regenerate actually changes the seeded field and reports it", () => {
  const before = deriveCompetitionField(FIELD_NAMES, 1, SIDES);
  const regen = regenerateCompetitionField(FIELD_NAMES, SIDES, 1);
  eq(regen.ok, true);
  eq(regen.changed, true, "a six-player field has more than one possible draw");
  eq(regen.previousSeed, 1);
  ok(regen.field!.seed !== 1, "the seed advanced");
  ok(
    JSON.stringify(regen.field!.order) !== JSON.stringify(before.field!.order) ||
      JSON.stringify(regen.field!.allocation) !== JSON.stringify(before.field!.allocation),
    "the drawn field or the side allocation actually differs"
  );
  ok(regen.note.includes("Redrew"), "and it says what it did");
  ok(regen.note.includes("New order:"), "and shows the new order");
});

test("regenerate reports honestly when only one field is possible", () => {
  // Two players have exactly one pairing. The button must not claim success
  // on an identical redraw.
  const regen = regenerateCompetitionField(["Ana", "Ben"], [], 1);
  eq(regen.ok, true);
  eq(regen.changed, false);
  ok(regen.note.includes("nothing changed"), "it says nothing changed");
  eq(regen.field!.order.slice().sort(), ["Ana", "Ben"], "the field is still valid");
});

test("regenerate refuses on an empty roster instead of inventing a field", () => {
  const regen = regenerateCompetitionField([], [], 1);
  eq(regen.ok, false);
  eq(regen.field, null);
  ok(regen.reason!.includes("empty"), "the reason names the problem");
  eq(regen.changed, false);
});

test("regenerate refuses on a one-player roster", () => {
  const regen = regenerateCompetitionField(["Solo"], [], 1);
  eq(regen.ok, false);
  ok(regen.reason!.includes("at least 2"), "the reason says what is needed");
});

test("a field too large for its sides is reported, not drawn", () => {
  const r = deriveCompetitionField(["A", "B", "C", "D"], 1, [
    { id: "t1", label: "Only", size: 3 },
  ]);
  eq(r.ok, false);
  eq(r.field, null);
  ok(r.reason!.includes("cannot hold"), "the reason explains the capacity mismatch");
});

test("more sides than players is reported, not drawn", () => {
  const r = deriveCompetitionField(["A", "B"], 1, [
    { id: "t1", label: "One", size: 2 },
    { id: "t2", label: "Two", size: 2 },
    { id: "t3", label: "Three", size: 2 },
  ]);
  eq(r.ok, false);
  ok(r.reason!.includes("sides"), "the reason names the sides problem");
});

test("players equal to the side count is a valid field", () => {
  // The guard is strictly "more sides than players", not ">= " — two players
  // across two sides is the ordinary two-team match.
  const r = deriveCompetitionField(["A", "B"], 1, SIDES);
  eq(r.ok, true);
  eq(r.field!.allocation.length, 2);
});

test("a roster with blank names is measured by its real entries", () => {
  const r = deriveCompetitionField(["", "  ", "Ana"], 1, []);
  eq(r.ok, false, "one real name is still one player");
  ok(r.reason!.includes("roster has 1"), "the reason counts real names only");
});

test("describeFieldChange names what moved", () => {
  const a = deriveCompetitionField(FIELD_NAMES, 1, SIDES);
  const b = deriveCompetitionField(FIELD_NAMES, 12, SIDES);
  const note = describeFieldChange(a.field!, b.field!, 12);
  ok(note.includes("seed 12"), "names the new seed");
  ok(note.includes("→"), "lists the new order");
});

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);