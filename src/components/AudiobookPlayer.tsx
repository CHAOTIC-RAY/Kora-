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
  downloadAudiobookTrack,
  getAudiobookTrack,
  getAudiobookTracksForBook,
  getProxiedAudioUrl,
  isAudiobookFullyDownloaded,
} from "../lib/audiobookStorage";

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

  const coverSrc = book.coverUrl
    ? book.coverUrl.startsWith("/")
      ? book.coverUrl
      : `/api/proxy-image?url=${encodeURIComponent(book.coverUrl)}`
    : null;

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
      return getProxiedAudioUrl(track.src);
    },
    [book.id, localUrls, tracks]
  );

  const loadTrack = useCallback(
    async (index: number, autoPlay = false) => {
      if (!tracks[index] || !audioRef.current) return;
      setLoadingTrack(true);
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
      } finally {
        setLoadingTrack(false);
      }
    },
    [tracks, resolveTrackUrl, speed, book.audiobookCurrentTrack, book.audiobookCurrentTime]
  );

  useEffect(() => {
    loadTrack(currentTrack);
    isAudiobookFullyDownloaded(book.id, tracks.length).then(setOfflineReady);
    return () => {
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
    setDownloadProgress(0);

    try {
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        const existing = await getAudiobookTrack(book.id, i);
        if (existing) {
          setDownloadProgress(Math.round(((i + 1) / tracks.length) * 100));
          continue;
        }
        await downloadAudiobookTrack(book.id, i, track.title, track.src, (pct) => {
          const overall = ((i + pct / 100) / tracks.length) * 100;
          setDownloadProgress(Math.round(overall));
        });
      }
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
    <div className="fixed inset-0 z-[100] bg-gradient-to-b from-[#1a1a2e] to-[#0f0f1a] text-white flex flex-col">
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
      />

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition">
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-widest text-white/60">
          <Headphones className="w-4 h-4 text-purple-400" />
          Audiobook
        </div>
        <button onClick={onClose} className="p-2 rounded-full hover:bg-white/10 transition">
          <X className="w-5 h-5" />
        </button>
      </div>

      {/* Main player */}
      <div className="flex-1 flex flex-col items-center justify-center px-6 gap-6 overflow-y-auto py-6">
        <div className="w-48 sm:w-56 aspect-[2/3] rounded-2xl overflow-hidden shadow-2xl border border-white/10 bg-white/5">
          {coverSrc ? (
            <img src={coverSrc} alt={book.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Headphones className="w-16 h-16 text-purple-400/50" />
            </div>
          )}
        </div>

        <div className="text-center max-w-md space-y-1">
          <h2 className="text-lg font-bold font-serif leading-snug">{book.title}</h2>
          <p className="text-sm text-white/60">{book.author}</p>
          {tracks[currentTrack] && (
            <p className="text-xs text-purple-300/80 mt-2">
              {currentTrack + 1}/{tracks.length} — {tracks[currentTrack].title}
            </p>
          )}
        </div>

        {/* Progress */}
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
            className="w-full accent-purple-500"
          />
          <div className="flex justify-between text-[10px] text-white/50 font-mono">
            <span>{formatTime(currentTime)}</span>
            <span>{formatTime(duration)}</span>
          </div>
          <div className="h-1 bg-white/10 rounded-full overflow-hidden">
            <div className="h-full bg-purple-500 transition-all" style={{ width: `${overallPercent}%` }} />
          </div>
          <p className="text-[9px] text-center text-white/40 uppercase tracking-widest">
            Overall {overallPercent}% complete
          </p>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-4 sm:gap-6">
          <button onClick={() => skip(-10)} className="p-3 rounded-full hover:bg-white/10 transition" title="Back 10s">
            <RotateCcw className="w-5 h-5" />
          </button>
          <button onClick={() => goToTrack(currentTrack - 1)} disabled={currentTrack === 0} className="p-3 rounded-full hover:bg-white/10 transition disabled:opacity-30">
            <SkipBack className="w-6 h-6" />
          </button>
          <button
            onClick={togglePlay}
            disabled={loadingTrack || tracks.length === 0}
            className="w-16 h-16 rounded-full bg-purple-600 hover:bg-purple-500 flex items-center justify-center shadow-lg shadow-purple-900/50 transition disabled:opacity-50"
          >
            {loadingTrack ? (
              <div className="w-6 h-6 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            ) : isPlaying ? (
              <Pause className="w-7 h-7 fill-current" />
            ) : (
              <Play className="w-7 h-7 fill-current ml-1" />
            )}
          </button>
          <button onClick={() => goToTrack(currentTrack + 1)} disabled={currentTrack >= tracks.length - 1} className="p-3 rounded-full hover:bg-white/10 transition disabled:opacity-30">
            <SkipForward className="w-6 h-6" />
          </button>
          <button onClick={() => skip(30)} className="p-3 rounded-full hover:bg-white/10 transition" title="Forward 30s">
            <RotateCw className="w-5 h-5" />
          </button>
        </div>

        {/* Speed */}
        <div className="flex items-center gap-2">
          {SPEEDS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold transition ${
                speed === s ? "bg-purple-600 text-white" : "bg-white/10 text-white/60 hover:bg-white/20"
              }`}
            >
              {s}x
            </button>
          ))}
        </div>

        {/* Download */}
        <button
          onClick={handleDownloadAll}
          disabled={downloading || offlineReady || tracks.length === 0}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/15 border border-white/10 text-xs font-bold uppercase tracking-widest transition disabled:opacity-50"
        >
          <Download className="w-4 h-4" />
          {offlineReady ? "Downloaded for Offline" : downloading ? `Downloading ${downloadProgress}%` : "Download for Offline"}
        </button>

        {/* Track list */}
        {tracks.length > 0 && (
          <div className="w-full max-w-md space-y-2 mt-4">
            <p className="text-[10px] font-bold uppercase tracking-widest text-white/40">Chapters</p>
            <div className="max-h-40 overflow-y-auto space-y-1 rounded-xl border border-white/10 bg-white/5 p-2">
              {tracks.map((track, idx) => (
                <button
                  key={idx}
                  onClick={() => goToTrack(idx)}
                  className={`w-full text-left px-3 py-2 rounded-lg text-xs transition flex items-center gap-2 ${
                    idx === currentTrack ? "bg-purple-600/30 text-purple-200" : "hover:bg-white/10 text-white/70"
                  }`}
                >
                  <span className="text-[10px] font-mono text-white/40 w-5">{idx + 1}</span>
                  <span className="truncate flex-1">{track.title}</span>
                  {idx === currentTrack && isPlaying && <span className="text-purple-400 text-[9px]">▶</span>}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
