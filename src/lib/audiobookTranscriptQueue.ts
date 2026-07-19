/**
 * Background queue: after an audiobook track downloads, generate an on-device transcript.
 * No Gemini / no cloud API — local Whisper in the browser.
 */

const QUEUE_KEY = "kora_audiobook_transcript_queue_v1";
const MAX_ATTEMPTS = 2;

export interface TranscriptJob {
  id: string;
  bookId: string;
  trackIndex: number;
  trackTitle: string;
  status: "pending" | "processing" | "done" | "error";
  progress: number;
  message?: string;
  error?: string;
  attempts?: number;
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

function scheduleProcessTranscriptQueue() {
  if (typeof window === "undefined") {
    void processTranscriptQueue();
    return;
  }
  // Defer Whisper load so opening the audiobook player paints first (esp. PWA).
  const start = () => void processTranscriptQueue();
  if ("requestIdleCallback" in window) {
    (window as Window & { requestIdleCallback: (cb: () => void, opts?: IdleRequestOptions) => number }).requestIdleCallback(
      start,
      { timeout: 2500 }
    );
  } else {
    setTimeout(start, 400);
  }
}

export function enqueueTrackTranscription(
  bookId: string,
  trackIndex: number,
  trackTitle: string
): void {
  const queue = loadQueue();
  const id = `${bookId}::${trackIndex}`;
  const existing = queue.find((job) => job.id === id);

  if (existing) {
    if (existing.status === "done" || existing.status === "processing" || existing.status === "pending") {
      scheduleProcessTranscriptQueue();
      return;
    }
    // Allow a manual retry after error (e.g. user reopened the chapter).
    if ((existing.attempts || 0) >= MAX_ATTEMPTS) {
      return;
    }
    existing.status = "pending";
    existing.progress = 0;
    existing.error = undefined;
    existing.message = undefined;
    saveQueue(queue.map((entry) => (entry.id === id ? { ...existing } : entry)));
    scheduleProcessTranscriptQueue();
    return;
  }

  queue.push({
    id,
    bookId,
    trackIndex,
    trackTitle,
    status: "pending",
    progress: 0,
    attempts: 0,
  });
  saveQueue(queue);
  scheduleProcessTranscriptQueue();
}

export async function processTranscriptQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  try {
    while (true) {
      const queue = loadQueue();
      // Only pending — never tight-loop on error (that spammed HF and froze the PWA).
      const job = queue.find(
        (entry) => entry.status === "pending" && (entry.attempts || 0) < MAX_ATTEMPTS
      );
      if (!job) {
        // Mark exhausted pending jobs as error so they don't block forever.
        const exhausted = queue.filter(
          (entry) => entry.status === "pending" && (entry.attempts || 0) >= MAX_ATTEMPTS
        );
        if (exhausted.length) {
          saveQueue(
            queue.map((entry) =>
              exhausted.some((item) => item.id === entry.id)
                ? {
                    ...entry,
                    status: "error" as const,
                    error: entry.error || "Transcription failed after retries",
                    message: entry.message || "Transcription failed after retries",
                  }
                : entry
            )
          );
        }
        break;
      }

      job.status = "processing";
      job.progress = 1;
      job.attempts = (job.attempts || 0) + 1;
      job.error = undefined;
      job.message = "Starting…";
      saveQueue(queue.map((entry) => (entry.id === job.id ? { ...job } : entry)));

      try {
        const { transcribeDownloadedTrack } = await import("./audiobookOfflineTranscriber");
        const result = await transcribeDownloadedTrack(
          job.bookId,
          job.trackIndex,
          job.trackTitle,
          (progress, message) => {
            const latest = loadQueue();
            const current = latest.find((entry) => entry.id === job.id);
            if (!current) return;
            current.progress = progress;
            current.status = "processing";
            if (message) current.message = message;
            saveQueue(latest.map((entry) => (entry.id === job.id ? { ...current } : entry)));
          }
        );

        job.status = result.ok ? "done" : "error";
        job.progress = result.ok ? 100 : 0;
        job.error = result.error;
        job.message = result.ok ? "Transcript ready" : result.error;
      } catch (error) {
        job.status = "error";
        job.progress = 0;
        job.error = (error as Error).message || "Transcription failed";
        job.message = job.error;
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
  // Resume unfinished work after reload — but never re-queue permanent errors in a hot loop.
  const queue = loadQueue().map((job) =>
    job.status === "processing" ? { ...job, status: "pending" as const } : job
  );
  const pending = queue.some((job) => job.status === "pending");
  if (pending) {
    saveQueue(queue);
    const start = () => void processTranscriptQueue();
    if ("requestIdleCallback" in window) {
      (window as Window & { requestIdleCallback: (cb: () => void) => number }).requestIdleCallback(start, {
        timeout: 4000,
      } as IdleRequestOptions);
    } else {
      setTimeout(start, 1200);
    }
  }
}
