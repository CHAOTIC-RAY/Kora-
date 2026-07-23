/**
 * Library insights for moods, pacing, and genres — pie chart data (no AI).
 */

import type { BookMetadata } from "./firebase";
import { inferBookMood, type BookMood } from "./loungeGreeting";
import { ensureSeriesFields } from "./seriesHelper";

export interface PieSlice {
  id: string;
  label: string;
  value: number;
  color: string;
}

export interface ReadingInsights {
  moods: PieSlice[];
  pacing: PieSlice[];
  genres: PieSlice[];
  totals: {
    books: number;
    completed: number;
    reading: number;
    minutesTrackedHint: string;
  };
}

const MOOD_COLORS: Record<string, string> = {
  romance: "#f472b6",
  thriller: "#f97316",
  mystery: "#a78bfa",
  fantasy: "#34d399",
  scifi: "#38bdf8",
  literary: "#fbbf24",
  nonfiction: "#94a3b8",
  audio: "#c084fc",
  general: "#d4a574",
};

const PACING_COLORS = {
  binge: "#22c55e",
  steady: "#38bdf8",
  slow: "#f59e0b",
  parked: "#94a3b8",
  fresh: "#e879f9",
};

const GENRE_PALETTE = [
  "#f43f5e",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#14b8a6",
  "#3b82f6",
  "#8b5cf6",
  "#ec4899",
  "#d4a574",
  "#64748b",
];

const MOOD_LABELS: Record<BookMood, string> = {
  romance: "Romance",
  thriller: "Thriller",
  mystery: "Mystery",
  fantasy: "Fantasy",
  scifi: "Sci‑Fi",
  literary: "Literary",
  nonfiction: "Nonfiction",
  audio: "Audio",
  general: "General",
};

function countMapToSlices(
  counts: Record<string, number>,
  colorFn: (key: string, i: number) => string,
  labelFn: (key: string) => string,
  limit = 8
): PieSlice[] {
  const entries = Object.entries(counts)
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit);
  return entries.map(([id, value], i) => ({
    id,
    label: labelFn(id),
    value,
    color: colorFn(id, i),
  }));
}

/** Infer pacing from status + progress freshness. */
export function inferPacing(book: BookMetadata): string {
  const pct = book.progress?.percent || 0;
  const last = book.progress?.lastReadTime || book.dateModified || book.dateAdded || 0;
  const days = last ? (Date.now() - last) / (1000 * 60 * 60 * 24) : 999;

  if (book.status === "completed") {
    if (days <= 14) return "binge";
    return "steady";
  }
  if (book.status === "reading" || pct > 0) {
    if (pct >= 60 && days <= 7) return "binge";
    if (days <= 21) return "steady";
    if (pct > 5) return "slow";
    return "parked";
  }
  if (days <= 30) return "fresh";
  return "parked";
}

const PACING_LABELS: Record<string, string> = {
  binge: "Binge pace",
  steady: "Steady",
  slow: "Slow burn",
  parked: "On pause",
  fresh: "Just shelved",
};

const SKIP_TAGS = new Set([
  "ebook",
  "pdf",
  "epub",
  "audiobook",
  "fiction",
  "non-fiction",
  "nonfiction",
]);

export function buildReadingInsights(books: BookMetadata[]): ReadingInsights {
  const library = books.map(ensureSeriesFields);
  const moodCounts: Record<string, number> = {};
  const pacingCounts: Record<string, number> = {};
  const genreCounts: Record<string, number> = {};

  let completed = 0;
  let reading = 0;

  for (const book of library) {
    if (book.status === "completed") completed++;
    else if (book.status === "reading" || (book.progress?.percent || 0) > 0) reading++;

    const mood = inferBookMood(book);
    moodCounts[mood] = (moodCounts[mood] || 0) + 1;

    const pace = inferPacing(book);
    pacingCounts[pace] = (pacingCounts[pace] || 0) + 1;

    const tags = (book.tags || []).map((t) => t.trim()).filter(Boolean);
    if (tags.length) {
      for (const tag of tags) {
        const key = tag.toLowerCase();
        if (SKIP_TAGS.has(key) || key.length < 2) continue;
        const label = tag.length > 24 ? tag.slice(0, 22) + "…" : tag;
        genreCounts[label] = (genreCounts[label] || 0) + 1;
      }
    } else {
      genreCounts["Untagged"] = (genreCounts["Untagged"] || 0) + 1;
    }
  }

  return {
    moods: countMapToSlices(
      moodCounts,
      (k) => MOOD_COLORS[k] || "#d4a574",
      (k) => MOOD_LABELS[k as BookMood] || k
    ),
    pacing: countMapToSlices(
      pacingCounts,
      (k) => PACING_COLORS[k as keyof typeof PACING_COLORS] || "#94a3b8",
      (k) => PACING_LABELS[k] || k
    ),
    genres: countMapToSlices(
      genreCounts,
      (_k, i) => GENRE_PALETTE[i % GENRE_PALETTE.length]!,
      (k) => k,
      10
    ),
    totals: {
      books: library.length,
      completed,
      reading,
      minutesTrackedHint: "Based on your library moods, pace, and tags",
    },
  };
}

/** SVG path for a pie slice (angles in radians, 0 at top). */
export function pieSlicePath(
  cx: number,
  cy: number,
  r: number,
  startAngle: number,
  endAngle: number
): string {
  const x1 = cx + r * Math.sin(startAngle);
  const y1 = cy - r * Math.cos(startAngle);
  const x2 = cx + r * Math.sin(endAngle);
  const y2 = cy - r * Math.cos(endAngle);
  const large = endAngle - startAngle > Math.PI ? 1 : 0;
  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

export function slicesWithAngles(slices: PieSlice[]): Array<PieSlice & { start: number; end: number; pct: number }> {
  const total = slices.reduce((s, x) => s + x.value, 0) || 1;
  let angle = 0;
  return slices.map((slice) => {
    const sweep = (slice.value / total) * Math.PI * 2;
    const start = angle;
    const end = angle + sweep;
    angle = end;
    return { ...slice, start, end, pct: (slice.value / total) * 100 };
  });
}
