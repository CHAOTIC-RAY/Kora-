import { SpeakChunk, buildSpeakChunks, estimateChunkDurationSeconds } from "./ttsTextPrep";
import {
  getEffectiveSpeechRate,
  getTtsSettings,
  resolveSpeechVoice,
  TtsQualityPreset,
} from "./ttsSettings";
import { TtsPlaybackPosition } from "./ttsProgress";
import { getNeuralChapterCache } from "./neuralTtsCache";

export interface BrowserTtsPlayerCallbacks {
  onTimeUpdate?: (currentTime: number, duration: number, estimatedRemaining: number) => void;
  onEnded?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onError?: (message: string) => void;
  onPositionChange?: (position: TtsPlaybackPosition) => void;
  onSubtitleUpdate?: (text: string) => void;
}

interface LoadedChapter {
  chunks: SpeakChunk[];
  chunkDurations: number[];
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function extractSentenceAround(text: string, charIndex: number): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const sentences = normalized.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [normalized];
  let position = 0;
  for (const sentence of sentences) {
    const end = position + sentence.length;
    if (charIndex >= position && charIndex <= end) {
      return sentence.trim();
    }
    position = end;
  }

  const start = Math.max(0, charIndex - 80);
  const snippet = normalized.slice(start, start + 160).trim();
  return snippet.length > 140 ? `${snippet.slice(0, 137)}…` : snippet;
}

export class BrowserTtsPlayer {
  private chunks: SpeakChunk[] = [];
  private chunkDurations: number[] = [];
  private chunkIndex = 0;
  private charOffset = 0;
  private boundaryTime = 0;
  private rate = 1;
  private pitch = 1;
  private playing = false;
  private paused = false;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private callbacks: BrowserTtsPlayerCallbacks = {};
  private selectedVoice: SpeechSynthesisVoice | null = null;
  private wakeLock: WakeLockSentinel | null = null;
  private visibilityHandler: (() => void) | null = null;
  private bookId: string | null = null;
  private trackIndex: number | null = null;
  private quality: TtsQualityPreset = "balanced";

  constructor(callbacks?: BrowserTtsPlayerCallbacks) {
    if (callbacks) this.callbacks = callbacks;
    this.refreshVoice();
    this.bindVisibilityHandler();
  }

  get duration(): number {
    return this.chunkDurations.reduce((sum, value) => sum + value, 0);
  }

  get currentTime(): number {
    const completed = this.chunkDurations
      .slice(0, this.chunkIndex)
      .reduce((sum, value) => sum + value, 0);
    return completed + Math.max(this.boundaryTime, this.estimateOffsetTime());
  }

  get estimatedRemaining(): number {
    return Math.max(0, this.duration - this.currentTime);
  }

  get voiceName(): string {
    return this.selectedVoice?.name || "System voice";
  }

  get playbackPosition(): TtsPlaybackPosition {
    return {
      chunkIndex: this.chunkIndex,
      charOffset: this.charOffset,
      estimatedTime: this.currentTime,
    };
  }

  setCallbacks(callbacks: BrowserTtsPlayerCallbacks) {
    this.callbacks = callbacks;
  }

  refreshVoice() {
    const settings = getTtsSettings();
    this.selectedVoice = resolveSpeechVoice(settings.voiceName);
    this.pitch = settings.pitch;
  }

  setRate(rate: number) {
    this.rate = rate;
    this.rebuildDurations();
    if (this.playing && !this.paused) {
      const time = this.currentTime;
      this.stop(false);
      this.seekToPosition({ chunkIndex: this.chunkIndex, charOffset: this.charOffset, estimatedTime: time });
      void this.play();
    }
  }

  async loadText(
    text: string,
    resume?: TtsPlaybackPosition | number,
    opts?: { bookId?: string; trackIndex?: number; chapterTitle?: string; quality?: TtsQualityPreset }
  ) {
    this.stop(false);
    this.bookId = opts?.bookId ?? null;
    this.trackIndex = opts?.trackIndex ?? null;
    this.quality = opts?.quality || getTtsSettings().qualityPreset;

    const loaded = await this.resolveChapterChunks(text, opts?.chapterTitle);
    this.chunks = loaded.chunks;
    this.chunkDurations = loaded.chunkDurations;
    this.chunkIndex = 0;
    this.charOffset = 0;
    this.boundaryTime = 0;

    if (typeof resume === "number") {
      this.seek(resume);
    } else if (resume) {
      this.seekToPosition(resume);
    }
  }

  seek(seconds: number) {
    const clamped = Math.max(0, Math.min(seconds, this.duration || 0));
    let remaining = clamped;
    let index = 0;

    for (let i = 0; i < this.chunkDurations.length; i++) {
      if (remaining <= this.chunkDurations[i]) {
        index = i;
        break;
      }
      remaining -= this.chunkDurations[i];
      index = i + 1;
    }

    this.chunkIndex = Math.min(index, Math.max(0, this.chunks.length - 1));
    this.boundaryTime = index < this.chunks.length ? remaining : 0;
    this.charOffset = this.estimateCharOffset(this.chunks[this.chunkIndex]?.text || "", remaining);
    this.emitTime();
  }

  seekToPosition(position: TtsPlaybackPosition) {
    this.chunkIndex = Math.min(position.chunkIndex, Math.max(0, this.chunks.length - 1));
    this.charOffset = position.charOffset;
    this.boundaryTime = position.estimatedTime;
    this.emitTime();
  }

  skip(deltaSeconds: number) {
    this.seek(this.currentTime + deltaSeconds);
    if (this.playing && !this.paused) {
      this.stop(false);
      void this.play();
    }
  }

  async play() {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      this.callbacks.onError?.("Text-to-speech is not supported in this browser.");
      return;
    }
    if (!this.chunks.length) return;

    if (this.paused && window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      this.paused = false;
      this.playing = true;
      this.startTick();
      await this.requestWakeLock();
      this.callbacks.onPlay?.();
      return;
    }

    this.playing = true;
    this.paused = false;
    this.callbacks.onPlay?.();
    this.startTick();
    await this.requestWakeLock();
    await this.speakFromIndex(this.chunkIndex);
  }

  pause() {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.pause();
    this.paused = true;
    this.playing = false;
    this.stopTick();
    void this.releaseWakeLock();
    this.callbacks.onPause?.();
    this.emitPosition();
  }

  stop(notify = true) {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.playing = false;
    this.paused = false;
    this.stopTick();
    void this.releaseWakeLock();
    if (notify) this.callbacks.onPause?.();
  }

  destroy() {
    this.stop(false);
    this.unbindVisibilityHandler();
    this.chunks = [];
    this.chunkDurations = [];
    this.chunkIndex = 0;
    this.charOffset = 0;
    this.boundaryTime = 0;
  }

  private async resolveChapterChunks(text: string, chapterTitle?: string): Promise<LoadedChapter> {
    if (this.bookId != null && this.trackIndex != null) {
      const cached = await getNeuralChapterCache(this.bookId, this.trackIndex);
      if (cached?.status === "ready" && cached.chunks.length) {
        return {
          chunks: cached.chunks,
          chunkDurations: cached.chunks.map((chunk) => this.estimateChunkDuration(chunk)),
        };
      }
    }

    const chunks = buildSpeakChunks(text, {
      chapterTitle,
      quality: this.quality,
      maxChars: this.quality === "instant" ? 220 : 170,
    });
    return {
      chunks,
      chunkDurations: chunks.map((chunk) => this.estimateChunkDuration(chunk)),
    };
  }

  private rebuildDurations() {
    this.chunkDurations = this.chunks.map((chunk) => this.estimateChunkDuration(chunk));
  }

  private estimateChunkDuration(chunk: SpeakChunk): number {
    return estimateChunkDurationSeconds(chunk, getEffectiveSpeechRate(this.rate), this.pitch);
  }

  private estimateOffsetTime(): number {
    const chunk = this.chunks[this.chunkIndex];
    if (!chunk) return 0;
    const ratio = chunk.text.length ? this.charOffset / chunk.text.length : 0;
    return (this.chunkDurations[this.chunkIndex] || 0) * ratio;
  }

  private estimateCharOffset(text: string, secondsIntoChunk: number): number {
    const duration = this.chunkDurations[this.chunkIndex] || 1;
    const ratio = Math.max(0, Math.min(1, secondsIntoChunk / duration));
    return Math.floor(text.length * ratio);
  }

  private bindVisibilityHandler() {
    if (typeof document === "undefined") return;
    this.visibilityHandler = () => {
      if (document.hidden && this.playing && !this.paused) {
        this.pause();
      }
    };
    document.addEventListener("visibilitychange", this.visibilityHandler);
  }

  private unbindVisibilityHandler() {
    if (this.visibilityHandler) {
      document.removeEventListener("visibilitychange", this.visibilityHandler);
      this.visibilityHandler = null;
    }
  }

  private async requestWakeLock() {
    try {
      if ("wakeLock" in navigator) {
        this.wakeLock = await navigator.wakeLock.request("screen");
      }
    } catch {
      // optional feature
    }
  }

  private async releaseWakeLock() {
    try {
      await this.wakeLock?.release();
    } catch {
      // ignore
    }
    this.wakeLock = null;
  }

  private startTick() {
    this.stopTick();
    this.tickTimer = setInterval(() => this.emitTime(), 200);
  }

  private stopTick() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private emitSubtitle(charIndex = this.charOffset): void {
    const chunk = this.chunks[this.chunkIndex];
    if (!chunk?.text) {
      this.callbacks.onSubtitleUpdate?.("");
      return;
    }
    this.callbacks.onSubtitleUpdate?.(extractSentenceAround(chunk.text, charIndex));
  }

  private emitTime() {
    this.callbacks.onTimeUpdate?.(this.currentTime, this.duration, this.estimatedRemaining);
    this.emitPosition();
  }

  private emitPosition() {
    this.callbacks.onPositionChange?.(this.playbackPosition);
  }

  private async speakFromIndex(index: number): Promise<void> {
    if (!this.playing || index >= this.chunks.length) {
      if (this.playing) {
        this.playing = false;
        this.stopTick();
        void this.releaseWakeLock();
        this.callbacks.onEnded?.();
      }
      return;
    }

    const chunk = this.chunks[index];
    if (!chunk?.text) {
      await this.speakFromIndex(index + 1);
      return;
    }

    const spokenText =
      index === this.chunkIndex && this.charOffset > 0
        ? chunk.text.slice(this.charOffset)
        : chunk.text;

    await new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(spokenText);
      const settings = getTtsSettings();
      this.refreshVoice();
      if (this.selectedVoice) utterance.voice = this.selectedVoice;
      utterance.rate = getEffectiveSpeechRate(this.rate) * chunk.rateMultiplier;
      utterance.pitch = settings.pitch * chunk.pitchMultiplier;

      utterance.onboundary = (event) => {
        if (event.name !== "word" && event.name !== "sentence") return;
        this.chunkIndex = index;
        this.charOffset = (index === this.chunkIndex ? this.charOffset : 0) + event.charIndex;
        const chunkDuration = this.chunkDurations[index] || 1;
        const ratio = spokenText.length ? event.charIndex / spokenText.length : 0;
        this.boundaryTime = chunkDuration * ratio;
        this.emitSubtitle(this.charOffset);
        this.emitTime();
      };

      utterance.onstart = () => {
        this.chunkIndex = index;
        this.emitSubtitle(this.charOffset);
      };

      utterance.onend = async () => {
        if (!this.playing) {
          resolve();
          return;
        }
        this.chunkIndex = index + 1;
        this.charOffset = 0;
        this.boundaryTime = 0;
        this.emitTime();
        if (chunk.pauseAfterMs > 0) await delay(chunk.pauseAfterMs);
        resolve();
      };

      utterance.onerror = (event) => {
        if (event.error !== "interrupted") {
          this.callbacks.onError?.("Speech playback failed.");
          this.playing = false;
        }
        resolve();
      };

      window.speechSynthesis.speak(utterance);
    });

    if (this.playing) {
      await this.speakFromIndex(index + 1);
    }
  }
}
