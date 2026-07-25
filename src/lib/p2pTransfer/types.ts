/**
 * P2P file transfer for Kora.
 *
 * Direct WebRTC over LAN / internet when possible.
 * Encrypted TURN relay only when ICE cannot punch a direct path.
 * Signaling is ephemeral room metadata — file bytes never touch cloud storage.
 */

export type P2pRole = "host" | "guest";

export type P2pConnectionMode = "direct" | "relay" | "unknown";

export type P2pPhase =
  | "idle"
  | "creating"
  | "waiting"
  | "joining"
  | "connecting"
  | "ready"
  | "transferring"
  | "done"
  | "error";

export interface P2pFileMeta {
  id: string;
  name: string;
  size: number;
  type: string;
}

export interface P2pTransferProgress {
  fileId: string;
  fileName: string;
  sent: number;
  received: number;
  total: number;
  direction: "send" | "receive";
}

export interface P2pRoomDoc {
  code: string;
  status: "open" | "connected" | "closed";
  hostName: string;
  guestName?: string;
  offer?: string;
  answer?: string;
  createdAt: number;
  updatedAt: number;
}

export interface P2pSessionState {
  phase: P2pPhase;
  role: P2pRole | null;
  code: string | null;
  peerName: string | null;
  connectionMode: P2pConnectionMode;
  error: string | null;
  progress: P2pTransferProgress[];
}
