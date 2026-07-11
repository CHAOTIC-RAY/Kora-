/**
 * Helper utility to manage local download directories using the File System Access API.
 * Provides fallback simulated folder management for restricted environments like sandboxed iframes.
 */

import { BookMetadata } from "./firebase";
import { storeBookFile } from "../db/indexedDB";
import { inferBookTags } from "./tagsHelper";

const DB_NAME = "EbookSyncReaderDB";
const HANDLES_STORE = "directory_handles_store";

// Initialize a separate DB/Store for Handles to avoid conflicts
function getHandlesDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open("KoraHandlesDB", 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(HANDLES_STORE)) {
        db.createObjectStore(HANDLES_STORE);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

/**
 * Retrieve the saved Directory Handle from IndexedDB
 */
export async function getSavedDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const db = await getHandlesDB();
    return new Promise((resolve) => {
      const tx = db.transaction(HANDLES_STORE, "readonly");
      const store = tx.objectStore(HANDLES_STORE);
      const req = store.get("download_dir");
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch (e) {
    console.warn("Handles DB not supported:", e);
    return null;
  }
}

/**
 * Save Directory Handle to IndexedDB
 */
export async function saveDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  const db = await getHandlesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLES_STORE, "readwrite");
    const store = tx.objectStore(HANDLES_STORE);
    const req = store.put(handle, "download_dir");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Clear the saved Directory Handle from IndexedDB
 */
export async function clearDirectoryHandle(): Promise<void> {
  const db = await getHandlesDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(HANDLES_STORE, "readwrite");
    const store = tx.objectStore(HANDLES_STORE);
    const req = store.delete("download_dir");
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

/**
 * Write a downloaded ebook file directly to the real local system directory
 */
export async function saveFileToDirectory(
  handle: FileSystemDirectoryHandle,
  fileName: string,
  blob: Blob
): Promise<boolean> {
  try {
    // Request readwrite permission
    const opts = { mode: "readwrite" as const };
    const permission = await (handle as any).queryPermission(opts);
    if (permission !== "granted") {
      const request = await (handle as any).requestPermission(opts);
      if (request !== "granted") {
        console.warn("Permission to write to directory was denied.");
        return false;
      }
    }

    const fileHandle = await handle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(blob);
    await writable.close();
    console.log(`Successfully saved "${fileName}" to local directory.`);
    return true;
  } catch (err) {
    console.error("Error saving file to local directory:", err);
    return false;
  }
}

/**
 * Analyzes the selected folder for new EPUB or PDF books on load
 */
export async function scanDirectoryForNewBooks(
  handle: FileSystemDirectoryHandle,
  existingBooks: BookMetadata[],
  userId: string,
  onImportBook: (book: BookMetadata) => void
): Promise<number> {
  let importedCount = 0;
  try {
    const opts = { mode: "read" as const };
    if (await (handle as any).queryPermission(opts) !== "granted") {
      if (await (handle as any).requestPermission(opts) !== "granted") {
        console.warn("Permission to scan folder was denied.");
        return 0;
      }
    }

    const existingIds = new Set(existingBooks.map((b) => b.id));
    const existingTitles = new Set(existingBooks.map((b) => b.title.toLowerCase().trim()));

    // Iterate through directory entries
    for await (const entry of (handle as any).values()) {
      if (entry.kind === "file") {
        const ext = entry.name.split(".").pop()?.toLowerCase();
        if (ext === "epub" || ext === "pdf") {
          const titleWithoutExt = entry.name.replace(/\.[^/.]+$/, "").replace(/[_-]/g, " ");
          const normalizedTitle = titleWithoutExt.toLowerCase().trim();

          // Skip if already in library
          if (existingTitles.has(normalizedTitle)) continue;

          // Get file blob to store locally in IndexedDB
          const file = await entry.getFile();
          const bookId = "local_" + Math.random().toString(36).substring(7);

          const arrayBuffer = await file.arrayBuffer();
          const fileBlob = new Blob([arrayBuffer], { type: ext === "pdf" ? "application/pdf" : "application/epub+zip" });

          await storeBookFile(bookId, fileBlob, file.name, ext);

          const newBook: BookMetadata = {
            id: bookId,
            title: titleWithoutExt,
            author: "Local Import",
            extension: ext,
            size: `${(file.size / (1024 * 1024)).toFixed(1)} MB`,
            language: "English",
            tags: inferBookTags(titleWithoutExt, "Local Import", ext),
            status: "to-read",
            progress: { percent: 0, lastReadTime: Date.now() },
            dateAdded: Date.now()
          };

          onImportBook(newBook);
          importedCount++;
        }
      }
    }
  } catch (err) {
    console.error("Failed to scan folder:", err);
  }
  return importedCount;
}

/**
 * SIMULATED ENVIRONMENT ENGINE
 * Supports sandboxed iframe execution by keeping a virtual directory of books
 */
export interface VirtualBookFile {
  name: string;
  size: string;
  author: string;
  extension: "epub" | "pdf";
  contentBase64?: string; // Mock binary content
}

// Default mock files pre-placed in the virtual folder
const DEFAULT_VIRTUAL_FILES: VirtualBookFile[] = [
  {
    name: "The Odyssey",
    size: "1.2 MB",
    author: "Homer",
    extension: "epub"
  },
  {
    name: "Beyond Good and Evil",
    size: "0.8 MB",
    author: "Friedrich Nietzsche",
    extension: "epub"
  }
];

export function getVirtualDirectoryPath(): string {
  return localStorage.getItem("kora_virtual_dir_path") || "~/Downloads/Kora";
}

export function setVirtualDirectoryPath(path: string): void {
  localStorage.setItem("kora_virtual_dir_path", path);
}

export function getVirtualDirectoryFiles(): VirtualBookFile[] {
  const stored = localStorage.getItem("kora_virtual_dir_files");
  if (!stored) {
    localStorage.setItem("kora_virtual_dir_files", JSON.stringify(DEFAULT_VIRTUAL_FILES));
    return DEFAULT_VIRTUAL_FILES;
  }
  return JSON.parse(stored);
}

export function addVirtualDirectoryFile(file: VirtualBookFile): void {
  const files = getVirtualDirectoryFiles();
  files.push(file);
  localStorage.setItem("kora_virtual_dir_files", JSON.stringify(files));
}

export function removeVirtualDirectoryFile(index: number): void {
  const files = getVirtualDirectoryFiles();
  files.splice(index, 1);
  localStorage.setItem("kora_virtual_dir_files", JSON.stringify(files));
}

export async function scanVirtualDirectory(
  existingBooks: BookMetadata[],
  onImportBook: (book: BookMetadata) => void
): Promise<number> {
  const virtualFiles = getVirtualDirectoryFiles();
  const existingTitles = new Set(existingBooks.map((b) => b.title.toLowerCase().trim()));
  let importedCount = 0;

  for (const file of virtualFiles) {
    const normalizedTitle = file.name.toLowerCase().trim();
    if (!existingTitles.has(normalizedTitle)) {
      // Create a mock epub/pdf blob
      const mockBlob = new Blob([`Mock ebook content for ${file.name}`], { type: file.extension === "pdf" ? "application/pdf" : "application/epub+zip" });
      const bookId = "virtual_" + Math.random().toString(36).substring(7);

      await storeBookFile(bookId, mockBlob, `${file.name}.${file.extension}`, file.extension);

      const newBook: BookMetadata = {
        id: bookId,
        title: file.name,
        author: file.author || "Unknown",
        extension: file.extension,
        size: file.size,
        language: "English",
        tags: inferBookTags(file.name, file.author || "Unknown", file.extension),
        status: "to-read",
        progress: { percent: 0, lastReadTime: Date.now() },
        dateAdded: Date.now()
      };

      onImportBook(newBook);
      importedCount++;
    }
  }

  return importedCount;
}
