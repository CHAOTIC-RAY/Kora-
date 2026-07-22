/**
 * Offline storage for audiobook track files and download progress.
 */

import { getDB, AUDIOBOOK_TRACK_STORE } from "../db/indexedDB";
import { resolveApiUrl } from "./capacitorNative";
import { normalizeMediaUrl } from "./mediaUrl";

const TRACK_STORE = AUDIOBOOK_TRACK_STORE;

export interface StoredAudiobookTrack {
  trackKey: string;
  bookId: string;
  index: number;
  title: string;
  blob: Blob;
  savedAt: number;
}

function trackKey(bookId: string, index: number): string {
  return `${bookId}::${index}`;
}

export async function storeAudiobookTrack(
  bookId: string,
  index: number,
  title: string,
  blob: Blob
): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TRACK_STORE, "readwrite");
    const store = tx.objectStore(TRACK_STORE);
    const record: StoredAudiobookTrack = {
      trackKey: trackKey(bookId, index),
      bookId,
      index,
      title,
      blob,
      savedAt: Date.now(),
    };
    const req = store.put(record);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export async function getAudiobookTrack(bookId: string, index: number): Promise<StoredAudiobookTrack | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TRACK_STORE, "readonly");
    const store = tx.objectStore(TRACK_STORE);
    const req = store.get(trackKey(bookId, index));
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

export async function getAudiobookTracksForBook(bookId: string): Promise<StoredAudiobookTrack[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TRACK_STORE, "readonly");
    const store = tx.objectStore(TRACK_STORE);
    const index = store.index("bookId");
    const req = index.getAll(bookId);
    req.onsuccess = () => {
      const tracks = (req.result || []).sort((a, b) => a.index - b.index);
      resolve(tracks);
    };
    req.onerror = () => reject(req.error);
  });
}

export async function deleteAudiobookTracks(bookId: string): Promise<void> {
  const tracks = await getAudiobookTracksForBook(bookId);
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(TRACK_STORE, "readwrite");
    const store = tx.objectStore(TRACK_STORE);
    tracks.forEach((t) => store.delete(t.trackKey));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function isAudiobookFullyDownloaded(bookId: string, totalTracks: number): Promise<boolean> {
  if (totalTracks <= 0) return false;
  const tracks = await getAudiobookTracksForBook(bookId);
  return tracks.length >= totalTracks;
}

export function getProxiedAudioUrl(src: string, referer?: string): string {
  const normalized = normalizeMediaUrl(src);
  const params = new URLSearchParams({ url: normalized });
  if (referer) params.set("referer", referer);
  // Absolute Worker URL required in Capacitor — <audio src> bypasses the fetch shim.
  return resolveApiUrl(`/api/proxy-file?${params.toString()}`);
}

export async function downloadAudiobookTrack(
  bookId: string,
  index: number,
  title: string,
  src: string,
  onProgress?: (pct: number) => void
): Promise<void> {
  const url = getProxiedAudioUrl(src);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Failed to download track: ${title}`);

  const contentLength = parseInt(res.headers.get("content-length") || "0", 10);
  if (!res.body || !contentLength) {
    const blob = await res.blob();
    await storeAudiobookTrack(bookId, index, title, blob);
    onProgress?.(100);
    return;
  }

  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    onProgress?.(Math.round((received / contentLength) * 100));
  }

  const blob = new Blob(chunks, { type: "audio/mpeg" });
  await storeAudiobookTrack(bookId, index, title, blob);
}
