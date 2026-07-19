export type LiveTranscriberStatus = "idle" | "listening" | "processing" | "unavailable" | "error";

export interface AudiobookLiveTranscriberCallbacks {
  onUpdate?: (text: string) => void;
  onStatus?: (status: LiveTranscriberStatus) => void;
  onError?: (message: string) => void;
}

interface AudioTap {
  ctx: AudioContext;
  dest: MediaStreamAudioDestinationNode;
}

const audioTapRegistry = new WeakMap<HTMLAudioElement, AudioTap>();

function pickRecorderMimeType(): string {
  const candidates = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus"];
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) return candidate;
  }
  return "";
}

function captureStreamFromAudio(audio: HTMLAudioElement): MediaStream | null {
  const withCapture = audio as HTMLAudioElement & {
    captureStream?: () => MediaStream;
    mozCaptureStream?: () => MediaStream;
  };
  if (typeof withCapture.captureStream === "function") {
    const stream = withCapture.captureStream();
    if (stream.getAudioTracks().length > 0) return stream;
  }
  if (typeof withCapture.mozCaptureStream === "function") {
    const stream = withCapture.mozCaptureStream();
    if (stream.getAudioTracks().length > 0) return stream;
  }
  return null;
}

function createWebAudioTap(audio: HTMLAudioElement): MediaStream | null {
  try {
    let tap = audioTapRegistry.get(audio);
    if (!tap) {
      const ctx = new AudioContext();
      const source = ctx.createMediaElementSource(audio);
      const dest = ctx.createMediaStreamDestination();
      source.connect(dest);
      source.connect(ctx.destination);
      tap = { ctx, dest };
      audioTapRegistry.set(audio, tap);
    }
    void tap.ctx.resume();
    return tap.dest.stream;
  } catch {
    return null;
  }
}

function getAudioStream(audio: HTMLAudioElement): MediaStream | null {
  return captureStreamFromAudio(audio) || createWebAudioTap(audio);
}

export class AudiobookLiveTranscriber {
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private audio: HTMLAudioElement | null = null;
  private transcript = "";
  private processing = false;
  private queue: Blob[] = [];
  private destroyed = false;
  private enabled = true;
  private callbacks: AudiobookLiveTranscriberCallbacks;

  constructor(callbacks: AudiobookLiveTranscriberCallbacks = {}) {
    this.callbacks = callbacks;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
    if (!enabled) {
      this.stopRecorder();
      this.callbacks.onStatus?.("idle");
    } else if (this.audio && !this.audio.paused) {
      this.startRecorder();
    }
  }

  attach(audio: HTMLAudioElement) {
    if (this.destroyed || !this.enabled) return;
    if (this.audio === audio && this.recorder?.state === "recording") return;

    this.detach(false);
    this.audio = audio;
    this.transcript = "";
    this.callbacks.onUpdate?.("");
    this.startRecorder();
  }

  detach(resetTranscript = true) {
    this.stopRecorder();
    if (resetTranscript) {
      this.transcript = "";
      this.callbacks.onUpdate?.("");
    }
    this.audio = null;
    this.callbacks.onStatus?.("idle");
  }

  destroy() {
    this.destroyed = true;
    this.detach();
    this.queue = [];
  }

  private startRecorder() {
    if (this.destroyed || !this.enabled || !this.audio) return;

    const stream = getAudioStream(this.audio);
    if (!stream || stream.getAudioTracks().length === 0) {
      this.callbacks.onStatus?.("unavailable");
      this.callbacks.onError?.("Live transcription is not supported for this audio source.");
      return;
    }

    if (typeof MediaRecorder === "undefined") {
      this.callbacks.onStatus?.("unavailable");
      this.callbacks.onError?.("MediaRecorder is not available in this browser.");
      return;
    }

    const mimeType = pickRecorderMimeType();

    try {
      this.stream = stream;
      this.recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
      this.recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          void this.enqueueChunk(event.data);
        }
      };
      this.recorder.onerror = () => {
        this.callbacks.onStatus?.("error");
        this.callbacks.onError?.("Recording failed.");
      };
      this.recorder.start(4500);
      this.callbacks.onStatus?.("listening");
    } catch (error) {
      this.callbacks.onStatus?.("unavailable");
      this.callbacks.onError?.((error as Error).message || "Could not start live transcription.");
    }
  }

  private stopRecorder() {
    if (this.recorder && this.recorder.state !== "inactive") {
      try {
        this.recorder.stop();
      } catch {
        // ignore
      }
    }
    this.recorder = null;
    this.stream = null;
  }

  private async enqueueChunk(blob: Blob) {
    if (this.destroyed || !this.enabled) return;
    this.queue.push(blob);
    if (!this.processing) {
      await this.flushQueue();
    }
  }

  private async flushQueue() {
    this.processing = true;
    while (this.queue.length > 0 && !this.destroyed && this.enabled) {
      const blob = this.queue.shift();
      if (!blob) continue;
      this.callbacks.onStatus?.("processing");
      try {
        const text = await this.transcribeBlob(blob);
        if (text) {
          this.transcript = this.mergeSegment(this.transcript, text);
          this.callbacks.onUpdate?.(this.transcript);
        }
      } catch (error) {
        const message = (error as Error).message || "Transcription failed";
        if (/not configured|503|502|500/i.test(message)) {
          this.callbacks.onStatus?.("unavailable");
          this.enabled = false;
          this.callbacks.onError?.(message);
          break;
        }
        this.callbacks.onStatus?.("error");
        this.callbacks.onError?.(message);
      }
    }
    this.processing = false;
    if (this.enabled && this.audio && !this.audio.paused) {
      this.callbacks.onStatus?.("listening");
    } else {
      this.callbacks.onStatus?.("idle");
    }
  }

  private mergeSegment(previous: string, next: string): string {
    const cleanedNext = next.replace(/\s+/g, " ").trim();
    if (!cleanedNext) return previous;
    if (!previous) return cleanedNext;

    const prevWords = previous.split(/\s+/);
    const nextWords = cleanedNext.split(/\s+/);
    let overlap = 0;
    const maxOverlap = Math.min(8, prevWords.length, nextWords.length);
    for (let size = maxOverlap; size > 0; size--) {
      const tail = prevWords.slice(-size).join(" ").toLowerCase();
      const head = nextWords.slice(0, size).join(" ").toLowerCase();
      if (tail && tail === head) {
        overlap = size;
        break;
      }
    }

    const appended = overlap > 0 ? nextWords.slice(overlap).join(" ") : cleanedNext;
    if (!appended) return previous;
    const combined = `${previous} ${appended}`.replace(/\s+/g, " ").trim();
    const sentences = combined.match(/[^.!?…]+[.!?…]+|[^.!?…]+$/g) || [combined];
    return sentences.slice(-3).join(" ").trim();
  }

  private async transcribeBlob(blob: Blob): Promise<string> {
    const buffer = await blob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    const base64 = btoa(binary);
    const response = await fetch("/api/transcribe-audio", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        audio: base64,
        mimeType: blob.type || "audio/webm",
        previousContext: this.transcript.slice(-220),
      }),
    });

    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error(err.error || `Transcription failed (${response.status})`);
    }

    const data = await response.json();
    return typeof data.text === "string" ? data.text : "";
  }
}
