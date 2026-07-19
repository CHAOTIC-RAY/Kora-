import React, { useRef, useState } from "react";
import { BookOpen, CheckCircle2, Headphones, Loader2, Volume2, Wand2 } from "lucide-react";
import { BookMetadata } from "../lib/firebase";
import { getEligibleConverterBooks, loadCachedBookBlob } from "../lib/audiobookConverterImport";
import { createBrowserTtsAudiobook, extractBookChapters } from "../lib/browserTtsAudiobook";
import { estimateSpeechDurationSeconds } from "../lib/epubTextExtract";
import { getTtsSettings } from "../lib/ttsSettings";
import TtsVoiceSettings from "./TtsVoiceSettings";

interface BuiltInAudiobookConverterProps {
  books: BookMetadata[];
  userId?: string;
  onRefreshLibrary?: (uid?: string) => void;
}

const BUILTIN_EXTENSIONS = new Set(["epub", "txt"]);

export default function BuiltInAudiobookConverter({
  books,
  userId,
  onRefreshLibrary,
}: BuiltInAudiobookConverterProps) {
  const [selectedBookId, setSelectedBookId] = useState("");
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState<{ message: string; percent: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccess, setLastSuccess] = useState<string | null>(null);
  const abortRef = useRef(false);

  const eligibleBooks = getEligibleConverterBooks(books).filter((book) =>
    BUILTIN_EXTENSIONS.has((book.extension || "").toLowerCase())
  );
  const selectedBook = eligibleBooks.find((book) => book.id === selectedBookId);
  const ttsSettings = getTtsSettings();

  const handleConvert = async () => {
    if (!selectedBook) return;
    setConverting(true);
    setError(null);
    setLastSuccess(null);
    abortRef.current = false;
    setProgress({ message: "Loading book file…", percent: 5 });

    try {
      const { blob, fileName } = await loadCachedBookBlob(selectedBook);
      const ext = (selectedBook.extension || fileName.split(".").pop() || "epub").toLowerCase();
      if (abortRef.current) throw new Error("Cancelled");

      setProgress({ message: "Extracting chapters…", percent: 15 });
      const chapters = await extractBookChapters(blob, ext, selectedBook.title);
      if (abortRef.current) throw new Error("Cancelled");

      const estimatedMinutes = Math.round(
        chapters.reduce((sum, chapter) => sum + estimateSpeechDurationSeconds(chapter.text), 0) / 60
      );

      setProgress({ message: "Preparing read-aloud audiobook…", percent: 25 });
      const entry = await createBrowserTtsAudiobook({
        sourceBook: selectedBook,
        chapters,
        userId,
        onRefreshLibrary,
        pregenerate: ttsSettings.generationMode === "pregenerate" || ttsSettings.qualityPreset === "studio",
        onProgress: (message, percent) => setProgress({ message, percent: 25 + Math.round(percent * 0.7) }),
      });

      setProgress({ message: "Done", percent: 100 });
      setLastSuccess(
        `Added "${entry.title}" with ${chapters.length} chapter(s). Estimated listen time ~${estimatedMinutes} min using ${ttsSettings.voiceName || "your device voice"}.`
      );
    } catch (err) {
      if ((err as Error).message === "Cancelled") {
        setError("Conversion cancelled.");
      } else {
        setError((err as Error).message || "Could not create read-aloud audiobook.");
      }
    } finally {
      setConverting(false);
    }
  };

  return (
    <div className="md:col-span-3 bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-4">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Wand2 className="w-4 h-4 text-kindle-accent" />
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-kindle-text">
              Read Aloud — Built-in Audiobook
            </h4>
          </div>
          <p className="text-[10px] text-kindle-text-muted leading-relaxed max-w-2xl">
            Turn EPUB or TXT books into audiobooks using your browser&apos;s built-in text-to-speech. No servers,
            APIs, or extra apps required — everything stays on your device.
          </p>
        </div>
        <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-500/10 px-2 py-1 rounded-full border border-emerald-500/20 shrink-0">
          <CheckCircle2 className="w-3 h-3" />
          Ready
        </span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted flex items-center gap-1">
              <Headphones className="w-3 h-3" />
              Source Book (cached offline)
            </label>
            <select
              value={selectedBookId}
              onChange={(e) => setSelectedBookId(e.target.value)}
              disabled={converting || !eligibleBooks.length}
              className="w-full text-[11px] bg-kindle-bg border border-kindle-border rounded-lg px-3 py-2"
            >
              <option value="">
                {eligibleBooks.length ? "Select a book…" : "No EPUB/TXT books in library"}
              </option>
              {eligibleBooks.map((book) => (
                <option key={book.id} value={book.id}>
                  {book.title} — {book.author} ({book.extension?.toUpperCase()})
                </option>
              ))}
            </select>
          </div>

          <div className="rounded-xl border border-kindle-border bg-kindle-bg/60 px-3 py-2.5 space-y-1">
            <p className="text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted flex items-center gap-1">
              <Volume2 className="w-3 h-3" />
              Playback modes
            </p>
            <ul className="text-[9px] text-kindle-text-muted leading-relaxed space-y-0.5">
              <li>• Instant — live system voice</li>
              <li>• Balanced — prepared text + smoother pauses</li>
              <li>• Studio — pre-generate chapter timing cache locally</li>
            </ul>
          </div>
        </div>

        <TtsVoiceSettings showQualityPresets showGenerationMode showTestButton />
      </div>

      {progress && converting && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider">
            <span className="text-kindle-text-muted">{progress.message}</span>
            <span className="text-kindle-accent">{progress.percent}%</span>
          </div>
          <div className="h-1.5 bg-kindle-bg rounded-full overflow-hidden border border-kindle-border">
            <div className="h-full bg-kindle-accent transition-all duration-300" style={{ width: `${progress.percent}%` }} />
          </div>
        </div>
      )}

      {error && (
        <p className="text-[9px] text-red-500 font-medium bg-red-500/5 border border-red-500/10 rounded-lg px-3 py-2">
          {error}
        </p>
      )}
      {lastSuccess && (
        <p className="text-[9px] text-emerald-600 font-medium bg-emerald-500/5 border border-emerald-500/10 rounded-lg px-3 py-2">
          {lastSuccess}
        </p>
      )}

      <div className="flex gap-2">
        {!converting ? (
          <button
            onClick={handleConvert}
            disabled={!selectedBook}
            className="flex-1 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-wider py-2.5 rounded-xl bg-kindle-text text-kindle-bg hover:opacity-90 transition disabled:opacity-40"
          >
            <BookOpen className="w-3.5 h-3.5" />
            Create Read-Aloud Audiobook
          </button>
        ) : (
          <button
            onClick={() => {
              abortRef.current = true;
            }}
            className="flex-1 text-[10px] font-bold uppercase tracking-wider py-2.5 rounded-xl border border-red-500/30 text-red-500 hover:bg-red-500/5 transition"
          >
            Cancel
          </button>
        )}
        {converting && (
          <div className="flex items-center gap-2 px-4 text-[9px] text-kindle-text-muted font-bold uppercase tracking-wider">
            <Loader2 className="w-4 h-4 animate-spin text-kindle-accent" />
            Working…
          </div>
        )}
      </div>
    </div>
  );
}
