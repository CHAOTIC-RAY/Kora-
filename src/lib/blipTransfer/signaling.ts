/**
 * Ephemeral Blip room signaling via Firestore.
 * Only SDP / ICE — never file bytes.
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
import type { BlipRoomDoc } from "./types";

export function generateBlipCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  let out = "";
  for (let i = 0; i < 6; i++) {
    out += alphabet[bytes[i]! % alphabet.length];
  }
  return out;
}

function roomRef(code: string) {
  return doc(db, "blipRooms", code.toUpperCase());
}

function iceCol(code: string, role: "host" | "guest") {
  return collection(db, "blipRooms", code.toUpperCase(), `${role}Ice`);
}

export async function createBlipRoom(code: string, hostName: string): Promise<void> {
  if (!isRealFirebase || !db) throw new Error("Blip needs a network connection");
  const now = Date.now();
  const room: BlipRoomDoc = {
    code: code.toUpperCase(),
    status: "open",
    hostName,
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(roomRef(code), room);
}

export async function writeBlipOffer(code: string, offer: string): Promise<void> {
  await updateDoc(roomRef(code), { offer, updatedAt: Date.now() });
}

export async function writeBlipAnswer(
  code: string,
  answer: string,
  guestName: string
): Promise<void> {
  await updateDoc(roomRef(code), {
    answer,
    guestName,
    status: "connected",
    updatedAt: Date.now(),
  });
}

export async function writeBlipIce(
  code: string,
  role: "host" | "guest",
  candidate: RTCIceCandidate
): Promise<void> {
  const id = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  await setDoc(doc(iceCol(code, role), id), {
    candidate: candidate.toJSON(),
    createdAt: Date.now(),
  });
}

export function listenBlipRoom(
  code: string,
  onData: (room: BlipRoomDoc | null) => void
): Unsubscribe {
  return onSnapshot(roomRef(code), (snap) => {
    onData(snap.exists() ? (snap.data() as BlipRoomDoc) : null);
  });
}

export function listenBlipIce(
  code: string,
  role: "host" | "guest",
  pc: RTCPeerConnection
): Unsubscribe {
  return onSnapshot(iceCol(code, role), (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type !== "added") return;
      const data = change.doc.data();
      if (!data?.candidate) return;
      void pc.addIceCandidate(new RTCIceCandidate(data.candidate)).catch(() => undefined);
    });
  });
}

export async function closeBlipRoom(code: string): Promise<void> {
  try {
    await updateDoc(roomRef(code), { status: "closed", updatedAt: Date.now() });
  } catch {
    /* ignore */
  }
  try {
    await deleteDoc(roomRef(code));
  } catch {
    /* ignore */
  }
}

export function normalizeBlipCode(raw: string): string {
  return raw.replace(/[^a-zA-Z0-9]/g, "").toUpperCase().slice(0, 8);
}
