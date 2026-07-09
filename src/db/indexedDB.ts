/**
 * Client-side IndexedDB helper to cache large raw book files (EPUB, PDF) locally
 * allowing high-speed, 100% offline ebook reading.
 */

const DB_NAME = "EbookSyncReaderDB";
const STORE_NAME = "cached_books";
const DB_VERSION = 1;

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "bookId" });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

export interface CachedBookFile {
  bookId: string;
  blob: Blob;
  fileName: string;
  extension: string;
  savedAt: number;
}

export async function storeBookFile(bookId: string, blob: Blob, fileName: string, extension: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);

    const record: CachedBookFile = {
      bookId,
      blob,
      fileName,
      extension: extension.toLowerCase(),
      savedAt: Date.now()
    };

    const request = store.put(record);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function getBookFile(bookId: string): Promise<CachedBookFile | null> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.get(bookId);

    request.onsuccess = () => {
      resolve(request.result || null);
    };
    request.onerror = () => reject(request.error);
  });
}

export async function deleteBookFile(bookId: string): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.delete(bookId);

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

export async function checkBookFileCached(bookId: string): Promise<boolean> {
  const file = await getBookFile(bookId);
  return file !== null;
}

export async function clearAllCachedBooks(): Promise<void> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.clear();

    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}
