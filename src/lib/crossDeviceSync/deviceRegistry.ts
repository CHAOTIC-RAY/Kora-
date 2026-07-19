/**
 * Device identity + Firestore registry for cross-device P2P.
 */

import {
  collection,
  doc,
  setDoc,
  getDocs,
  deleteDoc,
  onSnapshot,
  type Unsubscribe,
} from "firebase/firestore";
import { db, isRealFirebase } from "../firebase";

const DEVICE_KEY = "kora_device_id_v1";
const DEVICE_NAME_KEY = "kora_device_name_v1";

export interface KoraDevice {
  id: string;
  name: string;
  platform: string;
  lastSeen: number;
  peerSharingEnabled: boolean;
}

function detectPlatform(): string {
  const ua = navigator.userAgent || "";
  if (/Android/i.test(ua)) return "Android";
  if (/iPhone|iPad|iPod/i.test(ua)) return "iOS";
  if (/Mac/i.test(ua)) return "macOS";
  if (/Win/i.test(ua)) return "Windows";
  if (/Linux/i.test(ua)) return "Linux";
  return "Web";
}

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY);
  if (!id) {
    id = `dev_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
    localStorage.setItem(DEVICE_KEY, id);
  }
  return id;
}

export function getDeviceName(): string {
  const saved = localStorage.getItem(DEVICE_NAME_KEY);
  if (saved) return saved;
  return `${detectPlatform()} · Kora`;
}

export function setDeviceName(name: string): void {
  localStorage.setItem(DEVICE_NAME_KEY, name.trim() || getDeviceName());
}

export async function registerThisDevice(
  userId: string,
  peerSharingEnabled: boolean
): Promise<KoraDevice> {
  const device: KoraDevice = {
    id: getDeviceId(),
    name: getDeviceName(),
    platform: detectPlatform(),
    lastSeen: Date.now(),
    peerSharingEnabled: !!peerSharingEnabled,
  };
  if (!isRealFirebase || !userId || !db) return device;
  try {
    // Always write an explicit boolean so remote devices never read a stale "off".
    await setDoc(
      doc(db, "users", userId, "devices", device.id),
      {
        ...device,
        peerSharingEnabled: device.peerSharingEnabled === true,
        lastSeen: Date.now(),
      },
      { merge: true }
    );
  } catch (err) {
    console.warn("Device register deferred:", err);
  }
  return device;
}

export async function listDevices(userId: string): Promise<KoraDevice[]> {
  if (!isRealFirebase || !userId || !db) return [];
  try {
    const snap = await getDocs(collection(db, "users", userId, "devices"));
    return snap.docs.map((d) => d.data() as KoraDevice).sort((a, b) => b.lastSeen - a.lastSeen);
  } catch (err) {
    console.warn("List devices failed:", err);
    return [];
  }
}

export function subscribeDevices(
  userId: string,
  onChange: (devices: KoraDevice[]) => void
): Unsubscribe {
  if (!isRealFirebase || !userId || !db) {
    onChange([]);
    return () => undefined;
  }
  return onSnapshot(
    collection(db, "users", userId, "devices"),
    (snap) => {
      const devices = snap.docs
        .map((d) => d.data() as KoraDevice)
        .sort((a, b) => b.lastSeen - a.lastSeen);
      onChange(devices);
    },
    (err) => {
      console.warn("Devices subscription failed:", err);
      onChange([]);
    }
  );
}

export async function removeDevice(userId: string, deviceId: string): Promise<void> {
  if (!isRealFirebase || !userId || !db) return;
  await deleteDoc(doc(db, "users", userId, "devices", deviceId));
}

export function isDeviceOnline(device: KoraDevice, withinMs = 180_000): boolean {
  return Date.now() - (device.lastSeen || 0) < withinMs;
}

/** Older device docs may omit the flag — default to sharing on. */
export function isPeerSharingOn(device: KoraDevice): boolean {
  return device.peerSharingEnabled !== false;
}
