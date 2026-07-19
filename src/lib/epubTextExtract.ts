import JSZip from "jszip";

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

function htmlToPlainText(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const text = doc.body?.textContent || "";
  return text.replace(/\s+/g, " ").trim();
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
    const chapterDoc = parser.parseFromString(rawContent, "text/html");
    let title =
      chapterDoc.querySelector("h1")?.textContent?.trim() ||
      chapterDoc.querySelector("h2")?.textContent?.trim() ||
      chapterDoc.querySelector("title")?.textContent?.trim() ||
      `Chapter ${i + 1}`;
    title = title.replace(/\s+/g, " ").trim();
    if (title.length > 60) title = `${title.slice(0, 57)}…`;

    const text = htmlToPlainText(rawContent);
    if (text.length < 40) continue;

    chapters.push({ index: chapters.length + 1, title, text });
  }

  if (!chapters.length) throw new Error("No readable text found in this EPUB.");
  return chapters;
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
    return [{ index: 1, title: fallbackTitle, text: normalized }];
  }

  return parts.map((text, idx) => {
    const firstLine = text.split("\n")[0]?.trim() || `Chapter ${idx + 1}`;
    const title = firstLine.length > 60 ? `Chapter ${idx + 1}` : firstLine;
    return { index: idx + 1, title, text };
  });
}

export function estimateSpeechDurationSeconds(text: string, rate = 1): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  const wordsPerMinute = 155 * rate;
  return Math.max(30, Math.round((words / wordsPerMinute) * 60));
}
