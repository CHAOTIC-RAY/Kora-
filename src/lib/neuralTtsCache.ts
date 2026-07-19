import { getDB, TTS_CHAPTER_CACHE_STORE } from "../db/indexedDB";
import { buildSpeakChunks, estimateChunkDurationSeconds, SpeakChunk } from "./ttsTextPrep";
import { getEffectiveSpeechRate, getTtsSettings, TtsQualityPreset } from "./ttsSettings";

const CACHE_STORE = TTS_CHAPTER_CACHE_STORE;

export type NeuralChapterStatus = "pending" | "ready" | "failed";

export interface NeuralChapterCache {
  cacheKey: string;
  bookId: string;
  chapterIndex: number;
  status: NeuralChapterStatus;
  chunks: SpeakChunk[];
  estimatedDuration: number;
  updatedAt: number;
  error?: string;
}

async function ensureStore(db: IDBDatabase): Promise<void> {
  if (!db.objectStoreNames.contains(CACHE_STORE)) return;
}

function cacheKey(bookId: string, chapterIndex: number): string {
  return `${bookId}::${chapterIndex}`;
}

export async function getNeuralChapterCache(
  bookId: string,
  chapterIndex: number
): Promise<NeuralChapterCache | null> {
  const db = await getDB();
  await ensureStore(db);
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(CACHE_STORE)) {
      resolve(null);
      return;
    }
    const tx = db.transaction(CACHE_STORE, "readonly");
    const req = tx.objectStore(CACHE_STORE).get(cacheKey(bookId, chapterIndex));
    req.onsuccess = () => resolve((req.result as NeuralChapterCache) || null);
    req.onerror = () => reject(req.error);
  });
}

export async function saveNeuralChapterCache(record: NeuralChapterCache): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    if (!db.objectStoreNames.contains(CACHE_STORE)) {
      resolve();
      return;
    }
    const tx = db.transaction(CACHE_STORE, "readwrite");
    tx.objectStore(CACHE_STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function pregenerateChapterCache(opts: {
  bookId: string;
  chapterIndex: number;
  text: string;
  chapterTitle?: string;
  quality?: TtsQualityPreset;
  onProgress?: (message: string) => void;
}): Promise<NeuralChapterCache> {
  const settings = getTtsSettings();
  const quality = opts.quality || settings.qualityPreset;
  const key = cacheKey(opts.bookId, opts.chapterIndex);

  const pending: NeuralChapterCache = {
    cacheKey: key,
    bookId: opts.bookId,
    chapterIndex: opts.chapterIndex,
    status: "pending",
    chunks: [],
    estimatedDuration: 0,
    updatedAt: Date.now(),
  };
  await saveNeuralChapterCache(pending);

  try {
    opts.onProgress?.("Preparing narration chunks…");
    const chunks = buildSpeakChunks(opts.text, {
      chapterTitle: opts.chapterTitle,
      quality,
      maxChars: quality === "studio" ? 160 : 180,
    });
    const rate = getEffectiveSpeechRate(1);
    const estimatedDuration = chunks.reduce(
      (sum, chunk) => sum + estimateChunkDurationSeconds(chunk, rate, settings.pitch),
      0
    );

    const ready: NeuralChapterCache = {
      cacheKey: key,
      bookId: opts.bookId,
      chapterIndex: opts.chapterIndex,
      status: "ready",
      chunks,
      estimatedDuration,
      updatedAt: Date.now(),
    };
    await saveNeuralChapterCache(ready);
    return ready;
  } catch (error) {
    const failed: NeuralChapterCache = {
      ...pending,
      status: "failed",
      error: error instanceof Error ? error.message : "Pre-generation failed",
      updatedAt: Date.now(),
    };
    await saveNeuralChapterCache(failed);
    throw error;
  }
}

export async function pregenerateBookChapters(opts: {
  bookId: string;
  chapters: { index: number; title: string; text: string }[];
  quality?: TtsQualityPreset;
  onProgress?: (message: string, percent: number) => void;
}): Promise<void> {
  const total = opts.chapters.length;
  for (let i = 0; i < total; i++) {
    const chapter = opts.chapters[i];
    await pregenerateChapterCache({
      bookId: opts.bookId,
      chapterIndex: chapter.index,
      text: chapter.text,
      chapterTitle: chapter.title,
      quality: opts.quality,
      onProgress: (message) =>
        opts.onProgress?.(`Chapter ${i + 1}/${total}: ${message}`, Math.round(((i + 1) / total) * 100)),
    });
    opts.onProgress?.(`Chapter ${i + 1} ready`, Math.round(((i + 1) / total) * 100));
  }
}

export function isStudioPregenerationEnabled(): boolean {
  const settings = getTtsSettings();
  return settings.qualityPreset === "studio" || settings.generationMode === "pregenerate";
}
