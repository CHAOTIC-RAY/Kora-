export interface BriefArticleInput {
  id: string;
  source: string;
  title: string;
  summary?: string;
  link: string;
}

export interface BriefStoryItem {
  id: string;
  headline: string;
  detail: string;
  link: string;
}

export interface BriefSection {
  source: string;
  intro: string;
  items: BriefStoryItem[];
}

export interface GeneratedDailyBrief {
  date: string;
  lead: string;
  sections: BriefSection[];
}

const FILLER_PREFIX =
  /^(breaking|update|updated|watch|live|video|photos?|opinion|analysis|exclusive|just in|alert|report|reports)\s*[:\-–—|]\s*/i;

const TRAILING_NOISE =
  /\s*[\-–—|]\s*(read more|click here|full story|more details|source|photo|video|live updates?)\.?$/i;

const HTML_TAG = /<[^>]+>/g;

const TOPIC_KEYWORDS: Record<string, RegExp> = {
  politics: /\b(election|parliament|president|minister|government|policy|vote|cabinet|military|war|diplomat)\b/i,
  business: /\b(bank|loan|economy|market|trade|invest|company|business|finance|currency|gdp|tax)\b/i,
  sports: /\b(match|cup|goal|team|league|tournament|world cup|score|player|coach|final)\b/i,
  weather: /\b(storm|rain|flood|cyclone|weather|temperature|heatwave|drought)\b/i,
  health: /\b(hospital|health|disease|virus|vaccine|medical|doctor|patient)\b/i,
  crime: /\b(arrest|police|court|trial|sentence|investigation|crime|murder|theft)\b/i,
};

function stripHtml(text: string): string {
  return text.replace(HTML_TAG, " ").replace(/&nbsp;/gi, " ").replace(/&amp;/gi, "&");
}

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function normalizeForCompare(text: string): string {
  return normalizeWhitespace(text)
    .toLowerCase()
    .replace(/[^\w\s]/g, "")
    .replace(/\b(the|a|an|in|on|at|to|for|of|and|or|is|are|was|were)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function wordOverlap(a: string, b: string): number {
  const wordsA = new Set(normalizeForCompare(a).split(" ").filter(Boolean));
  const wordsB = new Set(normalizeForCompare(b).split(" ").filter(Boolean));
  if (!wordsA.size || !wordsB.size) return 0;
  let shared = 0;
  for (const word of wordsA) {
    if (wordsB.has(word)) shared++;
  }
  return shared / Math.max(wordsA.size, wordsB.size);
}

function isDuplicate(title: string, seen: string[]): boolean {
  return seen.some((existing) => wordOverlap(title, existing) > 0.72);
}

function limitWords(text: string, max: number): string {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length <= max) return text;
  return words.slice(0, max).join(" ").replace(/[,;:]$/, "") + "…";
}

/** Rewrite headline to be direct and straight to the point. */
export function rewriteHeadline(title: string): string {
  let text = normalizeWhitespace(stripHtml(title));
  text = text.replace(FILLER_PREFIX, "");
  text = text.replace(/^["'“”]+|["'“”]+$/g, "");
  text = text.replace(TRAILING_NOISE, "");
  text = text.replace(/\s*\([^)]{0,40}\)\s*$/, ""); // trailing parenthetical

  // Split on colon/dash — keep the substantive part
  const parts = text.split(/\s*[:\-–—]\s+/);
  if (parts.length > 1) {
    const substantive = parts.find((part) => part.split(/\s+/).length >= 3) || parts[parts.length - 1];
    text = substantive;
  }

  // Sentence case: capitalize first letter only (preserve acronyms)
  if (text.length > 0) {
    text = text.charAt(0).toUpperCase() + text.slice(1);
  }

  return limitWords(text, 12);
}

/** Extract one crisp detail sentence from summary or title. */
export function extractDetail(summary: string | undefined, headline: string): string {
  const cleaned = normalizeWhitespace(stripHtml(summary || ""));
  let detail = "";

  if (cleaned.length > 20) {
    const sentences = cleaned.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [cleaned];
    detail = sentences
      .map((sentence) => normalizeWhitespace(sentence))
      .find((sentence) => {
        if (sentence.length < 25) return false;
        if (wordOverlap(sentence, headline) > 0.85) return false;
        if (/^(read more|click|share|subscribe|follow)/i.test(sentence)) return false;
        return true;
      }) || sentences[0];
  }

  if (!detail || detail.length < 15) {
    detail = headline.endsWith(".") ? headline : `${headline}.`;
  }

  detail = detail.replace(TRAILING_NOISE, "");
  return limitWords(detail, 28);
}

function detectSectionTheme(headlines: string[]): string {
  const scores = new Map<string, number>();
  const combined = headlines.join(" ");

  for (const [topic, pattern] of Object.entries(TOPIC_KEYWORDS)) {
    const matches = combined.match(new RegExp(pattern.source, "gi"));
    if (matches) scores.set(topic, matches.length);
  }

  const sorted = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  if (!sorted.length || sorted[0][1] === 0) return "general news";

  const labels: Record<string, string> = {
    politics: "politics and governance",
    business: "business and finance",
    sports: "sports",
    weather: "weather and environment",
    health: "health",
    crime: "crime and courts",
  };

  return labels[sorted[0][0]] || "top stories";
}

function buildSectionIntro(source: string, items: BriefStoryItem[]): string {
  const theme = detectSectionTheme(items.map((item) => item.headline));
  if (theme === "general news") {
    return `${items.length} headline${items.length === 1 ? "" : "s"} from ${source} today.`;
  }
  return `${source} focuses on ${theme} today — ${items.length} stor${items.length === 1 ? "y" : "ies"}.`;
}

function buildLead(sections: BriefSection[]): string {
  const topHeadlines = sections
    .flatMap((section) => section.items.slice(0, 1))
    .slice(0, 4)
    .map((item) => item.headline.replace(/\.$/, ""));

  if (!topHeadlines.length) return "No headlines available for today.";

  if (topHeadlines.length === 1) {
    return `Today's lead story: ${topHeadlines[0]}.`;
  }

  const last = topHeadlines.pop();
  const joined = topHeadlines.join("; ");
  return `Today across your feeds: ${joined}; and ${last}.`;
}

function dedupeArticles(articles: BriefArticleInput[]): BriefArticleInput[] {
  const seen: string[] = [];
  const result: BriefArticleInput[] = [];

  for (const article of articles) {
    if (isDuplicate(article.title, seen)) continue;
    seen.push(article.title);
    result.push(article);
  }

  return result;
}

/** Build a structured daily brief entirely on-device — no AI. */
export function buildDailyBrief(articles: BriefArticleInput[], dateKey: string): GeneratedDailyBrief {
  const unique = dedupeArticles(articles);
  const bySource = new Map<string, BriefArticleInput[]>();

  for (const article of unique) {
    const list = bySource.get(article.source) || [];
    list.push(article);
    bySource.set(article.source, list);
  }

  const sections: BriefSection[] = [];

  for (const [source, items] of bySource) {
    const top = items.slice(0, 5);
    const storyItems: BriefStoryItem[] = top.map((article) => {
      const headline = rewriteHeadline(article.title);
      return {
        id: article.id,
        headline,
        detail: extractDetail(article.summary, headline),
        link: article.link,
      };
    });

    sections.push({
      source,
      intro: buildSectionIntro(source, storyItems),
      items: storyItems,
    });
  }

  sections.sort((a, b) => b.items.length - a.items.length);

  return {
    date: dateKey,
    lead: buildLead(sections),
    sections,
  };
}
