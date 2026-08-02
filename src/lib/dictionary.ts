// Custom Personal Dictionary Utility
// Comes with a default dictionary and manages user additions in localStorage.
// Can load external dictionary data from dictionary-data.json (parsed from StarDict).
//
// Perf plan (Phase 3.5): the external dictionary is split into one JSON shard per
// initial letter under /data/dict/<letter>.json. We never parse the whole 2 MB
// file on the main thread — lookups fetch only the shard for the tapped word's
// first letter and cache it. The service worker precaches these as cache-first
// (immutable), so lookups also work fully offline.

export interface DictionaryEntry {
  word: string;
  definition: string;
  partOfSpeech?: string;
  example?: string;
  isCustom?: boolean;
}

const FALLBACK_DICTIONARY: DictionaryEntry[] = [
  {
    word: "kora",
    definition: "Your reading lounge — an e-ink inspired digital library for books, audiobooks, and news, with cloud sync and offline-first reading.",
    partOfSpeech: "noun",
    example: "I am reading my favorite fantasy series on Kora.",
    isCustom: false
  },
  {
    word: "pensieve",
    definition: "A stone vessel used to store and review memories, or chaotic-ray's beautiful companion note-taking tool integrated with Kora.",
    partOfSpeech: "noun",
    example: "I exported my book highlights from Kora directly to my Pensieve.",
    isCustom: false
  },
  {
    word: "ephemeral",
    definition: "Lasting for a very short time; transient or fleeting.",
    partOfSpeech: "adjective",
    example: "The beauty of the sunset was ephemeral, fading into the dark sky within minutes.",
    isCustom: false
  },
  {
    word: "sovereignty",
    definition: "Supreme power or authority; the state of being independent and self-governing.",
    partOfSpeech: "noun",
    example: "Kora guarantees digital sovereignty by allowing offline local cache storage of your books.",
    isCustom: false
  },
  {
    word: "aesthetic",
    definition: "Concerned with beauty or the appreciation of beauty; a set of principles underlying the work of a particular artist or artistic movement.",
    partOfSpeech: "adjective/noun",
    example: "The Kindle Paperwhite has a beautifully minimalist aesthetic.",
    isCustom: false
  },
  {
    word: "lucid",
    definition: "Expressed clearly; easy to understand; bright or luminous.",
    partOfSpeech: "adjective",
    example: "The AI helper gave a lucid explanation of the intricate poetic motif.",
    isCustom: false
  },
  {
    word: "almost",
    definition: "Not quite; very nearly. Used to indicate that something is nearly the case, but not completely.",
    partOfSpeech: "adverb",
    example: "The book was almost finished when the power went out.",
    isCustom: false
  }
];

const DICT_BASE = "/data/dict";

function shardFor(word: string): string {
  const w = (word || "").trim().toLowerCase();
  const c = w[0] || "#";
  if (/[a-z]/.test(c)) return c;
  if (/[0-9]/.test(c)) return "0";
  return "#";
}

// Loaded shards, keyed by letter. Each shard is fetched at most once.
const shardCache: Map<string, DictionaryEntry[]> = new Map();
let shardLoadsInFlight: Map<string, Promise<DictionaryEntry[]>> = new Map();

async function loadShard(letter: string): Promise<DictionaryEntry[]> {
  if (shardCache.has(letter)) return shardCache.get(letter)!;
  const inflight = shardLoadsInFlight.get(letter);
  if (inflight) return inflight;
  const p = (async () => {
    try {
      const res = await fetch(`${DICT_BASE}/${letter}.json`);
      if (!res.ok) return [];
      const data = (await res.json()) as DictionaryEntry[];
      shardCache.set(letter, data);
      return data;
    } catch {
      return [];
    }
  })();
  shardLoadsInFlight.set(letter, p);
  const out = await p;
  shardLoadsInFlight.delete(letter);
  return out;
}

async function loadAllShards(): Promise<DictionaryEntry[]> {
  // index.json tells us which shards exist.
  let letters: string[] = [];
  try {
    const res = await fetch(`${DICT_BASE}/index.json`);
    if (res.ok) {
      const idx = (await res.json()) as { shards?: number };
      // index.json doesn't list letters; fall back to the known bucket set.
      if (typeof idx.shards === "number") {
        letters = "abcdefghijklmnopqrstuvwxyz0#".split("");
      }
    }
  } catch {
    /* ignore */
  }
  if (!letters.length) letters = "abcdefghijklmnopqrstuvwxyz0#".split("");
  const all = await Promise.all(letters.map((l) => loadShard(l)));
  return all.flat();
}

export function getCustomDictionary(): DictionaryEntry[] {
  try {
    const saved = localStorage.getItem("kora_custom_dictionary");
    if (saved) {
      return JSON.parse(saved);
    }
  } catch (e) {
    console.error("Failed to parse custom dictionary", e);
  }
  return [];
}

export function saveCustomDictionary(entries: DictionaryEntry[]): void {
  try {
    localStorage.setItem("kora_custom_dictionary", JSON.stringify(entries));
  } catch (e) {
    console.error("Failed to save custom dictionary", e);
  }
}

export async function getAllDictionaryEntries(): Promise<DictionaryEntry[]> {
  const external = await loadAllShards();
  const custom = getCustomDictionary();
  const defaults = [...FALLBACK_DICTIONARY, ...external];
  const defaultWords = defaults.filter(
    (defWord) => !custom.some((custWord) => custWord.word.toLowerCase() === defWord.word.toLowerCase())
  );
  // Prefer custom, then dedupe defaults by word
  const seen = new Set(custom.map((e) => e.word.toLowerCase()));
  const uniqueDefaults: DictionaryEntry[] = [];
  for (const entry of defaultWords) {
    const key = entry.word.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    uniqueDefaults.push(entry);
  }
  return [...custom, ...uniqueDefaults];
}

function candidateForms(word: string): string[] {
  const normalized = word
    .trim()
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\.+$/, "");
  if (!normalized) return [];

  const forms = new Set<string>([normalized]);
  forms.add(normalized.replace(/'s$/, ""));
  forms.add(normalized.replace(/s'$/, ""));

  if (normalized.endsWith("ies") && normalized.length > 4) {
    forms.add(normalized.slice(0, -3) + "y");
  }
  if (normalized.endsWith("ves") && normalized.length > 4) {
    forms.add(normalized.slice(0, -3) + "f");
    forms.add(normalized.slice(0, -3) + "fe");
  }
  if (normalized.endsWith("ing") && normalized.length > 5) {
    forms.add(normalized.slice(0, -3));
    forms.add(normalized.slice(0, -3) + "e");
  }
  if (normalized.endsWith("ed") && normalized.length > 4) {
    forms.add(normalized.slice(0, -2));
    forms.add(normalized.slice(0, -1));
  }
  if (normalized.endsWith("es") && normalized.length > 3) {
    forms.add(normalized.slice(0, -2));
  }
  if (normalized.endsWith("s") && !normalized.endsWith("ss") && normalized.length > 3) {
    forms.add(normalized.slice(0, -1));
  }
  if (normalized.endsWith("ly") && normalized.length > 4) {
    forms.add(normalized.slice(0, -2));
  }

  return [...forms].filter(Boolean);
}

export async function lookupWord(word: string): Promise<DictionaryEntry | null> {
  const forms = candidateForms(word);
  if (!forms.length) return null;

  // Only fetch the shard(s) the candidate forms actually fall into — never the
  // whole 2 MB dictionary. Covers + custom entries are always consulted.
  const letters = new Set(forms.map(shardFor));
  const shardLists = await Promise.all([...letters].map((l) => loadShard(l)));
  const external = shardLists.flat();

  const custom = getCustomDictionary();
  const defaults = [...FALLBACK_DICTIONARY, ...external];
  const byWord = new Map<string, DictionaryEntry>();
  for (const entry of defaults) {
    const key = entry.word.toLowerCase();
    if (!byWord.has(key)) byWord.set(key, entry);
  }
  // Custom entries override defaults.
  for (const entry of custom) byWord.set(entry.word.toLowerCase(), entry);

  for (const form of forms) {
    const hit = byWord.get(form);
    if (hit) return hit;
  }
  return null;
}

export function addDictionaryEntry(entry: DictionaryEntry): void {
  const custom = getCustomDictionary();
  const filtered = custom.filter(e => e.word.toLowerCase() !== entry.word.toLowerCase());
  filtered.unshift({ ...entry, isCustom: true });
  saveCustomDictionary(filtered);
}

export function deleteDictionaryEntry(word: string): void {
  const custom = getCustomDictionary();
  const filtered = custom.filter(e => e.word.toLowerCase() !== word.toLowerCase());
  saveCustomDictionary(filtered);
}
