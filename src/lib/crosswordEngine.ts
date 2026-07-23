/**
 * Offline crossword generator — seeded RNG for unlimited randomized levels.
 */

import {
  canSpellFrom,
  difficultySeed,
  letterCounts,
  mulberry32,
  shuffle,
  WORD_BANK,
  type GameDifficulty,
} from "./wordGamesBank";

export type CrosswordDifficulty = GameDifficulty;

export interface CrosswordWordEntry {
  word: string;
  clue: string;
}

export interface PlacedWord {
  id: string;
  word: string;
  clue: string;
  row: number;
  col: number;
  dir: "across" | "down";
  number: number;
}

export interface CrosswordPuzzle {
  difficulty: CrosswordDifficulty;
  level: number;
  size: number;
  grid: (string | null)[][];
  solution: (string | null)[][];
  words: PlacedWord[];
  seed: number;
}

/** Wordscapes-style: letter wheel + intersecting grid of formable words. */
export interface WordscapePuzzle {
  difficulty: CrosswordDifficulty;
  level: number;
  size: number;
  letters: string[];
  grid: (string | null)[][];
  solution: (string | null)[][];
  words: PlacedWord[];
  /** All valid words the player can form (subset placed on grid). */
  validWords: string[];
  seed: number;
}

const DIFFICULTY_CONFIG: Record<
  CrosswordDifficulty,
  { size: number; count: number; minLen: number; maxLen: number }
> = {
  easy: { size: 9, count: 7, minLen: 3, maxLen: 5 },
  medium: { size: 11, count: 10, minLen: 4, maxLen: 7 },
  hard: { size: 13, count: 14, minLen: 5, maxLen: 10 },
};

const SCAPE_CONFIG: Record<
  CrosswordDifficulty,
  { centerMin: number; centerMax: number; targetWords: number; minWords: number }
> = {
  easy: { centerMin: 4, centerMax: 5, targetWords: 5, minWords: 4 },
  medium: { centerMin: 5, centerMax: 6, targetWords: 7, minWords: 5 },
  hard: { centerMin: 6, centerMax: 7, targetWords: 9, minWords: 6 },
};

function emptyGrid(size: number): (string | null)[][] {
  return Array.from({ length: size }, () => Array.from({ length: size }, () => null));
}

function canPlace(
  grid: (string | null)[][],
  word: string,
  row: number,
  col: number,
  dir: "across" | "down",
  requireIntersect: boolean
): boolean {
  const size = grid.length;
  const dr = dir === "down" ? 1 : 0;
  const dc = dir === "across" ? 1 : 0;
  if (row < 0 || col < 0) return false;
  if (row + dr * (word.length - 1) >= size) return false;
  if (col + dc * (word.length - 1) >= size) return false;

  const beforeR = row - dr;
  const beforeC = col - dc;
  if (beforeR >= 0 && beforeC >= 0 && beforeR < size && beforeC < size) {
    if (grid[beforeR][beforeC] !== null) return false;
  }
  const afterR = row + dr * word.length;
  const afterC = col + dc * word.length;
  if (afterR >= 0 && afterC >= 0 && afterR < size && afterC < size) {
    if (grid[afterR][afterC] !== null) return false;
  }

  let intersects = 0;
  for (let i = 0; i < word.length; i++) {
    const r = row + dr * i;
    const c = col + dc * i;
    const existing = grid[r][c];
    const ch = word[i];

    if (existing !== null && existing !== "" && existing !== ch) return false;
    if (existing === ch) intersects++;

    if (dir === "across") {
      if (r > 0 && grid[r - 1][c] !== null && existing !== ch) return false;
      if (r < size - 1 && grid[r + 1][c] !== null && existing !== ch) return false;
    } else {
      if (c > 0 && grid[r][c - 1] !== null && existing !== ch) return false;
      if (c < size - 1 && grid[r][c + 1] !== null && existing !== ch) return false;
    }
  }

  if (requireIntersect && intersects === 0) return false;
  if (intersects === word.length) return false;
  return true;
}

function placeWord(
  grid: (string | null)[][],
  word: string,
  row: number,
  col: number,
  dir: "across" | "down"
) {
  const dr = dir === "down" ? 1 : 0;
  const dc = dir === "across" ? 1 : 0;
  for (let i = 0; i < word.length; i++) {
    grid[row + dr * i][col + dc * i] = word[i];
  }
}

function findPlacements(
  grid: (string | null)[][],
  word: string,
  requireIntersect: boolean,
  rand: () => number
): Array<{ row: number; col: number; dir: "across" | "down" }> {
  const size = grid.length;
  const options: Array<{ row: number; col: number; dir: "across" | "down" }> = [];
  for (const dir of ["across", "down"] as const) {
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (canPlace(grid, word, row, col, dir, requireIntersect)) {
          options.push({ row, col, dir });
        }
      }
    }
  }
  return shuffle(options, rand);
}

function trimGrid(
  grid: (string | null)[][],
  placed: Array<Omit<PlacedWord, "number" | "id">>
): { grid: (string | null)[][]; words: Array<Omit<PlacedWord, "number" | "id">>; size: number } {
  let minR = grid.length;
  let minC = grid.length;
  let maxR = -1;
  let maxC = -1;
  for (let r = 0; r < grid.length; r++) {
    for (let c = 0; c < grid.length; c++) {
      if (grid[r][c] !== null) {
        minR = Math.min(minR, r);
        minC = Math.min(minC, c);
        maxR = Math.max(maxR, r);
        maxC = Math.max(maxC, c);
      }
    }
  }
  if (maxR < 0) {
    return { grid, words: placed, size: grid.length };
  }
  minR = Math.max(0, minR);
  minC = Math.max(0, minC);
  const height = maxR - minR + 1;
  const width = maxC - minC + 1;
  const size = Math.max(height, width);
  const next = emptyGrid(size);
  for (let r = 0; r < height; r++) {
    for (let c = 0; c < width; c++) {
      next[r][c] = grid[minR + r][minC + c];
    }
  }
  const words = placed.map((w) => ({
    ...w,
    row: w.row - minR,
    col: w.col - minC,
  }));
  return { grid: next, words, size };
}

function numberClues(placed: Array<Omit<PlacedWord, "number" | "id">>): PlacedWord[] {
  const starts = new Map<string, number>();
  let n = 1;
  const sorted = placed.slice().sort((a, b) => a.row - b.row || a.col - b.col);
  const out: PlacedWord[] = [];
  for (const w of sorted) {
    const key = `${w.row}:${w.col}`;
    if (!starts.has(key)) {
      starts.set(key, n++);
    }
    out.push({
      ...w,
      id: `${w.dir}-${starts.get(key)}-${w.word}`,
      number: starts.get(key)!,
    });
  }
  return out.sort((a, b) => a.number - b.number || a.dir.localeCompare(b.dir));
}

function buildFromEntries(
  difficulty: CrosswordDifficulty,
  level: number,
  seed: number,
  entries: CrosswordWordEntry[],
  size: number,
  count: number
): CrosswordPuzzle | null {
  let best: CrosswordPuzzle | null = null;

  for (let attempt = 0; attempt < 8; attempt++) {
    const attemptRand = mulberry32(seed + attempt * 9973);
    const ordered = shuffle(entries, attemptRand);
    const grid = emptyGrid(size);
    const placed: Array<Omit<PlacedWord, "number" | "id">> = [];

    for (let i = 0; i < ordered.length && placed.length < count; i++) {
      const entry = ordered[i];
      const word = entry.word.toUpperCase();
      const requireIntersect = placed.length > 0;
      let options = findPlacements(grid, word, requireIntersect, attemptRand);
      if (!options.length && placed.length === 0) {
        options = findPlacements(grid, word, false, attemptRand);
      }
      if (!options.length) continue;
      const pick = options[Math.floor(attemptRand() * Math.min(options.length, 12))];
      placeWord(grid, word, pick.row, pick.col, pick.dir);
      placed.push({
        word,
        clue: entry.clue,
        row: pick.row,
        col: pick.col,
        dir: pick.dir,
      });
    }

    if (placed.length < Math.max(3, Math.floor(count * 0.55))) continue;

    const trimmed = trimGrid(grid, placed);
    const playGrid: (string | null)[][] = trimmed.grid.map((row) =>
      row.map((cell) => (cell === null ? null : ""))
    );

    const puzzle: CrosswordPuzzle = {
      difficulty,
      level,
      size: trimmed.size,
      grid: playGrid,
      solution: trimmed.grid.map((row) => row.slice()),
      words: numberClues(trimmed.words),
      seed: seed + attempt,
    };

    if (!best || puzzle.words.length > best.words.length) best = puzzle;
    if (puzzle.words.length >= count - 1) break;
  }

  return best;
}

export function levelSeed(difficulty: CrosswordDifficulty, level: number): number {
  return difficultySeed(1, difficulty, level);
}

export function generateCrossword(
  difficulty: CrosswordDifficulty,
  level: number
): CrosswordPuzzle {
  const cfg = DIFFICULTY_CONFIG[difficulty];
  const seed = levelSeed(difficulty, level);
  const rand = mulberry32(seed);

  const pool = shuffle(
    WORD_BANK.filter((w) => w.word.length >= cfg.minLen && w.word.length <= cfg.maxLen),
    rand
  );
  const candidates = shuffle(pool, rand).slice(0, Math.min(pool.length, cfg.count + 8));

  const best = buildFromEntries(difficulty, level, seed, candidates, cfg.size, cfg.count);
  if (best) return best;

  const w = candidates[0] || { word: "BOOK", clue: "Bound pages you read" };
  const word = w.word.toUpperCase();
  const size = Math.max(word.length, 5);
  const solution = emptyGrid(size);
  const row = Math.floor(size / 2);
  const col = Math.max(0, Math.floor((size - word.length) / 2));
  placeWord(solution, word, row, col, "across");
  const playGrid = solution.map((r) => r.map((c) => (c === null ? null : "")));
  return {
    difficulty,
    level,
    size,
    grid: playGrid,
    solution,
    words: [
      {
        id: "across-1",
        word,
        clue: w.clue,
        row,
        col,
        dir: "across",
        number: 1,
      },
    ],
    seed,
  };
}

export function generateWordscape(
  difficulty: CrosswordDifficulty,
  level: number
): WordscapePuzzle {
  const cfg = SCAPE_CONFIG[difficulty];
  const seed = difficultySeed(7, difficulty, level);
  const rand = mulberry32(seed);

  const centers = shuffle(
    WORD_BANK.filter(
      (w) => w.word.length >= cfg.centerMin && w.word.length <= cfg.centerMax
    ),
    rand
  );

  for (let ci = 0; ci < Math.min(centers.length, 24); ci++) {
    const center = centers[ci]!.word.toUpperCase();
    const pool = letterCounts(center);
    const formable = WORD_BANK.filter(
      (w) =>
        w.word.length >= 3 &&
        w.word.length <= center.length &&
        canSpellFrom(w.word, pool)
    );
    const unique = new Map<string, CrosswordWordEntry>();
    for (const e of formable) unique.set(e.word.toUpperCase(), { word: e.word.toUpperCase(), clue: e.clue });
    unique.set(center, { word: center, clue: centers[ci]!.clue });

    const all = shuffle([...unique.values()], rand);
    if (all.length < cfg.minWords) continue;

    const toPlace = all
      .slice()
      .sort((a, b) => b.word.length - a.word.length)
      .slice(0, cfg.targetWords + 2);

    const size = Math.max(8, center.length + 3);
    const built = buildFromEntries(
      difficulty,
      level,
      seed + ci * 131,
      toPlace,
      size,
      cfg.targetWords
    );
    if (!built || built.words.length < cfg.minWords) continue;

    const letters = shuffle(center.split(""), rand);
    const validWords = [...new Set(all.map((w) => w.word.toUpperCase()))].sort(
      (a, b) => a.length - b.length || a.localeCompare(b)
    );

    return {
      difficulty,
      level,
      size: built.size,
      letters,
      grid: built.grid,
      solution: built.solution,
      words: built.words,
      validWords,
      seed: built.seed,
    };
  }

  // Fallback tiny puzzle
  const fallback = generateCrossword(difficulty, level);
  return {
    difficulty,
    level,
    size: fallback.size,
    letters: shuffle((fallback.words[0]?.word || "BOOK").split(""), rand),
    grid: fallback.grid,
    solution: fallback.solution,
    words: fallback.words,
    validWords: fallback.words.map((w) => w.word),
    seed,
  };
}

export function getPuzzleSolution(puzzle: CrosswordPuzzle | WordscapePuzzle): (string | null)[][] {
  if (puzzle.solution?.length) return puzzle.solution;
  const sol = emptyGrid(puzzle.size);
  for (const w of puzzle.words) {
    const dr = w.dir === "down" ? 1 : 0;
    const dc = w.dir === "across" ? 1 : 0;
    for (let i = 0; i < w.word.length; i++) {
      sol[w.row + dr * i][w.col + dc * i] = w.word[i];
    }
  }
  return sol;
}

export function isPuzzleComplete(
  grid: (string | null)[][],
  solution: (string | null)[][]
): boolean {
  for (let r = 0; r < solution.length; r++) {
    for (let c = 0; c < solution.length; c++) {
      if (solution[r][c] === null) continue;
      if ((grid[r][c] || "").toUpperCase() !== solution[r][c]) return false;
    }
  }
  return true;
}

export function countCorrectCells(
  grid: (string | null)[][],
  solution: (string | null)[][]
): { filled: number; correct: number; total: number } {
  let total = 0;
  let filled = 0;
  let correct = 0;
  for (let r = 0; r < solution.length; r++) {
    for (let c = 0; c < solution.length; c++) {
      if (solution[r][c] === null) continue;
      total++;
      const g = (grid[r][c] || "").toUpperCase();
      if (g) filled++;
      if (g && g === solution[r][c]) correct++;
    }
  }
  return { filled, correct, total };
}

export const DIFFICULTY_LABELS: Record<CrosswordDifficulty, { title: string; blurb: string }> = {
  easy: { title: "Easy", blurb: "Short words · cozy grid" },
  medium: { title: "Medium", blurb: "Balanced challenge" },
  hard: { title: "Hard", blurb: "Longer words · denser grid" },
};
