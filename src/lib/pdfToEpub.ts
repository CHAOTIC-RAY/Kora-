/**
 * Best-effort, local PDF → EPUB conversion.
 * Produces a reflowable EPUB from selectable PDF text and explicitly reports
 * scanned/image-only pages instead of silently creating an empty ebook.
 */
import JSZip from "jszip";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";
import { recognizePdfWithOcr } from "./pdfOcr";

try {
  GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
} catch { /* pdf.js will report worker configuration failures at runtime */ }

export interface PdfToEpubOptions {
  title?: string;
  author?: string;
  language?: string;
  onProgress?: (progress: { stage: "reading" | "building" | "validating"; percent: number }) => void;
  maxPages?: number;
}
export interface PdfToEpubResult {
  blob: Blob;
  title: string;
  author: string;
  pageCount: number;
  extractedPages: number;
  warnings: string[];
}
function xml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}
function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function pageToXhtml(text: string, page: number): string {
  const paragraphs = text.split(/\n{2,}/).map(s => s.trim()).filter(Boolean);
  const body = paragraphs.length
    ? paragraphs.map(p => `<p>${escapeHtml(p).replace(/\n/g, "<br/>")}</p>`).join("\n")
    : "<p>[No selectable text was found on this PDF page.]</p>";
  return `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="en">
<head><title>Page ${page}</title><meta charset="utf-8"/><link rel="stylesheet" type="text/css" href="../styles/book.css"/></head>
<body><section epub:type="chapter" id="page-${page}">${body}</section></body></html>`;
}

interface PositionedText {
  text: string;
  x: number;
  y: number;
  width: number;
  fontSize: number;
  hadTrailingSpace: boolean;
}

interface TextLine {
  y: number;
  fontSize: number;
  parts: PositionedText[];
}

/** Rebuild words and paragraphs from PDF.js positioned text fragments. */
function reconstructPageText(items: any[]): string {
  const positioned: PositionedText[] = items
    .filter((item) => typeof item.str === "string" && item.str.trim())
    .map((item) => {
      const transform = item.transform || [];
      const a = Number(transform[0]) || 0;
      const b = Number(transform[1]) || 0;
      const c = Number(transform[2]) || 0;
      const d = Number(transform[3]) || 0;
      const fontSize = Math.max(1, Number(item.height) || Math.hypot(c, d) || Math.hypot(a, b) || 10);
      return {
        text: String(item.str).replace(/^\s+|\s+$/g, ""),
        x: Number(transform[4]) || 0,
        y: Number(transform[5]) || 0,
        width: Math.abs(Number(item.width) || 0),
        fontSize,
        hadTrailingSpace: /\s$/.test(String(item.str)),
      };
    });
  if (!positioned.length) return "";

  // Cluster fragments on their baseline. A font-relative tolerance handles
  // different PDF scales without merging superscripts into body lines.
  const lines: TextLine[] = [];
  for (const part of positioned) {
    let closest: TextLine | undefined;
    let closestDistance = Number.POSITIVE_INFINITY;
    for (const line of lines) {
      const distance = Math.abs(line.y - part.y);
      const tolerance = Math.max(1.5, Math.min(line.fontSize, part.fontSize) * 0.24);
      if (distance <= tolerance && distance < closestDistance) {
        closest = line;
        closestDistance = distance;
      }
    }
    if (!closest) {
      lines.push({ y: part.y, fontSize: part.fontSize, parts: [part] });
    } else {
      closest.parts.push(part);
      closest.y = closest.parts.reduce((sum, item) => sum + item.y, 0) / closest.parts.length;
      closest.fontSize = Math.max(closest.fontSize, part.fontSize);
    }
  }

  lines.sort((a, b) => b.y - a.y);
  for (const line of lines) line.parts.sort((a, b) => a.x - b.x);

  const maxTypicalGap = Math.max(lines[0]?.fontSize || 10, 1) * 4;
  const lineGaps = lines.slice(1)
    .map((line, index) => lines[index].y - line.y)
    .filter((gap) => gap > 0.5 && gap < maxTypicalGap);
  const typicalGap = lineGaps.length
    ? [...lineGaps].sort((a, b) => a - b)[Math.floor(lineGaps.length / 2)]
    : 0;

  const renderedLines = lines.map((line) => {
    let text = "";
    let previous: PositionedText | undefined;
    for (const part of line.parts) {
      if (previous && text) {
        const gap = part.x - (previous.x + previous.width);
        // Character fragments normally touch or have a tiny tracking gap;
        // word gaps are wider. Preserve explicit whitespace when present.
        const wordGap = Math.max(1.25, Math.min(previous.fontSize, part.fontSize) * 0.2);
        if (previous.hadTrailingSpace || /\s$/.test(text) || gap > wordGap) text += " ";
      }
      text += part.text;
      previous = part;
    }
    return { text: text.replace(/\s+/g, " ").trim(), y: line.y, fontSize: line.fontSize, x: line.parts[0]?.x || 0 };
  }).filter((line) => line.text);

  const paragraphs: string[] = [];
  let paragraph = "";
  for (let index = 0; index < renderedLines.length; index++) {
    const line = renderedLines[index];
    const previous = renderedLines[index - 1];
    const verticalGap = previous ? previous.y - line.y : 0;
    const paragraphGap = previous && (
      (typicalGap > 0 && verticalGap > typicalGap * 1.55) ||
      verticalGap > Math.max(line.fontSize, previous.fontSize) * 1.65 ||
      line.x - previous.x > Math.max(line.fontSize, previous.fontSize) * 0.9
    );

    if (paragraphGap && paragraph) {
      paragraphs.push(paragraph.trim());
      paragraph = "";
    }

    if (paragraph && /[-\u00ad]$/.test(paragraph) && /^[a-z]/.test(line.text)) {
      paragraph = paragraph.replace(/[-\u00ad]$/, "") + line.text;
    } else {
      paragraph = paragraph ? `${paragraph} ${line.text}` : line.text;
    }
  }
  if (paragraph.trim()) paragraphs.push(paragraph.trim());
  return paragraphs.join("\n\n");
}

export async function convertPdfToEpub(file: File | Blob, options: PdfToEpubOptions = {}): Promise<PdfToEpubResult> {
  if (!file || file.size < 8) throw new Error("The selected PDF is empty or too small to be valid.");
  if (file.size > 150 * 1024 * 1024) throw new Error("This PDF is larger than the 150 MB conversion limit. Try a smaller file.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") throw new Error("This file does not have a valid PDF signature.");

  let pdf: any;
  try { pdf = await getDocument({ data: bytes }).promise; }
  catch { throw new Error("Kora couldn't open this PDF. It may be damaged, encrypted, or unsupported."); }

  const pageCount = Number(pdf.numPages) || 0;
  const maxPages = Math.max(1, options.maxPages ?? 2000);
  if (pageCount > maxPages) {
    await pdf.destroy();
    throw new Error(`This PDF has ${pageCount} pages; the safe limit is ${maxPages}. Split it into smaller PDFs and try again.`);
  }
  const metadata = await pdf.getMetadata().catch(() => ({ info: {} }));
  const fileName = typeof File !== "undefined" && file instanceof File ? file.name.replace(/\.pdf$/i, "") : "Converted PDF";
  const resolvedTitle = (options.title || metadata?.info?.Title || fileName || "Converted PDF").trim() || "Converted PDF";
  const author = (options.author || metadata?.info?.Author || "Unknown Author").trim() || "Unknown Author";
  const language = (options.language || "en").trim() || "en";
  const pages: string[] = [];
  let nonEmptyPages = 0;
  const warnings: string[] = [];

  try {
    for (let pageNo = 1; pageNo <= pageCount; pageNo++) {
      const page = await pdf.getPage(pageNo);
      const content = await page.getTextContent();
      const text = reconstructPageText(content.items || []);
      if (text.trim()) nonEmptyPages++;
      pages.push(text);
      page.cleanup?.();
      options.onProgress?.({ stage: "reading", percent: Math.round(pageNo / Math.max(1, pageCount) * 75) });
    }
  } finally { await pdf.destroy(); }

  // Selectively OCR pages where PDF.js found little or no usable text. This
  // mirrors the working standalone converter while retaining Kora's positioned
  // text reconstruction for pages that already have a good text layer.
  const ocrPageNumbers = pages
    .map((text, index) => ({ text, pageNo: index + 1 }))
    .filter(({ text }) => text.trim().replace(/\\s/g, "").length < 60)
    .map(({ pageNo }) => pageNo);
  if (ocrPageNumbers.length) {
    try {
      options.onProgress?.({ stage: "reading", percent: 76 });
      const ocrResult = await recognizePdfWithOcr(file, (progress) => {
        options.onProgress?.({
          stage: "reading",
          percent: 10 + Math.round(progress.percent * 0.65),
        });
      }, ocrPageNumbers);
      for (const pageNo of ocrPageNumbers) {
        const recognized = ocrResult.pageTexts[pageNo - 1]?.trim() || "";
        const current = pages[pageNo - 1] || "";
        const recognizedChars = recognized.replace(/\\s/g, "").length;
        const currentChars = current.replace(/\\s/g, "").length;
        if (recognizedChars > currentChars && recognizedChars >= 8) pages[pageNo - 1] = recognized;
      }
    } catch (error) {
      if (!nonEmptyPages) {
        const detail = error instanceof Error ? error.message : String(error);
        throw new Error(`Kora couldn't extract text from this PDF and OCR failed: ${detail}`);
      }
      warnings.push("OCR could not recover every short or scanned page. The EPUB contains the text Kora could extract.");
    }
  }

  nonEmptyPages = pages.filter((text) => text.trim()).length;
  if (!nonEmptyPages) throw new Error("Kora couldn't extract readable text from this PDF, even with OCR. Try a clearer scan or a PDF with selectable text.");
  if (nonEmptyPages < pages.length) warnings.push(`${pages.length - nonEmptyPages} page(s) still contained no extractable text after OCR.`);
  warnings.push("PDF page layout, images, tables, footnotes, and typography may not be preserved exactly in a reflowable EPUB.");

  options.onProgress?.({ stage: "building", percent: 78 });
  const zip = new JSZip();
  zip.file("mimetype", "application/epub+zip", { compression: "STORE" });
  zip.folder("META-INF")!.file("container.xml", `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`);
  const oebps = zip.folder("OEBPS")!;
  const textDir = oebps.folder("text")!;
  oebps.folder("styles")!.file("book.css", "body{font-family:serif;line-height:1.65;margin:5%;}h1{font-size:1.2em;margin-bottom:1.5em;}p{margin:0 0 1em;text-indent:1em;}.page-heading{font-size:.8em;color:#777;border-bottom:1px solid #ddd;padding-bottom:.5em;}");
  const manifest: string[] = [];
  const spine: string[] = [];
  const navItems: string[] = [];
  pages.forEach((text, index) => {
    const n = index + 1;
    const id = `page-${n}`;
    const path = `page-${String(n).padStart(4, "0")}.xhtml`;
    textDir.file(path, pageToXhtml(text, n));
    manifest.push(`<item id="${id}" href="text/${path}" media-type="application/xhtml+xml"/>`);
    spine.push(`<itemref idref="${id}"/>`);
    navItems.push(`<li><a href="text/${path}">Page ${n}</a></li>`);
    options.onProgress?.({ stage: "building", percent: 78 + Math.round(n / Math.max(1, pages.length) * 17) });
  });
  oebps.file("nav.xhtml", `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${xml(language)}"><head><title>Contents</title><meta charset="utf-8"/></head><body><nav epub:type="toc" id="toc"><h1>Contents</h1><ol>${navItems.join("")}</ol></nav></body></html>`);
  manifest.push('<item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>');
  manifest.push('<item id="css" href="styles/book.css" media-type="text/css"/>');
  const identifier = `urn:kora:pdf-to-epub:${crypto.randomUUID?.() || Date.now().toString(36)}`;
  oebps.file("content.opf", `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="book-id" xml:lang="${xml(language)}"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:identifier id="book-id">${xml(identifier)}</dc:identifier><dc:title>${xml(resolvedTitle)}</dc:title><dc:creator>${xml(author)}</dc:creator><dc:language>${xml(language)}</dc:language><meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d{3}Z$/, "Z")}</meta></metadata><manifest>${manifest.join("")}</manifest><spine>${spine.join("")}</spine></package>`);

  options.onProgress?.({ stage: "validating", percent: 97 });
  const blob = await zip.generateAsync({ type: "blob", mimeType: "application/epub+zip", compression: "DEFLATE", compressionOptions: { level: 6 } });
  const check = await JSZip.loadAsync(blob);
  const container = check.file("META-INF/container.xml");
  const opf = check.file("OEBPS/content.opf");
  if (!container || !opf || !check.file("mimetype") || pages.some((_, i) => !check.file(`OEBPS/text/page-${String(i + 1).padStart(4, "0")}.xhtml`))) {
    throw new Error("EPUB validation failed. The output was not saved; please try again.");
  }
  const opfText = await opf.async("text");
  if (!opfText.includes("<spine>") || !opfText.includes("<manifest>")) throw new Error("EPUB package validation failed. Please try again with another PDF.");
  options.onProgress?.({ stage: "validating", percent: 100 });
  return { blob, title: resolvedTitle, author, pageCount, extractedPages: nonEmptyPages, warnings };
}
