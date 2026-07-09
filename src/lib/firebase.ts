import { initializeApp, getApps, getApp } from "firebase/app";
import { 
  getFirestore, 
  collection, 
  doc, 
  setDoc, 
  getDoc, 
  getDocs, 
  deleteDoc, 
  query, 
  where,
  onSnapshot
} from "firebase/firestore";
import { 
  getAuth, 
  signInAnonymously, 
  onAuthStateChanged,
  signOut,
  User
} from "firebase/auth";
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
let db: any;
let auth: any;
let isRealFirebase = false;

try {
  app = getApps().length === 0 ? initializeApp(firebaseConfig) : getApp();
  db = getFirestore(app, (rawFirebaseConfig as any).firestoreDatabaseId);
  auth = getAuth(app);
  isRealFirebase = !!firebaseConfig.apiKey && !firebaseConfig.apiKey.startsWith("AIzaSyFakeKey");
  console.log("Firebase initialized successfully.", isRealFirebase ? "Real Firestore enabled." : "Using Firestore with placeholder credentials.");
} catch (error) {
  console.error("Firebase failed to initialize. Falling back to local state sync.", error);
  isRealFirebase = false;
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
  publisher?: string;
  year?: string;
  language?: string;
  extension: string;
  size: string;
  coverUrl?: string;
  md5?: string;
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
  description?: string;
  series?: string;
  seriesNumber?: string;
}

// LocalStorage helpers
const LOCAL_STORAGE_KEY = "ebook_reader_library";
const LOCAL_TAGS_KEY = "ebook_reader_tags";

function getLocalLibrary(): BookMetadata[] {
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
      const docRef = doc(db, "users", userId, "library", book.id);
      await setDoc(docRef, book, { merge: true });
    } catch (err) {
      console.warn("Failed to sync book to Firestore cloud:", err);
    }
  }
}

export async function syncDeleteBook(userId: string, bookId: string): Promise<void> {
  const localBooks = getLocalLibrary();
  const updated = localBooks.filter(b => b.id !== bookId);
  saveLocalLibrary(updated);

  if (isRealFirebase && userId) {
    try {
      const docRef = doc(db, "users", userId, "library", bookId);
      await deleteDoc(docRef);
    } catch (err) {
      console.warn("Failed to delete book from Firestore cloud:", err);
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
          if (!existing || cb.progress.lastReadTime > existing.progress.lastReadTime) {
            mergedMap.set(cb.id, cb);
          }
        });
        const merged = Array.from(mergedMap.values());
        saveLocalLibrary(merged);
        return merged;
      }
    } catch (err) {
      console.warn("Failed to load library from Firestore cloud, using offline copy:", err);
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
      console.warn("Failed to sync custom tags to cloud:", err);
    }
  }
}
