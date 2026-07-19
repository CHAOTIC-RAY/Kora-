/** Reading time, streaks, and time-left estimates. */

export interface DayReadingStat {
  minutes: number;
  pages?: number;
  books?: string[];
}

export type ReadingStatsMap = Record<string, DayReadingStat>;

const STATS_KEY = "kora_reading_stats";
const WPM_KEY = "kora_reading_wpm";
const DEFAULT_WPM = 230;

export function todayKey(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}

/** Legacy key used by older builds (`Date.toDateString()`). */
export function legacyTodayKey(d = new Date()): string {
  return d.toDateString();
}

function dayMinutes(stats: ReadingStatsMap, d: Date): number {
  const iso = stats[todayKey(d)]?.minutes || 0;
  const legacy = stats[legacyTodayKey(d)]?.minutes || 0;
  return Math.max(iso, legacy);
}

export function loadReadingStats(): ReadingStatsMap {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return {};
    return JSON.parse(raw) as ReadingStatsMap;
  } catch {
    return {};
  }
}

export function saveReadingStats(stats: ReadingStatsMap) {
  localStorage.setItem(STATS_KEY, JSON.stringify(stats));
}

export function recordReadingMinute(bookId?: string) {
  const stats = loadReadingStats();
  const iso = todayKey();
  const legacy = legacyTodayKey();
  const prev = Math.max(stats[iso]?.minutes || 0, stats[legacy]?.minutes || 0);
  const minutes = prev + 1;
  const books = new Set([...(stats[iso]?.books || []), ...(stats[legacy]?.books || [])]);
  if (bookId) books.add(bookId);
  const entry: DayReadingStat = {
    minutes,
    pages: Math.max(stats[iso]?.pages || 0, stats[legacy]?.pages || 0),
    books: Array.from(books),
  };
  stats[iso] = entry;
  stats[legacy] = { ...entry };
  saveReadingStats(stats);
  return stats;
}

export function recordPagesRead(pages: number, bookId?: string) {
  if (pages <= 0) return loadReadingStats();
  const stats = loadReadingStats();
  const key = todayKey();
  const entry = stats[key] || { minutes: 0, pages: 0, books: [] };
  entry.pages = (entry.pages || 0) + pages;
  if (bookId) {
    const books = new Set(entry.books || []);
    books.add(bookId);
    entry.books = Array.from(books);
  }
  stats[key] = entry;
  saveReadingStats(stats);
  return stats;
}

export function calculateStreak(stats: ReadingStatsMap = loadReadingStats()): number {
  let streak = 0;
  const cursor = new Date();
  for (let i = 0; i < 365; i++) {
    const minutes = dayMinutes(stats, cursor);
    if (minutes > 0) {
      streak += 1;
      cursor.setDate(cursor.getDate() - 1);
    } else if (i === 0) {
      cursor.setDate(cursor.getDate() - 1);
    } else {
      break;
    }
  }
  return streak;
}

export function minutesThisWeek(stats: ReadingStatsMap = loadReadingStats()): number {
  let total = 0;
  const cursor = new Date();
  for (let i = 0; i < 7; i++) {
    total += dayMinutes(stats, cursor);
    cursor.setDate(cursor.getDate() - 1);
  }
  return total;
}

export function pagesToday(stats: ReadingStatsMap = loadReadingStats()): number {
  return stats[todayKey()]?.pages || 0;
}

export function getReadingWpm(): number {
  try {
    const v = parseInt(localStorage.getItem(WPM_KEY) || "", 10);
    if (Number.isFinite(v) && v >= 80 && v <= 800) return v;
  } catch {
    /* ignore */
  }
  return DEFAULT_WPM;
}

export function setReadingWpm(wpm: number) {
  localStorage.setItem(WPM_KEY, String(Math.max(80, Math.min(800, Math.round(wpm)))));
}

/** Estimate remaining reading time from remaining word count. */
export function estimateTimeLeftMinutes(remainingWords: number, wpm = getReadingWpm()): number {
  if (remainingWords <= 0) return 0;
  return Math.max(1, Math.ceil(remainingWords / Math.max(1, wpm)));
}

export function formatTimeLeft(minutes: number): string {
  if (minutes < 1) return "Done";
  if (minutes < 60) return `~${minutes} min left`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `~${h}h ${m}m left` : `~${h}h left`;
}

/** Last 28 days for streak calendar (oldest → newest). */
export function streakCalendarDays(stats: ReadingStatsMap = loadReadingStats(), days = 28) {
  const out: { key: string; minutes: number; pages: number }[] = [];
  const cursor = new Date();
  cursor.setDate(cursor.getDate() - (days - 1));
  for (let i = 0; i < days; i++) {
    const key = todayKey(cursor);
    const entry = stats[key];
    out.push({ key, minutes: entry?.minutes || 0, pages: entry?.pages || 0 });
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}
