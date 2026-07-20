import type { BookMetadata } from "./firebase";

export type DayPart = "morning" | "noon" | "afternoon" | "evening" | "night";

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

/** Strip series prefixes / numbering so quotes stay readable. */
function cleanBookTitle(raw: string): string {
  let t = raw.trim();
  // "Dreamland Billionaires 01The Fine Print" → prefer last title-ish chunk
  t = t.replace(/^.*?\b0*\d{1,2}(?=[A-Z])/g, "");
  t = t.replace(/^(?:book|vol\.?|volume|part)\s*\d+\s*[:\-–—]?\s*/i, "");
  t = t.replace(/\s{2,}/g, " ").trim();
  // Drop trailing series noise in parentheses
  t = t.replace(/\s*[\(\[](?:book|vol|#)\s*\d+[\)\]]\s*$/i, "").trim();
  return t || raw.trim();
}

function shortTitle(title: string, max = 26) {
  const t = cleanBookTitle(title);
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

type Greeting = { title: string; subtitle: string };

/** Pure time-of-day lines (no book). */
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
 * Book-aware quotes — {book} is replaced with a short clean title.
 * Keep headlines quote-like; progress goes in the subtitle.
 */
const BOOK_QUOTES: Record<DayPart, { read: string[]; listen: string[] }> = {
  morning: {
    read: [
      "This morning returns to “{book}”",
      "Dawn pages of “{book}”",
      "“{book}” waits with the coffee",
      "Start the day inside “{book}”",
      "Morning light on “{book}”",
    ],
    listen: [
      "Morning ears for “{book}”",
      "Dawn listens to “{book}”",
      "Coffee and “{book}” in your headphones",
      "Wake into “{book}”",
    ],
  },
  noon: {
    read: [
      "Noon finds you in “{book}”",
      "A midday visit to “{book}”",
      "“{book}” for the bright hour",
      "Pause with “{book}”",
    ],
    listen: [
      "Noon soundtrack: “{book}”",
      "Midday chapters of “{book}”",
      "Listen through lunch: “{book}”",
    ],
  },
  afternoon: {
    read: [
      "Afternoon still holding “{book}”",
      "“{book}” between the errands",
      "Soft light, open “{book}”",
      "The day leaves room for “{book}”",
    ],
    listen: [
      "Afternoon belongs to “{book}”",
      "Keep “{book}” in your ears",
      "A slow listen through “{book}”",
    ],
  },
  evening: {
    read: [
      "Evening opens “{book}” again",
      "Lamp glow on “{book}”",
      "Dusk returns you to “{book}”",
      "Settle in with “{book}”",
      "“{book}” for the long evening",
    ],
    listen: [
      "Evening voice: “{book}”",
      "Unwind into “{book}”",
      "Let “{book}” fill the dusk",
    ],
  },
  night: {
    read: [
      "Night keeps “{book}” close",
      "One more page of “{book}”",
      "“{book}” under the late lamp",
      "Midnight still reading “{book}”",
      "The quiet belongs to “{book}”",
    ],
    listen: [
      "Night listens to “{book}”",
      "Late chapters of “{book}”",
      "“{book}” until the lights go out",
    ],
  },
};

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
 * Lounge headline: random time-of-day quote, woven with the book you’re reading.
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
  // Rotate ~every 20 minutes, and vary by book so quotes feel fresh
  const slot = Math.floor(now.getTime() / (20 * 60 * 1000));
  const seed = hashSeed(part, slot, last?.id || last?.title || "none");

  if (last?.title) {
    const book = shortTitle(last.title);
    const audio = isAudiobook(last);
    const pct = Math.round(last.progress?.percent || 0);
    const pool = audio ? BOOK_QUOTES[part].listen : BOOK_QUOTES[part].read;
    // Mix in a pure time quote sometimes so it doesn’t always name the book
    const useBookLine = seed % 5 !== 0;
    const template = useBookLine
      ? pick(pool, seed)
      : pick(TIME_QUOTES[part], seed + 11);
    const title = template.replaceAll("{book}", book);

    const subBits: string[] = [];
    if (name) subBits.push(name);
    if (pct > 0) {
      subBits.push(
        audio
          ? `Continue “${book}” at ${pct}% · ${part} listen`
          : `Continue “${book}” at ${pct}% · ${part} reading`,
      );
    } else {
      subBits.push(
        audio
          ? `“${book}” is waiting · ${part}`
          : `“${book}” still has pages left · ${part}`,
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
