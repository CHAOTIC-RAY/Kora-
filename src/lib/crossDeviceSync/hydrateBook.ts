/**
 * On-demand book file hydration for cross-device sync.
 * Never stores full files in Firebase — re-fetches via mirrors, WebDAV, or URLs.
 */

import type { BookMetadata } from "../firebase";
import { checkBookFileCached, storeBookFile } from "../../db/indexedDB";
import { loadSyncPrefs } from "./syncPrefs";
import { webdavDownloadBook, webdavUploadBook } from "./webdavClient";

export type HydrateSource = "cache" | "webdav" | "md5" | "downloadUrl" | "none";

export interface HydrateResult {
  ok: boolean;
  source: HydrateSource;
  error?: string;
}

export function canHydrateBook(book: BookMetadata): boolean {
  if (book.extension?.toLowerCase() === "audiobook") {
    return Boolean(book.audiobookTracks?.length);
  }
  return Boolean(book.md5 || book.downloadUrl);
}

export function hydrateCapabilityLabel(book: BookMetadata, cached: boolean): string {
  if (cached) return "On this device";
  if (book.extension?.toLowerCase() === "audiobook") {
    return book.audiobookTracks?.length ? "Cloud metadata — tracks need download" : "Cannot sync audio";
  }
  if (book.md5) return "Available via catalog mirrors";
  if (book.downloadUrl) return "Available via saved URL";
  const prefs = loadSyncPrefs();
  if (prefs.webdav.enabled) return "Try WebDAV archive";
  return "No remote file identity";
}

async function fetchViaProxy(url: string, signal?: AbortSignal): Promise<Blob> {
  const res = await fetch(`/api/proxy-file?url=${encodeURIComponent(url)}`, { signal });
  if (!res.ok) {
    let msg = `HTTP ${res.status}`;
    try {
      const data = await res.json();
      if (data?.error) msg = data.error;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  const blob = await res.blob();
  if (!blob.size) throw new Error("Empty file");
  const ct = blob.type || "";
  if (ct.includes("text/html")) throw new Error("Mirror returned HTML instead of a book file");
  return blob;
}

async function hydrateFromMd5(book: BookMetadata, signal?: AbortSignal): Promise<Blob> {
  if (!book.md5) throw new Error("No md5");
  const res = await fetch(`/api/download-options?md5=${encodeURIComponent(book.md5)}`, { signal });
  const data = await res.json();
  const options = data.options || data.downloadLinks || [];
  const direct = options.filter((o: { isDirect?: boolean }) => o.isDirect);
  const finalOptions = direct.length > 0 ? direct : options;
  if (!finalOptions.length) throw new Error("No download mirrors found");

  let lastError: Error | null = null;
  for (let i = 0; i < Math.min(finalOptions.length, 4); i++) {
    try {
      return await fetchViaProxy(finalOptions[i].url, signal);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }
  }
  throw lastError || new Error("All mirrors failed");
}

/**
 * Ensure the ebook blob exists in IndexedDB. Safe to call repeatedly.
 */
export async function hydrateBookFile(
  book: BookMetadata,
  options?: { signal?: AbortSignal; onProgress?: (label: string) => void }
): Promise<HydrateResult> {
  const { signal, onProgress } = options || {};

  if (book.extension?.toLowerCase() === "audiobook") {
    return { ok: false, source: "none", error: "Use audiobook track queue for audio" };
  }

  if (await checkBookFileCached(book.id)) {
    return { ok: true, source: "cache" };
  }

  const prefs = loadSyncPrefs();
  const fileName = book.filename || `${book.title}.${book.extension || "epub"}`;
  const extension = book.extension || "epub";

  const tryStore = async (blob: Blob, source: HydrateSource): Promise<HydrateResult> => {
    await storeBookFile(book.id, blob, fileName, extension);
    if (prefs.pushToWebDav && prefs.webdav.enabled) {
      try {
        onProgress?.("Backing up to WebDAV…");
        await webdavUploadBook(prefs.webdav, book, blob);
      } catch (err) {
        console.warn("WebDAV upload after hydrate failed:", err);
      }
    }
    return { ok: true, source };
  };

  try {
    if (prefs.preferWebDav && prefs.webdav.enabled) {
      onProgress?.("Checking WebDAV archive…");
      try {
        const blob = await webdavDownloadBook(prefs.webdav, book, signal);
        if (blob) return await tryStore(blob, "webdav");
      } catch (err) {
        console.warn("WebDAV hydrate miss:", err);
      }
    }

    if (book.md5) {
      onProgress?.("Fetching from catalog mirrors…");
      const blob = await hydrateFromMd5(book, signal);
      return await tryStore(blob, "md5");
    }

    if (book.downloadUrl) {
      onProgress?.("Fetching from saved URL…");
      const blob = await fetchViaProxy(book.downloadUrl, signal);
      return await tryStore(blob, "downloadUrl");
    }

    if (!prefs.preferWebDav && prefs.webdav.enabled) {
      onProgress?.("Checking WebDAV archive…");
      const blob = await webdavDownloadBook(prefs.webdav, book, signal);
      if (blob) return await tryStore(blob, "webdav");
    }

    return {
      ok: false,
      source: "none",
      error: "No md5, download URL, or WebDAV archive available for this book",
    };
  } catch (err) {
    return {
      ok: false,
      source: "none",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/** After a successful local cache, push to WebDAV if enabled. */
export async function maybePushBookToWebDav(book: BookMetadata, blob: Blob): Promise<void> {
  const prefs = loadSyncPrefs();
  if (!prefs.pushToWebDav || !prefs.webdav.enabled) return;
  await webdavUploadBook(prefs.webdav, book, blob);
}
