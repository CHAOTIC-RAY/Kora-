import {
  cueTextAtTime,
  getAudiobookTranscript,
  type TranscriptCue,
} from "./audiobookTranscriptStorage";
import {
  enqueueTrackTranscription,
  getTranscriptJob,
  subscribeTranscriptQueue,
} from "./audiobookTranscriptQueue";

export type LiveTranscriberStatus =
  | "idle"
  | "listening"
  | "processing"
  | "unavailable"
  | "error"
  | "ready";

export interface AudiobookLiveTranscriberCallbacks {
  onUpdate?: (text: string) => void;
  onStatus?: (status: LiveTranscriberStatus) => void;
  onError?: (message: string) => void;
  onProgress?: (progress: number) => void;
}

/**
 * Displays on-device transcripts for downloaded MP3 tracks.
 * No Gemini / no cloud API — cues come from the offline Whisper queue
 * that starts as soon as a track finishes downloading.
 */
export class AudiobookLiveTranscriber {
  private audio: HTMLAudioElement | null = null;
  private bookId = "";
  private trackIndex = -1;
  private trackTitle = "";
  private cues: TranscriptCue[] = [];
  private destroyed = false;
  private enabled = true;
  private raf = 0;
  private unsubQueue: (() => void) | null = null;
  private callbacks: AudiobookLiveTranscriberCallbacks;

  constructor(callbacks: AudiobookLiveTranscriberCallbacks = {}) {
    this.callbacks = callbacks;
    this.unsubQueue = subscribeTranscriptQueue((jobs) => {
      if (!this.bookId || this.trackIndex < 0) return;
      const job = jobs.find(
        (entry) => entry.bookId === this.bookId && entry.trackIndex === this.trackIndex
      );
      if (!job) return;
      this.callbacks.onProgress?.(job.progress);
      if (job.status === "processing" || job.status === "pending") {
        this.callbacks.onStatus?.("processing");
        if (!this.cues.length) {
          this.callbacks.onUpdate?.(
            job.progress > 5
              ? `Generating transcript… ${job.progress}%`
              : "Generating on-device transcript…"
          );
        }
      } else if (job.status === "done") {
        void this.reloadCues();
      } else if (job.status === "error" && !this.cues.length) {
        this.callbacks.onStatus?.("error");
        this.callbacks.onError?.(job.error || "Transcript generation failed");
      }
    });
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.stopTicker();
      this.callbacks.onStatus?.("idle");
    } else if (this.audio && !this.audio.paused) {
      this.startTicker();
    }
  }

  attach(
    audio: HTMLAudioElement,
    meta?: { bookId: string; trackIndex: number; trackTitle: string }
  ) {
    if (this.destroyed || !this.enabled) return;

    this.detach(false);
    this.audio = audio;

    if (meta) {
      this.bookId = meta.bookId;
      this.trackIndex = meta.trackIndex;
      this.trackTitle = meta.trackTitle;
      void this.reloadCues();
      // Kick / resume generation if this downloaded track has no transcript yet.
      enqueueTrackTranscription(meta.bookId, meta.trackIndex, meta.trackTitle);
    }

    this.startTicker();
  }

  detach(resetTranscript = true) {
    this.stopTicker();
    if (resetTranscript) {
      this.cues = [];
      this.callbacks.onUpdate?.("");
    }
    this.audio = null;
    this.callbacks.onStatus?.("idle");
  }

  destroy() {
    this.destroyed = true;
    this.detach();
    this.unsubQueue?.();
    this.unsubQueue = null;
  }

  private async reloadCues() {
    if (!this.bookId || this.trackIndex < 0) return;
    const stored = await getAudiobookTranscript(this.bookId, this.trackIndex);
    if (this.destroyed) return;

    if (stored?.status === "ready" && stored.cues.length) {
      this.cues = stored.cues;
      this.callbacks.onStatus?.("ready");
      this.emitFromTime(this.audio?.currentTime || 0);
      return;
    }

    const job = getTranscriptJob(this.bookId, this.trackIndex);
    if (job && (job.status === "pending" || job.status === "processing")) {
      this.callbacks.onStatus?.("processing");
      this.callbacks.onProgress?.(job.progress);
      this.callbacks.onUpdate?.(
        job.progress > 5
          ? `Generating transcript… ${job.progress}%`
          : "Generating on-device transcript…"
      );
      return;
    }

    if (stored?.status === "processing") {
      this.callbacks.onStatus?.("processing");
      this.callbacks.onUpdate?.(`Generating transcript… ${stored.progress || 0}%`);
      return;
    }

    this.callbacks.onStatus?.("idle");
    this.callbacks.onUpdate?.(this.trackTitle || "");
  }

  private startTicker() {
    this.stopTicker();
    const tick = () => {
      if (this.destroyed || !this.audio) return;
      if (this.cues.length) {
        this.emitFromTime(this.audio.currentTime || 0);
        this.callbacks.onStatus?.("listening");
      }
      this.raf = window.requestAnimationFrame(tick);
    };
    this.raf = window.requestAnimationFrame(tick);
  }

  private stopTicker() {
    if (this.raf) {
      window.cancelAnimationFrame(this.raf);
      this.raf = 0;
    }
  }

  private emitFromTime(time: number) {
    const text = cueTextAtTime(this.cues, time);
    if (text) this.callbacks.onUpdate?.(text);
  }
}
