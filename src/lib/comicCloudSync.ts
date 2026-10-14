/**
 * Cloud sync for comic reading state.
 *
 * Thin by design: all the decisions live in `comicState` (merge semantics,
 * validation, the local-first write) and this file only moves bytes between the
 * local map and Firestore. Nothing here decides what "correct" means, because
 * that logic is what needs testing and it is already tested there.
 *
 * Path: `users/{uid}/comicState/{docId}`. The existing rules match
 * `users/{userId}/{document=**}` and allow the owner read+write, so this needs
 * no rules change — verified against firestore.rules.
 *
 * Push is debounced because a page turn is a write and a fast reader makes
 * dozens of them; unthrottled, that is a Firestore write per swipe. Pull runs
 * on open and merges, never overwrites — a cloud copy arriving must not be able
 * to move the reader backwards.
 *
 * Offline behaviour is deliberately silent. A reader on a plane must be able
 * to turn pages; the local write already happened, and a failed push is
 * retried on the next turn rather than surfaced as an error the user cannot act
 * on.
 */
import { doc, setDoc, getDocs, collection, query } from "firebase/firestore";
import { getFirestoreDb, isFirebaseActive } from "./firebase";
import {
  loadLocalState,
  allChapterState,
  mergeRemoteIntoLocal,
  fromCloudRecord,
  toCloudRecord,
  firestoreDocId,
  type ComicStateMap,
} from "./comicState";
import { logger } from "./logger";

/** Mirrors CLOUD_DEBOUNCE_MS in comicState; re-declared to avoid the import. */
const PUSH_DEBOUNCE_MS = 4000;

type Timer = ReturnType<typeof setTimeout>;
const pendingTimers = new Map<string, Timer>();
let pullInFlight: Promise<number> | null = null;

/** Cancel every queued push. Called on sign-out. */
export function cancelPendingPushes(): void {
  for (const t of pendingTimers.values()) clearTimeout(t);
  pendingTimers.clear();
}

/**
 * Queue a push for one chapter.
 *
 * The LAST call in a burst wins: each new call replaces the pending timer
 * rather than adding to it, so reading ten pages quickly results in one write
 * of where the reader actually stopped, not ten writes along the way.
 */
export function schedulePush(userId: string, key: string): void {
  if (!userId || !key || !isFirebaseActive()) return;

  const existing = pendingTimers.get(key);
  if (existing) clearTimeout(existing);

  const timer = setTimeout(() => {
    pendingTimers.delete(key);
    void pushChapter(userId, key);
  }, PUSH_DEBOUNCE_MS);
  pendingTimers.set(key, timer);
}

/** Push immediately, bypassing the debounce. Used on close and on sign-out. */
export async function pushChapter(userId: string, key: string): Promise<boolean> {
  if (!userId || !key || !isFirebaseActive()) return false;
  const local = loadLocalState()[key];
  if (!local) return false;
  try {
    await setDoc(
      doc(getFirestoreDb(), "users", userId, "comicState", firestoreDocId(key)),
      // JSON round-trip drops undefined, which Firestore rejects.
      JSON.parse(JSON.stringify(toCloudRecord(key, local))),
      { merge: true }
    );
    return true;
  } catch (err) {
    // Never surfaced: the local write already succeeded, so the reader has
    // not lost anything. The next turn retries.
    logger.warn("[comicSync] push failed", { name: (err as Error)?.name || "Error" });
    return false;
  }
}

/** Push every locally-known chapter. Used on sign-out and app hide. */
export async function pushAll(userId: string): Promise<void> {
  if (!userId || !isFirebaseActive()) return;
  const local = allChapterState();
  await Promise.all(Object.keys(local).map((k) => pushChapter(userId, k)));
}

/**
 * Merge the cloud copy into local state.
 *
 * Merge, never replace. The cloud may be stale — another device offline for a
 * week, or a write that never landed — and overwriting local state with it
 * would move the reader to a page they are not on.
 */
export async function pullAndMerge(userId: string): Promise<number> {
  if (!userId || !isFirebaseActive()) return 0;
  // Concurrent pulls would merge the same cloud snapshot twice and race on the
  // local write; coalesce instead.
  if (pullInFlight) return pullInFlight;

  pullInFlight = (async () => {
    try {
      const snap = await getDocs(
        query(collection(getFirestoreDb(), "users", userId, "comicState"))
      );
      const remote: ComicStateMap = {};
      for (const d of snap.docs) {
        const parsed = fromCloudRecord(d.data());
        if (parsed) remote[parsed.key] = parsed.state;
      }
      return mergeRemoteIntoLocal(remote);
    } catch (err) {
      logger.warn("[comicSync] pull failed", { name: (err as Error)?.name || "Error" });
      return 0;
    } finally {
      pullInFlight = null;
    }
  })();

  return pullInFlight;
}
