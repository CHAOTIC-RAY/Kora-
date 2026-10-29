import * as pdfjsLib from "pdfjs-dist";
import { createWorker } from "tesseract.js";
import tesseractWorkerUrl from "tesseract.js/dist/worker.min.js?url";

try {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("pdfjs-dist/build/pdf.worker.min.mjs", import.meta.url).toString();
} catch { /* pdf.js reports unsupported worker configuration when opened */ }

export interface PdfOcrProgress {
  page: number;
  pageCount: number;
  percent: number;
}

/** OCR a PDF in the page context; service workers delegate here because they cannot spawn Web Workers. */
export async function recognizePdfWithOcr(
  blob: Blob,
  onProgress?: (progress: PdfOcrProgress) => void,
  pagesToRecognize?: number[],
): Promise<{ text: string; pageCount: number; pageTexts: string[] }> {
  if (!blob || blob.size < 8) throw new Error("The PDF is empty or invalid.");
  if (blob.size > 150 * 1024 * 1024) throw new Error("This PDF is larger than the 150 MB OCR limit.");

  let pdf: any;
  let worker: Awaited<ReturnType<typeof createWorker>> | undefined;
  let currentPageNo = 1;
  let lastReportedPercent = -1;
  let lastReportedAt = 0;
  const reportProgress = (page: number, pageCount: number, percent: number, force = false) => {
    const boundedPercent = Math.max(0, Math.min(100, Math.round(percent)));
    const now = Date.now();
    if (force || boundedPercent > lastReportedPercent && now - lastReportedAt >= 350) {
      lastReportedPercent = boundedPercent;
      lastReportedAt = now;
      onProgress?.({ page, pageCount, percent: boundedPercent });
    }
  };
  try {
    pdf = await pdfjsLib.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) }).promise;
    const pageCount = Number(pdf.numPages) || 0;
    if (pageCount > 500) throw new Error(`OCR is limited to 500 pages at a time; this PDF has ${pageCount}.`);
    if (!pageCount) throw new Error("No pages were found in this PDF.");

    worker = await createWorker("eng", 1, {
      workerPath: tesseractWorkerUrl,
      workerBlobURL: false,
      logger: (event: any) => {
        if (event?.status === "recognizing text" && Number.isFinite(event.progress)) {
          const percent = Math.round(((targetPages.indexOf(currentPageNo) + event.progress) / targetPages.length) * 100);
          reportProgress(targetPages.indexOf(currentPageNo) + 1, targetPages.length, percent);
        }
      },
    });
    await worker.setParameters({ preserve_interword_spaces: "1" });

    const pageTexts: string[] = new Array(pageCount).fill("");
    const targetPages = [...new Set((pagesToRecognize?.length ? pagesToRecognize : Array.from({ length: pageCount }, (_, i) => i + 1)))]
      .filter((pageNo) => Number.isInteger(pageNo) && pageNo >= 1 && pageNo <= pageCount)
      .sort((a, b) => a - b);
    if (!targetPages.length) throw new Error("No PDF pages were selected for OCR.");
    if (targetPages.length > 500) throw new Error(`OCR is limited to 500 pages per conversion; ${targetPages.length} pages need OCR.`);
    for (let pageIndex = 0; pageIndex < targetPages.length; pageIndex++) {
      const pageNo = targetPages[pageIndex];
      currentPageNo = pageNo;
      const page = await pdf.getPage(pageNo);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2.4, 2400 / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale: Math.max(1.5, scale) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error(`Could not prepare PDF page ${pageNo} for OCR.`);
      context.fillStyle = "#fff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const result = await worker.recognize(canvas);
      pageTexts[pageNo - 1] = String(result.data.text || "").replace(/\r/g, "").trim();
      page.cleanup?.();
      canvas.width = 1;
      canvas.height = 1;
      reportProgress(pageIndex + 1, targetPages.length, (pageIndex + 1) / targetPages.length * 100, true);
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    }
    const text = pageTexts.filter(Boolean).join("\n\n").trim();
    const recognizedText = targetPages.map((pageNo) => pageTexts[pageNo - 1]).filter(Boolean).join("\n\n").trim();
    if (recognizedText.replace(/[^\p{L}\p{N}]/gu, "").length < 20) {
      throw new Error("OCR could not recognize enough readable text. Try a clearer scan or a higher-resolution PDF.");
    }
    return { text, pageCount, pageTexts };
  } finally {
    await worker?.terminate().catch(() => undefined);
    await pdf?.destroy?.().catch(() => undefined);
  }
}
