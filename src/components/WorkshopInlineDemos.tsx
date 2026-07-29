import React, { useState, useEffect, useRef } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Swords, Trophy, Grid3X3, Search, Globe, BookA, RefreshCw, Crown, Sparkles, Check, ChevronRight } from "lucide-react";

// ── 1. LINGUIST GUARDIAN (2D Pokémon style battle arena) ──
type SpriteKind = "guardian" | "rival" | "boss";

function MonSprite({ kind, scale = 1 }: { kind: SpriteKind; scale?: number }) {
  const S = (n: number) => n * scale;
  if (kind === "guardian") {
    return (
      <svg width={S(110)} height={S(110)} viewBox="0 0 120 120" className="block drop-shadow-md" aria-hidden>
        <defs>
          <radialGradient id="gw" cx="42%" cy="38%" r="70%">
            <stop offset="0%" stopColor="#fff7e6" />
            <stop offset="100%" stopColor="#e4d4b2" />
          </radialGradient>
          <linearGradient id="gb" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#c98f4e" />
            <stop offset="100%" stopColor="#9c6a34" />
          </linearGradient>
        </defs>
        <ellipse cx="60" cy="112" rx="34" ry="6" fill="#000" opacity="0.18" />
        <path d="M28 56c0-22 14-40 32-40s32 18 32 40c0 26-16 46-32 46S28 82 28 56z" fill="url(#gw)" stroke="#2a2113" strokeWidth="3" />
        <path d="M40 40c8-10 32-10 40 0 4-12-6-22-20-22S36 28 40 40z" fill="url(#gb)" stroke="#2a2113" strokeWidth="2.5" />
        <path d="M52 36c-7-2-12 4-12 4M68 36c7-2 12 4 12 4" stroke="#2a2113" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <circle cx="46" cy="58" r="15" fill="#fdfcf7" stroke="#2a2113" strokeWidth="2.5" />
        <circle cx="74" cy="58" r="15" fill="#fdfcf7" stroke="#2a2113" strokeWidth="2.5" />
        <circle cx="48" cy="60" r="6.5" fill="#1a1510" />
        <circle cx="72" cy="60" r="6.5" fill="#1a1510" />
        <circle cx="50.5" cy="57.5" r="2" fill="#fff" />
        <circle cx="74.5" cy="57.5" r="2" fill="#fff" />
        <path d="M60 66l-7 9h14z" fill="url(#gb)" stroke="#2a2113" strokeWidth="2" />
        <path d="M60 75v5" stroke="#2a2113" strokeWidth="2" />
        <path d="M44 78c-6 6-12 6-16 2 4 8 14 10 20 4M76 78c6 6 12 6 16 2-4 8-14 10-20 4" fill="#e4d4b2" stroke="#2a2113" strokeWidth="2.2" strokeLinejoin="round" />
        <path d="M34 70c-8 2-12 10-10 16 2-8 8-12 14-12M86 70c8 2 12 10 10 16-2-8-8-12-14-12" fill="#cdb892" stroke="#2a2113" strokeWidth="2" />
      </svg>
    );
  }
  if (kind === "rival") {
    return (
      <svg width={S(110)} height={S(110)} viewBox="0 0 120 120" className="block drop-shadow-md" aria-hidden>
        <defs>
          <radialGradient id="rw" cx="42%" cy="36%" r="72%">
            <stop offset="0%" stopColor="#a6e07a" />
            <stop offset="100%" stopColor="#5f9e44" />
          </radialGradient>
        </defs>
        <ellipse cx="60" cy="112" rx="32" ry="6" fill="#000" opacity="0.18" />
        <path d="M30 44c0-18 12-30 30-30s30 12 30 30c0 14-6 26-14 34 8 4 14 10 14 18 0 12-12 18-30 18s-30-8-30-20c0-8 6-14 14-18-10-8-14-20-14-32z" fill="url(#rw)" stroke="#16331a" strokeWidth="3" />
        <path d="M34 26l8 20 14-12zM86 26l-8 20-14-12z" fill="#7fae5a" stroke="#16331a" strokeWidth="2.5" strokeLinejoin="round" />
        <circle cx="48" cy="54" r="12" fill="#fdfcf7" stroke="#16331a" strokeWidth="2.5" />
        <circle cx="72" cy="54" r="12" fill="#fdfcf7" stroke="#16331a" strokeWidth="2.5" />
        <circle cx="49" cy="55" r="5.5" fill="#16331a" />
        <circle cx="73" cy="55" r="5.5" fill="#16331a" />
        <circle cx="51" cy="53" r="1.8" fill="#fff" />
        <circle cx="75" cy="53" r="1.8" fill="#fff" />
        <path d="M56 66q4 4 8 0" stroke="#16331a" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path d="M60 66l-5 7h10z" fill="#234d2a" stroke="#16331a" strokeWidth="2" />
        <path d="M40 78c-8 4-14 12-12 20 6-6 12-8 18-8M80 78c8 4 14 12 12 20-6-6-12-8-18-8" fill="#7fae5a" stroke="#16331a" strokeWidth="2.2" strokeLinejoin="round" />
      </svg>
    );
  }
  return (
    <svg width={S(110)} height={S(110)} viewBox="0 0 120 120" className="block drop-shadow-md" aria-hidden>
      <defs>
        <radialGradient id="bw" cx="44%" cy="34%" r="74%">
          <stop offset="0%" stopColor="#a07fd0" />
          <stop offset="100%" stopColor="#5b3a8e" />
        </radialGradient>
      </defs>
      <ellipse cx="60" cy="112" rx="36" ry="6" fill="#000" opacity="0.2" />
      <path d="M24 60c0-22 16-38 36-38s36 16 36 38c0 20-10 34-20 40 6 6 6 14-2 18-4-10-12-12-18-10-4-8-12-10-16-2-10-4-16-16-16-34z" fill="url(#bw)" stroke="#1c0f2e" strokeWidth="3" />
      <path d="M30 48c-6-4-14-2-16 4 8 0 12 2 16 6M90 48c6-4 14-2 16 4-8 0-12 2-16 6" fill="#5b3a8e" stroke="#1c0f2e" strokeWidth="2" strokeLinejoin="round" />
      <circle cx="48" cy="56" r="14" fill="#fdfcf7" stroke="#1c0f2e" strokeWidth="2.5" />
      <circle cx="72" cy="56" r="14" fill="#fdfcf7" stroke="#1c0f2e" strokeWidth="2.5" />
      <circle cx="50" cy="58" r="6" fill="#1c0f2e" />
      <circle cx="70" cy="58" r="6" fill="#1c0f2e" />
      <circle cx="52.5" cy="55.5" r="2" fill="#fff" />
      <circle cx="72.5" cy="55.5" r="2" fill="#fff" />
      <path d="M60 64c-5 5-11 5-16 2M60 64c5 5 11 5 16 2" stroke="#1c0f2e" strokeWidth="2" fill="none" strokeLinecap="round" />
      <path d="M52 76q8 8 16 0" stroke="#1c0f2e" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <path d="M40 86c-3 8-3 14 2 18-2-8 0-14 2-18M80 86c3 8 3 14-2 18 2-8 0-14-2-18" fill="#5b3a8e" stroke="#1c0f2e" strokeWidth="2" strokeLinejoin="round" />
    </svg>
  );
}

export function LinguistGuardianDemo() {
  const [battleLog, setBattleLog] = useState("Linguist is facing The Forgetting!");
  const [guardianHp, setGuardianHp] = useState(100);
  const [rivalHp, setRivalHp] = useState(100);
  const [floatText, setFloatText] = useState<{ text: string; isRival: boolean } | null>(null);
  const [animState, setAnimState] = useState<"idle" | "g-attack" | "r-attack" | "g-hit" | "r-hit">("idle");

  useEffect(() => {
    let timer: any;
    const runCycle = async () => {
      // Step 1: Guardian attacks
      setAnimState("g-attack");
      setBattleLog("Linguist casts 'Aesthetic'!");
      await new Promise(r => setTimeout(r, 450));

      setAnimState("r-hit");
      setFloatText({ text: "SUPER EFFECTIVE! -35 HP", isRival: true });
      setRivalHp(h => Math.max(0, h - 35));
      await new Promise(r => setTimeout(r, 1200));

      setFloatText(null);
      setAnimState("idle");
      await new Promise(r => setTimeout(r, 1000));

      // Step 2: Rival counters
      setAnimState("r-attack");
      setBattleLog("The Forgetting casts 'Confusion'...");
      await new Promise(r => setTimeout(r, 450));

      setAnimState("g-hit");
      setFloatText({ text: "CRITICAL! -20 HP", isRival: false });
      setGuardianHp(h => Math.max(0, h - 20));
      await new Promise(r => setTimeout(r, 1200));

      setFloatText(null);
      setAnimState("idle");
      await new Promise(r => setTimeout(r, 2000));

      // Reset
      setBattleLog("Linguist seals the vocabulary leak! Resetting...");
      setGuardianHp(100);
      setRivalHp(100);
      await new Promise(r => setTimeout(r, 1500));
      setBattleLog("A new spelling barrier is raised!");
      
      timer = setTimeout(runCycle, 1000);
    };

    timer = setTimeout(runCycle, 1500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="w-full flex flex-col space-y-3 bg-[#0a0a0d] border border-zinc-800 rounded-2xl p-4 text-zinc-100 font-sans overflow-hidden min-h-[250px]">
      {/* 2D Combat Arena */}
      <div className="relative flex-1 bg-gradient-to-b from-[#181a24] to-[#0c0d14] rounded-xl border border-zinc-900 p-3 flex flex-col justify-between overflow-hidden">
        {/* Sky sparkles */}
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-blue-900/10 via-transparent to-transparent pointer-events-none" />

        {/* Rival HUD (Top Left) */}
        <div className="flex justify-between items-start bg-black/40 backdrop-blur-xs rounded-lg p-2 border border-zinc-800/80 w-[45%] self-start text-[10px]">
          <div className="space-y-1 w-full">
            <div className="flex justify-between items-center">
              <span className="font-bold text-emerald-400">The Forgetting</span>
              <span className="text-zinc-500 font-bold">Lv.25</span>
            </div>
            <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden border border-zinc-900">
              <motion.div 
                animate={{ width: `${rivalHp}%` }}
                className="h-full bg-emerald-500" 
              />
            </div>
            <div className="flex justify-between text-[8px] text-zinc-400">
              <span>HP</span>
              <span>{rivalHp}/100</span>
            </div>
          </div>
        </div>

        {/* Mid-ground Arena Sprites */}
        <div className="relative flex justify-between items-center px-4 py-1 flex-1 min-h-[110px]">
          {/* Guardian (Bottom Left looking right) */}
          <motion.div 
            animate={
              animState === "g-attack" 
                ? { x: [0, 45, 0], scale: [1, 1.05, 1] } 
                : animState === "g-hit" 
                ? { x: [-4, 4, -4, 4, 0], opacity: [0.5, 1, 0.5, 1] }
                : { y: [0, -3, 0] }
            }
            transition={
              animState === "g-attack" 
                ? { duration: 0.4, ease: "easeInOut" } 
                : animState === "g-hit" 
                ? { duration: 0.3 }
                : { repeat: Infinity, duration: 2.2, ease: "easeInOut" }
            }
            className="relative z-10 origin-bottom"
          >
            <MonSprite kind="guardian" scale={0.8} />
            {floatText && !floatText.isRival && (
              <motion.span 
                initial={{ opacity: 0, y: 10, scale: 0.8 }}
                animate={{ opacity: 1, y: -25, scale: 1.1 }}
                className="absolute -top-6 left-1/2 -translate-x-1/2 text-xs font-black text-rose-500 bg-black/80 px-2 py-0.5 rounded-md border border-rose-500/30 whitespace-nowrap shadow-lg"
              >
                {floatText.text}
              </motion.span>
            )}
          </motion.div>

          {/* Verses Battle Sign */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-amber-500/10 border border-amber-500/30 text-amber-500 text-[9px] font-black uppercase px-1.5 py-0.5 rounded-sm rotate-12 select-none tracking-widest scale-90">
            VS
          </div>

          {/* Rival (Top Right looking left) */}
          <motion.div 
            animate={
              animState === "r-attack" 
                ? { x: [0, -45, 0], scale: [1, 1.05, 1] } 
                : animState === "r-hit" 
                ? { x: [4, -4, 4, -4, 0], opacity: [0.5, 1, 0.5, 1] }
                : { y: [0, 3, 0] }
            }
            transition={
              animState === "r-attack" 
                ? { duration: 0.4, ease: "easeInOut" } 
                : animState === "r-hit" 
                ? { duration: 0.3 }
                : { repeat: Infinity, duration: 2, ease: "easeInOut" }
            }
            className="relative z-10 origin-bottom"
          >
            <MonSprite kind="rival" scale={0.8} />
            {floatText && floatText.isRival && (
              <motion.span 
                initial={{ opacity: 0, y: 10, scale: 0.8 }}
                animate={{ opacity: 1, y: -25, scale: 1.1 }}
                className="absolute -top-6 left-1/2 -translate-x-1/2 text-[10px] font-black text-amber-400 bg-black/80 px-2 py-0.5 rounded-md border border-amber-400/30 whitespace-nowrap shadow-lg"
              >
                {floatText.text}
              </motion.span>
            )}
          </motion.div>
        </div>

        {/* Guardian HUD (Bottom Right) */}
        <div className="flex justify-between items-start bg-black/40 backdrop-blur-xs rounded-lg p-2 border border-zinc-800/80 w-[45%] self-end text-[10px]">
          <div className="space-y-1 w-full">
            <div className="flex justify-between items-center">
              <span className="font-bold text-amber-400">Linguist</span>
              <span className="text-zinc-500 font-bold">Lv.18</span>
            </div>
            <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden border border-zinc-900">
              <motion.div 
                animate={{ width: `${guardianHp}%` }}
                className="h-full bg-amber-400" 
              />
            </div>
            <div className="flex justify-between text-[8px] text-zinc-400">
              <span>HP</span>
              <span>{guardianHp}/100</span>
            </div>
          </div>
        </div>
      </div>

      {/* Battle Text Log */}
      <div className="h-10 bg-zinc-950 rounded-xl border border-zinc-800/80 flex items-center px-3.5">
        <span className="text-[10px] font-mono text-zinc-300 animate-pulse tracking-wide truncate">
          &gt; {battleLog}
        </span>
      </div>
    </div>
  );
}

// ── 2. GAME SCORE TRACKER (Interactive Board Game Log) ──
interface PlayerScore {
  name: string;
  score: number;
  delta: number | null;
  avatar: string;
}

export function GameScoreTrackerDemo() {
  const [players, setPlayers] = useState<PlayerScore[]>([
    { name: "Alice", score: 8, delta: null, avatar: "👩‍💻" },
    { name: "Bob", score: 6, delta: null, avatar: "🧔" },
    { name: "Charlie", score: 5, delta: null, avatar: "🎨" },
    { name: "David", score: 4, delta: null, avatar: "🦊" }
  ]);
  const [activePlayerIdx, setActivePlayerIdx] = useState(2); // Charlie starts
  const [turnTimer, setTurnTimer] = useState(45);
  const [log, setLog] = useState("Charlie's turn to build or trade!");

  useEffect(() => {
    // Tick timer down
    const interval = setInterval(() => {
      setTurnTimer(t => (t > 1 ? t - 1 : 45));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    let timer: any;
    const scoreLoop = async () => {
      // Step 1: Charlie scores!
      setActivePlayerIdx(2);
      setLog("Charlie built a settlement on Wood port! (+2 pts)");
      setPlayers(p => p.map((pl, i) => i === 2 ? { ...pl, score: 7, delta: 2 } : pl));
      await new Promise(r => setTimeout(r, 1200));

      setPlayers(p => p.map(pl => ({ ...pl, delta: null })));
      setTurnTimer(45);
      
      // Rotate turn to David
      setActivePlayerIdx(3);
      setLog("David rolls 8! Fox trade card activated.");
      await new Promise(r => setTimeout(r, 1500));

      // David scores huge!
      setLog("David settled on Ore mountain! (+5 pts)");
      setPlayers(p => p.map((pl, i) => i === 3 ? { ...pl, score: 9, delta: 5 } : pl));
      await new Promise(r => setTimeout(r, 1200));

      setPlayers(p => p.map(pl => ({ ...pl, delta: null })));
      setTurnTimer(45);

      // Rotate turn to Alice
      setActivePlayerIdx(0);
      setLog("Alice builds a massive road block.");
      await new Promise(r => setTimeout(r, 1500));

      // Reset loop
      setLog("Round ended! Syncing stats...");
      await new Promise(r => setTimeout(r, 1000));
      setPlayers([
        { name: "Alice", score: 8, delta: null, avatar: "👩‍💻" },
        { name: "Bob", score: 6, delta: null, avatar: "🧔" },
        { name: "Charlie", score: 5, delta: null, avatar: "🎨" },
        { name: "David", score: 4, delta: null, avatar: "🦊" }
      ]);
      setActivePlayerIdx(2);
      setLog("A new board game session initiated!");

      timer = setTimeout(scoreLoop, 1500);
    };

    timer = setTimeout(scoreLoop, 1800);
    return () => clearTimeout(timer);
  }, []);

  // Determine leader (highest score)
  const highestScore = Math.max(...players.map(p => p.score));

  return (
    <div className="w-full flex flex-col space-y-3 bg-[#0d0d10] border border-zinc-800 rounded-2xl p-4 text-zinc-100 font-sans min-h-[250px]">
      {/* Score Header Panel */}
      <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
        <div className="flex items-center gap-1.5">
          <Trophy className="w-4 h-4 text-amber-500" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-zinc-400">Catan Tracker</span>
        </div>
        <div className="bg-rose-500/10 border border-rose-500/20 px-2 py-0.5 rounded text-[9px] font-bold text-rose-400 flex items-center gap-1">
          <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping" />
          <span>TURN: 00:{turnTimer < 10 ? `0${turnTimer}` : turnTimer}</span>
        </div>
      </div>

      {/* Players List Grid */}
      <div className="space-y-2 flex-1">
        {players.map((p, idx) => {
          const isLeader = p.score === highestScore;
          const isActive = idx === activePlayerIdx;

          return (
            <div 
              key={p.name} 
              className={`flex items-center justify-between p-2 rounded-xl transition-all border ${
                isActive 
                  ? "bg-zinc-900 border-[#e0533c]/40 shadow-xs" 
                  : "bg-zinc-950/40 border-zinc-900"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="text-sm select-none">{p.avatar}</span>
                <span className={`text-[11px] font-bold ${isActive ? "text-white" : "text-zinc-300"}`}>
                  {p.name}
                </span>
                {isActive && (
                  <span className="text-[8px] bg-[#e0533c]/20 text-[#e0533c] font-black px-1.5 py-0.2 rounded uppercase tracking-widest scale-90">
                    ACTIVE
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2">
                <AnimatePresence mode="popLayout">
                  {p.delta && (
                    <motion.span 
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="text-[9px] font-black text-emerald-400 font-mono"
                    >
                      +{p.delta}
                    </motion.span>
                  )}
                </AnimatePresence>
                <div className="bg-zinc-900 px-2.5 py-0.5 rounded-md border border-zinc-800 text-[11px] font-black font-mono text-zinc-100 min-w-[28px] text-center flex items-center justify-center gap-1">
                  {p.score}
                  {isLeader && (
                    <motion.span 
                      animate={{ rotate: [0, -10, 10, 0] }}
                      transition={{ duration: 1, repeat: Infinity, repeatDelay: 2 }}
                    >
                      <Crown className="w-3 h-3 text-amber-400 fill-amber-400" />
                    </motion.span>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Score Tracker Live Log */}
      <div className="h-8 bg-zinc-950 rounded-lg border border-zinc-900 flex items-center px-3 text-[9px] text-zinc-400 italic">
        {log}
      </div>
    </div>
  );
}

// ── 3. CROSSWORD BOARD (Typing Solver Animation) ──
export function CrosswordSolvingDemo() {
  const gridSolution = [
    ["K", "O", "R", "A", ""],
    ["", "V", "", "L", ""],
    ["B", "O", "O", "K", ""],
    ["", "C", "", "", ""],
    ["", "S", "H", "E", "D"]
  ];

  const clues = [
    { num: "1A", text: "Offline-first reader companion.", word: "KORA" },
    { num: "3A", text: "Physical reading asset.", word: "BOOK" },
    { num: "5A", text: "Small structure or storage.", word: "SHED" }
  ];

  const [gridState, setGridState] = useState<string[][]>([
    ["", "", "", "", ""],
    ["", "", "", "", ""],
    ["", "", "", "", ""],
    ["", "", "", "", ""],
    ["", "", "", "", ""]
  ]);

  const [activeCell, setActiveCell] = useState<{ r: number; c: number } | null>(null);
  const [activeClueIdx, setActiveClueIdx] = useState(0);
  const [isDone, setIsDone] = useState(false);

  useEffect(() => {
    let timer: any;
    let step = 0;

    // Ordered steps to solve
    const path = [
      { r: 0, c: 0, val: "K", clue: 0 },
      { r: 0, c: 1, val: "O", clue: 0 },
      { r: 0, c: 2, val: "R", clue: 0 },
      { r: 0, c: 3, val: "A", clue: 0 },
      
      { r: 2, c: 0, val: "B", clue: 1 },
      { r: 2, c: 1, val: "O", clue: 1 },
      { r: 2, c: 2, val: "O", clue: 1 },
      { r: 2, c: 3, val: "K", clue: 1 },

      { r: 4, c: 1, val: "S", clue: 2 },
      { r: 4, c: 2, val: "H", clue: 2 },
      { r: 4, c: 3, val: "E", clue: 2 },
      { r: 4, c: 4, val: "D", clue: 2 }
    ];

    const typeStep = () => {
      if (step >= path.length) {
        setIsDone(true);
        setActiveCell(null);
        timer = setTimeout(() => {
          // Reset
          setGridState([
            ["", "", "", "", ""],
            ["", "", "", "", ""],
            ["", "", "", "", ""],
            ["", "", "", "", ""],
            ["", "", "", "", ""]
          ]);
          setIsDone(false);
          step = 0;
          setActiveClueIdx(0);
          timer = setTimeout(typeStep, 1000);
        }, 3000);
        return;
      }

      const cell = path[step];
      setActiveCell({ r: cell.r, c: cell.c });
      setActiveClueIdx(cell.clue);

      setGridState(prev => {
        const next = prev.map(row => [...row]);
        next[cell.r][cell.c] = cell.val;
        return next;
      });

      step++;
      timer = setTimeout(typeStep, 650);
    };

    timer = setTimeout(typeStep, 1500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="w-full flex flex-col space-y-3 bg-[#0a0a0c] border border-zinc-800 rounded-2xl p-4 text-zinc-100 font-sans min-h-[250px]">
      {/* Board Layout */}
      <div className="flex gap-4 items-center flex-1">
        
        {/* The 5x5 Grid */}
        <div className="grid grid-cols-5 gap-1 bg-zinc-950 p-1.5 rounded-xl border border-zinc-900 w-[140px] h-[140px] shrink-0">
          {gridState.map((row, rIdx) => 
            row.map((cell, cIdx) => {
              // Block cells are empty slots in solution that we leave black
              const isBlock = gridSolution[rIdx][cIdx] === "" && rIdx !== 1 && rIdx !== 3;
              const isActive = activeCell?.r === rIdx && activeCell?.c === cIdx;

              return (
                <div 
                  key={`${rIdx}-${cIdx}`}
                  className={`relative flex items-center justify-center rounded text-xs font-black font-mono transition-all ${
                    isBlock 
                      ? "bg-zinc-900/60" 
                      : isActive 
                      ? "bg-amber-500/20 ring-1 ring-amber-500 text-amber-400" 
                      : "bg-zinc-950 border border-zinc-800/80 text-zinc-200"
                  }`}
                >
                  {/* Word number label anchor */}
                  {rIdx === 0 && cIdx === 0 && <span className="absolute top-[1px] left-[2px] text-[6px] text-zinc-500 font-sans">1</span>}
                  {rIdx === 2 && cIdx === 0 && <span className="absolute top-[1px] left-[2px] text-[6px] text-zinc-500 font-sans">3</span>}
                  {rIdx === 4 && cIdx === 1 && <span className="absolute top-[1px] left-[2px] text-[6px] text-zinc-500 font-sans">5</span>}
                  
                  <AnimatePresence mode="popLayout">
                    {cell && (
                      <motion.span 
                        initial={{ opacity: 0, scale: 0.6 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0 }}
                        className={isDone ? "text-emerald-400 text-shadow-sm" : ""}
                      >
                        {cell}
                      </motion.span>
                    )}
                  </AnimatePresence>
                </div>
              );
            })
          )}
        </div>

        {/* Clues Column */}
        <div className="flex-1 flex flex-col justify-center space-y-2 text-left">
          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500 border-b border-zinc-900 pb-1 block">Active Clues</span>
          <div className="space-y-1.5">
            {clues.map((clue, idx) => {
              const isSelected = idx === activeClueIdx && !isDone;
              return (
                <div 
                  key={clue.num} 
                  className={`p-1.5 rounded-lg border transition-all ${
                    isSelected 
                      ? "bg-amber-500/10 border-amber-500/30 text-zinc-100" 
                      : "bg-transparent border-transparent text-zinc-500"
                  }`}
                >
                  <p className="text-[9px] font-bold tracking-tight">
                    <span className="text-amber-500 font-mono pr-1">{clue.num}</span> 
                    {clue.text}
                  </p>
                </div>
              );
            })}
          </div>
        </div>

      </div>

      {/* Done Celebration Overlay */}
      <div className="h-8 bg-zinc-950 rounded-lg border border-zinc-900 flex items-center justify-between px-3 text-[10px]">
        {isDone ? (
          <div className="flex items-center gap-1.5 text-emerald-400 font-bold w-full justify-center">
            <Sparkles className="w-3.5 h-3.5 animate-bounce" />
            <span>CROSSWORD COMPLETED! 100% CORRECT</span>
          </div>
        ) : (
          <span className="text-zinc-500 font-mono tracking-wide">
            &gt; Solver is typing across the grid...
          </span>
        )}
      </div>
    </div>
  );
}

// ── 4. WIKIPEDIA HUB (Wiki of the Hour Widget with Refresh) ──
interface WikiArticle {
  title: string;
  category: string;
  excerpt: string;
  icon: string;
}

const WIKI_ARTICLES: WikiArticle[] = [
  {
    title: "Library of Alexandria",
    category: "Ancient Archives",
    excerpt: "The primary learning hub of antiquity, housing over 400,000 papyrus scrolls. It served as a beacon of universal knowledge under Ptolemy I before its legendary, tragic destruction.",
    icon: "🏛️"
  },
  {
    title: "Electronic Paper (E-Ink)",
    category: "Display Tech",
    excerpt: "Invented in 1997, E-Ink screens reflect light just like traditional paper. Microcapsules loaded with charged pigments drift to forge crisp text without flickering blue backlights.",
    icon: "📱"
  },
  {
    title: "Voyager 1 Probe",
    category: "Space Exploration",
    excerpt: "Launched in 1977, Voyager 1 is the farthest man-made relic. Cruising past Pluto into deep interstellar cosmic void, it carries a gilded record with earth's greetings.",
    icon: "🛰️"
  },
  {
    title: "The Rosetta Stone",
    category: "Deciphering History",
    excerpt: "Unearthed in 1799, this basalt slab contains a single royal decree carved in Greek, Demotic, and Hieroglyphics, unlocking the secret code of lost pharaohs to antiquity.",
    icon: "🪨"
  },
  {
    title: "Alan Turing",
    category: "Theoretical Computing",
    excerpt: "Widely regarded as the pioneer of computing. His Enigma-breaking machine saved millions of lives, and his conceptual Turing machine laid foundations for modern artificial minds.",
    icon: "🧠"
  }
];

export function WikipediaHubDemo() {
  const [artIdx, setArtIdx] = useState(0);
  const [isLoading, setIsLoading] = useState(false);

  const handleRefresh = () => {
    if (isLoading) return;
    setIsLoading(true);
    setTimeout(() => {
      setArtIdx(prev => (prev + 1) % WIKI_ARTICLES.length);
      setIsLoading(false);
    }, 450);
  };

  const activeArt = WIKI_ARTICLES[artIdx];

  return (
    <div className="w-full flex flex-col justify-between bg-[#0c0c0e] border border-zinc-800 rounded-2xl p-4 text-zinc-100 font-sans min-h-[250px]">
      {/* Top bar */}
      <div className="flex justify-between items-center border-b border-zinc-900 pb-2.5">
        <div className="flex items-center gap-1.5">
          <Globe className="w-4 h-4 text-sky-400" />
          <span className="text-[10px] font-black uppercase tracking-widest text-zinc-400">Wikipedia of the Hour</span>
        </div>
        <button 
          onClick={handleRefresh}
          disabled={isLoading}
          className="p-1.5 hover:bg-zinc-800 rounded-lg border border-zinc-900 hover:border-zinc-800 transition text-zinc-400 hover:text-white disabled:opacity-50 cursor-pointer"
          title="Load another article"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Article Body Content */}
      <div className="flex-1 py-3 flex flex-col justify-center">
        <AnimatePresence mode="wait">
          {isLoading ? (
            <motion.div 
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="space-y-2 py-4"
            >
              <div className="h-4 bg-zinc-900 rounded-md w-2/3 animate-pulse" />
              <div className="h-3 bg-zinc-900 rounded-md w-full animate-pulse" />
              <div className="h-3 bg-zinc-900 rounded-md w-5/6 animate-pulse" />
            </motion.div>
          ) : (
            <motion.div
              key={activeArt.title}
              initial={{ opacity: 0, y: 5 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
              transition={{ duration: 0.25 }}
              className="space-y-2 text-left"
            >
              <div className="flex items-center gap-2">
                <span className="text-2xl select-none" role="img" aria-label="Article Symbol">
                  {activeArt.icon}
                </span>
                <div>
                  <span className="text-[8px] font-bold text-sky-400 uppercase tracking-widest block">
                    {activeArt.category}
                  </span>
                  <h4 className="text-xs font-serif font-bold text-zinc-100 leading-tight">
                    {activeArt.title}
                  </h4>
                </div>
              </div>

              <p className="text-[10px] text-zinc-400 leading-relaxed font-sans line-clamp-4">
                {activeArt.excerpt}
              </p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Bottom Action / Converting indicator */}
      <div 
        onClick={handleRefresh}
        className="h-8 bg-zinc-950 hover:bg-zinc-900 rounded-lg border border-zinc-900 flex items-center justify-between px-3 text-[9px] text-zinc-500 cursor-pointer group transition-colors"
      >
        <span>Convert this article to offline Kora EPUB?</span>
        <ChevronRight className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 transition-transform group-hover:translate-x-0.5" />
      </div>
    </div>
  );
}

// ── 5. SEARCHABLE DICTIONARY (Real inline search with Kora initially) ──
interface DictItem {
  word: string;
  pos: string;
  def: string;
  ex: string;
}

const LOCAL_DICT: Record<string, DictItem> = {
  kora: {
    word: "Kora",
    pos: "proper noun",
    def: "The ultimate offline-first e-ink optimized reading companion, engineered to restore your digital sovereignty, focus, and eye health.",
    ex: "She uploaded a library of classic classics onto her Kora reader for deep evening offline reading."
  },
  ephemeral: {
    word: "ephemeral",
    pos: "adjective",
    def: "Lasting for a very short time; transient; fleeting.",
    ex: "Digital popups are ephemeral distraction, while unbleached paper pages offer lasting focus."
  },
  lucid: {
    word: "lucid",
    pos: "adjective",
    def: "Expressed clearly; easy to understand; completely rational.",
    ex: "A lucid typesetting engine layout helps students process complex literature faster."
  },
  serene: {
    word: "serene",
    pos: "adjective",
    def: "Calm, peaceful, and completely untroubled.",
    ex: "The unbleached Natural Paper theme creates a serene landscape for late night relaxation."
  },
  somber: {
    word: "somber",
    pos: "adjective",
    def: "Dark, gloomy, or serious in tone.",
    ex: "The Dusk Twilight theme is designed with soft dark palettes appropriate for somber bedtime reviews."
  },
  sovereign: {
    word: "sovereign",
    pos: "noun / adjective",
    def: "Possessing supreme, independent power and authority. Self-governing.",
    ex: "Kora enables a sovereign offline repository for books without tracking scripts."
  },
  nuance: {
    word: "nuance",
    pos: "noun",
    def: "A subtle difference or shade of meaning, expression, or color.",
    ex: "High-contrast displays miss the organic wood-grain nuance of high-density simulated ink."
  },
  chaos: {
    word: "Chaos Studio",
    pos: "noun",
    def: "An independent open-source creative group crafting highly functional digital sanctuaries.",
    ex: "Chaos Studio built Kora to liberate readers from cloud telemetry tracking."
  }
};

export function SearchableDictionaryDemo() {
  const [query, setQuery] = useState("");
  const [searchResult, setSearchResult] = useState<DictItem>(LOCAL_DICT.kora);

  const handleSearch = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);

    const norm = val.trim().toLowerCase();
    if (!norm) {
      setSearchResult(LOCAL_DICT.kora);
      return;
    }

    const match = LOCAL_DICT[norm];
    if (match) {
      setSearchResult(match);
    } else {
      // Find close match or fallback
      const keys = Object.keys(LOCAL_DICT);
      const closeKey = keys.find(k => k.startsWith(norm));
      if (closeKey) {
        setSearchResult(LOCAL_DICT[closeKey]);
      } else {
        setSearchResult({
          word: val,
          pos: "offline search result",
          def: "This word is not in our lightweight local preview cache. Try searching 'Kora', 'ephemeral', 'lucid', 'serene', 'somber', or 'sovereign'!",
          ex: "You can expand dictionary assets inside the main Kora Companion's database."
        });
      }
    }
  };

  return (
    <div className="w-full flex flex-col justify-between bg-[#0a0a0c] border border-zinc-800 rounded-2xl p-4 text-zinc-100 font-sans min-h-[250px]">
      
      {/* Search Bar Input */}
      <div className="space-y-1.5 text-left border-b border-zinc-900 pb-2">
        <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-widest text-zinc-400 mb-1">
          <BookA className="w-4 h-4 text-purple-400" />
          <span>Searchable Dictionary</span>
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 w-3.5 h-3.5 text-zinc-500" />
          <input 
            type="text" 
            placeholder="Search word (e.g., ephemeral, lucid, serene...)"
            value={query}
            onChange={handleSearch}
            className="w-full bg-zinc-950 border border-zinc-800 rounded-lg pl-8.5 pr-4 py-1.5 text-[10px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-purple-500/50 transition-colors"
          />
        </div>
      </div>

      {/* Result Display Card */}
      <div className="flex-1 py-3 text-left flex flex-col justify-center">
        <AnimatePresence mode="wait">
          <motion.div 
            key={searchResult.word}
            initial={{ opacity: 0, x: -5 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 5 }}
            transition={{ duration: 0.18 }}
            className="space-y-1.5"
          >
            <div className="flex items-baseline gap-2">
              <h4 className="text-xs font-serif font-black text-zinc-100">
                {searchResult.word}
              </h4>
              <span className="text-[8px] font-sans italic text-purple-400 bg-purple-500/10 px-1.5 py-0.2 rounded-sm uppercase tracking-wide">
                {searchResult.pos}
              </span>
            </div>

            <p className="text-[10px] text-zinc-300 leading-relaxed font-sans">
              {searchResult.def}
            </p>

            {searchResult.ex && (
              <p className="text-[9px] text-zinc-500 italic font-sans pl-2 border-l border-zinc-800">
                &ldquo;{searchResult.ex}&rdquo;
              </p>
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Tips panel */}
      <div className="text-[8px] text-zinc-600 text-left pt-1 border-t border-zinc-900">
        💡 Local preview loaded with core vocabulary words.
      </div>
    </div>
  );
}

// ── 6. WORD SEARCH GRID (Highlighter Loop Animation) ──
export function WordSearchGridDemo() {
  const letters = [
    ["K", "O", "R", "A", "Z", "X", "W", "Y"],
    ["F", "U", "C", "R", "E", "A", "D", "M"],
    ["O", "X", "L", "O", "F", "F", "M", "Q"],
    ["C", "R", "D", "B", "O", "O", "K", "Z"],
    ["U", "W", "A", "C", "M", "Y", "P", "L"],
    ["S", "G", "J", "E", "T", "F", "D", "U"],
    ["V", "H", "B", "Q", "I", "N", "K", "T"],
    ["A", "E", "S", "T", "H", "E", "T", "I"]
  ];

  // Target words we want to find
  const targets = [
    { word: "KORA", start: { r: 0, c: 0 }, end: { r: 0, c: 3 }, color: "rgba(245, 158, 11, 0.25)", border: "rgba(245, 158, 11, 0.8)" },
    { word: "READ", start: { r: 1, c: 3 }, end: { r: 1, c: 6 }, color: "rgba(16, 185, 129, 0.25)", border: "rgba(16, 185, 129, 0.8)" },
    { word: "BOOK", start: { r: 3, c: 3 }, end: { r: 3, c: 6 }, color: "rgba(14, 165, 233, 0.25)", border: "rgba(14, 165, 233, 0.8)" },
    { word: "FOCUS", start: { r: 1, c: 0 }, end: { r: 5, c: 0 }, color: "rgba(168, 85, 247, 0.25)", border: "rgba(168, 85, 247, 0.8)" }
  ];

  const [foundWords, setFoundWords] = useState<number[]>([]);
  const [isDone, setIsDone] = useState(false);

  useEffect(() => {
    let timer: any;
    let step = 0;

    const findCycle = () => {
      if (step >= targets.length) {
        setIsDone(true);
        timer = setTimeout(() => {
          setFoundWords([]);
          setIsDone(false);
          step = 0;
          timer = setTimeout(findCycle, 800);
        }, 3000);
        return;
      }

      setFoundWords(prev => [...prev, step]);
      step++;
      timer = setTimeout(findCycle, 1200);
    };

    timer = setTimeout(findCycle, 1500);
    return () => clearTimeout(timer);
  }, []);

  // Check if a cell is part of a found word's line to highlight it
  const getCellHighlight = (r: number, c: number) => {
    for (let idx of foundWords) {
      const t = targets[idx];
      if (!t || !t.start || !t.end) continue;
      // Horizontal check
      if (t.start.r === t.end.r && r === t.start.r && c >= t.start.c && c <= t.end.c) {
        return { color: t.color, border: t.border, idx };
      }
      // Vertical check
      if (t.start.c === t.end.c && c === t.start.c && r >= t.start.r && r <= t.end.r) {
        return { color: t.color, border: t.border, idx };
      }
    }
    return null;
  };

  return (
    <div className="w-full flex flex-col space-y-3 bg-[#09090c] border border-zinc-800 rounded-2xl p-4 text-zinc-100 font-sans min-h-[250px]">
      
      {/* Board and layout */}
      <div className="flex gap-4 items-center flex-1">
        {/* 8x8 character grid */}
        <div className="grid grid-cols-8 gap-0.5 bg-zinc-950 p-1.5 rounded-xl border border-zinc-900 w-[140px] h-[140px] shrink-0 font-mono relative overflow-hidden select-none">
          {letters.map((row, r) => 
            row.map((char, c) => {
              const hl = getCellHighlight(r, c);
              return (
                <div 
                  key={`${r}-${c}`}
                  className="relative flex items-center justify-center text-[10px] font-black text-zinc-400 rounded-xs transition-all duration-300"
                  style={{
                    backgroundColor: hl ? hl.color : "transparent",
                    boxShadow: hl ? `0 0 0 1px ${hl.border}` : "none",
                    color: hl ? "#fff" : undefined
                  }}
                >
                  {char}
                </div>
              );
            })
          )}
        </div>

        {/* Word checklist */}
        <div className="flex-1 flex flex-col justify-center space-y-1 text-left">
          <span className="text-[9px] font-black uppercase tracking-widest text-zinc-500 border-b border-zinc-900 pb-1.5 block">Hidden Words</span>
          <div className="space-y-1 pt-1">
            {targets.map((t, idx) => {
              const solved = foundWords.includes(idx);
              return (
                <div key={t.word} className="flex items-center gap-1.5 py-0.5">
                  <div 
                    className="w-1.5 h-1.5 rounded-full" 
                    style={{ backgroundColor: solved ? t.border : "#333" }} 
                  />
                  <span 
                    className={`text-[10px] font-bold font-mono tracking-wider transition-all duration-300 ${
                      solved 
                        ? "text-zinc-600 line-through decoration-zinc-500 decoration-1.5" 
                        : "text-zinc-300"
                    }`}
                  >
                    {t.word}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Footer status line */}
      <div className="h-8 bg-zinc-950 rounded-lg border border-zinc-900 flex items-center justify-center px-3 text-[10px]">
        {isDone ? (
          <div className="flex items-center gap-1 text-purple-400 font-bold">
            <Check className="w-3.5 h-3.5" />
            <span>ALL VOCABULARY WORDS DISCOVERED!</span>
          </div>
        ) : (
          <span className="text-zinc-500 font-mono tracking-wide">
            &gt; Searching grid character paths...
          </span>
        )}
      </div>
    </div>
  );
}
