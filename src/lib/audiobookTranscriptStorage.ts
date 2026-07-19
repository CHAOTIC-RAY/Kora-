/**
 * Offline audiobook transcript storage (cued captions per track).
 */

import { getDB } from "../db/indexedDB";

export const AUDIOBOOK_TRANSCRIPT_STORE = "audiobook_transcripts";

export interface TranscriptCue {
  start: number;
  end: number;
  text: string;
}

export interface StoredAudiobookTranscript {
  transcriptKey: string;
  bookId: string;
  trackIndex: number;
  trackTitle: string;
  status: "pending" | "processing" | "ready" | "error";
  progress: number;
  cues: TranscriptCue[];
  fullText: string;
  error?: string;
  updatedAt: number;
}

function transcriptKey(bookId: string, trackIndex: number): string {
  return `${bookId}::${trackIndex}`;
}

export async function ensureTranscriptStore(): Promise<IDBDatabase> {
  // Open via getDB — store is created in DB upgrade (v4+).
  return getDB();
}

export async function getAudiobookTranscript(
  bookId: string,
  trackIndex: number
): Promise<StoredAudiobookTranscript | null> {
  const db = await ensureTranscriptStore();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(AUDIOBOOK_TRANSCRIPT_STORE)) {
      resolve(null);
      return;
    }
    const tx = db.transaction(AUDIOBOOK_TRANSCRIPT_STORE, "readonly");
    const req = tx.objectStore(AUDIOBOOK_TRANSCRIPT_STORE).get(transcriptKey(bookId, trackIndex));
    req.onsuccess = () => resolve((req.result as StoredAudiobookTranscript) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveAudiobookTranscript(
  record: Omit<StoredAudiobookTranscript, "transcriptKey" | "updatedAt"> & { updatedAt?: number }
): Promise<void> {
  const db = await ensureTranscriptStore();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(AUDIOBOOK_TRANSCRIPT_STORE)) {
      resolve();
      return;
    }
    const tx = db.transaction(AUDIOBOOK_TRANSCRIPT_STORE, "readwrite");
    const full: StoredAudiobookTranscript = {
      ...record,
      transcriptKey: transcriptKey(record.bookId, record.trackIndex),
      updatedAt: record.updatedAt || Date.now(),
    };
    const req = tx.objectStore(AUDIOBOOK_TRANSCRIPT_STORE).put(full);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

export function cueTextAtTime(cues: TranscriptCue[], time: number, windowSeconds = 12): string {
  if (!cues.length) return "";
  const active = cues.filter(
    (cue) => cue.start <= time + 0.35 && cue.end >= Math.max(0, time - windowSeconds)
  );
  if (!active.length) {
    const nearby = cues.find((cue) => cue.start >= time) || cues[cues.length - 1];
    return nearby?.text || "";
  }
  return active
    .slice(-4)
    .map((cue) => cue.text)
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}
