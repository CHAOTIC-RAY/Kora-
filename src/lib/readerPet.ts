/**
 * Kora Reader Pet Companion — lexicon emotion cues + pet catalog.
 * No AI: moods come from keyword scores on the visible page text,
 * idle time, and clock hour (sleepy bias at night).
 *
 * Sprites are Kirby-inspired round pixel puffs (original Kora designs)
 * with type flair — see readerPetSprites.ts.
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
  /**
   * Palette indices for 16×16 Kirby-style sprites:
   * 0 clear · 1 outline · 2 body · 3 shade · 4 eye-white · 5 pupil
   * 6 blush · 7 feet · 8 accent-dark · 9 accent · 10 accent-light
   * 11 hi-lite · 12 secondary
   */
  palette: string[];
  /** Accent used in the picker chip */
  accent: string;
}

/** 16×16 frames — numbers index into pet.palette (0 = empty). */
export type PetFrame = number[][];

/** Shared round-puff body (Kirby-inspired pink) — accents differ per type. */
const PUFF = {
  outline: "#c45a78",
  body: "#ffa0c8",
  shade: "#f080b0",
  eyeWhite: "#ffffff",
  pupil: "#203060",
  blush: "#ff7098",
  feet: "#e84868",
  hi: "#ffe8f0",
} as const;

export const READER_PETS: PetDefinition[] = [
  {
    id: "emberkit",
    name: "Emberkit",
    tagline: "Fire-type puff — flame crown flickers with the plot",
    accent: "#f97316",
    palette: [
      "transparent",
      PUFF.outline,
      PUFF.body,
      PUFF.shade,
      PUFF.eyeWhite,
      PUFF.pupil,
      PUFF.blush,
      PUFF.feet,
      "#c04020",
      "#ff6a20",
      "#ffd24a",
      PUFF.hi,
      "#ff4020",
    ],
  },
  {
    id: "tidrop",
    name: "Tidrop",
    tagline: "Water-type blob — splash crown ripples with feeling",
    accent: "#0ea5e9",
    palette: [
      "transparent",
      PUFF.outline,
      PUFF.body,
      PUFF.shade,
      PUFF.eyeWhite,
      PUFF.pupil,
      PUFF.blush,
      PUFF.feet,
      "#1a60a0",
      "#40a0d8",
      "#90e0ff",
      PUFF.hi,
      "#2080c0",
    ],
  },
  {
    id: "leafpup",
    name: "Leafpup",
    tagline: "Grass-type sprout — leafy crown when stories bloom",
    accent: "#22c55e",
    palette: [
      "transparent",
      PUFF.outline,
      PUFF.body,
      PUFF.shade,
      PUFF.eyeWhite,
      PUFF.pupil,
      PUFF.blush,
      PUFF.feet,
      "#2e8038",
      "#4cb050",
      "#a8e888",
      PUFF.hi,
      "#208030",
    ],
  },
  {
    id: "stormbat",
    name: "Stormbat",
    tagline: "Knight-type — masked warrior that jolts on page turns",
    accent: "#a855f7",
    palette: [
      "transparent",
      "#101828",
      "#3a4a78",
      "#2a3860",
      "#d0d8e8",
      "#f8e060",
      "#6080c0",
      "#6a2048",
      "#1a1028",
      "#6a58a0",
      "#ffe080",
      "#e8ecf4",
      "#2a2048",
    ],
  },
  {
    id: "moonmoth",
    name: "Moonmoth",
    tagline: "Fairy-type — soft wings under lamplight prose",
    accent: "#c084fc",
    palette: [
      "transparent",
      PUFF.outline,
      PUFF.body,
      PUFF.shade,
      PUFF.eyeWhite,
      PUFF.pupil,
      PUFF.blush,
      PUFF.feet,
      "#8060b0",
      "#c8a0e8",
      "#f8f0ff",
      PUFF.hi,
      "#e8d8f8",
    ],
  },
  {
    id: "pebblet",
    name: "Pebblet",
    tagline: "Rock-type — gem-crowned and sturdy through every chapter",
    accent: "#a8a29e",
    palette: [
      "transparent",
      "#2a2820",
      "#b0a898",
      "#908878",
      "#faf8f4",
      "#181610",
      "#d8d0c0",
      "#706858",
      "#888078",
      "#e05050",
      "#5080e0",
      "#e8e0d0",
      "#50c870",
    ],
  },
];

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
  return READER_PETS.find((p) => p.id === id) || READER_PETS[0]!;
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

export { getPetMoodFrames, SPRITE_SIZE } from "./readerPetSprites";
