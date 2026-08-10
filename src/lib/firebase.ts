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
    // Prefer the WebSocket transport (default). The previous
    // experimentalForceLongPolling:true forced the HTTP /channel long-poll,
    // which content blockers (uBlock/Brave Shields) flag as tracking and block
    // with ERR_BLOCKED_BY_CLIENT. WebSocket is not matched by those rules.
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
  downloadId?: string;
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

/**
 * Clear the user's entire library from Firestore + local cache, keeping only
 * the books whose ids are in `keepIds` (e.g. the built-in Getting-started guide).
 * Used by the "Clear Library" action. Each kept book is left untouched; every
 * other book document (and its highlights/notes subcollections) is deleted.
 */
export async function clearLibraryExcept(userId: string, keepIds: string[]): Promise<void> {
  const keepSet = new Set(keepIds.map((id) => String(id).toLowerCase()));

  // 1. Local cache: drop everything not in the keep list.
  const localBooks = getLocalLibrary();
  const keptLocal = localBooks.filter((b) => keepSet.has(String(b.id).toLowerCase()));
  saveLocalLibrary(keptLocal);

  // 2. Firestore: enumerate and delete each non-kept book document.
  if (isRealFirebase && userId) {
    try {
      const colRef = collection(db, "users", userId, "library");
      const snap = await getDocs(colRef);
      const deletes: Promise<void>[] = [];
      snap.forEach((d) => {
        if (keepSet.has(String(d.id).toLowerCase())) return;
        // Clean up subcollections first, then the book doc.
        const highlightsRef = collection(db, "users", userId, "library", d.id, "highlights");
        const notesRef = collection(db, "users", userId, "library", d.id, "notes");
        deletes.push(
          (async () => {
            try {
              const [hSnap, nSnap] = await Promise.all([getDocs(highlightsRef), getDocs(notesRef)]);
              await Promise.all([
                ...hSnap.docs.map((x) => deleteDoc(x.ref)),
                ...nSnap.docs.map((x) => deleteDoc(x.ref)),
              ]);
              await deleteDoc(d.ref);
            } catch (err) {
              noteFirestoreSyncIssue(err, "clearLibraryExcept");
            }
          })()
        );
      });
      await Promise.all(deletes);
    } catch (err) {
      noteFirestoreSyncIssue(err, "clearLibraryExcept");
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

// ==========================================
// Community Stories (Kora publishing)
// ==========================================

export interface CommunityBook {
  id: string;
  title: string;
  author: string;
  authorId: string;
  authorAvatar?: string;
  description: string;
  genre: string;
  tags?: string[];
  coverUrl?: string;
  coverGradient?: string;
  chapters: { id: string; title: string; text: string; html?: string }[];
  readsCount: number;
  likesCount: number;
  commentsCount: number;
  publishedAt: string;
  updatedAt: string;
  language?: string;
}

export interface CommunityComment {
  id: string;
  bookId: string;
  userId: string;
  userName: string;
  userAvatar?: string;
  text: string;
  createdAt: string;
}

export const SEEDED_COMMUNITY_BOOKS: CommunityBook[] = [
  {
    id: "comm_seed_1",
    title: "The Last Alchemist of Aethelgard",
    author: "Evelyn Thorne",
    authorId: "author_evelyn",
    authorAvatar: "https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&w=150&q=80",
    description: "In a kingdom where magic is outlawed and alchemy is punished by exile, Eliana discovers an ancient codex hidden beneath her grandfather's workshop. When soldiers storm the city, she must master forgotten elemental transmutations before the moon rises.",
    genre: "Fantasy",
    tags: ["Magic", "Ancient Mystery", "Alchemist", "Adventure"],
    coverGradient: "linear-gradient(135deg, #1e3c72 0%, #2a5298 100%)",
    chapters: [
      {
        id: "c1",
        title: "Chapter 1: The Silver Dust",
        text: "The smell of dried lavender and quicksilver filled the subterranean cellar. Eliana carefully wiped the brass scales, her fingers stained with indigo dye. Deep in the heart of Aethelgard, where the Crown forbidden any work touching the Aether, her family had secretly preserved the craft for three generations.",
        html: "<p>The smell of dried lavender and quicksilver filled the subterranean cellar. Eliana carefully wiped the brass scales, her fingers stained with indigo dye. Deep in the heart of Aethelgard, where the Crown forbidden any work touching the Aether, her family had secretly preserved the craft for three generations.</p><p>'You are dreaming again, child,' Master Aaron rasped from his velvet armchair in the corner. 'Aethelgard does not welcome dreamers. It welcomes taxpayers and silent soldiers.'</p><p>Eliana turned to the heavy mahogany cabinet. Beneath a loose stone, the leather book lay untouched—its silver spine humming softly against her palm.</p>"
      },
      {
        id: "c2",
        title: "Chapter 2: The Midnight Raid",
        text: "Iron boots resounded against cobblestones outside the workshop windows. Torch light flickered across the glass panes as the Royal Inquisitors surrounded the court.",
        html: "<p>Iron boots resounded against cobblestones outside the workshop windows. Torch light flickered across the glass panes as the Royal Inquisitors surrounded the court.</p><p>'Open in the name of the Crown!' a voice roared through the door, followed by the splintering crack of heavy timber.</p>"
      }
    ],
    readsCount: 24890,
    likesCount: 1840,
    commentsCount: 142,
    publishedAt: "2026-07-12T10:00:00.000Z",
    updatedAt: "2026-08-01T14:30:00.000Z",
    language: "en"
  },
  {
    id: "comm_seed_2",
    title: "Midnight in Neo-Tokyo",
    author: "Kenji Sato",
    authorId: "author_kenji",
    authorAvatar: "https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&w=150&q=80",
    description: "In the rain-slicked neon alleys of 2099 Neo-Tokyo, illegal memory couriers trade secret thoughts. When Ren intercepts an encrypted memory node belonging to the megacorp's CEO, he realizes it contains a human consciousness that doesn't want to die.",
    genre: "Sci-Fi",
    tags: ["Cyberpunk", "Neo-Tokyo", "Memory Courier", "Thriller"],
    coverGradient: "linear-gradient(135deg, #0f0c29 0%, #302b63 50%, #24243e 100%)",
    chapters: [
      {
        id: "c1",
        title: "Chapter 1: Neon Whispers",
        text: "Rain fell in glowing violet sheets through the holographic billboards of Shinjuku. Ren adjusted his neural visor, the optical interface pulsing red as data streams flooded his optic nerve.",
        html: "<p>Rain fell in glowing violet sheets through the holographic billboards of Shinjuku. Ren adjusted his neural visor, the optical interface pulsing red as data streams flooded his optic nerve.</p><p>The package was light—a micro-crystal drive no larger than a grain of rice, sealed inside a lead casing. But the heat radiating through his pocket told him this wasn't ordinary corporate telemetry.</p>"
      }
    ],
    readsCount: 18520,
    likesCount: 2120,
    commentsCount: 98,
    publishedAt: "2026-07-20T18:00:00.000Z",
    updatedAt: "2026-08-05T11:20:00.000Z",
    language: "en"
  },
  {
    id: "comm_seed_3",
    title: "Coffee, Starlight & You",
    author: "Aria Montgomery",
    authorId: "author_aria",
    authorAvatar: "https://images.unsplash.com/photo-1494790108377-be9c29b29330?auto=format&fit=crop&w=150&q=80",
    description: "When Maya takes a night shift at an astronomy-themed café in Seattle, she doesn't expect her regulars to include a mysterious astrophysics student who leaves handwritten universe equations on paper napkins every Tuesday at 2 AM.",
    genre: "Romance",
    tags: ["Cozy Romance", "Seattle", "Astronomy", "Coffee Shop"],
    coverGradient: "linear-gradient(135deg, #eecda3 0%, #ef629f 100%)",
    chapters: [
      {
        id: "c1",
        title: "Chapter 1: The Tuesday Napkin",
        text: "The espresso machine hissed, releasing a cloud of sweet hazelnut steam into the quiet café. It was 1:45 AM, and outside, rain beat rhythmically against the glass of Starlight Brews.",
        html: "<p>The espresso machine hissed, releasing a cloud of sweet hazelnut steam into the quiet café. It was 1:45 AM, and outside, rain beat rhythmically against the glass of Starlight Brews.</p><p>Maya wiped down the counter, glancing toward booth four. He was sitting there again—the dark coat, messy copper hair, and a stack of star maps spread across the table.</p>"
      }
    ],
    readsCount: 32100,
    likesCount: 3420,
    commentsCount: 285,
    publishedAt: "2026-06-15T12:00:00.000Z",
    updatedAt: "2026-08-08T09:15:00.000Z",
    language: "en"
  },
  {
    id: "comm_seed_4",
    title: "Whispers in the Fog",
    author: "Marcus Vance",
    authorId: "author_marcus",
    authorAvatar: "https://images.unsplash.com/photo-1500648767791-00dcc994a43e?auto=format&fit=crop&w=150&q=80",
    description: "An isolated lighthouse off the coast of Maine receives radio distress calls from a ship that sank fifty years ago. Detective Clara Briggs arrives to investigate, only to find the lighthouse keeper's diary ends with a warning: 'Do not open the door when the fog speaks.'",
    genre: "Mystery",
    tags: ["Psychological Thriller", "Lighthouse", "Coastal Mystery", "Suspense"],
    coverGradient: "linear-gradient(135deg, #232526 0%, #414345 100%)",
    chapters: [
      {
        id: "c1",
        title: "Chapter 1: Blackwood Light",
        text: "The ferry pitch and rolled against six-foot Atlantic swells. Through the heavy sea mist, Blackwood Island rose like a jagged black tooth against the gray sky.",
        html: "<p>The ferry pitch and rolled against six-foot Atlantic swells. Through the heavy sea mist, Blackwood Island rose like a jagged black tooth against the gray sky.</p><p>Clara pulled her trench coat tighter against the salt air. In her pocket was the audio tape sent to state police yesterday—the voice raspy and panicked: 'The fog isn't sea water. It has eyes.'</p>"
      }
    ],
    readsCount: 12840,
    likesCount: 920,
    commentsCount: 64,
    publishedAt: "2026-07-01T08:00:00.000Z",
    updatedAt: "2026-07-28T16:45:00.000Z",
    language: "en"
  }
];

export async function publishCommunityBook(
  bookData: Omit<CommunityBook, "id" | "readsCount" | "likesCount" | "commentsCount" | "publishedAt" | "updatedAt"> & { id?: string }
): Promise<CommunityBook> {
  const id = bookData.id || `comm_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const now = new Date().toISOString();

  const fullBook: CommunityBook = {
    ...bookData,
    id,
    readsCount: (bookData as any).readsCount || 1,
    likesCount: (bookData as any).likesCount || 0,
    commentsCount: (bookData as any).commentsCount || 0,
    publishedAt: (bookData as any).publishedAt || now,
    updatedAt: now,
  };

  // 1. Save to local storage cache for instant offline & client update
  try {
    const cachedStr = localStorage.getItem("kora_community_books_cache");
    let cachedList: CommunityBook[] = cachedStr ? JSON.parse(cachedStr) : [];
    const existingIdx = cachedList.findIndex((b) => b.id === id);
    if (existingIdx >= 0) {
      cachedList[existingIdx] = fullBook;
    } else {
      cachedList.unshift(fullBook);
    }
    localStorage.setItem("kora_community_books_cache", JSON.stringify(cachedList));
  } catch (err) {
    console.warn("Failed to write community book to local storage:", err);
  }

  // 2. Sync to Cloud Firestore if connected
  if (isRealFirebase) {
    const path = `communityBooks/${id}`;
    try {
      const docRef = doc(db, "communityBooks", id);
      await setDoc(docRef, fullBook, { merge: true });
    } catch (err) {
      handleFirestoreError(err, OperationType.WRITE, path);
    }
  }

  return fullBook;
}

export async function getCommunityBooks(genreFilter?: string): Promise<CommunityBook[]> {
  let booksList: CommunityBook[] = [];

  // Try Firestore first if available
  if (isRealFirebase) {
    const path = "communityBooks";
    try {
      const colRef = collection(db, "communityBooks");
      const snap = await getDocs(colRef);
      snap.forEach((doc) => {
        booksList.push(doc.data() as CommunityBook);
      });
    } catch (err) {
      console.warn("Failed to fetch community books from Firestore:", err);
    }
  }

  // Load local published books cache
  try {
    const cachedStr = localStorage.getItem("kora_community_books_cache");
    if (cachedStr) {
      const localBooks: CommunityBook[] = JSON.parse(cachedStr);
      localBooks.forEach((lb) => {
        if (!booksList.some((b) => b.id === lb.id)) {
          booksList.push(lb);
        }
      });
    }
  } catch {}

  // Include seeded stories if list is empty or small
  SEEDED_COMMUNITY_BOOKS.forEach((sb) => {
    if (!booksList.some((b) => b.id === sb.id)) {
      booksList.push(sb);
    }
  });

  // Filter by genre if specified
  if (genreFilter && genreFilter !== "all" && genreFilter !== "All") {
    booksList = booksList.filter(
      (b) => b.genre?.toLowerCase() === genreFilter.toLowerCase()
    );
  }

  // Sort by publishedAt / updatedAt descending
  return booksList.sort(
    (a, b) => new Date(b.updatedAt || b.publishedAt).getTime() - new Date(a.updatedAt || a.publishedAt).getTime()
  );
}

export async function getCommunityBookById(bookId: string): Promise<CommunityBook | null> {
  if (isRealFirebase) {
    try {
      const docRef = doc(db, "communityBooks", bookId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        return snap.data() as CommunityBook;
      }
    } catch (err) {
      console.warn("Failed to get community book by ID from Firestore:", err);
    }
  }

  const all = await getCommunityBooks();
  return all.find((b) => b.id === bookId) || null;
}

export async function incrementCommunityBookReads(bookId: string): Promise<void> {
  // Update local cache
  try {
    const cachedStr = localStorage.getItem("kora_community_books_cache");
    let cachedList: CommunityBook[] = cachedStr ? JSON.parse(cachedStr) : [];
    const item = cachedList.find((b) => b.id === bookId);
    if (item) {
      item.readsCount = (item.readsCount || 0) + 1;
      localStorage.setItem("kora_community_books_cache", JSON.stringify(cachedList));
    }
  } catch {}

  if (isRealFirebase) {
    try {
      const docRef = doc(db, "communityBooks", bookId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const curReads = snap.data()?.readsCount || 0;
        await setDoc(docRef, { readsCount: curReads + 1 }, { merge: true });
      }
    } catch (err) {
      console.warn("Increment community reads failed:", err);
    }
  }
}

export async function likeCommunityBook(
  bookId: string,
  userId: string
): Promise<{ liked: boolean; likesCount: number }> {
  const localLikesKey = `kora_community_likes_${userId}`;
  let userLikes: string[] = [];
  try {
    const raw = localStorage.getItem(localLikesKey);
    if (raw) userLikes = JSON.parse(raw);
  } catch {}

  const isAlreadyLiked = userLikes.includes(bookId);
  const newLiked = !isAlreadyLiked;

  if (newLiked) {
    userLikes.push(bookId);
  } else {
    userLikes = userLikes.filter((id) => id !== bookId);
  }

  try {
    localStorage.setItem(localLikesKey, JSON.stringify(userLikes));
  } catch {}

  let newLikesCount = 0;

  if (isRealFirebase) {
    try {
      const bookRef = doc(db, "communityBooks", bookId);
      const likeRef = doc(db, "communityBooks", bookId, "likes", userId);
      const snap = await getDoc(bookRef);
      const curLikes = snap.exists() ? snap.data()?.likesCount || 0 : 0;
      newLikesCount = Math.max(0, curLikes + (newLiked ? 1 : -1));

      if (newLiked) {
        await setDoc(likeRef, { likedAt: new Date().toISOString() });
      } else {
        await deleteDoc(likeRef);
      }
      await setDoc(bookRef, { likesCount: newLikesCount }, { merge: true });
    } catch (err) {
      console.warn("Failed to sync community like to Firestore:", err);
    }
  } else {
    // Local calculation
    const all = await getCommunityBooks();
    const b = all.find((x) => x.id === bookId);
    newLikesCount = Math.max(0, (b?.likesCount || 0) + (newLiked ? 1 : -1));
  }

  return { liked: newLiked, likesCount: newLikesCount };
}

export async function isCommunityBookLikedByUser(
  bookId: string,
  userId: string
): Promise<boolean> {
  const localLikesKey = `kora_community_likes_${userId}`;
  try {
    const raw = localStorage.getItem(localLikesKey);
    if (raw) {
      const userLikes: string[] = JSON.parse(raw);
      if (userLikes.includes(bookId)) return true;
    }
  } catch {}

  if (isRealFirebase && userId) {
    try {
      const likeRef = doc(db, "communityBooks", bookId, "likes", userId);
      const snap = await getDoc(likeRef);
      return snap.exists();
    } catch {}
  }
  return false;
}

export async function getCommunityComments(bookId: string): Promise<CommunityComment[]> {
  let comments: CommunityComment[] = [];

  if (isRealFirebase) {
    try {
      const colRef = collection(db, "communityBooks", bookId, "comments");
      const snap = await getDocs(colRef);
      snap.forEach((d) => {
        comments.push(d.data() as CommunityComment);
      });
    } catch (err) {
      console.warn("Failed to get community comments from Firestore:", err);
    }
  }

  // Check local comments cache
  try {
    const raw = localStorage.getItem(`kora_community_comments_${bookId}`);
    if (raw) {
      const localComments: CommunityComment[] = JSON.parse(raw);
      localComments.forEach((lc) => {
        if (!comments.some((c) => c.id === lc.id)) {
          comments.push(lc);
        }
      });
    }
  } catch {}

  // Seed sample comment if empty
  if (comments.length === 0) {
    comments = [
      {
        id: "comm_c_seed_1",
        bookId,
        userId: "user_reader_1",
        userName: "Sophia R.",
        text: "This chapter was so gripping! The plot twist at the end blew my mind. Can't wait for the next update!",
        createdAt: "2026-08-02T14:20:00.000Z",
      },
      {
        id: "comm_c_seed_2",
        bookId,
        userId: "user_reader_2",
        userName: "Alex Chen",
        text: "The atmosphere building here is top tier. Beautiful writing style!",
        createdAt: "2026-08-04T09:15:00.000Z",
      },
    ];
  }

  return comments.sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function addCommunityComment(
  bookId: string,
  user: { uid: string; displayName?: string | null; photoURL?: string | null },
  text: string
): Promise<CommunityComment> {
  const commentId = `cmt_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const comment: CommunityComment = {
    id: commentId,
    bookId,
    userId: user.uid,
    userName: user.displayName || "Anonymous Writer",
    userAvatar: user.photoURL || undefined,
    text: text.trim(),
    createdAt: new Date().toISOString(),
  };

  // Local write
  try {
    const key = `kora_community_comments_${bookId}`;
    const raw = localStorage.getItem(key);
    let list: CommunityComment[] = raw ? JSON.parse(raw) : [];
    list.unshift(comment);
    localStorage.setItem(key, JSON.stringify(list));
  } catch {}

  // Firestore write
  if (isRealFirebase) {
    try {
      const docRef = doc(db, "communityBooks", bookId, "comments", commentId);
      await setDoc(docRef, comment);

      // Update comments count on book
      const bookRef = doc(db, "communityBooks", bookId);
      const bSnap = await getDoc(bookRef);
      if (bSnap.exists()) {
        const curCount = bSnap.data()?.commentsCount || 0;
        await setDoc(bookRef, { commentsCount: curCount + 1 }, { merge: true });
      }
    } catch (err) {
      console.warn("Failed to add community comment to Firestore:", err);
    }
  }

  return comment;
}
