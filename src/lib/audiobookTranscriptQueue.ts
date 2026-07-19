/**
 * Background queue: after an audiobook track downloads, generate an on-device transcript.
 * No Gemini / no cloud API — local Whisper in the browser.
 */

import { transcribeDownloadedTrack } from "./audiobookOfflineTranscriber";

const QUEUE_KEY = "kora_audiobook_transcript_queue_v1";

export interface TranscriptJob {
  id: string;
  bookId: string;
  trackIndex: number;
  trackTitle: string;
  status: "pending" | "processing" | "done" | "error";
  progress: number;
  error?: string;
}

type Listener = (jobs: TranscriptJob[]) => void;

const listeners = new Set<Listener>();
let processing = false;

function loadQueue(): TranscriptJob[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveQueue(jobs: TranscriptJob[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(jobs));
  listeners.forEach((fn) => fn(jobs));
}

export function subscribeTranscriptQueue(fn: Listener): () => void {
  listeners.add(fn);
  fn(loadQueue());
  return () => listeners.delete(fn);
}

export function getTranscriptQueue(): TranscriptJob[] {
  return loadQueue();
}

export function getTranscriptJob(bookId: string, trackIndex: number): TranscriptJob | undefined {
  return loadQueue().find((job) => job.bookId === bookId && job.trackIndex === trackIndex);
}

export function enqueueTrackTranscription(
  bookId: string,
  trackIndex: number,
  trackTitle: string
): void {
  const queue = loadQueue();
  const id = `${bookId}::${trackIndex}`;
  const existing = queue.find((job) => job.id === id);
  if (existing && (existing.status === "done" || existing.status === "processing" || existing.status === "pending")) {
    processTranscriptQueue();
    return;
  }

  queue.push({
    id,
    bookId,
    trackIndex,
    trackTitle,
    status: "pending",
    progress: 0,
  });
  saveQueue(queue);
  processTranscriptQueue();
}

export async function processTranscriptQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  try {
    while (true) {
      const queue = loadQueue();
      const job = queue.find((entry) => entry.status === "pending" || entry.status === "error");
      if (!job) break;

      job.status = "processing";
      job.progress = 1;
      job.error = undefined;
      saveQueue(queue.map((entry) => (entry.id === job.id ? { ...job } : entry)));

      try {
        const result = await transcribeDownloadedTrack(
          job.bookId,
          job.trackIndex,
          job.trackTitle,
          (progress) => {
            const latest = loadQueue();
            const current = latest.find((entry) => entry.id === job.id);
            if (!current) return;
            current.progress = progress;
            current.status = "processing";
            saveQueue(latest.map((entry) => (entry.id === job.id ? { ...current } : entry)));
          }
        );

        job.status = result.ok ? "done" : "error";
        job.progress = result.ok ? 100 : 0;
        job.error = result.error;
      } catch (error) {
        job.status = "error";
        job.progress = 0;
        job.error = (error as Error).message || "Transcription failed";
      }

      saveQueue(loadQueue().map((entry) => (entry.id === job.id ? { ...job } : entry)));
    }

    const remaining = loadQueue().filter((job) => job.status !== "done");
    if (!remaining.length) {
      localStorage.removeItem(QUEUE_KEY);
      listeners.forEach((fn) => fn([]));
    }
  } finally {
    processing = false;
  }
}

if (typeof window !== "undefined") {
  const pending = loadQueue().some((job) => job.status === "pending" || job.status === "processing");
  if (pending) {
    const queue = loadQueue().map((job) =>
      job.status === "processing" ? { ...job, status: "pending" as const } : job
    );
    saveQueue(queue);
    void processTranscriptQueue();
  }
}
