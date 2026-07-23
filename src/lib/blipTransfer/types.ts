/**
 * Blip-style P2P file transfer for Kora.
 *
 * Direct WebRTC over LAN / internet when possible.
 * Encrypted TURN relay only when ICE cannot punch a direct path.
 * Signaling is ephemeral room metadata — file bytes never touch cloud storage.
 */

export type BlipRole = "host" | "guest";

export type BlipConnectionMode = "direct" | "relay" | "unknown";

export type BlipPhase =
  | "idle"
  | "creating"
  | "waiting"
  | "joining"
  | "connecting"
  | "ready"
  | "transferring"
  | "done"
  | "error";

export interface BlipFileMeta {
  id: string;
  name: string;
  size: number;
  type: string;
}

export interface BlipTransferProgress {
  fileId: string;
  fileName: string;
  sent: number;
  received: number;
  total: number;
  direction: "send" | "receive";
}

export interface BlipRoomDoc {
  code: string;
  status: "open" | "connected" | "closed";
  hostName: string;
  guestName?: string;
  offer?: string;
  answer?: string;
  createdAt: number;
  updatedAt: number;
}

export interface BlipSessionState {
  phase: BlipPhase;
  role: BlipRole | null;
  code: string | null;
  peerName: string | null;
  connectionMode: BlipConnectionMode;
  error: string | null;
  progress: BlipTransferProgress[];
}
