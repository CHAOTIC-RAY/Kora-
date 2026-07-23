/**
 * Blip session: host/guest WebRTC data-channel file transfer.
 * Direct P2P preferred; TURN relay only when ICE cannot connect directly.
 */

import { getDeviceName } from "../crossDeviceSync/deviceRegistry";
import { deriveRoomKey, encryptChunk, decryptChunk } from "./crypto";
import { BLIP_ICE_CONFIG, detectConnectionMode } from "./iceConfig";
import {
  closeBlipRoom,
  createBlipRoom,
  generateBlipCode,
  listenBlipIce,
  listenBlipRoom,
  normalizeBlipCode,
  writeBlipAnswer,
  writeBlipIce,
  writeBlipOffer,
} from "./signaling";
import type {
  BlipConnectionMode,
  BlipFileMeta,
  BlipPhase,
  BlipRole,
  BlipSessionState,
  BlipTransferProgress,
} from "./types";

const CHUNK = 64 * 1024;
const BUFFER_HIGH = 1024 * 1024;
const BUFFER_LOW = 256 * 1024;

type Listener = (state: BlipSessionState) => void;

function emptyState(): BlipSessionState {
  return {
    phase: "idle",
    role: null,
    code: null,
    peerName: null,
    connectionMode: "unknown",
    error: null,
    progress: [],
  };
}

export class BlipSession {
  private state: BlipSessionState = emptyState();
  private listeners = new Set<Listener>();
  private pc: RTCPeerConnection | null = null;
  private channel: RTCDataChannel | null = null;
  private key: CryptoKey | null = null;
  private unsubs: Array<() => void> = [];
  private incoming = new Map<
    string,
    { meta: BlipFileMeta; chunks: ArrayBuffer[]; received: number }
  >();
  private onFileReceived: ((file: File) => void) | null = null;

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    fn(this.state);
    return () => this.listeners.delete(fn);
  }

  onReceive(fn: (file: File) => void) {
    this.onFileReceived = fn;
  }

  getSnapshot(): BlipSessionState {
    return this.state;
  }

  private set(patch: Partial<BlipSessionState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((fn) => fn(this.state));
  }

  private setPhase(phase: BlipPhase, extra?: Partial<BlipSessionState>) {
    this.set({ phase, ...extra });
  }

  private cleanupSignaling() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];
  }

  async createRoom(): Promise<string> {
    this.close(false);
    this.setPhase("creating", { role: "host", error: null, progress: [] });
    const code = generateBlipCode();
    const hostName = getDeviceName() || "Kora Host";
    this.key = await deriveRoomKey(code);
    await createBlipRoom(code, hostName);

    const pc = new RTCPeerConnection(BLIP_ICE_CONFIG);
    this.pc = pc;
    const channel = pc.createDataChannel("kora-blip", { ordered: true });
    channel.binaryType = "arraybuffer";
    this.wireChannel(channel);

    pc.onicecandidate = (ev) => {
      if (ev.candidate) void writeBlipIce(code, "host", ev.candidate);
    };
    this.unsubs.push(listenBlipIce(code, "guest", pc));

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await writeBlipOffer(code, JSON.stringify(pc.localDescription));

    this.setPhase("waiting", { code, role: "host" });

    this.unsubs.push(
      listenBlipRoom(code, async (room) => {
        if (!room) return;
        if (room.guestName) this.set({ peerName: room.guestName });
        if (room.answer && pc.signalingState !== "stable") {
          try {
            this.setPhase("connecting");
            await pc.setRemoteDescription(JSON.parse(room.answer));
          } catch (err) {
            this.setPhase("error", {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      })
    );

    return code;
  }

  async joinRoom(rawCode: string): Promise<void> {
    this.close(false);
    const code = normalizeBlipCode(rawCode);
    if (code.length < 6) throw new Error("Enter a valid 6-character code");

    this.setPhase("joining", { role: "guest", code, error: null, progress: [] });
    this.key = await deriveRoomKey(code);
    const guestName = getDeviceName() || "Kora Guest";

    const pc = new RTCPeerConnection(BLIP_ICE_CONFIG);
    this.pc = pc;
    pc.onicecandidate = (ev) => {
      if (ev.candidate) void writeBlipIce(code, "guest", ev.candidate);
    };
    this.unsubs.push(listenBlipIce(code, "host", pc));

    pc.ondatachannel = (ev) => {
      ev.channel.binaryType = "arraybuffer";
      this.wireChannel(ev.channel);
    };

    await new Promise<void>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Room not found or expired")), 45_000);
      const unsub = listenBlipRoom(code, async (room) => {
        if (!room?.offer) return;
        try {
          window.clearTimeout(timeout);
          this.set({ peerName: room.hostName || "Host" });
          this.setPhase("connecting");
          await pc.setRemoteDescription(JSON.parse(room.offer));
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          await writeBlipAnswer(code, JSON.stringify(pc.localDescription), guestName);
          unsub();
          resolve();
        } catch (err) {
          window.clearTimeout(timeout);
          unsub();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });
      this.unsubs.push(unsub);
    });
  }

  private wireChannel(channel: RTCDataChannel) {
    this.channel = channel;
    channel.bufferedAmountLowThreshold = BUFFER_LOW;

    channel.onopen = () => {
      void (async () => {
        try {
          channel.send(
            JSON.stringify({ type: "hello", name: getDeviceName() || "Kora" })
          );
        } catch {
          /* ignore */
        }
        const mode = this.pc ? await detectConnectionMode(this.pc) : "unknown";
        this.setPhase("ready", { connectionMode: mode as BlipConnectionMode });
      })();
    };

    channel.onclose = () => {
      if (this.state.phase === "ready" || this.state.phase === "transferring") {
        this.setPhase("done");
      }
    };

    channel.onerror = () => {
      this.setPhase("error", { error: "Connection error" });
    };

    channel.onmessage = (ev) => {
      void this.handleMessage(ev.data);
    };
  }

  private async handleMessage(data: unknown) {
    if (typeof data === "string") {
      try {
        const msg = JSON.parse(data);
        if (msg.type === "file-start") {
          const meta = msg.file as BlipFileMeta;
          this.incoming.set(meta.id, { meta, chunks: [], received: 0 });
          this.upsertProgress({
            fileId: meta.id,
            fileName: meta.name,
            sent: 0,
            received: 0,
            total: meta.size,
            direction: "receive",
          });
          this.setPhase("transferring");
          return;
        }
        if (msg.type === "file-end") {
          const entry = this.incoming.get(msg.fileId);
          if (!entry || !this.key) return;
          const blob = new Blob(entry.chunks, { type: entry.meta.type || "application/octet-stream" });
          const file = new File([blob], entry.meta.name, { type: entry.meta.type });
          this.incoming.delete(msg.fileId);
          this.upsertProgress({
            fileId: entry.meta.id,
            fileName: entry.meta.name,
            sent: 0,
            received: entry.meta.size,
            total: entry.meta.size,
            direction: "receive",
          });
          this.onFileReceived?.(file);
          if (this.incoming.size === 0) this.setPhase("ready");
          return;
        }
        if (msg.type === "hello") {
          this.set({ peerName: msg.name || this.state.peerName });
        }
      } catch {
        /* ignore */
      }
      return;
    }

    let buf: ArrayBuffer;
    if (data instanceof ArrayBuffer) buf = data;
    else if (data instanceof Blob) buf = await data.arrayBuffer();
    else return;

    if (!this.key) return;
    // packed: fileIdLen(1) + fileId + encrypted
    const bytes = new Uint8Array(buf);
    const idLen = bytes[0] || 0;
    const idBytes = bytes.slice(1, 1 + idLen);
    const fileId = new TextDecoder().decode(idBytes);
    const encrypted = bytes.slice(1 + idLen).buffer;
    const plain = await decryptChunk(this.key, encrypted);
    const entry = this.incoming.get(fileId);
    if (!entry) return;
    entry.chunks.push(plain);
    entry.received += plain.byteLength;
    this.upsertProgress({
      fileId,
      fileName: entry.meta.name,
      sent: 0,
      received: entry.received,
      total: entry.meta.size,
      direction: "receive",
    });
  }

  private upsertProgress(p: BlipTransferProgress) {
    const rest = this.state.progress.filter((x) => x.fileId !== p.fileId);
    this.set({ progress: [...rest, p] });
  }

  async sendFiles(files: FileList | File[]): Promise<void> {
    const list = Array.from(files);
    if (!list.length) return;
    const channel = this.channel;
    if (!channel || channel.readyState !== "open" || !this.key) {
      throw new Error("Peer not connected yet");
    }
    this.setPhase("transferring");

    // Concurrent sends with a small pool for max throughput without melting the channel
    const queue = [...list];
    const workers = Math.min(3, queue.length);
    await Promise.all(
      Array.from({ length: workers }, async () => {
        while (queue.length) {
          const file = queue.shift();
          if (file) await this.sendOneFile(channel, file);
        }
      })
    );

    this.setPhase("ready");
  }

  private async sendOneFile(channel: RTCDataChannel, file: File): Promise<void> {
    if (!this.key) return;
    const fileId = `f_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const meta: BlipFileMeta = {
      id: fileId,
      name: file.name,
      size: file.size,
      type: file.type || "application/octet-stream",
    };
    channel.send(JSON.stringify({ type: "file-start", file: meta }));
    this.upsertProgress({
      fileId,
      fileName: file.name,
      sent: 0,
      received: 0,
      total: file.size,
      direction: "send",
    });

    const idBytes = new TextEncoder().encode(fileId);
    let offset = 0;
    while (offset < file.size) {
      const slice = file.slice(offset, offset + CHUNK);
      const plain = await slice.arrayBuffer();
      const encrypted = await encryptChunk(this.key, plain);
      const packed = new Uint8Array(1 + idBytes.length + encrypted.byteLength);
      packed[0] = idBytes.length;
      packed.set(idBytes, 1);
      packed.set(new Uint8Array(encrypted), 1 + idBytes.length);

      if (channel.bufferedAmount > BUFFER_HIGH) {
        await new Promise<void>((resolve) => {
          const check = () => {
            if (channel.bufferedAmount <= BUFFER_LOW) {
              channel.removeEventListener("bufferedamountlow", check);
              resolve();
            }
          };
          channel.addEventListener("bufferedamountlow", check);
        });
      }
      channel.send(packed.buffer);
      offset += plain.byteLength;
      this.upsertProgress({
        fileId,
        fileName: file.name,
        sent: offset,
        received: 0,
        total: file.size,
        direction: "send",
      });
    }
    channel.send(JSON.stringify({ type: "file-end", fileId }));
  }

  async close(deleteRoom = true) {
    const code = this.state.code;
    this.cleanupSignaling();
    try {
      this.channel?.close();
    } catch {
      /* ignore */
    }
    try {
      this.pc?.close();
    } catch {
      /* ignore */
    }
    this.channel = null;
    this.pc = null;
    this.key = null;
    this.incoming.clear();
    if (deleteRoom && code && this.state.role === "host") {
      void closeBlipRoom(code);
    }
    this.state = emptyState();
    this.listeners.forEach((fn) => fn(this.state));
  }
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export function connectionModeLabel(mode: BlipConnectionMode): string {
  if (mode === "direct") return "Direct P2P";
  if (mode === "relay") return "Encrypted relay";
  return "Connecting…";
}
