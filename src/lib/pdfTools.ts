import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

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

export async function exportBookToPdf(opts: {
  title: string;
  author?: string;
  chapters: Array<{ title: string; text?: string; html?: string }>;
}): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  const times = await pdfDoc.embedFont(StandardFonts.TimesRoman);
  const timesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
  const timesItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
  const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);

  const pageWidth = 612; // 8.5 x 11 inches
  const pageHeight = 792;
  const marginX = 54;
  const marginY = 54;
  const contentWidth = pageWidth - marginX * 2;

  // 1. Cover / Title Page
  const titlePage = pdfDoc.addPage([pageWidth, pageHeight]);
  const titleText = opts.title.trim() || "Untitled Book";
  const authorText = opts.author?.trim() ? `By ${opts.author.trim()}` : "";

  let currentY = pageHeight - 240;

  const titleFontSize = 26;
  const titleWords = titleText.split(" ");
  let titleLine = "";
  for (const word of titleWords) {
    const testLine = titleLine ? `${titleLine} ${word}` : word;
    if (timesBold.widthOfTextAtSize(testLine, titleFontSize) > contentWidth) {
      const w = timesBold.widthOfTextAtSize(titleLine, titleFontSize);
      titlePage.drawText(titleLine, {
        x: (pageWidth - w) / 2,
        y: currentY,
        size: titleFontSize,
        font: timesBold,
        color: rgb(0.1, 0.1, 0.1),
      });
      currentY -= titleFontSize + 8;
      titleLine = word;
    } else {
      titleLine = testLine;
    }
  }
  if (titleLine) {
    const w = timesBold.widthOfTextAtSize(titleLine, titleFontSize);
    titlePage.drawText(titleLine, {
      x: (pageWidth - w) / 2,
      y: currentY,
      size: titleFontSize,
      font: timesBold,
      color: rgb(0.1, 0.1, 0.1),
    });
    currentY -= titleFontSize + 24;
  }

  if (authorText) {
    const w = timesItalic.widthOfTextAtSize(authorText, 14);
    titlePage.drawText(authorText, {
      x: (pageWidth - w) / 2,
      y: currentY,
      size: 14,
      font: timesItalic,
      color: rgb(0.35, 0.35, 0.35),
    });
  }

  // Draw dividing line on title page
  titlePage.drawLine({
    start: { x: pageWidth / 2 - 40, y: currentY - 20 },
    end: { x: pageWidth / 2 + 40, y: currentY - 20 },
    thickness: 1,
    color: rgb(0.7, 0.7, 0.7),
  });

  // 2. Chapters
  let pageNum = 1;

  for (let cIdx = 0; cIdx < opts.chapters.length; cIdx++) {
    const chap = opts.chapters[cIdx];
    let page = pdfDoc.addPage([pageWidth, pageHeight]);
    pageNum++;

    let y = pageHeight - marginY;

    // Chapter Header
    const chapTitle = chap.title.trim() || `Chapter ${cIdx + 1}`;
    page.drawText(chapTitle, {
      x: marginX,
      y,
      size: 18,
      font: timesBold,
      color: rgb(0.1, 0.1, 0.1),
    });
    y -= 28;

    page.drawLine({
      start: { x: marginX, y },
      end: { x: pageWidth - marginX, y },
      thickness: 0.5,
      color: rgb(0.85, 0.85, 0.85),
    });
    y -= 20;

    let rawText = chap.text || "";
    if (!rawText && chap.html) {
      const tempDiv = document.createElement("div");
      tempDiv.innerHTML = chap.html;
      rawText = tempDiv.innerText || tempDiv.textContent || "";
    }

    const paragraphs = rawText
      .replace(/\r\n/g, "\n")
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter(Boolean);

    const bodyFontSize = 11;
    const lineHeight = 16;

    for (const para of paragraphs) {
      const words = para.split(/\s+/);
      let line = "";
      for (const word of words) {
        const testLine = line ? `${line} ${word}` : word;
        const testWidth = times.widthOfTextAtSize(testLine, bodyFontSize);

        if (testWidth > contentWidth) {
          if (y < marginY + 20) {
            page.drawText(`${pageNum}`, {
              x: pageWidth / 2 - 10,
              y: marginY / 2,
              size: 9,
              font: helvetica,
              color: rgb(0.5, 0.5, 0.5),
            });

            page = pdfDoc.addPage([pageWidth, pageHeight]);
            pageNum++;
            y = pageHeight - marginY;
          }

          page.drawText(line, {
            x: marginX,
            y,
            size: bodyFontSize,
            font: times,
            color: rgb(0.15, 0.15, 0.15),
          });
          y -= lineHeight;
          line = word;
        } else {
          line = testLine;
        }
      }

      if (line) {
        if (y < marginY + 20) {
          page.drawText(`${pageNum}`, {
            x: pageWidth / 2 - 10,
            y: marginY / 2,
            size: 9,
            font: helvetica,
            color: rgb(0.5, 0.5, 0.5),
          });

          page = pdfDoc.addPage([pageWidth, pageHeight]);
          pageNum++;
          y = pageHeight - marginY;
        }

        page.drawText(line, {
          x: marginX,
          y,
          size: bodyFontSize,
          font: times,
          color: rgb(0.15, 0.15, 0.15),
        });
        y -= lineHeight;
      }

      y -= 8;
    }

    // Page Number Footer
    page.drawText(`${pageNum}`, {
      x: pageWidth / 2 - 10,
      y: marginY / 2,
      size: 9,
      font: helvetica,
      color: rgb(0.5, 0.5, 0.5),
    });
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([pdfBytes], { type: "application/pdf" });
}

