/**
 * Sync reading / news state into Android home-screen App Widgets.
 * No-op on web / iOS — only the Capacitor Android plugin is registered.
 */

import { registerPlugin } from "@capacitor/core";
import { isNativeAndroid } from "./capacitorNative";
import { collectTodayBriefArticles, buildTodayDailyBrief } from "./dailyNewsBriefClient";
import { getFeedItems } from "./feedStorage";

export type WidgetContinuePayload = {
  title: string;
  author: string;
  percent: number;
  kind: "book" | "audio";
};

export type WidgetBriefPayload = {
  lead: string;
  headlines: string[];
};

type KoraWidgetsPlugin = {
  sync(options: {
    continue?: WidgetContinuePayload | null;
    brief?: WidgetBriefPayload | null;
  }): Promise<{ ok?: boolean }>;
  refresh(): Promise<void>;
  requestPin(options: { which: "continue" | "brief" }): Promise<{
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

export function continuePayloadFromBook(
  book: {
    title?: string;
    author?: string;
    extension?: string;
    audiobookTracks?: unknown[];
    progress?: { percent?: number };
  } | null | undefined
): WidgetContinuePayload | null {
  if (!book?.title) return null;
  return {
    title: book.title || "Continue reading",
    author: book.author || "",
    percent: Math.round(book.progress?.percent ?? 0),
    kind: bookKind(book),
  };
}

export function briefPayloadFromFeeds(): WidgetBriefPayload | null {
  try {
    const items = getFeedItems();
    const articles = collectTodayBriefArticles(items);
    if (!articles.length) return null;
    const brief = buildTodayDailyBrief(articles);
    return {
      lead: brief?.lead || "Today across your feeds",
      headlines: articles.slice(0, 3).map((a) => a.title).filter(Boolean),
    };
  } catch {
    return null;
  }
}

/** Push Continue + Brief payloads to pinned Android widgets. */
export async function syncAndroidHomeWidgets(options?: {
  continue?: WidgetContinuePayload | null;
  brief?: WidgetBriefPayload | null;
  /** When true, rebuild brief from local feed storage if not provided. */
  includeBrief?: boolean;
}): Promise<void> {
  if (!isNativeAndroid()) return;

  const payload: {
    continue?: WidgetContinuePayload | null;
    brief?: WidgetBriefPayload | null;
  } = {};

  if (options && "continue" in (options || {})) {
    payload.continue = options?.continue ?? null;
  }
  if (options && "brief" in (options || {})) {
    payload.brief = options?.brief ?? null;
  } else if (options?.includeBrief !== false) {
    payload.brief = briefPayloadFromFeeds();
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
export async function requestPinAndroidWidget(
  which: "continue" | "brief"
): Promise<boolean> {
  if (!isNativeAndroid()) return false;
  try {
    const result = await KoraWidgets.requestPin({ which });
    return Boolean(result?.ok || result?.supported);
  } catch (err) {
    console.warn("[KoraWidgets] requestPin failed", err);
    return false;
  }
}
