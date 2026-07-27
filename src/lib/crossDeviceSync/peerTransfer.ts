/**
 * WebRTC data-channel file transfer between a user's devices.
 * Uses the secure, chunked, encrypted P2P transfer system.
 * Signaling goes through Firestore.
 */

import {
  collection,
  doc,
  setDoc,
  updateDoc,
  onSnapshot,
  deleteDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { db, isRealFirebase } from "../firebase";
import { getBookFile, storeBookFile } from "../../db/indexedDB";
import { getDeviceId } from "./deviceRegistry";
import { P2pSession } from "../p2pTransfer/transfer";

export type PeerSessionStatus =
  | "requested"
  | "offering"
  | "answering"
  | "connected"
  | "done"
  | "error"
  | "cancelled";

export interface PeerSession {
  id: string;
  bookId: string;
  bookTitle: string;
  extension: string;
  fileName: string;
  requesterId: string;
  providerId: string;
  roomCode?: string;
  status: PeerSessionStatus;
  offer?: string;
  answer?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

function sessionRef(userId: string, sessionId: string) {
  return doc(db, "users", userId, "peerSessions", sessionId);
}

/** Requester: ask provider device for a book file. */
export async function requestBookFromPeer(
  userId: string,
  providerId: string,
  book: { id: string; title: string; extension: string; filename?: string }
): Promise<void> {
  if (!isRealFirebase || !db) throw new Error("Sign in required for device transfer");
  
  const me = getDeviceId();
  const sessionId = `ps_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const fileName = book.filename || `${book.title}.${book.extension || "epub"}`;

  // 1. Create the new P2pSession as host
  const p2p = new P2pSession();
  const code = await p2p.createRoom();

  // 2. Set up the PeerSession document with the automatic room code
  const session: PeerSession = {
    id: sessionId,
    bookId: book.id,
    bookTitle: book.title,
    extension: book.extension || "epub",
    fileName,
    requesterId: me,
    providerId,
    roomCode: code,
    status: "requested",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await setDoc(sessionRef(userId, sessionId), session);

  // 3. Create a Promise that resolves when the file is fully received and saved
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(async () => {
      unsubP2p();
      unsubDoc();
      await p2p.close(true);
      try {
        await deleteDoc(sessionRef(userId, sessionId));
      } catch { /* ignore */ }
      reject(new Error("Peer transfer timed out after 2 minutes"));
    }, 120_000);

    // Watch for P2P connection failures
    const unsubP2p = p2p.subscribe(async (state) => {
      if (state.phase === "error") {
        window.clearTimeout(timeout);
        unsubP2p();
        unsubDoc();
        await p2p.close(true);
        try {
          await deleteDoc(sessionRef(userId, sessionId));
        } catch { /* ignore */ }
        reject(new Error(state.error || "P2P connection error"));
      }
    });

    // Handle file received
    p2p.onReceive(async (file) => {
      window.clearTimeout(timeout);
      unsubP2p();
      unsubDoc();
      try {
        // Store the file to IndexedDB
        await storeBookFile(book.id, file, fileName, book.extension || "epub");
        
        // Update document status to done
        await updateDoc(sessionRef(userId, sessionId), {
          status: "done",
          updatedAt: Date.now(),
        });
        
        // Let things settle, then clean up
        setTimeout(async () => {
          await p2p.close(true); // Close and delete signaling room code
          try {
            await deleteDoc(sessionRef(userId, sessionId));
          } catch { /* ignore */ }
        }, 1000);

        resolve();
      } catch (err) {
        await p2p.close(true);
        try {
          await deleteDoc(sessionRef(userId, sessionId));
        } catch { /* ignore */ }
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    // Also watch for manual cancellation/error from provider on Firestore document
    const unsubDoc = onSnapshot(sessionRef(userId, sessionId), async (snap) => {
      const data = snap.data() as PeerSession | undefined;
      if (!data) return;
      if (data.status === "error" || data.status === "cancelled") {
        window.clearTimeout(timeout);
        unsubP2p();
        unsubDoc();
        await p2p.close(true);
        try {
          await deleteDoc(sessionRef(userId, sessionId));
        } catch { /* ignore */ }
        reject(new Error(data.error || "Transfer cancelled by provider"));
      }
    });
  });
}

/**
 * Provider: watch for inbound requests and serve cached files.
 * Returns unsubscribe.
 */
export function listenAndServePeerRequests(
  userId: string,
  enabled: boolean,
  onStatus?: (msg: string) => void
): Unsubscribe {
  if (!enabled || !isRealFirebase || !db) return () => undefined;
  const me = getDeviceId();
  const active = new Set<string>();

  return onSnapshot(collection(db, "users", userId, "peerSessions"), (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === "removed") return;
      const session = change.doc.data() as PeerSession;
      if (session.providerId !== me) return;
      if (session.status !== "requested") return;
      if (!session.roomCode) return;
      if (active.has(session.id)) return;
      active.add(session.id);

      void (async () => {
        const p2p = new P2pSession();
        try {
          onStatus?.(`Sending “${session.bookTitle}” to another device…`);
          
          const cached = await getBookFile(session.bookId);
          if (!cached?.blob) {
            await updateDoc(sessionRef(userId, session.id), {
              status: "error",
              error: "File not cached on this device",
              updatedAt: Date.now(),
            });
            await p2p.close(false);
            return;
          }

          // 1. Join the P2P room automatically using synced room code
          await p2p.joinRoom(session.roomCode);

          // 2. Wait until connected (ready phase)
          await new Promise<void>((resolve, reject) => {
            const timeout = setTimeout(() => reject(new Error("Join timeout")), 45_000);
            const unsub = p2p.subscribe((state) => {
              if (state.phase === "ready") {
                clearTimeout(timeout);
                unsub();
                resolve();
              } else if (state.phase === "error") {
                clearTimeout(timeout);
                unsub();
                reject(new Error(state.error || "P2P error during join"));
              }
            });
          });

          // 3. Send the file using the new encrypted chunked system
          const file = new File([cached.blob], session.fileName, { type: "application/octet-stream" });
          await p2p.sendFiles([file]);

          onStatus?.(`Sent “${session.bookTitle}”`);
        } catch (err) {
          console.warn("Peer serve failed:", err);
          try {
            await updateDoc(sessionRef(userId, session.id), {
              status: "error",
              error: err instanceof Error ? err.message : String(err),
              updatedAt: Date.now(),
            });
          } catch { /* ignore */ }
        } finally {
          // Keep active registry until document is deleted or closed
          const unsubDoc = onSnapshot(sessionRef(userId, session.id), async (docSnap) => {
            if (!docSnap.exists() || docSnap.data()?.status === "done" || docSnap.data()?.status === "error") {
              unsubDoc();
              await p2p.close(false);
              active.delete(session.id);
            }
          });
        }
      })();
    });
  });
}
