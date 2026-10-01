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
   * Whether archived (other) matches belong in view. Competition mode owns
   * the archive list, so with it off there is nothing that *could* leak into
   * the live match's round view.
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
 * The bug this replaces: the live match was injected into the same array as
 * the saved archives, so a running match rendered as a card sitting alongside
 * every match that came before it, and picking one round could resolve to
 * another match's rounds. Live rounds now have their own channel and archives
 * are gated on competition mode.
 */
export function buildHistorySurface(input: {
  matchActive: boolean;
  liveRounds: RoundSummary[];
  archives: ArchiveSummary[];
  competitionMode: boolean;
}): HistorySurface {
  const { matchActive, liveRounds, archives, competitionMode } = input;
  return {
    showArchives: competitionMode,
    liveRounds: matchActive ? liveRounds : null,
    archives: competitionMode ? archives : [],
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