/**
 * Best-effort, local PDF → EPUB conversion.
 * Produces a reflowable EPUB from selectable PDF text and explicitly reports
 * scanned/image-only pages instead of silently creating an empty ebook.
 */
import JSZip from "jszip";
import { getDocument, GlobalWorkerOptions } from "pdfjs-dist";

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
<body><section epub:type="chapter" id="page-${page}"><h1 class="page-heading">Page ${page}</h1>${body}</section></body></html>`;
}

export async function convertPdfToEpub(file: File | Blob, options: PdfToEpubOptions = {}): Promise<PdfToEpubResult> {
  if (!file || file.size < 8) throw new Error("The selected PDF is empty or too small to be valid.");
  if (file.size > 150 * 1024 * 1024) throw new Error("This PDF is larger than the 150 MB conversion limit. Try a smaller file.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (String.fromCharCode(...bytes.slice(0, 5)) !== "%PDF-") throw new Error("This file does not have a valid PDF signature.");

  let pdf: any;
  try { pdf = await getDocument({ data: bytes, isEvalSupported: false }).promise; }
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
      const positioned = (content.items || [])
        .filter((item: any) => typeof item.str === "string" && item.str.trim())
        .map((item: any) => ({ text: item.str, x: Number(item.transform?.[4] || 0), y: Number(item.transform?.[5] || 0) }));
      const lines: Array<{ y: number; parts: Array<{ x: number; text: string }> }> = [];
      for (const item of positioned) {
        let line = lines.find(candidate => Math.abs(candidate.y - item.y) < 3);
        if (!line) { line = { y: item.y, parts: [] }; lines.push(line); }
        line.parts.push({ x: item.x, text: item.text });
      }
      lines.sort((a, b) => b.y - a.y);
      const text = lines.map(line => line.parts.sort((a, b) => a.x - b.x).map(p => p.text).join(" ").replace(/\s+/g, " ").trim()).filter(Boolean).join("\n");
      if (text.trim()) nonEmptyPages++;
      pages.push(text);
      page.cleanup?.();
      options.onProgress?.({ stage: "reading", percent: Math.round(pageNo / Math.max(1, pageCount) * 75) });
    }
  } finally { await pdf.destroy(); }

  if (!nonEmptyPages) throw new Error("No selectable text was found. This appears to be a scanned/image-only PDF; OCR is required before it can become a readable reflowable EPUB.");
  if (nonEmptyPages < pages.length) warnings.push(`${pages.length - nonEmptyPages} page(s) contained no extractable text and may need OCR.`);
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
