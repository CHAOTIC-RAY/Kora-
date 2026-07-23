/**
 * Sync reading / news state into Android home-screen App Widgets.
 * No-op on web / iOS — only the Capacitor Android plugin is registered.
 */

import { registerPlugin } from "@capacitor/core";
import { isNativeAndroid } from "./capacitorNative";
import { collectTodayBriefArticles, buildTodayDailyBrief } from "./dailyNewsBriefClient";
import { getFeedItems } from "./feedStorage";
import { WORD_BANK } from "./wordGamesBank";

export type WidgetContinuePayload = {
  title: string;
  author: string;
  percent: number;
  kind: "book" | "audio";
  coverUrl?: string;
  coverKey?: string;
  playing?: boolean;
};

export type WidgetBriefPayload = {
  lead: string;
  headlines: string[];
};

export type WidgetMiniGamePayload = {
  day: string;
  word: string;
  clue: string;
};

type WidgetPinWhich = "continue" | "brief" | "book" | "audio" | "game";

type KoraWidgetsPlugin = {
  sync(options: {
    continue?: WidgetContinuePayload | null;
    continueBook?: WidgetContinuePayload | null;
    continueAudio?: WidgetContinuePayload | null;
    brief?: WidgetBriefPayload | null;
    miniGame?: WidgetMiniGamePayload | null;
  }): Promise<{ ok?: boolean }>;
  refresh(): Promise<void>;
  requestPin(options: { which: WidgetPinWhich }): Promise<{
    ok?: boolean;
    supported?: boolean;
  }>;
};

const KoraWidgets = registerPlugin<KoraWidgetsPlugin>("KoraWidgets");

function bookKind(book: {
  extension?: string;
  audiobookTracks?: unknown[];
} | null | undefined): "book" | "audio" {
  const ext = (book?.extension || "").toLowerCase();
  if (book?.audiobookTracks?.length || ext === "audio" || ext === "mp3") return "audio";
  return "book";
}

function coverFields(book: { id?: string; coverUrl?: string; title?: string } | null | undefined) {
  const coverUrl = (book?.coverUrl || "").trim();
  if (!coverUrl || coverUrl.startsWith("data:") || coverUrl.includes("placeholder")) {
    return {};
  }
  // Absolute http(s) only — native widget process can't resolve app-relative paths.
  if (!/^https?:\/\//i.test(coverUrl)) return {};
  const coverKey = book?.id || String(hashString(coverUrl));
  return { coverUrl, coverKey };
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h >>> 0;
}

export function continuePayloadFromBook(
  book: {
    id?: string;
    title?: string;
    author?: string;
    extension?: string;
    coverUrl?: string;
    audiobookTracks?: unknown[];
    progress?: { percent?: number };
  } | null | undefined,
  extras?: { playing?: boolean }
): WidgetContinuePayload | null {
  if (!book?.title) return null;
  return {
    title: book.title || "Continue reading",
    author: book.author || "",
    percent: Math.round(book.progress?.percent ?? 0),
    kind: bookKind(book),
    ...coverFields(book),
    ...(extras?.playing != null ? { playing: extras.playing } : {}),
  };
}

export function isAudiobookMeta(book: {
  extension?: string;
  audiobookTracks?: unknown[];
} | null | undefined): boolean {
  return bookKind(book) === "audio";
}

/** Pick the most recently read library item of a given kind. */
export function pickLastReadOfKind<
  T extends {
    id?: string;
    title?: string;
    extension?: string;
    audiobookTracks?: unknown[];
    progress?: { lastReadTime?: number; percent?: number };
  },
>(
  books: T[],
  kind: "book" | "audio",
  preferred?: T | null
): T | null {
  if (preferred && bookKind(preferred) === kind) return preferred;
  const filtered = (books || []).filter((b) => bookKind(b) === kind && b.title);
  if (!filtered.length) return null;
  return filtered.sort(
    (a, b) => (b.progress?.lastReadTime || 0) - (a.progress?.lastReadTime || 0)
  )[0]!;
}

export function briefPayloadFromFeeds(): WidgetBriefPayload | null {
  try {
    const items = getFeedItems();
    const articles = collectTodayBriefArticles(items);
    if (!articles.length) return null;
    const brief = buildTodayDailyBrief(articles);
    return {
      lead: brief?.lead || "Today across your feeds",
      headlines: articles.slice(0, 6).map((a) => a.title).filter(Boolean),
    };
  } catch {
    return null;
  }
}

export function miniGamePayloadForToday(): WidgetMiniGamePayload {
  const now = new Date();
  const day = `${now.getFullYear()}-${now.getMonth() + 1}-${now.getDate()}`;
  const pool = WORD_BANK.filter((w) => w.word.length >= 3 && w.word.length <= 6);
  const idx = Math.abs(hashString(day)) % Math.max(1, pool.length);
  const entry = pool[idx] || WORD_BANK[0]!;
  return {
    day,
    word: entry.word.toUpperCase(),
    clue: entry.clue,
  };
}

/** Push Continue + Brief payloads to pinned Android widgets. */
export async function syncAndroidHomeWidgets(options?: {
  continue?: WidgetContinuePayload | null;
  continueBook?: WidgetContinuePayload | null;
  continueAudio?: WidgetContinuePayload | null;
  brief?: WidgetBriefPayload | null;
  miniGame?: WidgetMiniGamePayload | null;
  /** When true, rebuild brief from local feed storage if not provided. */
  includeBrief?: boolean;
  includeMiniGame?: boolean;
}): Promise<void> {
  if (!isNativeAndroid()) return;

  const payload: {
    continue?: WidgetContinuePayload | null;
    continueBook?: WidgetContinuePayload | null;
    continueAudio?: WidgetContinuePayload | null;
    brief?: WidgetBriefPayload | null;
    miniGame?: WidgetMiniGamePayload | null;
  } = {};

  if (options && "continue" in (options || {})) {
    payload.continue = options?.continue ?? null;
  }
  if (options && "continueBook" in (options || {})) {
    payload.continueBook = options?.continueBook ?? null;
  }
  if (options && "continueAudio" in (options || {})) {
    payload.continueAudio = options?.continueAudio ?? null;
  }
  if (options && "brief" in (options || {})) {
    payload.brief = options?.brief ?? null;
  } else if (options?.includeBrief !== false) {
    payload.brief = briefPayloadFromFeeds();
  }
  if (options && "miniGame" in (options || {})) {
    payload.miniGame = options?.miniGame ?? null;
  } else if (options?.includeMiniGame !== false) {
    payload.miniGame = miniGamePayloadForToday();
  }

  try {
    await KoraWidgets.sync(payload);
  } catch (err) {
    console.warn("[KoraWidgets] sync failed", err);
  }
}

export async function refreshAndroidHomeWidgets(): Promise<void> {
  if (!isNativeAndroid()) return;
  try {
    await KoraWidgets.refresh();
  } catch (err) {
    console.warn("[KoraWidgets] refresh failed", err);
  }
}

/** Ask the launcher to pin a Kora widget (Android 8+). */
export async function requestPinAndroidWidget(which: WidgetPinWhich): Promise<boolean> {
  if (!isNativeAndroid()) return false;
  try {
    const result = await KoraWidgets.requestPin({ which });
    return Boolean(result?.ok || result?.supported);
  } catch (err) {
    console.warn("[KoraWidgets] requestPin failed", err);
    return false;
  }
}
