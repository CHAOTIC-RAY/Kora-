import { BookMetadata, syncBookToCloud } from "./firebase";
import { getBookFile } from "../db/indexedDB";
import { storeAudiobookTrack, getAudiobookTrack } from "./audiobookStorage";
import { extractEpubChapters, extractTxtChapters, TextChapter } from "./epubTextExtract";
import { pregenerateBookChapters } from "./neuralTtsCache";
import { getTtsSettings } from "./ttsSettings";

export const BROWSER_TTS_PREFIX = "browser-tts://";

export function isBrowserTtsTrack(src: string): boolean {
  return src.startsWith(BROWSER_TTS_PREFIX);
}

export function resolveTtsTrackStorageIndex(
  track: { index?: number; src?: string } | undefined,
  arrayIndex: number
): number {
  if (track?.src) {
    const match = track.src.match(new RegExp(`${BROWSER_TTS_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[^/]+/(\\d+)`));
    if (match?.[1]) return parseInt(match[1], 10);
  }
  if (typeof track?.index === "number") return track.index;
  return arrayIndex;
}

export async function loadTtsChapterText(
  book: BookMetadata,
  arrayIndex: number
): Promise<string> {
  const track = book.audiobookTracks?.[arrayIndex];
  const storageIndex = resolveTtsTrackStorageIndex(track, arrayIndex);
  const stored = await getAudiobookTrack(book.id, storageIndex);
  if (stored?.blob) {
    const text = await stored.blob.text();
    if (text.trim()) return text;
  }

  const sourceBookId = book.id.replace(/-tts-audiobook$/, "");
  if (!sourceBookId || sourceBookId === book.id) {
    throw new Error("Chapter text is missing. Recreate the read-aloud audiobook from Settings.");
  }

  const cached = await getBookFile(sourceBookId);
  if (!cached?.blob) {
    throw new Error("Chapter text is missing. Open the source book once, then recreate read-aloud from Settings.");
  }

  const ext = (cached.extension || "epub").toLowerCase();
  const chapters = await extractBookChapters(cached.blob, ext, book.title.replace(/ \(Read Aloud\)$/i, ""));
  const chapter = chapters.find((entry) => entry.index === storageIndex) || chapters[arrayIndex];
  if (!chapter?.text?.trim()) {
    throw new Error("Chapter text is missing. Recreate the read-aloud audiobook from Settings.");
  }

  await storeAudiobookTrack(book.id, storageIndex, chapter.title, new Blob([chapter.text], { type: "text/plain;charset=utf-8" }));
  return chapter.text;
}

export async function extractBookChapters(
  blob: Blob,
  extension: string,
  fallbackTitle: string
): Promise<TextChapter[]> {
  const ext = extension.toLowerCase();
  if (ext === "epub") return extractEpubChapters(blob);
  if (ext === "txt") return extractTxtChapters(blob, fallbackTitle);
  throw new Error(`Built-in TTS supports EPUB and TXT only (got .${ext}).`);
}

export async function createBrowserTtsAudiobook(opts: {
  sourceBook: BookMetadata;
  chapters: TextChapter[];
  userId?: string;
  onProgress?: (message: string, percent: number) => void;
  onRefreshLibrary?: (uid?: string) => void;
  pregenerate?: boolean;
}): Promise<BookMetadata> {
  const audiobookId = `${opts.sourceBook.id}-tts-audiobook`;
  const total = opts.chapters.length;
  const settings = getTtsSettings();
  const shouldPregenerate = opts.pregenerate ?? settings.generationMode === "pregenerate";

  for (let i = 0; i < total; i++) {
    const chapter = opts.chapters[i];
    const blob = new Blob([chapter.text], { type: "text/plain;charset=utf-8" });
    await storeAudiobookTrack(audiobookId, chapter.index, chapter.title, blob);
    opts.onProgress?.(`Prepared chapter ${i + 1} of ${total}`, Math.round(((i + 1) / total) * 35));
  }

  if (shouldPregenerate) {
    await pregenerateBookChapters({
      bookId: audiobookId,
      chapters: opts.chapters,
      quality: settings.qualityPreset,
      onProgress: (message, percent) =>
        opts.onProgress?.(message, 35 + Math.round(percent * 0.6)),
    });
  }

  const audiobookTracks = opts.chapters.map((chapter) => ({
    index: chapter.index,
    title: chapter.title,
    src: `${BROWSER_TTS_PREFIX}${audiobookId}/${chapter.index}`,
  }));

  const entry: BookMetadata = {
    id: audiobookId,
    title: `${opts.sourceBook.title} (Read Aloud)`,
    author: opts.sourceBook.author || "Unknown",
    coverUrl: opts.sourceBook.coverUrl,
    extension: "audiobook",
    size: "",
    tags: ["audiobook", "browser-tts", ...(opts.sourceBook.tags || []).filter((tag) => tag !== "audiobook")],
    status: "to-read",
    progress: { percent: 0, lastReadTime: Date.now() },
    dateAdded: Date.now(),
    source: "browser-tts",
    description: `Read-aloud audiobook generated in your browser from "${opts.sourceBook.title}".`,
    audiobookTracks,
    audiobookDownloaded: true,
  };

  await syncBookToCloud(opts.userId || "", entry);
  opts.onRefreshLibrary?.(opts.userId);
  return entry;
}
