/**
 * WebRTC data-channel file transfer between a user's devices.
 * Signaling goes through Firestore — no Firebase Storage for the file bytes.
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
  status: PeerSessionStatus;
  offer?: string;
  answer?: string;
  error?: string;
  createdAt: number;
  updatedAt: number;
}

const ICE: RTCConfiguration = {
  iceServers: [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ],
};

function sessionRef(userId: string, sessionId: string) {
  return doc(db, "users", userId, "peerSessions", sessionId);
}

function candidatesCol(userId: string, sessionId: string, role: "offerer" | "answerer") {
  return collection(db, "users", userId, "peerSessions", sessionId, `${role}Candidates`);
}

async function writeIce(
  userId: string,
  sessionId: string,
  role: "offerer" | "answerer",
  candidate: RTCIceCandidate
) {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await setDoc(doc(candidatesCol(userId, sessionId, role), id), {
    candidate: candidate.toJSON(),
    createdAt: Date.now(),
  });
}

function listenIce(
  userId: string,
  sessionId: string,
  role: "offerer" | "answerer",
  pc: RTCPeerConnection
): Unsubscribe {
  return onSnapshot(candidatesCol(userId, sessionId, role), (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type !== "added") return;
      const data = change.doc.data();
      if (!data?.candidate) return;
      void pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => undefined);
    });
  });
}

async function sendBlobOverChannel(channel: RTCDataChannel, blob: Blob, meta: Record<string, unknown>) {
  channel.send(JSON.stringify({ type: "meta", ...meta, size: blob.size }));
  const buf = await blob.arrayBuffer();
  const chunkSize = 16 * 1024;
  for (let offset = 0; offset < buf.byteLength; offset += chunkSize) {
    const slice = buf.slice(offset, offset + chunkSize);
    // Backpressure
    if (channel.bufferedAmount > 256 * 1024) {
      await new Promise<void>((resolve) => {
        const check = () => {
          if (channel.bufferedAmount <= 64 * 1024) {
            channel.removeEventListener("bufferedamountlow", check);
            resolve();
          }
        };
        channel.bufferedAmountLowThreshold = 64 * 1024;
        channel.addEventListener("bufferedamountlow", check);
      });
    }
    channel.send(slice);
  }
  channel.send(JSON.stringify({ type: "done" }));
}

function receiveBlobFromChannel(channel: RTCDataChannel): Promise<{
  blob: Blob;
  meta: { bookId: string; fileName: string; extension: string };
}> {
  return new Promise((resolve, reject) => {
    const chunks: ArrayBuffer[] = [];
    let meta: { bookId: string; fileName: string; extension: string; size?: number } | null = null;
    let total = 0;

    const timeout = window.setTimeout(() => reject(new Error("Peer transfer timed out")), 120_000);

    channel.onmessage = (ev) => {
      if (typeof ev.data === "string") {
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === "meta") {
            meta = msg;
            return;
          }
          if (msg.type === "done") {
            window.clearTimeout(timeout);
            if (!meta) {
              reject(new Error("Missing file metadata"));
              return;
            }
            resolve({
              blob: new Blob(chunks),
              meta: {
                bookId: meta.bookId,
                fileName: meta.fileName,
                extension: meta.extension,
              },
            });
          }
          if (msg.type === "error") {
            window.clearTimeout(timeout);
            reject(new Error(msg.error || "Peer error"));
          }
        } catch (err) {
          window.clearTimeout(timeout);
          reject(err instanceof Error ? err : new Error(String(err)));
        }
        return;
      }
      const ab = ev.data instanceof ArrayBuffer ? ev.data : (ev.data as Blob);
      if (ab instanceof Blob) {
        void ab.arrayBuffer().then((buf) => {
          chunks.push(buf);
          total += buf.byteLength;
        });
      } else {
        chunks.push(ab);
        total += ab.byteLength;
      }
    };

    channel.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("Data channel error"));
    };
  });
}

/** Requester: ask provider device for a book file. */
export async function requestBookFromPeer(
  userId: string,
  providerId: string,
  book: { id: string; title: string; extension: string; filename?: string }
): Promise<void> {
  if (!isRealFirebase || !db) throw new Error("Sign in required for device transfer");
  const sessionId = `ps_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const me = getDeviceId();
  const fileName = book.filename || `${book.title}.${book.extension || "epub"}`;

  const session: PeerSession = {
    id: sessionId,
    bookId: book.id,
    bookTitle: book.title,
    extension: book.extension || "epub",
    fileName,
    requesterId: me,
    providerId,
    status: "requested",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  await setDoc(sessionRef(userId, sessionId), session);

  const pc = new RTCPeerConnection(ICE);
  const unsubAnswerIce = listenIce(userId, sessionId, "answerer", pc);

  pc.onicecandidate = (ev) => {
    if (ev.candidate) void writeIce(userId, sessionId, "offerer", ev.candidate);
  };

  const channel = pc.createDataChannel("kora-file", { ordered: true });
  channel.binaryType = "arraybuffer";

  const received = receiveBlobFromChannel(channel);

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await updateDoc(sessionRef(userId, sessionId), {
    status: "offering",
    offer: JSON.stringify(pc.localDescription),
    updatedAt: Date.now(),
  });

  await new Promise<void>((resolve, reject) => {
    const unsub = onSnapshot(sessionRef(userId, sessionId), async (snap) => {
      const data = snap.data() as PeerSession | undefined;
      if (!data) return;
      if (data.status === "error" || data.status === "cancelled") {
        unsub();
        reject(new Error(data.error || "Transfer cancelled"));
        return;
      }
      if (data.answer && pc.signalingState !== "stable") {
        try {
          await pc.setRemoteDescription(JSON.parse(data.answer));
          resolve();
          unsub();
        } catch (err) {
          unsub();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      }
    });
  });

  const { blob, meta } = await received;
  await storeBookFile(meta.bookId, blob, meta.fileName, meta.extension);
  await updateDoc(sessionRef(userId, sessionId), { status: "done", updatedAt: Date.now() });
  unsubAnswerIce();
  pc.close();
  try {
    await deleteDoc(sessionRef(userId, sessionId));
  } catch {
    /* ignore */
  }
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
      if (session.status !== "offering" && session.status !== "requested") return;
      if (!session.offer) return;
      if (active.has(session.id)) return;
      active.add(session.id);
      void (async () => {
        try {
          onStatus?.(`Sending “${session.bookTitle}” to another device…`);
          const cached = await getBookFile(session.bookId);
          if (!cached?.blob) {
            await updateDoc(sessionRef(userId, session.id), {
              status: "error",
              error: "File not cached on this device",
              updatedAt: Date.now(),
            });
            return;
          }

          const pc = new RTCPeerConnection(ICE);
          const unsubOfferIce = listenIce(userId, session.id, "offerer", pc);
          pc.onicecandidate = (ev) => {
            if (ev.candidate) void writeIce(userId, session.id, "answerer", ev.candidate);
          };

          const channelReady = new Promise<RTCDataChannel>((resolve, reject) => {
            const t = window.setTimeout(() => reject(new Error("Data channel timeout")), 60_000);
            pc.ondatachannel = (ev) => {
              window.clearTimeout(t);
              ev.channel.binaryType = "arraybuffer";
              if (ev.channel.readyState === "open") resolve(ev.channel);
              else ev.channel.onopen = () => resolve(ev.channel);
            };
          });

          await pc.setRemoteDescription(JSON.parse(session.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await updateDoc(sessionRef(userId, session.id), {
            status: "answering",
            answer: JSON.stringify(pc.localDescription),
            updatedAt: Date.now(),
          });

          const channel = await channelReady;
          await sendBlobOverChannel(channel, cached.blob, {
            bookId: session.bookId,
            fileName: session.fileName,
            extension: session.extension,
          });
          await updateDoc(sessionRef(userId, session.id), {
            status: "done",
            updatedAt: Date.now(),
          });
          onStatus?.(`Sent “${session.bookTitle}”`);
          unsubOfferIce();
          pc.close();
        } catch (err) {
          console.warn("Peer serve failed:", err);
          try {
            await updateDoc(sessionRef(userId, session.id), {
              status: "error",
              error: err instanceof Error ? err.message : String(err),
              updatedAt: Date.now(),
            });
          } catch {
            /* ignore */
          }
        } finally {
          active.delete(session.id);
        }
      })();
    });
  });
}
