import JSZip from "jszip";
import { BookMetadata, syncBookToCloud } from "./firebase";
import { getBookFile } from "../db/indexedDB";
import { storeAudiobookTrack } from "./audiobookStorage";

export interface ConvertedTrack {
  index: number;
  title: string;
  blob: Blob;
}

export interface ConversionProgress {
  stage: "idle" | "uploading" | "converting" | "downloading" | "importing" | "done" | "error";
  message: string;
  percent: number;
}

const SUPPORTED_EXTENSIONS = new Set(["epub", "pdf", "mobi", "azw3", "txt"]);

export function getEligibleConverterBooks(books: BookMetadata[]): BookMetadata[] {
  return books.filter(
    (book) =>
      book.extension?.toLowerCase() !== "audiobook" &&
      SUPPORTED_EXTENSIONS.has((book.extension || "").toLowerCase())
  );
}

export async function extractAudioTracksFromBlob(
  blob: Blob,
  fileName: string
): Promise<ConvertedTrack[]> {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".zip")) {
    return extractTracksFromZip(blob);
  }
  const title = fileName.replace(/\.[^.]+$/, "") || "Audiobook";
  return [{ index: 1, title, blob }];
}

async function extractTracksFromZip(zipBlob: Blob): Promise<ConvertedTrack[]> {
  const zip = await JSZip.loadAsync(zipBlob);
  const entries = Object.entries(zip.files)
    .filter(([, file]) => !file.dir && /\.(mp3|m4b|wav|flac|ogg)$/i.test(file.name))
    .sort(([a], [b]) => a.localeCompare(b, undefined, { numeric: true }));

  const tracks: ConvertedTrack[] = [];
  for (let i = 0; i < entries.length; i++) {
    const [name, file] = entries[i];
    const blob = await file.async("blob");
    const title = name
      .split("/")
      .pop()!
      .replace(/^\d+[-_.\s]*/, "")
      .replace(/\.[^.]+$/i, "")
      .trim();
    tracks.push({ index: i + 1, title: title || `Part ${i + 1}`, blob });
  }
  return tracks;
}

export async function importConvertedAudiobook(opts: {
  sourceBook: BookMetadata;
  tracks: ConvertedTrack[];
  engine: "voxlibri" | "vocalbook";
  userId?: string;
  onRefreshLibrary?: (uid?: string) => void;
}): Promise<BookMetadata> {
  const audiobookId = `${opts.sourceBook.id}-${opts.engine}-audiobook`;

  for (const track of opts.tracks) {
    await storeAudiobookTrack(audiobookId, track.index, track.title, track.blob);
  }

  const audiobookTracks = opts.tracks.map((track) => ({
    index: track.index,
    title: track.title,
    src: `${opts.engine}://${audiobookId}/${track.index}`,
  }));

  const engineLabel = opts.engine === "voxlibri" ? "VoxLibri" : "VocalBook";
  const audiobookEntry: BookMetadata = {
    id: audiobookId,
    title: `${opts.sourceBook.title} (Audiobook)`,
    author: opts.sourceBook.author || "Unknown",
    coverUrl: opts.sourceBook.coverUrl,
    extension: "audiobook",
    size: "",
    tags: ["audiobook", opts.engine, ...(opts.sourceBook.tags || []).filter((tag) => tag !== "audiobook")],
    status: "to-read",
    progress: { percent: 0, lastReadTime: Date.now() },
    dateAdded: Date.now(),
    source: opts.engine,
    description: `Converted from "${opts.sourceBook.title}" using ${engineLabel}.`,
    audiobookTracks,
    audiobookDownloaded: true,
  };

  await syncBookToCloud(opts.userId || "", audiobookEntry);
  opts.onRefreshLibrary?.(opts.userId);
  return audiobookEntry;
}

export async function loadCachedBookBlob(book: BookMetadata): Promise<{ blob: Blob; fileName: string }> {
  const cached = await getBookFile(book.id);
  if (!cached?.blob) {
    throw new Error("Book file is not cached offline. Open the book once to download it, then retry.");
  }
  const ext = (book.extension || "epub").toLowerCase();
  return {
    blob: cached.blob,
    fileName: cached.fileName || `${book.title}.${ext}`,
  };
}

export async function pollConversionJob<T extends { status: string; progress?: number; message?: string }>(
  fetchStatus: () => Promise<T>,
  opts?: { signal?: AbortSignal; onProgress?: (job: T) => void; intervalMs?: number }
): Promise<T> {
  const interval = opts?.intervalMs ?? 2500;
  while (true) {
    if (opts?.signal?.aborted) throw new Error("Cancelled");
    const job = await fetchStatus();
    opts?.onProgress?.(job);
    if (job.status === "done") return job;
    if (job.status === "failed") {
      throw new Error((job as { error?: string; message?: string }).error || job.message || "Conversion failed");
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}
