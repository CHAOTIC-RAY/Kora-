import { GoogleGenAI, Type } from "@google/genai";

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

function cleanHeadline(title: string): string {
  return title
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—:|]+/, "")
    .trim();
}

function firstSentence(text: string | undefined, fallback: string): string {
  if (!text?.trim()) return fallback;
  const match = text.replace(/\s+/g, " ").trim().match(/^(.+?[.!?…])(?:\s|$)/);
  return match?.[1]?.trim() || text.slice(0, 160).trim();
}

/** Local structured brief when Gemini is unavailable. */
export function buildFallbackDailyBrief(
  articles: BriefArticleInput[],
  dateKey: string
): GeneratedDailyBrief {
  const bySource = new Map<string, BriefArticleInput[]>();
  for (const article of articles) {
    const list = bySource.get(article.source) || [];
    list.push(article);
    bySource.set(article.source, list);
  }

  const sections: BriefSection[] = [];
  for (const [source, items] of bySource) {
    const top = items.slice(0, 4);
    sections.push({
      source,
      intro: `${top.length} stor${top.length === 1 ? "y" : "ies"} from ${source} today.`,
      items: top.map((article) => ({
        id: article.id,
        headline: cleanHeadline(article.title),
        detail: firstSentence(article.summary, cleanHeadline(article.title)),
        link: article.link,
      })),
    });
  }

  const lead =
    sections.length > 0
      ? `Today's top stories across ${sections.length} source${sections.length === 1 ? "" : "s"}: ${sections
          .flatMap((section) => section.items.slice(0, 1).map((item) => item.headline))
          .slice(0, 3)
          .join("; ")}.`
      : "No headlines available for today.";

  return { date: dateKey, lead, sections };
}

export async function generateDailyNewsBrief(
  articles: BriefArticleInput[],
  apiKey: string,
  dateKey: string
): Promise<GeneratedDailyBrief> {
  if (!apiKey) {
    throw new Error("Brief generation service is not configured.");
  }

  if (!articles.length) {
    return buildFallbackDailyBrief(articles, dateKey);
  }

  const ai = new GoogleGenAI({ apiKey });
  const payload = articles.slice(0, 24).map((article) => ({
    id: article.id,
    source: article.source,
    title: article.title,
    summary: (article.summary || "").slice(0, 280),
    link: article.link,
  }));

  const response = await ai.models.generateContent({
    model: "gemini-2.0-flash",
    contents: [
      {
        parts: [
          {
            text: `Rewrite today's news into a direct, structured daily brief.

Rules:
- Lead: 1-2 short sentences covering the biggest themes today. No fluff.
- Group stories by source (use exact source names from input).
- For each story: rewrite headline to be direct and straight to the point (max 12 words).
- For each story detail: 1 crisp sentence with the key fact only (max 28 words).
- Skip duplicate or near-duplicate stories.
- Keep the same article id and link from input.
- Section intro: one short line summarizing that source's angle today.

Articles JSON:
${JSON.stringify(payload)}`,
          },
        ],
      },
    ],
    config: {
      responseMimeType: "application/json",
      responseSchema: {
        type: Type.OBJECT,
        required: ["lead", "sections"],
        properties: {
          lead: { type: Type.STRING },
          sections: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              required: ["source", "intro", "items"],
              properties: {
                source: { type: Type.STRING },
                intro: { type: Type.STRING },
                items: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    required: ["id", "headline", "detail", "link"],
                    properties: {
                      id: { type: Type.STRING },
                      headline: { type: Type.STRING },
                      detail: { type: Type.STRING },
                      link: { type: Type.STRING },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  const raw = response.text?.trim();
  if (!raw) {
    return buildFallbackDailyBrief(articles, dateKey);
  }

  const parsed = JSON.parse(raw) as { lead?: string; sections?: BriefSection[] };
  if (!parsed.lead || !Array.isArray(parsed.sections) || !parsed.sections.length) {
    return buildFallbackDailyBrief(articles, dateKey);
  }

  const linkById = new Map(articles.map((article) => [article.id, article.link]));

  const sections = parsed.sections
      .map((section) => ({
        source: section.source?.trim() || "News",
        intro: section.intro?.trim() || "",
        items: (section.items || [])
          .map((item) => ({
            id: item.id,
            headline: cleanHeadline(item.headline || ""),
            detail: item.detail?.trim() || "",
            link: item.link || linkById.get(item.id) || articles[0]?.link || "",
          }))
          .filter((item) => item.headline && item.detail),
      }))
      .filter((section) => section.items.length > 0);

  if (!sections.length) {
    return buildFallbackDailyBrief(articles, dateKey);
  }

  return {
    date: dateKey,
    lead: parsed.lead.trim(),
    sections,
  };
}
