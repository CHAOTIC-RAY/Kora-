import type { BookMetadata } from "./firebase";

export type DayPart = "morning" | "noon" | "afternoon" | "evening" | "night";

export type BookMood =
  | "romance"
  | "thriller"
  | "fantasy"
  | "scifi"
  | "mystery"
  | "literary"
  | "nonfiction"
  | "audio"
  | "general";

export function getDayPart(date = new Date()): DayPart {
  const h = date.getHours();
  if (h >= 5 && h < 11) return "morning";
  if (h >= 11 && h < 14) return "noon";
  if (h >= 14 && h < 17) return "afternoon";
  if (h >= 17 && h < 21) return "evening";
  return "night";
}

function isAudiobook(book: BookMetadata | null | undefined) {
  return book?.extension?.toLowerCase() === "audiobook";
}

type Greeting = { title: string; subtitle: string };

/** Pure time-of-day lines (no book title). */
const TIME_QUOTES: Record<DayPart, string[]> = {
  morning: [
    "Morning belongs to the next page",
    "Brew the coffee; open the story",
    "Soft dawn, sharper sentences",
    "First light, first paragraph",
    "The day begins between covers",
    "Wake gently into a chapter",
  ],
  noon: [
    "A noon chapter clears the mind",
    "Midday hush — one more page",
    "Sun high, story closer",
    "Pause here; the plot won’t mind",
    "Lunch break, ink break",
    "Bright hour, quiet book",
  ],
  afternoon: [
    "Afternoon light loves long paragraphs",
    "The day still has pages left",
    "Between tasks, a chapter waits",
    "Soft hours for steady reading",
    "Let the afternoon turn slowly",
    "Margins of the day, open book",
  ],
  evening: [
    "Evening settles into stories",
    "Lamp glow and lingering lines",
    "Dusk is for unhurried pages",
    "Nightfall, page-turn weather",
    "The day softens; the book stays",
    "Pour the evening into a chapter",
  ],
  night: [
    "Late pages, quiet rooms",
    "Midnight ink still warm",
    "The house sleeps; the book doesn’t",
    "Stars out, chapter on",
    "One more page under the lamp",
    "Night keeps the best secrets in books",
  ],
};

/**
 * Mood / genre / time lines — never insert the book title.
 * Inspired by whatever you’re mid-read, without naming it.
 */
const MOOD_QUOTES: Record<BookMood, Record<DayPart, string[]>> = {
  romance: {
    morning: [
      "Soft morning for a love story",
      "Dawn feels a little tender today",
      "Heart-first pages with the coffee",
      "A gentle start for two hearts",
    ],
    noon: [
      "Midday butterflies, mid-chapter",
      "A bright hour for slow chemistry",
      "Lunch break, longing lines",
    ],
    afternoon: [
      "Afternoon light on quiet longing",
      "Soft hours for a soft romance",
      "Let the day lean into affection",
    ],
    evening: [
      "Evening is made for slow burns",
      "Lamp glow and almost-confessions",
      "Dusk softens every love story",
    ],
    night: [
      "Late pages, warmer hearts",
      "Midnight belongs to the almost-kiss",
      "One more chapter under soft light",
    ],
  },
  thriller: {
    morning: [
      "Morning adrenaline, page by page",
      "Sharp dawn for a sharper plot",
      "Coffee, then the next twist",
    ],
    noon: [
      "Noon pulse — keep the plot moving",
      "Bright hour, darker turns",
      "A midday chase through the pages",
    ],
    afternoon: [
      "Afternoon tension, carefully paced",
      "The day still has secrets left",
      "Stay close — the plot is awake",
    ],
    evening: [
      "Evening thickens the suspense",
      "Dusk is when the stakes rise",
      "Lamp on — trust no one yet",
    ],
    night: [
      "Night is when the plot thickens",
      "Midnight ink, racing pulse",
      "Don’t sleep before the reveal",
    ],
  },
  fantasy: {
    morning: [
      "Morning mist for another world",
      "First light over imagined maps",
      "Dawn opens a quieter kingdom",
    ],
    noon: [
      "Noon sun on faraway roads",
      "A bright hour for bold quests",
      "Midday in a borrowed realm",
    ],
    afternoon: [
      "Afternoon spells, slowly cast",
      "Soft light for long legends",
      "Wander the margins of the day",
    ],
    evening: [
      "Evening fireside, epic pages",
      "Dusk gathers the fellowship",
      "Lamp glow for old magic",
    ],
    night: [
      "Night skies for ancient stories",
      "Stars out — dragons optional",
      "Midnight maps still unfolding",
    ],
  },
  scifi: {
    morning: [
      "Morning signal from elsewhere",
      "First light on future tense",
      "Dawn protocols: open the next file",
    ],
    noon: [
      "Midday orbit around a new idea",
      "Bright hour, colder stars",
      "A noon jump through timelines",
    ],
    afternoon: [
      "Afternoon systems still online",
      "Soft light on hard science",
      "The day runs on speculation",
    ],
    evening: [
      "Evening transmissions, clearer now",
      "Dusk over distant colonies",
      "Lamp glow for possible worlds",
    ],
    night: [
      "Night watch on the unknown",
      "Stars out — theories open",
      "Midnight among the machinery",
    ],
  },
  mystery: {
    morning: [
      "Morning clues, carefully noted",
      "Dawn likes a quiet investigation",
      "Coffee and unanswered questions",
    ],
    noon: [
      "Noon light on thin evidence",
      "A bright hour for cold cases",
      "Midday — follow the thread",
    ],
    afternoon: [
      "Afternoon shadows lengthen",
      "Soft hours for harder questions",
      "Something still doesn’t add up",
    ],
    evening: [
      "Evening is for gathering suspects",
      "Dusk thickens every alibi",
      "Lamp on — reread the clues",
    ],
    night: [
      "Night keeps the best secrets",
      "Midnight ink, one more theory",
      "The quiet before the reveal",
    ],
  },
  literary: {
    morning: [
      "Morning sentences, carefully made",
      "Soft dawn for precise prose",
      "First light on quiet observation",
    ],
    noon: [
      "A noon pause for fine writing",
      "Bright hour, quieter mind",
      "Midday among measured lines",
    ],
    afternoon: [
      "Afternoon light loves long paragraphs",
      "Soft hours for careful reading",
      "Let the day turn like a page",
    ],
    evening: [
      "Evening settles into language",
      "Lamp glow and lingering lines",
      "Dusk is for unhurried prose",
    ],
    night: [
      "Late pages, quieter rooms",
      "Midnight still listening to the sentence",
      "Night keeps the best paragraphs",
    ],
  },
  nonfiction: {
    morning: [
      "Morning mind, ready to learn",
      "Dawn notes and sharper focus",
      "First light for new ideas",
    ],
    noon: [
      "A noon chapter clears the mind",
      "Bright hour for useful pages",
      "Midday fuel for curiosity",
    ],
    afternoon: [
      "Afternoon study, gently paced",
      "Soft hours for hard facts",
      "Keep learning between the errands",
    ],
    evening: [
      "Evening review under warm light",
      "Dusk is good for big ideas",
      "Settle in — one more insight",
    ],
    night: [
      "Night notes before tomorrow",
      "Midnight still curious",
      "Quiet hours for clear thinking",
    ],
  },
  audio: {
    morning: [
      "Morning ears, ready to listen",
      "Dawn soundtrack for the commute",
      "Soft voices with the coffee",
    ],
    noon: [
      "Noon listens a little louder",
      "A bright hour in your headphones",
      "Midday chapters, hands free",
    ],
    afternoon: [
      "Afternoon belongs to a good listen",
      "Soft hours in your ears",
      "Keep the story walking with you",
    ],
    evening: [
      "Evening voice, unhurried",
      "Unwind into a spoken chapter",
      "Dusk sounds better narrated",
    ],
    night: [
      "Night listens until the lights go out",
      "Late chapters, low volume",
      "Midnight still in your ears",
    ],
  },
  general: {
    morning: TIME_QUOTES.morning,
    noon: TIME_QUOTES.noon,
    afternoon: TIME_QUOTES.afternoon,
    evening: TIME_QUOTES.evening,
    night: TIME_QUOTES.night,
  },
};

const MOOD_LABEL: Record<BookMood, string> = {
  romance: "romance",
  thriller: "thriller",
  fantasy: "fantasy",
  scifi: "sci‑fi",
  mystery: "mystery",
  literary: "literary",
  nonfiction: "nonfiction",
  audio: "listen",
  general: "reading",
};

/** Infer a loose mood/genre from tags + title/author cues — never shown as the title itself. */
export function inferBookMood(book: BookMetadata | null | undefined): BookMood {
  if (!book) return "general";
  if (isAudiobook(book)) return "audio";

  const blob = [
    book.title,
    book.author,
    book.series,
    book.description,
    ...(book.tags || []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  if (
    /romance|romantasy|love story|billionaire|wedding|heart|kiss|dating|bride|groom|slow burn/.test(
      blob
    )
  ) {
    return "romance";
  }
  if (/thriller|suspense|assassin|espionage|conspiracy|hostage|fugitive|betrayal/.test(blob)) {
    return "thriller";
  }
  if (/mystery|detective|crime|whodunit|investigation|sleuth|noir/.test(blob)) {
    return "mystery";
  }
  if (
    /fantasy|dragon|wizard|witch|elf|magic|kingdom|quest|enchant|faerie|fae/.test(blob)
  ) {
    return "fantasy";
  }
  if (
    /sci-?fi|science fiction|space|android|cyber|dystopia|galaxy|robot|alien|quantum/.test(
      blob
    )
  ) {
    return "scifi";
  }
  if (
    /memoir|biography|history|self-?help|business|science|politics|essay|true story|nonfiction|non-fiction/.test(
      blob
    )
  ) {
    return "nonfiction";
  }
  if (/poetry|literary|novel|fiction|classic/.test(blob)) {
    return "literary";
  }
  return "general";
}

function pick<T>(list: T[], seed: number): T {
  return list[Math.abs(seed) % list.length];
}

function hashSeed(...parts: (string | number)[]): number {
  const s = parts.join("|");
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/**
 * Lounge headline: time-of-day + theme/genre mood — never the book title.
 */
export function buildLoungeGreeting(opts: {
  nickname?: string;
  lastReadBook?: BookMetadata | null;
  recentBooks?: BookMetadata[];
  now?: Date;
}): Greeting {
  const now = opts.now ?? new Date();
  const part = getDayPart(now);
  const name = opts.nickname?.trim();
  const last = opts.lastReadBook || opts.recentBooks?.[0] || null;
  const mood = inferBookMood(last);
  // Rotate ~every 20 minutes; vary by mood so lines feel fresh
  const slot = Math.floor(now.getTime() / (20 * 60 * 1000));
  const seed = hashSeed(part, slot, mood, last?.id || "none");

  // Prefer mood lines when we have a book; mix pure time quotes ~1/4 of the time
  const moodPool = MOOD_QUOTES[mood][part];
  const useMood = last && seed % 4 !== 0;
  const title = useMood ? pick(moodPool, seed) : pick(TIME_QUOTES[part], seed + 11);

  if (last) {
    const pct = Math.round(last.progress?.percent || 0);
    const audio = isAudiobook(last);
    const moodLabel = MOOD_LABEL[mood];
    const subBits: string[] = [];
    if (name) subBits.push(name);
    if (pct > 0) {
      subBits.push(
        audio
          ? `Continue listening · ${pct}% · ${part}`
          : `Continue reading · ${pct}% · ${part} ${moodLabel}`,
      );
    } else {
      subBits.push(
        audio
          ? `A listen waits · ${part}`
          : `Something ${moodLabel} waits · ${part}`,
      );
    }
    return { title, subtitle: subBits.join(" — ") };
  }

  const emptySubs: Record<DayPart, string> = {
    morning: "Your shelf is quiet — discover something worth the morning.",
    noon: "No chapter in progress. Find a noon novel on Discover.",
    afternoon: "Empty desk, open afternoon — pull a title from Discover.",
    evening: "Nothing mid-read yet. An evening book is one tap away.",
    night: "The night is blank — start a story before you sleep.",
  };

  return {
    title: pick(TIME_QUOTES[part], seed),
    subtitle: name ? `${name} — ${emptySubs[part]}` : emptySubs[part],
  };
}
