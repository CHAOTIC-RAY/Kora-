/**
 * P2P Transport Layer for Kora Uno.
 *
 * Direct WebRTC DataChannels over local Wi-Fi / LAN with host-candidate prioritization.
 * Signaling uses ephemeral Firestore documents (only SDP/ICE, never game state).
 * BroadcastChannel provides instant zero-network fallback for multi-tab play.
 */

import { db, isRealFirebase } from "../firebase";
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  setDoc,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { P2P_ICE_CONFIG } from "../p2pTransfer/iceConfig";
import type { UnoPacket, UnoPlayer } from "./types";

export type PacketHandler = (packet: UnoPacket, senderId: string) => void;

export function generateUnoRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

export class UnoP2pTransport {
  public roomCode: string;
  public isHost: boolean;
  public localPlayer: UnoPlayer;

  private broadcast: BroadcastChannel | null = null;
  private listeners = new Set<PacketHandler>();
  private peerConnections = new Map<string, RTCPeerConnection>();
  private dataChannels = new Map<string, RTCDataChannel>();
  private unsubs: Unsubscribe[] = [];

  constructor(roomCode: string, isHost: boolean, localPlayer: UnoPlayer) {
    this.roomCode = roomCode.toUpperCase();
    this.isHost = isHost;
    this.localPlayer = localPlayer;

    // Same-device / local BroadcastChannel fallback
    if (typeof window !== "undefined" && "BroadcastChannel" in window) {
      this.broadcast = new BroadcastChannel(`kora_uno_room_${this.roomCode}`);
      this.broadcast.onmessage = (event) => {
        if (event.data && event.data.senderId !== this.localPlayer.id) {
          this.emitPacket(event.data.packet, event.data.senderId);
        }
      };
    }
  }

  /**
   * Ids of peers whose data channel is open.
   *
   * The host needs this to know WHO is actually connected. `launchP2pGame` used
   * to hardcode an empty guest list, so it backfilled the human guest's seat with
   * a CPU bot and the SYNC_STATE broadcast loop iterated a player list that
   * contained no human — so `sendToPeer` was never called and the guest received
   * nothing.
   */
  public connectedPeerIds(): string[] {
    return Array.from(this.dataChannels.entries())
      .filter(([, dc]) => dc.readyState === "open")
      .map(([id]) => id);
  }

  public onPacket(handler: PacketHandler): () => void {
    this.listeners.add(handler);
    return () => this.listeners.delete(handler);
  }

  private emitPacket(packet: UnoPacket, senderId: string) {
    this.listeners.forEach((fn) => fn(packet, senderId));
  }

  /**
   * Send packet to all peers (broadcast over WebRTC DataChannels + BroadcastChannel).
   */
  public send(packet: UnoPacket) {
    const raw = JSON.stringify(packet);
    this.dataChannels.forEach((dc) => {
      if (dc.readyState === "open") {
        try {
          dc.send(raw);
        } catch (err) {
          console.warn("Failed to send over WebRTC DC:", err);
        }
      }
    });

    if (this.broadcast) {
      this.broadcast.postMessage({
        packet,
        senderId: this.localPlayer.id,
      });
    }
  }

  /**
   * Send packet to a specific peer only (e.g. host syncing private hand cards).
   */
  public sendToPeer(targetPeerId: string, packet: UnoPacket) {
    const dc = this.dataChannels.get(targetPeerId);
    if (dc && dc.readyState === "open") {
      try {
        dc.send(JSON.stringify(packet));
        return;
      } catch (err) {
        console.warn("DC send error to target:", err);
      }
    }

    // Fallback over broadcast channel with destination check
    if (this.broadcast) {
      this.broadcast.postMessage({
        packet,
        senderId: this.localPlayer.id,
        targetPeerId,
      });
    }
  }

  /**
   * Initialize signaling room in Firestore if Firebase is active.
   */
  public async initSignaling(): Promise<void> {
    if (!isRealFirebase || !db) return;

    const roomDoc = doc(db, "unoRooms", this.roomCode);

    if (this.isHost) {
      await setDoc(roomDoc, {
        code: this.roomCode,
        hostId: this.localPlayer.id,
        hostName: this.localPlayer.name,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      });

      // Listen for incoming guest connections
      const guestsCol = collection(db, "unoRooms", this.roomCode, "guests");
      const unsub = onSnapshot(guestsCol, (snap) => {
        snap.docChanges().forEach(async (change) => {
          if (change.type === "added") {
            const guestData = change.doc.data();
            const guestId = change.doc.id;
            if (guestData && guestData.offer && !this.peerConnections.has(guestId)) {
              await this.handleIncomingGuestOffer(guestId, guestData.offer);
            }
          }
        });
      });
      this.unsubs.push(unsub);
    } else {
      // Guest joins by creating an offer to the host
      await this.initiateGuestConnection();
    }
  }

  private async handleIncomingGuestOffer(guestId: string, offerSdp: string) {
    if (!isRealFirebase || !db) return;
    try {
      const pc = new RTCPeerConnection(P2P_ICE_CONFIG);
      this.peerConnections.set(guestId, pc);

      pc.ondatachannel = (ev) => {
        const dc = ev.channel;
        this.setupDataChannel(guestId, dc);
      };

      pc.onicecandidate = async (ev) => {
        if (ev.candidate) {
          const candDoc = doc(
            collection(db, "unoRooms", this.roomCode, `hostIce_${guestId}`)
          );
          await setDoc(candDoc, {
            candidate: ev.candidate.toJSON(),
            createdAt: Date.now(),
          });
        }
      };

      await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(offerSdp)));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);

      const guestDoc = doc(db, "unoRooms", this.roomCode, "guests", guestId);
      await updateDoc(guestDoc, {
        answer: JSON.stringify(answer),
        updatedAt: Date.now(),
      });

      // Listen for guest ICE candidates
      const guestIceCol = collection(db, "unoRooms", this.roomCode, `guestIce_${guestId}`);
      const unsub = onSnapshot(guestIceCol, (snap) => {
        snap.docChanges().forEach((ch) => {
          if (ch.type === "added") {
            const cand = ch.doc.data()?.candidate;
            if (cand) {
              void pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
            }
          }
        });
      });
      this.unsubs.push(unsub);
    } catch (err) {
      console.error("Host failed to accept guest offer:", err);
    }
  }

  private async initiateGuestConnection() {
    if (!isRealFirebase || !db) return;
    try {
      const pc = new RTCPeerConnection(P2P_ICE_CONFIG);
      this.peerConnections.set("host", pc);

      const dc = pc.createDataChannel("kora-uno-channel", { ordered: true });
      this.setupDataChannel("host", dc);

      pc.onicecandidate = async (ev) => {
        if (ev.candidate) {
          const candDoc = doc(
            collection(db, "unoRooms", this.roomCode, `guestIce_${this.localPlayer.id}`)
          );
          await setDoc(candDoc, {
            candidate: ev.candidate.toJSON(),
            createdAt: Date.now(),
          });
        }
      };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      const guestDoc = doc(db, "unoRooms", this.roomCode, "guests", this.localPlayer.id);
      await setDoc(guestDoc, {
        name: this.localPlayer.name,
        offer: JSON.stringify(offer),
        createdAt: Date.now(),
      });

      // Listen for host answer
      const unsub = onSnapshot(guestDoc, async (snap) => {
        const data = snap.data();
        if (data && data.answer && !pc.currentRemoteDescription) {
          await pc.setRemoteDescription(new RTCSessionDescription(JSON.parse(data.answer)));
        }
      });
      this.unsubs.push(unsub);

      // Listen for host ICE
      const hostIceCol = collection(
        db,
        "unoRooms",
        this.roomCode,
        `hostIce_${this.localPlayer.id}`
      );
      const unsubIce = onSnapshot(hostIceCol, (snap) => {
        snap.docChanges().forEach((ch) => {
          if (ch.type === "added") {
            const cand = ch.doc.data()?.candidate;
            if (cand) {
              void pc.addIceCandidate(new RTCIceCandidate(cand)).catch(() => {});
            }
          }
        });
      });
      this.unsubs.push(unsubIce);
    } catch (err) {
      console.error("Guest failed to initiate connection:", err);
    }
  }

  private setupDataChannel(peerId: string, dc: RTCDataChannel) {
    dc.onopen = () => {
      console.log(`[P2P Uno] WebRTC DataChannel OPEN with peer: ${peerId}`);
      this.dataChannels.set(peerId, dc);
      if (!this.isHost) {
        // Send join packet to host
        this.send({ type: "JOIN", player: this.localPlayer });
      }
    };

    dc.onmessage = (event) => {
      try {
        const packet = JSON.parse(event.data) as UnoPacket;
        this.emitPacket(packet, peerId);
      } catch (err) {
        console.error("Failed to parse Uno packet from DC:", err);
      }
    };

    dc.onclose = () => {
      console.log(`[P2P Uno] DataChannel closed with peer: ${peerId}`);
      this.dataChannels.delete(peerId);
    };

    dc.onerror = (err) => {
      console.warn(`[P2P Uno] DataChannel error with peer ${peerId}:`, err);
    };
  }

  public disconnect() {
    this.unsubs.forEach((u) => u());
    this.unsubs = [];

    this.dataChannels.forEach((dc) => dc.close());
    this.dataChannels.clear();

    this.peerConnections.forEach((pc) => pc.close());
    this.peerConnections.clear();

    this.broadcast?.close();
    this.broadcast = null;

    if (this.isHost && isRealFirebase && db) {
      const roomDoc = doc(db, "unoRooms", this.roomCode);
      void deleteDoc(roomDoc).catch(() => {});
    }
  }
}
