/**
 * Pure helpers for the Game Score Tracker's two list surfaces: the tournament
 * bracket and the match-history view.
 *
 * Extracted so both can be tested without a DOM, and so neither depends on a
 * one-shot "generate" click. The bracket is a *function* of the roster and
 * the competition flag, recomputed on every render, which is what makes it
 * stay correct when a player is added or removed mid-setup.
 */

/* -------------------------------------------------------------------------- */
/* Tournament bracket                                                          */
/* -------------------------------------------------------------------------- */

export interface BracketMatchup {
  p1: string;
  p2: string;
  winner?: string;
}

export interface Bracket {
  players: string[];
  /** Opening round. Empty when the field is small enough to go straight to a final. */
  round1: BracketMatchup[];
  finals: BracketMatchup;
}

/** The fewest players before a bracket is worth drawing at all. */
export const MIN_BRACKET_PLAYERS = 2;

/**
 * Derive the elimination bracket from the roster and the competition flag.
 *
 * Returns `null` when competition mode is off — that is the single source of
 * truth for "no tournament", so the tab and the bracket can never disagree.
 * Also `null` below two players.
 *
 * Byes are handled by leaving the empty seat as an empty string rather than
 * dropping the pairing, so a 3-player field still produces a well-formed
 * bracket instead of a ragged one.
 */
export function deriveBracket(
  playerNames: string[],
  competitionMode: boolean
): Bracket | null {
  if (!competitionMode) return null;

  const names = playerNames
    .map((n) => (typeof n === "string" ? n.trim() : ""))
    .filter((n) => n.length > 0);

  if (names.length < MIN_BRACKET_PLAYERS) return null;

  // Two players go straight to the final; a larger field opens with pairings.
  if (names.length === 2) {
    return { players: names, round1: [], finals: { p1: names[0], p2: names[1] } };
  }

  const round1: BracketMatchup[] = [];
  for (let i = 0; i < names.length; i += 2) {
    round1.push({ p1: names[i], p2: names[i + 1] ?? "" });
  }

  return {
    players: names,
    round1,
    finals: { p1: "Winner M1", p2: `Winner M${round1.length}` },
  };
}

/** Whether the tournament surface should exist at all. */
export function shouldShowTournament(competitionMode: boolean): boolean {
  return competitionMode;
}

/**
 * Read a bracket that may have been persisted by an older build.
 *
 * Untick-ticking competition mode, or a hand-edited `localStorage` blob, can
 * leave a bracket behind that no longer matches the roster. This never throws:
 * a malformed value comes back as `null` and the caller derives a fresh one.
 */
export function sanitizeStoredBracket(raw: unknown): Bracket | null {
  if (!raw || typeof raw !== "object") return null;
  const b = raw as Partial<Bracket>;
  if (!Array.isArray(b.players)) return null;
  if (!b.finals || typeof b.finals !== "object") return null;

  const matchup = (m: unknown): BracketMatchup | null => {
    if (!m || typeof m !== "object") return null;
    const v = m as Partial<BracketMatchup>;
    if (typeof v.p1 !== "string" || typeof v.p2 !== "string") return null;
    return typeof v.winner === "string" ? { p1: v.p1, p2: v.p2, winner: v.winner } : { p1: v.p1, p2: v.p2 };
  };

  const round1 = Array.isArray(b.round1)
    ? b.round1.map(matchup).filter((m): m is BracketMatchup => m !== null)
    : [];

  const finals = matchup(b.finals);
  if (!finals) return null;

  return { players: b.players.filter((p): p is string => typeof p === "string"), round1, finals };
}

/* -------------------------------------------------------------------------- */
/* Seeded competition field (setup wizard, step 5)                             */
/* -------------------------------------------------------------------------- */

/** A side/team players can be allocated to. `size` is optional capacity. */
export interface CompetitionSide {
  id: string;
  label: string;
  size?: number;
}

export interface CompetitionField {
  /** The seed this field was drawn with. Same seed ⇒ same field, always. */
  seed: number;
  /** Seeding order — the draw that decided who plays whom. */
  order: string[];
  /** Which side each seeded player was allocated to. */
  allocation: { sideId: string; label: string; players: string[] }[];
  /** Opening pairings, straight off the seeding order. */
  pairings: { p1: string; p2: string }[];
}

/**
 * Why a field could not be drawn, phrased for the person reading it.
 *
 * Regenerate must never paper over an unusable roster by quietly producing a
 * new field — an empty roster and a one-player roster both mean "there is
 * nothing to verify", and the wizard says so instead.
 */
export interface CompetitionFieldResult {
  /** True when a field could be drawn. */
  ok: boolean;
  /** The drawn field, or `null` when `ok` is false. */
  field: CompetitionField | null;
  /** Why no field could be drawn, or `null` when `ok` is true. */
  reason: string | null;
}

/**
 * Flat rather than a discriminated union: this project compiles without
 * `strictNullChecks`, so `if (result.ok)` does not narrow away the other
 * branch and every caller would have to cast.
 */
export interface RegenerateResult extends CompetitionFieldResult {
  /** The seed that was in force before this click. */
  previousSeed: number;
  /** False only when the field genuinely cannot be different (see `note`). */
  changed: boolean;
  /** Human-readable account of what the click did. */
  note: string;
}

function cleanNames(playerNames: string[]): string[] {
  return playerNames
    .map((n) => (typeof n === "string" ? n.trim() : ""))
    .filter((n) => n.length > 0);
}

/** mulberry32 — small, fast, and deterministic for a given seed. */
function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates against the seeded rng. Does not mutate the input. */
function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  const rng = makeRng(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Identity of a field: what actually got drawn, ignoring presentation order.
 *
 * The seeding order is deliberately NOT part of this. With two players a seed
 * change flips `["Ana","Ben"]` to `["Ben","Ana"]`, but the field — the pairing
 * and the sides — is identical, and reporting that as a change would be a lie.
 * Pairings are compared as unordered pairs for the same reason: who drew first
 * is not who plays whom.
 */
function fieldShape(f: CompetitionField): string {
  return JSON.stringify({
    allocation: f.allocation
      .map((a) => ({ sideId: a.sideId, players: [...a.players].sort() }))
      .sort((a, b) => a.sideId.localeCompare(b.sideId)),
    pairings: f.pairings
      .map((p) => [p.p1, p.p2].sort())
      .sort((a, b) => (a[0] + a[1]).localeCompare(b[0] + b[1])),
  });
}

/**
 * Draw the seeded competition field: seeding order, then allocation to
 * sides/teams, then the opening pairings.
 *
 * Deterministic in `seed` — the wizard's Regenerate button advances the seed
 * rather than calling `Math.random`, so the same seed always reproduces the
 * same field and a reload cannot silently reshuffle a confirmed one.
 */
export function deriveCompetitionField(
  playerNames: string[],
  seed: number,
  sides: CompetitionSide[] = []
): CompetitionFieldResult {
  const fail = (reason: string): CompetitionFieldResult => ({ ok: false, field: null, reason });

  const names = cleanNames(playerNames);
  if (names.length === 0) {
    return fail("The roster is empty. Add players in step 4 before verifying the competition field.");
  }
  if (names.length < MIN_BRACKET_PLAYERS) {
    return fail(
      `A competition field needs at least ${MIN_BRACKET_PLAYERS} players — the roster has ${names.length}. Add another player in step 4.`
    );
  }

  const teams = (sides || []).filter((s) => s && typeof s.label === "string" && s.label.length > 0);
  const allSized = teams.length > 0 && teams.every((t) => typeof t.size === "number" && t.size > 0);
  if (allSized) {
    const capacity = teams.reduce((n, t) => n + (t.size as number), 0);
    if (capacity < names.length) {
      return fail(
        `The sides cannot hold this field: ${names.length} players need ${names.length} seats but the sides only have ${capacity}. Adjust the roster or the team size first.`
      );
    }
  }
  if (teams.length > names.length) {
    return fail(
      `There are ${teams.length} sides but only ${names.length} players. Remove a side or add players before verifying the field.`
    );
  }

  const order = seededShuffle(names, seed);

  // Snake draft across sides: balanced, and re-derivable from the seed alone.
  const allocation = teams.map((t) => ({ sideId: t.id, label: t.label, players: [] as string[] }));
  if (allocation.length === 0) {
    allocation.push({ sideId: "field", label: "Field", players: [...order] });
  } else {
    let direction = 1;
    let cursor = 0;
    order.forEach((name, i) => {
      if (i > 0 && i % allocation.length === 0) direction *= -1;
      allocation[cursor].players.push(name);
      cursor += direction;
      if (cursor < 0) cursor = 0;
      if (cursor >= allocation.length) cursor = allocation.length - 1;
    });
  }

  const pairings: { p1: string; p2: string }[] = [];
  for (let i = 0; i < order.length; i += 2) {
    pairings.push({ p1: order[i], p2: order[i + 1] ?? "" });
  }

  return { ok: true, field: { seed, order, allocation, pairings }, reason: null };
}

/** How far ahead Regenerate looks for a genuinely different draw. */
const SEED_SEARCH_LIMIT = 64;

/**
 * Redraw the field and say what changed.
 *
 * It advances the seed until the draw actually differs, so the button cannot
 * land on an identical field and claim success — which is what happens with a
 * two-player field, where there is only one possible pairing. In that case it
 * reports `changed: false` and explains itself instead of pretending.
 */
export function regenerateCompetitionField(
  playerNames: string[],
  sides: CompetitionSide[],
  currentSeed: number
): RegenerateResult {
  const base = deriveCompetitionField(playerNames, currentSeed, sides);
  if (!base.ok) {
    return { ...base, previousSeed: currentSeed, changed: false, note: base.reason ?? "" };
  }

  for (let i = 1; i <= SEED_SEARCH_LIMIT; i++) {
    const seed = currentSeed + i;
    const next = deriveCompetitionField(playerNames, seed, sides);
    if (!next.ok) {
      return { ...next, previousSeed: currentSeed, changed: false, note: next.reason ?? "" };
    }
    if (fieldShape(next.field as CompetitionField) === fieldShape(base.field as CompetitionField)) continue;
    return {
      ok: true,
      field: next.field,
      reason: null,
      previousSeed: currentSeed,
      changed: true,
      note: describeFieldChange(base.field as CompetitionField, next.field as CompetitionField, seed),
    };
  }

  // Exhausted the search: the field is what it is (a two-player draw, most
  // likely). Report that rather than spinning the seed silently.
  const seed = currentSeed + 1;
  const same = deriveCompetitionField(playerNames, seed, sides);
  if (!same.ok) {
    return { ...same, previousSeed: currentSeed, changed: false, note: same.reason ?? "" };
  }
  return {
    ok: true,
    field: same.field,
    reason: null,
    previousSeed: currentSeed,
    changed: false,
    note: `Redrew with seed ${seed}, but with ${(base.field as CompetitionField).order.length} player${
      (base.field as CompetitionField).order.length === 1 ? "" : "s"
    } there is only one possible field — nothing changed.`,
  };
}

/** One line describing what a regeneration actually did. */
export function describeFieldChange(
  prev: CompetitionField,
  next: CompetitionField,
  seed: number
): string {
  const moved = next.order.filter((n) => prev.order.indexOf(n) !== next.order.indexOf(n));
  const sideMoved = next.allocation.filter((a) => {
    const before = prev.allocation.find((p) => p.sideId === a.sideId);
    return before && before.players.join("|") !== a.players.join("|");
  });

  const sentences = [`Redrew the field with seed ${seed}.`];
  if (moved.length > 0) {
    sentences.push(`${moved.length} seeding position${moved.length === 1 ? "" : "s"} changed.`);
  }
  if (sideMoved.length > 0) {
    sentences.push(`${sideMoved.length} side${sideMoved.length === 1 ? "" : "s"} re-allocated.`);
  }
  sentences.push(`New order: ${next.order.join(" → ")}.`);
  return sentences.join(" ");
}

/* -------------------------------------------------------------------------- */
/* Setup wizard step list                                                      */
/* -------------------------------------------------------------------------- */

export interface WizardStepDef {
  id: string;
  title: string;
  hint: string;
  /**
   * Only meaningful with competition mode on. The step stays in the list and
   * keeps its number either way — it is marked skipped, never removed, so the
   * numbering does not appear to jump under the user.
   */
  conditional?: boolean;
}

/**
 * The six setup steps.
 *
 * Step 3 carries BOTH the turn timer and the competition-mode toggle, so the
 * two are decided in one place. Step 4 is the general roster. Step 5 exists
 * only to verify the seeded competition field, which is why it is conditional.
 */
export const WIZARD_STEPS: readonly WizardStepDef[] = [
  { id: "preset", title: "Game Preset", hint: "Pick the ruleset" },
  { id: "rules", title: "Verify Rules", hint: "Win condition & target" },
  { id: "timer", title: "Turn Timer", hint: "Clock & competition mode" },
  { id: "roster", title: "Roster", hint: "Names & handicaps" },
  { id: "competition-roster", title: "Competition Roster", hint: "Verify the seeded field", conditional: true },
  { id: "launch", title: "Start Game", hint: "Review & launch" },
];

/** The step id that competition mode gates. */
export const CONDITIONAL_STEP_ID = "competition-roster";

/** Whether a given step is skipped in the current mode. */
export function isWizardStepSkipped(stepId: string, competitionMode: boolean): boolean {
  return stepId === CONDITIONAL_STEP_ID && !competitionMode;
}

export type WizardStepState = "done" | "current" | "upcoming" | "skipped";

export interface WizardRailStep extends WizardStepDef {
  /** Zero-based position. */
  index: number;
  /** Displayed number. Always `index + 1` — skipped steps keep their number. */
  number: number;
  skipped: boolean;
  /** `skipped` wins over `done`/`upcoming`, but never over `current`. */
  state: WizardStepState;
  /** e.g. `Step 5: Competition Roster — Skipped, competition mode is off` */
  label: string;
}

/**
 * The progress rail, with the conditional step marked rather than removed.
 *
 * A step that vanishes changes the meaning of every number after it, so the
 * rail always renders all six; a skipped step is dimmed and labelled. When the
 * user is standing on the skipped step it stays `current` — that is where they
 * navigated to, and the panel explains the skip in place.
 */
export function buildWizardRail(
  currentStep: number,
  competitionMode: boolean
): WizardRailStep[] {
  return WIZARD_STEPS.map((s, index) => {
    const skipped = isWizardStepSkipped(s.id, competitionMode);
    const state: WizardStepState =
      index === currentStep ? "current" : skipped ? "skipped" : index < currentStep ? "done" : "upcoming";
    const label = `Step ${index + 1}: ${s.title}${skipped ? " — Skipped, competition mode is off" : ""}`;
    return { ...s, index, number: index + 1, skipped, state, label };
  });
}

/** How the rail describes where the user is, e.g. `Step 5 of 6 · Skipped`. */
export function wizardStepIndicator(currentStep: number, competitionMode: boolean): string {
  const step = buildWizardRail(currentStep, competitionMode)[currentStep];
  const suffix = step?.skipped ? " · Skipped" : "";
  return `Step ${(step?.number ?? currentStep + 1)} of ${WIZARD_STEPS.length}${suffix}`;
}

/** The reason a conditional step is not being shown, for its own panel. */
export const COMPETITION_STEP_SKIP_MESSAGE =
  "Skipped — competition mode is off. Tick it on step 3 to verify the competition roster.";

/* -------------------------------------------------------------------------- */
/* Match history surface                                                       */
/* -------------------------------------------------------------------------- */

/** Just enough of a saved match to render an archive card. */
export interface ArchiveSummary {
  id: string;
  gameName: string;
}

/** Just enough of a match to render its round log. */
export interface RoundSummary {
  roundNumber: number;
  timestamp: number;
}

export interface HistorySurface {
  /**
   * Whether archived (other) matches belong in view.
   *
   * Two gates, both required. Competition mode owns the archive list, so with
   * it off there is nothing that *could* leak into the round view. And while a
   * match is live the list is suppressed entirely: a running match shows ONLY
   * its own round history, never a list of other matches beside it.
   */
  showArchives: boolean;
  /**
   * The live match's rounds, or `null` when no match is in play. This is the
   * ONLY round source the live surface draws on — archives are never merged
   * into it.
   */
  liveRounds: RoundSummary[] | null;
  /** Archived matches. Empty when `showArchives` is false. */
  archives: ArchiveSummary[];
}

/**
 * Split the history view into the live match's rounds and the archive list.
 *
 * The bugs this replaces: the live match was injected into the same array as
 * the saved archives, so a running match rendered as a card sitting alongside
 * every match that came before it and picking one round could resolve to
 * another match's rounds; and even once the channels were split, a live match
 * still had the archive list rendered next to its round log. Live rounds now
 * have their own channel and archives require competition mode AND no match in
 * play.
 */
export function buildHistorySurface(input: {
  matchActive: boolean;
  liveRounds: RoundSummary[];
  archives: ArchiveSummary[];
  competitionMode: boolean;
}): HistorySurface {
  const { matchActive, liveRounds, archives, competitionMode } = input;
  const showArchives = competitionMode && !matchActive;
  return {
    showArchives,
    liveRounds: matchActive ? liveRounds : null,
    archives: showArchives ? archives : [],
  };
}

/**
 * Which match a round-log surface is allowed to read from.
 *
 * While a match is live, that is the live match and nothing else. With no
 * live match, only an explicitly requested archive id resolves — an unknown
 * id resolves to `null` rather than silently falling back to some other
 * match's rounds.
 */
export function resolveRoundSource(
  surface: HistorySurface,
  requestedId: string | null
): { matchId: string; rounds: RoundSummary[] } | null {
  if (surface.liveRounds) {
    return { matchId: "__live__", rounds: surface.liveRounds };
  }
  if (!requestedId) return null;
  const found = surface.archives.find((a) => a.id === requestedId);
  if (!found) return null;
  return { matchId: found.id, rounds: [] };
}