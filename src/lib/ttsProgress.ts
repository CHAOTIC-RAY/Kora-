export interface TtsPlaybackPosition {
  chunkIndex: number;
  charOffset: number;
  estimatedTime: number;
}

const PROGRESS_PREFIX = "kora_tts_progress_";

function progressKey(bookId: string, trackIndex: number): string {
  return `${PROGRESS_PREFIX}${bookId}::${trackIndex}`;
}

export function loadTtsPlaybackPosition(
  bookId: string,
  trackIndex: number
): TtsPlaybackPosition | null {
  try {
    const raw = localStorage.getItem(progressKey(bookId, trackIndex));
    if (!raw) return null;
    return JSON.parse(raw) as TtsPlaybackPosition;
  } catch {
    return null;
  }
}

export function saveTtsPlaybackPosition(
  bookId: string,
  trackIndex: number,
  position: TtsPlaybackPosition
): void {
  try {
    localStorage.setItem(progressKey(bookId, trackIndex), JSON.stringify(position));
  } catch {
    // ignore
  }
}

export function clearTtsPlaybackPosition(bookId: string, trackIndex: number): void {
  try {
    localStorage.removeItem(progressKey(bookId, trackIndex));
  } catch {
    // ignore
  }
}

export function formatEstimatedRemaining(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "0:00";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m}:${s.toString().padStart(2, "0")}`;
}
