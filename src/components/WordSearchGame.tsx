import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Lightbulb, RefreshCw, Search, X } from "lucide-react";
import {
  cellsForWord,
  generateWordSearch,
  isStraightLine,
  matchSelection,
  WORD_SEARCH_LABELS,
  type HiddenWord,
  type WordSearchDifficulty,
  type WordSearchPuzzle,
} from "../lib/wordSearchEngine";

const STORAGE_KEY = "kora_wordsearch_progress_v1";

interface SavedProgress {
  difficulty: WordSearchDifficulty;
  level: number;
  bestLevel: Record<WordSearchDifficulty, number>;
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

function cellKey(r: number, c: number) {
  return `${r}:${c}`;
}

interface WordSearchGameProps {
  open: boolean;
  onClose: () => void;
}

type Screen = "menu" | "play";

export default function WordSearchGame({ open, onClose }: WordSearchGameProps) {
  const [screen, setScreen] = useState<Screen>("menu");
  const [difficulty, setDifficulty] = useState<WordSearchDifficulty>("easy");
  const [level, setLevel] = useState(1);
  const [bestLevel, setBestLevel] = useState<Record<WordSearchDifficulty, number>>({
    easy: 1,
    medium: 1,
    hard: 1,
  });
  const [puzzle, setPuzzle] = useState<WordSearchPuzzle | null>(null);
  const [found, setFound] = useState<Set<string>>(new Set());
  const [foundCells, setFoundCells] = useState<Set<string>>(new Set());
  const [path, setPath] = useState<Array<{ row: number; col: number }>>([]);
  const [celebrating, setCelebrating] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const dragging = useRef(false);
  const pathRef = useRef<Array<{ row: number; col: number }>>([]);
  const boardRef = useRef<HTMLDivElement | null>(null);

  const setPathBoth = (next: Array<{ row: number; col: number }>) => {
    pathRef.current = next;
    setPath(next);
  };

  useEffect(() => {
    if (!open) return;
    const saved = loadProgress();
    setDifficulty(saved.difficulty);
    setLevel(saved.level);
    setBestLevel(saved.bestLevel);
    setScreen("menu");
    setCelebrating(false);
    setStatusMsg(null);
  }, [open]);

  const startLevel = useCallback((diff: WordSearchDifficulty, lvl: number) => {
    const next = generateWordSearch(diff, lvl);
    setPuzzle(next);
    setDifficulty(diff);
    setLevel(lvl);
    setFound(new Set());
    setFoundCells(new Set());
    setPathBoth([]);
    setCelebrating(false);
    setStatusMsg(null);
    setScreen("play");
    setBestLevel((prev) => {
      const bestLevel = { ...prev, [diff]: Math.max(prev[diff], lvl) };
      saveProgress({ difficulty: diff, level: lvl, bestLevel });
      return bestLevel;
    });
  }, []);

  const markFound = useCallback((w: HiddenWord) => {
    setFound((prev) => new Set(prev).add(w.word));
    setFoundCells((prev) => {
      const next = new Set(prev);
      for (const cell of cellsForWord(w)) next.add(cellKey(cell.row, cell.col));
      return next;
    });
  }, []);

  useEffect(() => {
    if (!puzzle || screen !== "play") return;
    if (found.size >= puzzle.words.length && puzzle.words.length > 0) {
      setCelebrating(true);
      setBestLevel((prev) => {
        const bestLevel = {
          ...prev,
          [difficulty]: Math.max(prev[difficulty], level + 1),
        };
        saveProgress({ difficulty, level, bestLevel });
        return bestLevel;
      });
    }
  }, [found, puzzle, screen, difficulty, level]);

  const cellFromPoint = (clientX: number, clientY: number) => {
    if (!boardRef.current || !puzzle) return null;
    const buttons = boardRef.current.querySelectorAll<HTMLElement>("[data-cell]");
    for (const el of buttons) {
      const rect = el.getBoundingClientRect();
      if (
        clientX >= rect.left &&
        clientX <= rect.right &&
        clientY >= rect.top &&
        clientY <= rect.bottom
      ) {
        const row = Number(el.dataset.row);
        const col = Number(el.dataset.col);
        return { row, col };
      }
    }
    return null;
  };

  const finishPath = useCallback(() => {
    if (!puzzle) {
      setPathBoth([]);
      return;
    }
    const current = pathRef.current;
    if (current.length < 3) {
      setPathBoth([]);
      return;
    }
    if (!isStraightLine(current)) {
      setStatusMsg("Select in a straight line");
      window.setTimeout(() => setStatusMsg(null), 1200);
      setPathBoth([]);
      return;
    }
    const hit = matchSelection(puzzle, current);
    if (hit) {
      if (found.has(hit.word)) {
        setStatusMsg("Already found");
      } else {
        markFound(hit);
        setStatusMsg(null);
      }
    } else {
      setStatusMsg("Not a target word");
      window.setTimeout(() => setStatusMsg(null), 1200);
    }
    setPathBoth([]);
  }, [puzzle, found, markFound]);

  const hint = () => {
    if (!puzzle) return;
    const missing = puzzle.words.find((w) => !found.has(w.word));
    if (!missing) return;
    markFound(missing);
  };

  const goNext = () => {
    if (!puzzle) return;
    if (found.size >= puzzle.words.length) {
      startLevel(difficulty, level + 1);
      return;
    }
    setStatusMsg(`${found.size}/${puzzle.words.length} words found`);
    window.setTimeout(() => setStatusMsg(null), 1600);
  };

  const pathSet = useMemo(() => new Set(path.map((p) => cellKey(p.row, p.col))), [path]);
  const selectingWord = path.map((p) => puzzle?.grid[p.row]?.[p.col] || "").join("");

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
        aria-label="Kora Word Search"
      >
        <div
          className="absolute inset-0 pointer-events-none opacity-40"
          style={{
            background:
              "radial-gradient(ellipse at 70% 0%, rgba(212,165,116,0.16), transparent 50%), radial-gradient(ellipse at 10% 100%, rgba(90,120,100,0.18), transparent 45%)",
          }}
        />

        <header className="relative z-10 flex items-center justify-between gap-3 px-4 pt-[max(0.75rem,var(--kora-safe-top))] pb-3 border-b border-white/10">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="p-2 rounded-xl bg-[#d4a574]/15 border border-[#d4a574]/25">
              <Search className="w-4 h-4 text-[#d4a574]" />
            </div>
            <div className="min-w-0">
              <h2 className="font-serif text-lg font-bold tracking-tight truncate">Word Search</h2>
              <p className="text-[10px] uppercase tracking-widest opacity-50 font-mono">
                {screen === "play"
                  ? `${WORD_SEARCH_LABELS[difficulty].title} · Level ${level}`
                  : "Unlimited levels"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-full border border-white/10 hover:bg-white/5 transition"
            aria-label="Close word search"
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
            >
              <div className="text-center space-y-2">
                <p className="text-sm text-neutral-400 leading-relaxed">
                  Drag in a straight line to catch hidden words. Endless randomized boards.
                </p>
              </div>
              <div className="space-y-3">
                {(Object.keys(WORD_SEARCH_LABELS) as WordSearchDifficulty[]).map((diff, i) => (
                  <motion.button
                    key={diff}
                    type="button"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.05 * i }}
                    onClick={() => startLevel(diff, bestLevel[diff] || 1)}
                    className="w-full text-left rounded-2xl border border-white/10 bg-white/[0.03] hover:bg-white/[0.06] p-4 transition flex items-center justify-between gap-3"
                  >
                    <div>
                      <p className="font-serif text-xl font-bold">{WORD_SEARCH_LABELS[diff].title}</p>
                      <p className="text-[11px] opacity-55 mt-0.5">{WORD_SEARCH_LABELS[diff].blurb}</p>
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
                Start {WORD_SEARCH_LABELS[difficulty].title} from level 1
              </button>
            </motion.div>
          ) : puzzle ? (
            <div className="max-w-3xl mx-auto px-3 py-4 pb-28 space-y-4">
              <div className="flex flex-wrap items-center gap-2 justify-between">
                <div className="text-[10px] font-mono opacity-60">
                  {found.size}/{puzzle.words.length} found
                </div>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setScreen("menu")}
                    className="px-2.5 py-1.5 rounded-lg border border-white/10 text-[9px] font-bold uppercase tracking-wider opacity-70"
                  >
                    Menu
                  </button>
                  <button
                    type="button"
                    onClick={() => startLevel(difficulty, level)}
                    className="p-1.5 rounded-lg border border-white/10 opacity-70"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              <AnimatePresence>
                {selectingWord ? (
                  <motion.p
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className="text-center font-serif font-bold tracking-[0.25em] text-[#d4a574]"
                  >
                    {selectingWord}
                  </motion.p>
                ) : (
                  <p className="text-center text-[11px] opacity-40">Drag across letters</p>
                )}
              </AnimatePresence>

              <div
                ref={boardRef}
                className="mx-auto w-fit max-w-full touch-none select-none rounded-2xl border border-white/10 bg-[#1a1814]/80 p-2"
                onPointerDown={(e) => {
                  dragging.current = true;
                  (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
                  const cell = cellFromPoint(e.clientX, e.clientY);
                  setPathBoth(cell ? [cell] : []);
                }}
                onPointerMove={(e) => {
                  if (!dragging.current) return;
                  const cell = cellFromPoint(e.clientX, e.clientY);
                  if (!cell) return;
                  const prev = pathRef.current;
                  const last = prev[prev.length - 1];
                  if (last && last.row === cell.row && last.col === cell.col) return;
                  if (!prev.length) {
                    setPathBoth([cell]);
                    return;
                  }
                  const start = prev[0]!;
                  const dr = Math.sign(cell.row - start.row);
                  const dc = Math.sign(cell.col - start.col);
                  if (dr === 0 && dc === 0) {
                    setPathBoth([start]);
                    return;
                  }
                  const distR = Math.abs(cell.row - start.row);
                  const distC = Math.abs(cell.col - start.col);
                  if (dr !== 0 && dc !== 0 && distR !== distC) return;
                  const steps = Math.max(distR, distC);
                  const next: Array<{ row: number; col: number }> = [];
                  for (let i = 0; i <= steps; i++) {
                    next.push({ row: start.row + dr * i, col: start.col + dc * i });
                  }
                  setPathBoth(next);
                }}
                onPointerUp={() => {
                  dragging.current = false;
                  finishPath();
                }}
                onPointerCancel={() => {
                  dragging.current = false;
                  setPathBoth([]);
                }}
              >
                <div
                  className="grid gap-[3px]"
                  style={{
                    gridTemplateColumns: `repeat(${puzzle.size}, minmax(0, 1fr))`,
                    width: `min(92vw, ${Math.min(34, 480 / puzzle.size) * puzzle.size}px)`,
                  }}
                >
                  {puzzle.grid.map((row, r) =>
                    row.map((ch, c) => {
                      const key = cellKey(r, c);
                      const selecting = pathSet.has(key);
                      const solved = foundCells.has(key);
                      return (
                        <div
                          key={key}
                          data-cell
                          data-row={r}
                          data-col={c}
                          className={`aspect-square rounded-md flex items-center justify-center font-serif font-bold uppercase border transition-colors ${
                            selecting
                              ? "bg-[#d4a574] text-[#1a1510] border-[#e8c49a]"
                              : solved
                                ? "bg-[#d4a574]/30 text-[#f5f0e8] border-[#d4a574]/40"
                                : "bg-[#2a261f] text-[#f5f0e8] border-white/5"
                          }`}
                          style={{ fontSize: `clamp(11px, ${Math.floor(260 / puzzle.size)}px, 18px)` }}
                        >
                          {ch}
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div className="flex flex-wrap gap-2 justify-center">
                {puzzle.words.map((w) => (
                  <span
                    key={w.word}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-mono tracking-wider ${
                      found.has(w.word)
                        ? "bg-[#d4a574]/20 text-[#d4a574] line-through opacity-70"
                        : "bg-white/5 opacity-80"
                    }`}
                  >
                    {w.word}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>

        {screen === "play" && puzzle ? (
          <footer className="relative z-10 border-t border-white/10 px-4 py-3 pb-[max(0.75rem,var(--kora-safe-bottom))] bg-[#141210]/90 backdrop-blur-md">
            <AnimatePresence>
              {statusMsg ? (
                <motion.p
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0 }}
                  className="text-center text-[11px] font-mono text-[#d4a574] mb-2"
                >
                  {statusMsg}
                </motion.p>
              ) : null}
            </AnimatePresence>
            <div className="flex gap-2 max-w-lg mx-auto">
              <button
                type="button"
                onClick={hint}
                className="flex-1 py-2.5 rounded-xl border border-white/10 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 hover:bg-white/5"
              >
                <Lightbulb className="w-3.5 h-3.5" /> Hint
              </button>
              <button
                type="button"
                onClick={goNext}
                className="flex-[1.4] py-2.5 rounded-xl bg-[#d4a574] text-[#1a1510] text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 hover:brightness-110"
              >
                Next <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </footer>
        ) : null}

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
                className="w-full max-w-sm rounded-3xl border border-[#d4a574]/40 bg-[#1c1915] p-6 text-center shadow-2xl"
              >
                <Search className="w-7 h-7 text-neutral-400 mx-auto mb-3" />
                <h3 className="font-serif text-2xl font-bold mb-1">Level clear</h3>
                <p className="text-[12px] opacity-60 mb-5">
                  {WORD_SEARCH_LABELS[difficulty].title} level {level} complete.
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
      </motion.div>
    </AnimatePresence>
  );
}
