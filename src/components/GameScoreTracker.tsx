import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, AnimatePresence } from "motion/react";
import { isSoundEffectsEnabled } from "../lib/featureToggles";
import {
  advanceTurnTimer,
  createTurnTimerState,
  resetTurnTimer,
  type TurnTimerState,
} from "../lib/turnTimer";
import {
  Trophy,
  Flame,
  Clock,
  Plus,
  Minus,
  RotateCcw,
  Sparkles,
  Award,
  Swords,
  Users,
  Play,
  Pause,
  Volume2,
  VolumeX,
  Zap,
  CheckCircle2,
  Trash2,
  Share2,
  Crown,
  History,
  Medal,
  ChevronRight,
  ShieldAlert,
  Dices,
  BarChart3,
  X,
  PlusCircle,
  HelpCircle,
  AlertTriangle,
  Maximize2,
  Minimize2,
  ChevronLeft,
  ArrowLeft,
  Target,
  Lock,
  Timer,
  Settings2
} from "lucide-react";
import { toast } from "react-hot-toast";

import {
  GAME_PRESETS,
  addCategory,
  categorySettingsForPreset,
  computeTeamStandings,
  getTeams,
  instantWinConditions,
  isTeamGame,
  normalizeTeamAssignments,
  resolveMatchGame,
  type GamePreset,
  type GameTeam,
  type TeamStanding,
} from "../lib/gamePresets";
import {
  buildHistorySurface,
  buildWizardRail,
  COMPETITION_STEP_SKIP_MESSAGE,
  deriveBracket,
  deriveCompetitionField,
  regenerateCompetitionField,
  resolveRoundSource,
  sanitizeStoredBracket,
  shouldShowTournament,
  wizardStepIndicator,
  WIZARD_STEPS,
  type CompetitionField,
} from "../lib/trackerSurfaces";

export { GAME_PRESETS };
export type { GamePreset };

export interface Player {
  id: string;
  name: string;
  color: string;
  handicap?: number;
  totalTimeSeconds: number;
  /**
   * Which side this player is on, for team presets (Carrom's White, Hukum
   * Thaas' Team 1, Dihaeh's Team 2...). Absent on individual games, and
   * absent on matches saved before teams existed — both are normal, not
   * errors.
   */
  teamId?: string;
}

export interface RoundScore {
  roundNumber: number;
  timestamp: number;
  playerScores: Record<string, number>; // playerId -> round score
  categoryBreakdown?: Record<string, Record<string, number>>; // playerId -> category -> score
}

export interface MatchHistoryEntry {
  id: string;
  gameName: string;
  /**
   * The preset id this match was played under. Written from now on; older
   * records only have `gameName`. History renders through `resolveMatchGame`,
   * which falls back to the stored name when the preset has been removed, so
   * a match saved against a retired preset still displays instead of throwing.
   */
  gameId?: string;
  /** The sides in play, snapshotted at save time. */
  teams?: { id: string; label: string }[];
  /** Team roll-up, kept alongside the per-player breakdown, not instead of it. */
  teamScores?: { id: string; label: string; total: number }[];
  date: string;
  competitionMode: boolean;
  winnerName: string;
  winnerScore: number;
  players: { name: string; score: number; rank: number }[];
  durationMinutes: number;
  /** Parallel to `players` — lets the round log resolve player ids to names. */
  playerIds?: string[];
  /** Per-round log. Drives the nested Round History sub-tab. */
  rounds?: RoundScore[];
  /** How many rounds this match played (0 for archives predating the log). */
  roundsPlayed?: number;
}

/**
 * The six setup steps live in `trackerSurfaces` as pure data so the rail, the
 * "skipped" marking and the tests can all read one list. See `WIZARD_STEPS`
 * there: step 3 carries the turn timer AND the competition-mode toggle, step 4
 * is the general roster, step 5 verifies the seeded competition field and is
 * marked skipped (not removed) when competition mode is off.
 */

/**
 * Modal confirmation. Used by the two destructive wizard paths: swapping the
 * preset (discards step 2-5 edits) and leaving the arena mid-match.
 */
function ConfirmDialog({
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  tone = "default",
  onConfirm,
  onCancel,
}: {
  title: string;
  body: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: "default" | "danger";
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Dismiss"
        onClick={onCancel}
        className="absolute inset-0 bg-black/70 backdrop-blur-sm cursor-default"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="relative w-full max-w-sm bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-3 shadow-2xl"
      >
        <h3 className="text-sm font-bold text-kindle-text flex items-center gap-2">
          {tone === "danger" && <ShieldAlert className="w-4 h-4 text-yellow-500 shrink-0" />}
          {title}
        </h3>
        <div className="text-[11px] text-kindle-text-muted leading-relaxed">{body}</div>
        <div className="flex flex-col-reverse sm:flex-row justify-end gap-2 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-11 px-4 py-2.5 bg-kindle-bg border border-kindle-border rounded-xl text-xs font-bold text-kindle-text-muted hover:text-kindle-text transition cursor-pointer"
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`min-h-11 px-4 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
              tone === "danger"
                ? "bg-yellow-500/20 border border-yellow-500/40 text-yellow-500"
                : "bg-kindle-text text-kindle-bg"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

interface GameScoreTrackerProps {
  open: boolean;
  onClose: () => void;
}

const PLAYER_COLORS = [
  "#3b82f6", // Blue
  "#ef4444", // Red
  "#10b981", // Emerald
  "#f59e0b", // Amber
  "#8b5cf6", // Purple
  "#ec4899", // Pink
  "#06b6d4", // Cyan
  "#f97316"  // Orange
];

export default function GameScoreTracker({ open, onClose }: GameScoreTrackerProps) {
  // Game Configuration State
  const [selectedPreset, setSelectedPreset] = useState<GamePreset>(GAME_PRESETS[0]);
  const [competitionMode, setCompetitionMode] = useState<boolean>(true);
  const [winCondition, setWinCondition] = useState<"highest" | "lowest">("highest");
  const [targetScore, setTargetScore] = useState<number | undefined>(10);
  // Seeded from the first preset's own declaration. Previously both started
  // empty and were only filled by applyPreset, which only fires on a preset
  // swap — so the initially-selected game's categories were never loaded and
  // the matrix opened blank, forcing hand-typed names.
  const [enableCategories, setEnableCategories] = useState<boolean>(
    () => categorySettingsForPreset(GAME_PRESETS[0]).enabled
  );
  const [categories, setCategories] = useState<string[]>(
    () => categorySettingsForPreset(GAME_PRESETS[0]).categories
  );
  const [customCategoryInput, setCustomCategoryInput] = useState<string>("");

  // Players State
  const [players, setPlayers] = useState<Player[]>([
    { id: "p1", name: "Player 1", color: PLAYER_COLORS[0], totalTimeSeconds: 0 },
    { id: "p2", name: "Player 2", color: PLAYER_COLORS[1], totalTimeSeconds: 0 },
    { id: "p3", name: "Player 3", color: PLAYER_COLORS[2], totalTimeSeconds: 0 }
  ]);
  const [newPlayerName, setNewPlayerName] = useState<string>("");

  // Active Match State
  const [matchActive, setMatchActive] = useState<boolean>(false);
  const [rounds, setRounds] = useState<RoundScore[]>([]);
  const [activePlayerIndex, setActivePlayerIndex] = useState<number>(0);
  const [matchStartTime, setMatchStartTime] = useState<number | null>(null);
  const [matchEndTime, setMatchEndTime] = useState<number | null>(null);

  // Local sound override; global toggle via featureToggles is authoritative.
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Turn Clock & Timer
  const [turnTimerSeconds, setTurnTimerSeconds] = useState<number>(60);
  const [timeRemaining, setTimeRemaining] = useState<number>(60);
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(false);
  /** Whether the turn clock runs at all (setup wizard, step 3). */
  const [turnTimerEnabled, setTurnTimerEnabled] = useState<boolean>(true);
  /**
   * Authoritative turn-clock state. A ref rather than render state: the timer
   * interval reads and writes it, and the `expired` latch is what stops the
   * expiry toast from re-firing on every subsequent tick.
   */
  const turnTimerRef = useRef<TurnTimerState>(createTurnTimerState(turnTimerSeconds));

  // Round Input Buffer
  const [roundScoresBuffer, setRoundScoresBuffer] = useState<Record<string, number>>({});
  const [roundCategoryBuffer, setRoundCategoryBuffer] = useState<Record<string, Record<string, number>>>({});

  // Navigation Tabs inside Tracker
  const [activeTab, setActiveTab] = useState<"game" | "history" | "tournament">("game");

  // ---- Setup wizard navigation (replaces the one long scrolling form) ----
    const [wizardStep, setWizardStep] = useState<number>(0);
      /**
       * Seed behind the competition field drawn on wizard step 5.
       *
       * Held as state rather than a bare `Math.random()` per render so the field is
       * stable while the user reads it, and so Regenerate can redraw deliberately
       * instead of the field reshuffling on every re-render.
       */
      const [competitionSeed, setCompetitionSeed] = useState<number>(1);
      /** Feedback from the last Regenerate click — what changed, or why nothing did. */
      const [fieldNote, setFieldNote] = useState<string | null>(null);
  /** True once the user has hand-edited a step 2-5 value. */
  const [setupTouched, setSetupTouched] = useState<boolean>(false);
  /** Preset switch waiting on a "this discards your edits" confirmation. */
  const [pendingPreset, setPendingPreset] = useState<GamePreset | null>(null);
  /** Wizard shown over a running match (the match itself is left untouched). */
  const [viewingSetup, setViewingSetup] = useState<boolean>(false);
  const [showEditSetupConfirm, setShowEditSetupConfirm] = useState<boolean>(false);

  // ---- Nested history sub-tabs: Match History > Round History ----
  const [historySubTab, setHistorySubTab] = useState<"matches" | "rounds">("matches");
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);

  // View: popup (centered, less overwhelming) or fullscreen takeover.
  // On mobile the tracker always takes the full screen (no room to float a popup).
  const [view, setView] = useState<"popup" | "fullscreen">(
    typeof window !== "undefined" && window.innerWidth < 768 ? "fullscreen" : "popup"
  );

  // History Log
  const [matchHistory, setMatchHistory] = useState<MatchHistoryEntry[]>(() => {
    try {
      const saved = localStorage.getItem("kora_game_score_history");
      return saved ? JSON.parse(saved) : [];
    } catch {
      return [];
    }
  });

  /**
   * A bracket persisted by an older build, kept only so an existing stored
   * value degrades instead of crashing. The bracket actually rendered is
   * derived from the roster on every render (see `tournamentBracket`), so a
   * stale blob can never contradict the current roster.
   */
  /**
   * Manually picked winners, keyed `"r1-<matchIndex>"` / `"finals"`.
   *
   * The bracket itself is derived, so it cannot be the thing that stores a
   * result — a `useMemo` value is recomputed from scratch and would discard
   * the pick on the next roster change. Picks are therefore held separately
   * and merged over the derived structure, which means re-deriving the bracket
   * (adding a player, say) keeps whatever the user already decided.
   */
  const [bracketPicks, setBracketPicks] = useState<Record<string, string>>({});

  const [storedBracket] = useState(() => {
    try {
      const saved = localStorage.getItem("kora_game_bracket");
      return saved ? sanitizeStoredBracket(JSON.parse(saved)) : null;
    } catch {
      return null;
    }
  });

  // Canvas Confetti Ref
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Load preset specs when preset changes
  const applyPreset = (preset: GamePreset) => {
    setSelectedPreset(preset);
    setWinCondition(preset.winCondition);
    setTargetScore(preset.targetScore);
    const catSettings = categorySettingsForPreset(preset);
    setCategories(catSettings.categories);
    setEnableCategories(catSettings.enabled);
    if (preset.turnTimerSeconds) {
      setTurnTimerSeconds(preset.turnTimerSeconds);
      armTurnClock(preset.turnTimerSeconds);
    }
    setSetupTouched(false);
  };

  /**
   * The one destructive wizard action: swapping the preset replaces the win
   * condition, target, timer and categories. If the user has already edited
   * those in steps 2-5, confirm before throwing the edits away.
   */
  const handleSelectPreset = (preset: GamePreset) => {
    if (preset.id === selectedPreset.id) return;
    if (setupTouched) {
      setPendingPreset(preset);
      return;
    }
    applyPreset(preset);
  };

  const confirmPresetSwap = () => {
    if (pendingPreset) applyPreset(pendingPreset);
    setPendingPreset(null);
  };

  /**
   * Arm the turn clock. This is the single place the clock (re)starts, and it
   * always clears the expiry latch so the next turn can report its own expiry
   * exactly once.
   */
  const armTurnClock = (seconds?: number) => {
    const next = resetTurnTimer(seconds ?? turnTimerSeconds);
    turnTimerRef.current = next;
    setTimeRemaining(next.remaining);
  };

  // Turn Timer Effect in Competition Mode
  //
  // Expiry is an EVENT, not a per-tick condition. The previous version tested
  // `timeRemaining <= 1` inside the interval and returned 0; the interval was
  // never cleared, so the very next tick re-satisfied the condition and fired
  // "Turn Time Expired!" once per second for the rest of the match. Now the
  // clock state carries an `expired` latch, the pure `advanceTurnTimer` is a
  // no-op once it is set, and the interval is cleared on expiry.
  useEffect(() => {
    if (!(matchActive && competitionMode && turnTimerEnabled && isTimerRunning)) return;

    const timer = setInterval(() => {
      const { state, events } = advanceTurnTimer(turnTimerRef.current);
      turnTimerRef.current = state;
      setTimeRemaining(state.remaining);

      for (const ev of events) {
        if (ev === "countdown" && soundEnabled) playBeepSound(400, 0.05);
        if (ev === "expired") {
          if (soundEnabled) playBeepSound(600, 0.2);
          toast("⌛ Turn Time Expired!", { icon: "⏱️" });
        }
      }

      // A normal second of clock time is logged against the active player.
      if (events.includes("tick")) {
        setPlayers((prev) =>
          prev.map((p, idx) =>
            idx === activePlayerIndex ? { ...p, totalTimeSeconds: p.totalTimeSeconds + 1 } : p
          )
        );
      }

      // Expiry ends this turn's clock. Turn rotation is unchanged — the
      // player's "Next Player Turn" tap, or the next round submission, moves
      // on; the match is not touched here.
      if (events.includes("expired")) {
        clearInterval(timer);
        setIsTimerRunning(false);
      }
    }, 1000);

    return () => clearInterval(timer);
  }, [matchActive, competitionMode, turnTimerEnabled, isTimerRunning, activePlayerIndex, soundEnabled]);

  // Play Web Audio Synth Beep
  const playBeepSound = (freq = 440, duration = 0.1) => {
    if (!soundEnabled || !isSoundEffectsEnabled()) return;
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.1, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + duration);
    } catch {
      // Audio fallback
    }
  };

  // Play Victory Sound Fanfare
  const playVictorySound = () => {
    if (!soundEnabled || !isSoundEffectsEnabled()) return;
    try {
      const notes = [523.25, 659.25, 783.99, 1046.5]; // C5, E5, G5, C6
      notes.forEach((freq, idx) => {
        setTimeout(() => playBeepSound(freq, 0.3), idx * 150);
      });
    } catch {
      // Audio fallback
    }
  };

  // Fire Native Canvas Confetti
  const triggerConfetti = () => {
    playVictorySound();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles: Array<{
      x: number;
      y: number;
      size: number;
      color: string;
      vx: number;
      vy: number;
      rotation: number;
      vRot: number;
    }> = [];

    const colors = ["#e0533c", "#f59e0b", "#10b981", "#3b82f6", "#8b5cf6", "#ec4899"];

    for (let i = 0; i < 120; i++) {
      particles.push({
        x: canvas.width / 2,
        y: canvas.height / 2,
        size: Math.random() * 8 + 4,
        color: colors[Math.floor(Math.random() * colors.length)],
        vx: (Math.random() - 0.5) * 16,
        vy: (Math.random() - 0.8) * 16,
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 0.2
      });
    }

    let animationFrameId: number;
    let frameCount = 0;

    const render = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      frameCount++;

      particles.forEach((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.3; // Gravity
        p.rotation += p.vRot;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
        ctx.restore();
      });

      if (frameCount < 160) {
        animationFrameId = requestAnimationFrame(render);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    };

    render();
  };

  // Start New Match
  const handleStartMatch = () => {
    if (players.length < 2) {
      toast.error("Add at least 2 players to begin!");
      return;
    }
    setRounds([]);
    setRoundScoresBuffer({});
    setRoundCategoryBuffer({});
    setActivePlayerIndex(0);
    setMatchStartTime(Date.now());
    setMatchEndTime(null);
    setMatchActive(true);
    setTimeRemaining(turnTimerSeconds);
    armTurnClock();
    setIsTimerRunning(competitionMode && turnTimerEnabled);
    setViewingSetup(false);
    setWizardStep(0);
    setSetupTouched(false);
    setHistorySubTab("matches");
    setSelectedMatchId(null);
    toast.success(`Match Started: ${selectedPreset.name} ${competitionMode ? "🏆 Competition Mode" : "🎲 Casual"}`);
  };

  // Calculate Cumulative Total Scores
  const getPlayerTotal = (playerId: string): number => {
    const player = players.find((p) => p.id === playerId);
    const handicap = player?.handicap || 0;
    const roundSum = rounds.reduce((sum, r) => sum + (r.playerScores[playerId] || 0), 0);
    return roundSum + handicap;
  };

  // ---- Teams -------------------------------------------------------------
  // Team games (Carrom's White/Black, Hukum Thaas and Dihaeh's Team 1/2) need a
  // side total, because the side is what actually wins: two partners on
  // opposing sides sharing one number records the wrong thing entirely. The
  // per-player score is still computed and still kept — the roll-up is added to
  // it, not substituted for it.
  //
  // These sit BELOW getPlayerTotal deliberately. `playerTotals` calls it, and a
  // useMemo body runs during the first render, so declaring the memo above the
  // function is a temporal-dead-zone crash at runtime — a failure tsc does not
  // catch, and one the browser surfaced immediately.

  /** The sides in play, or `[]` for an individual game. */
  const teamsForMatch: GameTeam[] = useMemo(() => getTeams(selectedPreset), [selectedPreset]);

  const teamGame = useMemo(() => isTeamGame(selectedPreset), [selectedPreset]);

  /** Every player's total, keyed by player id — the input to the roll-up. */
  const playerTotals: Record<string, number> = useMemo(() => {
    const out: Record<string, number> = {};
    for (const p of players) out[p.id] = getPlayerTotal(p.id);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, rounds]);

  /** Side totals, each still carrying its members' individual scores. */
  const teamStandings: TeamStanding[] = useMemo(() => {
    if (!teamGame) return [];
    return computeTeamStandings(selectedPreset, players, playerTotals);
  }, [teamGame, selectedPreset, players, playerTotals]);

  /** Terminal conditions that end a round on something other than the score. */
  const instantWins = useMemo(() => instantWinConditions(selectedPreset), [selectedPreset]);

  /** The side currently on top — what an instant win would be credited to. */
  const leadingTeamId = useMemo(() => {
    if (!teamGame || teamStandings.length === 0) return undefined;
    return [...teamStandings].sort((a, b) =>
      winCondition === "highest" ? b.total - a.total : a.total - b.total
    )[0].teamId;
  }, [teamGame, teamStandings, winCondition]);

  /** Total for one side, for the target check and the leaderboard. */
  const getTeamTotal = (teamId: string): number =>
    teamStandings.find((t) => t.teamId === teamId)?.total ?? 0;

  /** The side a player belongs to, if any. */
  const teamForPlayer = (playerId: string): GameTeam | undefined => {
    const pl = players.find((x) => x.id === playerId);
    return pl?.teamId ? teamsForMatch.find((t) => t.id === pl.teamId) : undefined;
  };

  // Get Sorted Rankings
  const getRankedPlayers = () => {
    return [...players].sort((a, b) => {
      const scoreA = getPlayerTotal(a.id);
      const scoreB = getPlayerTotal(b.id);
      return winCondition === "highest" ? scoreB - scoreA : scoreA - scoreB;
    });
  };

  // Check for Target Score Winner
  const checkWinnerCondition = (updatedRounds: RoundScore[]) => {
    if (!targetScore) return;
    const ranked = getRankedPlayers();
    const leader = ranked[0];
    const leaderScore = getPlayerTotal(leader.id);

    if (winCondition === "highest" && leaderScore >= targetScore) {
      handleFinishMatch(leader);
    } else if (winCondition === "lowest" && leaderScore >= targetScore) {
      // In lowest win games (e.g. Uno), game ends when someone hits target max, lowest score wins
      const winner = ranked[ranked.length - 1];
      handleFinishMatch(winner);
    }
  };

  // Submit Current Round Scores
  const handleSubmitRound = () => {
    const roundNumber = rounds.length + 1;
    const playerScores: Record<string, number> = {};

    players.forEach((p) => {
      if (enableCategories && categories.length > 0) {
        const catMap = roundCategoryBuffer[p.id] || {};
        const sum = Object.values(catMap).reduce((a, b) => a + b, 0);
        playerScores[p.id] = sum;
      } else {
        playerScores[p.id] = roundScoresBuffer[p.id] || 0;
      }
    });

    const newRound: RoundScore = {
      roundNumber,
      timestamp: Date.now(),
      playerScores,
      categoryBreakdown: enableCategories ? { ...roundCategoryBuffer } : undefined
    };

    const nextRounds = [...rounds, newRound];
    setRounds(nextRounds);
    setRoundScoresBuffer({});
    setRoundCategoryBuffer({});
    armTurnClock();
    playBeepSound(800, 0.15);
    toast.success(`Round ${roundNumber} Recorded!`);

    checkWinnerCondition(nextRounds);
  };

  // Undo Last Round
  const handleUndoLastRound = () => {
    if (rounds.length === 0) return;
    setRounds((prev) => prev.slice(0, -1));
    toast("Undid last round", { icon: "↩️" });
  };

  // Finish & Save Match
  const handleFinishMatch = (forcedWinner?: Player) => {
    const ranked = getRankedPlayers();
    const winner = forcedWinner || ranked[0];
    if (!winner) {
      toast.error("No players on the roster yet.");
      return;
    }
    const duration = matchStartTime ? Math.max(1, Math.round((Date.now() - matchStartTime) / 60000)) : 1;

    /**
     * A team match is won by the SIDE, not the individual. The recorded
     * `winnerScore` is therefore the side's total, and the winning side is
     * named — while the per-player list below keeps every individual score,
     * so "who scored" survives alongside "who won".
     */
    const winningTeamId = winner.teamId;
    const winnerScore = winningTeamId ? getTeamTotal(winningTeamId) : getPlayerTotal(winner.id);

    const historyEntry: MatchHistoryEntry = {
      id: "match_" + Date.now(),
      gameName: selectedPreset.name,
      // Written from now on; older archives carry only the name and still
      // render through resolveMatchGame.
      gameId: selectedPreset.id,
      teams: teamsForMatch.map((t) => ({ id: t.id, label: t.label })),
      teamScores: teamStandings.map((t) => ({ id: t.teamId, label: t.label, total: t.total })),
      date: new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }),
      competitionMode,
      winnerName: winningTeamId ? (teamsForMatch.find((t) => t.id === winningTeamId)?.label ?? winner.name) : winner.name,
      winnerScore,
      players: ranked.map((p, idx) => ({
        name: p.name,
        score: getPlayerTotal(p.id),
        rank: idx + 1
      })),
      durationMinutes: duration,
      // Store the round log with the archive so the nested Round History
      // sub-tab reads from this one store — no second data model.
      playerIds: ranked.map((p) => p.id),
      rounds: [...rounds],
      roundsPlayed: rounds.length
    };

    const nextHistory = [historyEntry, ...matchHistory];
    setMatchHistory(nextHistory);
    try {
      localStorage.setItem("kora_game_score_history", JSON.stringify(nextHistory.slice(0, 50)));
    } catch {
      // storage quota
    }

    setMatchActive(false);
    setIsTimerRunning(false);
    setMatchEndTime(Date.now());
    triggerConfetti();
  };

  // Player Management
  const handleAddPlayer = () => {
    if (!newPlayerName.trim()) return;
    const color = PLAYER_COLORS[players.length % PLAYER_COLORS.length];
    const newP: Player = {
      id: "p_" + Date.now(),
      name: newPlayerName.trim(),
      color,
      totalTimeSeconds: 0
    };
    setPlayers([...players, newP]);
    setNewPlayerName("");
    toast.success(`Player added: ${newP.name}`);
  };

  const handleRemovePlayer = (id: string) => {
    if (players.length <= 2) {
      toast.error("Game requires at least 2 players!");
      return;
    }
    setPlayers(players.filter((p) => p.id !== id));
  };

  // Quick Score Adjuster in buffer
  const handleAdjustBufferScore = (playerId: string, delta: number) => {
    setRoundScoresBuffer((prev) => ({
      ...prev,
      [playerId]: (prev[playerId] || 0) + delta
    }));
  };

  // Quick Category Adjuster in buffer
  const handleAdjustCategoryScore = (playerId: string, cat: string, delta: number) => {
    setRoundCategoryBuffer((prev) => {
      const playerCats = prev[playerId] || {};
      return {
        ...prev,
        [playerId]: {
          ...playerCats,
          [cat]: (playerCats[cat] || 0) + delta
        }
      };
    });
  };

  // Setup Wizard Navigation
  const markTouched = useCallback(() => setSetupTouched(true), []);

  /**
   * Turning competition mode off retires the tournament surface. If the user
   * was sitting on that tab it must not stay mounted pointing at a bracket
   * that no longer exists, so the view falls back to the arena.
   */
  useEffect(() => {
    if (!competitionMode && activeTab === "tournament") setActiveTab("game");
  }, [competitionMode, activeTab]);

  const goToStep = useCallback((next: number) => {
      const clamped = Math.max(0, Math.min(WIZARD_STEPS.length - 1, next));
      setWizardStep(clamped);
      setActiveTab("game");
    }, []);

    /**
     * The progress rail. Always six entries: the competition roster step is
     * MARKED skipped when competition mode is off, never removed, so "step 5"
     * still means the same thing in either mode.
     */
    const wizardRail = useMemo(() => buildWizardRail(wizardStep, competitionMode), [wizardStep, competitionMode]);
    const stepIndicator = wizardStepIndicator(wizardStep, competitionMode);

    /**
     * The seeded competition field for wizard step 5.
     *
     * A pure derivation from (roster, teams, seed) — the same inputs always give
     * the same field, so the verification step shows a stable field and
     * Regenerate has something real to change. An unusable roster comes back as
     * `{ ok: false, reason }` and the panel says why instead of drawing a field
     * from nothing.
     */
    const competitionSides = useMemo(
      () => teamsForMatch.map((t) => ({ id: t.id, label: t.label, size: t.size })),
      [teamsForMatch]
    );

    const competitionFieldResult = useMemo(
      () => deriveCompetitionField(players.map((p) => p.name), competitionSeed, competitionSides),
      [players, competitionSeed, competitionSides]
    );

    const competitionField: CompetitionField | null = competitionFieldResult.field;

    /**
     * Regenerate: redraw the seeded field and report what actually changed.
     *
     * It advances the seed until the draw genuinely differs, so the button can
     * never land on an identical field and claim success. With a field too small
     * to redraw (two players) it says so, and with an unusable roster it reports
     * the roster problem instead of regenerating anything.
     */
    const handleRegenerateField = () => {
          const result = regenerateCompetitionField(
            players.map((p) => p.name),
            competitionSides,
            competitionSeed
          );
          if (!result.ok) {
                      setFieldNote(result.reason);
                      return;
                    }
                    if (!result.field) return;
                    setCompetitionSeed(result.field.seed);
          setFieldNote(result.note);
        };

  /** Leaving the wizard mid-match keeps the match exactly as it is. */
  const returnToMatch = () => {
    setViewingSetup(false);
    setActiveTab("game");
  };

  const requestEditSetup = () => {
    if (matchActive) {
      setShowEditSetupConfirm(true);
      return;
    }
    setViewingSetup(true);
  };

  // History derivation — the live match is shaped like an archive entry so a
  // running match and a finished one render through the same list.
  /**
   * The tournament bracket is DERIVED, never snapshotted.
   *
   * Ticking competition mode is the only thing that creates it and unticking
   * is the only thing that removes it — there is no separate generate step.
   * Because it recomputes from `players`, adding or removing a player during
   * setup re-derives the pairings immediately. A stale bracket persisted by an
   * older build is read into `storedBracket` and deliberately NOT rendered:
   * it is only ever used to seed winners back onto a fresh derivation, so it
   * can never disagree with the current roster.
   */
  const tournamentBracket = useMemo(() => {
    const derived = deriveBracket(players.map((p) => p.name), competitionMode);
    if (!derived) return null;

    // Winners chosen earlier still apply, re-keyed onto the fresh pairings.
    // A stale stored bracket is only ever read here — it is never rendered, so
    // unticking competition mode cannot leave a phantom bracket on screen.
    const picks: Record<string, string> = { ...bracketPicks };
    if (storedBracket) {
      storedBracket.round1.forEach((m, i) => {
        if (m.winner && picks[`r1-${i}`] === undefined) picks[`r1-${i}`] = m.winner;
      });
      if (storedBracket.finals.winner && picks["finals"] === undefined) {
        picks["finals"] = storedBracket.finals.winner;
      }
    }

    const round1 = derived.round1.map((m, i) => ({ ...m, winner: picks[`r1-${i}`] }));
    // Final entrants follow the semi-final picks once those are known.
    const finals =
      round1.length === 0
        ? { ...derived.finals, winner: picks["finals"] }
        : {
            p1: picks["r1-0"] ?? derived.finals.p1,
            p2: picks["r1-1"] ?? derived.finals.p2,
            winner: picks["finals"],
          };

    return { players: derived.players, round1, finals };
  }, [players, competitionMode, bracketPicks, storedBracket]);

  /** Competition mode alone decides whether the tournament surface exists. */
  const showTournament = shouldShowTournament(competitionMode);

  /**
   * The live match, as its own record.
   *
   * It used to be unshifted into the front of `matchHistory` under the id
   * `__live__`, so a running match appeared as a card sitting alongside every
   * past match and the round log could resolve to another match's rounds. It
   * now lives in its own channel; archives are only ever past matches.
   */
  const liveMatch = useMemo<MatchHistoryEntry | null>(() =>
    matchActive
      ? {
          id: "__live__",
          gameName: selectedPreset.name,
          gameId: selectedPreset.id,
          date: "In progress",
          competitionMode,
          winnerName: getRankedPlayers()[0]?.name || "—",
          winnerScore: getRankedPlayers()[0] ? getPlayerTotal(getRankedPlayers()[0].id) : 0,
          players: getRankedPlayers().map((p, idx) => ({
            name: p.name,
            score: getPlayerTotal(p.id),
            rank: idx + 1,
          })),
          durationMinutes: matchStartTime
            ? Math.max(1, Math.round((Date.now() - matchStartTime) / 60000))
            : 1,
          playerIds: players.map((p) => p.id),
          rounds: [...rounds],
          roundsPlayed: rounds.length,
          teams: teamsForMatch.map((t) => ({ id: t.id, label: t.label })),
          teamScores: teamStandings.map((t) => ({ id: t.teamId, label: t.label, total: t.total })),
        }
      : null,
    [matchActive, players, rounds, selectedPreset.name, selectedPreset.id, competitionMode,
     matchStartTime, teamsForMatch, teamStandings]
  );

  /**
   * Which matches belong in the archive list, and whose rounds the history
   * surface may read. Archives are gated on competition mode, so with it off
   * there is no other-match list at all.
   */
  const historySurface = useMemo(
    () =>
      buildHistorySurface({
        matchActive,
        liveRounds: rounds,
        archives: matchHistory.map((m) => ({ id: m.id, gameName: m.gameName })),
        competitionMode,
      }),
    [matchActive, rounds, matchHistory, competitionMode]
  );

  /** Archived matches only — the live match is never in this list. */
  const historyEntries = historySurface.showArchives ? matchHistory : [];

  /** The match whose rounds the surface is showing: live first, else selected archive. */
  const selectedMatch = useMemo<MatchHistoryEntry | null>(() => {
    const src = resolveRoundSource(
      { ...historySurface, archives: historyEntries },
      selectedMatchId
    );
    if (!src) return null;
    if (src.matchId === "__live__") return liveMatch;
    return historyEntries.find((m) => m.id === src.matchId) ?? null;
  }, [historySurface, historyEntries, selectedMatchId, liveMatch]);

  const openMatchRounds = (id: string) => {
    setSelectedMatchId(id);
    setHistorySubTab("rounds");
  };

  const renderRoundLog = (m: MatchHistoryEntry) => {
    if (!m.rounds || m.rounds.length === 0) {
      return (
        <div className="py-12 text-center text-kindle-text-muted space-y-2 bg-kindle-card border border-kindle-border rounded-2xl">
          <History className="w-8 h-8 mx-auto text-kindle-text-muted/40" />
          <p className="text-xs font-bold text-kindle-text">No rounds recorded</p>
          <p className="text-[10px]">
            {m.id === "__live__"
              ? "This match is still in play — submit a round to start the log."
              : "This match ended before any round was logged."}
          </p>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        {m.rounds.map((r) => {
          const rTotals: Record<string, number> = {};
          for (const pl of m.players) rTotals[pl.name] = 0;
          m.rounds
            .slice(0, r.roundNumber)
            .forEach((rr) => {
              (m.playerIds || m.players.map((p) => p.name)).forEach((pid, i) => {
                const name = m.players[i]?.name || pid;
                rTotals[name] = (rTotals[name] || 0) + (rr.playerScores[pid] || 0);
              });
            });
          const ids = m.playerIds || m.players.map((p) => p.name);

          return (
            <div key={r.roundNumber} className="bg-kindle-card border border-kindle-border rounded-2xl p-4 space-y-2">
              <div className="flex items-center justify-between border-b border-kindle-border pb-2">
                <span className="text-xs font-bold uppercase tracking-wider text-kindle-text">Round {r.roundNumber}</span>
                <span className="text-[9px] text-kindle-text-muted">
                  {new Date(r.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </span>
              </div>
              <div className="space-y-1">
                {m.players.map((pl, i) => {
                  const gained = r.playerScores[ids[i]] || 0;
                  return (
                    <div key={pl.name} className="flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-kindle-text-muted truncate">{pl.name}</span>
                      <span className="font-mono shrink-0">
                        <span className="text-kindle-text">+{gained}</span>
                        <span className="text-kindle-text-muted"> → {rTotals[pl.name] || 0}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  if (!open) return null;

  const rankedPlayers = getRankedPlayers();
  const currentLeader = rankedPlayers[0];

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;
  const effectiveView = isMobile ? "fullscreen" : view;

  return (
    <div className={effectiveView === "fullscreen"
      ? "fixed inset-0 z-50 bg-kindle-bg flex flex-col overflow-hidden w-full h-full"
      : "fixed inset-0 z-50 bg-black/75 backdrop-blur-md flex items-center justify-center p-3 sm:p-6 overflow-y-auto"}>
      {/* Canvas Confetti Layer */}
      <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-50" />

      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 10 }}
        className={effectiveView === "fullscreen"
          ? "w-full h-full bg-kindle-bg border-0 rounded-none shadow-none overflow-hidden flex flex-col"
          : "w-full max-w-5xl bg-kindle-bg border border-kindle-border rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[94vh]"}
      >


        {/* Header Bar */}
        <div className="px-6 py-4 border-b border-kindle-border bg-kindle-card flex items-center justify-between gap-4 select-none shrink-0 kora-safe-top">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-emerald-500/10 border border-emerald-500/20 text-emerald-600 rounded-xl flex items-center justify-center text-xl shrink-0 w-10 h-10 select-none">
              {selectedPreset.iconName}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm sm:text-base font-bold text-kindle-text leading-tight">
                  Game Score Tracker
                </h2>
              </div>
              <p className="text-[10px] text-kindle-text-muted">
                Preset: {selectedPreset.name} • {winCondition === "highest" ? "Highest Score Wins" : "Lowest Score Wins"}
              </p>
            </div>
          </div>

          {/* Header Controls */}
          <div className="flex items-center gap-1">
            {!isMobile && (
              <button
                type="button"
                onClick={() => setView(view === "fullscreen" ? "popup" : "fullscreen")}
                className="p-2 hover:bg-kindle-bg border border-transparent hover:border-kindle-border rounded-xl text-kindle-text-muted hover:text-kindle-text transition cursor-pointer"
                title={view === "fullscreen" ? "Shrink to popup" : "Expand to fullscreen"}
              >
                {view === "fullscreen" ? <Minimize2 className="w-4.5 h-4.5" /> : <Maximize2 className="w-4.5 h-4.5" />}
              </button>
            )}
            <button
              type="button"
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-2 hover:bg-kindle-bg border border-transparent hover:border-kindle-border rounded-xl text-kindle-text-muted hover:text-kindle-text transition cursor-pointer"
              title={soundEnabled ? "Mute Game Audio" : "Enable Game Audio"}
            >
              {soundEnabled ? <Volume2 className="w-4.5 h-4.5" /> : <VolumeX className="w-4.5 h-4.5" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 hover:bg-kindle-bg border border-transparent hover:border-kindle-border rounded-xl text-kindle-text-muted hover:text-kindle-text transition cursor-pointer"
              title="Close Tracker"
            >
              <X className="w-4.5 h-4.5" />
            </button>
          </div>
        </div>

        {/* Tab Switcher Bar */}
        <div className="px-6 py-2.5 bg-kindle-bg border-b border-kindle-border flex items-center justify-between gap-2 overflow-x-auto text-xs shrink-0">
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab("game")}
              className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === "game"
                  ? "bg-kindle-text text-kindle-bg shadow-sm"
                  : "text-kindle-text-muted hover:text-kindle-text hover:bg-kindle-card"
              }`}
            >
              <Dices className="w-3.5 h-3.5" /> Match Arena
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("history")}
              className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === "history"
                  ? "bg-kindle-text text-kindle-bg shadow-sm"
                  : "text-kindle-text-muted hover:text-kindle-text hover:bg-kindle-card"
              }`}
            >
              <History className="w-3.5 h-3.5" /> Match History ({matchHistory.length})
            </button>
            {/* Competition mode owns the tournament surface. When it is off the
                button is not rendered at all — not hidden by CSS, not disabled —
                so there is no bracket tab to click into an empty state. */}
            {showTournament && (
              <button
                type="button"
                data-testid="tab-tournament"
                onClick={() => setActiveTab("tournament")}
                className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 cursor-pointer ${
                  activeTab === "tournament"
                    ? "bg-kindle-text text-kindle-bg shadow-sm"
                    : "text-kindle-text-muted hover:text-kindle-text hover:bg-kindle-card"
                }`}
              >
                <Trophy className="w-3.5 h-3.5 text-yellow-500" /> Tournament Bracket
              </button>
            )}
          </div>

          {matchActive && (
            <div className="flex items-center gap-2 font-mono text-[11px]">
              <span className="flex items-center gap-1 font-bold text-kindle-text">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping" />
                Live Match
              </span>
              <span className="text-kindle-text-muted">• Round {rounds.length + 1}</span>
            </div>
          )}
        </div>

        {/* Modal Main Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 pb-32 sm:pb-6">
          {activeTab === "game" && (
            <>
              {/* Setup / Configuration Wizard when match is NOT active (or when
                  the user explicitly edits setup mid-match) */}
              {!matchActive || viewingSetup ? (
                <div className="space-y-5 max-w-3xl mx-auto">

                  {/* Live-match banner: the wizard never destroys a running match. */}
                  {matchActive && (
                    <div className="flex items-center justify-between gap-3 p-3 bg-kindle-card border border-emerald-500/30 rounded-2xl">
                      <span className="text-[10px] text-kindle-text-muted flex items-center gap-1.5 min-w-0">
                        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping shrink-0" />
                        <span className="truncate">Match in progress — editing setup won&apos;t end it.</span>
                      </span>
                      <button
                        type="button"
                        onClick={returnToMatch}
                        className="shrink-0 px-3 py-1.5 bg-kindle-text text-kindle-bg rounded-xl text-[10px] font-bold cursor-pointer"
                      >
                        Back to Match
                      </button>
                    </div>
                  )}

                  {/* ---- Step indicator ---- */}
                  <div className="bg-kindle-card border border-kindle-border rounded-2xl p-4 space-y-3">
                                      <div className="flex items-baseline justify-between gap-3">
                                        <span
                                          className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted"
                                          data-testid="wizard-step-indicator"
                                        >
                                          {stepIndicator}
                                        </span>
                                        <span className="text-[9px] text-kindle-text-muted truncate">{WIZARD_STEPS[wizardStep].hint}</span>
                                      </div>

                                      {/* Tappable progress rail — a phone tap target, not just a bar.
                                          Always six segments: the conditional step is dimmed and
                                          labelled, never dropped, so the numbering cannot jump. */}
                                      <div className="flex items-center gap-1.5" role="tablist" aria-label="Setup steps">
                                        {wizardRail.map((s) => {
                                          const current = s.state === "current";
                                          return (
                                            <button
                                              key={s.id}
                                              type="button"
                                              role="tab"
                                              aria-selected={current}
                                              aria-label={s.label}
                                              title={s.label}
                                              data-testid={`wizard-step-${s.index}`}
                                              data-step-state={s.state}
                                              onClick={() => goToStep(s.index)}
                                              className={`h-1.5 flex-1 rounded-full transition cursor-pointer ${
                                                current ? "bg-kindle-accent" : s.state === "done" ? "bg-kindle-text/40" : "bg-kindle-border"
                                              } ${s.skipped && !current ? "opacity-40" : ""}`}
                                            />
                                          );
                                        })}
                                      </div>

                                      <div className="flex items-center justify-between gap-2 pt-1">
                                        <h4 className="text-sm font-bold text-kindle-text flex items-center gap-2 min-w-0">
                                          <Sparkles className="w-4 h-4 text-kindle-accent shrink-0" />
                                          <span className="truncate">{WIZARD_STEPS[wizardStep].title}</span>
                                          {wizardRail[wizardStep]?.skipped && (
                                            <span
                                              className="shrink-0 px-2 py-0.5 rounded-lg bg-kindle-bg border border-kindle-border text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted"
                                              data-testid="step-skipped-badge"
                                            >
                                              Skipped — competition mode off
                                            </span>
                                          )}
                                        </h4>
                                        {wizardStep > 0 && (
                                          <button
                                            type="button"
                                            onClick={() => goToStep(wizardStep - 1)}
                                            className="shrink-0 flex items-center gap-1 text-[10px] text-kindle-text-muted hover:text-kindle-text cursor-pointer"
                                          >
                                            <ChevronLeft className="w-3.5 h-3.5" /> Back
                                          </button>
                                        )}
                                      </div>
                                    </div>

                  {/* ---- Step panel ---- */}
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={wizardStep}
                      initial={{ opacity: 0, x: 16 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -16 }}
                      transition={{ duration: 0.15 }}
                      className="space-y-5"
                    >
                  {/* STEP 1 — Select game preset */}
                  {wizardStep === 0 && (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                        {GAME_PRESETS.map((preset) => (
                          <button
                            key={preset.id}
                            type="button"
                            onClick={() => handleSelectPreset(preset)}
                            data-testid={`preset-${preset.id}`}
                            className={`p-3.5 rounded-2xl border text-left transition duration-200 cursor-pointer flex flex-col justify-between space-y-2 min-h-[104px] ${
                              selectedPreset.id === preset.id
                                ? "bg-kindle-card border-kindle-accent ring-1 ring-kindle-accent/40 shadow-xs"
                                : "bg-kindle-bg border-kindle-border hover:border-kindle-text-muted/40"
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <span className="text-2xl">{preset.iconName}</span>
                              <span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-kindle-bg border border-kindle-border text-kindle-text-muted">
                                {preset.type}
                              </span>
                            </div>
                            <div>
                              <h5 className="text-xs font-bold text-kindle-text truncate">{preset.name}</h5>
                              <p className="text-[9px] text-kindle-text-muted line-clamp-2 mt-0.5">{preset.description}</p>
                            </div>
                          </button>
                        ))}
                      </div>
                      {setupTouched && (
                        <p className="text-[10px] text-kindle-text-muted flex items-center gap-1.5">
                          <ShieldAlert className="w-3.5 h-3.5 text-kindle-accent shrink-0" />
                          You&apos;ve edited the setup. Changing preset will ask before discarding those edits.
                        </p>
                      )}
                    </div>
                  )}

                  {/* STEP 2 — Verify win condition, target and target points */}
                  {wizardStep === 1 && (
                    <div className="space-y-4">
                      {/* ---- Special conditions, surfaced at pick time. ----
                          Several of these games end on something a single
                          number cannot express — Carrom's Queen cover, Dihaeh's
                          Baga, Hukum Thaas's Koatey, Chess's checkmate. They
                          are listed here so the rule is never silently lost,
                          and the instant-win ones get a button once the match
                          is running. */}
                      {(selectedPreset.specialConditions?.length || selectedPreset.notes?.length) ? (
                        <div
                          className="p-4 bg-kindle-card border border-kindle-border rounded-2xl space-y-3"
                          data-testid="special-conditions"
                        >
                          <h4 className="text-xs font-bold uppercase tracking-wider text-kindle-text flex items-center gap-1.5">
                            <ShieldAlert className="w-4 h-4 text-kindle-accent" /> Special Conditions
                          </h4>
                          <p className="text-[9px] text-kindle-text-muted">
                            Rules this tracker records but cannot enforce. The side scores them; you call them.
                          </p>

                          {selectedPreset.specialConditions?.map((c) => (
                            <div key={c.id} className="flex items-start gap-2 text-[11px]">
                              <span
                                className={`shrink-0 px-1.5 py-0.5 rounded text-[8px] font-bold uppercase tracking-wider ${
                                  c.kind === "instant_win"
                                    ? "bg-emerald-500/10 text-emerald-500 border border-emerald-500/20"
                                    : c.kind === "penalty"
                                      ? "bg-red-500/10 text-red-400 border border-red-500/20"
                                      : "bg-kindle-bg text-kindle-text-muted border border-kindle-border"
                                }`}
                              >
                                {c.kind === "instant_win" ? "Instant win" : c.kind === "penalty" ? "Penalty" : "Rule"}
                              </span>
                              <span className="min-w-0">
                                <strong className="text-kindle-text">{c.label}.</strong>{" "}
                                <span className="text-kindle-text-muted">{c.detail}</span>
                              </span>
                            </div>
                          ))}

                          {selectedPreset.notes?.map((note) => (
                            <p key={note} className="text-[10px] text-kindle-text-muted flex items-start gap-1.5">
                              <span className="shrink-0">—</span>
                              <span className="min-w-0">{note}</span>
                            </p>
                          ))}
                        </div>
                      ) : null}

                      <div className="p-4 bg-kindle-card border border-kindle-border rounded-2xl space-y-4">
                        <div className="flex items-center justify-between gap-2 border-b border-kindle-border pb-3">
                          <h4 className="text-xs font-bold uppercase tracking-wider text-kindle-text flex items-center gap-1.5">
                            <Target className="w-4 h-4 text-kindle-accent" /> Win Condition
                          </h4>
                          <span className={`text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded ${
                            winCondition === selectedPreset.winCondition
                              ? "bg-kindle-accent/10 text-kindle-accent border border-kindle-accent/20"
                              : "bg-yellow-500/10 text-yellow-500 border border-yellow-500/20"
                          }`}>
                            {winCondition === selectedPreset.winCondition ? "From preset" : "Edited"}
                          </span>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                          <button
                            type="button"
                            onClick={() => { setWinCondition("highest"); markTouched(); }}
                            data-testid="win-highest"
                            className={`py-2.5 text-xs font-bold rounded-xl border transition cursor-pointer ${
                              winCondition === "highest"
                                ? "bg-kindle-accent text-kindle-bg border-kindle-accent"
                                : "bg-kindle-bg text-kindle-text-muted border-kindle-border"
                            }`}
                          >
                            Highest Wins
                          </button>
                          <button
                            type="button"
                            onClick={() => { setWinCondition("lowest"); markTouched(); }}
                            data-testid="win-lowest"
                            className={`py-2.5 text-xs font-bold rounded-xl border transition cursor-pointer ${
                              winCondition === "lowest"
                                ? "bg-kindle-accent text-kindle-bg border-kindle-accent"
                                : "bg-kindle-bg text-kindle-text-muted border-kindle-border"
                            }`}
                          >
                            Lowest Wins
                          </button>
                        </div>

                        <div className="flex items-center justify-between gap-3 pt-2 border-t border-kindle-border">
                          <span className="text-xs font-bold text-kindle-text">Target Points:</span>
                          <input
                            type="number"
                            value={targetScore ?? ""}
                            data-testid="target-score"
                            onChange={(e) => { setTargetScore(e.target.value ? parseInt(e.target.value, 10) : undefined); markTouched(); }}
                            placeholder="No Limit"
                            className="w-24 px-2 py-2 bg-kindle-bg border border-kindle-border rounded-xl text-xs font-mono text-center font-bold text-kindle-text focus:outline-none focus:border-kindle-accent"
                          />
                        </div>
                        <p className="text-[9px] text-kindle-text-muted leading-snug">
                          {selectedPreset.name} suggests {winCondition === "highest" ? "highest" : "lowest"} score
                          {selectedPreset.targetScore ? ` at ${selectedPreset.targetScore} points` : " with no target limit"}.
                          Confirm or correct it here.
                        </p>
                      </div>

                      {/* Categories come from the preset but stay editable on this step. */}
                      <div className="bg-kindle-card border border-kindle-border rounded-2xl p-4 space-y-3">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted">
                            Multi-Category Matrix
                          </label>
                          <button
                            type="button"
                            onClick={() => { setEnableCategories(!enableCategories); markTouched(); }}
                            data-testid="toggle-categories"
                            role="switch"
                            aria-checked={enableCategories}
                            aria-label="Toggle multi-category matrix"
                            className={`w-9 h-5 rounded-full p-0.5 transition cursor-pointer ${enableCategories ? "bg-kindle-accent" : "bg-kindle-border"}`}
                          >
                            <div className={`w-4 h-4 rounded-full bg-black transform transition ${enableCategories ? "translate-x-4" : "translate-x-0"}`} />
                          </button>
                        </div>

                        {enableCategories && (
                          <div className="space-y-2">
                            <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                              {categories.map((cat, idx) => (
                                <span key={idx} className="px-2 py-0.5 bg-kindle-bg border border-kindle-border rounded-lg text-[9px] font-bold text-kindle-text flex items-center gap-1">
                                  {cat}
                                  <button
                                    type="button"
                                    onClick={() => { setCategories(categories.filter((_, i) => i !== idx)); markTouched(); }}
                                    className="text-kindle-text-muted hover:text-red-400 cursor-pointer"
                                    aria-label={`Remove ${cat}`}
                                  >×</button>
                                </span>
                              ))}
                            </div>
                            <div className="flex gap-1">
                              <input
                                type="text"
                                value={customCategoryInput}
                                onChange={(e) => setCustomCategoryInput(e.target.value)}
                                placeholder="Add custom category..."
                                aria-label="Custom category name"
                                className="flex-1 min-w-0 px-2 py-2 bg-kindle-bg border border-kindle-border rounded-xl text-[10px] text-kindle-text"
                              />
                              <button
                                type="button"
                                onClick={() => {
                                  const next = addCategory(categories, customCategoryInput);
                                  if (next.length !== categories.length) {
                                    setCategories(next);
                                    setCustomCategoryInput("");
                                    markTouched();
                                  }
                                }}
                                className="shrink-0 px-3 py-2 bg-kindle-text text-kindle-bg rounded-xl text-[10px] font-bold cursor-pointer"
                                aria-label="Add category"
                              >+</button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* STEP 3 — Turn timer: enable or disable */}
                  {wizardStep === 2 && (
                    <div className="space-y-4">
                      <div className="bg-kindle-card border border-kindle-border rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="flex items-start gap-3 min-w-0">
                          <div className={`p-2.5 rounded-xl border flex items-center justify-center transition-colors shrink-0 ${
                            turnTimerEnabled ? "bg-kindle-accent/10 border-kindle-accent/30 text-kindle-accent" : "bg-kindle-bg border-kindle-border text-kindle-text-muted"
                          }`}>
                            <Timer className="w-5 h-5" />
                          </div>
                          <div className="space-y-0.5 text-left">
                            <div className="flex items-center gap-2">
                              <h4 className="text-xs sm:text-sm font-bold text-kindle-text">Turn Timer</h4>
                              <span className={`px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-widest ${
                                turnTimerEnabled ? "bg-kindle-accent/10 text-kindle-accent border border-kindle-accent/20" : "bg-kindle-border/50 text-kindle-text-muted"
                              }`}>
                                {turnTimerEnabled ? "On" : "Off"}
                              </span>
                            </div>
                            <p className="text-[10px] sm:text-[11px] text-kindle-text-muted leading-snug">
                              Counts down each player&apos;s turn. On expiry it beeps once and stops the clock.
                            </p>
                          </div>
                        </div>
                        <button
                          type="button"
                          onClick={() => setTurnTimerEnabled(!turnTimerEnabled)}
                          data-testid="toggle-timer"
                          role="switch"
                          aria-checked={turnTimerEnabled}
                          aria-label="Toggle turn timer"
                          className={`w-12 h-6 rounded-full p-0.5 transition-colors duration-200 cursor-pointer focus:outline-none flex items-center shrink-0 ${
                            turnTimerEnabled ? "bg-kindle-accent" : "bg-neutral-800"
                          }`}
                        >
                          <motion.div
                            layout
                            className="w-5 h-5 rounded-full bg-white shadow-md"
                            animate={{ x: turnTimerEnabled ? 24 : 0 }}
                            transition={{ type: "spring", stiffness: 500, damping: 30 }}
                          />
                        </button>
                      </div>

                      {turnTimerEnabled ? (
                        <div className="bg-kindle-card border border-kindle-border rounded-2xl p-4 space-y-3">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted block flex items-center justify-between">
                            <span>Turn Timer (Seconds)</span>
                            <Clock className="w-3.5 h-3.5 text-kindle-accent" />
                          </label>
                          <div className="grid grid-cols-4 gap-1.5">
                            {[30, 60, 90, 120].map((sec) => (
                              <button
                                key={sec}
                                type="button"
                                onClick={() => { setTurnTimerSeconds(sec); armTurnClock(sec); }}
                                data-testid={`timer-${sec}`}
                                className={`py-2.5 text-xs font-mono font-bold rounded-xl border transition cursor-pointer ${
                                  turnTimerSeconds === sec
                                    ? "bg-kindle-text text-kindle-bg border-kindle-text"
                                    : "bg-kindle-bg text-kindle-text-muted border-kindle-border"
                                }`}
                              >
                                {sec}s
                              </button>
                            ))}
                          </div>
                          <p className="text-[9px] text-kindle-text-muted pt-1">
                                                      Only runs when Competition Mode is on (toggle below).
                                                    </p>
                                                  </div>
                                                ) : (
                                                  <p className="text-[10px] text-kindle-text-muted bg-kindle-card border border-dashed border-kindle-border rounded-2xl p-4">
                                                    Timer off — turns are unlimited and no expiry alerts will appear.
                                                  </p>
                                                )}

                                                {/* Competition mode lives on THIS step: the clock and the
                                                    mode it depends on are decided together, and step 5's
                                                    conditional verification follows from this one toggle. */}
                                                <div className="bg-kindle-card border border-kindle-border rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                                                  <div className="flex items-start gap-3 min-w-0">
                                                    <div className={`p-2.5 rounded-xl border flex items-center justify-center transition-colors shrink-0 ${
                                                      competitionMode ? "bg-[#e0533c]/10 border-[#e0533c]/30 text-[#e0533c]" : "bg-kindle-bg border-kindle-border text-kindle-text-muted"
                                                    }`}>
                                                      <Swords className="w-5 h-5" />
                                                    </div>
                                                    <div className="space-y-0.5 text-left">
                                                      <div className="flex items-center gap-2">
                                                        <h4 className="text-xs sm:text-sm font-bold text-kindle-text">Competition Mode</h4>
                                                        {competitionMode && (
                                                          <span className="px-1.5 py-0.5 rounded text-[8px] font-extrabold uppercase tracking-widest bg-[#e0533c]/10 text-[#e0533c] border border-[#e0533c]/20">
                                                            Active
                                                          </span>
                                                        )}
                                                      </div>
                                                      <p className="text-[10px] sm:text-[11px] text-kindle-text-muted leading-snug">
                                                        Locks round scores, enforces time limits, tracks blitz speed bonuses, and records tournament placements.
                                                      </p>
                                                    </div>
                                                  </div>
                                                  <button
                                                    type="button"
                                                    onClick={() => { setCompetitionMode(!competitionMode); markTouched(); }}
                                                    data-testid="toggle-competition"
                                                    role="switch"
                                                    aria-checked={competitionMode}
                                                    aria-label="Toggle competition mode"
                                                    className={`w-12 h-6 rounded-full p-0.5 transition-colors duration-200 cursor-pointer focus:outline-none flex items-center shrink-0 ${
                                                      competitionMode ? "bg-[#e0533c]" : "bg-neutral-800"
                                                    }`}
                                                  >
                                                    <motion.div
                                                      layout
                                                      className="w-5 h-5 rounded-full bg-white shadow-md"
                                                      animate={{ x: competitionMode ? 24 : 0 }}
                                                      transition={{ type: "spring", stiffness: 500, damping: 30 }}
                                                    />
                                                  </button>
                                                </div>
                                                <p className="text-[9px] text-kindle-text-muted flex items-start gap-1.5" data-testid="competition-mode-note">
                                                  <Lock className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                                                  {competitionMode
                                                    ? "On: the turn clock runs, scores are locked per round, and step 5 verifies the competition roster."
                                                    : "Off: the turn clock is skipped, step 5 is marked skipped, and naming players stays optional for the scoreboard."}
                                                </p>
                                              </div>
                                            )}

                                            {/* STEP 4 — Roster: names, handicaps, teams */}
                                            {wizardStep === 3 && (
                                              <div className="space-y-3">
                                                {!competitionMode && (
                                                  <div className="p-3 bg-kindle-card border border-dashed border-kindle-border rounded-2xl flex items-start gap-2">
                                                    <Lock className="w-3.5 h-3.5 text-kindle-text-muted shrink-0 mt-0.5" />
                                                    <p className="text-[10px] text-kindle-text-muted">
                                                      Competition Mode is off, so handicaps and colours are skipped. Naming players is optional.
                          </p>
                        </div>
                      )}

                      <div className="bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-4">
                        <div className="flex flex-col md:flex-row md:items-center justify-between border-b border-kindle-border pb-3 gap-3">
                          <div>
                            <h4 className="text-xs font-bold uppercase tracking-wider text-kindle-text flex items-center gap-1.5">
                              <Users className="w-4 h-4 text-kindle-accent" /> Competitor Roster ({players.length} Players)
                            </h4>
                            <p className="text-[10px] text-kindle-text-muted">Add players and optional handicap adjustments before launching match.</p>
                          </div>

                          <div className="flex items-center gap-2 w-full md:w-auto">
                            <input
                              type="text"
                              value={newPlayerName}
                              onChange={(e) => setNewPlayerName(e.target.value)}
                              onKeyDown={(e) => e.key === "Enter" && handleAddPlayer()}
                              placeholder="New competitor name..."
                              aria-label="New competitor name"
                              className="flex-1 md:flex-none min-w-0 px-3 py-2 bg-kindle-bg border border-kindle-border rounded-xl text-xs text-kindle-text focus:outline-none focus:border-kindle-accent"
                            />
                            <button
                              type="button"
                              onClick={handleAddPlayer}
                              data-testid="add-player"
                              className="shrink-0 px-4 py-2 bg-kindle-text text-kindle-bg rounded-xl text-xs font-bold hover:bg-opacity-90 transition cursor-pointer flex items-center gap-1"
                            >
                              <Plus className="w-3.5 h-3.5" /> Add
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {players.map((p) => (
                            <div
                              key={p.id}
                              className="p-3 bg-kindle-bg border border-kindle-border rounded-xl flex items-center justify-between gap-3 shadow-xs"
                            >
                              <div className="flex items-center gap-2.5 min-w-0">
                                <div className="w-4 h-4 rounded-full shrink-0 shadow-xs border border-white/20" style={{ backgroundColor: p.color }} />
                                <input
                                  type="text"
                                  value={p.name}
                                  onChange={(e) => {
                                    setPlayers(players.map((pl) => (pl.id === p.id ? { ...pl, name: e.target.value } : pl)));
                                    markTouched();
                                  }}
                                  data-testid={`player-name-${p.id}`}
                                  aria-label={`Name for player ${p.id}`}
                                  className="min-w-0 flex-1 bg-transparent border border-transparent focus:border-kindle-border focus:outline-none rounded px-1 py-0.5 text-xs font-bold text-kindle-text"
                                />
                              </div>

                              <div className="flex items-center gap-2 shrink-0">
                                <div className="flex items-center gap-1 text-[10px] text-kindle-text-muted">
                                  <span>Hdcp:</span>
                                  <input
                                    type="number"
                                    value={p.handicap || 0}
                                    onChange={(e) => {
                                      const val = parseInt(e.target.value, 10) || 0;
                                      setPlayers(players.map((pl) => (pl.id === p.id ? { ...pl, handicap: val } : pl)));
                                      markTouched();
                                    }}
                                    data-testid={`handicap-${p.id}`}
                                    aria-label={`Handicap for player ${p.id}`}
                                    className="w-10 px-1 py-1 bg-kindle-card border border-kindle-border rounded font-mono text-center text-kindle-text"
                                  />
                                </div>

                                <button
                                  type="button"
                                  onClick={() => handleRemovePlayer(p.id)}
                                  data-testid={`remove-player-${p.id}`}
                                  className="p-1 text-kindle-text-muted hover:text-red-400 transition cursor-pointer"
                                  title="Remove Competitor"
                                  aria-label={`Remove player ${p.id}`}
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>

                        {/* ---- Team assignment ----
                            Only rendered for team presets. A 4-player Carrom
                            roster with no sides attached records the wrong
                            thing: two partners on opposing sides sharing one
                            number, and a win condition ("team to 7 tricks")
                            that has nowhere to live. */}
                        {teamGame && (
                          <div className="pt-3 border-t border-kindle-border space-y-2" data-testid="team-assignment">
                            <label className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted block flex items-center justify-between">
                              <span>Teams</span>
                              <Users className="w-3.5 h-3.5 text-kindle-accent" />
                            </label>
                            <p className="text-[9px] text-kindle-text-muted">
                              {selectedPreset.name} is played {selectedPreset.playerCount.label} — pick who is on
                              which side. Scores roll up per team and the side total is what wins.
                            </p>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                              {teamsForMatch.map((team) => (
                                <div
                                  key={team.id}
                                  className="p-3 bg-kindle-bg border border-kindle-border rounded-xl space-y-2"
                                  data-testid={`team-${team.id}`}
                                >
                                  <div className="flex items-center gap-2">
                                    <span
                                      className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/20"
                                      style={{ backgroundColor: team.color }}
                                    />
                                    <span className="text-[10px] font-bold text-kindle-text truncate">
                                      {team.label}
                                    </span>
                                  </div>
                                  {players.map((p) => (
                                    <label
                                      key={p.id}
                                      className="flex items-center gap-2 text-[11px] text-kindle-text-muted cursor-pointer"
                                    >
                                      <input
                                        type="radio"
                                        name={`team-${team.id}`}
                                        checked={p.teamId === team.id}
                                        onChange={() => {
                                          setPlayers(players.map((pl) => (pl.id === p.id ? { ...pl, teamId: team.id } : pl)));
                                          markTouched();
                                        }}
                                        data-testid={`assign-${p.id}-${team.id}`}
                                        aria-label={`Put ${p.name || p.id} on ${team.label}`}
                                        className="accent-kindle-accent"
                                      />
                                      <span className="truncate">{p.name || `Player ${p.id}`}</span>
                                    </label>
                                  ))}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* STEP 5 — Competition roster: verify the seeded field.
                                        Only reachable when competition mode is on; with it off the
                                        panel still renders, but as an explanation of the skip
                                        rather than a vanishing step. */}
                                    {wizardStep === 4 && (
                                      <div className="space-y-3">
                                        {!competitionMode ? (
                                          <div
                                            className="p-4 bg-kindle-card border border-dashed border-kindle-border rounded-2xl flex items-start gap-2"
                                            data-testid="competition-step-skipped"
                                          >
                                            <Lock className="w-4 h-4 text-kindle-text-muted shrink-0 mt-0.5" />
                                            <div className="space-y-2">
                                              <p className="text-[11px] font-bold text-kindle-text">{COMPETITION_STEP_SKIP_MESSAGE}</p>
                                              <p className="text-[10px] text-kindle-text-muted">
                                                The step keeps its number so the rail does not jump. Nothing below is needed for a casual match.
                                              </p>
                                              <button
                                                type="button"
                                                onClick={() => goToStep(2)}
                                                className="text-[10px] font-bold text-kindle-accent hover:underline cursor-pointer"
                                              >
                                                Go to step 3 to turn competition mode on
                                              </button>
                                            </div>
                                          </div>
                                        ) : !competitionField ? (
                                          /* Roster empty or too small to draw a field from. Say so
                                             plainly — a regenerate button here would be a lie. */
                                          <div
                                            className="p-4 bg-kindle-card border border-[#e0533c]/30 rounded-2xl flex items-start gap-2"
                                            data-testid="competition-field-error"
                                            role="alert"
                                          >
                                            <AlertTriangle className="w-4 h-4 text-[#e0533c] shrink-0 mt-0.5" />
                                            <div className="space-y-2">
                                              <p className="text-[11px] font-bold text-kindle-text">Cannot draw a competition field</p>
                                                                          <p className="text-[10px] text-kindle-text-muted">
                                                                            {competitionFieldResult.ok ? "The roster could not be turned into a field." : competitionFieldResult.reason}
                                                                          </p>
                                              <button
                                                type="button"
                                                onClick={() => goToStep(3)}
                                                className="text-[10px] font-bold text-kindle-accent hover:underline cursor-pointer"
                                              >
                                                Back to step 4 to fix the roster
                                              </button>
                                            </div>
                                          </div>
                                        ) : (
                                          <>
                                            <div className="bg-kindle-card border border-kindle-border rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                                              <div className="space-y-0.5">
                                                <h4 className="text-xs font-bold text-kindle-text">Seeded Field</h4>
                                                <p className="text-[10px] text-kindle-text-muted">
                                                  Seed {competitionField.seed} · {competitionField.order.length} players. Check the draw and the sides before starting.
                                                </p>
                                              </div>
                                              <button
                                                type="button"
                                                onClick={handleRegenerateField}
                                                data-testid="regenerate-field"
                                                className="shrink-0 flex items-center gap-1.5 px-3 py-2 bg-kindle-bg border border-kindle-border rounded-xl text-[10px] font-bold text-kindle-text hover:border-kindle-accent transition cursor-pointer"
                                              >
                                                <RotateCcw className="w-3.5 h-3.5" /> Regenerate
                                              </button>
                                            </div>

                                            {fieldNote && (
                                              <p
                                                className="p-3 bg-kindle-accent/10 border border-kindle-accent/20 rounded-2xl text-[10px] text-kindle-text"
                                                data-testid="regenerate-note"
                                                role="status"
                                              >
                                                {fieldNote}
                                              </p>
                                            )}

                                            <div className="bg-kindle-card border border-kindle-border rounded-2xl p-4 space-y-2">
                                              <h5 className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted">Seeding Order</h5>
                                              <ol className="space-y-1" data-testid="seeding-order">
                                                {competitionField.order.map((name, i) => {
                                                  const side = competitionField.allocation.find((a) => a.players.includes(name));
                                                  return (
                                                    <li key={`${name}-${i}`} className="flex items-center justify-between gap-3 text-[11px]">
                                                      <span className="font-mono text-kindle-text-muted">{i + 1}.</span>
                                                      <span className="font-bold text-kindle-text flex-1 truncate">{name}</span>
                                                      <span className="text-[10px] text-kindle-text-muted truncate">{side?.label ?? "—"}</span>
                                                    </li>
                                                  );
                                                })}
                                              </ol>
                                            </div>

                                            {competitionField.allocation.length > 1 && (
                                              <div className="bg-kindle-card border border-kindle-border rounded-2xl p-4 space-y-2">
                                                <h5 className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted">Sides</h5>
                                                {competitionField.allocation.map((a) => (
                                                  <div key={a.sideId} className="flex items-center justify-between gap-3 text-[11px]">
                                                    <span className="font-bold text-kindle-text">{a.label}</span>
                                                    <span className="text-kindle-text-muted truncate">{a.players.join(", ") || "empty"}</span>
                                                  </div>
                                                ))}
                                              </div>
                                            )}

                                            {competitionField.pairings.length > 0 && (
                                              <div className="bg-kindle-card border border-kindle-border rounded-2xl p-4 space-y-2">
                                                <h5 className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted">Opening Pairings</h5>
                                                {competitionField.pairings.map((p, i) => (
                                                  <div key={i} className="text-[11px] text-kindle-text">
                                                    <span className="font-mono text-kindle-text-muted">M{i + 1}</span>{" "}
                                                    <span className="font-bold">{p.p1}</span>
                                                    {p.p2 ? <> vs <span className="font-bold">{p.p2}</span></> : <span className="text-kindle-text-muted"> vs bye</span>}
                                                  </div>
                                                ))}
                                              </div>
                                            )}
                                          </>
                                        )}
                                      </div>
                                    )}

                                    {/* STEP 6 — Review and launch */}
                                    {wizardStep === 5 && (
                                      <div className="space-y-4">
                                        <div className="bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-3">
                                          <h4 className="text-xs font-bold uppercase tracking-wider text-kindle-text">Match Review</h4>
                                          {[
                                            { label: "Game", value: `${selectedPreset.iconName} ${selectedPreset.name}` },
                                            { label: "Win condition", value: winCondition === "highest" ? "Highest score wins" : "Lowest score wins" },
                                            { label: "Target points", value: targetScore ? `${targetScore} points` : "No limit" },
                                            { label: "Turn timer", value: !turnTimerEnabled ? "Off" : !competitionMode ? "Off (needs competition mode)" : `${turnTimerSeconds}s per turn` },
                                            { label: "Competition mode", value: competitionMode ? "On — scores locked per round" : "Off — casual" },
                                            { label: "Categories", value: enableCategories && categories.length ? categories.join(", ") : "Single score per round" },
                                            { label: "Roster", value: `${players.length} player${players.length === 1 ? "" : "s"}: ${players.map((p) => p.name || "—").join(", ")}` },
                                            ...(teamGame
                                              ? [{
                                                  label: "Teams",
                                                  value: teamsForMatch
                                                    .map((t) => `${t.label}: ${players.filter((p) => p.teamId === t.id).map((p) => p.name || "—").join(", ") || "none"}`)
                                                    .join("  ·  "),
                                                }]
                                              : []),
                                            ...(competitionMode && competitionField
                                              ? [{ label: "Competition field", value: `Seed ${competitionField.seed}: ${competitionField.order.join(" → ")}` }]
                                              : []),
                                          ].map((row) => (
                          <div key={row.label} className="flex items-start justify-between gap-3 py-1.5 border-b border-kindle-border/60 last:border-0">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted shrink-0">{row.label}</span>
                            <span className="text-[11px] font-bold text-kindle-text text-right break-words">{row.value}</span>
                          </div>
                        ))}
                      </div>

                      <button
                        type="button"
                        onClick={handleStartMatch}
                        data-testid="start-game"
                        className="w-full px-8 py-4 bg-kindle-text text-kindle-bg font-bold text-xs uppercase tracking-wider rounded-2xl hover:bg-opacity-90 active:scale-98 transition shadow-lg flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Play className="w-4 h-4 fill-current" /> Start Game
                      </button>
                    </div>
                  )}
                    </motion.div>
                  </AnimatePresence>

                  {/* Footer nav: steps 1-5 advance; step 6 launches from its own button. */}
                  {wizardStep < WIZARD_STEPS.length - 1 && (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => goToStep(wizardStep - 1)}
                        disabled={wizardStep === 0}
                        data-testid="wizard-back"
                        className="shrink-0 min-h-12 px-4 py-3 bg-kindle-card border border-kindle-border rounded-2xl text-xs font-bold text-kindle-text hover:border-kindle-accent transition cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed flex items-center gap-1"
                      >
                        <ChevronLeft className="w-4 h-4" /> Back
                      </button>
                      <button
                        type="button"
                        onClick={() => goToStep(wizardStep + 1)}
                        data-testid="wizard-next"
                        className="flex-1 min-h-12 px-6 py-3.5 bg-kindle-accent text-kindle-bg font-bold text-xs uppercase tracking-wider rounded-2xl hover:bg-opacity-90 active:scale-98 transition shadow flex items-center justify-center gap-2 cursor-pointer"
                      >
                        Next: {WIZARD_STEPS[wizardStep + 1].title} <ChevronRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                /* Active Match Arena */
                <div className="space-y-6 animate-in fade-in duration-300">
                  {/* Mid-match "Edit setup" — confirms first, never ends the match. */}
                  <div className="flex items-center justify-between gap-3 p-3 bg-kindle-card border border-kindle-border rounded-2xl">
                    <span className="text-[10px] text-kindle-text-muted flex items-center gap-1.5 min-w-0">
                      <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping shrink-0" />
                      <span className="truncate">
                        {selectedPreset.iconName} {selectedPreset.name} • Round {rounds.length + 1}
                      </span>
                    </span>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => setActiveTab("history")}
                        data-testid="goto-history"
                        className="min-h-11 px-3 py-2 bg-kindle-bg border border-kindle-border rounded-xl text-[10px] font-bold text-kindle-text hover:border-kindle-accent transition cursor-pointer flex items-center gap-1.5"
                      >
                        <History className="w-3.5 h-3.5" /> History
                      </button>
                      <button
                        type="button"
                        onClick={requestEditSetup}
                        data-testid="edit-setup"
                        className="min-h-11 px-3 py-2 bg-kindle-text text-kindle-bg rounded-xl text-[10px] font-bold cursor-pointer hover:bg-opacity-90 transition flex items-center gap-1.5"
                      >
                        <Settings2 className="w-3.5 h-3.5" /> Edit setup
                      </button>
                    </div>
                  </div>

                  {/* ---- Team totals ----
                      Shown above the individual leaderboard, never instead of
                      it. Both numbers matter: the side total decides the
                      match, the member scores say who actually scored. */}
                  {teamGame && teamStandings.length > 0 && (
                    <div
                      className="bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-3 shadow-xs"
                      data-testid="team-standings"
                    >
                      <div className="flex items-center justify-between border-b border-kindle-border pb-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-kindle-text flex items-center gap-1.5">
                          <Users className="w-4 h-4 text-kindle-accent" /> Team Totals
                        </h4>
                        <span className="text-[9px] font-mono text-kindle-text-muted">
                          {selectedPreset.playerCount.label} • team of {teamsForMatch[0]?.size ?? 2}
                        </span>
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        {teamStandings.map((t) => {
                          const targetHit = targetScore ? getTeamTotal(t.teamId) >= targetScore : false;
                          return (
                            <div
                              key={t.teamId}
                              className={`p-3 border rounded-xl space-y-2 ${
                                targetHit ? "border-emerald-500/40 bg-emerald-500/5" : "border-kindle-border bg-kindle-bg"
                              }`}
                              data-testid={`team-total-${t.teamId}`}
                            >
                              <div className="flex items-center justify-between gap-2">
                                <span className="flex items-center gap-2 text-[11px] font-bold text-kindle-text min-w-0">
                                  <span
                                    className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/20"
                                    style={{ backgroundColor: t.color }}
                                  />
                                  <span className="truncate">{t.label}</span>
                                </span>
                                <span className="font-mono font-bold text-kindle-text shrink-0" data-testid={`team-score-${t.teamId}`}>
                                  {t.total}
                                </span>
                              </div>
                              {/* The individual breakdown the total came from. */}
                              <div className="space-y-0.5 pt-1 border-t border-kindle-border">
                                {Object.entries(t.memberScores).map(([pid, score]) => {
                                  const member = players.find((p) => p.id === pid);
                                  return (
                                    <div key={pid} className="flex items-center justify-between gap-2 text-[10px]">
                                      <span className="text-kindle-text-muted truncate">
                                        {member?.name || `Player ${pid}`}
                                      </span>
                                      <span className="font-mono text-kindle-text-muted">{score}</span>
                                    </div>
                                  );
                                })}
                                {t.memberIds.length === 0 && (
                                  <span className="text-[10px] text-kindle-text-muted">No players assigned</span>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Top Live Scoreboard Podium Banner */}
                  <div className="grid grid-cols-1 md:grid-cols-12 gap-4">
                    {/* Leaderboard Ranks (7 cols) */}
                    <div className="md:col-span-7 bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-4 shadow-xs">
                      <div className="flex items-center justify-between border-b border-kindle-border pb-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-kindle-text flex items-center gap-1.5">
                          <Crown className="w-4 h-4 text-yellow-500" /> Current Leaderboard Ranks
                        </h4>
                        <span className="text-[9px] font-mono text-kindle-text-muted">
                          Round {rounds.length + 1} • {winCondition === "highest" ? "Highest Score Wins" : "Lowest Score Wins"}
                        </span>
                      </div>

                      <div className="space-y-2">
                        {rankedPlayers.map((p, rankIdx) => {
                          const totalScore = getPlayerTotal(p.id);
                          const gapToLeader = Math.abs(totalScore - getPlayerTotal(currentLeader.id));

                          return (
                            <div
                              key={p.id}
                              className={`p-3 rounded-xl border flex items-center justify-between transition ${
                                rankIdx === 0
                                  ? "bg-yellow-500/10 border-yellow-500/30 ring-1 ring-yellow-500/20"
                                  : "bg-kindle-bg border-kindle-border"
                              }`}
                            >
                              <div className="flex items-center gap-3">
                                <span className="font-mono text-xs font-bold w-5 text-center">
                                  {rankIdx === 0 ? "🥇" : rankIdx === 1 ? "🥈" : rankIdx === 2 ? "🥉" : `#${rankIdx + 1}`}
                                </span>
                                <div
                                  className="w-3.5 h-3.5 rounded-full shrink-0"
                                  style={{ backgroundColor: p.color }}
                                />
                                <div>
                                  <span className="text-xs font-bold text-kindle-text">{p.name}</span>
                                  {p.handicap ? (
                                    <span className="text-[9px] text-kindle-text-muted ml-1 font-mono">
                                      ({p.handicap > 0 ? `+${p.handicap}` : p.handicap} hdcp)
                                    </span>
                                  ) : null}
                                </div>
                              </div>

                              <div className="flex items-center gap-3">
                                {rankIdx > 0 && gapToLeader > 0 && (
                                  <span className="text-[9px] font-mono text-kindle-text-muted">
                                    -{gapToLeader} pts behind
                                  </span>
                                )}
                                <span className="text-base font-bold font-mono text-kindle-text">
                                  {totalScore}
                                </span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Turn Clock & Match Blitz Control (5 cols) */}
                    <div className="md:col-span-5 bg-kindle-card border border-kindle-border rounded-2xl p-5 flex flex-col justify-between space-y-4 shadow-xs">
                      <div className="flex items-center justify-between border-b border-kindle-border pb-2">
                        <span className="text-xs font-bold uppercase tracking-wider text-kindle-text flex items-center gap-1.5">
                          <Clock className="w-4 h-4 text-kindle-accent" /> Competitor Turn Clock
                        </span>
                        <button
                          type="button"
                          onClick={() => setIsTimerRunning(!isTimerRunning)}
                          className="px-2.5 py-1 bg-kindle-bg border border-kindle-border rounded-lg text-[10px] font-bold text-kindle-text hover:border-kindle-accent transition cursor-pointer"
                        >
                          {isTimerRunning ? "Pause ⏸" : "Start ▶"}
                        </button>
                      </div>

                      {/* Timer Dial Display */}
                      <div className="flex flex-col items-center justify-center py-2 space-y-2">
                        <div
                          className={`text-4xl font-mono font-extrabold tracking-tight transition ${
                            timeRemaining <= 10 ? "text-red-500 animate-pulse" : "text-kindle-text"
                          }`}
                        >
                          {timeRemaining}s
                        </div>

                        {/* Active Player Turn Identifier */}
                        <div className="flex items-center gap-2 px-3 py-1 bg-kindle-bg border border-kindle-border rounded-full text-xs font-bold">
                          <span className="text-kindle-text-muted">Turn:</span>
                          <span
                            className="w-2.5 h-2.5 rounded-full"
                            style={{ backgroundColor: players[activePlayerIndex]?.color }}
                          />
                          <span className="text-kindle-text">{players[activePlayerIndex]?.name}</span>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-kindle-border">
                        <button
                          type="button"
                          onClick={() => {
                            setActivePlayerIndex((prev) => (prev + 1) % players.length);
                            setTimeRemaining(turnTimerSeconds);
                            playBeepSound(500, 0.1);
                          }}
                          className="w-full py-2 bg-kindle-bg hover:bg-kindle-border border border-kindle-border rounded-xl text-xs font-bold text-kindle-text transition cursor-pointer flex items-center justify-center gap-1"
                        >
                          Next Player Turn →
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Round Score Entry Form */}
                  <div className="bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-4 shadow-xs">
                    <div className="flex items-center justify-between border-b border-kindle-border pb-3">
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-kindle-text flex items-center gap-1.5">
                          <PlusCircle className="w-4 h-4 text-kindle-accent" /> Log Round {rounds.length + 1} Scores
                        </h4>
                        <p className="text-[10px] text-kindle-text-muted">Enter points scored by each player for this round.</p>
                      </div>

                      <div className="flex items-center gap-2">
                        {rounds.length > 0 && (
                          <button
                            type="button"
                            onClick={handleUndoLastRound}
                            className="px-3 py-1.5 bg-kindle-bg border border-kindle-border rounded-xl text-xs font-bold text-kindle-text-muted hover:text-kindle-text transition cursor-pointer flex items-center gap-1"
                          >
                            <RotateCcw className="w-3.5 h-3.5" /> Undo Round
                          </button>
                        )}
                      </div>
                    </div>

                    {/* Matrix Scoring Inputs */}
                    <div className="space-y-4">
                      {enableCategories && categories.length > 0 ? (
                        /* Multi-Category Breakdown Entry */
                        <div className="space-y-4 max-h-72 overflow-y-auto pr-1">
                          {players.map((p) => (
                            <div key={p.id} className="p-3 bg-kindle-bg border border-kindle-border rounded-xl space-y-2">
                              <div className="flex items-center justify-between border-b border-kindle-border/60 pb-1.5">
                                <span className="text-xs font-bold text-kindle-text flex items-center gap-2">
                                  <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: p.color }} />
                                  {p.name}
                                </span>
                                <span className="text-xs font-mono font-bold text-kindle-accent">
                                  Round Sum: {Object.values(roundCategoryBuffer[p.id] || {}).reduce((a, b) => a + b, 0)} pts
                                </span>
                              </div>

                              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 pt-1">
                                {categories.map((cat) => (
                                  <div key={cat} className="flex items-center justify-between gap-2 p-1.5 bg-kindle-card border border-kindle-border rounded-lg text-[10px]">
                                    <span className="text-kindle-text-muted truncate">{cat}:</span>
                                    <div className="flex items-center gap-1">
                                      <button
                                        type="button"
                                        onClick={() => handleAdjustCategoryScore(p.id, cat, -1)}
                                        className="w-5 h-5 bg-kindle-bg border border-kindle-border rounded font-bold text-center"
                                      >
                                        -
                                      </button>
                                      <span className="w-6 text-center font-mono font-bold text-kindle-text">
                                        {roundCategoryBuffer[p.id]?.[cat] || 0}
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => handleAdjustCategoryScore(p.id, cat, 1)}
                                        className="w-5 h-5 bg-kindle-bg border border-kindle-border rounded font-bold text-center"
                                      >
                                        +
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        /* Single Round Direct Buffer Inputs */
                        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                          {players.map((p) => {
                            const val = roundScoresBuffer[p.id] || 0;
                            return (
                              <div key={p.id} className="p-3 bg-kindle-bg border border-kindle-border rounded-xl space-y-2">
                                <div className="flex items-center justify-between">
                                  <span className="text-xs font-bold text-kindle-text flex items-center gap-2 truncate">
                                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                                    {p.name}
                                  </span>
                                  <span className="text-xs font-mono font-bold text-kindle-text-muted">
                                    Total: {getPlayerTotal(p.id)}
                                  </span>
                                </div>

                                <div className="flex items-center justify-between gap-2 bg-kindle-card border border-kindle-border rounded-xl p-2">
                                  <button
                                    type="button"
                                    onClick={() => handleAdjustBufferScore(p.id, -5)}
                                    className="px-2 py-1 bg-kindle-bg border border-kindle-border rounded-lg text-[10px] font-bold text-kindle-text hover:bg-kindle-border transition cursor-pointer"
                                  >
                                    -5
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleAdjustBufferScore(p.id, -1)}
                                    className="px-2 py-1 bg-kindle-bg border border-kindle-border rounded-lg text-[10px] font-bold text-kindle-text hover:bg-kindle-border transition cursor-pointer"
                                  >
                                    -1
                                  </button>

                                  <input
                                    type="number"
                                    value={val}
                                    onChange={(e) => setRoundScoresBuffer({ ...roundScoresBuffer, [p.id]: parseInt(e.target.value, 10) || 0 })}
                                    className="w-16 text-center font-mono font-extrabold text-sm text-kindle-text bg-transparent focus:outline-none"
                                  />

                                  <button
                                    type="button"
                                    onClick={() => handleAdjustBufferScore(p.id, 1)}
                                    className="px-2 py-1 bg-kindle-bg border border-kindle-border rounded-lg text-[10px] font-bold text-kindle-text hover:bg-kindle-border transition cursor-pointer"
                                  >
                                    +1
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleAdjustBufferScore(p.id, 5)}
                                    className="px-2 py-1 bg-kindle-bg border border-kindle-border rounded-lg text-[10px] font-bold text-kindle-text hover:bg-kindle-border transition cursor-pointer"
                                  >
                                    +5
                                  </button>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      {/* ---- Instant-win conditions ----
                          Carrom's covered Queen, Hukum Thaas's Koatey, Dihaeh's
                          Baga / Hukunbunye and Chess's checkmate all end a
                          round regardless of the score. The tracker cannot
                          detect any of them, so it offers the button: pick the
                          condition, pick who achieved it, and the round ends
                          with that winner recorded. */}
                      {instantWins.length > 0 && (
                        <div
                          className="p-3 bg-emerald-500/5 border border-emerald-500/20 rounded-2xl space-y-2"
                          data-testid="instant-win-controls"
                        >
                          <label className="text-[10px] font-bold uppercase tracking-wider text-emerald-500 block">
                            Won by a special condition?
                          </label>
                          <div className="flex flex-wrap gap-1.5">
                            {instantWins.map((c) => (
                              <button
                                key={c.id}
                                type="button"
                                title={c.detail}
                                onClick={() => {
                                  const champ =
                                    teamGame
                                      ? // A team instant win is credited to the side.
                                        getRankedPlayers().find((p) => p.teamId === leadingTeamId)
                                      : getRankedPlayers()[0];
                                  if (!champ) {
                                    toast.error("No players on the roster yet.");
                                    return;
                                  }
                                  handleFinishMatch(champ);
                                }}
                                data-testid={`instant-win-${c.id}`}
                                className="px-3 py-2 bg-emerald-500/10 hover:bg-emerald-500/20 border border-emerald-500/30 rounded-xl text-[10px] font-bold text-emerald-500 transition cursor-pointer"
                              >
                                {c.label}
                              </button>
                            ))}
                          </div>
                          <p className="text-[9px] text-kindle-text-muted">
                            {teamGame
                              ? "Ends the match immediately and records the leading side as the winner."
                              : "Ends the match immediately and records the current leader as the winner."}
                          </p>
                        </div>
                      )}

                      <div className="pt-2 flex items-center justify-between gap-4">
                        <button
                          type="button"
                          onClick={() => handleFinishMatch()}
                          className="px-4 py-2 bg-kindle-bg hover:bg-red-500/10 border border-kindle-border hover:border-red-500/30 rounded-xl text-xs font-bold text-kindle-text-muted hover:text-red-400 transition cursor-pointer"
                        >
                          End Match Early & Declare Winner
                        </button>

                        <button
                          type="button"
                          onClick={handleSubmitRound}
                          className="px-6 py-2.5 bg-kindle-accent text-kindle-bg font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-opacity-90 transition shadow-md cursor-pointer flex items-center gap-1.5"
                        >
                          <CheckCircle2 className="w-4 h-4" /> Submit Round {rounds.length + 1}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Round History Log Table */}
                  {rounds.length > 0 && (
                    <div className="bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-3">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-kindle-text">
                        Round History Matrix
                      </h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-left border-collapse text-xs">
                          <thead>
                            <tr className="border-b border-kindle-border text-kindle-text-muted text-[10px] uppercase font-mono">
                              <th className="py-2 px-3">Round</th>
                              {players.map((p) => (
                                <th key={p.id} className="py-2 px-3">
                                  {p.name}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-kindle-border/60">
                            {rounds.map((r) => (
                              <tr key={r.roundNumber} className="hover:bg-kindle-bg/50">
                                <td className="py-2 px-3 font-mono font-bold text-kindle-text-muted">
                                  R{r.roundNumber}
                                </td>
                                {players.map((p) => (
                                  <td key={p.id} className="py-2 px-3 font-mono font-bold text-kindle-text">
                                    +{r.playerScores[p.id] || 0}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Match History Tab — nested sub-tabs: MATCH HISTORY > ROUND HISTORY.
                        While a match is live the whole tab collapses to THAT match's
                        round history: no sub-tabs, no archive list, no other matches.
                        `buildHistorySurface` decides that (archives need competition mode
                        AND no live match); this is where it is rendered. */}
                    {activeTab === "history" && (
                      <div className="space-y-4 animate-in fade-in duration-200">
                        {liveMatch ? (
                          /* Live: only this match's rounds. `resolveRoundSource` pins the
                             source to the live match, so nothing else can appear here. */
                          <div className="space-y-3" data-testid="live-history-only">
                            <div className="flex items-center justify-between gap-2 bg-kindle-card border border-kindle-border rounded-2xl p-3">
                              <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-kindle-text min-w-0">
                                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping shrink-0" />
                                <span className="truncate">Round History — live match</span>
                              </span>
                              <span className="text-[10px] text-kindle-text-muted shrink-0">
                                {liveMatch.rounds?.length ?? 0} round{(liveMatch.rounds?.length ?? 0) === 1 ? "" : "s"}
                              </span>
                            </div>
                            {renderRoundLog(liveMatch)}
                          </div>
                        ) : (
                          <>
                        {/* Sub-tab bar. Round History stays disabled until a match is picked. */}
              <div className="flex items-center gap-1 p-1 bg-kindle-card border border-kindle-border rounded-2xl">
                <button
                  type="button"
                  role="tab"
                  aria-selected={historySubTab === "matches"}
                  onClick={() => setHistorySubTab("matches")}
                  data-testid="subtab-matches"
                  className={`flex-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wider rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer ${
                    historySubTab === "matches"
                      ? "bg-kindle-text text-kindle-bg shadow-sm"
                      : "text-kindle-text-muted hover:text-kindle-text"
                  }`}
                >
                  <Trophy className="w-3.5 h-3.5" /> Match History
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={historySubTab === "rounds"}
                  onClick={() => setHistorySubTab("rounds")}
                  disabled={!selectedMatch}
                  data-testid="subtab-rounds"
                  className={`flex-1 px-3 py-2 text-[10px] font-bold uppercase tracking-wider rounded-xl transition flex items-center justify-center gap-1.5 cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                    historySubTab === "rounds"
                      ? "bg-kindle-text text-kindle-bg shadow-sm"
                      : "text-kindle-text-muted hover:text-kindle-text"
                  }`}
                  title={selectedMatch ? undefined : "Pick a match first"}
                >
                  <History className="w-3.5 h-3.5" /> Round History
                </button>
              </div>

              {historySubTab === "matches" && (
                <>
                  {/* ---- Live match: its own panel, its own rounds only. ----
                      The running match is deliberately NOT one of the archive
                      cards below. It used to be unshifted into that same list,
                      which is what put a "In progress" card among every past
                      match and let the round log resolve to the wrong match. */}
                  {liveMatch && (
                    <div
                      className="border border-emerald-500/30 bg-kindle-card rounded-2xl p-4 space-y-3"
                      data-testid="live-match-panel"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-kindle-text flex items-center gap-1.5 min-w-0">
                          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-ping shrink-0" />
                          <span className="truncate">This Match&apos;s Rounds</span>
                        </h4>
                        <button
                          type="button"
                          onClick={() => openMatchRounds(liveMatch.id)}
                          data-testid="open-rounds-live"
                          className="shrink-0 px-3 py-2 min-h-11 bg-kindle-bg border border-kindle-border rounded-xl text-[10px] font-bold text-kindle-text hover:border-kindle-accent transition cursor-pointer flex items-center gap-1"
                        >
                          Round History <ChevronRight className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-[10px] text-kindle-text-muted">
                        {resolveMatchGame(liveMatch).name} — round {rounds.length + 1} in progress. Only this
                        match&apos;s rounds are listed here; finished matches are kept under Archives.
                      </p>
                      {liveMatch.teamScores && liveMatch.teamScores.length > 0 && (
                        <div className="flex flex-wrap gap-2 pt-1">
                          {liveMatch.teamScores.map((t) => (
                            <span
                              key={t.id}
                              className="px-2 py-1 bg-kindle-bg border border-kindle-border rounded-xl text-[10px] font-bold text-kindle-text"
                            >
                              {t.label}: {t.total}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Archives belong to competition mode. */}
                  {historySurface.showArchives && (
                  <div className="flex items-center justify-between border-b border-kindle-border pb-3 mt-2">
                    <h4 className="text-xs font-bold uppercase tracking-wider text-kindle-text flex items-center gap-1.5">
                      <History className="w-4 h-4 text-kindle-accent" /> Saved Match Archives
                    </h4>
                    {matchHistory.length > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setMatchHistory([]);
                          setSelectedMatchId(null);
                          localStorage.removeItem("kora_game_score_history");
                          toast("History cleared", { icon: "🧹" });
                        }}
                        className="text-[10px] text-red-400 hover:underline cursor-pointer"
                      >
                        Clear History
                      </button>
                    )}
                  </div>
                  )}

                  {historyEntries.length === 0 ? (
                    <div className="py-12 text-center text-kindle-text-muted space-y-2">
                      <Trophy className="w-8 h-8 mx-auto text-kindle-text-muted/40" />
                      <p className="text-xs">
                        {!historySurface.showArchives
                          ? "Match archives belong to competition mode — tick it in setup to keep a record of finished matches."
                          : "No completed matches recorded yet."}
                      </p>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {historyEntries.map((m) => {
                        return (
                          <div
                            key={m.id}
                            className="bg-kindle-card border border-kindle-border rounded-2xl p-4 space-y-3 shadow-xs"
                          >
                            <div className="flex items-start justify-between gap-2">
                              <div className="min-w-0">
                                <span className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted block">
                                  {m.date} • {m.durationMinutes}m
                                </span>
                                <h5 className="text-xs font-bold text-kindle-text truncate">
                                  {resolveMatchGame(m).name}
                                </h5>
                              </div>
                              <span className="px-2 py-0.5 rounded border text-[9px] font-bold flex items-center gap-1 shrink-0 bg-yellow-500/10 text-yellow-500 border border-yellow-500/20">
                                👑 {m.winnerName} ({m.winnerScore})
                              </span>
                            </div>

                            <div className="space-y-1 pt-2 border-t border-kindle-border">
                              {m.players.map((pl) => (
                                <div key={pl.name} className="flex items-center justify-between gap-2 text-[11px]">
                                  <span className="text-kindle-text-muted truncate">
                                    #{pl.rank} {pl.name}
                                  </span>
                                  <span className="font-mono font-bold text-kindle-text shrink-0">{pl.score} pts</span>
                                </div>
                              ))}
                            </div>

                            {/* Team roll-up, kept beside the individual breakdown. */}
                            {m.teamScores && m.teamScores.length > 0 && (
                              <div className="space-y-1 pt-2 border-t border-kindle-border">
                                {m.teamScores.map((t) => (
                                  <div key={t.id} className="flex items-center justify-between gap-2 text-[11px] font-bold">
                                    <span className="text-kindle-text-muted truncate">{t.label}</span>
                                    <span className="font-mono text-kindle-text shrink-0">{t.total} pts</span>
                                  </div>
                                ))}
                              </div>
                            )}

                            <div className="flex items-center justify-between gap-2 pt-1">
                              <span className="text-[9px] text-kindle-text-muted">
                                {m.roundsPlayed ?? m.rounds?.length ?? 0} rounds
                              </span>
                              <button
                                type="button"
                                onClick={() => openMatchRounds(m.id)}
                                data-testid={`open-rounds-${m.id}`}
                                className="px-3 py-2 min-h-11 bg-kindle-bg border border-kindle-border rounded-xl text-[10px] font-bold text-kindle-text hover:border-kindle-accent transition cursor-pointer flex items-center gap-1 shrink-0"
                              >
                                Round History <ChevronRight className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </>
              )}

              {historySubTab === "rounds" && selectedMatch && (
                <>
                  {/* Breadcrumb back to the outer sub-tab. */}
                  <div className="flex items-center justify-between gap-2 bg-kindle-card border border-kindle-border rounded-2xl p-3">
                    <button
                      type="button"
                      onClick={() => setHistorySubTab("matches")}
                      data-testid="back-to-matches"
                      className="min-h-11 px-3 py-2 bg-kindle-bg border border-kindle-border rounded-xl text-[10px] font-bold text-kindle-text hover:border-kindle-accent transition cursor-pointer flex items-center gap-1.5 shrink-0"
                    >
                      <ArrowLeft className="w-3.5 h-3.5" /> Matches
                    </button>
                    <span className="text-[10px] font-bold text-kindle-text text-right min-w-0 truncate">
                      {selectedMatch.gameName} • {selectedMatch.date}
                    </span>
                  </div>

                  {renderRoundLog(selectedMatch)}
                                  </>
                                )}
                                  </>
                                )}
                              </div>
                            )}

          {/* Tournament Elimination Bracket Tab */}
          {activeTab === "tournament" && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="flex items-center justify-between border-b border-kindle-border pb-3">
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-kindle-text flex items-center gap-1.5">
                    <Trophy className="w-4 h-4 text-yellow-500" /> Tournament Elimination Bracket
                  </h4>
                  <p className="text-[10px] text-kindle-text-muted">
                    Built automatically from your roster while competition mode is on — no generate step.
                  </p>
                </div>
              </div>

              {tournamentBracket ? (
                <div className="bg-kindle-card border border-kindle-border rounded-2xl p-6 space-y-8 shadow-xs">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
                    {/* Semi-Finals */}
                    <div className="space-y-4">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted block border-b border-kindle-border pb-1">
                        Semi-Final Matches
                      </span>
                      {tournamentBracket.round1.map((m, idx) => (
                        <div key={idx} className="p-3 bg-kindle-bg border border-kindle-border rounded-xl space-y-2">
                          <span className="text-[9px] font-bold uppercase text-kindle-text-muted">Match #{idx + 1}</span>
                          <div className="space-y-1">
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-kindle-text">{m.p1}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setBracketPicks((prev) => ({ ...prev, [`r1-${idx}`]: m.p1 }));
                                }}
                                className="px-2 py-0.5 rounded bg-kindle-accent/10 hover:bg-kindle-accent/20 text-kindle-accent text-[9px] font-bold"
                              >
                                Win
                              </button>
                            </div>
                            <div className="flex items-center justify-between text-xs">
                              <span className="font-bold text-kindle-text">{m.p2}</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setBracketPicks((prev) => ({ ...prev, [`r1-${idx}`]: m.p2 }));
                                }}
                                className="px-2 py-0.5 rounded bg-kindle-accent/10 hover:bg-kindle-accent/20 text-kindle-accent text-[9px] font-bold"
                              >
                                Win
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>

                    {/* Finals */}
                    <div className="space-y-4">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-yellow-500 block border-b border-kindle-border pb-1">
                        Championship Finals
                      </span>
                      <div className="p-4 bg-yellow-500/10 border border-yellow-500/30 rounded-2xl space-y-3">
                        <div className="flex items-center gap-2">
                          <Crown className="w-5 h-5 text-yellow-500" />
                          <span className="text-xs font-bold text-kindle-text">Grand Finalists</span>
                        </div>
                        <div className="space-y-2 text-xs">
                          {(["p1", "p2"] as const).map((side) => (
                            <div key={side} className="p-2 bg-kindle-bg border border-kindle-border rounded-xl flex items-center justify-between gap-2">
                              <span className="font-bold text-kindle-text truncate">{tournamentBracket.finals[side]}</span>
                              <button
                                type="button"
                                onClick={() => setBracketPicks((prev) => ({ ...prev, finals: tournamentBracket.finals[side] }))}
                                className="shrink-0 px-2 py-0.5 rounded bg-yellow-500/15 hover:bg-yellow-500/25 text-yellow-500 text-[9px] font-bold cursor-pointer"
                              >
                                Win
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-kindle-text-muted space-y-2">
                  <Trophy className="w-8 h-8 mx-auto text-kindle-text-muted/40" />
                  <p className="text-xs">
                    {players.length < 2
                      ? "Name at least two players in the roster to build a bracket."
                      : "Competition mode is on but no bracket yet — name your players in the roster step."}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
        {/* Confirmations */}
        {pendingPreset && (
          <ConfirmDialog
            title="Discard setup edits?"
            confirmLabel="Apply preset"
            cancelLabel="Keep my edits"
            tone="danger"
            body={(
              <>
                Switching to <strong className="text-kindle-text">{pendingPreset.name}</strong> replaces the win
                condition, target, timer and categories you set in steps 2-5. Player names and handicaps are kept.
              </>
            )}
            onConfirm={confirmPresetSwap}
            onCancel={() => setPendingPreset(null)}
          />
        )}

        {showEditSetupConfirm && (
          <ConfirmDialog
            title="Edit setup during a live match?"
            confirmLabel="Edit setup"
            cancelLabel="Back to match"
            body="Your scores, rounds and clock are kept exactly as they are — the match is not ended. The turn clock will be paused while you are in the wizard."
            onConfirm={() => {
              setShowEditSetupConfirm(false);
              setIsTimerRunning(false);
              setViewingSetup(true);
            }}
            onCancel={() => setShowEditSetupConfirm(false)}
          />
        )}
    </div>
  );
}
