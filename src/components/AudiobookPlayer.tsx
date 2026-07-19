import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  Download,
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
import { syncBookToCloud } from "../lib/firebase";
import {
  getAudiobookTrack,
  getProxiedAudioUrl,
  isAudiobookFullyDownloaded,
} from "../lib/audiobookStorage";
import { refererForMediaUrl } from "../lib/mediaUrl";
import { isBrowserTtsTrack, loadTtsChapterText, resolveTtsTrackStorageIndex } from "../lib/browserTtsAudiobook";
import { BrowserTtsPlayer } from "../lib/browserTtsPlayer";
import {
  formatEstimatedRemaining,
  loadTtsPlaybackPosition,
  saveTtsPlaybackPosition,
} from "../lib/ttsProgress";
import { getTtsSettings } from "../lib/ttsSettings";
import TtsVoiceSettings from "./TtsVoiceSettings";
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
import { isFrontMatterTitle, filterPlayableTracks, findFirstNarrativeTrackIndex } from "../lib/audiobookTextFilter";
import {
  clearAudiobookMediaSession,
  setupAudiobookMediaSession,
  updateAudiobookMediaSession,
} from "../lib/audiobookMediaSession";
import {
  clearAudiobookSession,
  loadAudiobookSession,
  saveAudiobookSession,
  snapshotFromBook,
} from "../lib/audiobookSession";

function getInitialAudiobookTrack(
  book: BookMetadata,
  tracks: NonNullable<BookMetadata["audiobookTracks"]>,
  isTtsBook: boolean
): number {
  const session = loadAudiobookSession();
  if (session?.bookId === book.id) {
    return session.trackIndex;
  }

  const savedTrack = book.audiobookCurrentTrack ?? 0;
  const hasProgress =
    (book.audiobookCurrentTime ?? 0) > 5 ||
    (book.progress?.percent ?? 0) > 2;

  if (!isTtsBook || hasProgress) return savedTrack;

  return findFirstNarrativeTrackIndex(tracks);
}

function getInitialAudiobookTime(book: BookMetadata): number {
  const session = loadAudiobookSession();
  if (session?.bookId === book.id) return session.currentTime;
  return book.audiobookCurrentTime || 0;
}

interface AudiobookPlayerProps {
  book: BookMetadata;
  userId?: string;
  grayscaleCovers?: boolean;
  viewMode?: "fullscreen" | "minimized";
  onClose: () => void;
  onMinimize?: () => void;
  onExpand?: () => void;
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

export default function AudiobookPlayer({
  book,
  userId = "",
  grayscaleCovers = false,
  viewMode = "fullscreen",
  onClose,
  onMinimize,
  onExpand,
  onProgressUpdate,
}: AudiobookPlayerProps) {
  const tracks = book.audiobookTracks || [];
  const isTtsBook = book.source === "browser-tts" || tracks.some((track) => isBrowserTtsTrack(track.src));
  const playableTracks = useMemo(
    () => (isTtsBook ? filterPlayableTracks(tracks) : tracks.map((track, index) => ({ track, index }))),
    [isTtsBook, tracks]
  );
  const trackTitles = useMemo(() => tracks.map((track) => track.title), [tracks]);
  const authorLabel = displayAuthor(book.author);
  const audioRef = useRef<HTMLAudioElement>(null);
  const ttsPlayerRef = useRef<BrowserTtsPlayer | null>(null);
  const [currentTrack, setCurrentTrack] = useState(() => getInitialAudiobookTrack(book, tracks, isTtsBook));
  const currentPlayableIndex = useMemo(
    () => playableTracks.findIndex((entry) => entry.index === currentTrack),
    [playableTracks, currentTrack]
  );
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(() => getInitialAudiobookTime(book));
  const [duration, setDuration] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [downloading, setDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState(0);
  const [offlineReady, setOfflineReady] = useState(!!book.audiobookDownloaded || isTtsBook);
  const [localUrls, setLocalUrls] = useState<Record<number, string>>({});
  const [loadingTrack, setLoadingTrack] = useState(false);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [smartSkip, setSmartSkip] = useState<SmartSkipSettings>(() => getSmartSkipSettings());
  const [estimatedRemaining, setEstimatedRemaining] = useState(0);
  const [ttsVoiceName, setTtsVoiceName] = useState("");
  const [showTtsSettings, setShowTtsSettings] = useState(false);
  const [subtitle, setSubtitle] = useState("");
  const [transcriberReady, setTranscriberReady] = useState(false);
  const introSkippedForTrack = useRef<number | null>(null);
  const resumeTimeForTrack = useRef<number | null>(null);
  const outroSkipTriggered = useRef(false);
  const pendingTrackLoad = useRef<{ index: number; resumeTime?: number } | null>(null);
  const currentTrackRef = useRef(currentTrack);
  const goToTrackRef = useRef<(index: number) => void>(() => {});
  const isPlayingRef = useRef(isPlaying);
  const togglePlayRef = useRef<() => void>(() => {});
  currentTrackRef.current = currentTrack;
  isPlayingRef.current = isPlaying;

  const persistProgress = useCallback(
    async (trackIdx: number, time: number, percent?: number, playing = isPlaying) => {
      const trackFraction = duration > 0 ? time / duration : 0;
      const playableIdx = playableTracks.findIndex((entry) => entry.index === trackIdx);
      const computedPercent =
        percent ??
        (playableTracks.length > 0 && playableIdx >= 0
          ? Math.round(((playableIdx + trackFraction) / playableTracks.length) * 100)
          : Math.round(((trackIdx + trackFraction) / Math.max(tracks.length, 1)) * 100));

      const updated: BookMetadata = {
        ...book,
        audiobookCurrentTrack: trackIdx,
        audiobookCurrentTime: time,
        progress: {
          ...book.progress,
          percent: computedPercent,
          lastReadTime: Date.now(),
        },
        dateModified: Date.now(),
      };

      saveAudiobookSession(snapshotFromBook(updated, trackIdx, time, playing));
      onProgressUpdate?.(updated);
      try {
        await syncBookToCloud(userId, updated);
      } catch {
        // offline sync is best-effort
      }
    },
    [book, duration, isPlaying, onProgressUpdate, playableTracks, tracks.length, userId]
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

      const savedPosition = loadTtsPlaybackPosition(book.id, index);
      const session = loadAudiobookSession();
      const sessionResume =
        session?.bookId === book.id && session.trackIndex === index ? session.currentTime : undefined;
      const savedResume =
        resumeTime ??
        sessionResume ??
        savedPosition?.estimatedTime ??
        (book.audiobookCurrentTrack === index && book.audiobookCurrentTime
          ? book.audiobookCurrentTime
          : undefined);
      resumeTimeForTrack.current = savedResume ?? null;

      try {
        const text = await loadTtsChapterText(book, index);
        if (!ttsPlayerRef.current) {
          ttsPlayerRef.current = new BrowserTtsPlayer({
            onTimeUpdate: (time, trackDuration, remaining) => {
              setCurrentTime(time);
              setDuration(trackDuration);
              setEstimatedRemaining(remaining);
              setTtsVoiceName(ttsPlayerRef.current?.voiceName || "");
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
            onPositionChange: (position) => {
              saveTtsPlaybackPosition(book.id, currentTrackRef.current, position);
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
            onSubtitleUpdate: (text) => {
              setSubtitle(text);
              setTranscriberReady(Boolean(text.trim()));
            },
          });
        }

        ttsPlayerRef.current.refreshVoice();
        ttsPlayerRef.current.setRate(speed);
        await ttsPlayerRef.current.loadText(text, savedPosition || savedResume || 0, {
          bookId: book.id,
          trackIndex: resolveTtsTrackStorageIndex(tracks[index], index),
          chapterTitle: tracks[index]?.title,
          quality: getTtsSettings().qualityPreset,
        });
        setTranscriberReady(false);
        setSubtitle("");
        setTtsVoiceName(ttsPlayerRef.current.voiceName);

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
        (() => {
          const session = loadAudiobookSession();
          if (session?.bookId === book.id && session.trackIndex === index) {
            return session.currentTime;
          }
          return book.audiobookCurrentTrack === index && book.audiobookCurrentTime
            ? book.audiobookCurrentTime
            : undefined;
        })();
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
    if (loadingTrack) return;

    if (isTtsBook) {
      if (!ttsPlayerRef.current) {
        await loadTtsTrack(currentTrack, true);
        return;
      }
      if (isPlaying) {
        ttsPlayerRef.current.pause();
        void persistProgress(currentTrack, ttsPlayerRef.current.currentTime || currentTime, undefined, false);
      } else {
        try {
          await ttsPlayerRef.current.play();
        } catch (err) {
          console.error("TTS play failed:", err);
          setPlaybackError("Could not start playback.");
          setIsPlaying(false);
        }
      }
      return;
    }

    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      void persistProgress(currentTrack, audioRef.current.currentTime, undefined, false);
    } else {
      try {
        await audioRef.current.play();
      } catch (err) {
        console.error("Audio play failed:", err);
        setPlaybackError("Could not start playback. Try downloading tracks for offline listening.");
        setIsPlaying(false);
      }
    }
  };
  togglePlayRef.current = togglePlay;

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

  const stopPlayback = useCallback(() => {
    if (isTtsBook) {
      ttsPlayerRef.current?.stop();
    } else {
      audioRef.current?.pause();
    }
    setIsPlaying(false);
    clearAudiobookMediaSession();
    clearAudiobookSession();
  }, [isTtsBook]);

  const handleExit = useCallback(() => {
    const time = isTtsBook
      ? ttsPlayerRef.current?.currentTime || currentTime
      : audioRef.current?.currentTime || currentTime;
    void persistProgress(currentTrack, time, undefined, isPlaying);
    if (isPlaying && onMinimize) {
      onMinimize();
      return;
    }
    stopPlayback();
    onClose();
  }, [currentTime, currentTrack, isPlaying, isTtsBook, onClose, onMinimize, persistProgress, stopPlayback]);

  const currentTrackLabel = cleanTrackTitle(
    tracks[currentTrack]?.title || "",
    currentTrack,
    book.title,
    book.author,
    trackTitles
  );

  useEffect(() => {
    setupAudiobookMediaSession(
      {
        title: isTtsBook && subtitle ? subtitle : currentTrackLabel || book.title,
        artist: authorLabel || book.author || "Kora",
        album: book.title,
        artworkUrl: book.coverUrl,
        duration: duration || 0,
        position: currentTime,
        playbackRate: speed,
        isPlaying,
      },
      {
        onPlay: () => {
          if (!isPlayingRef.current) void togglePlayRef.current?.();
        },
        onPause: () => {
          if (isPlayingRef.current) void togglePlayRef.current?.();
        },
        onSeek: (position) => {
          if (isTtsBook) ttsPlayerRef.current?.seek(position);
          else if (audioRef.current) audioRef.current.currentTime = position;
          setCurrentTime(position);
        },
        onPrevious: () => goToTrackRef.current(Math.max(0, currentTrackRef.current - 1)),
        onNext: () => goToTrackRef.current(Math.min(tracks.length - 1, currentTrackRef.current + 1)),
        onStop: () => stopPlayback(),
      }
    );
    return () => clearAudiobookMediaSession();
  }, [authorLabel, book.coverUrl, book.title, currentTrackLabel, duration, isPlaying, isTtsBook, speed, stopPlayback, subtitle, tracks.length]);

  useEffect(() => {
    updateAudiobookMediaSession({
      title: isTtsBook && subtitle ? subtitle : currentTrackLabel || book.title,
      artist: authorLabel || book.author || "Kora",
      album: book.title,
      artworkUrl: book.coverUrl,
      duration: duration || 0,
      position: currentTime,
      playbackRate: speed,
      isPlaying,
    });
  }, [authorLabel, book.author, book.coverUrl, book.title, currentTime, currentTrackLabel, duration, isPlaying, isTtsBook, speed, subtitle]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      const time = isTtsBook
        ? ttsPlayerRef.current?.currentTime || currentTime
        : audioRef.current?.currentTime || currentTime;
      void persistProgress(currentTrackRef.current, time, undefined, true);
    }, 4000);
    return () => window.clearInterval(timer);
  }, [currentTime, isPlaying, isTtsBook, persistProgress]);

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

  const overallPercent = useMemo(() => {
    const trackFraction = duration > 0 ? currentTime / duration : 0;
    if (playableTracks.length > 0 && currentPlayableIndex >= 0) {
      return Math.round(((currentPlayableIndex + trackFraction) / playableTracks.length) * 100);
    }
    if (!tracks.length) return 0;
    return Math.round(((currentTrack + trackFraction) / tracks.length) * 100);
  }, [currentPlayableIndex, currentTime, currentTrack, duration, playableTracks.length, tracks.length]);

  const transcriberText = isTtsBook
    ? subtitle
    : currentTrackLabel;

  return (
    <>
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
            void persistProgress(currentTrack, 0, 100, false);
          }
        }}
        onPause={() => setIsPlaying(false)}
        onPlay={() => setIsPlaying(true)}
        onError={() => {
          setIsPlaying(false);
          setPlaybackError("Playback failed — the audio source may be unavailable. Try downloading tracks.");
        }}
      />

      {viewMode === "minimized" ? (
        <div className="fixed bottom-[4.75rem] md:bottom-4 left-3 right-3 z-[95] rounded-2xl border border-kindle-border bg-kindle-card/95 backdrop-blur-md shadow-2xl overflow-hidden">
          <div className="flex items-center gap-3 px-3 py-2.5">
            <button onClick={onExpand} className="min-w-0 flex-1 flex items-center gap-3 text-left">
              <div className="w-10 h-10 rounded-xl overflow-hidden bg-kindle-bg border border-kindle-border shrink-0">
                {book.coverUrl ? (
                  <img src={book.coverUrl} alt="" className={`w-full h-full object-cover ${grayscaleCovers ? "grayscale" : ""}`} />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-[10px] font-bold">AB</div>
                )}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-kindle-text truncate">{book.title}</p>
                <p className="text-[10px] text-kindle-text-muted truncate">
                  {isTtsBook ? (transcriberText || "Audio transcriber…") : currentTrackLabel}
                </p>
              </div>
            </button>
            <button
              onClick={() => void togglePlay()}
              className="p-2.5 rounded-full bg-kindle-text text-kindle-bg shrink-0"
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4 ml-0.5" />}
            </button>
            <button
              onClick={() => {
                stopPlayback();
                onClose();
              }}
              className="p-2 rounded-xl text-kindle-text-muted hover:text-kindle-text shrink-0"
              aria-label="Stop"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
          <div className="h-1 bg-kindle-bg">
            <div className="h-full bg-kindle-text transition-all" style={{ width: `${overallPercent}%` }} />
          </div>
        </div>
      ) : (
    <div className="fixed inset-0 z-[100] bg-kindle-bg text-kindle-text flex flex-col">
      <header className="flex items-center justify-between px-3 sm:px-4 py-3 border-b border-kindle-border shrink-0">
        <button
          onClick={handleExit}
          className="p-2 rounded-xl hover:bg-kindle-card transition text-kindle-text-muted hover:text-kindle-text"
          aria-label="Back"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <div className="text-center min-w-0 px-2">
          <p className="text-[9px] font-bold uppercase tracking-[0.25em] text-kindle-text-muted font-lexend">Audiobook</p>
          <p className="text-xs font-lexend font-bold text-kindle-text truncate max-w-[12rem] sm:max-w-xs">{book.title}</p>
        </div>
        <button
          onClick={handleExit}
          className="p-2 rounded-xl hover:bg-kindle-card transition text-kindle-text-muted hover:text-kindle-text"
          aria-label="Close player"
        >
          <X className="w-5 h-5" />
        </button>
      </header>

      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex-1 overflow-y-auto">
          <div className="flex flex-col items-center px-4 sm:px-5 py-5 gap-4 max-w-lg mx-auto w-full">
            <div className="w-full max-w-sm shrink-0">
              <div className="p-3 sm:p-4 rounded-3xl bg-gradient-to-b from-kindle-card to-kindle-bg border border-kindle-border shadow-xl">
                <CassetteVisualizer
                  title={book.title}
                  coverUrl={book.coverUrl}
                  size="player"
                  playing={isPlaying}
                  voiceMode
                  grayscaleCovers={grayscaleCovers}
                />
              </div>
            </div>

            <div className="w-full rounded-2xl border border-kindle-border bg-kindle-card/80 px-4 py-3 min-h-[4.5rem] flex flex-col justify-center gap-1.5">
              <p className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted text-center">
                Audio Transcriber
              </p>
              <p className="text-sm font-serif leading-relaxed text-kindle-text text-center line-clamp-4">
                {isTtsBook
                  ? transcriberText || (transcriberReady ? "" : "Preparing transcription…")
                  : transcriberText || book.title}
              </p>
            </div>

            <div className="text-center w-full space-y-0.5">
              {authorLabel && <p className="text-sm text-kindle-text-muted font-sans">{authorLabel}</p>}
              {isTtsBook && (
                <p className="text-[10px] text-kindle-text-muted font-lexend uppercase tracking-widest">
                  Read aloud · {ttsVoiceName || "device voice"}
                </p>
              )}
              {tracks.length > 0 && (
                <p className="text-[10px] text-kindle-text-muted/80 font-mono tabular-nums">
                  Chapter {(currentPlayableIndex >= 0 ? currentPlayableIndex : currentTrack) + 1} / {playableTracks.length}
                </p>
              )}
              {playbackError && <p className="text-xs text-red-400 mt-2">{playbackError}</p>}
            </div>

            <div className="w-full rounded-2xl border border-kindle-border bg-kindle-card/60 p-4 space-y-3">
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
                className="w-full h-1.5 appearance-none rounded-full bg-kindle-border accent-kindle-text cursor-pointer"
                style={{
                  background: `linear-gradient(to right, var(--theme-text) ${duration ? (currentTime / duration) * 100 : 0}%, color-mix(in srgb, var(--theme-text) 15%, transparent) ${duration ? (currentTime / duration) * 100 : 0}%)`,
                }}
              />
              <div className="flex justify-between text-[11px] text-kindle-text-muted font-mono tabular-nums">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-1.5 bg-kindle-border rounded-full overflow-hidden">
                  <div className="h-full bg-kindle-text transition-all duration-300" style={{ width: `${overallPercent}%` }} />
                </div>
                <span className="text-[10px] text-kindle-text-muted font-mono tabular-nums shrink-0">{overallPercent}%</span>
              </div>
              {isTtsBook && (
                <p className="text-[10px] text-kindle-text-muted text-center font-lexend">
                  ~{formatEstimatedRemaining(estimatedRemaining)} left
                </p>
              )}
            </div>

            <div className="flex items-center justify-center gap-4 sm:gap-6 w-full">
              <button onClick={() => skip(-10)} className="p-2 rounded-xl hover:bg-kindle-card transition text-kindle-text-muted hover:text-kindle-text" title="Back 10 seconds">
                <RotateCcw className="w-5 h-5" />
              </button>
              <button onClick={() => goToTrack(currentTrack - 1)} disabled={currentTrack === 0} className="p-2 rounded-xl hover:bg-kindle-card transition disabled:opacity-30 text-kindle-text-muted hover:text-kindle-text" title="Previous">
                <SkipBack className="w-6 h-6" />
              </button>
              <button
                onClick={togglePlay}
                disabled={loadingTrack || tracks.length === 0}
                className="w-[4.5rem] h-[4.5rem] rounded-full bg-kindle-text text-kindle-bg hover:opacity-90 flex items-center justify-center shadow-lg transition disabled:opacity-50"
                title={isPlaying ? "Pause" : "Play"}
              >
                {loadingTrack ? (
                  <div className="w-6 h-6 border-2 border-kindle-bg/30 border-t-kindle-bg rounded-full animate-spin" />
                ) : isPlaying ? (
                  <Pause className="w-7 h-7 fill-current" />
                ) : (
                  <Play className="w-7 h-7 fill-current ml-0.5" />
                )}
              </button>
              <button onClick={() => goToTrack(currentTrack + 1)} disabled={currentTrack >= tracks.length - 1} className="p-2 rounded-xl hover:bg-kindle-card transition disabled:opacity-30 text-kindle-text-muted hover:text-kindle-text" title="Next">
                <SkipForward className="w-6 h-6" />
              </button>
              <button onClick={() => skip(30)} className="p-2 rounded-xl hover:bg-kindle-card transition text-kindle-text-muted hover:text-kindle-text" title="Forward 30 seconds">
                <RotateCw className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-1.5 flex-wrap justify-center w-full">
              {SPEEDS.map((s) => (
                <button
                  key={s}
                  onClick={() => setSpeed(s)}
                  className={`min-w-[3rem] px-2.5 py-1.5 rounded-lg text-[10px] font-bold font-lexend transition border ${
                    speed === s
                      ? "bg-kindle-text text-kindle-bg border-kindle-text"
                      : "bg-kindle-card text-kindle-text-muted border-kindle-border hover:text-kindle-text"
                  }`}
                >
                  {s}x
                </button>
              ))}
            </div>

            <div className="w-full grid grid-cols-1 sm:grid-cols-2 gap-2">
              <button
                type="button"
                onClick={toggleSmartSkip}
                className={`flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border text-left transition ${
                  smartSkip.enabled
                    ? "bg-kindle-text/10 border-kindle-text/20 text-kindle-text"
                    : "bg-kindle-card border-kindle-border text-kindle-text-muted"
                }`}
              >
                <div className="flex items-center gap-2 min-w-0">
                  <Sparkles className="w-3.5 h-3.5 shrink-0" />
                  <span className="text-[9px] font-bold uppercase tracking-widest font-lexend">Smart Skip</span>
                </div>
                <span className="text-[9px] font-bold uppercase">{smartSkip.enabled ? "On" : "Off"}</span>
              </button>

              {!isTtsBook && (
                <button
                  onClick={handleDownloadAll}
                  disabled={downloading || offlineReady || tracks.length === 0}
                  className="relative overflow-hidden flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl bg-kindle-card border border-kindle-border text-[9px] font-bold uppercase tracking-widest font-lexend transition disabled:opacity-60 text-kindle-text"
                >
                  {downloading && <span className="absolute inset-y-0 left-0 bg-kindle-text/10 transition-all" style={{ width: `${downloadProgress}%` }} />}
                  <span className="relative flex items-center gap-1.5">
                    <Download className="w-3.5 h-3.5" />
                    {offlineReady ? "Offline" : downloading ? `${downloadProgress}%` : "Download"}
                  </span>
                </button>
              )}

              {isTtsBook && (
                <button
                  type="button"
                  onClick={() => setShowTtsSettings((open) => !open)}
                  className="flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl border border-kindle-border bg-kindle-card text-left"
                >
                  <span className="text-[9px] font-bold uppercase tracking-widest font-lexend">Narrator</span>
                  <span className="text-[9px] text-kindle-text-muted">{showTtsSettings ? "Hide" : "Show"}</span>
                </button>
              )}
            </div>

            {isTtsBook && showTtsSettings && (
              <TtsVoiceSettings
                compact
                showQualityPresets
                showTestButton
                onSettingsChange={() => {
                  ttsPlayerRef.current?.refreshVoice();
                  setTtsVoiceName(ttsPlayerRef.current?.voiceName || getTtsSettings().voiceName);
                }}
              />
            )}
          </div>
        </div>

        {tracks.length > 0 && (
          <section className="shrink-0 border-t border-kindle-border bg-kindle-card/80 backdrop-blur-sm px-4 py-3">
            <div className="max-w-lg mx-auto space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-kindle-text-muted font-lexend">Chapters</p>
                <span className="text-[10px] text-kindle-text-muted font-mono tabular-nums">{playableTracks.length}</span>
              </div>
              <div className="max-h-36 overflow-y-auto player-chapter-scroll space-y-1 rounded-xl border border-kindle-border bg-kindle-bg/80 p-1.5">
                {playableTracks.map(({ track, index: idx }, displayIdx) => {
                  const label = cleanTrackTitle(track.title, idx, book.title, book.author, trackTitles);
                  const active = idx === currentTrack;
                  return (
                    <button
                      key={idx}
                      onClick={() => goToTrack(idx)}
                      className={`w-full text-left px-3 py-2 rounded-lg text-xs transition flex items-center gap-3 ${
                        active
                          ? "bg-kindle-text/10 border border-kindle-border text-kindle-text"
                          : "hover:bg-kindle-card text-kindle-text-muted border border-transparent"
                      }`}
                    >
                      <span className={`text-[10px] font-mono tabular-nums w-5 shrink-0 ${active ? "text-kindle-text" : ""}`}>
                        {displayIdx + 1}
                      </span>
                      <span className="truncate flex-1 font-sans">{label}</span>
                      {active && isPlaying && <Play className="w-3 h-3 shrink-0 fill-current" />}
                    </button>
                  );
                })}
              </div>
            </div>
          </section>
        )}
      </div>
    </div>
      )}
    </>
  );
}
