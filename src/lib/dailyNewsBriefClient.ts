import type { FeedItem } from "./feedStorage";
import type { BriefArticleInput, GeneratedDailyBrief } from "./generateNewsBrief";
import { buildDailyBrief } from "./generateNewsBrief";
import { isNewsBriefItem } from "./feedBriefs";

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

export function buildTodayDailyBrief(articles: BriefArticleInput[]): GeneratedDailyBrief | null {
  if (articles.length < 2) return null;
  const dateKey = dayKeyFromTimestamp(Date.now());
  return buildDailyBrief(articles, dateKey);
}
