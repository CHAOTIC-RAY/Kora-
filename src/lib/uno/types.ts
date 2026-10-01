/**
 * Kora Uno (Wildcard Clash) — Type Definitions & Network Protocol.
 *
 * P2P card game designed to run on the same local network (LAN) via WebRTC
 * DataChannels with host-candidate prioritization, or BroadcastChannel for
 * same-device tabs, or offline solo play against CPU bots.
 */

export type UnoColor = "red" | "blue" | "green" | "yellow" | "wild";

export type UnoValue =
  | "0"
  | "1"
  | "2"
  | "3"
  | "4"
  | "5"
  | "6"
  | "7"
  | "8"
  | "9"
  | "skip"
  | "reverse"
  | "draw2"
  | "wild"
  | "wild4";

export interface UnoCard {
  id: string;
  color: UnoColor;
  value: UnoValue;
  scoreValue: number;
}

export interface UnoPlayer {
  id: string;
  name: string;
  isHost: boolean;
  isCpu: boolean;
  avatarSeed: string;
  cardCount: number;
  hasCalledUno: boolean;
}

export type UnoDirection = "clockwise" | "counter-clockwise";

export interface UnoPublicGameState {
  roomCode: string;
  phase: "lobby" | "playing" | "game_over";
  players: UnoPlayer[];
  activePlayerIndex: number;
  direction: UnoDirection;
  topDiscard: UnoCard;
  currentColor: UnoColor;
  drawStackCount: number;
  winnerId: string | null;
  turnDeadline: number | null;
  lastActionDescription: string;
}

export type UnoPacket =
  | { type: "JOIN"; player: UnoPlayer }
  | { type: "SYNC_STATE"; state: UnoPublicGameState; yourHand: UnoCard[] }
  | { type: "PLAY_CARD"; cardId: string; chosenColor?: UnoColor }
  | { type: "DRAW_CARD" }
  | { type: "PASS_TURN" }
  | { type: "CALL_UNO" }
  | { type: "CATCH_UNO"; targetPlayerId: string }
  | { type: "CHAT_REACTION"; emote: string; senderId: string };
