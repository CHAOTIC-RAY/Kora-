import { BookMetadata, syncBookToCloud } from "./firebase";
import { storeAudiobookTrack } from "./audiobookStorage";
import { extractEpubChapters, extractTxtChapters, TextChapter } from "./epubTextExtract";

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
}): Promise<BookMetadata> {
  const audiobookId = `${opts.sourceBook.id}-tts-audiobook`;
  const total = opts.chapters.length;

  for (let i = 0; i < total; i++) {
    const chapter = opts.chapters[i];
    const blob = new Blob([chapter.text], { type: "text/plain;charset=utf-8" });
    await storeAudiobookTrack(audiobookId, chapter.index, chapter.title, blob);
    opts.onProgress?.(`Prepared chapter ${i + 1} of ${total}`, Math.round(((i + 1) / total) * 100));
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
