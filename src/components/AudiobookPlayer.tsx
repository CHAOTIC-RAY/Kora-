import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  Download,
  Headphones,
  Pause,
  Play,
  RotateCcw,
  RotateCw,
  SkipBack,
  SkipForward,
  Sparkles,
  X,
} from "lucide-react";
import type { BookMetadata } from "../lib/firebase";
import {
  getAudiobookTrack,
  getProxiedAudioUrl,
  isAudiobookFullyDownloaded,
} from "../lib/audiobookStorage";
import { refererForMediaUrl } from "../lib/mediaUrl";
import { isBrowserTtsTrack } from "../lib/browserTtsAudiobook";
import { BrowserTtsPlayer } from "../lib/browserTtsPlayer";
import {
  enqueueAudiobookDownload,
  subscribeAudiobookSyncQueue,
  getAudiobookSyncProgress,
} from "../lib/audiobookSyncQueue";
import {
  getSmartSkipSettings,
  saveSmartSkipSettings,
  shouldApplyIntroSkip,
  shouldAutoAdvancePastOutro,
  type SmartSkipSettings,
} from "../lib/audiobookSmartSkip";
import CassetteVisualizer from "./CassetteVisualizer";

interface AudiobookPlayerProps {
  book: BookMetadata;
  onClose: () => void;
  onProgressUpdate?: (book: BookMetadata) => void;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2];

function formatTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function displayAuthor(author?: string): string | null {
  if (!author) return null;
  const lower = author.toLowerCase().trim();
  if (["unknown", "audio", "audiobook", "unknown author"].includes(lower)) return null;
  return author;
}

function normalizeTrackKey(title: string): string {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function cleanTrackTitle(
  rawTitle: string,
  index: number,
  bookTitle: string,
  author?: string,
  allTitles?: string[]
): string {
  if (allTitles && allTitles.length > 1) {
    const keys = allTitles.map((title) => normalizeTrackKey(title));
    const unique = new Set(keys);
    if (unique.size <= Math.max(1, Math.ceil(allTitles.length * 0.35))) {
      return `Part ${index + 1}`;
    }
  }

  let title = rawTitle.trim();
  title = title.replace(/^\d+\s*\/\s*\d+\s*[-–—:]\s*/i, "");
  title = title.replace(/^\d+\s*[-–—:]\s*/i, "");

  const authorLabel = displayAuthor(author);
  if (authorLabel) {
    title = title.replace(new RegExp(`^${escapeRegex(authorLabel)}\\s*[-–—:]\\s*`, "i"), "");
  }

  if (bookTitle) {
    title = title.replace(new RegExp(escapeRegex(bookTitle), "gi"), "");
  }

  title = title
    .replace(/\baudiobook\b/gi, "")
    .replace(/\([^)]{0,100}\)/g, "")
    .replace(/\s*[-–—:|]+\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!title || title.length < 2) return `Part ${index + 1}`;
  if (title.length > 52) return `${title.slice(0, 50)}…`;
  return title;
}

export default function AudiobookPlayer({ book, onClose, onProgressUpdate }: AudiobookPlayerProps) {
  const tracks = book.audiobookTracks || [];
  const isTtsBook = book.source === "browser-tts" || tracks.some((track) => isBrowserTtsTrack(track.src));
  const trackTitles = useMemo(() => tracks.map((track) => track.title), [tracks]);
  const authorLabel = displayAuthor(book.author);
  const audioRef = useRef<HTMLAudioElement>(null);
  const ttsPlayerRef = useRef<BrowserTtsPlayer | null>(null);
  const [currentTrack, setCurrentTrack] = useState(book.audiobookCurrentTrack || 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(book.audiobookCurrentTime || 0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [offlineReady, setOfflineReady] = useState(!!book.audiobookDownloaded || isTtsBook);
  const [localUrls, setLocalUrls] = useState<Record<number, string>>({});
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [smartSkip, setSmartSkip] = useState<SmartSkipSettings>(() => getSmartSkipSettings());
  const introSkippedForTrack = useRef<number | null>(null);
  const resumeTimeForTrack = useRef<number | null>(null);
  const outroSkipTriggered = useRef(false);
  const pendingTrackLoad = useRef<{ index: number; resumeTime?: number } | null>(null);
  const currentTrackRef = useRef(currentTrack);
  const goToTrackRef = useRef<(index: number) => void>(() => {});
  currentTrackRef.current = currentTrack;

  const persistProgress = useCallback(
    (trackIdx: number, time: number, percent?: number) => {
      if (!onProgressUpdate) return;
      onProgressUpdate({
        ...book,
        audiobookCurrentTrack: trackIdx,
        audiobookCurrentTime: time,
        progress: {
          ...book.progress,
          percent: percent ?? book.progress.percent,
          lastReadTime: Date.now(),
        },
        dateModified: Date.now(),
      });
    },
    [book, onProgressUpdate]
  );

  const resolveTrackUrl = useCallback(
    async (index: number): Promise<string> => {
      if (isTtsBook) return "";
      if (localUrls[index]) return localUrls[index];
      const stored = await getAudiobookTrack(book.id, index);
      if (stored) {
        const url = URL.createObjectURL(stored.blob);
        setLocalUrls((prev) => ({ ...prev, [index]: url }));
        return url;
      }
      const track = tracks[index];
      if (!track) return "";
      return getProxiedAudioUrl(track.src, refererForMediaUrl(track.src));
    },
    [book.id, isTtsBook, localUrls, tracks]
  );

  const loadTtsTrack = useCallback(
    async (index: number, autoPlay = false, resumeTime?: number) => {
      if (!tracks[index]) return;
      setLoadingTrack(true);
      setPlaybackError(null);
      outroSkipTriggered.current = false;
      introSkippedForTrack.current = null;

      const savedResume =
        resumeTime ??
        (book.audiobookCurrentTrack === index && book.audiobookCurrentTime
          ? book.audiobookCurrentTime
          : undefined);
      resumeTimeForTrack.current = savedResume ?? null;

      try {
        const stored = await getAudiobookTrack(book.id, index);
        if (!stored?.blob) {
          throw new Error("Chapter text is missing. Recreate the read-aloud audiobook from Settings.");
        }
        const text = await stored.blob.text();
        if (!ttsPlayerRef.current) {
          ttsPlayerRef.current = new BrowserTtsPlayer({
            onTimeUpdate: (time, trackDuration) => {
              setCurrentTime(time);
              setDuration(trackDuration);
              const idx = currentTrackRef.current;
              if (
                smartSkip.enabled &&
                !outroSkipTriggered.current &&
                shouldAutoAdvancePastOutro(
                  time,
                  trackDuration,
                  smartSkip.outroSeconds,
                  idx < tracks.length - 1
                )
              ) {
                outroSkipTriggered.current = true;
                goToTrackRef.current(idx + 1);
              }
            },
            onEnded: () => {
              const idx = currentTrackRef.current;
              if (idx < tracks.length - 1) {
                goToTrackRef.current(idx + 1);
              } else {
                setIsPlaying(false);
                persistProgress(idx, 0, 100);
              }
            },
            onPlay: () => setIsPlaying(true),
            onPause: () => setIsPlaying(false),
            onError: (message) => {
              setPlaybackError(message);
              setIsPlaying(false);
            },
          });
        }

        ttsPlayerRef.current.setRate(speed);
        await ttsPlayerRef.current.loadText(text, savedResume ?? 0);

        if (smartSkip.enabled && savedResume == null) {
          const trackDuration = ttsPlayerRef.current.duration;
          if (shouldApplyIntroSkip(trackDuration, savedResume, smartSkip.introSeconds)) {
            ttsPlayerRef.current.seek(smartSkip.introSeconds);
            introSkippedForTrack.current = index;
          }
        }

        setCurrentTrack(index);
        setDuration(ttsPlayerRef.current.duration);
        setCurrentTime(ttsPlayerRef.current.currentTime);

        if (autoPlay) {
          await ttsPlayerRef.current.play();
        }
      } catch (err) {
        console.error("Failed to load TTS track:", err);
        setPlaybackError((err as Error).message || "Could not load this chapter.");
        setIsPlaying(false);
      } finally {
        setLoadingTrack(false);
      }
    },
    [
      tracks,
      book.id,
      book.audiobookCurrentTrack,
      book.audiobookCurrentTime,
      speed,
      smartSkip,
      currentTrack,
      persistProgress,
    ]
  );

  const applyIntroSkip = useCallback(
    (index: number, resumeTime?: number) => {
      if (!smartSkip.enabled || !audioRef.current) return;
      const audio = audioRef.current;
      const trackDuration = audio.duration;
      if (!shouldApplyIntroSkip(trackDuration, resumeTime, smartSkip.introSeconds)) return;
      if (introSkippedForTrack.current === index) return;

      audio.currentTime = smartSkip.introSeconds;
      setCurrentTime(smartSkip.introSeconds);
      introSkippedForTrack.current = index;
    },
    [smartSkip]
  );

  const loadTrack = useCallback(
    async (index: number, autoPlay = false, resumeTime?: number) => {
      if (!tracks[index]) return;
      if (isTtsBook) {
        await loadTtsTrack(index, autoPlay, resumeTime);
        return;
      }
      if (!audioRef.current) return;
      setLoadingTrack(true);
      setPlaybackError(null);
      outroSkipTriggered.current = false;
      introSkippedForTrack.current = null;

      const savedResume =
        resumeTime ??
        (book.audiobookCurrentTrack === index && book.audiobookCurrentTime
          ? book.audiobookCurrentTime
          : undefined);
      resumeTimeForTrack.current = savedResume ?? null;

      try {
        const url = await resolveTrackUrl(index);
        audioRef.current.src = url;
        audioRef.current.playbackRate = speed;
        pendingTrackLoad.current = { index, resumeTime: savedResume };

        if (autoPlay) {
          await audioRef.current.play();
          setIsPlaying(true);
        }
        setCurrentTrack(index);
      } catch (err) {
        console.error("Failed to load track:", err);
        setPlaybackError("Could not load this track. Try downloading for offline playback.");
        setIsPlaying(false);
      } finally {
        setLoadingTrack(false);
      }
    },
    [
      tracks,
      isTtsBook,
      loadTtsTrack,
      resolveTrackUrl,
      speed,
      book.audiobookCurrentTrack,
      book.audiobookCurrentTime,
      smartSkip.enabled,
      applyIntroSkip,
    ]
  );

  useEffect(() => {
    loadTrack(currentTrack);
    isAudiobookFullyDownloaded(book.id, tracks.length).then(setOfflineReady);
    const unsub = subscribeAudiobookSyncQueue((jobs, pct) => {
      const bookJobs = jobs.filter((j) => j.bookId === book.id);
      if (bookJobs.length) {
        setDownloading(bookJobs.some((j) => j.status === "downloading" || j.status === "pending"));
        setDownloadProgress(pct);
        if (bookJobs.every((j) => j.status === "done")) {
          setOfflineReady(true);
        }
      }
    });
    return () => {
      unsub();
      ttsPlayerRef.current?.destroy();
      ttsPlayerRef.current = null;
      Object.values(localUrls).forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (isTtsBook) {
      ttsPlayerRef.current?.setRate(speed);
    } else if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  }, [speed, isTtsBook]);

  const togglePlay = async () => {
    if (isTtsBook) {
      if (isPlaying) {
        ttsPlayerRef.current?.pause();
        persistProgress(currentTrack, ttsPlayerRef.current?.currentTime || currentTime);
      } else {
        await ttsPlayerRef.current?.play();
      }
      return;
    }
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
      persistProgress(currentTrack, audioRef.current.currentTime);
    } else {
      await audioRef.current.play();
      setIsPlaying(true);
    }
  };

  const skip = (delta: number) => {
    if (isTtsBook) {
      ttsPlayerRef.current?.skip(delta);
      setCurrentTime(ttsPlayerRef.current?.currentTime || 0);
      return;
    }
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(
      0,
      Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + delta)
    );
  };

  const goToTrack = (index: number) => {
    if (index < 0 || index >= tracks.length) return;
    const time = isTtsBook
      ? ttsPlayerRef.current?.currentTime || currentTime
      : audioRef.current?.currentTime || 0;
    persistProgress(currentTrack, time);
    if (isTtsBook) {
      ttsPlayerRef.current?.stop(false);
    }
    loadTrack(index, isPlaying);
  };
  goToTrackRef.current = goToTrack;

  const toggleSmartSkip = () => {
    const next = { ...smartSkip, enabled: !smartSkip.enabled };
    setSmartSkip(next);
    saveSmartSkipSettings(next);
  };

  const handleDownloadAll = async () => {
    if (downloading || tracks.length === 0) return;
    setDownloading(true);
    setDownloadProgress(getAudiobookSyncProgress());

    try {
      await enqueueAudiobookDownload(book.id, book.title, tracks);
      setOfflineReady(true);
      if (onProgressUpdate) {
        onProgressUpdate({
          ...book,
          audiobookDownloaded: true,
          dateModified: Date.now(),
        });
      }
    } catch (err) {
      console.error("Download failed:", err);
      alert("Some tracks failed to download. Check your connection and try again.");
    } finally {
      setDownloading(false);
    }
  };

  const overallPercent =
    tracks.length > 0
      ? Math.round(((currentTrack + (duration > 0 ? currentTime / duration : 0)) / tracks.length) * 100)
      : 0;

  const currentTrackLabel = cleanTrackTitle(
    tracks[currentTrack]?.title || "",
    currentTrack,
    book.title,
    book.author,
    trackTitles
  );

  return (
    <div className="fixed inset-0 z-[100] bg-kindle-bg text-kindle-text flex flex-col">
      <audio
        ref={audioRef}
        className={isTtsBook ? "hidden" : undefined}
        onTimeUpdate={() => {
          if (!audioRef.current) return;
          const time = audioRef.current.currentTime;
          const trackDuration = audioRef.current.duration;
          setCurrentTime(time);

          if (
            smartSkip.enabled &&
            !outroSkipTriggered.current &&
            shouldAutoAdvancePastOutro(
              time,
              trackDuration,
              smartSkip.outroSeconds,
              currentTrack < tracks.length - 1
            )
          ) {
            outroSkipTriggered.current = true;
            goToTrack(currentTrack + 1);
          }
        }}
        onLoadedMetadata={() => {
          if (!audioRef.current) return;
          const audio = audioRef.current;
          setDuration(audio.duration);

          const pending = pendingTrackLoad.current;
          if (pending) {
            if (pending.resumeTime != null && pending.resumeTime > 0) {
              audio.currentTime = pending.resumeTime;
              setCurrentTime(pending.resumeTime);
            } else {
              applyIntroSkip(pending.index, pending.resumeTime);
            }
            pendingTrackLoad.current = null;
          } else if (smartSkip.enabled) {
            applyIntroSkip(currentTrack, resumeTimeForTrack.current ?? undefined);
          }
        }}
        onEnded={() => {
          if (currentTrack < tracks.length - 1) {
            goToTrack(currentTrack + 1);
          } else {
            setIsPlaying(false);
            persistProgress(currentTrack, 0, 100);
          }
        }}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onError={() => {
          setIsPlaying(false);
          setPlaybackError("Playback failed — the audio source may be unavailable. Try downloading tracks.");
        }}
      />

      <header className="flex items-center justify-between px-4 py-3 border-b border-kindle-border bg-kindle-card/90 backdrop-blur-sm shrink-0">
        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-kindle-bg transition text-kindle-text-muted hover:text-kindle-text"
          aria-label="Back"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted font-lexend">
          <Headphones className="w-4 h-4 text-kindle-text" />
          Now Playing
        </div>
        <button
          onClick={onClose}
          className="p-2 rounded-full hover:bg-kindle-bg transition text-kindle-text-muted hover:text-kindle-text"
          aria-label="Close player"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col items-center px-5 py-6 gap-5 max-w-md mx-auto w-full">
            <div className="w-full shrink-0">
              <div className="p-3 sm:p-4 rounded-2xl bg-kindle-card border border-kindle-border shadow-lg">
                <CassetteVisualizer
                  title={book.title}
                  coverUrl={book.coverUrl}
                  size="player"
                  playing={isPlaying}
                />
              </div>
            </div>

            <div className="text-center w-full space-y-1">
              <h2 className="text-xl font-lexend font-bold leading-snug text-kindle-text line-clamp-2">
                {book.title}
              </h2>
              {authorLabel && (
                <p className="text-sm text-kindle-text-muted font-sans">{authorLabel}</p>
              )}
              {isTtsBook && (
                <p className="text-[10px] text-kindle-text-muted/90 font-lexend uppercase tracking-widest">
                  Read aloud · device voice
                </p>
              )}
              {tracks.length > 0 && (
                <p className="text-[11px] text-kindle-text-muted/80 font-lexend uppercase tracking-widest pt-1">
                  Track {currentTrack + 1} of {tracks.length}
                  {currentTrackLabel !== `Part ${currentTrack + 1}` ? ` · ${currentTrackLabel}` : ""}
                </p>
              )}
              {playbackError && (
                <p className="text-xs text-red-400 mt-2 text-center">{playbackError}</p>
              )}
            </div>

            <div className="w-full space-y-2">
              <input
                type="range"
                min={0}
                max={duration || 1}
                value={currentTime}
                onChange={(e) => {
                  const t = parseFloat(e.target.value);
                  if (isTtsBook) {
                    ttsPlayerRef.current?.seek(t);
                  } else if (audioRef.current) {
                    audioRef.current.currentTime = t;
                  }
                  setCurrentTime(t);
                  introSkippedForTrack.current = currentTrack;
                  outroSkipTriggered.current = false;
                }}
                className="w-full h-1.5 appearance-none rounded-full bg-kindle-border accent-white cursor-pointer"
                style={{
                  background: `linear-gradient(to right, rgba(255,255,255,0.85) ${duration ? (currentTime / duration) * 100 : 0}%, rgba(255,255,255,0.12) ${duration ? (currentTime / duration) * 100 : 0}%)`,
                }}
              />
              <div className="flex justify-between text-[11px] text-kindle-text-muted font-mono tabular-nums">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1 bg-kindle-border rounded-full overflow-hidden">
                  <div
                    className="h-full bg-white/70 transition-all duration-300"
                    style={{ width: `${overallPercent}%` }}
                  />
                </div>
                <span className="text-[10px] text-kindle-text-muted font-lexend uppercase tracking-wider shrink-0">
                  {overallPercent}%
                </span>
              </div>
            </div>

            <div className="flex items-center gap-3 sm:gap-5">
              <button
                onClick={() => skip(-10)}
                className="p-2.5 rounded-full hover:bg-kindle-card transition text-kindle-text-muted hover:text-kindle-text"
                title="Back 10 seconds"
              >
                <RotateCcw className="w-5 h-5" />
              </button>
              <button
                onClick={() => goToTrack(currentTrack - 1)}
                disabled={currentTrack === 0}
                className="p-2.5 rounded-full hover:bg-kindle-card transition disabled:opacity-30 text-kindle-text-muted hover:text-kindle-text"
                title="Previous track"
              >
                <SkipBack className="w-6 h-6" />
              </button>
              <button
                onClick={togglePlay}
                disabled={loadingTrack || tracks.length === 0}
                className="w-16 h-16 rounded-full bg-white text-black hover:bg-neutral-100 flex items-center justify-center shadow-lg transition disabled:opacity-50"
                title={isPlaying ? "Pause" : "Play"}
              >
                {loadingTrack ? (
                  <div className="w-6 h-6 border-2 border-black/20 border-t-black rounded-full animate-spin" />
                ) : isPlaying ? (
                  <Pause className="w-7 h-7 fill-current" />
                ) : (
                  <Play className="w-7 h-7 fill-current ml-0.5" />
                )}
              </button>
              <button
                onClick={() => goToTrack(currentTrack + 1)}
                disabled={currentTrack >= tracks.length - 1}
                className="p-2.5 rounded-full hover:bg-kindle-card transition disabled:opacity-30 text-kindle-text-muted hover:text-kindle-text"
                title="Next track"
              >
                <SkipForward className="w-6 h-6" />
              </button>
              <button
                onClick={() => skip(30)}
                className="p-2.5 rounded-full hover:bg-kindle-card transition text-kindle-text-muted hover:text-kindle-text"
                title="Forward 30 seconds"
              >
                <RotateCw className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap justify-center">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`min-w-[3rem] px-2.5 py-1.5 rounded-lg text-[10px] font-bold font-lexend transition border ${
                    speed === s
                      ? "bg-white text-black border-white"
                      : "bg-kindle-card text-kindle-text-muted border-kindle-border hover:text-kindle-text hover:border-kindle-text/30"
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={toggleSmartSkip}
              className={`w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl border text-left transition ${
                smartSkip.enabled
                  ? "bg-white/10 border-white/20 text-kindle-text"
                  : "bg-kindle-card border-kindle-border text-kindle-text-muted hover:text-kindle-text"
              }`}
            >
              <div className="flex items-center gap-2.5 min-w-0">
                <Sparkles className={`w-4 h-4 shrink-0 ${smartSkip.enabled ? "text-white" : ""}`} />
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-widest font-lexend">Smart Skip</p>
                  <p className="text-[10px] text-kindle-text-muted truncate">
                    {smartSkip.enabled
                      ? `Skip ${smartSkip.introSeconds}s intros and ${smartSkip.outroSeconds}s outros`
                      : "Off — plays full track intros and outros"}
                  </p>
                </div>
              </div>
              <span
                className={`shrink-0 text-[9px] font-bold uppercase tracking-widest px-2 py-1 rounded-full border ${
                  smartSkip.enabled
                    ? "bg-white text-black border-white"
                    : "border-kindle-border"
                }`}
              >
                {smartSkip.enabled ? "On" : "Off"}
              </span>
            </button>

            {!isTtsBook && (
              <button
                onClick={handleDownloadAll}
                disabled={downloading || offlineReady || tracks.length === 0}
                className="relative overflow-hidden w-full flex items-center justify-center gap-2 px-5 py-3 rounded-xl bg-kindle-card hover:bg-kindle-border/30 border border-kindle-border text-[10px] font-bold uppercase tracking-widest font-lexend transition disabled:opacity-60 text-kindle-text"
              >
                {downloading && (
                  <span
                    className="absolute inset-y-0 left-0 bg-white/10 transition-all duration-300"
                    style={{ width: `${downloadProgress}%` }}
                  />
                )}
                <span className="relative flex items-center gap-2">
                  <Download className="w-4 h-4" />
                  {offlineReady
                    ? "Saved for Offline"
                    : downloading
                      ? `Downloading ${downloadProgress}%`
                      : "Download for Offline"}
                </span>
              </button>
            )}
          </div>
        </div>

        {tracks.length > 0 && (
          <section className="shrink-0 border-t border-kindle-border bg-kindle-card/50 backdrop-blur-sm px-5 py-4">
            <div className="max-w-md mx-auto space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted font-lexend">
                  Chapters
                </p>
                <span className="text-[10px] text-kindle-text-muted font-mono tabular-nums">
                  {tracks.length} tracks
                </span>
              </div>
              <div className="max-h-44 overflow-y-auto player-chapter-scroll space-y-1 rounded-xl border border-kindle-border bg-kindle-bg/80 p-2">
                {tracks.map((track, idx) => {
                  const label = cleanTrackTitle(track.title, idx, book.title, book.author, trackTitles);
                  const active = idx === currentTrack;
                  return (
                    <button
                      key={idx}
                      onClick={() => goToTrack(idx)}
                      className={`w-full text-left px-3 py-2.5 rounded-lg text-xs transition flex items-center gap-3 ${
                        active
                          ? "bg-white/10 border border-white/15 text-kindle-text"
                          : "hover:bg-kindle-card text-kindle-text-muted"
                      }`}
                    >
                      <span
                        className={`text-[10px] font-mono tabular-nums w-5 shrink-0 ${
                          active ? "text-white" : "text-kindle-text-muted"
                        }`}
                      >
                        {idx + 1}
                      </span>
                      <span className="truncate flex-1 font-sans">{label}</span>
                      {active && isPlaying && (
                        <Play className="w-3 h-3 text-white shrink-0 fill-current" />
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}
