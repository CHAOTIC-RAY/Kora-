/**
 * Client-side IndexedDB helper to cache large raw book files (EPUB, PDF) locally
 * allowing high-speed, 100% offline ebook reading.
 */

const DB_NAME = "EbookSyncReaderDB";
const STORE_NAME = "cached_books";
export const AUDIOBOOK_TRACK_STORE = "audiobook_tracks";
const DB_VERSION = 4;
export const TTS_CHAPTER_CACHE_STORE = "tts_chapter_cache";
export const AUDIOBOOK_TRANSCRIPT_STORE = "audiobook_transcripts";

// Phase 2.4: cap offline book storage so it can't grow unbounded (a real "lag"
// cause on cheap phones). When the cached-books store exceeds this, the oldest
// files by savedAt are evicted first (LRU).
const BOOK_CACHE_BUDGET_BYTES = 1500 * 1024 * 1024; // 1.5 GB

/** Sum blob sizes across the cached_books store. */
async function sumBookCacheBytes(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const req = tx.objectStore(STORE_NAME).getAll();
    req.onsuccess = () => {
      const rows = (req.result || []) as CachedBookFile[];
      resolve(rows.reduce((acc, r) => acc + (r?.blob?.size || 0), 0));
    };
    req.onerror = () => reject(req.error);
  });
}

/**
 * Evict the oldest cached books (by savedAt) until total blob bytes drop to or
 * below `targetBytes`. Runs only when we're over budget, so the common case is
 * a no-op. Returns the number of files evicted.
 */
async function evictOldestBooks(db: IDBDatabase, targetBytes: number): Promise<number> {
  const tx = db.transaction(STORE_NAME, "readwrite");
  const store = tx.objectStore(STORE_NAME);
  const all = await new Promise<CachedBookFile[]>((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result || []) as CachedBookFile[]);
    req.onerror = () => reject(req.error);
  });

  let total = all.reduce((acc, r) => acc + (r?.blob?.size || 0), 0);
  if (total <= targetBytes) return 0;

  const byAge = all
    .slice()
    .sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
  let evicted = 0;
  for (const row of byAge) {
    if (total <= targetBytes) break;
    total -= row?.blob?.size || 0;
    store.delete(row.bookId);
    evicted++;
  }
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve(evicted);
    tx.onerror = () => resolve(evicted); // best-effort; don't throw on eviction
  });
}

export function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "bookId" });
      }
      if (!db.objectStoreNames.contains(AUDIOBOOK_TRACK_STORE)) {
        const trackStore = db.createObjectStore(AUDIOBOOK_TRACK_STORE, { keyPath: "trackKey" });
        trackStore.createIndex("bookId", "bookId", { unique: false });
      }
      if (!db.objectStoreNames.contains(TTS_CHAPTER_CACHE_STORE)) {
        db.createObjectStore(TTS_CHAPTER_CACHE_STORE, { keyPath: "cacheKey" });
      }
      if (!db.objectStoreNames.contains(AUDIOBOOK_TRANSCRIPT_STORE)) {
        const transcriptStore = db.createObjectStore(AUDIOBOOK_TRANSCRIPT_STORE, {
          keyPath: "transcriptKey",
        });
        transcriptStore.createIndex("bookId", "bookId", { unique: false });
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
  const record: CachedBookFile = {
    bookId,
    blob,
    fileName,
    extension: extension.toLowerCase(),
    savedAt: Date.now()
  };

  // Phase 2.4: enforce the storage budget. We check total bytes first (cheap
  // path skips eviction when under budget), then evict oldest if over.
  const currentBytes = await sumBookCacheBytes(db);
  if (currentBytes + blob.size > BOOK_CACHE_BUDGET_BYTES) {
    await evictOldestBooks(db, BOOK_CACHE_BUDGET_BYTES - blob.size);
  }

  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
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
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getKey(bookId);
    request.onsuccess = () => resolve(request.result !== undefined);
    request.onerror = () => reject(request.error);
  });
}

/** Cheap existence scan — keys only, never reads book blobs. */
export async function listCachedBookIds(): Promise<string[]> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const request = store.getAllKeys();
    request.onsuccess = () => resolve((request.result || []).map(String));
    request.onerror = () => reject(request.error);
  });
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
