/**
 * Offline word-search generator — unlimited seeded levels.
 */

import {
  difficultySeed,
  mulberry32,
  shuffle,
  WORD_BANK,
  type GameDifficulty,
} from "./wordGamesBank";

export type WordSearchDifficulty = GameDifficulty;

export interface HiddenWord {
  word: string;
  row: number;
  col: number;
  /** Unit step along the word */
  dr: number;
  dc: number;
}

export interface WordSearchPuzzle {
  difficulty: WordSearchDifficulty;
  level: number;
  size: number;
  grid: string[][];
  words: HiddenWord[];
  seed: number;
}

const CONFIG: Record<
  WordSearchDifficulty,
  { size: number; count: number; minLen: number; maxLen: number }
> = {
  easy: { size: 8, count: 5, minLen: 3, maxLen: 5 },
  medium: { size: 10, count: 7, minLen: 4, maxLen: 7 },
  hard: { size: 12, count: 9, minLen: 4, maxLen: 8 },
};

const DIRS: Array<[number, number]> = [
  [0, 1],
  [1, 0],
  [1, 1],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [-1, -1],
];

function canPlace(
  grid: (string | null)[][],
  word: string,
  row: number,
  col: number,
  dr: number,
  dc: number
): boolean {
  const size = grid.length;
  for (let i = 0; i < word.length; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    if (r < 0 || c < 0 || r >= size || c >= size) return false;
    const existing = grid[r][c];
    if (existing !== null && existing !== word[i]) return false;
  }
  return true;
}

function place(
  grid: (string | null)[][],
  word: string,
  row: number,
  col: number,
  dr: number,
  dc: number
) {
  for (let i = 0; i < word.length; i++) {
    grid[row + dr * i][col + dc * i] = word[i];
  }
}

export function generateWordSearch(
  difficulty: WordSearchDifficulty,
  level: number
): WordSearchPuzzle {
  const cfg = CONFIG[difficulty];
  const seed = difficultySeed(11, difficulty, level);
  const rand = mulberry32(seed);

  const pool = shuffle(
    WORD_BANK.filter((w) => w.word.length >= cfg.minLen && w.word.length <= cfg.maxLen),
    rand
  );

  const grid: (string | null)[][] = Array.from({ length: cfg.size }, () =>
    Array.from({ length: cfg.size }, () => null)
  );
  const placed: HiddenWord[] = [];
  const used = new Set<string>();

  for (const entry of pool) {
    if (placed.length >= cfg.count) break;
    const word = entry.word.toUpperCase();
    if (used.has(word) || word.length > cfg.size) continue;

    const dirs = shuffle(DIRS, rand);
    let placedOk = false;
    for (const [dr, dc] of dirs) {
      const positions: Array<{ row: number; col: number }> = [];
      for (let r = 0; r < cfg.size; r++) {
        for (let c = 0; c < cfg.size; c++) {
          if (canPlace(grid, word, r, c, dr, dc)) positions.push({ row: r, col: c });
        }
      }
      if (!positions.length) continue;
      const pick = positions[Math.floor(rand() * positions.length)]!;
      place(grid, word, pick.row, pick.col, dr, dc);
      placed.push({ word, row: pick.row, col: pick.col, dr, dc });
      used.add(word);
      placedOk = true;
      break;
    }
    if (!placedOk) continue;
  }

  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const filled = grid.map((row) =>
    row.map((cell) => cell ?? alphabet[Math.floor(rand() * 26)]!)
  );

  // Ensure at least one word
  if (!placed.length) {
    const word = "BOOK";
    for (let i = 0; i < word.length; i++) filled[0]![i] = word[i]!;
    placed.push({ word, row: 0, col: 0, dr: 0, dc: 1 });
  }

  return {
    difficulty,
    level,
    size: cfg.size,
    grid: filled,
    words: placed,
    seed,
  };
}

export function cellsForWord(w: HiddenWord): Array<{ row: number; col: number }> {
  const cells: Array<{ row: number; col: number }> = [];
  for (let i = 0; i < w.word.length; i++) {
    cells.push({ row: w.row + w.dr * i, col: w.col + w.dc * i });
  }
  return cells;
}

/** Match a straight selection (start→end) to a hidden word (either direction). */
export function matchSelection(
  puzzle: WordSearchPuzzle,
  path: Array<{ row: number; col: number }>
): HiddenWord | null {
  if (path.length < 3) return null;
  const forward = path.map((p) => puzzle.grid[p.row]![p.col]!).join("");
  const backward = [...path].reverse().map((p) => puzzle.grid[p.row]![p.col]!).join("");

  for (const w of puzzle.words) {
    if (w.word === forward || w.word === backward) return w;
  }
  return null;
}

export function isStraightLine(path: Array<{ row: number; col: number }>): boolean {
  if (path.length < 2) return true;
  const dr = Math.sign(path[1]!.row - path[0]!.row);
  const dc = Math.sign(path[1]!.col - path[0]!.col);
  for (let i = 1; i < path.length; i++) {
    const expectR = path[0]!.row + dr * i;
    const expectC = path[0]!.col + dc * i;
    if (path[i]!.row !== expectR || path[i]!.col !== expectC) return false;
    if (i > 0) {
      const stepR = Math.sign(path[i]!.row - path[i - 1]!.row);
      const stepC = Math.sign(path[i]!.col - path[i - 1]!.col);
      if (stepR !== dr || stepC !== dc) return false;
    }
  }
  return true;
}

export const WORD_SEARCH_LABELS: Record<
  WordSearchDifficulty,
  { title: string; blurb: string }
> = {
  easy: { title: "Easy", blurb: "Small grid · short words" },
  medium: { title: "Medium", blurb: "Bigger board · more words" },
  hard: { title: "Hard", blurb: "Dense grid · longer finds" },
};
