import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Headphones,
  Loader2,
  Mic2,
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
  checkVocalbookHealth,
  downloadVocalbookJob,
  getVocalbookJob,
  getVocalbookUrl,
  listVocalbookConfigs,
  setVocalbookUrl,
  startVocalbookConversion,
} from "../lib/vocalbookClient";

interface VocalbookConverterProps {
  books: BookMetadata[];
  userId?: string;
  onRefreshLibrary?: (uid?: string) => void;
}

const EDGE_VOICES = [
  "en-US-GuyNeural",
  "en-US-JennyNeural",
  "en-US-AriaNeural",
  "en-GB-RyanNeural",
  "en-GB-SoniaNeural",
];

export default function VocalbookConverter({ books, userId, onRefreshLibrary }: VocalbookConverterProps) {
  const [serverUrl, setServerUrl] = useState(getVocalbookUrl);
  const [selectedBookId, setSelectedBookId] = useState("");
  const [configName, setConfigName] = useState("");
  const [ttsVoice, setTtsVoice] = useState("en-US-GuyNeural");
  const [rvcModel, setRvcModel] = useState("");
  const [batchSize, setBatchSize] = useState(5);
  const [savedConfigs, setSavedConfigs] = useState<Record<string, unknown>>({});
  const [healthStatus, setHealthStatus] = useState<"unknown" | "ok" | "error">("unknown");
  const [healthDetail, setHealthDetail] = useState<string | null>(null);
  const [checkingHealth, setCheckingHealth] = useState(false);
  const [converting, setConverting] = useState(false);
  const [progress, setProgress] = useState<ConversionProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastSuccess, setLastSuccess] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const eligibleBooks = getEligibleConverterBooks(books).filter((book) =>
    ["pdf", "txt", "epub"].includes((book.extension || "").toLowerCase())
  );
  const selectedBook = eligibleBooks.find((book) => book.id === selectedBookId);
  const configNames = Object.keys(savedConfigs);

  const runHealthCheck = useCallback(async (url = serverUrl) => {
    setCheckingHealth(true);
    const [health, configs] = await Promise.all([
      checkVocalbookHealth(url),
      listVocalbookConfigs(url).catch(() => ({})),
    ]);
    setSavedConfigs(configs);
    setHealthStatus(health.ok ? "ok" : "error");
    setHealthDetail(health.detail || null);
    if (!configName && Object.keys(configs).length) {
      setConfigName(Object.keys(configs)[0]);
    }
    setCheckingHealth(false);
  }, [serverUrl, configName]);

  useEffect(() => {
    runHealthCheck();
  }, [runHealthCheck]);

  const handleConvert = async () => {
    if (!selectedBook) return;
    if (!configName && !rvcModel.trim()) {
      setError("Select a saved VocalBook config or enter an RVC model folder name.");
      return;
    }

    setConverting(true);
    setError(null);
    setLastSuccess(null);
    setProgress({ stage: "uploading", message: "Uploading document…", percent: 5 });
    abortRef.current = new AbortController();

    try {
      const { blob, fileName } = await loadCachedBookBlob(selectedBook);
      const jobId = await startVocalbookConversion({
        file: blob,
        fileName,
        configName: configName || undefined,
        ttsVoice,
        rvcModel: rvcModel.trim(),
        batchSize,
        baseUrl: serverUrl,
        signal: abortRef.current.signal,
      });

      await pollConversionJob(() => getVocalbookJob(jobId, serverUrl), {
        signal: abortRef.current.signal,
        onProgress: (job) => {
          setProgress({
            stage: "converting",
            message: job.message || "Converting with VocalBook…",
            percent: Math.max(10, Math.min(90, job.progress || 10)),
          });
        },
      });

      setProgress({ stage: "downloading", message: "Downloading finished audiobook…", percent: 92 });
      const audioBlob = await downloadVocalbookJob(jobId, serverUrl);
      const tracks = await extractAudioTracksFromBlob(audioBlob, "audiobook.mp3");
      if (!tracks.length) throw new Error("No audio output from VocalBook");

      setProgress({ stage: "importing", message: "Adding to your library…", percent: 97 });
      const entry = await importConvertedAudiobook({
        sourceBook: selectedBook,
        tracks,
        engine: "vocalbook",
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
            <Mic2 className="w-4 h-4 text-kindle-accent" />
            <h4 className="text-[11px] font-bold uppercase tracking-wider text-kindle-text">
              VocalBook — TTS + RVC Audiobook
            </h4>
          </div>
          <p className="text-[10px] text-kindle-text-muted leading-relaxed max-w-2xl">
            PDF/TXT to audiobook via local{" "}
            <a
              href="https://github.com/ColbyStarr/vocalbook"
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-kindle-text inline-flex items-center gap-0.5"
            >
              VocalBook
              <ExternalLink className="w-2.5 h-2.5" />
            </a>
            . Uses Edge TTS or Coqui, then RVC voice conversion. Run{" "}
            <code className="text-[9px]">services/vocalbook-api</code> with{" "}
            <code className="text-[9px]">VOCALBOOK_HOME</code> and at least one model in{" "}
            <code className="text-[9px]">rvc_models/</code>.
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
          >
            <RefreshCw className={`w-3.5 h-3.5 ${checkingHealth ? "animate-spin" : ""}`} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted flex items-center gap-1">
            <Server className="w-3 h-3" />
            VocalBook API URL
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={serverUrl}
              onChange={(e) => setServerUrl(e.target.value)}
              placeholder="http://localhost:7862"
              className="flex-1 text-[11px] bg-kindle-bg border border-kindle-border rounded-lg px-3 py-2 font-mono"
            />
            <button
              onClick={() => {
                setVocalbookUrl(serverUrl);
                runHealthCheck(serverUrl);
              }}
              className="text-[9px] font-bold uppercase tracking-wider px-3 py-2 rounded-lg border border-kindle-border hover:bg-kindle-bg transition"
            >
              Save
            </button>
          </div>
          <button
            onClick={() => {
              const proxyUrl = "/vocalbook-api";
              setServerUrl(proxyUrl);
              setVocalbookUrl(proxyUrl);
              runHealthCheck(proxyUrl);
            }}
            className="text-[8px] text-kindle-text-muted underline hover:text-kindle-text"
          >
            Use dev proxy (/vocalbook-api)
          </button>
          {healthDetail && healthStatus === "error" && (
            <p className="text-[8px] text-amber-600 leading-relaxed">{healthDetail}</p>
          )}
        </div>

        <div className="space-y-1.5">
          <label className="text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted">
            Saved config (optional)
          </label>
          <select
            value={configName}
            onChange={(e) => setConfigName(e.target.value)}
            disabled={converting}
            className="w-full text-[11px] bg-kindle-bg border border-kindle-border rounded-lg px-3 py-2"
          >
            <option value="">{configNames.length ? "Create new from fields below…" : "No configs yet"}</option>
            {configNames.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
          <input
            type="text"
            value={rvcModel}
            onChange={(e) => setRvcModel(e.target.value)}
            placeholder="RVC model folder name (required if no config)"
            disabled={converting}
            className="w-full text-[11px] bg-kindle-bg border border-kindle-border rounded-lg px-3 py-2"
          />
          <select
            value={ttsVoice}
            onChange={(e) => setTtsVoice(e.target.value)}
            disabled={converting || !!configName}
            className="w-full text-[11px] bg-kindle-bg border border-kindle-border rounded-lg px-3 py-2"
          >
            {EDGE_VOICES.map((voice) => (
              <option key={voice} value={voice}>
                {voice}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
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
              {eligibleBooks.length ? "Select a book…" : "No PDF/TXT/EPUB books in library"}
            </option>
            {eligibleBooks.map((book) => (
              <option key={book.id} value={book.id}>
                {book.title} — {book.author} ({book.extension?.toUpperCase()})
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <label className="text-[9px] font-bold uppercase tracking-wider text-kindle-text-muted">
            Batch size
          </label>
          <input
            type="number"
            min={1}
            max={100}
            value={batchSize}
            onChange={(e) => setBatchSize(Number(e.target.value) || 5)}
            disabled={converting}
            className="w-full text-[11px] bg-kindle-bg border border-kindle-border rounded-lg px-3 py-2"
          />
        </div>
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
            Convert with VocalBook
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
