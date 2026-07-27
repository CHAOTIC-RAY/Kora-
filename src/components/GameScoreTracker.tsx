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
  AlertTriangle
} from "lucide-react";
import { toast } from "react-hot-toast";

export interface GamePreset {
  id: string;
  name: string;
  type: "board" | "card" | "custom";
  winCondition: "highest" | "lowest";
  targetScore?: number;
  maxRounds?: number;
  categories?: string[];
  turnTimerSeconds?: number;
  description: string;
  iconName: string;
}

export const GAME_PRESETS: GamePreset[] = [
  {
    id: "catan",
    name: "Settlers of Catan",
    type: "board",
    winCondition: "highest",
    targetScore: 10,
    categories: ["Settlements/Cities", "Longest Road", "Largest Army", "Dev Victory Cards"],
    turnTimerSeconds: 90,
    description: "Race to 10 Victory Points through settlements, roads, knights, and developments.",
    iconName: "🏝️"
  },
  {
    id: "ticket-to-ride",
    name: "Ticket to Ride",
    type: "board",
    winCondition: "highest",
    categories: ["Route Points", "Completed Tickets", "Longest Continuous Path", "Unfinished Tickets Penalty"],
    turnTimerSeconds: 60,
    description: "Build railway routes across continents. Sum points from routes, tickets, and penalties.",
    iconName: "🚂"
  },
  {
    id: "carcassonne",
    name: "Carcassonne",
    type: "board",
    winCondition: "highest",
    categories: ["Knights & Castles", "Roads & Thieves", "Monasteries & Monks", "Farmers & Fields"],
    turnTimerSeconds: 45,
    description: "Tile-placement scoring for completed features and final farm evaluation.",
    iconName: "🏰"
  },
  {
    id: "7wonders",
    name: "7 Wonders",
    type: "board",
    winCondition: "highest",
    categories: ["Military Conflicts", "Treasury Gold", "Wonder Stages", "Civic Structures", "Scientific Symbols", "Commercial / Guilds"],
    turnTimerSeconds: 60,
    description: "Card drafting ancient civilization score matrix across 7 distinct categories.",
    iconName: "🏛️"
  },
  {
    id: "uno",
    name: "Uno / Crazy Eights",
    type: "card",
    winCondition: "lowest",
    targetScore: 500,
    turnTimerSeconds: 30,
    description: "Accumulate points from remaining hand cards. Lowest score wins (or race to 500 max limit).",
    iconName: "🃏"
  },
  {
    id: "hearts-spades",
    name: "Hearts / Spades / Euchre",
    type: "card",
    winCondition: "lowest",
    targetScore: 100,
    turnTimerSeconds: 40,
    description: "Trick-taking card game. Avoid taking penalty hearts/queen or hit target tricks.",
    iconName: "♠️"
  },
  {
    id: "scrabble",
    name: "Scrabble / Boggle",
    type: "board",
    winCondition: "highest",
    turnTimerSeconds: 120,
    description: "Word building scores with letter tile multipliers and bingo bonuses.",
    iconName: "🔤"
  },
  {
    id: "custom",
    name: "Custom Game Tracker",
    type: "custom",
    winCondition: "highest",
    turnTimerSeconds: 60,
    description: "Tailor custom player counts, win conditions, turn clocks, and custom categories.",
    iconName: "🎲"
  }
];

export interface Player {
  id: string;
  name: string;
  color: string;
  handicap?: number;
  totalTimeSeconds: number;
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

export default function GameScoreTracker({ open, onClose }: GameScoreTrackerProps) {
  // Game Configuration State
  const [selectedPreset, setSelectedPreset] = useState<GamePreset>(GAME_PRESETS[0]);
  const [competitionMode, setCompetitionMode] = useState<boolean>(true);
  const [winCondition, setWinCondition] = useState<"highest" | "lowest">("highest");
  const [targetScore, setTargetScore] = useState<number | undefined>(10);
  const [enableCategories, setEnableCategories] = useState<boolean>(false);
  const [categories, setCategories] = useState<string[]>([]);
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
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);

  // Turn Clock & Timer
  const [turnTimerSeconds, setTurnTimerSeconds] = useState<number>(60);
  const [timeRemaining, setTimeRemaining] = useState<number>(60);
  const [isTimerRunning, setIsTimerRunning] = useState<boolean>(false);

  // Round Input Buffer
  const [roundScoresBuffer, setRoundScoresBuffer] = useState<Record<string, number>>({});
  const [roundCategoryBuffer, setRoundCategoryBuffer] = useState<Record<string, Record<string, number>>>({});

  // Navigation Tabs inside Tracker
  const [activeTab, setActiveTab] = useState<"game" | "history" | "tournament">("game");

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
    if (preset.categories && preset.categories.length > 0) {
      setCategories(preset.categories);
      setEnableCategories(true);
    } else {
      setCategories([]);
      setEnableCategories(false);
    }
    if (preset.turnTimerSeconds) {
      setTurnTimerSeconds(preset.turnTimerSeconds);
      setTimeRemaining(preset.turnTimerSeconds);
    }
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
    setIsTimerRunning(competitionMode);
    toast.success(`Match Started: ${selectedPreset.name} ${competitionMode ? "🏆 Competition Mode" : "🎲 Casual"}`);
  };

  // Calculate Cumulative Total Scores
  const getPlayerTotal = (playerId: string): number => {
    const player = players.find((p) => p.id === playerId);
    const handicap = player?.handicap || 0;
    const roundSum = rounds.reduce((sum, r) => sum + (r.playerScores[playerId] || 0), 0);
    return roundSum + handicap;
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
  const handleFinishMatch = (forcedWinner?: Player) => {
    const ranked = getRankedPlayers();
    const winner = forcedWinner || ranked[0];
    const winnerScore = getPlayerTotal(winner.id);
    const duration = matchStartTime ? Math.max(1, Math.round((Date.now() - matchStartTime) / 60000)) : 1;

    const historyEntry: MatchHistoryEntry = {
      id: "match_" + Date.now(),
      gameName: selectedPreset.name,
      date: new Date().toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }),
      competitionMode,
      winnerName: winner.name,
      winnerScore,
      players: ranked.map((p, idx) => ({
        name: p.name,
        score: getPlayerTotal(p.id),
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

  return (
    <div className="fixed inset-0 z-50 bg-kindle-bg sm:bg-black/75 sm:backdrop-blur-md flex flex-col sm:items-center sm:justify-center sm:p-4 overflow-hidden">
      {/* Canvas Confetti Layer */}
      <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-50" />

      <motion.div
        initial={{ opacity: 0, scale: 0.98, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.98, y: 10 }}
        className="w-full h-full sm:h-[96vh] sm:max-w-7xl bg-kindle-bg border-0 sm:border sm:border-kindle-border sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col"
      >


        {/* Header Bar */}
        <div className="px-6 py-3.5 border-b border-kindle-border bg-kindle-card/80 backdrop-blur flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-kindle-accent/10 border border-kindle-accent/25 flex items-center justify-center text-xl shrink-0">
              {selectedPreset.iconName}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-base font-bold tracking-tight text-kindle-text">
                  Board & Card Game Score Tracker
                </h3>
                {competitionMode && (
                  <span className="px-2 py-0.5 rounded-full bg-[#e0533c]/10 text-[#e0533c] border border-[#e0533c]/25 text-[9px] font-bold uppercase tracking-widest flex items-center gap-1">
                    <Swords className="w-3 h-3" /> Competition Mode
                  </span>
                )}
              </div>
              <p className="text-[10px] text-kindle-text-muted">
                {selectedPreset.name} • {winCondition === "highest" ? "Highest Score Wins" : "Lowest Score Wins"}
              </p>
            </div>
          </div>

          {/* Header Controls */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSoundEnabled(!soundEnabled)}
              className="p-2 bg-kindle-bg border border-kindle-border rounded-xl text-kindle-text hover:border-kindle-accent transition cursor-pointer"
              title={soundEnabled ? "Mute Game Audio" : "Enable Game Audio"}
            >
              {soundEnabled ? <Volume2 className="w-4 h-4 text-kindle-accent" /> : <VolumeX className="w-4 h-4 text-kindle-text-muted" />}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-2 bg-kindle-bg border border-kindle-border rounded-xl text-kindle-text hover:bg-kindle-border transition cursor-pointer"
            >
              <X className="w-4 h-4" />
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
        <div className="p-6 overflow-y-auto space-y-6 flex-1">
          {activeTab === "game" && (
            <>
              {/* Setup / Configuration Panel when match is NOT active */}
              {!matchActive ? (
                <div className="space-y-6">
                  {/* Preset Selector */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h4 className="text-xs font-bold uppercase tracking-wider text-kindle-text flex items-center gap-1.5">
                        <Dices className="w-4 h-4 text-kindle-accent" /> Select Game Preset
                      </h4>
                      <button
                        type="button"
                        onClick={() => setCompetitionMode(!competitionMode)}
                        className={`px-3 py-1 rounded-xl text-xs font-bold border transition cursor-pointer flex items-center gap-1.5 ${
                          competitionMode
                            ? "bg-[#e0533c]/10 text-[#e0533c] border-[#e0533c]/30 shadow-xs"
                            : "bg-kindle-card text-kindle-text-muted border-kindle-border"
                        }`}
                      >
                        <Swords className="w-3.5 h-3.5" />
                        Competition Mode: {competitionMode ? "ON 🏆" : "OFF (Casual)"}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {GAME_PRESETS.map((preset) => (
                        <button
                          key={preset.id}
                          type="button"
                          onClick={() => handleSelectPreset(preset)}
                          className={`p-3.5 rounded-2xl border text-left transition duration-200 cursor-pointer flex flex-col justify-between space-y-2 ${
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
                  </div>

                  {/* Mode Settings & Competition Toggles */}
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                    {/* Win Condition Box */}
                    <div className="bg-kindle-card border border-kindle-border rounded-2xl p-4 space-y-3">
                      <label className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted block">
                        Win Condition & Target
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <button
                          type="button"
                          onClick={() => setWinCondition("highest")}
                          className={`py-1.5 text-xs font-bold rounded-xl border transition ${
                            winCondition === "highest"
                              ? "bg-kindle-accent text-black border-kindle-accent"
                              : "bg-kindle-bg text-kindle-text-muted border-kindle-border"
                          }`}
                        >
                          Highest Wins
                        </button>
                        <button
                          type="button"
                          onClick={() => setWinCondition("lowest")}
                          className={`py-1.5 text-xs font-bold rounded-xl border transition ${
                            winCondition === "lowest"
                              ? "bg-kindle-accent text-black border-kindle-accent"
                              : "bg-kindle-bg text-kindle-text-muted border-kindle-border"
                          }`}
                        >
                          Lowest Wins
                        </button>
                      </div>

                      <div className="flex items-center justify-between pt-2 border-t border-kindle-border">
                        <span className="text-xs font-bold text-kindle-text">Target Points:</span>
                        <input
                          type="number"
                          value={targetScore || ""}
                          onChange={(e) => setTargetScore(e.target.value ? parseInt(e.target.value, 10) : undefined)}
                          placeholder="No Limit"
                          className="w-24 px-2 py-1 bg-kindle-bg border border-kindle-border rounded-xl text-xs font-mono text-center font-bold text-kindle-text focus:outline-none focus:border-kindle-accent"
                        />
                      </div>
                    </div>

                    {/* Turn Clock / Competition Settings */}
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
                            onClick={() => {
                              setTurnTimerSeconds(sec);
                              setTimeRemaining(sec);
                            }}
                            className={`py-1.5 text-xs font-mono font-bold rounded-xl border transition ${
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
                        In Competition Mode, players receive time alarms and speed bonuses.
                      </p>
                    </div>

                    {/* Category Scoring Toggle */}
                    <div className="bg-kindle-card border border-kindle-border rounded-2xl p-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted">
                          Multi-Category Matrix
                        </label>
                        <button
                          type="button"
                          onClick={() => setEnableCategories(!enableCategories)}
                          className={`w-9 h-5 rounded-full p-0.5 transition ${
                            enableCategories ? "bg-kindle-accent" : "bg-kindle-border"
                          }`}
                        >
                          <div
                            className={`w-4 h-4 rounded-full bg-black transform transition ${
                              enableCategories ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </div>

                      {enableCategories ? (
                        <div className="space-y-2">
                          <div className="flex flex-wrap gap-1 max-h-20 overflow-y-auto">
                            {categories.map((cat, idx) => (
                              <span
                                key={idx}
                                className="px-2 py-0.5 bg-kindle-bg border border-kindle-border rounded-lg text-[9px] font-bold text-kindle-text flex items-center gap-1"
                              >
                                {cat}
                                <button
                                  type="button"
                                  onClick={() => setCategories(categories.filter((_, i) => i !== idx))}
                                  className="text-kindle-text-muted hover:text-red-400"
                                >
                                  ×
                                </button>
                              </span>
                            ))}
                          </div>
                          <div className="flex gap-1">
                            <input
                              type="text"
                              value={customCategoryInput}
                              onChange={(e) => setCustomCategoryInput(e.target.value)}
                              placeholder="Add custom category..."
                              className="flex-1 px-2 py-1 bg-kindle-bg border border-kindle-border rounded-xl text-[10px] text-kindle-text"
                            />
                            <button
                              type="button"
                              onClick={() => {
                                if (customCategoryInput.trim()) {
                                  setCategories([...categories, customCategoryInput.trim()]);
                                  setCustomCategoryInput("");
                                }
                              }}
                              className="px-2 py-1 bg-kindle-text text-kindle-bg rounded-xl text-[10px] font-bold"
                            >
                              +
                            </button>
                          </div>
                        </div>
                      ) : (
                        <p className="text-[9px] text-kindle-text-muted">
                          Single round score input mode enabled.
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Player Roster Builder */}
                  <div className="bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-4">
                    <div className="flex items-center justify-between border-b border-kindle-border pb-3">
                      <div>
                        <h4 className="text-xs font-bold uppercase tracking-wider text-kindle-text flex items-center gap-1.5">
                          <Users className="w-4 h-4 text-kindle-accent" /> Competitor Roster ({players.length} Players)
                        </h4>
                        <p className="text-[10px] text-kindle-text-muted">Add players and optional handicap adjustments before launching match.</p>
                      </div>

                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          value={newPlayerName}
                          onChange={(e) => setNewPlayerName(e.target.value)}
                          onKeyDown={(e) => e.key === "Enter" && handleAddPlayer()}
                          placeholder="New competitor name..."
                          className="px-3 py-1.5 bg-kindle-bg border border-kindle-border rounded-xl text-xs text-kindle-text focus:outline-none focus:border-kindle-accent"
                        />
                        <button
                          type="button"
                          onClick={handleAddPlayer}
                          className="px-3 py-1.5 bg-kindle-text text-kindle-bg rounded-xl text-xs font-bold hover:bg-opacity-90 transition cursor-pointer flex items-center gap-1"
                        >
                          <Plus className="w-3.5 h-3.5" /> Add
                        </button>
                      </div>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {players.map((p, idx) => (
                        <div
                          key={p.id}
                          className="p-3 bg-kindle-bg border border-kindle-border rounded-xl flex items-center justify-between gap-3 shadow-xs"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            <div
                              className="w-4 h-4 rounded-full shrink-0 shadow-xs border border-white/20"
                              style={{ backgroundColor: p.color }}
                            />
                            <span className="text-xs font-bold text-kindle-text truncate">{p.name}</span>
                          </div>

                          <div className="flex items-center gap-2">
                            {/* Handicap Input */}
                            <div className="flex items-center gap-1 text-[10px] text-kindle-text-muted">
                              <span>Hdcp:</span>
                              <input
                                type="number"
                                value={p.handicap || 0}
                                onChange={(e) => {
                                  const val = parseInt(e.target.value, 10) || 0;
                                  setPlayers(players.map((pl) => (pl.id === p.id ? { ...pl, handicap: val } : pl)));
                                }}
                                className="w-10 px-1 py-0.5 bg-kindle-card border border-kindle-border rounded font-mono text-center text-kindle-text"
                              />
                            </div>

                            <button
                              type="button"
                              onClick={() => handleRemovePlayer(p.id)}
                              className="p-1 text-kindle-text-muted hover:text-red-400 transition cursor-pointer"
                              title="Remove Competitor"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Launch Match Button */}
                  <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-4">
                    <div className="text-[10px] text-kindle-text-muted flex items-center gap-1.5">
                      <ShieldAlert className="w-4 h-4 text-kindle-accent shrink-0" />
                      <span>In Competition Mode, scores are locked per round and turn times are logged.</span>
                    </div>

                    <button
                      type="button"
                      onClick={handleStartMatch}
                      className="w-full sm:w-auto px-8 py-3.5 bg-kindle-text text-kindle-bg font-bold text-xs uppercase tracking-wider rounded-2xl hover:bg-opacity-90 active:scale-98 transition shadow-lg flex items-center justify-center gap-2 cursor-pointer"
                    >
                      <Play className="w-4 h-4 fill-current" /> Launch Arena Match
                    </button>
                  </div>
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
                          className="px-6 py-2.5 bg-kindle-accent text-black font-bold text-xs uppercase tracking-wider rounded-xl hover:bg-opacity-90 transition shadow-md cursor-pointer flex items-center gap-1.5"
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
