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

function shortTitle(title: string, max = 32) {
  const t = title.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).trimEnd()}…`;
}

type Greeting = { title: string; subtitle: string };

const TIME_ONLY: Record<DayPart, string[]> = {
  morning: [
    "Morning light, open page",
    "A quiet start between chapters",
    "Coffee, ink, and first lines",
    "Dawn belongs to readers",
  ],
  noon: [
    "Noon pause — one more page",
    "Midday mind, open book",
    "A bright chapter break",
    "Sun high, story closer",
  ],
  afternoon: [
    "Afternoon in the margins",
    "Soft light, steady reading",
    "The day still has pages left",
    "Between tasks, a chapter waits",
  ],
  evening: [
    "Evening settles into stories",
    "Lamp glow and long paragraphs",
    "Nightfall, page-turn weather",
    "Dusk is for lingering books",
  ],
  night: [
    "Late pages, quiet rooms",
    "Midnight ink still warm",
    "The house sleeps; the book doesn’t",
    "Stars out, chapter on",
  ],
};

function pick<T>(list: T[], seed: number): T {
  return list[Math.abs(seed) % list.length];
}

/**
 * Lounge headline: time-of-day + what you’re reading — replaces “Welcome back…”.
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
  // Stable-ish within the hour so the line doesn’t thrash every render
  const seed = Math.floor(now.getTime() / 3_600_000);

  if (last?.title) {
    const title = shortTitle(last.title);
    const audio = isAudiobook(last);
    const pct = Math.round(last.progress?.percent || 0);
    const verb = audio ? "listen" : "read";

    const bookTitles: string[] = audio
      ? [
          `${part === "morning" ? "Morning" : part === "noon" ? "Noon" : part === "afternoon" ? "Afternoon" : part === "evening" ? "Evening" : "Night"} · back to “${title}”`,
          `Still listening: “${title}”`,
          pct > 0 ? `“${title}” · ${pct}% heard` : `“${title}” is queued`,
          `Headphones ready for “${title}”`,
        ]
      : [
          `${part === "morning" ? "Morning" : part === "noon" ? "Noon" : part === "afternoon" ? "Afternoon" : part === "evening" ? "Evening" : "Night"} pages of “${title}”`,
          `Where you left “${title}”`,
          pct > 0 ? `“${title}” · page ${pct}%` : `“${title}” waits on the shelf`,
          `Return to “${title}”`,
        ];

    const headline = pick(bookTitles, seed + (audio ? 3 : 7));

    const subBits: string[] = [];
    if (name) subBits.push(name);
    if (pct > 0) {
      subBits.push(
        audio
          ? `Pick up around ${pct}% · ${part} ${verb}`
          : `Continue at ${pct}% · ${part} reading`,
      );
    } else {
      subBits.push(
        audio
          ? `Your next chapter is audio · ${part}`
          : `A chapter is waiting · ${part}`,
      );
    }

    return {
      title: headline,
      subtitle: subBits.join(" — "),
    };
  }

  const emptySubs: Record<DayPart, string> = {
    morning: "Your shelf is quiet — discover something worth the morning.",
    noon: "No chapter in progress. Find a noon novel on Discover.",
    afternoon: "Empty desk, open afternoon — pull a title from Discover.",
    evening: "Nothing mid-read yet. An evening book is one tap away.",
    night: "The night is blank — start a story before you sleep.",
  };

  return {
    title: pick(TIME_ONLY[part], seed),
    subtitle: name ? `${name} — ${emptySubs[part]}` : emptySubs[part],
  };
}
