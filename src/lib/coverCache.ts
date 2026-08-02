/**
 * Offline cover image cache (IndexedDB blobs + object URLs).
 */

const DB_NAME = "KoraCoverCache";
const STORE = "covers";
const DB_VERSION = 1;

// Phase 2.4: cap the cover cache so it can't grow unbounded on device storage.
// When total stored bytes exceed this, the oldest covers (by savedAt) are
// evicted first (LRU).
const COVER_CACHE_BUDGET_BYTES = 200 * 1024 * 1024; // 200 MB

interface CoverRecord {
  urlKey: string;
  blob: Blob;
  savedAt: number;
  contentType?: string;
}

const objectUrlCache = new Map<string, string>();

function urlKey(url: string): string {
  return url.trim();
}

async function openCoverDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "urlKey" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function getRecord(key: string): Promise<CoverRecord | null> {
  const db = await openCoverDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve((req.result as CoverRecord) || null);
    req.onerror = () => reject(req.error);
  });
}

/** Sum stored cover bytes so we can enforce the budget (Phase 2.4). */
async function sumCoverBytes(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).getAll();
    req.onsuccess = () => {
      const rows = (req.result || []) as CoverRecord[];
      resolve(rows.reduce((acc, r) => acc + (r?.blob?.size || 0), 0));
    };
    req.onerror = () => reject(req.error);
  });
}

/** Evict oldest covers (by savedAt) until total bytes drop to <= target. */
async function evictOldestCovers(db: IDBDatabase, target: number): Promise<void> {
  const tx = db.transaction(STORE, "readwrite");
  const store = tx.objectStore(STORE);
  const all = await new Promise<CoverRecord[]>((resolve, reject) => {
    const req = store.getAll();
    req.onsuccess = () => resolve((req.result || []) as CoverRecord[]);
    req.onerror = () => reject(req.error);
  });
  let total = all.reduce((acc, r) => acc + (r?.blob?.size || 0), 0);
  if (total <= target) return;
  const byAge = all.slice().sort((a, b) => (a.savedAt || 0) - (b.savedAt || 0));
  for (const row of byAge) {
    if (total <= target) break;
    total -= row?.blob?.size || 0;
    store.delete(row.urlKey);
  }
  return new Promise((resolve) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => resolve();
  });
}

async function putRecord(record: CoverRecord): Promise<void> {
  const db = await openCoverDB();
  const current = await sumCoverBytes(db);
  if (current + record.blob.size > COVER_CACHE_BUDGET_BYTES) {
    await evictOldestCovers(db, COVER_CACHE_BUDGET_BYTES - record.blob.size);
  }
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(record);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

/** Resolve a displayable cover URL, preferring offline cache. */
export async function resolveCachedCoverSrc(displayUrl: string | null | undefined): Promise<string | null> {
  if (!displayUrl) return null;
  const key = urlKey(displayUrl);

  const existing = objectUrlCache.get(key);
  if (existing) return existing;

  try {
    const cached = await getRecord(key);
    if (cached?.blob) {
      const obj = URL.createObjectURL(cached.blob);
      objectUrlCache.set(key, obj);
      return obj;
    }
  } catch {
    /* fall through to network */
  }

  // Warm cache in background for remote/proxy URLs
  if (key.startsWith("/") || /^https?:\/\//i.test(key) || key.startsWith("blob:") || key.startsWith("data:")) {
    void warmCoverCache(key);
  }

  return displayUrl;
}

export async function warmCoverCache(displayUrl: string): Promise<void> {
  const key = urlKey(displayUrl);
  if (key.startsWith("data:") || key.startsWith("blob:")) return;

  try {
    const existing = await getRecord(key);
    if (existing?.blob && Date.now() - existing.savedAt < 7 * 24 * 60 * 60 * 1000) return;

    const res = await fetch(key, { credentials: "same-origin" });
    if (!res.ok) return;
    const blob = await res.blob();
    if (!blob.size || blob.size > 4 * 1024 * 1024) return;
    await putRecord({
      urlKey: key,
      blob,
      savedAt: Date.now(),
      contentType: blob.type,
    });
    const prev = objectUrlCache.get(key);
    if (prev) URL.revokeObjectURL(prev);
    objectUrlCache.set(key, URL.createObjectURL(blob));
  } catch {
    /* offline / blocked */
  }
}

export function revokeCoverObjectUrls() {
  for (const url of objectUrlCache.values()) URL.revokeObjectURL(url);
  objectUrlCache.clear();
}
