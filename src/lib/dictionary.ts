// Custom Personal Dictionary Utility
// Comes with a default dictionary and manages user additions in localStorage.
// Can load external dictionary data from dictionary-data.json (parsed from StarDict).

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

// External dictionary cache (loaded from StarDict)
let EXTERNAL_DICTIONARY: DictionaryEntry[] | null = null;
let externalDictLoaded = false;

// Load external dictionary data from JSON file (browser-safe)
async function loadExternalDictionary(): Promise<void> {
  if (externalDictLoaded) return;
  
  try {
    const response = await fetch('/dictionary-data.json');
    if (response.ok) {
      EXTERNAL_DICTIONARY = await response.json();
      console.log(`Loaded ${EXTERNAL_DICTIONARY!.length} entries from external dictionary`);
    }
  } catch (e) {
    // Silently fail - will use fallback dictionary
    console.warn('Failed to load external dictionary:', e);
  }
  
  externalDictLoaded = true;
}

// Get the default dictionary (external if available, otherwise fallback)
function getDefaultDictionary(): DictionaryEntry[] {
  return EXTERNAL_DICTIONARY || FALLBACK_DICTIONARY;
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
  // Try to load external dictionary on first call
  if (!externalDictLoaded) {
    await loadExternalDictionary();
  }
  
  const custom = getCustomDictionary();
  const defaults = [...FALLBACK_DICTIONARY, ...(EXTERNAL_DICTIONARY || [])];
  const defaultWords = defaults.filter(
    defWord => !custom.some(custWord => custWord.word.toLowerCase() === defWord.word.toLowerCase())
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
  const all = await getAllDictionaryEntries();
  const byWord = new Map(all.map((entry) => [entry.word.toLowerCase(), entry]));

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
