/**
 * Game Score Tracker preset catalogue — pure data + pure helpers.
 *
 * The rules used to live as literals inside `GameScoreTracker.tsx`, where
 * nothing could assert anything about them. This module is the single source
 * of truth for:
 *
 *   1. Preset data (player counts, win condition, target, teams, and the
 *      special terminal conditions a plain "highest score" model cannot
 *      express).
 *   2. Team maths — which presets are team games, how players map onto teams,
 *      and how member scores roll up into a team total.
 *   3. Graceful degradation for stored matches whose preset no longer exists.
 *
 * Boundary, deliberately: this is a SCORE tracker. Nothing here is a rules
 * engine. "Shuffle 52 cards", "validate a carrom board", "detect checkmate"
 * are all out of scope. What IS in scope is representing the terminal
 * conditions structurally so the user is told at the moment they pick a game,
 * and offering an explicit "end this round" control for the games that end on
 * something other than a score threshold.
 */

/** Which direction wins. `lowest` is used by shed / lose-a-point games. */
export type WinCondition = "highest" | "lowest";

/**
 * What a special condition does, which decides how the UI offers it.
 *
 * - `rule` — a rule that changes how points should be entered (surfaced as a
 *   reminder; never auto-applied).
 * - `penalty` — a point deduction the user may need to enter mid-round.
 * - `instant_win` — ends the round immediately regardless of score. The UI
 *   renders a button for these.
 */
export type SpecialConditionKind = "rule" | "penalty" | "instant_win";

export interface GameSpecialCondition {
  /** Stable id, used for test assertions and as a React key. */
  id: string;
  /** Short label shown on the card. */
  label: string;
  kind: SpecialConditionKind;
  /** The rule itself, in the game's own vocabulary. */
  detail: string;
}

export interface GameTeam {
  /** Stable id — this is what a Player's `teamId` points at. */
  id: string;
  /** Display label, e.g. "White". */
  label: string;
  /** How many players per side. */
  size: number;
  /** Optional swatch for the team badge. */
  color?: string;
}

export interface GamePlayerCount {
  /** Fewest players the game can be played with. */
  min: number;
  /** Most players. */
  max: number;
  /** What the wizard offers as a starting roster. */
  default: number;
  /** Short form, e.g. "2 or 4 (2v2)". */
  label: string;
}

export interface GamePreset {
  id: string;
  name: string;
  type: "board" | "card" | "custom" | "word";
  winCondition: WinCondition;
  /**
   * Numeric win threshold, or `undefined` for games whose win condition is
   * structural (first to an empty hand, checkmate). `undefined` is shown to
   * the user as "No limit — win by the rule below", never silently as 0.
   */
  targetScore?: number;
  /** Why `targetScore` is the number it is, when it is not obvious. */
  targetRationale?: string;
  categories?: string[];
  turnTimerSeconds?: number;
  description: string;
  iconName: string;
  playerCount: GamePlayerCount;
  /**
   * Present only for team games. Individual games (Chess, Digu, Uno) omit it
   * entirely — that absence is what `isTeamGame` keys off, so it must not be
   * set to `[]` as a placeholder.
   */
  teams?: GameTeam[];
  /** Rules that a bare score total cannot express. */
  specialConditions?: GameSpecialCondition[];
  /**
   * Rules the tracker genuinely cannot model. Rendered verbatim so a rule is
   * never dropped on the floor between the game and the number.
   */
  notes?: string[];
}

/* -------------------------------------------------------------------------- */
/* Team presets                                                                */
/* -------------------------------------------------------------------------- */

const CARROM_TEAMS: GameTeam[] = [
  { id: "carrom-white", label: "White", size: 2, color: "#e5e7eb" },
  { id: "carrom-black", label: "Black", size: 2, color: "#374151" },
];

const TEAM_1_VS_2: GameTeam[] = [
  { id: "team-1", label: "Team 1", size: 2, color: "#3b82f6" },
  { id: "team-2", label: "Team 2", size: 2, color: "#ef4444" },
];

const PARTNERSHIP: GameTeam[] = [
  { id: "partners-a", label: "Partnership", size: 2, color: "#8b5cf6" },
  { id: "partners-b", label: "Opponents", size: 2, color: "#f59e0b" },
];

/* -------------------------------------------------------------------------- */
/* Catalogue                                                                   */
/* -------------------------------------------------------------------------- */

export const GAME_PRESETS: GamePreset[] = [
  {
    id: "carrom",
    name: "Carrom",
    type: "board",
    winCondition: "highest",
    targetScore: 9,
    targetRationale: "9 is your nine non-Queen pieces. The Queen is a separate condition, not a 10th point.",
    turnTimerSeconds: 30,
    iconName: "⚫",
    description:
      "2 or 4 players (2v2). Pocket all nine of your pieces AND the red Queen, using the heavy striker.",
    playerCount: { min: 2, max: 4, default: 4, label: "2 or 4 (2v2)" },
    teams: CARROM_TEAMS,
    specialConditions: [
      {
        id: "carrom-colour-set",
        label: "First pocket sets the colour",
        kind: "rule",
        detail: "The first piece pocketed by each side fixes that side as White or Black for the rest of the board.",
      },
      {
        id: "carrom-queen-cover",
        label: "Queen cover window",
        kind: "rule",
        detail:
          "The Queen only counts if you also pocket one of YOUR OWN pieces — on the same turn, or on the immediately following shot. Nothing else scores while the Queen sits loose.",
      },
      {
        id: "carrom-extra-turn",
        label: "Extra turn on a pocket",
        kind: "rule",
        detail: "Pocketing any piece earns another shot; the striker's pocket does not.",
      },
      {
        id: "carrom-striker-penalty",
        label: "Striker penalty −1",
        kind: "penalty",
        detail: "Pocketing the striker costs one piece. Enter it as −1 in the round.",
      },
      {
        id: "carrom-board-clear",
        label: "Board cleared",
        kind: "instant_win",
        detail: "All nine of your pieces plus the red Queen are pocketed. Nothing the tracker can detect — end the round yourself.",
      },
    ],
    notes: [
      "One point = one piece pocketed. The Queen is tracked as its own condition, not as a 10th point, so a board cleared without the covered Queen is not a win.",
      "Scores here are per player. Team totals add both partners, which is what decides the side — a 4+4 board is an 8.",
    ],
  },
  {
    id: "chess",
    name: "Chess",
    type: "board",
    winCondition: "highest",
    targetScore: 1,
    targetRationale: "Chess has no score. 1 is used purely as a 'the match is over' marker — one checkmate wins.",
    turnTimerSeconds: 300,
    iconName: "♟️",
    description: "2 players. 8x8, 16 pieces each, unique movement per piece. Win by checkmate.",
    playerCount: { min: 2, max: 2, default: 2, label: "2" },
    specialConditions: [
      {
        id: "chess-check",
        label: "Check — king threatened",
        kind: "rule",
        detail: "A King under attack must be moved out of threat on the very next move, or the move is illegal.",
      },
      {
        id: "chess-checkmate",
        label: "Checkmate",
        kind: "instant_win",
        detail: "King threatened with no legal escape. The tracker cannot detect this — end the round from the button below.",
      },
    ],
    notes: [
      "There is no running score in chess. The target of 1 is a stop signal, not a point count; leave it alone and use the Checkmate button when the game ends.",
      "Points captured (material) can be tracked in a round if you want it, but it does not decide the result.",
    ],
  },
  {
    id: "hukum-thaas",
    name: "Hukum Thaas (Court Piece)",
    type: "card",
    winCondition: "highest",
    targetScore: 7,
    targetRationale: "7 tricks wins the round, exactly as the game's own rule states.",
    turnTimerSeconds: 45,
    iconName: "🃏",
    description: "4 players (2v2) on a 52-card deck. First side to 7 tricks takes the round.",
    playerCount: { min: 4, max: 4, default: 4, label: "4 (2v2)" },
    teams: TEAM_1_VS_2,
    specialConditions: [
      {
        id: "hokm-trump-caller",
        label: "Trump Caller declares trump",
        kind: "rule",
        detail: "The Trump Caller names trump from their first 5 cards; only then are all 13 cards dealt to every player.",
      },
      {
        id: "hokm-follow-suit",
        label: "Follow the led suit",
        kind: "rule",
        detail: "Play the led suit if you hold it. The highest of the led suit takes the trick unless trump is played.",
      },
      {
        id: "hokm-koatey",
        label: "Koatey — shutout",
        kind: "instant_win",
        detail: "Winning the first 7 tricks in a row wins the hand outright. End the round from the button below.",
      },
    ],
    notes: [
      "The team total is the winning number: 7 tricks for a side, not 7 per player.",
      "Card-by-card legality (suit follow, trump) is not checked by this tracker — call the tricks yourself.",
    ],
  },
  {
    id: "digu",
    name: "Digu (Sequence Rummy)",
    type: "card",
    winCondition: "highest",
    targetScore: undefined,
    targetRationale: "No numeric target exists: Digu is won by emptying your hand first, not by reaching a score.",
    turnTimerSeconds: 90,
    iconName: "🂠",
    description: "4 individual players. Two 52-card decks combined. Draw, meld, discard, repeat — first to an empty hand wins.",
    playerCount: { min: 2, max: 4, default: 4, label: "4 individual" },
    specialConditions: [
      {
        id: "digu-loop",
        label: "Draw 1 · meld · discard 1",
        kind: "rule",
        detail: "Each turn: draw one card, meld any valid set, discard one card.",
      },
      {
        id: "digu-meld-shapes",
        label: "Valid melds",
        kind: "rule",
        detail: "Three or more of a kind, or consecutive cards all in one suit.",
      },
      {
        id: "digu-long-run-bonus",
        label: "Long runs bonus",
        kind: "rule",
        detail: "Exceptionally long sequences score far more than a normal run — enter the run's own value, this tracker does not compute it.",
      },
    ],
    notes: [
      "This is a 4-player INDIVIDUAL game — there are no teams and no team total.",
      "The win condition is an empty hand. There is no target score, so the tracker will not declare a winner on points; end the round when a hand is cleared.",
      "Melds and drops are not validated here. Use a round to log points when a player is finally out.",
    ],
  },
  {
    id: "dihaeh",
    name: "Dihaeh (Tens)",
    type: "card",
    winCondition: "highest",
    targetScore: 7,
    targetRationale: "7 total tricks takes the hand, matching the game's own win condition.",
    turnTimerSeconds: 45,
    iconName: "🔟",
    description: "4 players (2v2). Win the hand on 7 total tricks, or by taking 3+ of the 4 Tens.",
    playerCount: { min: 4, max: 4, default: 4, label: "4 (2v2)" },
    teams: TEAM_1_VS_2,
    specialConditions: [
      {
        id: "dihaeh-follow-suit",
        label: "Follow the led suit",
        kind: "rule",
        detail: "Play the led suit if you hold it; the leader leads again.",
      },
      {
        id: "dihaeh-tens-edge",
        label: "3 of 4 Tens — automatic edge",
        kind: "rule",
        detail: "Capturing three of the four Tens puts you ahead on points regardless of the trick count.",
      },
      {
        id: "dihaeh-baga",
        label: "Baga — all 4 Tens",
        kind: "instant_win",
        detail: "Taking all four Tens wins the hand instantly. End the round from the button below.",
      },
      {
        id: "dihaeh-hukunbunye",
        label: "Hukunbunye — all 13 tricks",
        kind: "instant_win",
        detail: "Taking every one of the 13 tricks wins the hand instantly. End the round from the button below.",
      },
    ],
    notes: [
      "The team total is the winning number. A side that takes 4+3 tricks has 7 and wins on the count; a side that sweeps the 4 Tens wins regardless.",
      "Trick counting and suit legality are called by you — the tracker only totals what you enter.",
    ],
  },
  {
    id: "uno",
    name: "Uno / Lucky Seven",
    type: "card",
    winCondition: "highest",
    targetScore: undefined,
    targetRationale: "No numeric target exists: Uno is won by discarding your last card, not by reaching a score.",
    turnTimerSeconds: 30,
    iconName: "🃏",
    description: "2–10 players. First to discard every card wins. Match the top card by number, colour or suit.",
    playerCount: { min: 2, max: 10, default: 4, label: "2–10 individual" },
    specialConditions: [
      {
        id: "uno-match-top",
        label: "Match the top card",
        kind: "rule",
        detail: "Your discard must match the top card by number, colour or suit.",
      },
      {
        id: "uno-action-cards",
        label: "Action cards",
        kind: "rule",
        detail: "Skip turns, reverse direction, or force the next player to draw (Draw 2 / Draw 4).",
      },
      {
        id: "uno-call-out",
        label: "Shout UNO! at one card",
        kind: "rule",
        detail: "Call it when you are down to your final card, before the next player acts.",
      },
      {
        id: "uno-missed-call",
        label: "Missed UNO! — draw 2",
        kind: "penalty",
        detail: "Caught not calling it with one card left means drawing 2. Enter the −2 when it happens.",
      },
    ],
    notes: [
      "Merged with the old 'Uno / Crazy Eights' preset — both are single-deck shedding games with the same match shape, so two near-identical entries only confused people. House variants (a played 8 acts as a wild, Crazy Eights-style) change the action cards, not the score model.",
      "The win condition is an empty hand, so there is no target score and the tracker will not call a winner on points. End the round yourself when the first hand empties.",
      "This is an individual game — N players, N scores, no teams.",
    ],
  },
  {
    id: "7wonders",
    name: "7 Wonders",
    type: "board",
    winCondition: "highest",
    targetScore: 50,
    turnTimerSeconds: 180,
    iconName: "🏛️",
    description: "2–7 players. Draft, build wonders, score on military, science, commerce and points symbols.",
    playerCount: { min: 2, max: 7, default: 4, label: "2–7 individual" },
    categories: ["Military", "Science", "Commerce", "Civilization"],
    notes: ["Scored individually — no teams."],
  },
  {
    id: "hearts-spades",
    name: "Hearts / Spades / Euchre",
    type: "card",
    winCondition: "lowest",
    targetScore: 100,
    turnTimerSeconds: 45,
    iconName: "❤️",
    description: "4 players as two partnerships. Trick-taking games scored against you, first side over the limit loses.",
    playerCount: { min: 4, max: 4, default: 4, label: "4 (2v2)" },
    teams: PARTNERSHIP,
    notes: [
      "Converted to two partnerships: the trick-taking winner is the SIDE, so a single per-player score is the wrong unit. Team totals now decide, and each partner's own score is still shown.",
      "Stored matches from before the conversion have no team data and keep showing individual scores only — nothing in past history changes.",
    ],
  },
  {
    id: "scrabble",
    name: "Scrabble / Boggle",
    type: "word",
    winCondition: "highest",
    targetScore: 100,
    turnTimerSeconds: 180,
    iconName: "🔤",
    description: "2–4 players. Word-building and word-spotting, played to a fixed number of turns.",
    playerCount: { min: 2, max: 4, default: 2, label: "2–4 individual" },
    categories: ["Tiles banked", "Word bonuses"],
    notes: ["Scored individually — no teams."],
  },
  {
    id: "custom",
    name: "Custom Game Tracker",
    type: "custom",
    winCondition: "highest",
    targetScore: 10,
    turnTimerSeconds: 60,
    iconName: "🎲",
    description: "Blank slate. Set your own win condition, target, categories, timer and roster.",
    playerCount: { min: 2, max: 10, default: 3, label: "2–10 individual" },
    notes: ["Everything on the setup steps is editable from here."],
  },
];

/**
 * Presets that were removed from the picker.
 *
 * Kept as data rather than deleted outright because a `localStorage` match
 * saved before the removal still names one of these. The history view resolves
 * through `resolveMatchGameName`, which falls back to the stored name, so an
 * old match reads correctly instead of throwing.
 */
export const REMOVED_PRESET_IDS = ["catan", "ticket-to-ride", "carcassonne"] as const;

export type RemovedPresetId = (typeof REMOVED_PRESET_IDS)[number];

export const REMOVED_PRESET_NAMES: Record<RemovedPresetId, string> = {
  catan: "Settlers of Catan",
  "ticket-to-ride": "Ticket to Ride",
  carcassonne: "Carcassonne",
};

/* -------------------------------------------------------------------------- */
/* Category matrix                                                             */
/* -------------------------------------------------------------------------- */

export interface CategorySettings {
  enabled: boolean;
  categories: string[];
}

/**
 * What the category matrix should hold for a given preset.
 *
 * This exists because of a real bug: `categories` used to initialise to `[]`
 * and only ever be filled inside `applyPreset`, which fires on a preset
 * *swap*. The first preset was selected but never applied, so its categories
 * were never seeded — the panel opened empty under a caption naming a game
 * that declared four categories, and the only way to get chips was to type
 * them in by hand. Computing the settings from the preset makes the initial
 * render and every later swap go through the same path.
 */
export function categorySettingsForPreset(preset: GamePreset | undefined | null): CategorySettings {
  const declared = preset?.categories ?? [];
  return { enabled: declared.length > 0, categories: [...declared] };
}

/**
 * Append a custom category name, trimmed and de-duplicated.
 *
 * Blank entries are dropped and repeats ignored, so the same name cannot end
 * up on screen twice — which is how the chips came to read "BB", "BB".
 */
export function addCategory(existing: string[], raw: string): string[] {
  const name = (raw ?? "").trim();
  if (!name) return existing;
  if (existing.some((c) => c.trim().toLowerCase() === name.toLowerCase())) return existing;
  return [...existing, name];
}

/* -------------------------------------------------------------------------- */
/* Lookups                                                                     */
/* -------------------------------------------------------------------------- */

const BY_ID = new Map<string, GamePreset>(GAME_PRESETS.map((p) => [p.id, p]));

/** The preset with this id, or `undefined` if it was never added or is gone. */
export function getPresetById(id: string): GamePreset | undefined {
  return BY_ID.get(id);
}

/** True when the preset is played as sides rather than as loose individuals. */
export function isTeamGame(preset: GamePreset | undefined | null): boolean {
  return !!preset && Array.isArray(preset.teams) && preset.teams.length > 0;
}

/** The sides for a preset, or `[]` for an individual game. */
export function getTeams(preset: GamePreset | undefined | null): GameTeam[] {
  return isTeamGame(preset) ? (preset!.teams ?? []) : [];
}

/* -------------------------------------------------------------------------- */
/* Team assignment                                                             */
/* -------------------------------------------------------------------------- */

/** The minimum shape a player record needs for team maths. */
export interface TeamMember {
  id: string;
  /** Which side this player is on. Absent = not yet assigned. */
  teamId?: string;
}

/**
 * Spread `count` players across the preset's sides, filling each side to its
 * size before moving to the next. Carrom's 2v2 becomes White, White, Black,
 * Black rather than White, Black, White, Black.
 *
 * Pure: returns new ids rather than mutating anything.
 */
export function assignTeamsRoundRobin(
  teamIds: string[],
  count: number,
  teamSizes?: number[]
): string[] {
  if (teamIds.length === 0) return Array.from({ length: Math.max(0, count) }, () => "");

  const out: string[] = [];
  // Walk a cursor across the sides in declaration order, filling each to its
  // declared size before advancing. Plain `i % teamIds.length` would interleave
  // the sides and seat a player's own partner against them.
  let side = 0;
  let filled = 0;
  for (let i = 0; i < count; i++) {
    if (filled >= Math.max(1, teamSizes?.[side] ?? 1)) {
      side = (side + 1) % teamIds.length;
      filled = 0;
    }
    out.push(teamIds[side] ?? teamIds[0]);
    filled++;
  }
  return out;
}

/** Every team id in declaration order. */
export function teamIds(preset: GamePreset | undefined | null): string[] {
  return getTeams(preset).map((t) => t.id);
}

/**
 * Normalise a roster onto the preset's sides: assign anyone unassigned, and
 * drop assignments that name a side which no longer exists.
 */
export function normalizeTeamAssignments(
  players: TeamMember[],
  preset: GamePreset | undefined | null
): TeamMember[] {
  const ids = teamIds(preset);
  if (ids.length === 0) return players.map((p) => ({ id: p.id }));

  const defaults = assignTeamsRoundRobin(ids, players.length, getTeams(preset).map((t) => t.size));
  return players.map((p, i) => {
    const teamId = p.teamId && ids.includes(p.teamId) ? p.teamId : defaults[i];
    return { id: p.id, teamId };
  });
}

/* -------------------------------------------------------------------------- */
/* Team roll-up                                                                */
/* -------------------------------------------------------------------------- */

export interface TeamStanding {
  teamId: string;
  label: string;
  color?: string;
  /** Sum of the member scores. */
  total: number;
  /** Ids of the players on this side, in roster order. */
  memberIds: string[];
  /** Each member's own score, keyed by player id — kept so the individual
   *  breakdown survives the roll-up rather than being replaced by it. */
  memberScores: Record<string, number>;
}

/**
 * Roll member scores up to their team, preserving both numbers.
 *
 * Players with no team, or a team id the preset does not declare, are ignored
 * here — they still carry an individual score, they just do not contribute to
 * a side that does not exist.
 */
export function computeTeamStandings(
  preset: GamePreset | undefined | null,
  players: TeamMember[],
  playerTotals: Record<string, number>
): TeamStanding[] {
  const teams = getTeams(preset);
  if (teams.length === 0) return [];

  return teams.map((team) => {
    const members = players.filter((p) => p.teamId === team.id);
    const memberScores: Record<string, number> = {};
    let total = 0;
    for (const m of members) {
      const score = playerTotals[m.id] ?? 0;
      memberScores[m.id] = score;
      total += score;
    }
    return {
      teamId: team.id,
      label: team.label,
      color: team.color,
      total,
      memberIds: members.map((m) => m.id),
      memberScores,
    };
  });
}

/** Total players the preset's sides expect between them. */
export function expectedTeamSize(preset: GamePreset | undefined | null): number {
  return getTeams(preset).reduce((n, t) => n + t.size, 0);
}

/* -------------------------------------------------------------------------- */
/* Special conditions                                                          */
/* -------------------------------------------------------------------------- */

/** Conditions that end a round on something other than the score target. */
export function instantWinConditions(preset: GamePreset | undefined | null): GameSpecialCondition[] {
  return (preset?.specialConditions ?? []).filter((c) => c.kind === "instant_win");
}

/** Everything the tracker cannot model, for display at setup time. */
export function presetNotes(preset: GamePreset | undefined | null): string[] {
  return preset?.notes ?? [];
}

/* -------------------------------------------------------------------------- */
/* Stored-match degradation                                                   */
/* -------------------------------------------------------------------------- */

/** The parts of a saved match needed to name its game. */
export interface StoredMatchRef {
  /** Preset id, present on matches saved after the catalogue moved out. */
  gameId?: string;
  /** The name captured when the match was played. */
  gameName?: string;
}

export interface ResolvedMatchGame {
  /** Always safe to render. Never empty. */
  name: string;
  /** True when the name came from the stored record rather than a live preset. */
  degraded: boolean;
}

/**
 * Name the game on a stored match without ever throwing.
 *
 * Old matches predate `gameId` and only carry `gameName`; newer ones carry
 * both. A match whose preset has since been removed, and which somehow has no
 * stored name either, degrades to a readable placeholder instead of crashing
 * the history view.
 */
export function resolveMatchGame(ref: StoredMatchRef | null | undefined): ResolvedMatchGame {
  const stored = typeof ref?.gameName === "string" ? ref.gameName.trim() : "";

  if (ref?.gameId) {
    const preset = getPresetById(ref.gameId);
    if (preset) return { name: preset.name, degraded: false };
    // Removed preset: the name written at save time is still the right answer.
    if (stored) return { name: stored, degraded: true };
  }

  if (stored) return { name: stored, degraded: true };
  return { name: "Unknown game", degraded: true };
}