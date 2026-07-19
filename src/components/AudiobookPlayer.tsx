import React, { useCallback, useEffect, useRef, useState } from "react";
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
  X,
} from "lucide-react";
import type { BookMetadata } from "../lib/firebase";
import {
  getAudiobookTrack,
  getProxiedAudioUrl,
  isAudiobookFullyDownloaded,
} from "../lib/audiobookStorage";
import { refererForMediaUrl } from "../lib/mediaUrl";
import {
  enqueueAudiobookDownload,
  subscribeAudiobookSyncQueue,
  getAudiobookSyncProgress,
} from "../lib/audiobookSyncQueue";
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

export default function AudiobookPlayer({ book, onClose, onProgressUpdate }: AudiobookPlayerProps) {
  const tracks = book.audiobookTracks || [];
  const audioRef = useRef<HTMLAudioElement>(null);
  const [currentTrack, setCurrentTrack] = useState(book.audiobookCurrentTrack || 0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(book.audiobookCurrentTime || 0);
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [offlineReady, setOfflineReady] = useState(!!book.audiobookDownloaded);
  const [localUrls, setLocalUrls] = useState<Record<number, string>>({});
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);

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
    [book.id, localUrls, tracks]
  );

  const loadTrack = useCallback(
    async (index: number, autoPlay = false) => {
      if (!tracks[index] || !audioRef.current) return;
      setLoadingTrack(true);
      setPlaybackError(null);
      try {
        const url = await resolveTrackUrl(index);
        audioRef.current.src = url;
        audioRef.current.playbackRate = speed;
        if (book.audiobookCurrentTrack === index && book.audiobookCurrentTime) {
          audioRef.current.currentTime = book.audiobookCurrentTime;
        }
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
    [tracks, resolveTrackUrl, speed, book.audiobookCurrentTrack, book.audiobookCurrentTime]
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
      Object.values(localUrls).forEach((u) => URL.revokeObjectURL(u));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.playbackRate = speed;
  }, [speed]);

  const togglePlay = async () => {
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
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, Math.min(audioRef.current.duration || 0, audioRef.current.currentTime + delta));
  };

  const goToTrack = (index: number) => {
    if (index < 0 || index >= tracks.length) return;
    persistProgress(currentTrack, audioRef.current?.currentTime || 0);
    loadTrack(index, isPlaying);
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

  return (
    <div className="fixed inset-0 z-[100] bg-kindle-bg text-kindle-text flex flex-col">
      <audio
        ref={audioRef}
        onTimeUpdate={() => {
          if (!audioRef.current) return;
          setCurrentTime(audioRef.current.currentTime);
        }}
        onLoadedMetadata={() => {
          if (audioRef.current) setDuration(audioRef.current.duration);
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

      <div className="flex items-center justify-between px-4 py-3 border-b border-kindle-border bg-kindle-card/80 backdrop-blur-sm">
        <button onClick={onClose} className="p-2 rounded-full hover:bg-kindle-bg transition text-kindle-text-muted hover:text-kindle-text">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted">
          <Headphones className="w-4 h-4 text-kindle-text" />
          Audiobook
        </div>
        <button onClick={onClose} className="p-2 rounded-full hover:bg-kindle-bg transition text-kindle-text-muted hover:text-kindle-text">
          <X className="w-5 h-5" />
        </button>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-5 overflow-y-auto py-6">
        <div className="w-full max-w-sm px-2">
          <CassetteVisualizer
            title={book.title}
            coverUrl={book.coverUrl}
            size="player"
            playing={isPlaying}
          />
        </div>

        <div className="text-center max-w-md space-y-1">
          <h2 className="text-lg font-bold font-serif leading-snug text-kindle-text">{book.title}</h2>
          <p className="text-sm text-kindle-text-muted">{book.author}</p>
          {tracks[currentTrack] && (
            <p className="text-xs text-kindle-text-muted/90 mt-2 font-mono">
              {currentTrack + 1}/{tracks.length} — {tracks[currentTrack].title}
            </p>
          )}
          {playbackError && (
            <p className="text-xs text-red-400 mt-2 text-center max-w-sm">{playbackError}</p>
          )}
        </div>

        <div className="w-full max-w-md space-y-2">
          <input
            type="range"
            min={0}
            max={duration || 1}
            value={currentTime}
            onChange={(e) => {
              const t = parseFloat(e.target.value);
              if (audioRef.current) audioRef.current.currentTime = t;
              setCurrentTime(t);
            }}
            className="w-full accent-neutral-400"
          />
          <div className="flex justify-between text-[10px] text-kindle-text-muted font-mono">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
          <div className="h-1 bg-kindle-border rounded-full overflow-hidden">
            <div className="h-full bg-kindle-text/70 transition-all" style={{ width: `${overallPercent}%` }} />
          </div>
          <p className="text-[9px] text-center text-kindle-text-muted uppercase tracking-widest">
            Overall {overallPercent}% complete
          </p>
        </div>

        <div className="flex items-center gap-4 sm:gap-6">
          <button onClick={() => skip(-10)} className="p-3 rounded-full hover:bg-kindle-card transition text-kindle-text-muted hover:text-kindle-text" title="Back 10s">
            <RotateCcw className="w-5 h-5" />
          </button>
          <button onClick={() => goToTrack(currentTrack - 1)} disabled={currentTrack === 0} className="p-3 rounded-full hover:bg-kindle-card transition disabled:opacity-30 text-kindle-text-muted hover:text-kindle-text">
            <SkipBack className="w-6 h-6" />
          </button>
          <button
            onClick={togglePlay}
            disabled={loadingTrack || tracks.length === 0}
            className="w-16 h-16 rounded-full bg-kindle-accent text-kindle-bg hover:opacity-90 flex items-center justify-center shadow-lg transition disabled:opacity-50 border border-kindle-border"
          >
            {loadingTrack ? (
              <div className="w-6 h-6 border-2 border-kindle-bg/30 border-t-kindle-bg rounded-full animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-7 h-7 fill-current" />
            ) : (
              <Play className="w-7 h-7 fill-current ml-1" />
            )}
          </button>
          <button onClick={() => goToTrack(currentTrack + 1)} disabled={currentTrack >= tracks.length - 1} className="p-3 rounded-full hover:bg-kindle-card transition disabled:opacity-30 text-kindle-text-muted hover:text-kindle-text">
            <SkipForward className="w-6 h-6" />
          </button>
          <button onClick={() => skip(30)} className="p-3 rounded-full hover:bg-kindle-card transition text-kindle-text-muted hover:text-kindle-text" title="Forward 30s">
            <RotateCw className="w-5 h-5" />
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-center">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition border ${
                speed === s
                  ? "bg-kindle-accent text-kindle-bg border-kindle-accent"
                  : "bg-kindle-card text-kindle-text-muted border-kindle-border hover:text-kindle-text"
              }`}
            >
              {s}x
            </button>
          ))}
        </div>

        <button
          onClick={handleDownloadAll}
          disabled={downloading || offlineReady || tracks.length === 0}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-kindle-card hover:bg-kindle-border/40 border border-kindle-border text-xs font-bold uppercase tracking-widest transition disabled:opacity-50 text-kindle-text"
        >
          <Download className="w-4 h-4" />
          {offlineReady ? "Downloaded for Offline" : downloading ? `Downloading ${downloadProgress}%` : "Download for Offline"}
        </button>

        {tracks.length > 0 && (
          <div className="w-full max-w-md space-y-2 mt-2">
            <p className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">Chapters</p>
            <div className="max-h-40 overflow-y-auto space-y-1 rounded-xl border border-kindle-border bg-kindle-card p-2">
              {tracks.map((track, idx) => (
                <button
                  key={idx}
                  onClick={() => goToTrack(idx)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs transition flex items-center gap-2 ${
                    idx === currentTrack
                      ? "bg-kindle-bg border border-kindle-border text-kindle-text"
                      : "hover:bg-kindle-bg/60 text-kindle-text-muted"
                  }`}
                >
                  <span className="text-[10px] font-mono text-kindle-text-muted w-5">{idx + 1}</span>
                  <span className="truncate flex-1">{track.title}</span>
                  {idx === currentTrack && isPlaying && (
                    <span className="text-kindle-text text-[9px] cassette-tape-pulse">▶</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
