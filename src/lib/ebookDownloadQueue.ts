/**
 * Ebook download queue with ordered processing (pairs with SW Range resume).
 */

export type EbookQueueStatus = "queued" | "active" | "paused" | "done" | "error" | "cancelled";

export interface EbookQueueItem {
  id: string;
  bookId: string;
  title: string;
  url: string;
  status: EbookQueueStatus;
  addedAt: number;
  error?: string;
  progress?: number;
}

const QUEUE_KEY = "kora_ebook_download_queue";
type Listener = (items: EbookQueueItem[]) => void;

const listeners = new Set<Listener>();

function loadQueue(): EbookQueueItem[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as EbookQueueItem[];
  } catch {
    return [];
  }
}

function saveQueue(items: EbookQueueItem[]) {
  localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  listeners.forEach((fn) => fn(items));
}

export function getEbookDownloadQueue(): EbookQueueItem[] {
  return loadQueue();
}

export function subscribeEbookDownloadQueue(fn: Listener): () => void {
  listeners.add(fn);
  fn(loadQueue());
  return () => listeners.delete(fn);
}

export function enqueueEbookDownload(item: Omit<EbookQueueItem, "status" | "addedAt" | "id"> & { id?: string }): EbookQueueItem {
  const queue = loadQueue();
  const existing = queue.find((q) => q.bookId === item.bookId && (q.status === "queued" || q.status === "active"));
  if (existing) return existing;

  const entry: EbookQueueItem = {
    id: item.id || `ebook-${item.bookId}-${Date.now()}`,
    bookId: item.bookId,
    title: item.title,
    url: item.url,
    status: "queued",
    addedAt: Date.now(),
    progress: 0,
  };
  queue.push(entry);
  saveQueue(queue);
  return entry;
}

export function updateEbookQueueItem(id: string, patch: Partial<EbookQueueItem>) {
  const queue = loadQueue().map((item) => (item.id === id ? { ...item, ...patch } : item));
  saveQueue(queue);
}

export function removeEbookQueueItem(id: string) {
  saveQueue(loadQueue().filter((item) => item.id !== id));
}

export function peekNextQueuedEbook(): EbookQueueItem | null {
  return loadQueue().find((item) => item.status === "queued") || null;
}

export function clearFinishedEbookDownloads() {
  saveQueue(loadQueue().filter((item) => item.status === "queued" || item.status === "active" || item.status === "paused"));
}
