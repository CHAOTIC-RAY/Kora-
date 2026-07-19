import JSZip from "jszip";
import { prepareTextForNarration } from "./ttsTextPrep";

export interface TextChapter {
  index: number;
  title: string;
  text: string;
}

function pathResolve(base: string, href: string): string {
  if (href.startsWith("/")) return href.slice(1);
  if (!base) return href;
  const stack = base.split("/").filter(Boolean);
  for (const part of href.split("/")) {
    if (part === "..") stack.pop();
    else if (part !== "." && part !== "") stack.push(part);
  }
  return stack.join("/");
}

function htmlToStructuredText(html: string): { title: string; text: string } {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const title =
    doc.querySelector("h1")?.textContent?.trim() ||
    doc.querySelector("h2")?.textContent?.trim() ||
    doc.querySelector("h3")?.textContent?.trim() ||
    doc.querySelector("title")?.textContent?.trim() ||
    "";

  const blockTags = ["p", "h1", "h2", "h3", "h4", "li", "blockquote", "pre"];
  const blocks: string[] = [];
  blockTags.forEach((tag) => {
    doc.querySelectorAll(tag).forEach((node) => {
      const text = node.textContent?.replace(/\s+/g, " ").trim();
      if (text) blocks.push(text);
    });
  });

  const text = blocks.length
    ? blocks.join("\n\n")
    : (doc.body?.textContent || "").replace(/\s+/g, " ").trim();

  return { title: title.replace(/\s+/g, " ").trim(), text };
}


async function parseNcxTitles(
  zip: JSZip,
  opfDoc: Document,
  manifestItems: Record<string, string>,
  rootDir: string
): Promise<Record<string, string>> {
  const titles: Record<string, string> = {};
  const ncxId = opfDoc.querySelector("spine")?.getAttribute("toc");
  const ncxHref = ncxId ? manifestItems[ncxId] : Object.values(manifestItems).find((href) => /\.ncx$/i.test(href));
  if (!ncxHref) return titles;

  const ncxPath = pathResolve(rootDir, ncxHref);
  const ncxText = await zip.file(ncxPath)?.async("string");
  if (!ncxText) return titles;

  const ncxDoc = new DOMParser().parseFromString(ncxText, "text/xml");
  ncxDoc.querySelectorAll("navPoint").forEach((point) => {
    const label = point.querySelector("navLabel > text")?.textContent?.trim();
    const content = point.querySelector("content")?.getAttribute("src");
    if (!label || !content) return;
    const href = content.split("#")[0];
    titles[pathResolve(rootDir, href)] = label;
    titles[href] = label;
  });
  return titles;
}

function mergeShortChapters(chapters: TextChapter[], minChars = 500): TextChapter[] {
  if (chapters.length <= 1) return chapters;
  const merged: TextChapter[] = [];
  let buffer: TextChapter | null = null;

  for (const chapter of chapters) {
    if (!buffer) {
      buffer = { ...chapter };
      continue;
    }
    if (buffer.text.length < minChars) {
      buffer.text = `${buffer.text}\n\n${chapter.text}`;
      buffer.title = buffer.title || chapter.title;
    } else {
      merged.push({ ...buffer, index: merged.length + 1 });
      buffer = { ...chapter };
    }
  }
  if (buffer) merged.push({ ...buffer, index: merged.length + 1 });
  return merged;
}

export async function extractEpubChapters(blob: Blob): Promise<TextChapter[]> {
  const zip = await JSZip.loadAsync(blob);
  const containerXml = await zip.file("META-INF/container.xml")?.async("string");
  if (!containerXml) throw new Error("Invalid EPUB: missing container.xml");

  const parser = new DOMParser();
  const containerDoc = parser.parseFromString(containerXml, "text/xml");
  const rootfilePath = containerDoc.querySelector("rootfile")?.getAttribute("full-path");
  if (!rootfilePath) throw new Error("Invalid EPUB: cannot find OPF file");

  const rootDir = rootfilePath.includes("/")
    ? rootfilePath.substring(0, rootfilePath.lastIndexOf("/") + 1)
    : "";

  const opfText = await zip.file(rootfilePath)?.async("string");
  if (!opfText) throw new Error("Invalid EPUB: OPF file not readable");

  const opfDoc = parser.parseFromString(opfText, "text/xml");
  const manifestItems: Record<string, string> = {};
  opfDoc.querySelectorAll("manifest > item, item").forEach((item) => {
    const id = item.getAttribute("id");
    const href = item.getAttribute("href");
    if (id && href) manifestItems[id] = href;
  });

  const navTitles = await parseNcxTitles(zip, opfDoc, manifestItems, rootDir);

  const spineItems: string[] = [];
  opfDoc.querySelectorAll("spine > itemref, itemref").forEach((itemref) => {
    const idref = itemref.getAttribute("idref");
    if (idref && manifestItems[idref]) spineItems.push(manifestItems[idref]);
  });

  const chapters: TextChapter[] = [];
  for (let i = 0; i < spineItems.length; i++) {
    const relativeHref = spineItems[i];
    const fullChapterPath = pathResolve(rootDir, relativeHref);
    const chapterFile = zip.file(fullChapterPath) || zip.file(`${rootDir}${relativeHref}`);
    if (!chapterFile) continue;

    const rawContent = await chapterFile.async("string");
    const structured = htmlToStructuredText(rawContent);
    let title =
      navTitles[fullChapterPath] ||
      navTitles[relativeHref] ||
      structured.title ||
      `Chapter ${i + 1}`;
    title = title.replace(/\s+/g, " ").trim();
    if (title.length > 60) title = `${title.slice(0, 57)}…`;

    const text = prepareTextForNarration(structured.text, { chapterTitle: title, quality: "balanced" });
    if (text.length < 40) continue;

    chapters.push({ index: chapters.length + 1, title, text });
  }

  if (!chapters.length) throw new Error("No readable text found in this EPUB.");
  return mergeShortChapters(chapters);
}

export async function extractTxtChapters(blob: Blob, fallbackTitle = "Chapter 1"): Promise<TextChapter[]> {
  const raw = await blob.text();
  const normalized = raw.replace(/\r\n/g, "\n").trim();
  if (!normalized) throw new Error("Text file is empty.");

  const parts = normalized
    .split(/\n(?=chapter\s+\d+|CHAPTER\s+\d+)/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 40);

  if (parts.length <= 1) {
    return [
      {
        index: 1,
        title: fallbackTitle,
        text: prepareTextForNarration(normalized, { chapterTitle: fallbackTitle, quality: "balanced" }),
      },
    ];
  }

  return parts.map((text, idx) => {
    const firstLine = text.split("\n")[0]?.trim() || `Chapter ${idx + 1}`;
    const title = firstLine.length > 60 ? `Chapter ${idx + 1}` : firstLine;
    return {
      index: idx + 1,
      title,
      text: prepareTextForNarration(text, { chapterTitle: title, quality: "balanced" }),
    };
  });
}

export function estimateSpeechDurationSeconds(text: string, rate = 1): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  const wordsPerMinute = 155 * rate;
  return Math.max(30, Math.round((words / wordsPerMinute) * 60));
}
