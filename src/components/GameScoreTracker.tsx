import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
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
  Minimize2
} from "lucide-react";
import { toast } from "react-hot-toast";
import { GAME_PRESETS, categorySettingsForPreset, computeTeamStandings, isTeamGame, normalizeTeamAssignments, type GamePreset } from "../lib/gamePresets";

export { GAME_PRESETS } from "../lib/gamePresets";

export interface Player {
  id: string;
  name: string;
  color: string;
  handicap?: number;
  totalTimeSeconds: number;
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
  date: string;
  competitionMode: boolean;
  winnerName: string;
  winnerScore: number;
  players: { name: string; score: number; rank: number }[];
  durationMinutes: number;
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

const DEFAULT_PRESET = GAME_PRESETS[0]!;

function makePlayer(index: number, name = `Player ${index + 1}`): Player {
  return {
    id: `p${index + 1}`,
    name,
    color: PLAYER_COLORS[index % PLAYER_COLORS.length]!,
    totalTimeSeconds: 0,
  };
}

function makeRoster(preset: GamePreset): Player[] {
  return applyPresetTeams(Array.from({ length: preset.playerCount.default }, (_, index) => makePlayer(index)), preset);
}

function applyPresetTeams(players: Player[], preset: GamePreset): Player[] {
  if (!isTeamGame(preset)) return players.map(({ teamId: _teamId, ...player }) => player);
  const ids = preset.teams!.map((team) => team.id);
  if (preset.id === "carrom" && players.length === 2) {
    return players.map((player, index) => ({ ...player, teamId: ids[index] ?? ids[0] }));
  }
  const assignments = normalizeTeamAssignments(players, preset);
  return players.map((player, index) => ({ ...player, teamId: assignments[index]?.teamId }));
}

export default function GameScoreTracker({ open, onClose }: GameScoreTrackerProps) {
  // Game Configuration State
  const [selectedPreset, setSelectedPreset] = useState<GamePreset>(DEFAULT_PRESET);
  const [competitionMode, setCompetitionMode] = useState<boolean>(true);
  const [winCondition, setWinCondition] = useState<"highest" | "lowest">(DEFAULT_PRESET.winCondition);
  const [targetScore, setTargetScore] = useState<number | undefined>(DEFAULT_PRESET.targetScore);
  const [enableCategories, setEnableCategories] = useState<boolean>(!!DEFAULT_PRESET.categories?.length);
  const [categories, setCategories] = useState<string[]>(() => [...(DEFAULT_PRESET.categories ?? [])]);
  const [customCategoryInput, setCustomCategoryInput] = useState<string>("");

  // Players State
  const [players, setPlayers] = useState<Player[]>(() => makeRoster(DEFAULT_PRESET));
  const [newPlayerName, setNewPlayerName] = useState<string>("");

  // Active Match State
  const [matchActive, setMatchActive] = useState<boolean>(false);
  const [rounds, setRounds] = useState<RoundScore[]>([]);
  const [activePlayerIndex, setActivePlayerIndex] = useState<number>(0);
  const [matchStartTime, setMatchStartTime] = useState<number | null>(null);
  const [matchEndTime, setMatchEndTime] = useState<number | null>(null);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Turn Clock & Timer
  const [turnTimerSeconds, setTurnTimerSeconds] = useState<number>(DEFAULT_PRESET.turnTimerSeconds ?? 60);
  const [timeRemaining, setTimeRemaining] = useState<number>(DEFAULT_PRESET.turnTimerSeconds ?? 60);
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(false);

  // Round Input Buffer
  const [roundScoresBuffer, setRoundScoresBuffer] = useState<Record<string, number>>({});
  const [roundCategoryBuffer, setRoundCategoryBuffer] = useState<Record<string, Record<string, number>>>({});

  // Navigation Tabs inside Tracker
  const [activeTab, setActiveTab] = useState<"game" | "history" | "tournament">("game");
  const [setupStep, setSetupStep] = useState<0 | 1>(0);

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

  // Tournament Bracket State
  const [tournamentBracket, setTournamentBracket] = useState<{
    players: string[];
    round1: { p1: string; p2: string; winner?: string }[];
    finals: { p1: string; p2: string; winner?: string };
  } | null>(null);

  // Canvas Confetti Ref
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Load preset specs when preset changes
  const handleSelectPreset = (preset: GamePreset) => {
    setSelectedPreset(preset);
    setWinCondition(preset.winCondition);
    setTargetScore(preset.targetScore);
    const categorySettings = categorySettingsForPreset(preset);
    setCategories(categorySettings.categories);
    setEnableCategories(categorySettings.enabled);
    if (preset.turnTimerSeconds) {
      setTurnTimerSeconds(preset.turnTimerSeconds);
      setTimeRemaining(preset.turnTimerSeconds);
    }
    setPlayers((current) => {
      const count = Math.min(preset.playerCount.max, Math.max(preset.playerCount.min, current.length));
      const next = current.slice(0, count);
      while (next.length < count) {
        const index = next.length;
        next.push({ ...makePlayer(index), id: `${preset.id}-${Date.now()}-${index}` });
      }
      return applyPresetTeams(next, preset);
    });
  };

  // Turn Timer Effect in Competition Mode
  useEffect(() => {
    let timer: any;
    if (matchActive && competitionMode && isTimerRunning) {
      timer = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            playBeepSound(600, 0.2);
            toast("⌛ Turn Time Expired!", { icon: "⏱️" });
            return 0;
          }
          if (prev <= 5 && soundEnabled) {
            playBeepSound(400, 0.05);
          }
          return prev - 1;
        });

        // Add 1s to current active player's time spent
        setPlayers((prev) =>
          prev.map((p, idx) =>
            idx === activePlayerIndex ? { ...p, totalTimeSeconds: p.totalTimeSeconds + 1 } : p
          )
        );
      }, 1000);
    }
    return () => clearInterval(timer);
  }, [matchActive, competitionMode, isTimerRunning, activePlayerIndex, soundEnabled]);

  // Play Web Audio Synth Beep
  const playBeepSound = (freq = 440, duration = 0.1) => {
    if (!soundEnabled) return;
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
    if (!soundEnabled) return;
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
    if (players.length < selectedPreset.playerCount.min || players.length > selectedPreset.playerCount.max) {
      toast.error(`${selectedPreset.name} supports ${selectedPreset.playerCount.label} players.`);
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
    setIsTimerRunning(competitionMode);
    toast.success(`Match Started: ${selectedPreset.name} ${competitionMode ? "🏆 Competition Mode" : "🎲 Casual"}`);
  };

  // Calculate Cumulative Total Scores
  const getPlayerTotal = (playerId: string, scoreRounds: RoundScore[] = rounds): number => {
    const player = players.find((p) => p.id === playerId);
    const handicap = player?.handicap || 0;
    const roundSum = scoreRounds.reduce((sum, r) => sum + (r.playerScores[playerId] || 0), 0);
    return roundSum + handicap;
  };

  // Get Sorted Rankings
  const getRankedPlayers = (scoreRounds: RoundScore[] = rounds) => {
    return [...players].sort((a, b) => {
      const scoreA = getPlayerTotal(a.id, scoreRounds);
      const scoreB = getPlayerTotal(b.id, scoreRounds);
      return winCondition === "highest" ? scoreB - scoreA : scoreA - scoreB;
    });
  };

  const getRankedTeams = (scoreRounds: RoundScore[] = rounds) => {
    const totals = Object.fromEntries(players.map((player) => [player.id, getPlayerTotal(player.id, scoreRounds)]));
    return computeTeamStandings(selectedPreset, players, totals).sort((a, b) =>
      winCondition === "highest" ? b.total - a.total : a.total - b.total
    );
  };

  // Check for Target Score Winner
  const checkWinnerCondition = (updatedRounds: RoundScore[]) => {
    if (!targetScore) return;
    if (isTeamGame(selectedPreset)) {
      const rankedTeams = getRankedTeams(updatedRounds);
      const bestTeam = rankedTeams[0];
      const worstTeam = rankedTeams[rankedTeams.length - 1];
      if (winCondition === "highest" && bestTeam && bestTeam.total >= targetScore) {
        handleFinishMatch(undefined, updatedRounds, bestTeam.label);
      } else if (winCondition === "lowest" && worstTeam && worstTeam.total >= targetScore) {
        handleFinishMatch(undefined, updatedRounds, bestTeam.label);
      }
      return;
    }
    const ranked = getRankedPlayers(updatedRounds);
    const best = ranked[0];
    const worst = ranked[ranked.length - 1];

    if (winCondition === "highest" && best && getPlayerTotal(best.id, updatedRounds) >= targetScore) {
      handleFinishMatch(best, updatedRounds);
    } else if (winCondition === "lowest" && worst && getPlayerTotal(worst.id, updatedRounds) >= targetScore) {
      // In lowest-score games (e.g. Uno), the limit ends the match; the lowest total wins.
      handleFinishMatch(best, updatedRounds);
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
    setTimeRemaining(turnTimerSeconds);
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
  const handleFinishMatch = (forcedWinner?: Player, scoreRounds: RoundScore[] = rounds, forcedWinnerLabel?: string) => {
    const ranked = getRankedPlayers(scoreRounds);
    const rankedTeams = getRankedTeams(scoreRounds);
    const winningTeam = isTeamGame(selectedPreset) ? rankedTeams[0] : undefined;
    const winner = forcedWinner || ranked[0];
    const winnerScore = forcedWinnerLabel
      ? rankedTeams.find((team) => team.label === forcedWinnerLabel)?.total ?? 0
      : winningTeam?.total ?? getPlayerTotal(winner.id, scoreRounds);
    const duration = matchStartTime ? Math.max(1, Math.round((Date.now() - matchStartTime) / 60000)) : 1;

    const historyEntry: MatchHistoryEntry = {
      id: "match_" + Date.now(),
      gameName: selectedPreset.name,
      date: new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }),
      competitionMode,
      winnerName: forcedWinnerLabel ?? winningTeam?.label ?? winner.name,
      winnerScore,
      players: ranked.map((p, idx) => ({
        name: p.name,
        score: getPlayerTotal(p.id, scoreRounds),
        rank: idx + 1
      })),
      durationMinutes: duration
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
    if (players.length >= selectedPreset.playerCount.max) {
      toast.error(`This game supports up to ${selectedPreset.playerCount.max} players.`);
      return;
    }
    const color = PLAYER_COLORS[players.length % PLAYER_COLORS.length];
    const newP: Player = {
      id: "p_" + Date.now(),
      name: newPlayerName.trim(),
      color,
      totalTimeSeconds: 0
    };
    setPlayers(applyPresetTeams([...players, newP], selectedPreset));
    setNewPlayerName("");
    toast.success(`Player added: ${newP.name}`);
  };

  const handleRemovePlayer = (id: string) => {
    if (players.length <= selectedPreset.playerCount.min) {
      toast.error(`${selectedPreset.name} needs at least ${selectedPreset.playerCount.min} players.`);
      return;
    }
    setPlayers(applyPresetTeams(players.filter((p) => p.id !== id), selectedPreset));
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

  // Setup Tournament Elimination Bracket
  const handleGenerateTournament = () => {
    const pNames = players.map((p) => p.name);
    if (pNames.length < 4) {
      toast.error("Tournament mode requires at least 4 players!");
      return;
    }
    setTournamentBracket({
      players: pNames,
      round1: [
        { p1: pNames[0], p2: pNames[1] },
        { p1: pNames[2], p2: pNames[3] }
      ],
      finals: { p1: "Winner M1", p2: "Winner M2" }
    });
    setActiveTab("tournament");
    toast.success("Tournament Bracket Generated!");
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
            <button
              type="button"
              onClick={() => setActiveTab("tournament")}
              className={`px-3 py-1.5 rounded-xl font-bold transition flex items-center gap-1.5 cursor-pointer ${
                activeTab === "tournament"
                  ? "bg-kindle-text text-kindle-bg shadow-sm"
                  : "text-kindle-text-muted hover:text-kindle-text hover:bg-kindle-card"
              }`}
            >
              <Trophy className="w-3.5 h-3.5 text-yellow-500" /> Tournament Bracket
            </button>
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
              {/* Setup / Configuration Panel when match is NOT active */}
              {!matchActive ? (
                <div className="space-y-6">
                  <div className="flex items-center justify-between gap-4 rounded-2xl border border-kindle-border bg-kindle-card px-4 py-3">
                    <div>
                      <p className="text-[9px] font-bold uppercase tracking-[.18em] text-kindle-text-muted">Setup · Step {setupStep + 1} of 2</p>
                      <h3 className="mt-1 text-sm font-bold text-kindle-text">{setupStep === 0 ? "Game & scoring" : "Timer & player roster"}</h3>
                    </div>
                    <div className="flex items-center gap-1.5" aria-label={`Setup step ${setupStep + 1} of 2`}>
                      {[0, 1].map((step) => <span key={step} className={`h-1.5 w-7 rounded-full ${setupStep >= step ? "bg-kindle-accent" : "bg-kindle-border"}`} />)}
                    </div>
                  </div>

                  {setupStep === 0 ? (
                    <>
                      <section className="space-y-3">
                        <h4 className="text-xs font-bold uppercase tracking-wider text-kindle-text flex items-center gap-1.5"><Dices className="w-4 h-4 text-kindle-accent" /> Select Game Preset</h4>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                          {GAME_PRESETS.map((preset) => (
                            <button key={preset.id} type="button" onClick={() => handleSelectPreset(preset)} className={`min-h-32 p-3.5 rounded-2xl border text-left transition duration-200 flex flex-col justify-between gap-2 ${selectedPreset.id === preset.id ? "bg-kindle-card border-kindle-accent ring-1 ring-kindle-accent/40 shadow-xs" : "bg-kindle-bg border-kindle-border hover:border-kindle-text-muted/40"}`}>
                              <div className="flex items-center justify-between"><span className="text-2xl">{preset.iconName}</span><span className="text-[8px] font-bold uppercase tracking-widest px-1.5 py-0.5 rounded bg-kindle-bg border border-kindle-border text-kindle-text-muted">{preset.type}</span></div>
                              <div><h5 className="text-xs font-bold text-kindle-text">{preset.name}</h5><p className="text-[9px] text-kindle-text-muted line-clamp-2 mt-0.5">{preset.description}</p><p className="mt-1 text-[8px] font-bold uppercase tracking-wider text-kindle-accent">{preset.playerCount.label} players</p></div>
                            </button>
                          ))}
                        </div>
                      </section>

                      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-4 space-y-3">
                          <label className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted block">Win Condition & Target</label>
                          <div className="grid grid-cols-2 gap-2">
                            {(["highest", "lowest"] as const).map((condition) => <button key={condition} type="button" onClick={() => setWinCondition(condition)} className={`py-2 text-xs font-bold rounded-xl border transition ${winCondition === condition ? "bg-kindle-accent text-kindle-bg border-kindle-accent" : "bg-kindle-bg text-kindle-text-muted border-kindle-border"}`}>{condition === "highest" ? "Highest Wins" : "Lowest Wins"}</button>)}
                          </div>
                          <div className="flex items-center justify-between gap-3 pt-2 border-t border-kindle-border"><span className="text-xs font-bold text-kindle-text">Target Points</span><input type="number" min={0} value={targetScore ?? ""} onChange={(event) => setTargetScore(event.target.value ? Number.parseInt(event.target.value, 10) : undefined)} placeholder="No limit" className="w-24 px-2 py-1 bg-kindle-bg border border-kindle-border rounded-xl text-xs font-mono text-center font-bold text-kindle-text" /></div>
                        </section>

                        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-4 space-y-3">
                          <div className="flex items-center justify-between"><label className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted">Scoring Categories</label><button type="button" aria-pressed={enableCategories} onClick={() => setEnableCategories(!enableCategories)} className={`px-3 py-1 rounded-full text-[9px] font-bold uppercase ${enableCategories ? "bg-kindle-accent text-kindle-bg" : "bg-kindle-bg text-kindle-text-muted border border-kindle-border"}`}>{enableCategories ? "On" : "Off"}</button></div>
                          {enableCategories && <>
                            <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto">{categories.map((category, index) => <span key={`${category}-${index}`} className="inline-flex items-center gap-1 rounded-lg border border-kindle-border bg-kindle-bg px-2 py-1 text-[9px] font-bold text-kindle-text">{category}<button type="button" aria-label={`Remove ${category}`} onClick={() => setCategories((current) => current.filter((_, i) => i !== index))} className="text-kindle-text-muted hover:text-red-400">×</button></span>)}</div>
                            <div className="flex gap-2"><input type="text" value={customCategoryInput} onChange={(event) => setCustomCategoryInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter" && customCategoryInput.trim()) { setCategories((current) => current.includes(customCategoryInput.trim()) ? current : [...current, customCategoryInput.trim()]); setCustomCategoryInput(""); } }} placeholder="Add a scoring category" className="min-w-0 flex-1 px-2 py-2 bg-kindle-bg border border-kindle-border rounded-xl text-[10px] text-kindle-text" /><button type="button" onClick={() => { const value = customCategoryInput.trim(); if (value && !categories.some((item) => item.toLowerCase() === value.toLowerCase())) setCategories([...categories, value]); setCustomCategoryInput(""); }} className="px-3 py-2 bg-kindle-text text-kindle-bg rounded-xl text-xs font-bold"><Plus className="h-4 w-4" /></button></div>
                          </>}
                          {selectedPreset.specialConditions?.length ? <div className="border-t border-kindle-border pt-2"><p className="mb-1 text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted">Preset rules</p><ul className="space-y-1 text-[9px] text-kindle-text-muted">{selectedPreset.specialConditions.map((condition) => <li key={condition.id}><strong className="text-kindle-text">{condition.label}:</strong> {condition.detail}</li>)}</ul></div> : null}
                          {selectedPreset.notes?.map((note, index) => <p key={index} className="text-[9px] leading-relaxed text-kindle-text-muted">{note}</p>)}
                        </section>
                      </div>

                      <div className="flex justify-end"><button type="button" onClick={() => setSetupStep(1)} className="inline-flex items-center gap-2 rounded-xl bg-kindle-text px-6 py-3 text-xs font-bold uppercase tracking-wider text-kindle-bg">Continue to timer & roster <ChevronRight className="h-4 w-4" /></button></div>
                    </>
                  ) : (
                    <>
                      <div className="bg-kindle-card border border-kindle-border rounded-2xl p-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                        <div className="flex items-start gap-3"><span className={`p-2.5 rounded-xl border ${competitionMode ? "bg-[#e0533c]/10 border-[#e0533c]/30 text-[#e0533c]" : "bg-kindle-bg border-kindle-border text-kindle-text-muted"}`}><Swords className="w-5 h-5" /></span><div><h4 className="text-xs font-bold text-kindle-text">Competition Mode</h4><p className="mt-1 text-[10px] text-kindle-text-muted">Track turn times, lock round scores, and enable the tournament bracket.</p></div></div>
                        <button type="button" role="switch" aria-checked={competitionMode} onClick={() => setCompetitionMode(!competitionMode)} className={`w-12 h-6 rounded-full p-0.5 transition-colors flex items-center shrink-0 ${competitionMode ? "bg-[#e0533c]" : "bg-neutral-700"}`}><motion.span layout className="w-5 h-5 rounded-full bg-white shadow-md" animate={{ x: competitionMode ? 24 : 0 }} transition={{ type: "spring", stiffness: 500, damping: 30 }} /></button>
                      </div>

                      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(220px,.7fr)_minmax(0,1.3fr)]">
                        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-4 space-y-3">
                          <h4 className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted flex items-center gap-2"><Clock className="w-4 h-4 text-kindle-accent" /> Turn Timer</h4>
                          <div className="grid grid-cols-3 gap-1.5">{[...new Set([30, 60, 90, 120, 180, 300, selectedPreset.turnTimerSeconds].filter((seconds): seconds is number => typeof seconds === "number" && seconds > 0))].sort((a, b) => a - b).map((seconds) => <button key={seconds} type="button" onClick={() => { setTurnTimerSeconds(seconds); setTimeRemaining(seconds); }} className={`py-2 text-xs font-mono font-bold rounded-xl border ${turnTimerSeconds === seconds ? "bg-kindle-text text-kindle-bg border-kindle-text" : "bg-kindle-bg text-kindle-text-muted border-kindle-border"}`}>{seconds >= 60 && seconds % 60 === 0 ? `${seconds / 60}m` : `${seconds}s`}</button>)}</div>
                          <label className="flex items-center justify-between gap-2 border-t border-kindle-border pt-3 text-[10px] font-bold text-kindle-text-muted">Custom seconds<input type="number" min={5} max={3600} value={turnTimerSeconds} onChange={(event) => { const seconds = Math.min(3600, Math.max(5, Number.parseInt(event.target.value, 10) || 5)); setTurnTimerSeconds(seconds); setTimeRemaining(seconds); }} className="w-20 rounded-lg border border-kindle-border bg-kindle-bg px-2 py-1 text-center font-mono text-kindle-text" /></label>
                          <label className="flex items-center gap-2 text-[10px] text-kindle-text-muted"><input type="checkbox" checked={soundEnabled} onChange={(event) => setSoundEnabled(event.target.checked)} /> Sound and countdown cues</label>
                          <p className="text-[9px] text-kindle-text-muted">Default for {selectedPreset.name}: {selectedPreset.turnTimerSeconds ?? 60} seconds.</p>
                        </section>

                        <section className="bg-kindle-card border border-kindle-border rounded-2xl p-4 space-y-4">
                          <div className="flex flex-col gap-3 border-b border-kindle-border pb-3 sm:flex-row sm:items-center sm:justify-between"><div><h4 className="text-xs font-bold uppercase tracking-wider text-kindle-text flex items-center gap-1.5"><Users className="w-4 h-4 text-kindle-accent" /> Player Roster ({players.length})</h4><p className="mt-1 text-[10px] text-kindle-text-muted">{selectedPreset.name} · {selectedPreset.playerCount.label} players. Add names and handicaps.</p></div><div className="flex w-full items-center gap-2 sm:w-auto"><input type="text" value={newPlayerName} onChange={(event) => setNewPlayerName(event.target.value)} onKeyDown={(event) => event.key === "Enter" && handleAddPlayer()} placeholder="Player name" className="min-w-0 flex-1 px-3 py-2 bg-kindle-bg border border-kindle-border rounded-xl text-xs text-kindle-text sm:w-44" /><button type="button" onClick={handleAddPlayer} disabled={players.length >= selectedPreset.playerCount.max} className="flex shrink-0 items-center gap-1 rounded-xl bg-kindle-text px-4 py-2 text-xs font-bold text-kindle-bg disabled:opacity-40"><Plus className="w-3.5 h-3.5" /> Add</button></div></div>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">{players.map((player) => <div key={player.id} className="flex items-center justify-between gap-3 rounded-xl border border-kindle-border bg-kindle-bg p-3"><div className="flex min-w-0 items-center gap-2.5"><span className="h-3.5 w-3.5 shrink-0 rounded-full border border-white/20" style={{ backgroundColor: player.color }} /><span className="truncate text-xs font-bold text-kindle-text">{player.name}{player.teamId ? ` · ${selectedPreset.teams?.find((team) => team.id === player.teamId)?.label ?? ""}` : ""}</span></div><div className="flex items-center gap-2"><label className="flex items-center gap-1 text-[9px] text-kindle-text-muted">Hdcp<input type="number" value={player.handicap ?? 0} onChange={(event) => { const handicap = Number.parseInt(event.target.value, 10) || 0; setPlayers((current) => current.map((entry) => entry.id === player.id ? { ...entry, handicap } : entry)); }} className="w-12 rounded border border-kindle-border bg-kindle-card px-1 py-1 text-center font-mono text-kindle-text" /></label><button type="button" disabled={players.length <= selectedPreset.playerCount.min} onClick={() => handleRemovePlayer(player.id)} title="Remove player" className="p-1 text-kindle-text-muted hover:text-red-400 disabled:opacity-30"><Trash2 className="w-3.5 h-3.5" /></button></div></div>)}</div>
                        </section>
                      </div>

                      <div className="flex flex-col-reverse gap-3 border-t border-kindle-border pt-4 sm:flex-row sm:items-center sm:justify-between"><button type="button" onClick={() => setSetupStep(0)} className="rounded-xl border border-kindle-border px-5 py-3 text-xs font-bold uppercase tracking-wider text-kindle-text">Back to game & scoring</button><button type="button" onClick={handleStartMatch} className="inline-flex items-center justify-center gap-2 rounded-xl bg-kindle-text px-8 py-3.5 text-xs font-bold uppercase tracking-wider text-kindle-bg shadow-lg"><Play className="w-4 h-4 fill-current" /> Launch Arena Match</button></div>
                    </>
                  )}
                </div>
              ) : (
                /* Active Match Arena */
                <div className="space-y-6 animate-in fade-in duration-300">
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

                      {isTeamGame(selectedPreset) && <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                        {getRankedTeams().map((team, index) => <div key={team.teamId} className={`flex items-center justify-between rounded-xl border px-3 py-2 ${index === 0 ? "border-kindle-accent/50 bg-kindle-accent/10" : "border-kindle-border bg-kindle-bg"}`}>
                          <div className="min-w-0"><p className="text-[10px] font-bold text-kindle-text">{team.label}</p><p className="truncate text-[9px] text-kindle-text-muted">{team.memberIds.map((id) => players.find((player) => player.id === id)?.name).filter(Boolean).join(" · ")}</p></div>
                          <span className="ml-3 font-mono text-sm font-bold text-kindle-text">{team.total}</span>
                        </div>)}
                      </div>}

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

          {/* Match History Tab */}
          {activeTab === "history" && (
            <div className="space-y-4 animate-in fade-in duration-200">
              <div className="flex items-center justify-between border-b border-kindle-border pb-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-kindle-text flex items-center gap-1.5">
                  <History className="w-4 h-4 text-kindle-accent" /> Saved Match Archives
                </h4>
                {matchHistory.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      setMatchHistory([]);
                      localStorage.removeItem("kora_game_score_history");
                      toast("History cleared", { icon: "🧹" });
                    }}
                    className="text-[10px] text-red-400 hover:underline cursor-pointer"
                  >
                    Clear History
                  </button>
                )}
              </div>

              {matchHistory.length === 0 ? (
                <div className="py-12 text-center text-kindle-text-muted space-y-2">
                  <Trophy className="w-8 h-8 mx-auto text-kindle-text-muted/40" />
                  <p className="text-xs">No completed matches recorded yet.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {matchHistory.map((m) => (
                    <div
                      key={m.id}
                      className="bg-kindle-card border border-kindle-border rounded-2xl p-4 space-y-3 shadow-xs"
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <span className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted block">
                            {m.date} • {m.durationMinutes}m
                          </span>
                          <h5 className="text-xs font-bold text-kindle-text">{m.gameName}</h5>
                        </div>
                        <span className="px-2 py-0.5 rounded bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 text-[9px] font-bold flex items-center gap-1">
                          👑 {m.winnerName} ({m.winnerScore} pts)
                        </span>
                      </div>

                      <div className="space-y-1 pt-2 border-t border-kindle-border">
                        {m.players.map((pl) => (
                          <div key={pl.name} className="flex items-center justify-between text-[11px]">
                            <span className="text-kindle-text-muted">
                              #{pl.rank} {pl.name}
                            </span>
                            <span className="font-mono font-bold text-kindle-text">{pl.score} pts</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
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
                  <p className="text-[10px] text-kindle-text-muted">Knockout bracket competition generator for 4+ players.</p>
                </div>

                <button
                  type="button"
                  onClick={handleGenerateTournament}
                  className="px-3 py-1.5 bg-kindle-text text-kindle-bg rounded-xl text-xs font-bold cursor-pointer hover:bg-opacity-90 transition"
                >
                  Generate 4-Player Bracket
                </button>
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
                                  const updated = { ...tournamentBracket };
                                  updated.round1[idx].winner = m.p1;
                                  if (idx === 0) updated.finals.p1 = m.p1;
                                  if (idx === 1) updated.finals.p2 = m.p1;
                                  setTournamentBracket(updated);
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
                                  const updated = { ...tournamentBracket };
                                  updated.round1[idx].winner = m.p2;
                                  if (idx === 0) updated.finals.p1 = m.p2;
                                  if (idx === 1) updated.finals.p2 = m.p2;
                                  setTournamentBracket(updated);
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
                          <div className="p-2 bg-kindle-bg border border-kindle-border rounded-xl flex items-center justify-between">
                            <span className="font-bold text-kindle-text">{tournamentBracket.finals.p1}</span>
                          </div>
                          <div className="p-2 bg-kindle-bg border border-kindle-border rounded-xl flex items-center justify-between">
                            <span className="font-bold text-kindle-text">{tournamentBracket.finals.p2}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="py-12 text-center text-kindle-text-muted space-y-2">
                  <Trophy className="w-8 h-8 mx-auto text-kindle-text-muted/40" />
                  <p className="text-xs">Click 'Generate 4-Player Bracket' above to start a tournament!</p>
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}
