/**
 * Game preset catalogue tests.
 *
 * Three things this pins:
 *
 *  1. The six added games exist with the right player counts, and the three
 *     removed ones are genuinely gone from the picker.
 *  2. Teams are declared for exactly the games played as sides. Carrom,
 *     Hukum Thaas and Dihaeh are 2v2; Chess, Digu and Uno are not. Getting
 *     this wrong is silent — the tracker still runs, it just records the wrong
 *     thing.
 *  3. Team roll-up sums members AND keeps each member's own score, because
 *     losing the individual breakdown to get the side total is a regression.
 *
 * Plus the degradation path: a match saved against a preset that has since
 * been removed must still name its game instead of throwing.
 */
import {
  GAME_PRESETS,
  REMOVED_PRESET_IDS,
  REMOVED_PRESET_NAMES,
  addCategory,
  assignTeamsRoundRobin,
  categorySettingsForPreset,
  computeTeamStandings,
  expectedTeamSize,
  getPresetById,
  getTeams,
  instantWinConditions,
  isTeamGame,
  normalizeTeamAssignments,
  resolveMatchGame,
  teamIds,
  type GamePreset,
} from "../gamePresets";

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

function mustGet(id: string): GamePreset {
  const p = getPresetById(id);
  if (!p) throw new Error(`preset "${id}" not found`);
  return p;
}

/* -------------------------------------------------------------------------- */
/* 1. The six added games                                                      */
/* -------------------------------------------------------------------------- */

test("all six new presets exist", () => {
  for (const id of ["carrom", "chess", "hukum-thaas", "digu", "dihaeh", "uno"]) {
    ok(getPresetById(id), `missing preset ${id}`);
  }
});

test("player counts match the rules", () => {
  // Carrom: 2 or 4. Chess: 2. Hukum Thaas / Dihaeh / Digu: 4. Uno: 2-10.
  eq(mustGet("carrom").playerCount.min, 2, "carrom min");
  eq(mustGet("carrom").playerCount.max, 4, "carrom max");
  eq(mustGet("carrom").playerCount.default, 4, "carrom default");
  eq(mustGet("chess").playerCount.default, 2, "chess default");
  eq(mustGet("hukum-thaas").playerCount.default, 4, "hukum-thaas default");
  eq(mustGet("digu").playerCount.default, 4, "digu default");
  eq(mustGet("dihaeh").playerCount.default, 4, "dihaeh default");
  eq(mustGet("uno").playerCount.max, 10, "uno max");
});

test("target scores follow the rules", () => {
  eq(mustGet("carrom").targetScore, 9, "carrom = 9 pieces, Queen is separate");
  eq(mustGet("hukum-thaas").targetScore, 7, "hukum thaas = 7 tricks");
  eq(mustGet("dihaeh").targetScore, 7, "dihaeh = 7 tricks");
  // Chess, Digu and Uno have no numeric target — first-to-X, not a score.
  eq(mustGet("digu").targetScore, undefined, "digu has no numeric target");
  eq(mustGet("uno").targetScore, undefined, "uno has no numeric target");
  // Chess keeps a deliberate stop-signal of 1 and explains why.
  eq(mustGet("chess").targetScore, 1, "chess stop signal");
  ok(
    (mustGet("chess").targetRationale ?? "").length > 0,
    "chess must justify its target score"
  );
});

test("a preset with no target explains why in its notes", () => {
  // No numeric win target must never read as a silent 0.
  for (const id of ["digu", "uno"]) {
    const p = mustGet(id);
    ok(
      (p.notes ?? []).some((n) => /empty hand|no target|first to/i.test(n)),
      `${id} must state its non-numeric win condition in notes`
    );
  }
});

/* -------------------------------------------------------------------------- */
/* 2. Removals                                                                 */
/* -------------------------------------------------------------------------- */

test("the three removed presets are gone from the picker", () => {
  for (const id of ["catan", "ticket-to-ride", "carcassonne"]) {
    ok(!getPresetById(id), `${id} should not resolve`);
    ok(
      !GAME_PRESETS.some((p) => p.id === id),
      `${id} should not be in GAME_PRESETS`
    );
  }
});

test("no preset anywhere in the catalogue carries a removed id", () => {
  const ids = new Set(GAME_PRESETS.map((p) => p.id));
  for (const id of REMOVED_PRESET_IDS) ok(!ids.has(id), `${id} leaked into the catalogue`);
});

test("removed preset names are retained for historical matches", () => {
  eq(REMOVED_PRESET_NAMES.catan, "Settlers of Catan");
  eq(REMOVED_PRESET_NAMES["ticket-to-ride"], "Ticket to Ride");
  eq(REMOVED_PRESET_NAMES.carcassonne, "Carcassonne");
});

test("preset ids are unique", () => {
  const seen = new Set<string>();
  for (const p of GAME_PRESETS) {
    ok(!seen.has(p.id), `duplicate preset id ${p.id}`);
    seen.add(p.id);
  }
});

/* -------------------------------------------------------------------------- */
/* 3. Teams — declared for exactly the right games                             */
/* -------------------------------------------------------------------------- */

test("Carrom declares White vs Black, two a side", () => {
  const p = mustGet("carrom");
  ok(isTeamGame(p), "carrom must be a team game");
  eq(getTeams(p).map((t) => t.label), ["White", "Black"]);
  eq(getTeams(p).map((t) => t.size), [2, 2]);
  eq(expectedTeamSize(p), 4);
});

test("Hukum Thaas and Dihaeh declare Team 1 vs Team 2", () => {
  for (const id of ["hukum-thaas", "dihaeh"]) {
    const p = mustGet(id);
    ok(isTeamGame(p), `${id} must be a team game`);
    eq(getTeams(p).map((t) => t.label), ["Team 1", "Team 2"], `${id} labels`);
    eq(expectedTeamSize(p), 4, `${id} team size`);
  }
});

test("Chess, Digu and Uno are NOT teams", () => {
  for (const id of ["chess", "digu", "uno"]) {
    const p = mustGet(id);
    ok(!isTeamGame(p), `${id} must be individual`);
    eq(getTeams(p), [], `${id} teams`);
    eq(computeTeamStandings(p, [{ id: "p1" }], { p1: 5 }), [], `${id} standings`);
  }
});

test("the existing trick-taking preset was converted to partnerships", () => {
  // Hearts/Spades/Euchre ARE team games, so leaving them individual would have
  // been the inconsistency.
  const p = mustGet("hearts-spades");
  ok(isTeamGame(p), "hearts/spades/euchre should be two partnerships");
  eq(getTeams(p).length, 2);
  eq(getTeams(p).map((t) => t.size), [2, 2]);
});

test("individual presets stay individual", () => {
  for (const id of ["7wonders", "scrabble", "custom"]) {
    ok(!isTeamGame(mustGet(id)), `${id} should not be a team game`);
  }
});

test("isTeamGame tolerates missing presets", () => {
  ok(!isTeamGame(undefined), "undefined is not a team game");
  ok(!isTeamGame(null), "null is not a team game");
});

/* -------------------------------------------------------------------------- */
/* 4. Team assignment                                                          */
/* -------------------------------------------------------------------------- */

test("round-robin fills each side before moving on", () => {
  // Carrom 2v2 is White, White, Black, Black — not alternating sides, which
  // would put your own partner opposite you.
  eq(assignTeamsRoundRobin(["carrom-white", "carrom-black"], 4, [2, 2]), [
    "carrom-white",
    "carrom-white",
    "carrom-black",
    "carrom-black",
  ]);
});

test("assignment sizes sides by their declared size", () => {
  // A 1v1 side must be filled before the 2v2 side gets its second player.
  eq(assignTeamsRoundRobin(["a", "b", "c"], 4, [1, 2, 1]), ["a", "b", "b", "c"]);
});

test("an uneven roster still assigns every player", () => {
  // Five players onto two sides of two: the last player has no side to sit on
  // cleanly, but must still be given a real team id rather than "".
  const out = assignTeamsRoundRobin(["carrom-white", "carrom-black"], 5, [2, 2]);
  eq(out.length, 5);
  for (const id of out) ok(id === "carrom-white" || id === "carrom-black", `bad team id "${id}"`);
});

test("assignment with no sides yields empty ids rather than crashing", () => {
  eq(assignTeamsRoundRobin([], 4), ["", "", "", ""]);
});

test("assignment normalises unassigned and stale players", () => {
  const p = mustGet("carrom");
  const out = normalizeTeamAssignments(
    [
      { id: "p1" }, // unassigned
      { id: "p2", teamId: "carrom-white" }, // valid, kept
      { id: "p3", teamId: "team-9" }, // side no longer exists
      { id: "p4" },
    ],
    p
  );
  eq(out[1].teamId, "carrom-white", "a valid assignment survives");
  ok(
    getTeams(p).some((t) => t.id === out[2].teamId),
    "a stale team id is replaced with a real side"
  );
  eq(teamIds(p).length, 2);
});

test("assignment is a no-op for individual games", () => {
  const out = normalizeTeamAssignments([{ id: "p1", teamId: "carrom-white" }], mustGet("chess"));
  eq(out, [{ id: "p1" }], "individual games strip team ids");
});

/* -------------------------------------------------------------------------- */
/* 5. Roll-up — sums members AND keeps their individual scores                  */
/* -------------------------------------------------------------------------- */

test("team totals sum their members", () => {
  const carrom = mustGet("carrom");
  const players = [
    { id: "p1", teamId: "carrom-white" },
    { id: "p2", teamId: "carrom-white" },
    { id: "p3", teamId: "carrom-black" },
    { id: "p4", teamId: "carrom-black" },
  ];
  const standings = computeTeamStandings(carrom, players, { p1: 4, p2: 3, p3: 5, p4: 2 });

  eq(standings.map((t) => t.label), ["White", "Black"]);
  eq(standings.map((t) => t.total), [7, 7]);
  eq(standings.map((t) => t.memberIds), [["p1", "p2"], ["p3", "p4"]]);
});

test("the individual breakdown survives the roll-up", () => {
  const hokm = mustGet("hukum-thaas");
  const players = [
    { id: "a", teamId: "team-1" },
    { id: "b", teamId: "team-1" },
    { id: "c", teamId: "team-2" },
    { id: "d", teamId: "team-2" },
  ];
  const standings = computeTeamStandings(hokm, players, { a: 4, b: 3, c: 2, d: 1 });

  // Total AND the members that produced it — both answers are needed.
  eq(standings[0].total, 7);
  eq(standings[0].memberScores, { a: 4, b: 3 });
  eq(standings[1].memberScores, { c: 2, d: 1 });
});

test("a player with no team does not join a side", () => {
  const hokm = mustGet("hukum-thaas");
  const standings = computeTeamStandings(
    hokm,
    [
      { id: "a", teamId: "team-1" },
      { id: "b", teamId: "team-1" },
      { id: "c" }, // unassigned
    ],
    { a: 2, b: 2, c: 99 }
  );
  eq(standings[0].total, 4, "unassigned points are not folded into Team 1");
});

test("missing scores count as zero rather than NaN", () => {
  const hokm = mustGet("hukum-thaas");
  const standings = computeTeamStandings(
    hokm,
    [
      { id: "a", teamId: "team-1" },
      { id: "b", teamId: "team-1" },
    ],
    { a: 3 } // b never scored
  );
  eq(standings[0].total, 3);
  eq(standings[0].memberScores.b, 0);
});

test("an empty side reports zero with no members", () => {
  const hokm = mustGet("hukum-thaas");
  const standings = computeTeamStandings(hokm, [{ id: "a", teamId: "team-1" }], { a: 5 });
  eq(standings[1].total, 0);
  eq(standings[1].memberIds, []);
});

/* -------------------------------------------------------------------------- */
/* 6. Special conditions                                                       */
/* -------------------------------------------------------------------------- */

test("every new preset carries its special conditions", () => {
  const has = (id: string, needle: RegExp) => {
    const conds = mustGet(id).specialConditions ?? [];
    ok(
      conds.some((c) => needle.test(c.label) || needle.test(c.detail)),
      `${id} is missing a condition matching ${needle}`
    );
  };

  has("carrom", /queen/i);
  has("chess", /checkmate/i);
  has("hukum-thaas", /koatey/i);
  has("digu", /run/i);
  has("dihaeh", /baga/i);
  has("dihaeh", /hukunbunye/i);
  has("uno", /UNO!/i);
});

test("instant-win conditions are flagged, not silently listed", () => {
  // The games that end on something other than a score must expose a button.
  for (const id of ["carrom", "chess", "hukum-thaas", "dihaeh"]) {
    const instant = instantWinConditions(mustGet(id));
    ok(instant.length > 0, `${id} should declare at least one instant win`);
    for (const c of instant) eq(c.kind, "instant_win", `${id}/${c.id} kind`);
  }
});

test("Digu and Uno declare no instant win (they end on an empty hand)", () => {
  eq(instantWinConditions(mustGet("digu")), []);
  eq(instantWinConditions(mustGet("uno")), []);
});

test("instantWinConditions tolerates a missing preset", () => {
  eq(instantWinConditions(undefined), []);
});

/* -------------------------------------------------------------------------- */
/* 7. Category matrix — the "BB" bug                                           */
/* -------------------------------------------------------------------------- */

test("a preset's declared categories are returned in full", () => {
  // The regression: the initially-selected preset's categories were never
  // seeded, so the matrix opened empty and names had to be typed by hand.
  const scrabble = mustGet("scrabble");
  const settings = categorySettingsForPreset(scrabble);
  eq(settings.enabled, true);
  eq(settings.categories, ["Tiles banked", "Word bonuses"]);
});

test("category names are not truncated or abbreviated", () => {
  // "Settlements/Cities" is the exact string that read as "BB" on screen.
  for (const p of GAME_PRESETS) {
    for (const cat of p.categories ?? []) {
      eq(typeof cat, "string", `${p.id} category type`);
      ok(cat.trim().length > 0, `${p.id} has a blank category`);
    }
  }
});

test("a preset with no categories reports the matrix off and empty", () => {
  eq(categorySettingsForPreset(mustGet("carrom")), { enabled: false, categories: [] });
  eq(categorySettingsForPreset(undefined), { enabled: false, categories: [] });
});

test("category settings hand back a copy, not the preset's own array", () => {
  const p = mustGet("scrabble");
  const settings = categorySettingsForPreset(p);
  settings.categories.push("mutated");
  eq(p.categories, ["Tiles banked", "Word bonuses"], "the preset must not be mutated");
});

test("a duplicate category name is rejected", () => {
  // This is what keeps the chips from reading "BB", "BB".
  eq(addCategory(["BB"], "BB"), ["BB"]);
  eq(addCategory(["BB"], " bb "), ["BB"]);
  eq(addCategory(["BB"], "Settlements/Cities"), ["BB", "Settlements/Cities"]);
});

test("blank category input is ignored", () => {
  eq(addCategory(["BB"], ""), ["BB"]);
  eq(addCategory(["BB"], "   "), ["BB"]);
});

/* -------------------------------------------------------------------------- */
/* 8. Stored-match degradation                                                */
/* -------------------------------------------------------------------------- */

test("a stored match on a removed preset keeps its saved name", () => {
  const resolved = resolveMatchGame({ gameId: "catan", gameName: "Settlers of Catan" });
  eq(resolved.name, "Settlers of Catan");
  eq(resolved.degraded, true, "flagged as coming from the stored record");
});

test("every removed preset id degrades without throwing", () => {
  for (const id of REMOVED_PRESET_IDS) {
    const stored = REMOVED_PRESET_NAMES[id];
    let resolved;
    try {
      resolved = resolveMatchGame({ gameId: id, gameName: stored });
    } catch (e) {
      throw new Error(`resolveMatchGame threw for ${id}: ${e}`);
    }
    eq(resolved.name, stored);
    ok(resolved.name.length > 0, `${id} degraded to an empty name`);
  }
});

test("a live preset id resolves to the current name", () => {
  const resolved = resolveMatchGame({ gameId: "carrom", gameName: "stale name" });
  eq(resolved.name, "Carrom");
  eq(resolved.degraded, false);
});

test("an archive predating gameId still renders its stored name", () => {
  eq(resolveMatchGame({ gameName: "Old Match" }), { name: "Old Match", degraded: true });
});

test("a nameless unknown match degrades to a placeholder, never undefined", () => {
  // The crash this prevents: history renders every entry, so one unusable
  // record must not take the whole list down.
  eq(resolveMatchGame({ gameId: "does-not-exist" }).name, "Unknown game");
  eq(resolveMatchGame({}).name, "Unknown game");
  eq(resolveMatchGame(null).name, "Unknown game");
  eq(resolveMatchGame(undefined).name, "Unknown game");
});

test("a whitespace-only stored name still yields a usable label", () => {
  eq(resolveMatchGame({ gameId: "catan", gameName: "   " }).name, "Unknown game");
});

/* -------------------------------------------------------------------------- */
/* Report                                                                      */
/* -------------------------------------------------------------------------- */

console.log(`\n${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);