import { estimateSpeechDurationSeconds } from "./epubTextExtract";

export interface BrowserTtsPlayerCallbacks {
  onTimeUpdate?: (currentTime: number, duration: number) => void;
  onEnded?: () => void;
  onPlay?: () => void;
  onPause?: () => void;
  onError?: (message: string) => void;
}

function splitIntoChunks(text: string): string[] {
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) || [text];
  const chunks: string[] = [];
  let current = "";

  for (const sentence of sentences) {
    const piece = sentence.trim();
    if (!piece) continue;
    if ((current + " " + piece).trim().length > 420 && current) {
      chunks.push(current.trim());
      current = piece;
    } else {
      current = current ? `${current} ${piece}` : piece;
    }
  }

  if (current.trim()) chunks.push(current.trim());
  return chunks.length ? chunks : [text.trim()];
}

export class BrowserTtsPlayer {
  private chunks: string[] = [];
  private chunkDurations: number[] = [];
  private chunkIndex = 0;
  private rate = 1;
  private resumeOffset = 0;
  private playing = false;
  private paused = false;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private callbacks: BrowserTtsPlayerCallbacks = {};
  private selectedVoice: SpeechSynthesisVoice | null = null;

  constructor(callbacks?: BrowserTtsPlayerCallbacks) {
    if (callbacks) this.callbacks = callbacks;
    this.loadDefaultVoice();
  }

  private loadDefaultVoice() {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices();
    this.selectedVoice =
      voices.find((v) => v.lang.startsWith("en") && v.name.includes("Natural")) ||
      voices.find((v) => v.lang.startsWith("en")) ||
      voices[0] ||
      null;
    window.speechSynthesis.onvoiceschanged = () => {
      if (!this.selectedVoice) this.loadDefaultVoice();
    };
  }

  get duration(): number {
    return this.chunkDurations.reduce((sum, value) => sum + value, 0);
  }

  get currentTime(): number {
    const completed = this.chunkDurations
      .slice(0, this.chunkIndex)
      .reduce((sum, value) => sum + value, 0);
    return completed + this.resumeOffset;
  }

  setCallbacks(callbacks: BrowserTtsPlayerCallbacks) {
    this.callbacks = callbacks;
  }

  setRate(rate: number) {
    this.rate = rate;
    if (this.playing && !this.paused) {
      const time = this.currentTime;
      this.stop(false);
      this.seek(time);
      void this.play();
    }
  }

  async loadText(text: string, resumeTime = 0) {
    this.stop(false);
    this.chunks = splitIntoChunks(text);
    this.chunkDurations = this.chunks.map((chunk) => estimateSpeechDurationSeconds(chunk, this.rate));
    this.seek(resumeTime);
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
    this.resumeOffset = index < this.chunks.length ? remaining : 0;
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
      this.callbacks.onPlay?.();
      return;
    }

    this.playing = true;
    this.paused = false;
    this.callbacks.onPlay?.();
    this.startTick();
    await this.speakFromIndex(this.chunkIndex);
  }

  pause() {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.pause();
    this.paused = true;
    this.playing = false;
    this.stopTick();
    this.callbacks.onPause?.();
  }

  stop(notify = true) {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    this.playing = false;
    this.paused = false;
    this.stopTick();
    if (notify) this.callbacks.onPause?.();
  }

  destroy() {
    this.stop(false);
    this.chunks = [];
    this.chunkDurations = [];
    this.chunkIndex = 0;
    this.resumeOffset = 0;
  }

  private startTick() {
    this.stopTick();
    this.tickTimer = setInterval(() => this.emitTime(), 250);
  }

  private stopTick() {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  private emitTime() {
    this.callbacks.onTimeUpdate?.(this.currentTime, this.duration);
  }

  private async speakFromIndex(index: number): Promise<void> {
    if (!this.playing || index >= this.chunks.length) {
      if (this.playing) {
        this.playing = false;
        this.stopTick();
        this.callbacks.onEnded?.();
      }
      return;
    }

    const text = this.chunks[index];
    if (!text) {
      await this.speakFromIndex(index + 1);
      return;
    }

    await new Promise<void>((resolve) => {
      const utterance = new SpeechSynthesisUtterance(text);
      if (this.selectedVoice) utterance.voice = this.selectedVoice;
      utterance.rate = this.rate;

      utterance.onend = () => {
        if (!this.playing) {
          resolve();
          return;
        }
        this.chunkIndex = index + 1;
        this.resumeOffset = 0;
        this.emitTime();
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
