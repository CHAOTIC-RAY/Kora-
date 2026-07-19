import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Headphones,
  Loader2,
  RefreshCw,
  Server,
  Wand2,
} from "lucide-react";
import { BookMetadata, syncBookToCloud } from "../lib/firebase";
import { getBookFile } from "../db/indexedDB";
import { storeAudiobookTrack } from "../lib/audiobookStorage";
import {
  CastwrightModelKey,
  ConversionProgress,
  checkCastwrightHealth,
  convertBookWithCastwright,
  getCastwrightUrl,
  setCastwrightUrl,
} from "../lib/castwrightClient";

const SUPPORTED_EXTENSIONS = new Set(["epub", "pdf", "mobi", "azw3", "txt"]);
const MODEL_OPTIONS: { id: CastwrightModelKey; label: string }[] = [
  { id: "kokoro-v1", label: "Kokoro (local, recommended)" },
  { id: "qwen3-tts-0.6b", label: "Qwen 0.6B (fast)" },
  { id: "qwen3-tts-1.7b", label: "Qwen 1.7B (quality)" },
  { id: "coqui-xtts-v2", label: "Coqui XTTS" },
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
  { id: "gemini-3.1-flash", label: "Gemini 3.1 Flash" },
];

interface CastwrightConverterProps {
  books: BookMetadata[];
  userId?: string;
  onRefreshLibrary?: (uid?: string) => void;
}

export default function CastwrightConverter({
  books,
  userId,
  onRefreshLibrary,
}: CastwrightConverterProps) {
  const [serverUrl, setServerUrl] = useState(getCastwrightUrl);
  const [selectedBookId, setSelectedBookId] = useState("");
  const [modelKey, setModelKey] = useState<CastwrightModelKey>("kokoro-v1");
  const [healthStatus, setHealthStatus] = useState<"unknown" | "ok" | "error">("unknown");
  const [healthDetail, setHealthDetail] = useState<string | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState<ConversionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccess, setLastSuccess] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const eligibleBooks = useMemo(
    () =>
      books.filter(
        (b) =>
          b.extension?.toLowerCase() !== "audiobook" &&
          SUPPORTED_EXTENSIONS.has((b.extension || "").toLowerCase())
      ),
    [books]
  );

  const selectedBook = eligibleBooks.find((b) => b.id === selectedBookId);

  const runHealthCheck = useCallback(async (url = serverUrl) => {
    setCheckingHealth(true);
    setHealthDetail(null);
    const result = await checkCastwrightHealth(url);
    setHealthStatus(result.ok ? "ok" : "error");
    setHealthDetail(result.detail || null);
    setCheckingHealth(false);
  }, [serverUrl]);

  useEffect(() => {
    runHealthCheck();
  }, [runHealthCheck]);

  const handleSaveUrl = () => {
    setCastwrightUrl(serverUrl);
    runHealthCheck(serverUrl);
  };

  const handleUseDevProxy = () => {
    const proxyUrl = "/castwright-api";
    setServerUrl(proxyUrl);
    setCastwrightUrl(proxyUrl);
    runHealthCheck(proxyUrl);
  };

  const handleConvert = async () => {
    if (!selectedBook) return;
    setConverting(true);
    setError(null);
    setLastSuccess(null);
    setProgress({ stage: "importing", message: "Starting…", percent: 0 });
    abortRef.current = new AbortController();

    try {
      const cached = await getBookFile(selectedBook.id);
      if (!cached?.blob) {
        throw new Error("Book file is not cached offline. Open the book once to download it, then retry.");
      }

      const ext = (selectedBook.extension || "epub").toLowerCase();
      const fileName = cached.fileName || `${selectedBook.title}.${ext}`;

      const { tracks } = await convertBookWithCastwright({
        file: cached.blob,
        fileName,
        title: selectedBook.title,
        author: selectedBook.author || "Unknown",
        modelKey,
        baseUrl: serverUrl,
        signal: abortRef.current.signal,
        onProgress: setProgress,
      });

      const audiobookId = `${selectedBook.id}-audiobook`;
      for (const track of tracks) {
        await storeAudiobookTrack(audiobookId, track.index, track.title, track.blob);
      }

      const audiobookTracks = tracks.map((t) => ({
        index: t.index,
        title: t.title,
        src: `castwright://${audiobookId}/${t.index}`,
      }));

      const audiobookEntry: BookMetadata = {
        id: audiobookId,
        title: `${selectedBook.title} (Audiobook)`,
        author: selectedBook.author || "Unknown",
        coverUrl: selectedBook.coverUrl,
        extension: "audiobook",
        size: "",
        tags: ["audiobook", "castwright", ...(selectedBook.tags || []).filter((t) => t !== "audiobook")],
        status: "to-read",
        progress: { percent: 0, lastReadTime: Date.now() },
        dateAdded: Date.now(),
        source: "castwright",
        description: `Converted from "${selectedBook.title}" using Castwright.`,
        audiobookTracks,
        audiobookDownloaded: true,
      };

      await syncBookToCloud(userId || "", audiobookEntry);
      onRefreshLibrary?.(userId);
      setLastSuccess(`Added "${audiobookEntry.title}" with ${tracks.length} chapters.`);
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        setError("Conversion cancelled.");
      } else {
        setError((err as Error).message || "Conversion failed.");
      }
    } finally {
      setConverting(false);
      abortRef.current = null;
    }
  };

  const handleCancel = () => {
    abortRef.current?.abort();
  };

  return (
    <div className="md:col-span-3 bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-4">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Wand2 className="w-4 h-4 text-kindle-accent" />
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-kindle-text">
              Castwright — Book to Audiobook
            </h4>
          </div>
          <p className="text-[10px] text-kindle-text-muted leading-relaxed max-w-2xl">
            Convert ebooks from your library into a personal audiobook using a local{" "}
            <a
              href="https://github.com/dudarenok-maker/Castwright"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-kindle-text inline-flex items-center gap-0.5"
            >
              Castwright
              <ExternalLink className="w-2.5 h-2.5" />
            </a>{" "}
            instance. Castwright runs on your machine (Node + Python TTS sidecar) — Kora sends the manuscript and imports the finished MP3 chapters.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {healthStatus === "ok" ? (
            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-emerald-600 bg-emerald-500/10 px-2 py-1 rounded-full border border-emerald-500/20">
              <CheckCircle2 className="w-3 h-3" />
              Connected
            </span>
          ) : healthStatus === "error" ? (
            <span className="inline-flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-amber-600 bg-amber-500/10 px-2 py-1 rounded-full border border-amber-500/20">
              <AlertCircle className="w-3 h-3" />
              Offline
            </span>
          ) : null}
          <button
            onClick={() => runHealthCheck()}
            disabled={checkingHealth}
            className="p-1.5 rounded-lg border border-kindle-border hover:bg-kindle-bg transition"
            title="Test connection"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checkingHealth ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted flex items-center gap-1">
            <Server className="w-3 h-3" />
            Castwright Server URL
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://localhost:8080"
              className="flex-1 text-[11px] bg-kindle-bg border border-kindle-border rounded-lg px-3 py-2 font-mono"
            />
            <button
              onClick={handleSaveUrl}
              className="text-[9px] font-bold uppercase tracking-wider px-3 py-2 rounded-lg border border-kindle-border hover:bg-kindle-bg transition"
            >
              Save
            </button>
          </div>
          <button
            onClick={handleUseDevProxy}
            className="text-[8px] text-kindle-text-muted underline hover:text-kindle-text"
          >
            Use dev proxy (/castwright-api) to avoid CORS
          </button>
          {healthDetail && healthStatus === "error" && (
            <p className="text-[8px] text-amber-600 leading-relaxed">{healthDetail}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted">
            TTS Model
          </label>
          <select
            value={modelKey}
            onChange={(e) => setModelKey(e.target.value as CastwrightModelKey)}
            disabled={converting}
            className="w-full text-[11px] bg-kindle-bg border border-kindle-border rounded-lg px-3 py-2"
          >
            {MODEL_OPTIONS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
      </div>

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
            {eligibleBooks.length ? "Select a book…" : "No eligible books in library"}
          </option>
          {eligibleBooks.map((b) => (
            <option key={b.id} value={b.id}>
              {b.title} — {b.author} ({b.extension?.toUpperCase()})
            </option>
          ))}
        </select>
      </div>

      {progress && converting && (
        <div className="space-y-2">
          <div className="flex items-center justify-between text-[9px] font-bold uppercase tracking-wider">
            <span className="text-kindle-text-muted">{progress.message}</span>
            <span className="text-kindle-accent">{progress.percent}%</span>
          </div>
          <div className="h-1.5 bg-kindle-bg rounded-full overflow-hidden border border-kindle-border">
            <div
              className="h-full bg-kindle-accent transition-all duration-300"
              style={{ width: `${progress.percent}%` }}
            />
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
            disabled={!selectedBook || healthStatus !== "ok"}
            className="flex-1 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-wider py-2.5 rounded-xl bg-kindle-accent text-white hover:opacity-90 transition disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Wand2 className="w-3.5 h-3.5" />
            Convert to Audiobook
          </button>
        ) : (
          <button
            onClick={handleCancel}
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
