import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Check,
  ChevronRight,
  Grid3X3,
  Lightbulb,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import {
  countCorrectCells,
  CrosswordDifficulty,
  DIFFICULTY_LABELS,
  generateCrossword,
  getPuzzleSolution,
  isPuzzleComplete,
  type CrosswordPuzzle,
  type PlacedWord,
} from "../lib/crosswordEngine";

const STORAGE_KEY = "kora_crossword_progress_v1";

interface SavedProgress {
  difficulty: CrosswordDifficulty;
  level: number;
  bestLevel: Record<CrosswordDifficulty, number>;
}

function loadProgress(): SavedProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as SavedProgress;
      return {
        difficulty: parsed.difficulty || "easy",
        level: Math.max(1, Number(parsed.level) || 1),
        bestLevel: {
          easy: Math.max(1, parsed.bestLevel?.easy || 1),
          medium: Math.max(1, parsed.bestLevel?.medium || 1),
          hard: Math.max(1, parsed.bestLevel?.hard || 1),
        },
      };
    }
  } catch {
    /* ignore */
  }
  return {
    difficulty: "easy",
    level: 1,
    bestLevel: { easy: 1, medium: 1, hard: 1 },
  };
}

function saveProgress(p: SavedProgress) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

interface CrosswordGameProps {
  open: boolean;
  onClose: () => void;
}

type Screen = "menu" | "play";

export default function CrosswordGame({ open, onClose }: CrosswordGameProps) {
  const [screen, setScreen] = useState<Screen>("menu");
  const [difficulty, setDifficulty] = useState<CrosswordDifficulty>("easy");
  const [level, setLevel] = useState(1);
  const [bestLevel, setBestLevel] = useState<Record<CrosswordDifficulty, number>>({
    easy: 1,
    medium: 1,
    hard: 1,
  });
  const [puzzle, setPuzzle] = useState<CrosswordPuzzle | null>(null);
  const [grid, setGrid] = useState<(string | null)[][]>([]);
  const [active, setActive] = useState<{ row: number; col: number } | null>(null);
  const [activeWord, setActiveWord] = useState<PlacedWord | null>(null);
  const [direction, setDirection] = useState<"across" | "down">("across");
  const [celebrating, setCelebrating] = useState(false);
  const [flashCells, setFlashCells] = useState<Set<string>>(new Set());
  const [hintPulse, setHintPulse] = useState(false);
  const [checkMsg, setCheckMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const solution = useMemo(
    () => (puzzle ? getPuzzleSolution(puzzle) : []),
    [puzzle]
  );

  const stats = useMemo(
    () => (puzzle ? countCorrectCells(grid, solution) : { filled: 0, correct: 0, total: 0 }),
    [grid, puzzle, solution]
  );

  useEffect(() => {
    if (!open) return;
    const saved = loadProgress();
    setDifficulty(saved.difficulty);
    setLevel(saved.level);
    setBestLevel(saved.bestLevel);
    setScreen("menu");
    setCelebrating(false);
    setCheckMsg(null);
  }, [open]);

  const startLevel = useCallback((diff: CrosswordDifficulty, lvl: number) => {
    const next = generateCrossword(diff, lvl);
    setPuzzle(next);
    setGrid(next.grid.map((row) => row.slice()));
    setDifficulty(diff);
    setLevel(lvl);
    setActive(null);
    setActiveWord(null);
    setDirection("across");
    setCelebrating(false);
    setFlashCells(new Set());
    setCheckMsg(null);
    setScreen("play");
    saveProgress({
      difficulty: diff,
      level: lvl,
      bestLevel: {
        ...loadProgress().bestLevel,
        [diff]: Math.max(loadProgress().bestLevel[diff], lvl),
      },
    });
    setBestLevel((prev) => ({ ...prev, [diff]: Math.max(prev[diff], lvl) }));
  }, []);

  const wordsAtCell = useCallback(
    (row: number, col: number) => {
      if (!puzzle) return [] as PlacedWord[];
      return puzzle.words.filter((w) => {
        if (w.dir === "across") {
          return row === w.row && col >= w.col && col < w.col + w.word.length;
        }
        return col === w.col && row >= w.row && row < w.row + w.word.length;
      });
    },
    [puzzle]
  );

  const selectCell = useCallback(
    (row: number, col: number, toggleDir = true) => {
      if (!puzzle || puzzle.grid[row][col] === null) return;
      const at = wordsAtCell(row, col);
      if (!at.length) return;

      let nextDir = direction;
      let nextWord =
        at.find((w) => w.dir === direction) ||
        at[0];

      if (active?.row === row && active?.col === col && toggleDir && at.length > 1) {
        nextDir = direction === "across" ? "down" : "across";
        nextWord = at.find((w) => w.dir === nextDir) || at[0];
      } else if (!at.find((w) => w.dir === direction)) {
        nextDir = at[0].dir;
        nextWord = at[0];
      }

      setDirection(nextDir);
      setActiveWord(nextWord);
      setActive({ row, col });
      window.setTimeout(() => inputRef.current?.focus(), 10);
    },
    [puzzle, wordsAtCell, direction, active]
  );

  const moveWithinWord = useCallback(
    (fromRow: number, fromCol: number, delta: number) => {
      if (!activeWord) return;
      const idx =
        activeWord.dir === "across" ? fromCol - activeWord.col : fromRow - activeWord.row;
      const nextIdx = idx + delta;
      if (nextIdx < 0 || nextIdx >= activeWord.word.length) return;
      const row = activeWord.dir === "down" ? activeWord.row + nextIdx : activeWord.row;
      const col = activeWord.dir === "across" ? activeWord.col + nextIdx : activeWord.col;
      setActive({ row, col });
    },
    [activeWord]
  );

  const typeLetter = useCallback(
    (raw: string) => {
      if (!active || !puzzle) return;
      const letter = raw.toUpperCase().replace(/[^A-Z]/g, "");
      if (!letter) return;
      setGrid((prev) => {
        const next = prev.map((row) => row.slice());
        next[active.row][active.col] = letter;
        return next;
      });
      setFlashCells((prev) => new Set(prev).add(`${active.row}:${active.col}`));
      window.setTimeout(() => {
        setFlashCells((prev) => {
          const n = new Set(prev);
          n.delete(`${active.row}:${active.col}`);
          return n;
        });
      }, 280);
      moveWithinWord(active.row, active.col, 1);
    },
    [active, puzzle, moveWithinWord]
  );

  const deleteLetter = useCallback(() => {
    if (!active) return;
    setGrid((prev) => {
      const next = prev.map((row) => row.slice());
      if (next[active.row][active.col]) {
        next[active.row][active.col] = "";
      } else {
        moveWithinWord(active.row, active.col, -1);
      }
      return next;
    });
  }, [active, moveWithinWord]);

  useEffect(() => {
    if (!open || screen !== "play" || !puzzle) return;
    if (isPuzzleComplete(grid, solution)) {
      setCelebrating(true);
      const nextBest = {
        ...bestLevel,
        [difficulty]: Math.max(bestLevel[difficulty], level + 1),
      };
      setBestLevel(nextBest);
      saveProgress({ difficulty, level, bestLevel: nextBest });
    }
  }, [grid, solution, open, screen, puzzle, bestLevel, difficulty, level]);

  const revealCell = () => {
    if (!active || !solution.length) return;
    const answer = solution[active.row][active.col];
    if (!answer) return;
    setGrid((prev) => {
      const next = prev.map((row) => row.slice());
      next[active.row][active.col] = answer;
      return next;
    });
    setHintPulse(true);
    window.setTimeout(() => setHintPulse(false), 400);
    moveWithinWord(active.row, active.col, 1);
  };

  const checkBoard = () => {
    const { correct, total, filled } = countCorrectCells(grid, solution);
    if (correct === total) {
      setCheckMsg("Perfect — puzzle complete!");
      setCelebrating(true);
    } else {
      setCheckMsg(`${correct}/${total} correct · ${filled} filled`);
    }
    window.setTimeout(() => setCheckMsg(null), 2200);
  };

  const clueNumberAt = (row: number, col: number) => {
    if (!puzzle) return null;
    const hit = puzzle.words.find((w) => w.row === row && w.col === col);
    return hit?.number ?? null;
  };

  const isInActiveWord = (row: number, col: number) => {
    if (!activeWord) return false;
    if (activeWord.dir === "across") {
      return row === activeWord.row && col >= activeWord.col && col < activeWord.col + activeWord.word.length;
    }
    return col === activeWord.col && row >= activeWord.row && row < activeWord.row + activeWord.word.length;
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        className="fixed inset-0 z-[80] flex flex-col bg-[#141210]/96 backdrop-blur-md text-[#f5f0e8]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        role="dialog"
        aria-modal="true"
        aria-label="Kora Crossword"
      >
        <div
          className="absolute inset-0 pointer-events-none opacity-40"
          style={{
            background:
              "radial-gradient(ellipse at 20% 0%, rgba(212,165,116,0.18), transparent 50%), radial-gradient(ellipse at 90% 100%, rgba(120,90,60,0.2), transparent 45%)",
          }}
        />

        <header className="relative z-10 flex items-center justify-between gap-3 px-4 pt-[max(0.75rem,var(--kora-safe-top))] pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-[#d4a574]/15 border border-[#d4a574]/25">
              <Grid3X3 className="w-4 h-4 text-[#d4a574]" />
            </div>
            <div className="min-w-0">
              <h2 className="font-serif text-lg font-bold tracking-tight truncate">Crossword</h2>
              <p className="text-[10px] uppercase tracking-widest opacity-50 font-mono">
                {screen === "play"
                  ? `${DIFFICULTY_LABELS[difficulty].title} · Level ${level}`
                  : "Offline · Unlimited levels"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full border border-white/10 hover:bg-white/5 transition"
            aria-label="Close crossword"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        <div className="relative z-10 flex-1 overflow-y-auto overscroll-contain">
          {screen === "menu" ? (
            <motion.div
              className="max-w-lg mx-auto px-4 py-8 space-y-6"
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ type: "spring", stiffness: 260, damping: 24 }}
            >
              <div className="text-center space-y-2">
                <Sparkles className="w-6 h-6 text-[#d4a574] mx-auto" />
                <p className="text-sm opacity-70 leading-relaxed">
                  Pick a difficulty. Every level shuffles words and placements — works fully offline in the APK.
                </p>
              </div>

              <div className="space-y-3">
                {(Object.keys(DIFFICULTY_LABELS) as CrosswordDifficulty[]).map((diff, i) => (
                  <motion.button
                    key={diff}
                    type="button"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.05 * i }}
                    onClick={() => {
                      setDifficulty(diff);
                      startLevel(diff, bestLevel[diff] || 1);
                    }}
                    className={`w-full text-left rounded-2xl border p-4 transition flex items-center justify-between gap-3 ${
                      difficulty === diff
                        ? "border-[#d4a574]/50 bg-[#d4a574]/10"
                        : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                    }`}
                  >
                    <div>
                      <p className="font-serif text-xl font-bold">{DIFFICULTY_LABELS[diff].title}</p>
                      <p className="text-[11px] opacity-55 mt-0.5">{DIFFICULTY_LABELS[diff].blurb}</p>
                      <p className="text-[10px] font-mono opacity-40 mt-1.5">
                        Continue at level {bestLevel[diff] || 1}
                      </p>
                    </div>
                    <ChevronRight className="w-5 h-5 opacity-40" />
                  </motion.button>
                ))}
              </div>

              <button
                type="button"
                onClick={() => startLevel(difficulty, 1)}
                className="w-full py-3 rounded-xl border border-white/10 text-[11px] font-bold uppercase tracking-widest opacity-70 hover:opacity-100 transition"
              >
                Start {DIFFICULTY_LABELS[difficulty].title} from level 1
              </button>
            </motion.div>
          ) : puzzle ? (
            <div className="max-w-3xl mx-auto px-3 py-4 pb-28 space-y-4">
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <div className="flex items-center gap-2 text-[10px] font-mono opacity-60">
                  <span>
                    {stats.correct}/{stats.total}
                  </span>
                  <span className="opacity-30">·</span>
                  <span>seed {puzzle.seed.toString(16)}</span>
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setScreen("menu")}
                    className="px-2.5 py-1.5 rounded-lg border border-white/10 text-[9px] font-bold uppercase tracking-wider opacity-70 hover:opacity-100"
                  >
                    Menu
                  </button>
                  <button
                    type="button"
                    onClick={() => startLevel(difficulty, level)}
                    className="p-1.5 rounded-lg border border-white/10 opacity-70 hover:opacity-100"
                    title="Regenerate this level"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Board */}
              <motion.div
                className="mx-auto w-fit max-w-full overflow-x-auto rounded-2xl border border-white/10 bg-[#1a1814]/80 p-2 shadow-2xl"
                initial={{ scale: 0.96, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", stiffness: 280, damping: 22 }}
              >
                <div
                  className="grid gap-[2px]"
                  style={{
                    gridTemplateColumns: `repeat(${puzzle.size}, minmax(0, 1fr))`,
                    width: `min(92vw, ${Math.min(36, 520 / puzzle.size) * puzzle.size}px)`,
                  }}
                >
                  {grid.map((row, r) =>
                    row.map((cell, c) => {
                      if (cell === null) {
                        return (
                          <div
                            key={`${r}-${c}`}
                            className="aspect-square rounded-[3px] bg-[#0c0b0a]"
                          />
                        );
                      }
                      const selected = active?.row === r && active?.col === c;
                      const inWord = isInActiveWord(r, c);
                      const num = clueNumberAt(r, c);
                      const flashing = flashCells.has(`${r}:${c}`);
                      const wrong =
                        cell &&
                        solution[r]?.[c] &&
                        cell.toUpperCase() !== solution[r][c] &&
                        checkMsg !== null;

                      return (
                        <button
                          key={`${r}-${c}`}
                          type="button"
                          onClick={() => selectCell(r, c)}
                          className={`relative aspect-square rounded-[3px] border text-center font-serif font-bold uppercase leading-none transition-transform ${
                            selected
                              ? "bg-[#d4a574] text-[#1a1510] border-[#e8c49a] scale-105 z-10"
                              : inWord
                                ? "bg-[#d4a574]/25 text-[#f5f0e8] border-[#d4a574]/35"
                                : "bg-[#2a261f] text-[#f5f0e8] border-white/5"
                          } ${flashing ? "kora-xw-pop" : ""} ${wrong ? "ring-1 ring-red-400/70" : ""}`}
                          style={{ fontSize: `clamp(10px, ${Math.floor(280 / puzzle.size)}px, 18px)` }}
                        >
                          {num != null ? (
                            <span className="absolute top-0 left-0.5 text-[7px] font-mono opacity-70 leading-none">
                              {num}
                            </span>
                          ) : null}
                          <span className="block pt-0.5">{cell}</span>
                        </button>
                      );
                    })
                  )}
                </div>
              </motion.div>

              {/* Active clue */}
              <AnimatePresence mode="wait">
                {activeWord ? (
                  <motion.div
                    key={activeWord.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -4 }}
                    className="rounded-2xl border border-[#d4a574]/25 bg-[#d4a574]/10 px-4 py-3"
                  >
                    <p className="text-[9px] font-bold uppercase tracking-widest text-[#d4a574] mb-1">
                      {activeWord.number} {activeWord.dir}
                    </p>
                    <p className="text-sm leading-snug">{activeWord.clue}</p>
                  </motion.div>
                ) : (
                  <p className="text-center text-[11px] opacity-45">Tap a square to begin</p>
                )}
              </AnimatePresence>

              {/* Clue lists */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {(["across", "down"] as const).map((dir) => (
                  <div
                    key={dir}
                    className="rounded-2xl border border-white/10 bg-white/[0.03] p-3 max-h-48 overflow-y-auto"
                  >
                    <h3 className="text-[10px] font-bold uppercase tracking-widest opacity-50 mb-2">
                      {dir}
                    </h3>
                    <ul className="space-y-1.5">
                      {puzzle.words
                        .filter((w) => w.dir === dir)
                        .map((w) => (
                          <li key={w.id}>
                            <button
                              type="button"
                              onClick={() => {
                                setDirection(dir);
                                setActiveWord(w);
                                setActive({ row: w.row, col: w.col });
                                window.setTimeout(() => inputRef.current?.focus(), 10);
                              }}
                              className={`w-full text-left text-[11px] leading-snug rounded-lg px-2 py-1.5 transition ${
                                activeWord?.id === w.id
                                  ? "bg-[#d4a574]/20 text-[#f5f0e8]"
                                  : "opacity-70 hover:opacity-100 hover:bg-white/5"
                              }`}
                            >
                              <span className="font-mono font-bold mr-1.5 opacity-60">{w.number}.</span>
                              {w.clue}
                            </button>
                          </li>
                        ))}
                    </ul>
                  </div>
                ))}
              </div>

              {/* Hidden input for mobile keyboards */}
              <input
                ref={inputRef}
                className="sr-only"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v) typeLetter(v.slice(-1));
                  e.target.value = "";
                }}
                onKeyDown={(e) => {
                  if (e.key === "Backspace") {
                    e.preventDefault();
                    deleteLetter();
                  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
                    e.preventDefault();
                    if (active) moveWithinWord(active.row, active.col, -1);
                  } else if (e.key === "ArrowRight" || e.key === "ArrowDown") {
                    e.preventDefault();
                    if (active) moveWithinWord(active.row, active.col, 1);
                  } else if (e.key.length === 1) {
                    typeLetter(e.key);
                    e.preventDefault();
                  }
                }}
              />
            </div>
          ) : null}
        </div>

        {/* Play footer actions */}
        {screen === "play" && puzzle ? (
          <footer className="relative z-10 border-t border-white/10 px-4 py-3 pb-[max(0.75rem,var(--kora-safe-bottom))] bg-[#141210]/90 backdrop-blur-md">
            <AnimatePresence>
              {checkMsg ? (
                <motion.p
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="text-center text-[11px] font-mono text-[#d4a574] mb-2"
                >
                  {checkMsg}
                </motion.p>
              ) : null}
            </AnimatePresence>
            <div className="flex gap-2 max-w-lg mx-auto">
              <button
                type="button"
                onClick={revealCell}
                className={`flex-1 py-2.5 rounded-xl border border-white/10 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 hover:bg-white/5 transition ${
                  hintPulse ? "kora-xw-pop" : ""
                }`}
              >
                <Lightbulb className="w-3.5 h-3.5" /> Hint
              </button>
              <button
                type="button"
                onClick={checkBoard}
                className="flex-1 py-2.5 rounded-xl border border-white/10 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 hover:bg-white/5 transition"
              >
                <Check className="w-3.5 h-3.5" /> Check
              </button>
              <button
                type="button"
                onClick={() => startLevel(difficulty, level + 1)}
                className="flex-[1.2] py-2.5 rounded-xl bg-[#d4a574] text-[#1a1510] text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 hover:brightness-110 transition"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </footer>
        ) : null}

        {/* Level complete overlay */}
        <AnimatePresence>
          {celebrating ? (
            <motion.div
              className="absolute inset-0 z-20 flex items-center justify-center bg-black/55 backdrop-blur-sm px-6"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.div
                initial={{ scale: 0.85, y: 20, opacity: 0 }}
                animate={{ scale: 1, y: 0, opacity: 1 }}
                transition={{ type: "spring", stiffness: 300, damping: 20 }}
                className="w-full max-w-sm rounded-3xl border border-[#d4a574]/40 bg-[#1c1915] p-6 text-center shadow-2xl"
              >
                <Sparkles className="w-8 h-8 text-[#d4a574] mx-auto mb-3" />
                <h3 className="font-serif text-2xl font-bold mb-1">Level clear</h3>
                <p className="text-[12px] opacity-60 mb-5">
                  {DIFFICULTY_LABELS[difficulty].title} level {level} solved. Words reshuffle forever.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setCelebrating(false);
                      setScreen("menu");
                    }}
                    className="flex-1 py-2.5 rounded-xl border border-white/15 text-[10px] font-bold uppercase tracking-wider"
                  >
                    Menu
                  </button>
                  <button
                    type="button"
                    onClick={() => startLevel(difficulty, level + 1)}
                    className="flex-1 py-2.5 rounded-xl bg-[#d4a574] text-[#1a1510] text-[10px] font-bold uppercase tracking-wider"
                  >
                    Level {level + 1}
                  </button>
                </div>
              </motion.div>
            </motion.div>
          ) : null}
        </AnimatePresence>

        <style>{`
          @keyframes kora-xw-pop {
            0% { transform: scale(1); }
            40% { transform: scale(1.12); }
            100% { transform: scale(1); }
          }
          .kora-xw-pop { animation: kora-xw-pop 0.28s ease-out; }
        `}</style>
      </motion.div>
    </AnimatePresence>
  );
}
