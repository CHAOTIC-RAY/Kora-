import { initializeApp, getApps, getApp } from "firebase/app";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  deleteDoc,
  query,
  where,
} from "firebase/firestore";
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  signOut,
  User
} from "firebase/auth";
import { mergeReadingProgress } from "./progressMerge";
import rawFirebaseConfig from "../../firebase-applet-config.json";

// Resilient configuration loading using local config
const firebaseConfig = {
  apiKey: rawFirebaseConfig.apiKey,
  authDomain: rawFirebaseConfig.authDomain,
  projectId: rawFirebaseConfig.projectId,
  storageBucket: rawFirebaseConfig.storageBucket,
  messagingSenderId: rawFirebaseConfig.messagingSenderId,
  appId: rawFirebaseConfig.appId,
};

let app;
let db: any = null;
let auth: any = null;
let isRealFirebase = false;

let initialized = false;

function createFirestoreInstance(app: ReturnType<typeof initializeApp>) {
  const dbId = (rawFirebaseConfig as { firestoreDatabaseId?: string }).firestoreDatabaseId;
  const settings = {
    experimentalForceLongPolling: true,
    ignoreUndefinedProperties: true,
  };

  try {
    return initializeFirestore(
      app,
      {
        ...settings,
        localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
      },
      dbId || "(default)"
    );
  } catch (cacheError) {
    console.warn("Firestore persistent cache unavailable, using memory cache.", cacheError);
    return initializeFirestore(app, settings, dbId || "(default)");
  }
}

function isRecoverableFirestoreError(error: unknown): boolean {
  const code =
    typeof error === "object" && error !== null && "code" in error
      ? String((error as { code?: string }).code)
      : "";
  const message = error instanceof Error ? error.message : String(error);
  const blocked =
    message.includes("ERR_BLOCKED_BY_CLIENT") ||
    message.includes("network-request-failed") ||
    message.includes("Failed to fetch") ||
    message.includes("NetworkError");

  if (blocked) return true;
  return ![
    "permission-denied",
    "unauthenticated",
    "failed-precondition",
    "invalid-argument",
  ].includes(code);
}

function noteFirestoreSyncIssue(error: unknown, context: string) {
  if (isRecoverableFirestoreError(error)) {
    console.warn(`Firestore sync deferred (${context}):`, error);
    return;
  }
  console.error(`Firestore sync failed (${context}):`, error);
  disableFirebase();
}

export function initFirebase() {
  if (initialized) return;

  try {
    if (firebaseConfig.apiKey && firebaseConfig.apiKey !== "AIzaSyFakeKey" && firebaseConfig.projectId) {
      app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
      db = createFirestoreInstance(app);
      auth = getAuth(app);
      isRealFirebase = true;
      console.log("Firebase initialized successfully. Real Firestore enabled.");
    } else {
      isRealFirebase = false;
    }
  } catch (error) {
    console.error("Firebase failed to initialize. Falling back to local state sync.", error);
    isRealFirebase = false;
    db = null;
    auth = null;
  }
  initialized = true;
}

export function disableFirebase() {
  if (!isRealFirebase) return;
  isRealFirebase = false;
  console.warn("Firebase cloud sync disabled; continuing with offline local storage.");
  // Keep auth available even when Firestore sync is blocked (e.g. ad blockers).
}

try {
  initFirebase();
} catch (error) {
  console.error("Firebase failed to initialize. Falling back to local state sync.", error);
  isRealFirebase = false;
  db = null;
  auth = null;
}

export { db, auth, isRealFirebase };

// ---------------------------------------------------------------------------
// RESILIENT STATE SYNC ENGINE
// Handles syncing library books, progress, tags, and notes to Firestore (if available)
// or falls back beautifully to localStorage (offline-first local-fallback engine)
// ---------------------------------------------------------------------------

export interface BookMetadata {
  id: string; // MD5 or UUID
  title: string;
  author: string;
  filename?: string;
  filePath?: string;
  publisher?: string;
  year?: string;
  language?: string;
  extension: string;
  size: string;
  coverUrl?: string;
  downloadUrl?: string;
  md5?: string; // catalog identity for cross-device re-fetch (never store file bytes in Firebase)
  source?: string;
  tags: string[];
  status: "to-read" | "reading" | "completed";
  progress: {
    chapterIndex?: number;
    chapterTitle?: string;
    percent: number; // 0 to 100
    pageNumber?: number;
    totalPages?: number;
    scrollPosition?: number;
    lastReadTime: number;
  };
  notes?: string;
  rating?: number; // 1-5
  dateAdded: number;
  dateModified?: number;
  description?: string;
  series?: string;
  seriesNumber?: string;
  /** Audiobook-specific metadata (track URLs sync; audio blobs stay on-device) */
  audiobookTracks?: { index: number; title: string; src: string }[];
  audiobookSourceUrl?: string;
  audiobookDownloaded?: boolean;
  audiobookCurrentTrack?: number;
  audiobookCurrentTime?: number;
}

// LocalStorage helpers
const LOCAL_STORAGE_KEY = "ebook_reader_library";
const LOCAL_TAGS_KEY = "ebook_reader_tags";

export function getLocalLibrary(): BookMetadata[] {
  try {
    const data = localStorage.getItem(LOCAL_STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch {
    return [];
  }
}

function saveLocalLibrary(books: BookMetadata[]) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(books));
  } catch (e) {
    console.error("LocalStorage write failed:", e);
  }
}

// Unified actions for syncing
export async function syncBookToCloud(userId: string, book: BookMetadata): Promise<void> {
  // Always update local storage first (offline-first strategy)
  const localBooks = getLocalLibrary();
  const index = localBooks.findIndex(b => b.id === book.id);
  if (index >= 0) {
    localBooks[index] = book;
  } else {
    localBooks.push(book);
  }
  saveLocalLibrary(localBooks);

  // Sync to Firestore if authenticated & Firebase is active
  if (isRealFirebase && userId) {
    try {
      // Clean undefined fields to prevent Firestore errors
      const cleanedBook = JSON.parse(JSON.stringify(book));
      const docRef = doc(db, "users", userId, "library", cleanedBook.id);
      await setDoc(docRef, cleanedBook, { merge: true });
    } catch (err) {
      noteFirestoreSyncIssue(err, "syncBookToCloud");
    }
  }
}

export async function syncDeleteBook(userId: string, bookId: string): Promise<void> {
  const localBooks = getLocalLibrary();
  const updated = localBooks.filter(b => b.id !== bookId);
  saveLocalLibrary(updated);

  if (isRealFirebase && userId) {
    try {
      // Delete highlights subcollection
      const highlightsRef = collection(db, "users", userId, "library", bookId, "highlights");
      const highlightsSnap = await getDocs(highlightsRef);
      const deletePromises: Promise<void>[] = [];
      highlightsSnap.forEach(doc => {
        deletePromises.push(deleteDoc(doc.ref));
      });

      // Delete notes subcollection
      const notesRef = collection(db, "users", userId, "library", bookId, "notes");
      const notesSnap = await getDocs(notesRef);
      notesSnap.forEach(doc => {
        deletePromises.push(deleteDoc(doc.ref));
      });

      await Promise.all(deletePromises);

      // Finally delete the book document
      const docRef = doc(db, "users", userId, "library", bookId);
      await deleteDoc(docRef);
    } catch (err) {
      noteFirestoreSyncIssue(err, "syncDeleteBook");
    }
  }
}

export async function loadLibrary(userId: string): Promise<BookMetadata[]> {
  const localBooks = getLocalLibrary();

  if (isRealFirebase && userId) {
    try {
      const colRef = collection(db, "users", userId, "library");
      const querySnapshot = await getDocs(colRef);
      const cloudBooks: BookMetadata[] = [];
      querySnapshot.forEach((doc) => {
        cloudBooks.push(doc.data() as BookMetadata);
      });

      if (cloudBooks.length > 0) {
        // Merge cloud and local books, preferring the one with the latest lastReadTime or progress
        const mergedMap = new Map<string, BookMetadata>();
        localBooks.forEach(b => mergedMap.set(b.id, b));
        cloudBooks.forEach(cb => {
          const existing = mergedMap.get(cb.id);
          if (!existing) {
            mergedMap.set(cb.id, cb);
            return;
          }
          const { progress } = mergeReadingProgress(existing.progress, cb.progress);
          const preferCloud = (cb.progress?.lastReadTime || 0) >= (existing.progress?.lastReadTime || 0);
          const chosen = preferCloud ? cb : existing;
          mergedMap.set(cb.id, { ...chosen, progress: { ...chosen.progress, ...progress } });
        });
        const merged = Array.from(mergedMap.values());
        saveLocalLibrary(merged);
        return merged;
      }
    } catch (err) {
      noteFirestoreSyncIssue(err, "loadLibrary");
    }
  }

  return localBooks;
}

// Custom tags management
export async function loadCustomTags(userId: string): Promise<string[]> {
  const defaultTags = ["Fiction", "Non-Fiction", "Sci-Fi", "History", "Biography", "Classic", "Research"];
  try {
    const saved = localStorage.getItem(LOCAL_TAGS_KEY);
    return saved ? JSON.parse(saved) : defaultTags;
  } catch {
    return defaultTags;
  }
}

export async function saveCustomTags(userId: string, tags: string[]): Promise<void> {
  try {
    localStorage.setItem(LOCAL_TAGS_KEY, JSON.stringify(tags));
  } catch (e) {
    console.error("Failed to save custom tags locally:", e);
  }

  if (isRealFirebase && userId) {
    try {
      const docRef = doc(db, "users", userId, "config", "tags");
      await setDoc(docRef, { tags }, { merge: true });
    } catch (err) {
      noteFirestoreSyncIssue(err, "saveCustomTags");
    }
  }
}

// ---------------------------------------------------------------------------
// BOOK HIGHLIGHTS & CHAPTER NOTES SYNCHRONIZATION ENGINE
// Supports granular highlights and persistent, chapter-linked notes
// ---------------------------------------------------------------------------

// Error Handlers
export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth?.currentUser?.uid,
      email: auth?.currentUser?.email,
      emailVerified: auth?.currentUser?.emailVerified,
    },
    operationType,
    path,
  };

  if (isRecoverableFirestoreError(error)) {
    console.warn("Firestore Error (recoverable): ", JSON.stringify(errInfo));
    return;
  }

  console.error("Firestore Error: ", JSON.stringify(errInfo));
  disableFirebase();
  throw new Error(JSON.stringify(errInfo));
}

export interface BookHighlight {
  id: string;
  text: string;
  color: "yellow" | "green" | "blue" | "pink";
  note?: string;
  chapterIdx: number;
  chapterTitle: string;
  createdAt: number;
}

export interface ChapterNote {
  chapterIdx: number;
  chapterTitle: string;
  noteText: string;
  updatedAt: number;
}

// Chapter Notes Local & Cloud Sync
export async function syncChapterNote(
  userId: string,
  bookId: string,
  chapterIdx: number,
  chapterTitle: string,
  noteText: string
): Promise<void> {
  // 1. Update local storage first
  const localKey = `ebook_reader_notes_${bookId}`;
  let localNotes: Record<number, ChapterNote> = {};
  try {
    const data = localStorage.getItem(localKey);
    if (data) localNotes = JSON.parse(data);
  } catch {}
  
  const updatedNote: ChapterNote = {
    chapterIdx,
    chapterTitle,
    noteText,
    updatedAt: Date.now()
  };
  localNotes[chapterIdx] = updatedNote;
  try {
    localStorage.setItem(localKey, JSON.stringify(localNotes));
  } catch (e) {
    console.error("Local storage notes write failed:", e);
  }

  // 2. Sync to Firestore if authenticated & Firebase active
  if (isRealFirebase && userId) {
    const path = `users/${userId}/library/${bookId}/notes/${chapterIdx}`;
    try {
      const docRef = doc(db, "users", userId, "library", bookId, "notes", String(chapterIdx));
      await setDoc(docRef, updatedNote, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  }
}

export async function loadChapterNotes(userId: string, bookId: string): Promise<Record<number, ChapterNote>> {
  const localKey = `ebook_reader_notes_${bookId}`;
  let localNotes: Record<number, ChapterNote> = {};
  try {
    const data = localStorage.getItem(localKey);
    if (data) localNotes = JSON.parse(data);
  } catch {}

  if (isRealFirebase && userId) {
    const path = `users/${userId}/library/${bookId}/notes`;
    try {
      const colRef = collection(db, "users", userId, "library", bookId, "notes");
      const querySnapshot = await getDocs(colRef);
      const cloudNotes: Record<number, ChapterNote> = {};
      querySnapshot.forEach((doc) => {
        const note = doc.data() as ChapterNote;
        cloudNotes[note.chapterIdx] = note;
      });

      // Merge choosing latest updatedAt
      const merged: Record<number, ChapterNote> = { ...localNotes };
      Object.keys(cloudNotes).forEach((k) => {
        const idx = Number(k);
        const cn = cloudNotes[idx];
        const ln = localNotes[idx];
        if (!ln || cn.updatedAt > ln.updatedAt) {
          merged[idx] = cn;
        }
      });
      
      try {
        localStorage.setItem(localKey, JSON.stringify(merged));
      } catch {}
      return merged;
    } catch (err) {
      console.warn("Failed to load notes from Firestore cloud, using offline copy:", err);
    }
  }

  return localNotes;
}

// Book Highlights Local & Cloud Sync
export async function syncBookHighlight(
  userId: string,
  bookId: string,
  highlight: BookHighlight
): Promise<void> {
  const localKey = `ebook_reader_highlights_${bookId}`;
  let localHighlights: BookHighlight[] = [];
  try {
    const data = localStorage.getItem(localKey);
    if (data) localHighlights = JSON.parse(data);
  } catch {}

  const idx = localHighlights.findIndex(h => h.id === highlight.id);
  if (idx >= 0) {
    localHighlights[idx] = highlight;
  } else {
    localHighlights.push(highlight);
  }

  try {
    localStorage.setItem(localKey, JSON.stringify(localHighlights));
  } catch (e) {
    console.error("Local storage highlights write failed:", e);
  }

  if (isRealFirebase && userId) {
    const path = `users/${userId}/library/${bookId}/highlights/${highlight.id}`;
    try {
      const docRef = doc(db, "users", userId, "library", bookId, "highlights", highlight.id);
      await setDoc(docRef, highlight, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  }
}

export async function syncDeleteHighlight(
  userId: string,
  bookId: string,
  highlightId: string
): Promise<void> {
  const localKey = `ebook_reader_highlights_${bookId}`;
  let localHighlights: BookHighlight[] = [];
  try {
    const data = localStorage.getItem(localKey);
    if (data) localHighlights = JSON.parse(data);
  } catch {}

  const updated = localHighlights.filter(h => h.id !== highlightId);
  try {
    localStorage.setItem(localKey, JSON.stringify(updated));
  } catch {}

  if (isRealFirebase && userId) {
    const path = `users/${userId}/library/${bookId}/highlights/${highlightId}`;
    try {
      const docRef = doc(db, "users", userId, "library", bookId, "highlights", highlightId);
      await deleteDoc(docRef);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    }
  }
}

export async function loadBookHighlights(userId: string, bookId: string): Promise<BookHighlight[]> {
  const localKey = `ebook_reader_highlights_${bookId}`;
  let localHighlights: BookHighlight[] = [];
  try {
    const data = localStorage.getItem(localKey);
    if (data) localHighlights = JSON.parse(data);
  } catch {}

  if (isRealFirebase && userId) {
    const path = `users/${userId}/library/${bookId}/highlights`;
    try {
      const colRef = collection(db, "users", userId, "library", bookId, "highlights");
      const querySnapshot = await getDocs(colRef);
      const cloudHighlights: BookHighlight[] = [];
      querySnapshot.forEach((doc) => {
        cloudHighlights.push(doc.data() as BookHighlight);
      });

      if (cloudHighlights.length > 0) {
        // Merge - unique by ID, preferring cloud as master or later created
        const mergedMap = new Map<string, BookHighlight>();
        localHighlights.forEach(h => mergedMap.set(h.id, h));
        cloudHighlights.forEach(ch => {
          const existing = mergedMap.get(ch.id);
          if (!existing || ch.createdAt > existing.createdAt) {
            mergedMap.set(ch.id, ch);
          }
        });
        const merged = Array.from(mergedMap.values());
        try {
          localStorage.setItem(localKey, JSON.stringify(merged));
        } catch {}
        return merged;
      }
    } catch (err) {
      console.warn("Failed to load highlights from Firestore cloud, using offline copy:", err);
    }
  }

  return localHighlights;
}

