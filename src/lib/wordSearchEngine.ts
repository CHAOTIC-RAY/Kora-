/**
 * Offline word-search generator — unlimited seeded levels.
 * Each listed word is guaranteed to appear exactly once in the grid.
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

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

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
    const existing = grid[r]![c];
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
    grid[row + dr * i]![col + dc * i] = word[i]!;
  }
}

function cellKey(r: number, c: number) {
  return `${r}:${c}`;
}

/** Undirected path identity so forward and reverse count as one occurrence. */
function occurrenceKey(
  row: number,
  col: number,
  dr: number,
  dc: number,
  len: number
): string {
  const endR = row + dr * (len - 1);
  const endC = col + dc * (len - 1);
  const a = `${row},${col}`;
  const b = `${endR},${endC}`;
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function intendedKey(w: HiddenWord): string {
  return occurrenceKey(w.row, w.col, w.dr, w.dc, w.word.length);
}

/** Find every straight-line occurrence of `word` (all 8 directions). */
export function findWordOccurrences(
  grid: string[][],
  word: string
): Array<{ row: number; col: number; dr: number; dc: number; key: string }> {
  const size = grid.length;
  const seen = new Set<string>();
  const hits: Array<{ row: number; col: number; dr: number; dc: number; key: string }> = [];

  for (const [dr, dc] of DIRS) {
    for (let r = 0; r < size; r++) {
      for (let c = 0; c < size; c++) {
        let ok = true;
        for (let i = 0; i < word.length; i++) {
          const rr = r + dr * i;
          const cc = c + dc * i;
          if (rr < 0 || cc < 0 || rr >= size || cc >= size || grid[rr]![cc] !== word[i]) {
            ok = false;
            break;
          }
        }
        if (!ok) continue;
        const key = occurrenceKey(r, c, dr, dc, word.length);
        if (seen.has(key)) continue;
        seen.add(key);
        hits.push({ row: r, col: c, dr, dc, key });
      }
    }
  }
  return hits;
}

function pathCells(
  row: number,
  col: number,
  dr: number,
  dc: number,
  len: number
): Array<{ row: number; col: number }> {
  const cells: Array<{ row: number; col: number }> = [];
  for (let i = 0; i < len; i++) {
    cells.push({ row: row + dr * i, col: col + dc * i });
  }
  return cells;
}

/**
 * Mutate unlocked (filler) letters until each target word appears exactly once.
 * Returns false if an accidental duplicate cannot be broken (all cells locked).
 */
function scrubDuplicateWords(
  grid: string[][],
  placed: HiddenWord[],
  locked: Set<string>,
  rand: () => number
): boolean {
  const maxPasses = 80;
  for (let pass = 0; pass < maxPasses; pass++) {
    let dirty = false;

    for (const target of placed) {
      const hits = findWordOccurrences(grid, target.word);
      const keep = intendedKey(target);
      const extras = hits.filter((h) => h.key !== keep);
      if (!extras.length) continue;
      dirty = true;

      for (const extra of extras) {
        const cells = pathCells(extra.row, extra.col, extra.dr, extra.dc, target.word.length);
        const unlocked = cells.filter((cell) => !locked.has(cellKey(cell.row, cell.col)));
        if (!unlocked.length) {
          // Accidental word lies entirely on locked letters — cannot scrub.
          return false;
        }

        // Prefer mutating a middle letter so the intended word stays intact.
        const pick =
          unlocked[Math.floor(unlocked.length / 2)] ??
          unlocked[Math.floor(rand() * unlocked.length)]!;
        const avoid = grid[pick.row]![pick.col]!;
        let next = avoid;
        for (let tries = 0; tries < 26; tries++) {
          next = ALPHABET[Math.floor(rand() * 26)]!;
          if (next !== avoid) break;
        }
        grid[pick.row]![pick.col] = next;
      }
    }

    if (!dirty) {
      // Final check: every target still present exactly once.
      for (const target of placed) {
        const hits = findWordOccurrences(grid, target.word);
        if (hits.length !== 1 || hits[0]!.key !== intendedKey(target)) return false;
      }
      return true;
    }
  }
  return false;
}

/** After placing a candidate, ensure it did not create a second copy of any word. */
function placementCreatesDuplicate(
  grid: (string | null)[][],
  placed: HiddenWord[],
  candidate: HiddenWord
): boolean {
  // Temporary concrete grid for scanning (nulls → unlikely filler sentinel)
  const size = grid.length;
  const snap: string[][] = grid.map((row) =>
    row.map((cell) => (cell == null ? "#" : cell))
  );
  const all = [...placed, candidate];
  for (const target of all) {
    const hits = findWordOccurrences(snap, target.word).filter((h) => {
      // Ignore hits that touch '#' (incomplete / unfilled) — only count fully lettered paths
      const cells = pathCells(h.row, h.col, h.dr, h.dc, target.word.length);
      return cells.every((cell) => snap[cell.row]![cell.col] !== "#");
    });
    if (hits.length > 1) return true;
  }
  return false;
}

function tryGenerate(
  difficulty: WordSearchDifficulty,
  level: number,
  attemptOffset: number
): WordSearchPuzzle | null {
  const cfg = CONFIG[difficulty];
  const seed = difficultySeed(11, difficulty, level) + attemptOffset * 9973;
  const rand = mulberry32(seed >>> 0);

  const pool = shuffle(
    WORD_BANK.filter((w) => w.word.length >= cfg.minLen && w.word.length <= cfg.maxLen),
    rand
  );

  const grid: (string | null)[][] = Array.from({ length: cfg.size }, () =>
    Array.from({ length: cfg.size }, () => null)
  );
  const placed: HiddenWord[] = [];
  const used = new Set<string>();
  const locked = new Set<string>();

  for (const entry of pool) {
    if (placed.length >= cfg.count) break;
    const word = entry.word.toUpperCase();
    if (used.has(word) || word.length > cfg.size) continue;

    // Skip words that are substrings of (or contain) an already-chosen word —
    // those create ambiguous / duplicate-feeling finds in the grid.
    let overlapsChosen = false;
    for (const other of used) {
      if (other.includes(word) || word.includes(other)) {
        overlapsChosen = true;
        break;
      }
    }
    if (overlapsChosen) continue;

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
      const shuffledPositions = shuffle(positions, rand);

      for (const pick of shuffledPositions) {
        // Tentatively place
        const before: Array<{ r: number; c: number; v: string | null }> = [];
        for (let i = 0; i < word.length; i++) {
          const r = pick.row + dr * i;
          const c = pick.col + dc * i;
          before.push({ r, c, v: grid[r]![c]! });
          grid[r]![c] = word[i]!;
        }
        const candidate: HiddenWord = { word, row: pick.row, col: pick.col, dr, dc };
        if (placementCreatesDuplicate(grid, placed, candidate)) {
          for (const cell of before) grid[cell.r]![cell.c] = cell.v;
          continue;
        }

        placed.push(candidate);
        used.add(word);
        for (const cell of cellsForWord(candidate)) {
          locked.add(cellKey(cell.row, cell.col));
        }
        placedOk = true;
        break;
      }
      if (placedOk) break;
    }
  }

  if (!placed.length) return null;

  const filled: string[][] = grid.map((row) =>
    row.map((cell) => cell ?? ALPHABET[Math.floor(rand() * 26)]!)
  );

  // Scrub accidental copies created by filler letters (retry fill if needed).
  for (let fillTry = 0; fillTry < 12; fillTry++) {
    if (fillTry > 0) {
      for (let r = 0; r < cfg.size; r++) {
        for (let c = 0; c < cfg.size; c++) {
          if (!locked.has(cellKey(r, c))) {
            filled[r]![c] = ALPHABET[Math.floor(rand() * 26)]!;
          }
        }
      }
    }
    if (scrubDuplicateWords(filled, placed, locked, rand)) {
      return {
        difficulty,
        level,
        size: cfg.size,
        grid: filled,
        words: placed,
        seed,
      };
    }
  }

  return null;
}

export function generateWordSearch(
  difficulty: WordSearchDifficulty,
  level: number
): WordSearchPuzzle {
  for (let attempt = 0; attempt < 24; attempt++) {
    const puzzle = tryGenerate(difficulty, level, attempt);
    if (puzzle) return puzzle;
  }

  // Absolute fallback — tiny unique board
  const word = "BOOK";
  const grid = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => "X"));
  for (let i = 0; i < word.length; i++) grid[0]![i] = word[i]!;
  // Fill rest with letters that won't recreate BOOK
  const safe = "ACDEFGHIJKLMNPRSTUVWYZ";
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (r === 0 && c < word.length) continue;
      grid[r]![c] = safe[(r * 8 + c) % safe.length]!;
    }
  }

  return {
    difficulty,
    level,
    size: 8,
    grid,
    words: [{ word, row: 0, col: 0, dr: 0, dc: 1 }],
    seed: difficultySeed(11, difficulty, level),
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
