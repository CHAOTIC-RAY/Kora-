/**
 * Background queue for downloading audiobook tracks for offline playback.
 * Persists to localStorage and processes sequentially with retry.
 */

import { downloadAudiobookTrack, getAudiobookTrack } from "./audiobookStorage";

const QUEUE_KEY = "kora_audiobook_sync_queue_v1";

export interface AudiobookSyncJob {
  id: string;
  bookId: string;
  bookTitle: string;
  trackIndex: number;
  trackTitle: string;
  src: string;
  status: "pending" | "downloading" | "done" | "error";
  progress: number;
  retries: number;
}

type QueueListener = (jobs: AudiobookSyncJob[], overallPct: number) => void;

let processing = false;
const listeners = new Set<QueueListener>();

function loadQueue(): AudiobookSyncJob[] {
  try {
    return JSON.parse(localStorage.getItem(QUEUE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveQueue(jobs: AudiobookSyncJob[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(jobs));
}

function notify() {
  const jobs = loadQueue();
  const total = jobs.length || 1;
  const done = jobs.filter((j) => j.status === "done").length;
  const downloading = jobs.find((j) => j.status === "downloading");
  const partial = downloading ? downloading.progress / 100 / total : 0;
  const overallPct = Math.round(((done + partial) / total) * 100);
  listeners.forEach((fn) => fn(jobs, overallPct));
}

export function subscribeAudiobookSyncQueue(fn: QueueListener): () => void {
  listeners.add(fn);
  notify();
  return () => listeners.delete(fn);
}

export function getAudiobookSyncQueue(): AudiobookSyncJob[] {
  return loadQueue();
}

export function getAudiobookSyncProgress(): number {
  const jobs = loadQueue();
  if (!jobs.length) return 100;
  const total = jobs.length;
  const done = jobs.filter((j) => j.status === "done").length;
  const active = jobs.find((j) => j.status === "downloading");
  const partial = active ? active.progress / 100 / total : 0;
  return Math.round(((done + partial) / total) * 100);
}

export async function enqueueAudiobookDownload(
  bookId: string,
  bookTitle: string,
  tracks: { index: number; title: string; src: string }[]
): Promise<void> {
  const queue = loadQueue().filter((j) => j.bookId !== bookId);
  for (const track of tracks) {
    const existing = await getAudiobookTrack(bookId, track.index);
    if (existing) continue;
    queue.push({
      id: `${bookId}::${track.index}`,
      bookId,
      bookTitle,
      trackIndex: track.index,
      trackTitle: track.title,
      src: track.src,
      status: "pending",
      progress: 0,
      retries: 0,
    });
  }
  saveQueue(queue);
  notify();
  processAudiobookSyncQueue();
}

export async function processAudiobookSyncQueue(): Promise<void> {
  if (processing) return;
  processing = true;

  try {
    while (true) {
      const queue = loadQueue();
      const job = queue.find((j) => j.status === "pending" || j.status === "error");
      if (!job) break;

      job.status = "downloading";
      job.progress = 0;
      saveQueue(queue);
      notify();

      try {
        await downloadAudiobookTrack(job.bookId, job.trackIndex, job.trackTitle, job.src, (pct) => {
          job.progress = pct;
          saveQueue(loadQueue().map((j) => (j.id === job.id ? { ...job } : j)));
          notify();
        });
        job.status = "done";
        job.progress = 100;
      } catch {
        job.retries += 1;
        job.status = job.retries >= 3 ? "error" : "pending";
        job.progress = 0;
      }

      saveQueue(loadQueue().map((j) => (j.id === job.id ? { ...job } : j)));
      notify();
    }

    const remaining = loadQueue();
    if (remaining.every((j) => j.status === "done")) {
      localStorage.removeItem(QUEUE_KEY);
      notify();
    }
  } finally {
    processing = false;
  }
}

export function clearAudiobookSyncQueue(bookId?: string) {
  if (bookId) {
    saveQueue(loadQueue().filter((j) => j.bookId !== bookId));
  } else {
    localStorage.removeItem(QUEUE_KEY);
  }
  notify();
}

// Resume queue on module load
if (typeof window !== "undefined") {
  const q = loadQueue();
  if (q.some((j) => j.status === "pending" || j.status === "downloading")) {
    processAudiobookSyncQueue();
  }
}
