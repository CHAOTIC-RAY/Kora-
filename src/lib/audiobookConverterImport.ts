import { BookMetadata } from "./firebase";
import { getBookFile } from "../db/indexedDB";

const SUPPORTED_EXTENSIONS = new Set(["epub", "pdf", "mobi", "azw3", "txt"]);

export function getEligibleConverterBooks(books: BookMetadata[]): BookMetadata[] {
  return books.filter(
    (book) =>
      book.extension?.toLowerCase() !== "audiobook" &&
      SUPPORTED_EXTENSIONS.has((book.extension || "").toLowerCase())
  );
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
