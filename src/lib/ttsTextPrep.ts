import { TtsQualityPreset } from "./ttsSettings";

export interface SpeakChunk {
  text: string;
  pauseAfterMs: number;
  rateMultiplier: number;
  pitchMultiplier: number;
  kind: "paragraph" | "sentence" | "dialogue" | "scene-break" | "list";
}

const ABBREVIATIONS: Record<string, string> = {
  "mr.": "Mister",
  "mrs.": "Missus",
  "ms.": "Miss",
  "dr.": "Doctor",
  "prof.": "Professor",
  "st.": "Saint",
  "vs.": "versus",
  "etc.": "et cetera",
  "e.g.": "for example",
  "i.e.": "that is",
};

const BOILERPLATE_PATTERNS = [
  /^project gutenberg/i,
  /^copyright/i,
  /^all rights reserved/i,
  /^table of contents/i,
  /^contents$/i,
  /^dedication$/i,
  /^acknowledg(e)?ments$/i,
  /^license$/i,
  /^isbn[:\s]/i,
];

function isBoilerplateLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed) return true;
  if (/^\d+$/.test(trimmed)) return true;
  if (/^page\s+\d+/i.test(trimmed)) return true;
  return BOILERPLATE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

function expandAbbreviations(text: string): string {
  return text.replace(/\b([A-Za-z]{1,4})\./g, (match, word: string) => {
    const key = `${word.toLowerCase()}.`;
    return ABBREVIATIONS[key] || match;
  });
}

function normalizeWhitespace(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function stripBoilerplate(text: string): string {
  const lines = text.split("\n");
  const kept = lines.filter((line) => !isBoilerplateLine(line));
  return kept.join("\n").trim();
}

function applyDirectorRules(text: string): string {
  let output = text;
  output = output.replace(/\s*—\s*/g, " — ");
  output = output.replace(/\s*--\s*/g, " — ");
  output = output.replace(/\.\.\./g, "…");
  output = output.replace(/\s*…\s*/g, " … ");
  output = output.replace(/\n\s*\*\s*\*\s*\*\s*\n/g, "\n\n[scene break]\n\n");
  output = output.replace(/\n\s*---+\s*\n/g, "\n\n[scene break]\n\n");
  output = output.replace(/\[\d+\]/g, "");
  output = output.replace(/\((?:footnote|note)[^)]*\)/gi, "");
  return output;
}

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n{2,}/)
    .map((part) => part.replace(/\n+/g, " ").trim())
    .filter(Boolean);
}

function splitSentences(paragraph: string): string[] {
  const parts = paragraph.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [paragraph];
  return parts.map((part) => part.trim()).filter(Boolean);
}

function classifyParagraph(paragraph: string): SpeakChunk["kind"] {
  if (/^\[scene break\]$/i.test(paragraph)) return "scene-break";
  if (/^[-*•]\s+/m.test(paragraph)) return "list";
  if (/^["“][^"”]+["”]/.test(paragraph) || /["“][^"”]+["”]$/.test(paragraph)) return "dialogue";
  return "paragraph";
}

function chunkParagraph(paragraph: string, maxChars: number): string[] {
  const kind = classifyParagraph(paragraph);
  if (kind === "scene-break") return ["[scene break]"];
  if (paragraph.length <= maxChars) return [paragraph];

  const sentences = splitSentences(paragraph);
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    if ((`${current} ${piece}`).trim().length > maxChars && current) {
      chunks.push(current.trim());
      current = piece;
    } else {
      current = current ? `${current} ${piece}` : piece;
    }
  }
  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [paragraph];
}

export function prepareTextForNarration(
  rawText: string,
  options?: { chapterTitle?: string; quality?: TtsQualityPreset }
): string {
  let text = normalizeWhitespace(rawText);
  text = stripBoilerplate(text);
  text = expandAbbreviations(text);
  text = applyDirectorRules(text);

  if (options?.chapterTitle) {
    const titlePattern = new RegExp(`^${escapeRegex(options.chapterTitle)}\\s*`, "i");
    text = text.replace(titlePattern, "");
  }

  if (options?.quality === "instant") {
    return text;
  }

  return text;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function buildSpeakChunks(
  rawText: string,
  options?: { chapterTitle?: string; quality?: TtsQualityPreset; maxChars?: number }
): SpeakChunk[] {
  const prepared = prepareTextForNarration(rawText, options);
  const maxChars = options?.maxChars ?? (options?.quality === "instant" ? 220 : 180);
  const paragraphs = splitParagraphs(prepared);
  const chunks: SpeakChunk[] = [];

  for (const paragraph of paragraphs) {
    const kind = classifyParagraph(paragraph);
    const pieces = chunkParagraph(paragraph, maxChars);
    for (let i = 0; i < pieces.length; i++) {
      const text = pieces[i];
      chunks.push({
        text,
        pauseAfterMs:
          kind === "scene-break" ? 900 : kind === "dialogue" ? 280 : kind === "list" ? 220 : 180,
        rateMultiplier:
          kind === "scene-break" ? 0.85 : kind === "dialogue" ? 0.98 : kind === "list" ? 0.94 : 1,
        pitchMultiplier: kind === "dialogue" ? 1.04 : 1,
        kind,
      });
    }
  }

  return chunks.filter((chunk) => chunk.text.trim().length > 0);
}

export function estimateChunkDurationSeconds(
  chunk: SpeakChunk,
  baseRate = 1,
  basePitch = 1
): number {
  const words = chunk.text.split(/\s+/).filter(Boolean).length;
  const wordsPerMinute = 155 * baseRate * chunk.rateMultiplier;
  const seconds = (words / wordsPerMinute) * 60 + chunk.pauseAfterMs / 1000;
  const pitchFactor = basePitch > 1 ? 0.97 : basePitch < 1 ? 1.03 : 1;
  return Math.max(chunk.kind === "scene-break" ? 0.4 : 0.8, seconds * pitchFactor);
}
