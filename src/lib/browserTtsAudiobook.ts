import { BookMetadata, syncBookToCloud } from "./firebase";
import { storeAudiobookTrack } from "./audiobookStorage";
import { extractEpubChapters, extractTxtChapters, TextChapter } from "./epubTextExtract";
import { pregenerateBookChapters } from "./neuralTtsCache";
import { getTtsSettings } from "./ttsSettings";

export const BROWSER_TTS_PREFIX = "browser-tts://";

export function isBrowserTtsTrack(src: string): boolean {
  return src.startsWith(BROWSER_TTS_PREFIX);
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
