/**
 * Kora Reader Pet Companion — lexicon emotion cues + pet catalog.
 * No AI: moods come from keyword scores on the visible page text,
 * idle time, and clock hour (sleepy bias at night).
 */

export type PetMood =
  | "idle"
  | "happy"
  | "sad"
  | "scared"
  | "angry"
  | "love"
  | "curious"
  | "sleepy"
  | "pageTurn";

export type PetId = "emberkit" | "tidrop" | "leafpup" | "stormbat" | "moonmoth" | "pebblet";

export interface PetDefinition {
  id: PetId;
  name: string;
  tagline: string;
  /** Palette: index 0 is transparent */
  palette: string[];
  /** Accent used in the picker chip */
  accent: string;
}

/** 12×12 frames — numbers index into pet.palette (0 = empty). */
export type PetFrame = number[][];

export const READER_PETS: PetDefinition[] = [
  {
    id: "emberkit",
    name: "Emberkit",
    tagline: "Warm fox-spark that flickers with the plot",
    accent: "#f97316",
    palette: ["transparent", "#7c2d12", "#ea580c", "#fdba74", "#fff7ed", "#fbbf24"],
  },
  {
    id: "tidrop",
    name: "Tidrop",
    tagline: "Soft water blob that ripples with feeling",
    accent: "#0ea5e9",
    palette: ["transparent", "#0c4a6e", "#0284c7", "#7dd3fc", "#e0f2fe", "#38bdf8"],
  },
  {
    id: "leafpup",
    name: "Leafpup",
    tagline: "Leafy pup that sprouts when the story blooms",
    accent: "#22c55e",
    palette: ["transparent", "#14532d", "#16a34a", "#86efac", "#fefce8", "#a3e635"],
  },
  {
    id: "stormbat",
    name: "Stormbat",
    tagline: "Tiny thunder-bat that jolts on page turns",
    accent: "#a855f7",
    palette: ["transparent", "#3b0764", "#7e22ce", "#d8b4fe", "#faf5ff", "#facc15"],
  },
  {
    id: "moonmoth",
    name: "Moonmoth",
    tagline: "Night moth that dozes under lamplight prose",
    accent: "#6366f1",
    palette: ["transparent", "#1e1b4b", "#4338ca", "#a5b4fc", "#eef2ff", "#f472b6"],
  },
  {
    id: "pebblet",
    name: "Pebblet",
    tagline: "Stony pebble buddy — sturdy through every chapter",
    accent: "#78716c",
    palette: ["transparent", "#292524", "#57534e", "#a8a29e", "#fafaf9", "#f59e0b"],
  },
];

const BODY: PetFrame = [
  [0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 2, 2, 4, 2, 2, 4, 2, 2, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 0, 2, 2, 3, 3, 2, 2, 0, 0, 0, 0],
  [0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 0, 2, 2, 0, 0, 2, 2, 0, 0, 0, 0],
  [0, 0, 2, 2, 0, 0, 2, 2, 0, 0, 0, 0],
  [0, 0, 3, 3, 0, 0, 3, 3, 0, 0, 0, 0],
];

const IDLE_BOB: PetFrame = [
  [0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 2, 2, 4, 2, 2, 4, 2, 2, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 0, 2, 2, 3, 3, 2, 2, 0, 0, 0, 0],
  [0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 0, 2, 2, 0, 0, 2, 2, 0, 0, 0, 0],
  [0, 0, 2, 3, 0, 0, 2, 3, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
];

const SLEEP_A: PetFrame = [
  [0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0, 0],
  [0, 0, 0, 2, 2, 2, 2, 0, 0, 5, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 2, 2, 1, 2, 2, 1, 2, 2, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 0, 2, 2, 3, 3, 2, 2, 0, 0, 0, 0],
  [0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0],
  [0, 0, 0, 3, 3, 3, 3, 0, 0, 0, 0, 0],
];

const SLEEP_B: PetFrame = [
  [0, 0, 0, 0, 0, 0, 0, 0, 0, 5, 0, 0],
  [0, 0, 0, 2, 2, 2, 2, 0, 5, 0, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 2, 2, 1, 2, 2, 1, 2, 2, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 0, 2, 2, 3, 3, 2, 2, 0, 0, 0, 0],
  [0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0],
  [0, 0, 0, 3, 3, 3, 3, 0, 0, 0, 0, 0],
];

const HAPPY: PetFrame = [
  [0, 0, 5, 2, 2, 2, 2, 5, 0, 0, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 2, 2, 4, 2, 2, 4, 2, 2, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 0, 2, 3, 3, 3, 3, 2, 0, 0, 0, 0],
  [0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 0, 2, 2, 0, 0, 2, 2, 0, 0, 0, 0],
  [0, 2, 2, 0, 0, 0, 0, 2, 2, 0, 0, 0],
  [0, 3, 3, 0, 0, 0, 0, 3, 3, 0, 0, 0],
];

const SAD: PetFrame = [
  [0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 2, 2, 1, 2, 2, 1, 2, 2, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 0, 2, 2, 1, 1, 2, 2, 0, 0, 0, 0],
  [0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 0, 0, 2, 0, 0, 2, 0, 0, 0, 0, 0],
  [0, 0, 0, 2, 0, 0, 2, 0, 0, 0, 0, 0],
  [0, 0, 0, 3, 0, 0, 3, 0, 0, 0, 0, 0],
];

const SCARED: PetFrame = [
  [0, 5, 0, 2, 2, 2, 2, 0, 5, 0, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 2, 4, 4, 2, 2, 4, 4, 2, 0, 0, 0],
  [0, 2, 2, 1, 2, 2, 1, 2, 2, 0, 0, 0],
  [0, 0, 2, 2, 3, 3, 2, 2, 0, 0, 0, 0],
  [0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 2, 2, 0, 0, 0, 0, 2, 2, 0, 0, 0],
  [0, 2, 0, 0, 0, 0, 0, 0, 2, 0, 0, 0],
  [0, 3, 0, 0, 0, 0, 0, 0, 3, 0, 0, 0],
];

const ANGRY: PetFrame = [
  [0, 1, 0, 2, 2, 2, 2, 0, 1, 0, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 2, 1, 4, 2, 2, 4, 1, 2, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 0, 2, 1, 1, 1, 1, 2, 0, 0, 0, 0],
  [0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 0, 2, 2, 0, 0, 2, 2, 0, 0, 0, 0],
  [0, 0, 2, 2, 0, 0, 2, 2, 0, 0, 0, 0],
  [0, 0, 1, 1, 0, 0, 1, 1, 0, 0, 0, 0],
];

const LOVE: PetFrame = [
  [0, 0, 5, 2, 2, 2, 2, 5, 0, 0, 0, 0],
  [0, 5, 2, 2, 2, 2, 2, 2, 5, 0, 0, 0],
  [0, 2, 2, 4, 2, 2, 4, 2, 2, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 0, 2, 3, 5, 5, 3, 2, 0, 0, 0, 0],
  [0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 0, 2, 2, 0, 0, 2, 2, 0, 0, 0, 0],
  [0, 0, 2, 2, 0, 0, 2, 2, 0, 0, 0, 0],
  [0, 0, 5, 5, 0, 0, 5, 5, 0, 0, 0, 0],
];

const CURIOUS: PetFrame = [
  [0, 0, 0, 2, 2, 2, 2, 0, 0, 5, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 2, 4, 2, 2, 2, 2, 4, 2, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 0, 2, 2, 3, 2, 2, 2, 0, 0, 0, 0],
  [0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 0, 2, 0, 0, 0, 2, 2, 0, 0, 0, 0],
  [0, 0, 2, 0, 0, 0, 2, 2, 0, 0, 0, 0],
  [0, 0, 3, 0, 0, 0, 3, 3, 0, 0, 0, 0],
];

const PAGE_TURN: PetFrame = [
  [0, 0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 0, 2, 2, 4, 2, 2, 4, 2, 2, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0],
  [0, 0, 0, 2, 2, 3, 3, 2, 2, 0, 0, 0],
  [0, 0, 0, 0, 2, 2, 2, 2, 0, 0, 0, 0],
  [0, 0, 0, 2, 2, 2, 2, 2, 2, 0, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0],
  [0, 0, 2, 2, 2, 2, 2, 2, 2, 2, 0, 0],
  [0, 2, 2, 0, 0, 0, 0, 0, 2, 2, 0, 0],
  [0, 2, 2, 0, 0, 0, 0, 0, 2, 2, 0, 0],
  [0, 3, 3, 0, 0, 0, 0, 0, 3, 3, 0, 0],
];

/** Shared silhouette animations — palette remaps give each pet its look. */
export const PET_MOOD_FRAMES: Record<PetMood, PetFrame[]> = {
  idle: [BODY, IDLE_BOB],
  sleepy: [SLEEP_A, SLEEP_B],
  happy: [HAPPY, BODY],
  sad: [SAD, BODY],
  scared: [SCARED, BODY],
  angry: [ANGRY, BODY],
  love: [LOVE, HAPPY],
  curious: [CURIOUS, BODY],
  pageTurn: [PAGE_TURN, HAPPY, BODY],
};

const LEXICON: Record<Exclude<PetMood, "idle" | "pageTurn" | "sleepy"> | "sleepy", string[]> = {
  happy: [
    "happy", "joy", "joyful", "laugh", "laughed", "laughing", "smile", "smiled", "grin",
    "delight", "cheer", "celebrate", "wonderful", "bright", "fun", "funny", "excited",
    "victory", "win", "success", "hope", "hopeful", "glad", "merry", "delightful",
  ],
  sad: [
    "sad", "sadness", "cry", "cried", "crying", "tear", "tears", "grief", "grieve",
    "lonely", "loneliness", "mourn", "despair", "sorrow", "weep", "wept", "tragic",
    "heartbroken", "miserable", "melancholy", "loss", "died", "death", "funeral",
  ],
  scared: [
    "fear", "afraid", "terror", "terrified", "dread", "horror", "scream", "screamed",
    "dark", "darkness", "shadow", "monster", "nightmare", "panic", "terrified",
    "haunt", "ghost", "blood", "threat", "danger", "tremble", "shiver", "creepy",
  ],
  angry: [
    "anger", "angry", "rage", "furious", "fury", "hate", "hatred", "shout", "shouted",
    "fight", "fought", "kill", "killed", "revenge", "wrath", "snarl", "glare",
    "betray", "betrayed", "violence", "attack", "struck", "punch",
  ],
  love: [
    "love", "loved", "loving", "kiss", "kissed", "heart", "romance", "romantic",
    "darling", "beloved", "embrace", "hug", "hugged", "sweetheart", "passion",
    "adore", "tender", "affection", "wedding", "marry", "married",
  ],
  curious: [
    "wonder", "wondered", "curious", "mystery", "mysterious", "secret", "discover",
    "discovered", "explore", "quest", "clue", "puzzle", "strange", "odd", "question",
    "unknown", "hidden", "whisper", "map", "treasure", "adventure",
  ],
  sleepy: [
    "sleep", "slept", "sleeping", "sleepy", "tired", "exhausted", "yawn", "yawned",
    "drowsy", "bed", "bedroom", "night", "midnight", "dream", "dreamed", "dreamt",
    "pillow", "blanket", "doze", "dozed", "nap", "asleep", "weary", "fatigue",
  ],
};

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9'\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2);
}

export interface MoodScores {
  happy: number;
  sad: number;
  scared: number;
  angry: number;
  love: number;
  curious: number;
  sleepy: number;
}

export function scoreTextMoods(text: string): MoodScores {
  const scores: MoodScores = {
    happy: 0,
    sad: 0,
    scared: 0,
    angry: 0,
    love: 0,
    curious: 0,
    sleepy: 0,
  };
  if (!text || text.length < 20) return scores;

  const words = tokenize(text);
  if (!words.length) return scores;

  for (const word of words) {
    for (const [mood, list] of Object.entries(LEXICON) as Array<[keyof MoodScores, string[]]>) {
      if (list.includes(word)) scores[mood] += 1;
      else if (list.some((k) => word.startsWith(k) && word.length <= k.length + 2)) {
        scores[mood] += 0.6;
      }
    }
  }

  // Soften by density so long pages don't always max out.
  const density = Math.max(40, words.length);
  for (const key of Object.keys(scores) as Array<keyof MoodScores>) {
    scores[key] = scores[key] / (density / 80);
  }
  return scores;
}

export function pickDominantMood(
  scores: MoodScores,
  opts?: {
    idleMs?: number;
    hour?: number;
    forcePageTurn?: boolean;
  }
): PetMood {
  if (opts?.forcePageTurn) return "pageTurn";

  const idleMs = opts?.idleMs ?? 0;
  const hour = opts?.hour ?? new Date().getHours();

  // Night + long idle → sleepy companion.
  const night = hour >= 22 || hour < 6;
  if (idleMs > 90_000 || (night && idleMs > 45_000) || scores.sleepy >= 1.4) {
    if (idleMs > 90_000 || scores.sleepy >= 1.8 || (night && idleMs > 45_000 && scores.sleepy >= 0.4)) {
      return "sleepy";
    }
  }

  const ranked = (Object.entries(scores) as Array<[keyof MoodScores, number]>)
    .filter(([mood]) => mood !== "sleepy")
    .sort((a, b) => b[1] - a[1]);

  const [topMood, topScore] = ranked[0] || ["curious", 0];
  if (topScore < 0.55) {
    if (night && idleMs > 20_000) return "sleepy";
    return "idle";
  }
  return topMood;
}

export function getPetById(id: PetId | string | undefined | null): PetDefinition {
  return READER_PETS.find((p) => p.id === id) || READER_PETS[0];
}

export function moodLabel(mood: PetMood): string {
  switch (mood) {
    case "idle":
      return "Reading along";
    case "happy":
      return "Feeling bright";
    case "sad":
      return "Feeling tender";
    case "scared":
      return "A little spooked";
    case "angry":
      return "Fired up";
    case "love":
      return "Heart eyes";
    case "curious":
      return "Curious…";
    case "sleepy":
      return "Getting sleepy";
    case "pageTurn":
      return "Page hop!";
  }
}
