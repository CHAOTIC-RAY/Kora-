import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpen,
  Download,
  FileText,
  Files,
  Loader2,
  RotateCw,
  Scissors,
  Sparkles,
  Type,
} from "lucide-react";
import { toast } from "react-hot-toast";
import type { BookMetadata } from "../lib/firebase";
import { loadBookHighlights } from "../lib/firebase";
import { downloadMarkdown, highlightsToMarkdown } from "../lib/annotationsExport";
import {
  buildEpubFromText,
  downloadBlob,
  epubToPlainText,
  inspectEpub,
  patchEpubMetadata,
  slugifyFilename,
  type EpubInspectInfo,
} from "../lib/epubTools";
import {
  extractPdfPages,
  inspectPdf,
  mergePdfs,
  rotatePdf,
  stampPdfPageNumbers,
} from "../lib/pdfTools";

type ToolId =
  | "epub-text"
  | "text-epub"
  | "epub-meta"
  | "pdf-merge"
  | "pdf-rotate"
  | "pdf-split"
  | "pdf-stamp"
  | "highlights";

const TOOLS: Array<{
  id: ToolId;
  label: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  group: "epub" | "pdf" | "library";
}> = [
  { id: "epub-text", label: "EPUB → Text", desc: "Extract readable plain text", icon: FileText, group: "epub" },
  { id: "text-epub", label: "Text → EPUB", desc: "Build an ebook from text", icon: BookOpen, group: "epub" },
  { id: "epub-meta", label: "EPUB Metadata", desc: "Edit title & author", icon: Type, group: "epub" },
  { id: "pdf-merge", label: "Merge PDFs", desc: "Combine multiple PDFs", icon: Files, group: "pdf" },
  { id: "pdf-rotate", label: "Rotate PDF", desc: "Turn pages 90° / 180°", icon: RotateCw, group: "pdf" },
  { id: "pdf-split", label: "Split PDF", desc: "Extract a page range", icon: Scissors, group: "pdf" },
  { id: "pdf-stamp", label: "Page Numbers", desc: "Stamp 1 / N on every page", icon: Sparkles, group: "pdf" },
  { id: "highlights", label: "Export Highlights", desc: "Markdown from your library", icon: Download, group: "library" },
];

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function FilePicker({
  accept,
  multiple,
  label,
  onFiles,
}: {
  accept: string;
  multiple?: boolean;
  label: string;
  onFiles: (files: File[]) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        className="hidden"
        onChange={(e) => {
          const list = Array.from(e.target.files || []);
          if (list.length) onFiles(list);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        onClick={() => ref.current?.click()}
        className="w-full px-3 py-2.5 rounded-xl border border-dashed border-kindle-border bg-kindle-bg text-[10px] font-bold uppercase tracking-wider text-kindle-text hover:border-kindle-text/40 transition"
      >
        {label}
      </button>
    </div>
  );
}

interface EbookToolsPanelProps {
  userId?: string;
  books?: BookMetadata[];
}

export default function EbookToolsPanel({ userId = "", books = [] }: EbookToolsPanelProps) {
  const [active, setActive] = useState<ToolId>("epub-text");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  // Shared EPUB inspect/meta state
  const [epubInfo, setEpubInfo] = useState<EpubInspectInfo | null>(null);
  const [epubFile, setEpubFile] = useState<File | null>(null);
  const [metaTitle, setMetaTitle] = useState("");
  const [metaCreator, setMetaCreator] = useState("");
  const [metaLanguage, setMetaLanguage] = useState("en");

  // Text → EPUB
  const [draftTitle, setDraftTitle] = useState("");
  const [draftAuthor, setDraftAuthor] = useState("");
  const [draftBody, setDraftBody] = useState("");

  // PDF
  const [pdfFiles, setPdfFiles] = useState<File[]>([]);
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pdfInfo, setPdfInfo] = useState<{ pageCount: number; title: string; author: string; sizeBytes: number } | null>(null);
  const [rotateAngle, setRotateAngle] = useState<90 | 180 | 270>(90);
  const [fromPage, setFromPage] = useState(1);
  const [toPage, setToPage] = useState(1);

  useEffect(() => {
    const onFocus = (event: Event) => {
      const detail = (event as CustomEvent<string>).detail;
      if (detail === "epub-tools") setActive("epub-text");
      else if (detail === "pdf-tools") setActive("pdf-merge");
      else if (detail === "highlights") setActive("highlights");
    };
    window.addEventListener("kora-tools-focus", onFocus);
    return () => window.removeEventListener("kora-tools-focus", onFocus);
  }, []);

  const activeTool = useMemo(() => TOOLS.find((t) => t.id === active) || TOOLS[0], [active]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setStatus(null);
    try {
      await fn();
    } catch (err) {
      console.error(err);
      const message = (err as Error).message || "Tool failed.";
      setStatus(message);
      toast.error(message);
    } finally {
      setBusy(false);
    }
  };

  const loadEpubForMeta = async (file: File) => {
    await run(async () => {
      const info = await inspectEpub(file);
      setEpubFile(file);
      setEpubInfo(info);
      setMetaTitle(info.title);
      setMetaCreator(info.creator);
      setMetaLanguage(info.language || "en");
      setStatus(`${info.title} · ${info.chapterCount} chapters · ${info.wordCount.toLocaleString()} words`);
    });
  };

  const loadPdf = async (file: File) => {
    await run(async () => {
      const info = await inspectPdf(file);
      setPdfFile(file);
      setPdfInfo(info);
      setFromPage(1);
      setToPage(info.pageCount);
      setStatus(`${info.title} · ${info.pageCount} pages · ${formatBytes(info.sizeBytes)}`);
    });
  };

  return (
    <section className="bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-4">
      <div className="flex items-start gap-3">
        <div className="p-2 rounded-xl bg-kindle-bg border border-kindle-border shrink-0">
          <activeTool.icon className="w-4 h-4 text-kindle-accent" />
        </div>
        <div className="min-w-0">
          <h3 className="text-[11px] font-bold uppercase tracking-wider text-kindle-text">Ebook & PDF Tools</h3>
          <p className="text-[10px] text-kindle-text-muted leading-relaxed mt-0.5">
            Convert, inspect, and repair files on-device — nothing is uploaded.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {TOOLS.map((tool) => {
          const Icon = tool.icon;
          const selected = active === tool.id;
          return (
            <button
              key={tool.id}
              type="button"
              onClick={() => {
                setActive(tool.id);
                setStatus(null);
              }}
              className={`text-left rounded-xl border p-3 transition ${
                selected
                  ? "border-kindle-text bg-kindle-text text-kindle-bg shadow-sm"
                  : "border-kindle-border bg-kindle-bg hover:border-kindle-text/30"
              }`}
            >
              <Icon className={`w-3.5 h-3.5 mb-1.5 ${selected ? "text-kindle-bg" : "text-kindle-accent"}`} />
              <p className="text-[10px] font-bold uppercase tracking-wider leading-tight">{tool.label}</p>
              <p className={`text-[9px] mt-0.5 leading-snug ${selected ? "text-kindle-bg/75" : "text-kindle-text-muted"}`}>
                {tool.desc}
              </p>
            </button>
          );
        })}
      </div>

      <div className="rounded-xl border border-kindle-border bg-kindle-bg/50 p-4 space-y-3">
        {active === "epub-text" && (
          <>
            <FilePicker
              accept=".epub,application/epub+zip"
              label="Choose EPUB"
              onFiles={(files) =>
                void run(async () => {
                  const file = files[0];
                  const { title, text } = await epubToPlainText(file);
                  downloadBlob(slugifyFilename(title, "txt"), new Blob([text], { type: "text/plain;charset=utf-8" }));
                  setStatus(`Exported ${title} (${text.length.toLocaleString()} characters)`);
                  toast.success("Text exported");
                })
              }
            />
          </>
        )}

        {active === "text-epub" && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                value={draftTitle}
                onChange={(e) => setDraftTitle(e.target.value)}
                placeholder="Title"
                className="w-full px-3 py-2 rounded-xl border border-kindle-border bg-kindle-card text-sm text-kindle-text"
              />
              <input
                value={draftAuthor}
                onChange={(e) => setDraftAuthor(e.target.value)}
                placeholder="Author"
                className="w-full px-3 py-2 rounded-xl border border-kindle-border bg-kindle-card text-sm text-kindle-text"
              />
            </div>
            <textarea
              value={draftBody}
              onChange={(e) => setDraftBody(e.target.value)}
              placeholder="Paste chapter text. Separate chapters with a line that says CHAPTER 2 (or just paste one chapter)."
              rows={8}
              className="w-full px-3 py-2 rounded-xl border border-kindle-border bg-kindle-card text-sm text-kindle-text resize-y min-h-[10rem]"
            />
            <div className="flex flex-wrap gap-2">
              <FilePicker
                accept=".txt,.md,.html,.htm,text/plain,text/markdown,text/html"
                label="Import .txt / .md / .html"
                onFiles={(files) =>
                  void run(async () => {
                    const file = files[0];
                    const raw = await file.text();
                    setDraftBody(raw);
                    if (!draftTitle) setDraftTitle(file.name.replace(/\.[^.]+$/, ""));
                    setStatus(`Loaded ${file.name}`);
                  })
                }
              />
              <button
                type="button"
                disabled={busy || !draftBody.trim()}
                onClick={() =>
                  void run(async () => {
                    const parts = draftBody
                      .replace(/\r\n/g, "\n")
                      .split(/\n(?=chapter\s+\d+|CHAPTER\s+\d+)/i)
                      .map((part) => part.trim())
                      .filter(Boolean);
                    const chapters =
                      parts.length > 1
                        ? parts.map((part, i) => {
                            const lines = part.split("\n");
                            const maybeTitle = lines[0]?.trim() || `Chapter ${i + 1}`;
                            const body = lines.slice(1).join("\n").trim() || part;
                            return { title: maybeTitle.slice(0, 80), text: body };
                          })
                        : [{ title: draftTitle.trim() || "Chapter 1", text: draftBody }];
                    const blob = await buildEpubFromText({
                      title: draftTitle.trim() || "Untitled",
                      creator: draftAuthor.trim() || "Kora",
                      chapters,
                    });
                    downloadBlob(slugifyFilename(draftTitle || "kora-book", "epub"), blob);
                    setStatus(`Built EPUB with ${chapters.length} chapter${chapters.length === 1 ? "" : "s"}`);
                    toast.success("EPUB ready");
                  })
                }
                className="px-3 py-2.5 rounded-xl bg-kindle-text text-kindle-bg text-[10px] font-bold uppercase tracking-wider disabled:opacity-50"
              >
                Build EPUB
              </button>
            </div>
          </>
        )}

        {active === "epub-meta" && (
          <>
            <FilePicker accept=".epub,application/epub+zip" label="Choose EPUB to inspect / edit" onFiles={(files) => void loadEpubForMeta(files[0])} />
            {epubInfo && (
              <div className="space-y-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
                  <div className="rounded-xl border border-kindle-border bg-kindle-card p-2">
                    <p className="text-sm font-bold font-lexend">{epubInfo.chapterCount}</p>
                    <p className="text-[9px] uppercase tracking-widest text-kindle-text-muted">Chapters</p>
                  </div>
                  <div className="rounded-xl border border-kindle-border bg-kindle-card p-2">
                    <p className="text-sm font-bold font-lexend">{epubInfo.wordCount.toLocaleString()}</p>
                    <p className="text-[9px] uppercase tracking-widest text-kindle-text-muted">Words</p>
                  </div>
                  <div className="rounded-xl border border-kindle-border bg-kindle-card p-2">
                    <p className="text-sm font-bold font-lexend">{epubInfo.fileCount}</p>
                    <p className="text-[9px] uppercase tracking-widest text-kindle-text-muted">Files</p>
                  </div>
                  <div className="rounded-xl border border-kindle-border bg-kindle-card p-2">
                    <p className="text-sm font-bold font-lexend">{formatBytes(epubInfo.sizeBytes)}</p>
                    <p className="text-[9px] uppercase tracking-widest text-kindle-text-muted">Size</p>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  <input value={metaTitle} onChange={(e) => setMetaTitle(e.target.value)} placeholder="Title" className="px-3 py-2 rounded-xl border border-kindle-border bg-kindle-card text-sm" />
                  <input value={metaCreator} onChange={(e) => setMetaCreator(e.target.value)} placeholder="Author" className="px-3 py-2 rounded-xl border border-kindle-border bg-kindle-card text-sm" />
                  <input value={metaLanguage} onChange={(e) => setMetaLanguage(e.target.value)} placeholder="Language" className="px-3 py-2 rounded-xl border border-kindle-border bg-kindle-card text-sm" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busy || !epubFile}
                    onClick={() =>
                      void run(async () => {
                        if (!epubFile) return;
                        const blob = await patchEpubMetadata(epubFile, {
                          title: metaTitle,
                          creator: metaCreator,
                          language: metaLanguage,
                        });
                        downloadBlob(slugifyFilename(metaTitle || epubFile.name.replace(/\.epub$/i, ""), "epub"), blob);
                        toast.success("Metadata saved into new EPUB");
                        setStatus("Downloaded updated EPUB");
                      })
                    }
                    className="px-3 py-2.5 rounded-xl bg-kindle-text text-kindle-bg text-[10px] font-bold uppercase tracking-wider disabled:opacity-50"
                  >
                    Save metadata EPUB
                  </button>
                  {epubInfo.coverBytes && (
                    <button
                      type="button"
                      onClick={() => {
                        const mime = epubInfo.coverMime || "image/jpeg";
                        const ext = mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : "jpg";
                        downloadBlob(slugifyFilename(metaTitle || "cover", ext), new Blob([new Uint8Array(epubInfo.coverBytes!)], { type: mime }));
                        toast.success("Cover downloaded");
                      }}
                      className="px-3 py-2.5 rounded-xl border border-kindle-border text-[10px] font-bold uppercase tracking-wider"
                    >
                      Download cover
                    </button>
                  )}
                </div>
              </div>
            )}
          </>
        )}

        {active === "pdf-merge" && (
          <>
            <FilePicker
              accept="application/pdf,.pdf"
              multiple
              label="Choose PDFs to merge"
              onFiles={(files) => {
                setPdfFiles(files);
                setStatus(`${files.length} file${files.length === 1 ? "" : "s"} selected`);
              }}
            />
            {pdfFiles.length > 0 && (
              <ul className="text-[10px] text-kindle-text-muted space-y-1 font-mono">
                {pdfFiles.map((f) => (
                  <li key={`${f.name}-${f.size}`}>{f.name} · {formatBytes(f.size)}</li>
                ))}
              </ul>
            )}
            <button
              type="button"
              disabled={busy || pdfFiles.length < 2}
              onClick={() =>
                void run(async () => {
                  const blob = await mergePdfs(pdfFiles);
                  downloadBlob(slugifyFilename("merged", "pdf"), blob);
                  toast.success("Merged PDF downloaded");
                  setStatus(`Merged ${pdfFiles.length} PDFs`);
                })
              }
              className="px-3 py-2.5 rounded-xl bg-kindle-text text-kindle-bg text-[10px] font-bold uppercase tracking-wider disabled:opacity-50"
            >
              Merge & download
            </button>
          </>
        )}

        {(active === "pdf-rotate" || active === "pdf-split" || active === "pdf-stamp") && (
          <>
            <FilePicker accept="application/pdf,.pdf" label="Choose PDF" onFiles={(files) => void loadPdf(files[0])} />
            {pdfInfo && pdfFile && (
              <div className="space-y-3">
                <p className="text-[10px] text-kindle-text-muted">
                  {pdfInfo.title} · {pdfInfo.pageCount} pages · {formatBytes(pdfInfo.sizeBytes)}
                </p>
                {active === "pdf-rotate" && (
                  <div className="flex flex-wrap items-center gap-2">
                    {([90, 180, 270] as const).map((angle) => (
                      <button
                        key={angle}
                        type="button"
                        onClick={() => setRotateAngle(angle)}
                        className={`px-3 py-2 rounded-xl border text-[10px] font-bold uppercase tracking-wider ${
                          rotateAngle === angle
                            ? "bg-kindle-text text-kindle-bg border-kindle-text"
                            : "border-kindle-border text-kindle-text-muted"
                        }`}
                      >
                        {angle}°
                      </button>
                    ))}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const blob = await rotatePdf(pdfFile, rotateAngle);
                          downloadBlob(slugifyFilename(pdfFile.name.replace(/\.pdf$/i, "") + `-rot${rotateAngle}`, "pdf"), blob);
                          toast.success(`Rotated ${rotateAngle}°`);
                        })
                      }
                      className="px-3 py-2.5 rounded-xl bg-kindle-text text-kindle-bg text-[10px] font-bold uppercase tracking-wider disabled:opacity-50"
                    >
                      Rotate & download
                    </button>
                  </div>
                )}
                {active === "pdf-split" && (
                  <div className="flex flex-wrap items-end gap-2">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted">
                      From
                      <input
                        type="number"
                        min={1}
                        max={pdfInfo.pageCount}
                        value={fromPage}
                        onChange={(e) => setFromPage(Number(e.target.value) || 1)}
                        className="mt-1 block w-20 px-2 py-2 rounded-xl border border-kindle-border bg-kindle-card text-sm"
                      />
                    </label>
                    <label className="text-[10px] font-bold uppercase tracking-wider text-kindle-text-muted">
                      To
                      <input
                        type="number"
                        min={1}
                        max={pdfInfo.pageCount}
                        value={toPage}
                        onChange={(e) => setToPage(Number(e.target.value) || 1)}
                        className="mt-1 block w-20 px-2 py-2 rounded-xl border border-kindle-border bg-kindle-card text-sm"
                      />
                    </label>
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          const blob = await extractPdfPages(pdfFile, fromPage, toPage);
                          downloadBlob(
                            slugifyFilename(`${pdfFile.name.replace(/\.pdf$/i, "")}-p${fromPage}-${toPage}`, "pdf"),
                            blob
                          );
                          toast.success(`Extracted pages ${fromPage}–${toPage}`);
                        })
                      }
                      className="px-3 py-2.5 rounded-xl bg-kindle-text text-kindle-bg text-[10px] font-bold uppercase tracking-wider disabled:opacity-50"
                    >
                      Extract & download
                    </button>
                  </div>
                )}
                {active === "pdf-stamp" && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const blob = await stampPdfPageNumbers(pdfFile);
                        downloadBlob(slugifyFilename(pdfFile.name.replace(/\.pdf$/i, "") + "-numbered", "pdf"), blob);
                        toast.success("Page numbers stamped");
                      })
                    }
                    className="px-3 py-2.5 rounded-xl bg-kindle-text text-kindle-bg text-[10px] font-bold uppercase tracking-wider disabled:opacity-50"
                  >
                    Stamp page numbers
                  </button>
                )}
              </div>
            )}
          </>
        )}

        {active === "highlights" && (
          <>
            <p className="text-[10px] text-kindle-text-muted leading-relaxed">
              Export highlights from books already in your library as Markdown files.
            </p>
            {books.length === 0 ? (
              <p className="text-xs text-kindle-text-muted italic">No books in library yet.</p>
            ) : (
              <div className="max-h-56 overflow-y-auto space-y-1.5 pr-1">
                {books.slice(0, 40).map((book) => (
                  <button
                    key={book.id}
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const highlights = await loadBookHighlights(userId, book.id);
                        const md = highlightsToMarkdown({ book, highlights });
                        downloadMarkdown(slugifyFilename(book.title || "highlights", "md"), md);
                        toast.success(
                          highlights.length
                            ? `Exported ${highlights.length} highlight${highlights.length === 1 ? "" : "s"}`
                            : "Exported empty highlights file"
                        );
                        setStatus(book.title);
                      })
                    }
                    className="w-full text-left px-3 py-2 rounded-xl border border-kindle-border bg-kindle-card hover:border-kindle-text/30 transition"
                  >
                    <p className="text-xs font-bold text-kindle-text truncate">{book.title}</p>
                    <p className="text-[9px] text-kindle-text-muted truncate">{book.author || "Unknown author"}</p>
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {(busy || status) && (
          <div className="flex items-center gap-2 text-[10px] text-kindle-text-muted">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" /> : null}
            <p className="leading-snug">{busy ? "Working…" : status}</p>
          </div>
        )}
      </div>
    </section>
  );
}
