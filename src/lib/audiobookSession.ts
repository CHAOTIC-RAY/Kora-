import type { BookMetadata } from "./firebase";

export interface AudiobookSessionSnapshot {
  bookId: string;
  title: string;
  author?: string;
  coverUrl?: string;
  trackIndex: number;
  currentTime: number;
  isPlaying: boolean;
  updatedAt: number;
}

const SESSION_KEY = "kora_audiobook_session";

export function saveAudiobookSession(snapshot: AudiobookSessionSnapshot): void {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore
  }
}

export function loadAudiobookSession(): AudiobookSessionSnapshot | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AudiobookSessionSnapshot;
  } catch {
    return null;
  }
}

export function clearAudiobookSession(): void {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch {
    // ignore
  }
}

export function snapshotFromBook(
  book: BookMetadata,
  trackIndex: number,
  currentTime: number,
  isPlaying: boolean
): AudiobookSessionSnapshot {
  return {
    bookId: book.id,
    title: book.title,
    author: book.author,
    coverUrl: book.coverUrl,
    trackIndex,
    currentTime,
    isPlaying,
    updatedAt: Date.now(),
  };
}
