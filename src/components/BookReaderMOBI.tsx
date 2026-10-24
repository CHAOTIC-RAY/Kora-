import { useEffect, useState } from "react";
import DOMPurify from "dompurify";
import { AlertCircle, ArrowLeft, RefreshCw } from "lucide-react";
import { getBookFile } from "../db/indexedDB";
import KoraLoading from "./KoraLoading";
import BookReaderText from "./BookReaderText";

interface BookReaderMOBIProps {
  book: any;
  onClose: () => void;
  readerPrefs?: any;
  onReaderPrefsChange?: (prefs: any) => void;
}

/** Reads DRM-free MOBI/PalmDOC text, then uses Kora's existing text reader UI. */
export default function BookReaderMOBI({ book, onClose, readerPrefs, onReaderPrefsChange }: BookReaderMOBIProps) {
  const [html, setHtml] = useState<string | null>(null);
  const [title, setTitle] = useState(String(book.title || ""));
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let current = true;
    setHtml(null);
    setError("");

    void (async () => {
      try {
        const stored = await getBookFile(book.id);
        if (!stored) throw new Error("This MOBI file is not cached locally. Download or import it again to read it.");

        const { parseMobiBytes } = await import("../lib/formats/mobiReader");
        const parsed = parseMobiBytes(new Uint8Array(await stored.blob.arrayBuffer()), stored.fileName || `${book.title || "book"}.mobi`);
        if (!current) return;

        const escapedText = parsed.text.replace(/[&<>]/g, (char) => char === "&" ? "&amp;" : char === "<" ? "&lt;" : "&gt;");
        const sourceHtml = parsed.text.trimStart().startsWith("<")
          ? parsed.text
          : `<html><body><pre>${escapedText}</pre></body></html>`;
        setHtml(DOMPurify.sanitize(sourceHtml, { USE_PROFILES: { html: true } }));
        setTitle(parsed.meta.title || String(book.title || ""));
      } catch (cause) {
        if (!current) return;
        if (cause instanceof Error) setError(cause.message);
        else setError("Kora could not read this MOBI file.");
      }
    })();

    return () => { current = false; };
  }, [book.id, attempt]);

  if (html !== null) {
    return (
      <BookReaderText
        book={{ ...book, title, extension: "html" }}
        contentOverride={html}
        readerPrefs={readerPrefs}
        onReaderPrefsChange={onReaderPrefsChange}
        onClose={onClose}
      />
    );
  }

  if (!error) {
    return <div className="fixed inset-0 z-[100] flex items-center justify-center bg-kindle-bg"><KoraLoading context="MOBI book" /></div>;
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-kindle-bg p-5 text-kindle-text">
      <div className="w-full max-w-md space-y-5 rounded-3xl border border-kindle-border bg-kindle-card p-7 text-center shadow-2xl">
        <button onClick={onClose} className="mb-2 inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-kindle-text-muted hover:text-kindle-text">
          <ArrowLeft className="h-4 w-4" /> Back to library
        </button>
        <AlertCircle className="mx-auto h-9 w-9 text-amber-500" />
        <h2 className="text-xl font-bold">{book.title || "MOBI book"}</h2>
        <p className="text-sm text-kindle-text-muted">{error}</p>
        <button onClick={() => setAttempt((value) => value + 1)} className="mx-auto inline-flex items-center gap-2 rounded-xl border border-kindle-border px-4 py-2 text-xs font-bold uppercase tracking-wider hover:bg-kindle-bg">
          <RefreshCw className="h-3.5 w-3.5" /> Try again
        </button>
      </div>
    </div>
  );
}
