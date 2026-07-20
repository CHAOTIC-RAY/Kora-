import { PDFDocument, degrees, rgb } from "pdf-lib";

export async function mergePdfs(files: Blob[]): Promise<Blob> {
  if (files.length < 2) throw new Error("Select at least two PDF files to merge.");
  const merged = await PDFDocument.create();

  for (const file of files) {
    const bytes = await file.arrayBuffer();
    const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
    const pages = await merged.copyPages(doc, doc.getPageIndices());
    pages.forEach((page) => merged.addPage(page));
  }

  const out = await merged.save();
  return new Blob([out], { type: "application/pdf" });
}

export async function rotatePdf(file: Blob, angle: 90 | 180 | 270): Promise<Blob> {
  const bytes = await file.arrayBuffer();
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  for (const page of doc.getPages()) {
    const current = page.getRotation().angle || 0;
    page.setRotation(degrees((current + angle) % 360));
  }
  const out = await doc.save();
  return new Blob([out], { type: "application/pdf" });
}

export async function extractPdfPages(
  file: Blob,
  fromPage: number,
  toPage: number
): Promise<Blob> {
  const bytes = await file.arrayBuffer();
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const total = src.getPageCount();
  const start = Math.max(1, Math.min(fromPage, total));
  const end = Math.max(start, Math.min(toPage, total));

  const outDoc = await PDFDocument.create();
  const indices = Array.from({ length: end - start + 1 }, (_, i) => start - 1 + i);
  const pages = await outDoc.copyPages(src, indices);
  pages.forEach((page) => outDoc.addPage(page));

  const out = await outDoc.save();
  return new Blob([out], { type: "application/pdf" });
}

export async function inspectPdf(file: Blob): Promise<{
  pageCount: number;
  title: string;
  author: string;
  sizeBytes: number;
}> {
  const bytes = await file.arrayBuffer();
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  return {
    pageCount: doc.getPageCount(),
    title: doc.getTitle() || "Untitled",
    author: doc.getAuthor() || "Unknown",
    sizeBytes: file.size,
  };
}

export async function stampPdfPageNumbers(file: Blob): Promise<Blob> {
  const bytes = await file.arrayBuffer();
  const doc = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const pages = doc.getPages();
  pages.forEach((page, index) => {
    const { width } = page.getSize();
    page.drawText(`${index + 1} / ${pages.length}`, {
      x: width / 2 - 18,
      y: 18,
      size: 9,
      color: rgb(0.35, 0.35, 0.35),
    });
  });
  const out = await doc.save();
  return new Blob([out], { type: "application/pdf" });
}
