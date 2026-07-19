import { FeedItem } from "./feedStorage";

export interface BriefPeriod {
  key: string;
  start: Date;
  end: Date;
  dayLabel: string;
  monthLabel: string;
}

export interface BriefFeedItem extends FeedItem {
  briefPeriod: BriefPeriod;
}

const MONTHS: Record<string, number> = {
  january: 0,
  jan: 0,
  february: 1,
  feb: 1,
  march: 2,
  mar: 2,
  april: 3,
  apr: 3,
  may: 4,
  june: 5,
  jun: 5,
  july: 6,
  jul: 6,
  august: 7,
  aug: 7,
  september: 8,
  sep: 8,
  sept: 8,
  october: 9,
  oct: 9,
  november: 10,
  nov: 10,
  december: 11,
  dec: 11,
};

function padDate(year: number, month: number, day: number): Date {
  return new Date(year, month, day, 12, 0, 0, 0);
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", { month: "short" }).toUpperCase();
}

function formatDayLabel(start: Date, end: Date): string {
  const startDay = start.getDate();
  const endDay = end.getDate();
  if (startDay === endDay) return String(startDay);
  return `${startDay}-${endDay}`;
}

function periodKey(start: Date, end: Date): string {
  const fmt = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return `${fmt(start)}_${fmt(end)}`;
}

function parseMonthToken(token: string): number | null {
  return MONTHS[token.toLowerCase().replace(/\./g, "")] ?? null;
}

export function parseBriefPeriod(summary: string | undefined, publishedAt: number): BriefPeriod {
  const fallback = new Date(publishedAt);
  const text = (summary || "").replace(/\s+/g, " ").trim();
  const year = fallback.getFullYear();

  const rangeMatch = text.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\w*\s+(\d{1,2})\s+and\s+(\d{1,2})\b/i
  );
  if (rangeMatch) {
    const month = parseMonthToken(rangeMatch[1]);
    if (month != null) {
      const start = padDate(year, month, parseInt(rangeMatch[2], 10));
      const end = padDate(year, month, parseInt(rangeMatch[3], 10));
      return {
        key: periodKey(start, end),
        start,
        end,
        dayLabel: formatDayLabel(start, end),
        monthLabel: formatMonthLabel(start),
      };
    }
  }

  const singleMatch = text.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\w*\s+(\d{1,2})\b/i
  );
  if (singleMatch) {
    const month = parseMonthToken(singleMatch[1]);
    if (month != null) {
      const start = padDate(year, month, parseInt(singleMatch[2], 10));
      return {
        key: periodKey(start, start),
        start,
        end: start,
        dayLabel: formatDayLabel(start, start),
        monthLabel: formatMonthLabel(start),
      };
    }
  }

  const start = padDate(fallback.getFullYear(), fallback.getMonth(), fallback.getDate());
  return {
    key: periodKey(start, start),
    start,
    end: start,
    dayLabel: formatDayLabel(start, start),
    monthLabel: formatMonthLabel(start),
  };
}

export function isNewsBriefItem(item: FeedItem): boolean {
  if (item.category === "daily-brief") return false;
  if (item.category && /brief|roundup|digest/i.test(item.category)) return true;

  const haystack = `${item.title} ${item.link} ${item.summary || ""}`.toLowerCase();

  if (/\/news-in-brief\//i.test(item.link)) return true;
  if (/news[-\s]?in[-\s]?brief/i.test(haystack)) return true;
  if (/brief from\b/i.test(haystack)) return true;
  if (/\b(daily|evening)\s+(brief|roundup|digest)\b/i.test(haystack)) return true;
  if (/\bnews roundup\b/i.test(haystack)) return true;
  if (/\bheadlines\b/i.test(item.title) && /\b(brief|roundup|digest)\b/i.test(haystack)) return true;
  if (/\b(day in review|today in brief)\b/i.test(haystack)) return true;

  return false;
}

function dayKeyFromTimestamp(ts: number): string {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function isSameCalendarDay(a: number, b: number): boolean {
  return dayKeyFromTimestamp(a) === dayKeyFromTimestamp(b);
}

/** Build daily headline roundups when feeds don't publish dedicated brief articles. */
export function buildSyntheticDailyBriefs(items: FeedItem[]): BriefFeedItem[] {
  const grouped = new Map<string, FeedItem[]>();

  for (const item of items) {
    if (isNewsBriefItem(item)) continue;
    const key = `${item.subscriptionId}:${dayKeyFromTimestamp(item.publishedAt)}`;
    const list = grouped.get(key) || [];
    list.push(item);
    grouped.set(key, list);
  }

  const briefs: BriefFeedItem[] = [];

  for (const [key, articles] of grouped) {
    if (articles.length < 2) continue;

    const sorted = [...articles].sort((a, b) => b.publishedAt - a.publishedAt);
    const top = sorted.slice(0, 8);
    const headline = top[0];
    const summary = top.map((article, index) => `${index + 1}. ${article.title}`).join("\n");
    const publishedAt = top[0].publishedAt;

    briefs.push({
      id: `synthetic-brief-${key}`,
      subscriptionId: headline.subscriptionId,
      subscriptionTitle: headline.subscriptionTitle,
      title: `Daily Brief — ${headline.subscriptionTitle}`,
      summary,
      link: top[0].link,
      publishedAt,
      read: top.every((article) => article.read),
      category: "daily-brief",
      briefPeriod: parseBriefPeriod(summary, publishedAt),
    });
  }

  return briefs.sort((a, b) => b.briefPeriod.end.getTime() - a.briefPeriod.end.getTime());
}

/** Combined brief for today across all sources (shown at top of Read feed). */
export function buildTodayCombinedBrief(items: FeedItem[]): BriefFeedItem | null {
  const today = Date.now();
  const todays = items
    .filter((item) => isSameCalendarDay(item.publishedAt, today) && !isNewsBriefItem(item))
    .sort((a, b) => b.publishedAt - a.publishedAt);

  if (todays.length < 2) return null;

  const bySource = new Map<string, FeedItem[]>();
  for (const item of todays) {
    const list = bySource.get(item.subscriptionId) || [];
    list.push(item);
    bySource.set(item.subscriptionId, list);
  }

  const lines: string[] = [];
  for (const [, articles] of bySource) {
    const top = articles.slice(0, 2);
    for (const article of top) {
      lines.push(`• ${article.subscriptionTitle}: ${article.title}`);
    }
  }

  const summary = lines.slice(0, 12).join("\n");
  const publishedAt = todays[0].publishedAt;

  return {
    id: `combined-brief-${dayKeyFromTimestamp(today)}`,
    subscriptionId: "all-sources",
    subscriptionTitle: "All Sources",
    title: "Today's News Brief",
    summary,
    link: todays[0].link,
    publishedAt,
    read: false,
    category: "daily-brief",
    briefPeriod: parseBriefPeriod(summary, publishedAt),
  };
}

export function toBriefFeedItems(items: FeedItem[]): BriefFeedItem[] {
  const native = items
    .filter((item) => isNewsBriefItem(item))
    .map((item) => ({
      ...item,
      briefPeriod: parseBriefPeriod(item.summary, item.publishedAt),
    }));

  const nativeKeys = new Set(
    native.map((brief) => `${brief.subscriptionId}:${brief.briefPeriod.key}`)
  );

  const synthetic = buildSyntheticDailyBriefs(items).filter(
    (brief) => !nativeKeys.has(`${brief.subscriptionId}:${brief.briefPeriod.key}`)
  );

  return [...native, ...synthetic].sort(
    (a, b) => b.briefPeriod.end.getTime() - a.briefPeriod.end.getTime()
  );
}

export function buildBriefDateChips(briefs: BriefFeedItem[]): BriefPeriod[] {
  const map = new Map<string, BriefPeriod>();
  for (const brief of briefs) {
    if (!map.has(brief.briefPeriod.key)) {
      map.set(brief.briefPeriod.key, brief.briefPeriod);
    }
  }
  return Array.from(map.values()).sort((a, b) => b.end.getTime() - a.end.getTime());
}

export function briefsForPeriod(briefs: BriefFeedItem[], periodKey: string): BriefFeedItem[] {
  return briefs.filter((brief) => brief.briefPeriod.key === periodKey);
}
