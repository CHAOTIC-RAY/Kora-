import type { FeedItem } from "./feedStorage";
import type { BriefArticleInput, GeneratedDailyBrief } from "./generateNewsBrief";
import { buildFallbackDailyBrief } from "./generateNewsBrief";
import { isNewsBriefItem } from "./feedBriefs";

const CACHE_PREFIX = "kora_enhanced_brief_";

function dayKeyFromTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isSameCalendarDay(a: number, b: number): boolean {
  return dayKeyFromTimestamp(a) === dayKeyFromTimestamp(b);
}

export function collectTodayBriefArticles(items: FeedItem[]): BriefArticleInput[] {
  const today = Date.now();
  return items
    .filter((item) => isSameCalendarDay(item.publishedAt, today) && !isNewsBriefItem(item))
    .sort((a, b) => b.publishedAt - a.publishedAt)
    .slice(0, 24)
    .map((item) => ({
      id: item.id,
      source: item.subscriptionTitle,
      title: item.title,
      summary: item.summary,
      link: item.link,
    }));
}

function cacheKey(dateKey: string, articles: BriefArticleInput[]): string {
  const ids = articles.map((article) => article.id).sort().join(",");
  return `${CACHE_PREFIX}${dateKey}:${ids.slice(0, 120)}`;
}

function readCache(key: string): GeneratedDailyBrief | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as GeneratedDailyBrief;
  } catch {
    return null;
  }
}

function writeCache(key: string, brief: GeneratedDailyBrief) {
  try {
    localStorage.setItem(key, JSON.stringify(brief));
  } catch {
    // storage full or unavailable
  }
}

export async function fetchEnhancedDailyBrief(
  articles: BriefArticleInput[]
): Promise<GeneratedDailyBrief | null> {
  if (articles.length < 2) return null;

  const dateKey = dayKeyFromTimestamp(Date.now());
  const key = cacheKey(dateKey, articles);
  const cached = readCache(key);
  if (cached) return cached;

  const fallback = buildFallbackDailyBrief(articles, dateKey);

  try {
    const response = await fetch("/api/feed/daily-brief", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date: dateKey, articles }),
    });

    if (!response.ok) {
      writeCache(key, fallback);
      return fallback;
    }

    const data = (await response.json()) as GeneratedDailyBrief;
    if (!data?.lead || !Array.isArray(data.sections) || !data.sections.length) {
      writeCache(key, fallback);
      return fallback;
    }

    writeCache(key, data);
    return data;
  } catch {
    writeCache(key, fallback);
    return fallback;
  }
}
