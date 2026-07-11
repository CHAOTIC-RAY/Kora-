// Custom Personal Dictionary Utility
// Comes with a default dictionary and manages user additions in localStorage.

export interface DictionaryEntry {
  word: string;
  definition: string;
  partOfSpeech?: string;
  example?: string;
  isCustom?: boolean;
}

const DEFAULT_DICTIONARY: DictionaryEntry[] = [
  {
    word: "kora",
    definition: "A next-generation, e-ink inspired digital library and ebook reader built with meticulous visual pairing, persistent cloud synchronization, and offline-first technology.",
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
  }
];

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

export function getAllDictionaryEntries(): DictionaryEntry[] {
  const custom = getCustomDictionary();
  const defaultWords = DEFAULT_DICTIONARY.filter(
    defWord => !custom.some(custWord => custWord.word.toLowerCase() === defWord.word.toLowerCase())
  );
  return [...custom, ...defaultWords];
}

export function lookupWord(word: string): DictionaryEntry | null {
  const normalized = word.trim().toLowerCase();
  const all = getAllDictionaryEntries();
  return all.find(entry => entry.word.toLowerCase() === normalized) || null;
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
