/**
 * Offline crossword generator — seeded RNG for unlimited randomized levels.
 * No network: word banks + clues ship with the app (APK-safe).
 */

export type CrosswordDifficulty = "easy" | "medium" | "hard";

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
  /** null = block, "" / letter = playable cell contents */
  grid: (string | null)[][];
  /** Correct letters for each playable cell */
  solution: (string | null)[][];
  words: PlacedWord[];
  seed: number;
}

const WORD_BANK: CrosswordWordEntry[] = [
  // Short / easy
  { word: "BOOK", clue: "Bound pages you read" },
  { word: "PAGE", clue: "One side of a leaf in a book" },
  { word: "READ", clue: "What you do with a novel" },
  { word: "INK", clue: "Dark fluid for pens" },
  { word: "PEN", clue: "Writing tool with ink" },
  { word: "MAP", clue: "Chart of lands and roads" },
  { word: "SUN", clue: "Daytime star" },
  { word: "MOON", clue: "Night sky companion" },
  { word: "STAR", clue: "Twinkle in the night" },
  { word: "TREE", clue: "Woody plant with leaves" },
  { word: "BIRD", clue: "Feathered flyer" },
  { word: "FISH", clue: "Swims with fins" },
  { word: "CAT", clue: "Purring house pet" },
  { word: "DOG", clue: "Loyal barking pet" },
  { word: "TEA", clue: "Hot steeped drink" },
  { word: "CAKE", clue: "Sweet baked dessert" },
  { word: "MILK", clue: "Dairy white drink" },
  { word: "RAIN", clue: "Falls from clouds" },
  { word: "SNOW", clue: "Frozen white flakes" },
  { word: "WIND", clue: "Moving air" },
  { word: "FIRE", clue: "Hot flickering flame" },
  { word: "WAVE", clue: "Ocean swell" },
  { word: "SHIP", clue: "Large seagoing vessel" },
  { word: "BOAT", clue: "Small water craft" },
  { word: "ROAD", clue: "Path for cars" },
  { word: "CITY", clue: "Large town" },
  { word: "HOME", clue: "Where you live" },
  { word: "DOOR", clue: "Entry you open" },
  { word: "LAMP", clue: "Light on a stand" },
  { word: "DESK", clue: "Writing table" },
  { word: "NOTE", clue: "Short written message" },
  { word: "WORD", clue: "Unit of language" },
  { word: "STORY", clue: "Tale with a plot" },
  { word: "POEM", clue: "Verse writing" },
  { word: "SONG", clue: "Music with lyrics" },
  { word: "DREAM", clue: "Mind movie while asleep" },
  { word: "HOPE", clue: "Wish for good things" },
  { word: "LOVE", clue: "Deep affection" },
  { word: "PEACE", clue: "Calm without conflict" },
  { word: "LIGHT", clue: "Opposite of dark" },
  { word: "NIGHT", clue: "Time after sunset" },
  { word: "DAWN", clue: "First light of day" },
  { word: "DUSK", clue: "Evening twilight" },
  { word: "LEAF", clue: "Green tree plate" },
  { word: "ROOT", clue: "Plant part underground" },
  { word: "SEED", clue: "Plant beginning" },
  { word: "BLOOM", clue: "Flower opening" },
  { word: "RIVER", clue: "Flowing freshwater" },
  { word: "STONE", clue: "Hard rock piece" },
  { word: "CLOUD", clue: "Sky vapor puff" },
  { word: "STORM", clue: "Wild weather" },
  { word: "THUNDER", clue: "Loud storm sound" },
  { word: "BRIDGE", clue: "Span over water" },
  { word: "CASTLE", clue: "Fortified palace" },
  { word: "KNIGHT", clue: "Armored medieval warrior" },
  { word: "QUEEN", clue: "Female monarch" },
  { word: "CROWN", clue: "Royal headpiece" },
  { word: "SWORD", clue: "Bladed weapon" },
  { word: "SHIELD", clue: "Defensive armor plate" },
  { word: "FOREST", clue: "Dense woodland" },
  { word: "MOUNTAIN", clue: "Tall earth peak" },
  { word: "VALLEY", clue: "Low land between hills" },
  { word: "DESERT", clue: "Dry sandy region" },
  { word: "OCEAN", clue: "Vast salt water" },
  { word: "ISLAND", clue: "Land surrounded by water" },
  { word: "BEACH", clue: "Sandy shore" },
  { word: "CORAL", clue: "Reef-building sea life" },
  { word: "SHELL", clue: "Hard sea covering" },
  { word: "PEARL", clue: "Gem from an oyster" },
  { word: "GOLD", clue: "Precious yellow metal" },
  { word: "SILVER", clue: "Shiny gray metal" },
  { word: "COPPER", clue: "Reddish conductive metal" },
  { word: "CRYSTAL", clue: "Clear geometric mineral" },
  { word: "MIRROR", clue: "Reflective glass" },
  { word: "WINDOW", clue: "Glass in a wall" },
  { word: "GARDEN", clue: "Cultivated plant plot" },
  { word: "FLOWER", clue: "Blossoming plant" },
  { word: "HONEY", clue: "Sweet bee product" },
  { word: "BREAD", clue: "Baked loaf staple" },
  { word: "APPLE", clue: "Crunchy orchard fruit" },
  { word: "GRAPE", clue: "Vine berry" },
  { word: "LEMON", clue: "Sour yellow citrus" },
  { word: "ORANGE", clue: "Citrus named for its color" },
  { word: "BANANA", clue: "Yellow curved fruit" },
  { word: "CHERRY", clue: "Small red stone fruit" },
  { word: "MARKET", clue: "Place to buy goods" },
  { word: "LIBRARY", clue: "House of books" },
  { word: "MUSEUM", clue: "Hall of exhibits" },
  { word: "THEATER", clue: "Stage performance hall" },
  { word: "MUSIC", clue: "Organized sound art" },
  { word: "PIANO", clue: "Keyboard instrument" },
  { word: "VIOLIN", clue: "Bowed string instrument" },
  { word: "GUITAR", clue: "Six-string instrument" },
  { word: "DANCE", clue: "Rhythmic body movement" },
  { word: "PAINT", clue: "Colored coating" },
  { word: "CANVAS", clue: "Cloth for painting" },
  { word: "PENCIL", clue: "Graphite writing stick" },
  { word: "PAPER", clue: "Sheet for writing" },
  { word: "LETTER", clue: "Alphabet character / mail" },
  { word: "CHAPTER", clue: "Book section" },
  { word: "AUTHOR", clue: "Writer of a book" },
  { word: "READER", clue: "One who reads" },
  { word: "NOVEL", clue: "Long fiction book" },
  { word: "FABLE", clue: "Moral animal tale" },
  { word: "MYTH", clue: "Ancient sacred story" },
  { word: "LEGEND", clue: "Traditional heroic tale" },
  { word: "QUEST", clue: "Adventurous search" },
  { word: "JOURNEY", clue: "Long trip" },
  { word: "TRAVEL", clue: "Go from place to place" },
  { word: "COMPASS", clue: "Navigation direction tool" },
  { word: "LANTERN", clue: "Portable light" },
  { word: "CANDLE", clue: "Wax with a wick" },
  { word: "SHADOW", clue: "Dark shape from blocking light" },
  { word: "SILENCE", clue: "Absence of sound" },
  { word: "WHISPER", clue: "Soft spoken words" },
  { word: "ECHO", clue: "Sound that returns" },
  { word: "MEMORY", clue: "Stored past moment" },
  { word: "WISDOM", clue: "Deep knowing" },
  { word: "COURAGE", clue: "Bravery in fear" },
  { word: "KINDNESS", clue: "Gentle goodwill" },
  { word: "FRIEND", clue: "Close companion" },
  { word: "FAMILY", clue: "Related household" },
  { word: "HARMONY", clue: "Pleasing accord" },
  { word: "BALANCE", clue: "Even stability" },
  { word: "RHYTHM", clue: "Musical pulse" },
  { word: "MELODY", clue: "Tune sequence" },
  { word: "HORIZON", clue: "Where sky meets land" },
  { word: "TWILIGHT", clue: "Soft dusk light" },
  { word: "STARLIGHT", clue: "Glow from distant suns" },
  { word: "MOONLIGHT", clue: "Night glow from the moon" },
  { word: "RAINBOW", clue: "Arc of spectrum colors" },
  { word: "THUNDERSTORM", clue: "Storm with lightning boom" },
  { word: "ADVENTURE", clue: "Exciting risky journey" },
  { word: "TREASURE", clue: "Hidden valuable hoard" },
  { word: "MYSTERY", clue: "Unsolved puzzle" },
  { word: "SECRET", clue: "Hidden knowledge" },
  { word: "PUZZLE", clue: "Problem to solve" },
  { word: "RIDDLE", clue: "Worded brain teaser" },
  { word: "CIPHER", clue: "Coded writing" },
  { word: "SCROLL", clue: "Rolled parchment" },
  { word: "TOME", clue: "Large heavy book" },
  { word: "QUILL", clue: "Feather pen" },
  { word: "INKWELL", clue: "Pot that holds ink" },
  { word: "BOOKMARK", clue: "Placeholder in pages" },
  { word: "SHELF", clue: "Board that holds books" },
  { word: "ATLAS", clue: "Book of maps" },
  { word: "GLOBE", clue: "Spherical world model" },
  { word: "PLANET", clue: "World orbiting a star" },
  { word: "GALAXY", clue: "Vast star system" },
  { word: "COMET", clue: "Icy traveler with a tail" },
  { word: "ORBIT", clue: "Path around a body" },
  { word: "ROCKET", clue: "Space-bound craft" },
  { word: "ENGINE", clue: "Machine that powers" },
  { word: "WHEEL", clue: "Round rolling part" },
  { word: "ANCHOR", clue: "Ship's holding weight" },
  { word: "SAIL", clue: "Cloth that catches wind" },
  { word: "HARBOR", clue: "Safe place for ships" },
  { word: "LIGHTHOUSE", clue: "Tower that guides ships" },
  { word: "VOYAGE", clue: "Long sea journey" },
  { word: "PASSAGE", clue: "Way through / book excerpt" },
  { word: "CHAPTER", clue: "Numbered book part" },
  { word: "PROLOGUE", clue: "Opening before the story" },
  { word: "EPILOGUE", clue: "Closing after the story" },
  { word: "NARRATOR", clue: "Voice that tells the tale" },
  { word: "HERO", clue: "Main brave figure" },
  { word: "VILLAIN", clue: "Story's antagonist" },
  { word: "SETTING", clue: "Where a story happens" },
  { word: "PLOT", clue: "Sequence of story events" },
  { word: "THEME", clue: "Underlying story idea" },
  { word: "SYMBOL", clue: "Thing that stands for another" },
  { word: "METAPHOR", clue: "Implied comparison" },
  { word: "VERSE", clue: "Line of poetry" },
  { word: "STANZA", clue: "Group of poem lines" },
  { word: "SONNET", clue: "Fourteen-line poem" },
  { word: "BALLAD", clue: "Story song or poem" },
  { word: "JOURNAL", clue: "Personal written log" },
  { word: "DIARY", clue: "Day-by-day personal book" },
  { word: "LETTER", clue: "Written correspondence" },
  { word: "PARCHMENT", clue: "Old writing skin sheet" },
  { word: "MANUSCRIPT", clue: "Author's original text" },
  { word: "EDITION", clue: "Particular book printing" },
  { word: "VOLUME", clue: "One book in a set" },
  { word: "SERIES", clue: "Related books in order" },
  { word: "SEQUEL", clue: "Follow-up story" },
  { word: "PREFACE", clue: "Author's opening note" },
  { word: "INDEX", clue: "Alphabetical back list" },
  { word: "GLOSSARY", clue: "List of defined terms" },
  { word: "FOOTNOTE", clue: "Note at page bottom" },
  { word: "MARGIN", clue: "Blank edge of a page" },
  { word: "SPINE", clue: "Book's bound edge" },
  { word: "COVER", clue: "Outer face of a book" },
  { word: "TITLE", clue: "Name of a work" },
  { word: "GENRE", clue: "Category of story" },
  { word: "FICTION", clue: "Invented narrative" },
  { word: "HISTORY", clue: "Record of the past" },
  { word: "SCIENCE", clue: "Study of the natural world" },
  { word: "NATURE", clue: "The living outdoor world" },
  { word: "ANIMAL", clue: "Living creature" },
  { word: "PLANET", clue: "Celestial world" },
  { word: "SEASON", clue: "Quarter of the year" },
  { word: "WINTER", clue: "Coldest season" },
  { word: "SUMMER", clue: "Warmest season" },
  { word: "SPRING", clue: "Season of new growth" },
  { word: "AUTUMN", clue: "Fall season of leaves" },
];

const DIFFICULTY_CONFIG: Record<
  CrosswordDifficulty,
  { size: number; count: number; minLen: number; maxLen: number }
> = {
  easy: { size: 9, count: 7, minLen: 3, maxLen: 5 },
  medium: { size: 11, count: 10, minLen: 4, maxLen: 7 },
  hard: { size: 13, count: 14, minLen: 5, maxLen: 10 },
};

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(arr: T[], rand: () => number): T[] {
  const out = arr.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

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

  // Block cells just before/after the word
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

    // Side neighbors must be empty unless this cell is an intersection
    if (dir === "across") {
      if (r > 0 && grid[r - 1][c] !== null && existing !== ch) return false;
      if (r < size - 1 && grid[r + 1][c] !== null && existing !== ch) return false;
    } else {
      if (c > 0 && grid[r][c - 1] !== null && existing !== ch) return false;
      if (c < size - 1 && grid[r][c + 1] !== null && existing !== ch) return false;
    }
  }

  if (requireIntersect && intersects === 0) return false;
  // Avoid fully overlapping an existing word
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
  // pad 1 empty ring where possible
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

export function levelSeed(difficulty: CrosswordDifficulty, level: number): number {
  const d = difficulty === "easy" ? 1 : difficulty === "medium" ? 2 : 3;
  return ((level * 2654435761) ^ (d * 974698316)) >>> 0;
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

  // Extra shuffle of sequence so levels feel distinct
  const candidates = shuffle(pool, rand).slice(0, Math.min(pool.length, cfg.count + 8));

  let best: CrosswordPuzzle | null = null;

  for (let attempt = 0; attempt < 6; attempt++) {
    const attemptRand = mulberry32(seed + attempt * 9973);
    const ordered = shuffle(candidates, attemptRand);
    const grid = emptyGrid(cfg.size);
    const placed: Array<Omit<PlacedWord, "number" | "id">> = [];

    for (let i = 0; i < ordered.length && placed.length < cfg.count; i++) {
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

    if (placed.length < Math.max(4, Math.floor(cfg.count * 0.6))) continue;

    const trimmed = trimGrid(grid, placed);
    // Convert letter cells: keep letters as solution reference separately —
    // playable grid starts empty ("") on letter cells, null on blocks.
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

    if (!best || puzzle.words.length > best.words.length) {
      best = puzzle;
    }
    if (puzzle.words.length >= cfg.count - 1) break;
  }

  if (!best) {
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

  return best;
}

export function getPuzzleSolution(puzzle: CrosswordPuzzle): (string | null)[][] {
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
