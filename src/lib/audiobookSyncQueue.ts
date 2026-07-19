/**
 * Background queue for downloading audiobook tracks for offline playback.
 * Uses the service worker when available so downloads survive app exit.
 */

import { downloadAudiobookTrack, getAudiobookTrack, storeAudiobookTrack } from "./audiobookStorage";
import { refererForMediaUrl } from "./mediaUrl";
import { getProxiedAudioUrl } from "./audiobookStorage";
import { handoffAudiobookTrackDownload } from "./swBridge";

const QUEUE_KEY = "kora_audiobook_sync_queue_v1";

export interface AudiobookSyncJob {
  id: string;
  bookId: string;
  bookTitle: string;
  trackIndex: number;
  trackTitle: string;
  src: string;
  status: "pending" | "downloading" | "error" | "done";
  progress: number;
  retries: number;
  swBacked?: boolean;
}

type QueueListener = (jobs: AudiobookSyncJob[], overallPct: number) => void;

let processing = false;
const listeners = new Set<QueueListener>();
const swJobWaiters = new Map<
  string,
  {
    resolve: () => void;
    reject: (error: Error) => void;
    onProgress?: (pct: number) => void;
  }
>();

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

export function handleAudiobookSwMessage(data: {
  type: string;
  jobId?: string;
  bookId?: string;
  percent?: number | null;
  error?: string;
}) {
  if (!data.jobId) return;

  if (data.type === "audiobook-track-progress") {
    const waiter = swJobWaiters.get(data.jobId);
    waiter?.onProgress?.(typeof data.percent === "number" ? data.percent : 0);
    const queue = loadQueue();
    const job = queue.find((j) => j.id === data.jobId);
    if (job) {
      job.progress = typeof data.percent === "number" ? data.percent : job.progress;
      saveQueue(queue);
      notify();
    }
    return;
  }

  if (data.type === "audiobook-track-error") {
    const waiter = swJobWaiters.get(data.jobId);
    waiter?.reject(new Error(data.error || "Download failed"));
    swJobWaiters.delete(data.jobId);
    return;
  }

  if (data.type === "audiobook-track-complete") {
    const waiter = swJobWaiters.get(data.jobId);
    waiter?.resolve();
    swJobWaiters.delete(data.jobId);
  }
}

export async function ingestAudiobookTrackFromSw(
  jobId: string,
  bookId: string,
  trackIndex: number,
  trackTitle: string
): Promise<void> {
  const res = await fetch(`/__kora_sw_pickup__?id=${encodeURIComponent(jobId)}`);
  if (!res.ok) throw new Error("Audiobook pickup failed");
  const blob = await res.blob();
  await storeAudiobookTrack(bookId, trackIndex, trackTitle, blob);
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.controller?.postMessage({ type: "pickup-complete", jobId });
  }
}

async function downloadTrack(job: AudiobookSyncJob, onProgress?: (pct: number) => void): Promise<void> {
  const proxyUrl = getProxiedAudioUrl(job.src, refererForMediaUrl(job.src));
  const handedOff = await handoffAudiobookTrackDownload({
    jobId: job.id,
    bookId: job.bookId,
    bookTitle: job.bookTitle,
    trackIndex: job.trackIndex,
    trackTitle: job.trackTitle,
    proxyUrl,
  });

  if (!handedOff) {
    await downloadAudiobookTrack(job.bookId, job.trackIndex, job.trackTitle, job.src, onProgress);
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      if (swJobWaiters.has(job.id)) {
        swJobWaiters.delete(job.id);
        reject(new Error("Audiobook download timed out"));
      }
    }, 30 * 60 * 1000);

    swJobWaiters.set(job.id, {
      resolve: () => {
        window.clearTimeout(timeout);
        resolve();
      },
      reject: (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
      onProgress,
    });
  });

  await ingestAudiobookTrackFromSw(job.id, job.bookId, job.trackIndex, job.trackTitle);
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
      job.swBacked = true;
      saveQueue(queue);
      notify();

      try {
        await downloadTrack(job, (pct) => {
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

if (typeof window !== "undefined") {
  const q = loadQueue();
  if (q.some((j) => j.status === "pending" || j.status === "downloading")) {
    for (const job of q) {
      if (job.status === "downloading") job.status = "pending";
    }
    saveQueue(q);
    processAudiobookSyncQueue();
  }
}
