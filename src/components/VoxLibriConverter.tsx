import React, { useCallback, useEffect, useRef, useState } from "react";
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
import { BookMetadata } from "../lib/firebase";
import {
  ConversionProgress,
  extractAudioTracksFromBlob,
  getEligibleConverterBooks,
  importConvertedAudiobook,
  loadCachedBookBlob,
  pollConversionJob,
} from "../lib/audiobookConverterImport";
import {
  checkVoxLibriHealth,
  downloadVoxLibriJob,
  getVoxLibriJob,
  getVoxLibriUrl,
  setVoxLibriUrl,
  startVoxLibriConversion,
} from "../lib/voxlibriClient";

interface VoxLibriConverterProps {
  books: BookMetadata[];
  userId?: string;
  onRefreshLibrary?: (uid?: string) => void;
}

export default function VoxLibriConverter({ books, userId, onRefreshLibrary }: VoxLibriConverterProps) {
  const [serverUrl, setServerUrl] = useState(getVoxLibriUrl);
  const [selectedBookId, setSelectedBookId] = useState("");
  const [language, setLanguage] = useState("eng");
  const [ttsEngine, setTtsEngine] = useState<"xtts" | "fairseq">("xtts");
  const [healthStatus, setHealthStatus] = useState<"unknown" | "ok" | "error">("unknown");
  const [healthDetail, setHealthDetail] = useState<string | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState<ConversionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccess, setLastSuccess] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const eligibleBooks = getEligibleConverterBooks(books);
  const selectedBook = eligibleBooks.find((book) => book.id === selectedBookId);

  const runHealthCheck = useCallback(async (url = serverUrl) => {
    setCheckingHealth(true);
    const result = await checkVoxLibriHealth(url);
    setHealthStatus(result.ok ? "ok" : "error");
    setHealthDetail(result.detail || null);
    setCheckingHealth(false);
  }, [serverUrl]);

  useEffect(() => {
    runHealthCheck();
  }, [runHealthCheck]);

  const handleConvert = async () => {
    if (!selectedBook) return;
    setConverting(true);
    setError(null);
    setLastSuccess(null);
    setProgress({ stage: "uploading", message: "Uploading manuscript…", percent: 5 });
    abortRef.current = new AbortController();

    try {
      const { blob, fileName } = await loadCachedBookBlob(selectedBook);
      const jobId = await startVoxLibriConversion({
        file: blob,
        fileName,
        language,
        ttsEngine,
        baseUrl: serverUrl,
        signal: abortRef.current.signal,
      });

      await pollConversionJob(() => getVoxLibriJob(jobId, serverUrl), {
        signal: abortRef.current.signal,
        onProgress: (job) => {
          setProgress({
            stage: "converting",
            message: job.message || "Converting with VoxLibri…",
            percent: Math.max(10, Math.min(90, job.progress || 10)),
          });
        },
      });

      setProgress({ stage: "downloading", message: "Downloading converted audio…", percent: 92 });
      const audioBlob = await downloadVoxLibriJob(jobId, serverUrl);
      const tracks = await extractAudioTracksFromBlob(audioBlob, "audiobook.zip");
      if (!tracks.length) throw new Error("No audio tracks found in VoxLibri output");

      setProgress({ stage: "importing", message: "Adding to your library…", percent: 97 });
      const entry = await importConvertedAudiobook({
        sourceBook: selectedBook,
        tracks,
        engine: "voxlibri",
        userId,
        onRefreshLibrary,
      });
      setProgress({ stage: "done", message: "Done", percent: 100 });
      setLastSuccess(`Added "${entry.title}" with ${tracks.length} track(s).`);
    } catch (err) {
      if ((err as Error).name === "AbortError" || (err as Error).message === "Cancelled") {
        setError("Conversion cancelled.");
      } else {
        setError((err as Error).message || "Conversion failed.");
      }
    } finally {
      setConverting(false);
      abortRef.current = null;
    }
  };

  return (
    <div className="md:col-span-3 bg-kindle-card border border-kindle-border rounded-2xl p-5 space-y-4">
      <div className="flex flex-col md:flex-row md:items-start md:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <Wand2 className="w-4 h-4 text-kindle-accent" />
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-kindle-text">
              VoxLibri — Book to Audiobook
            </h4>
          </div>
          <p className="text-[10px] text-kindle-text-muted leading-relaxed max-w-2xl">
            Neural ebook-to-audiobook conversion via local{" "}
            <a
              href="https://github.com/Vasanth2005kk/VoxLibri"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-kindle-text inline-flex items-center gap-0.5"
            >
              VoxLibri
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
            . Run the Kora API wrapper in <code className="text-[9px]">services/voxlibri-api</code> with{" "}
            <code className="text-[9px]">VOXLIBRI_HOME</code> set. GPU recommended for XTTS.
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

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="space-y-1.5 md:col-span-2">
          <label className="text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted flex items-center gap-1">
            <Server className="w-3 h-3" />
            VoxLibri API URL
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://localhost:7861"
              className="flex-1 text-[11px] bg-kindle-bg border border-kindle-border rounded-lg px-3 py-2 font-mono"
            />
            <button
              onClick={() => {
                setVoxLibriUrl(serverUrl);
                runHealthCheck(serverUrl);
              }}
              className="text-[9px] font-bold uppercase tracking-wider px-3 py-2 rounded-lg border border-kindle-border hover:bg-kindle-bg transition"
            >
              Save
            </button>
          </div>
          <button
            onClick={() => {
              const proxyUrl = "/voxlibri-api";
              setServerUrl(proxyUrl);
              setVoxLibriUrl(proxyUrl);
              runHealthCheck(proxyUrl);
            }}
            className="text-[8px] text-kindle-text-muted underline hover:text-kindle-text"
          >
            Use dev proxy (/voxlibri-api)
          </button>
          {healthDetail && healthStatus === "error" && (
            <p className="text-[8px] text-amber-600 leading-relaxed">{healthDetail}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted">Engine</label>
          <select
            value={ttsEngine}
            onChange={(e) => setTtsEngine(e.target.value as "xtts" | "fairseq")}
            disabled={converting}
            className="w-full text-[11px] bg-kindle-bg border border-kindle-border rounded-lg px-3 py-2"
          >
            <option value="xtts">XTTS v2 (voice clone)</option>
            <option value="fairseq">Fairseq</option>
          </select>
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value)}
            disabled={converting}
            className="w-full text-[11px] bg-kindle-bg border border-kindle-border rounded-lg px-3 py-2"
          >
            <option value="eng">English</option>
            <option value="tam">Tamil</option>
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
          {eligibleBooks.map((book) => (
            <option key={book.id} value={book.id}>
              {book.title} — {book.author} ({book.extension?.toUpperCase()})
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
            disabled={!selectedBook || healthStatus !== "ok"}
            className="flex-1 flex items-center justify-center gap-2 text-[10px] font-bold uppercase tracking-wider py-2.5 rounded-xl bg-kindle-accent text-white hover:opacity-90 transition disabled:opacity-40"
          >
            <Wand2 className="w-3.5 h-3.5" />
            Convert with VoxLibri
          </button>
        ) : (
          <button
            onClick={() => abortRef.current?.abort()}
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
