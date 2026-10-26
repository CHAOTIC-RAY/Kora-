import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  X,
  Flame,
  Users,
  Cpu,
  Wifi,
  Copy,
  Check,
  RotateCcw,
  Sparkles,
  Trophy,
  Volume2,
  VolumeX,
  ArrowRight,
  ShieldAlert,
  Play,
  Share2,
} from "lucide-react";
import toast from "react-hot-toast";
import { isSoundEffectsEnabled, setSoundEffectsEnabled } from "../lib/featureToggles";
import { auth } from "../lib/firebase";
import { canPlayCard, getCardColorStyle } from "../lib/uno/deck";
import {
  callUno,
  catchUno,
  chooseCpuMove,
  drawCardsForPlayer,
  initializeGame,
  passTurn,
  playCard,
  type UnoFullGameState,
} from "../lib/uno/engine";
import { playUnoSound } from "../lib/uno/audio";
import { generateUnoRoomCode, UnoP2pTransport } from "../lib/uno/p2pTransport";
import type {
  UnoCard,
  UnoColor,
  UnoPacket,
  UnoPlayer,
  UnoPublicGameState,
} from "../lib/uno/types";

export interface UnoGameProps {
  open: boolean;
  onClose: () => void;
  variant?: "fullscreen" | "popup";
  onOpenScores?: () => void;
}

const UNO_CARD_COLORS: Record<Exclude<UnoColor, "wild">, string> = {
  red: "#f04452",
  blue: "#2588ff",
  green: "#20b979",
  yellow: "#f8c844",
};

function unoSymbol(value: UnoCard["value"]): string {
  if (value === "skip") return "⊘";
  if (value === "reverse") return "⇄";
  if (value === "draw2") return "+2";
  if (value === "wild4") return "+4";
  if (value === "wild") return "✦";
  return value;
}

/** Bespoke card artwork: custom color field, ivory inset, diagonal oval and corner indices. */
function UnoCardArt({ card, compact = false }: { card: UnoCard; compact?: boolean }) {
  const wild = card.color === "wild";
  const color = wild ? "#171923" : UNO_CARD_COLORS[card.color];
  return (
    <div
      className={`relative h-full w-full overflow-hidden rounded-[0.8rem] border-[3px] border-white/95 shadow-[0_8px_18px_rgba(0,0,0,.28)] ${compact ? "rounded-[0.65rem]" : ""}`}
      style={{ background: color, boxShadow: "inset 0 0 0 1px rgba(0,0,0,.1), 0 8px 18px rgba(0,0,0,.28)" }}
    >
      {wild ? (
        <div className="absolute inset-0 grid grid-cols-2 grid-rows-2 rotate-[-12deg] scale-125">
          <span style={{ background: UNO_CARD_COLORS.red }} />
          <span style={{ background: UNO_CARD_COLORS.blue }} />
          <span style={{ background: UNO_CARD_COLORS.yellow }} />
          <span style={{ background: UNO_CARD_COLORS.green }} />
        </div>
      ) : (
        <div className="absolute inset-[9%] rounded-[50%] border-[2px] border-white/90 bg-white/10 rotate-[-24deg]" />
      )}
      <span className={`absolute left-[7%] top-[5%] z-[1] font-black leading-none text-white drop-shadow ${compact ? "text-[8px]" : "text-[10px] sm:text-xs"}`}>
        {unoSymbol(card.value)}
      </span>
      <span className={`absolute inset-0 z-[1] flex items-center justify-center font-black italic leading-none text-white drop-shadow-[0_2px_2px_rgba(0,0,0,.4)] ${compact ? "text-2xl" : "text-3xl sm:text-4xl"}`}>
        {unoSymbol(card.value)}
      </span>
      <span className={`absolute bottom-[5%] right-[7%] z-[1] rotate-180 font-black leading-none text-white drop-shadow ${compact ? "text-[8px]" : "text-[10px] sm:text-xs"}`}>
        {unoSymbol(card.value)}
      </span>
      {wild && <span className="absolute inset-[22%] z-[1] rounded-full border-2 border-white/90 bg-[#171923] shadow-lg" />}
      {wild && <span className="absolute inset-[22%] z-[2] flex items-center justify-center text-xl font-black text-white sm:text-2xl">{unoSymbol(card.value)}</span>}
    </div>
  );
}

function UnoCardBack({ compact = false }: { compact?: boolean }) {
  return (
    <div
      className={`relative h-full w-full overflow-hidden rounded-[0.8rem] border-[3px] border-white bg-[#171923] shadow-[0_8px_18px_rgba(0,0,0,.35)] ${compact ? "rounded-[0.65rem]" : ""}`}
      style={{ backgroundImage: "radial-gradient(circle at 20% 20%, rgba(255,255,255,.12) 1px, transparent 1px), linear-gradient(135deg,#25283a,#11131d)", backgroundSize: "9px 9px, auto" }}
    >
      <div className="absolute inset-[9%] rotate-[-18deg] rounded-[50%] border-[3px] border-white bg-gradient-to-br from-rose-500 via-orange-400 to-yellow-300 shadow-xl" />
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="rounded-full border-2 border-white px-2 py-1 text-[10px] font-black italic tracking-tight text-white shadow-lg sm:px-3 sm:py-1.5 sm:text-sm">KORA</span>
      </div>
      <span className="absolute bottom-1 right-1 text-[7px] font-black tracking-widest text-white/80">UNO</span>
    </div>
  );
}


export default function UnoGame({
  open,
  onClose,
  variant = "fullscreen",
  onOpenScores,
}: UnoGameProps) {
  // Screens: "menu" | "lobby" | "playing" | "game_over"
  const [screen, setScreen] = useState<"menu" | "lobby" | "playing" | "game_over">("menu");
  const [matchMode, setMatchMode] = useState<"solo" | "p2p">("solo");
  const [roomCode, setRoomCode] = useState<string>("");
  const [joinInput, setJoinInput] = useState<string>("");
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [botCount, setBotCount] = useState<number>(3);
  const [soundOn, setSoundOn] = useState<boolean>(() => isSoundEffectsEnabled());

  // Game Engine & Transport
  const [engineState, setEngineState] = useState<UnoFullGameState | null>(null);
  const [myHand, setMyHand] = useState<UnoCard[]>([]);
  const [publicState, setPublicState] = useState<UnoPublicGameState | null>(null);
  const [selectedWildCard, setSelectedWildCard] = useState<UnoCard | null>(null);

  const transportRef = useRef<UnoP2pTransport | null>(null);
  const botTimerRef = useRef<number | null>(null);

  const myId = useMemo(() => {
    return auth?.currentUser?.uid || "player_" + Math.random().toString(36).slice(2, 7);
  }, []);

  const myName = useMemo(() => {
    return auth?.currentUser?.displayName || "Player 1";
  }, []);

  // Sync sound setting
  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundEffectsEnabled(next);
  };

  // Cleanup on unmount or close
  const cleanup = useCallback(() => {
    if (botTimerRef.current) {
      window.clearTimeout(botTimerRef.current);
      botTimerRef.current = null;
    }
    if (transportRef.current) {
      transportRef.current.disconnect();
      transportRef.current = null;
    }
    setEngineState(null);
    setPublicState(null);
    setMyHand([]);
    setSelectedWildCard(null);
  }, []);

  useEffect(() => {
    if (!open) cleanup();
  }, [open, cleanup]);

  // Host starts game (Solo bots or P2P lobby)
  const startSoloGame = () => {
    cleanup();
    const humanPlayer: UnoPlayer = {
      id: myId,
      name: myName,
      isHost: true,
      isCpu: false,
      avatarSeed: "human",
      cardCount: 7,
      hasCalledUno: false,
    };

    const botNames = ["Sage Orion", "Archivist Lyra", "Scholar Finch"];
    const bots: UnoPlayer[] = Array.from({ length: botCount }).map((_, i) => ({
      id: `bot_${i + 1}`,
      name: botNames[i] || `CPU ${i + 1}`,
      isHost: false,
      isCpu: true,
      avatarSeed: `bot_${i}`,
      cardCount: 7,
      hasCalledUno: false,
    }));

    const players = [humanPlayer, ...bots];
    const initialEngine = initializeGame("OFFLINE_SOLO", players);

    setEngineState(initialEngine);
    setPublicState(initialEngine.publicState);
    setMyHand(initialEngine.hands[myId] || []);
    setMatchMode("solo");
    setScreen("playing");
    playUnoSound("action");
  };

  // Host P2P Room on local Wi-Fi / network
  const hostP2pRoom = async () => {
    cleanup();
    const code = generateUnoRoomCode();
    setRoomCode(code);
    setMatchMode("p2p");

    const hostPlayer: UnoPlayer = {
      id: myId,
      name: myName,
      isHost: true,
      isCpu: false,
      avatarSeed: "host",
      cardCount: 0,
      hasCalledUno: false,
    };

    const transport = new UnoP2pTransport(code, true, hostPlayer);
    transportRef.current = transport;

    transport.onPacket((packet, senderId) => {
      handleP2pPacket(packet, senderId);
    });

    try {
      await transport.initSignaling();
    } catch (err) {
      // Surface it. A console.warn hid PERMISSION_DENIED from a missing
      // unoRooms rule for the entire life of this feature, so the lobby opened
      // looking healthy while signalling could never happen.
      console.warn("Firestore signaling offline, relying on LAN/BroadcastChannel:", err);
      toast.error(
        "Online signalling is unavailable — a peer on another network will not be found. " +
          "Same-Wi-Fi players can still connect."
      );
    }

    setScreen("lobby");
  };

  // Join P2P Room on local Wi-Fi / network
  const joinP2pRoom = async (codeToJoin: string) => {
    const code = codeToJoin.trim().toUpperCase();
    if (!code) {
      toast.error("Please enter a room code");
      return;
    }
    cleanup();
    setRoomCode(code);
    setMatchMode("p2p");

    const guestPlayer: UnoPlayer = {
      id: myId,
      name: myName,
      isHost: false,
      isCpu: false,
      avatarSeed: "guest",
      cardCount: 0,
      hasCalledUno: false,
    };

    const transport = new UnoP2pTransport(code, false, guestPlayer);
    transportRef.current = transport;

    transport.onPacket((packet, senderId) => {
      handleP2pPacket(packet, senderId);
    });

    try {
      await transport.initSignaling();
    } catch (err) {
      console.warn("Firestore signaling offline, connecting via LAN/BroadcastChannel:", err);
      toast.error(
        "Online signalling is unavailable — you can only reach players on this network."
      );
    }

    // No JOIN is sent here: the data channel cannot be open yet, so
    // transport.send() iterates an empty map and is a silent no-op. The
    // transport already sends JOIN itself from dc.onopen
    // (p2pTransport.ts:273), which is the only copy that can actually arrive.
    setScreen("lobby");
    toast.success(`Joined room ${code}!`);
  };

  // Host launches game after players gather in lobby
  const launchP2pGame = () => {
    if (!transportRef.current || !transportRef.current.isHost) return;

    const host = transportRef.current.localPlayer;
    // Real guests only: prefer the transport's OPEN channels, and fall back to
    // the JOIN roster for a guest whose channel closed a moment ago.
    const connected = new Set(transportRef.current.connectedPeerIds());
    const currentGuests: UnoPlayer[] = joinedGuests.filter((g) => connected.has(g.id));
    const roster = currentGuests.length > 0 ? currentGuests : joinedGuests;
    const players: UnoPlayer[] = [host, ...roster];

    // Only top up with bots when genuinely alone — a connected human must keep
    // their own seat rather than being replaced by a Scholar Bot.
    while (players.length < 2) {
      const idx = players.length;
      players.push({
        id: `bot_${idx}`,
        name: `Scholar Bot ${idx}`,
        isHost: false,
        isCpu: true,
        avatarSeed: `bot_${idx}`,
        cardCount: 7,
        hasCalledUno: false,
      });
    }

    const initialEngine = initializeGame(roomCode, players);
    setEngineState(initialEngine);
    setPublicState(initialEngine.publicState);
    setMyHand(initialEngine.hands[myId] || []);

    // Broadcast state to all connected peers
    players.forEach((p) => {
      if (!p.isCpu && p.id !== myId) {
        transportRef.current?.sendToPeer(p.id, {
          type: "SYNC_STATE",
          state: initialEngine.publicState,
          yourHand: initialEngine.hands[p.id] || [],
        });
      }
    });

    setScreen("playing");
    playUnoSound("action");
  };

  // Packet receiver handler
  /**
   * Human guests that have joined this host's lobby.
   *
   * `launchP2pGame` previously read a hardcoded `const currentGuests = []`, so a
   * real guest was absent from the engine, its seat was backfilled with a CPU
   * bot, and the SYNC_STATE broadcast iterated a player list containing no human
   * — meaning `sendToPeer` was never called and the guest received nothing.
   * The guest has always sent `JOIN` (types.ts:62) but nothing handled it.
   */
  const [joinedGuests, setJoinedGuests] = useState<UnoPlayer[]>([]);

  // Only the host collects a roster; a guest's list stays empty, so the lobby
  // must not claim a peer count it cannot actually see.
  const isP2pHost = transportRef.current?.isHost ?? false;

  const handleP2pPacket = (packet: UnoPacket, senderId: string) => {
    if (packet.type === "JOIN") {
      // De-dupe by player id: the guest sends JOIN on channel open, and a
      // retry after a reconnect would otherwise duplicate the seat.
      setJoinedGuests((prev) =>
        prev.some((g) => g.id === packet.player.id) ? prev : [...prev, packet.player]
      );
      playUnoSound("card_play");
      return;
    }
    if (packet.type === "SYNC_STATE") {
      setPublicState(packet.state);
      setMyHand(packet.yourHand);
      if (packet.state.phase === "playing") setScreen("playing");
      if (packet.state.phase === "game_over") setScreen("game_over");
      playUnoSound("card_play");
    } else if (packet.type === "PLAY_CARD" && engineState) {
      // Host handles move
      const res = playCard(engineState, senderId, packet.cardId, packet.chosenColor);
      if (res.success) {
        syncP2pState();
        playUnoSound("card_play");
      }
    } else if (packet.type === "DRAW_CARD" && engineState) {
      drawCardsForPlayer(engineState, senderId, 1);
      syncP2pState();
      playUnoSound("card_draw");
    } else if (packet.type === "CALL_UNO" && engineState) {
      if (callUno(engineState, senderId)) {
        syncP2pState();
        playUnoSound("uno_call");
      }
    } else if (packet.type === "CATCH_UNO" && engineState) {
      if (catchUno(engineState, senderId, packet.targetPlayerId)) {
        syncP2pState();
        playUnoSound("penalty");
      }
    }
  };

  const syncP2pState = () => {
    if (!engineState) return;
    setPublicState({ ...engineState.publicState });
    setMyHand([...(engineState.hands[myId] || [])]);

    if (transportRef.current && transportRef.current.isHost) {
      engineState.publicState.players.forEach((p) => {
        if (!p.isCpu && p.id !== myId) {
          transportRef.current?.sendToPeer(p.id, {
            type: "SYNC_STATE",
            state: engineState.publicState,
            yourHand: engineState.hands[p.id] || [],
          });
        }
      });
    }

    if (engineState.publicState.phase === "game_over") {
      setScreen("game_over");
      playUnoSound("victory");
    }
  };

  // Check active player
  const activePlayer = useMemo(() => {
    if (!publicState || publicState.players.length === 0) return null;
    return publicState.players[publicState.activePlayerIndex] || null;
  }, [publicState]);

  const isMyTurn = useMemo(() => {
    return activePlayer?.id === myId;
  }, [activePlayer, myId]);

  // Turn Execution for CPU Bots
  useEffect(() => {
    if (screen !== "playing" || !engineState || !activePlayer || !activePlayer.isCpu) {
      return;
    }

    botTimerRef.current = window.setTimeout(() => {
      const botHand = engineState.hands[activePlayer.id] || [];
      const move = chooseCpuMove(
        botHand,
        engineState.publicState.topDiscard,
        engineState.publicState.currentColor
      );

      if (move.action === "play") {
        playCard(engineState, activePlayer.id, move.card.id, move.chosenColor);
        // Bot calls Uno if down to 1 card
        if (botHand.length === 1) {
          callUno(engineState, activePlayer.id);
        }
        playUnoSound("card_play");
      } else {
        drawCardsForPlayer(engineState, activePlayer.id, 1);
        passTurn(engineState, activePlayer.id);
        playUnoSound("card_draw");
      }

      syncP2pState();
    }, 1200);

    return () => {
      if (botTimerRef.current) {
        window.clearTimeout(botTimerRef.current);
        botTimerRef.current = null;
      }
    };
  }, [screen, activePlayer, engineState]);

  // Player Actions
  const handleCardClick = (card: UnoCard) => {
    if (!isMyTurn || !publicState) return;

    if (!canPlayCard(card, publicState.topDiscard, publicState.currentColor)) {
      toast.error("That card cannot be played on the current pile!");
      return;
    }

    if (card.color === "wild") {
      setSelectedWildCard(card);
      return;
    }

    executePlayCard(card.id);
  };

  const handleSelectWildColor = (color: UnoColor) => {
    if (!selectedWildCard) return;
    executePlayCard(selectedWildCard.id, color);
    setSelectedWildCard(null);
  };

  const executePlayCard = (cardId: string, chosenColor?: UnoColor) => {
    if (matchMode === "solo" && engineState) {
      const res = playCard(engineState, myId, cardId, chosenColor);
      if (res.success) {
        syncP2pState();
        playUnoSound("card_play");
      }
    } else if (matchMode === "p2p" && transportRef.current) {
      if (transportRef.current.isHost && engineState) {
        const res = playCard(engineState, myId, cardId, chosenColor);
        if (res.success) {
          syncP2pState();
          playUnoSound("card_play");
        }
      } else {
        transportRef.current.send({
          type: "PLAY_CARD",
          cardId,
          chosenColor,
        });
      }
    }
  };

  const handleDrawCard = () => {
    if (!isMyTurn) return;

    if (matchMode === "solo" && engineState) {
      drawCardsForPlayer(engineState, myId, 1);
      passTurn(engineState, myId);
      syncP2pState();
      playUnoSound("card_draw");
    } else if (matchMode === "p2p" && transportRef.current) {
      if (transportRef.current.isHost && engineState) {
        drawCardsForPlayer(engineState, myId, 1);
        passTurn(engineState, myId);
        syncP2pState();
        playUnoSound("card_draw");
      } else {
        transportRef.current.send({ type: "DRAW_CARD" });
      }
    }
  };

  const handleCallUno = () => {
    if (matchMode === "solo" && engineState) {
      if (callUno(engineState, myId)) {
        syncP2pState();
        playUnoSound("uno_call");
        toast.success("Shouted UNO!");
      }
    } else if (matchMode === "p2p" && transportRef.current) {
      if (transportRef.current.isHost && engineState) {
        if (callUno(engineState, myId)) {
          syncP2pState();
          playUnoSound("uno_call");
          toast.success("Shouted UNO!");
        }
      } else {
        transportRef.current.send({ type: "CALL_UNO" });
      }
    }
  };

  const handleCatchUno = (targetId: string) => {
    if (matchMode === "solo" && engineState) {
      if (catchUno(engineState, myId, targetId)) {
        syncP2pState();
        playUnoSound("penalty");
        toast.success("Caught opponent without calling UNO! (+2 cards)");
      }
    } else if (matchMode === "p2p" && transportRef.current) {
      if (transportRef.current.isHost && engineState) {
        if (catchUno(engineState, myId, targetId)) {
          syncP2pState();
          playUnoSound("penalty");
          toast.success("Caught opponent without calling UNO! (+2 cards)");
        }
      } else {
        transportRef.current.send({ type: "CATCH_UNO", targetPlayerId: targetId });
      }
    }
  };

  const copyRoomCode = () => {
    if (!roomCode) return;
    navigator.clipboard.writeText(roomCode);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
    toast.success("Room code copied to clipboard!");
  };

  if (!open) return null;

  return (
    <AnimatePresence>
      <div className="kora-game-theme fixed inset-0 z-50 flex items-center justify-center bg-black/65 backdrop-blur-md p-2 sm:p-4">
        <motion.div
          style={{ backgroundColor: "var(--theme-bg)", color: "var(--theme-text)" }}
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className={`kora-game-theme w-full border border-[var(--theme-border)] rounded-3xl overflow-hidden shadow-2xl flex flex-col ${
            variant === "fullscreen" ? "h-full max-w-full rounded-none" : "h-[90vh] max-w-5xl"
          }`}
        >
          {/* Header Bar */}
          <header className="px-5 py-3 border-b border-[var(--theme-border)] flex items-center justify-between shrink-0 bg-[var(--theme-card)]">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-rose-500/10 text-rose-500">
                <Flame className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-sm font-bold text-kindle-text flex items-center gap-2">
                  Kora Uno
                  <span className="text-[10px] font-sans font-bold px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-500 uppercase tracking-widest">
                    Wildcard Clash
                  </span>
                </h2>
                <p className="text-[10px] text-kindle-text-muted">
                  Same-Network P2P · Wi-Fi &amp; Offline Bots
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={toggleSound}
                aria-label="Toggle sound effects"
                className="p-2 rounded-xl border border-kindle-border hover:bg-kindle-card text-kindle-text-muted transition cursor-pointer"
              >
                {soundOn ? <Volume2 className="w-4 h-4 text-kindle-accent" /> : <VolumeX className="w-4 h-4" />}
              </button>

              {onOpenScores && (
                <button
                  type="button"
                  onClick={onOpenScores}
                  title="Open Score Tracker"
                  className="p-2 rounded-xl border border-kindle-border hover:bg-kindle-card text-kindle-text-muted transition cursor-pointer"
                >
                  <Trophy className="w-4 h-4" />
                </button>
              )}

              <button
                type="button"
                onClick={onClose}
                aria-label="Close game"
                className="p-2 rounded-xl border border-kindle-border hover:bg-kindle-card text-kindle-text-muted transition cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </header>

          {/* SCREEN 1: MENU / MODE SELECTION */}
          {screen === "menu" && (
            <main className="relative flex-1 overflow-y-auto bg-[var(--theme-bg)] px-4 py-7 text-[var(--theme-text)] sm:px-8 sm:py-10">
              <div className="pointer-events-none absolute inset-0 opacity-70" style={{ background: "radial-gradient(ellipse at 50% 0%, color-mix(in srgb, var(--theme-accent) 14%, transparent), transparent 45%), radial-gradient(ellipse at 0% 100%, color-mix(in srgb, var(--theme-accent) 10%, transparent), transparent 40%)" }} />
              <div className="relative mx-auto flex min-h-full w-full max-w-4xl flex-col items-center justify-center gap-7 text-center">
                <div className="relative">
                  <div className="absolute -inset-5 rounded-full bg-[var(--theme-accent)]/15 blur-2xl" />
                  <div className="relative grid h-24 w-24 place-items-center rounded-[2rem] border border-[var(--theme-border)] bg-[var(--theme-card)] shadow-2xl rotate-[-7deg]">
                    <div className="h-16 w-12 rotate-[7deg] rounded-xl border-[3px] border-white bg-gradient-to-br from-rose-500 via-orange-400 to-yellow-300 shadow-xl flex items-center justify-center">
                      <span className="text-2xl font-black italic text-white">K</span>
                    </div>
                  </div>
                </div>
                <div className="space-y-3">
                  <p className="text-[10px] font-black uppercase tracking-[.35em] text-[var(--theme-accent)]">Kora Originals · Card Arena</p>
                  <h3 className="text-4xl font-black italic tracking-tight sm:text-6xl">WILDCARD <span className="text-[var(--theme-accent)]">CLASH</span></h3>
                  <p className="mx-auto max-w-lg text-sm leading-relaxed text-[var(--theme-text-muted)]">
                    Outplay the table. Save your wild card. Call UNO before they catch you.
                  </p>
                </div>
                <div className="grid w-full gap-4 pt-1 sm:grid-cols-2">
                  <button type="button" onClick={startSoloGame} className="group relative overflow-hidden rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5 text-left shadow-xl transition hover:-translate-y-1 hover:border-[var(--theme-accent)] hover:shadow-2xl sm:p-6">
                    <div className="absolute -right-5 -top-8 h-32 w-28 rotate-12 opacity-80 transition group-hover:rotate-6 group-hover:scale-110">
                      <UnoCardArt card={{ id: "menu-green", color: "green", value: "7", scoreValue: 7 }} compact />
                    </div>
                    <div className="relative z-10 flex h-full min-h-36 flex-col items-start justify-between gap-6">
                      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--theme-accent)]/10 text-[var(--theme-accent)]"><Cpu className="h-5 w-5" /></span>
                      <div><h4 className="text-lg font-black">Solo Showdown</h4><p className="mt-1 max-w-[230px] text-xs leading-relaxed text-[var(--theme-text-muted)]">Jump straight into a match against tactical offline bots.</p></div>
                      <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-[var(--theme-accent)]">Play now <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></span>
                    </div>
                  </button>
                  <button type="button" onClick={hostP2pRoom} className="group relative overflow-hidden rounded-3xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-5 text-left shadow-xl transition hover:-translate-y-1 hover:border-[var(--theme-accent)] hover:shadow-2xl sm:p-6">
                    <div className="absolute -right-5 -top-8 h-32 w-28 rotate-12 opacity-80 transition group-hover:rotate-6 group-hover:scale-110">
                      <UnoCardArt card={{ id: "menu-wild", color: "wild", value: "wild4", scoreValue: 50 }} compact />
                    </div>
                    <div className="relative z-10 flex h-full min-h-36 flex-col items-start justify-between gap-6">
                      <span className="grid h-11 w-11 place-items-center rounded-2xl bg-[var(--theme-accent)]/10 text-[var(--theme-accent)]"><Wifi className="h-5 w-5" /></span>
                      <div><h4 className="text-lg font-black">Friend Arena</h4><p className="mt-1 max-w-[230px] text-xs leading-relaxed text-[var(--theme-text-muted)]">Create a room and invite a friend with a six-character code.</p></div>
                      <span className="inline-flex items-center gap-2 text-xs font-black uppercase tracking-widest text-[var(--theme-accent)]">Host a game <ArrowRight className="h-4 w-4 transition group-hover:translate-x-1" /></span>
                    </div>
                  </button>
                </div>
                <div className="w-full max-w-xl rounded-2xl border border-[var(--theme-border)] bg-[var(--theme-card)] p-3 sm:p-4">
                  <div className="mb-3 flex items-center gap-2 px-1 text-left text-[10px] font-black uppercase tracking-[.2em] text-[var(--theme-text-muted)]"><Users className="h-3.5 w-3.5" /> Have a room code?</div>
                  <div className="flex gap-2">
                    <input type="text" placeholder="ENTER ROOM CODE" value={joinInput} onChange={(e) => setJoinInput(e.target.value.toUpperCase())} maxLength={6} aria-label="Room code" className="min-w-0 flex-1 rounded-xl border border-[var(--theme-border)] bg-[var(--theme-bg)] px-4 py-3 font-mono text-sm tracking-[.2em] text-[var(--theme-text)] outline-none placeholder:text-[var(--theme-text-muted)] focus:border-[var(--theme-accent)]" />
                    <button type="button" onClick={() => joinP2pRoom(joinInput)} className="rounded-xl bg-[var(--theme-accent)] px-5 py-3 text-xs font-black uppercase tracking-widest text-[var(--theme-bg)] transition hover:bg-rose-100">Join</button>
                  </div>
                </div>
                <p className="text-[10px] font-bold uppercase tracking-[.2em] text-[var(--theme-text-muted)]">108 cards · 2–4 players · Offline ready</p>
              </div>
            </main>
          )}

          {/* SCREEN 2: P2P LOBBY */}
          {screen === "lobby" && (
            <main className="kora-game-theme flex-1 p-6 flex flex-col items-center justify-center max-w-lg mx-auto w-full space-y-6 text-center bg-[var(--theme-bg)] text-[var(--theme-text)]">
              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-rose-500">
                  Local Network Arena
                </span>
                <h3 className="text-2xl font-serif font-bold text-[var(--theme-text)]">
                  Room Code: <span className="font-mono text-[var(--theme-accent)]">{roomCode}</span>
                </h3>
                <p className="text-xs text-[var(--theme-text-muted)] max-w-sm mx-auto">
                  Share this code with other players connected to the same Wi-Fi network.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={copyRoomCode}
                  className="px-4 py-2 rounded-xl border border-[var(--theme-border)] hover:bg-[var(--theme-card)] text-xs font-bold text-[var(--theme-text)] flex items-center gap-2 transition cursor-pointer"
                >
                  {copiedCode ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  {copiedCode ? "Copied!" : "Copy Code"}
                </button>
              </div>

              <div className="w-full p-4 rounded-2xl bg-[var(--theme-card)] border border-[var(--theme-border)] text-left space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-[var(--theme-text)] pb-2 border-b border-[var(--theme-border)]">
                  <span>Connected Players</span>
                  {/* Was a hardcoded "LAN Peer Ready" while rendering only
                      yourself, so a zero-peer lobby looked identical to a
                      healthy one. Report the real roster. */}
                  <span className="text-[10px] text-[var(--theme-accent)] font-mono">
                    {isP2pHost ? `${joinedGuests.length + 1} connected` : "Waiting for host"}
                  </span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-[var(--theme-text)]">
                    <span className="font-medium flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      {myName} (You)
                    </span>
                    <span className="text-[10px] uppercase font-bold text-[var(--theme-text-muted)]">Host</span>
                  </div>
                  {joinedGuests.map((g) => (
                    <div
                      key={g.id}
                      className="flex items-center justify-between text-xs text-kindle-text"
                    >
                      <span className="font-medium flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-emerald-500" />
                        {g.name}
                      </span>
                      <span className="text-[10px] uppercase font-bold text-kindle-text-muted">
                        Player
                      </span>
                    </div>
                  ))}
                  {isP2pHost && joinedGuests.length === 0 && (
                    <p className="text-[11px] text-[var(--theme-text-muted)] pt-1">
                      Waiting for another player to join with this code…
                    </p>
                  )}
                </div>
              </div>

              <div className="flex gap-3 w-full">
                <button
                  type="button"
                  onClick={() => setScreen("menu")}
                  className="flex-1 py-3 rounded-xl border border-[var(--theme-border)] text-xs font-bold text-[var(--theme-text)] hover:bg-[var(--theme-card)] transition cursor-pointer"
                >
                  Back to Menu
                </button>
                <button
                  type="button"
                  onClick={launchP2pGame}
                  className="flex-1 py-3 rounded-xl bg-[var(--theme-accent)] text-[var(--theme-bg)] text-xs font-bold shadow-md hover:opacity-90 transition cursor-pointer flex items-center justify-center gap-2"
                >
                  <Play className="w-4 h-4" /> Start Match
                </button>
              </div>
            </main>
          )}

          {/* SCREEN 3: ACTIVE PLAYING ARENA */}
          {screen === "playing" && publicState && (
            <main className="kora-game-theme uno-game-arena relative flex-1 overflow-hidden p-3 text-[var(--theme-text)] sm:p-5" style={{ background: "radial-gradient(ellipse at 50% -10%, color-mix(in srgb, var(--theme-accent) 14%, transparent), transparent 48%), var(--theme-bg)" }}>
              <div className="pointer-events-none absolute inset-0 opacity-30" style={{ backgroundImage: "radial-gradient(color-mix(in srgb, var(--theme-text) 10%, transparent) .7px, transparent .7px)", backgroundSize: "15px 15px" }} />
              <div className="relative z-10 flex h-full min-h-[470px] flex-col gap-3 sm:gap-4">
                {/* Opponent seats */}
                <div className="flex shrink-0 items-center justify-center gap-2 overflow-x-auto pb-1">
                  {publicState.players.filter((p) => p.id !== myId).map((p, i) => {
                    const isActive = p.id === activePlayer?.id;
                    const accents = ["#f04452", "#2588ff", "#20b979", "#f8c844"];
                    return (
                      <div key={p.id} className={`flex min-w-0 items-center gap-2 rounded-2xl border px-3 py-2 transition-all ${isActive ? "border-[var(--theme-border)] bg-[var(--theme-card)] shadow-lg ring-2 ring-white/10" : "border-[var(--theme-border)] bg-[var(--theme-card)]"}`}>
                        <div className="relative grid h-9 w-9 shrink-0 place-items-center rounded-xl text-sm font-black text-[var(--theme-text)] shadow-inner" style={{ background: `linear-gradient(145deg,${accents[i % accents.length]},#202334)` }}>
                          {p.name.charAt(0).toUpperCase()}
                          {isActive && <span className="absolute -right-1 -top-1 h-3 w-3 rounded-full border-2 border-[var(--theme-card)] bg-emerald-300" />}
                        </div>
                        <div className="min-w-0 text-left">
                          <p className="max-w-[100px] truncate text-[11px] font-black sm:text-xs">{p.name}</p>
                          <p className="mt-0.5 text-[10px] text-[var(--theme-text-muted)]">{p.cardCount} cards{p.isCpu ? " · CPU" : ""}</p>
                        </div>
                        {p.cardCount === 1 && !p.hasCalledUno && <button type="button" onClick={() => handleCatchUno(p.id)} className="rounded-lg bg-amber-300 px-2 py-1 text-[9px] font-black uppercase text-black animate-pulse">Catch!</button>}
                      </div>
                    );
                  })}
                </div>

                {/* Custom felt table */}
                <section className="uno-felt-table relative flex min-h-[230px] flex-1 flex-col items-center justify-center overflow-hidden rounded-[2rem] border border-[var(--theme-border)] shadow-[inset_0_0_28px_color-mix(in_srgb,var(--theme-text)_7%,transparent),0_12px_32px_color-mix(in_srgb,var(--theme-text)_10%,transparent)] sm:rounded-[2.5rem]" style={{ background: "radial-gradient(ellipse at 50% 42%, color-mix(in srgb, var(--theme-card) 86%, var(--theme-accent)), var(--theme-card) 58%, var(--theme-bg))" }}>
                  <div className="pointer-events-none absolute inset-3 rounded-[1.7rem] border border-[var(--theme-border)] sm:inset-5 sm:rounded-[2rem]" />
                  <div className="pointer-events-none absolute left-1/2 top-1/2 h-[85%] w-[78%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-white/[.07] sm:w-[60%]" />
                  <div className="pointer-events-none absolute left-1/2 top-1/2 h-[62%] w-[56%] -translate-x-1/2 -translate-y-1/2 rounded-[50%] border border-white/[.07] sm:w-[40%]" />
                  <div className="absolute left-4 top-4 flex items-center gap-2 rounded-full border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-1.5 text-[9px] font-black uppercase tracking-[.2em] text-[var(--theme-text-muted)] sm:left-6 sm:top-6">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_8px_#6ee7b7]" /> Live table
                  </div>
                  <div className="relative z-10 flex w-full items-center justify-center gap-5 px-3 sm:gap-9">
                    <div className="flex flex-col items-center gap-2">
                      <button type="button" onClick={handleDrawCard} disabled={!isMyTurn} aria-label="Draw a card" className={`relative h-28 w-[4.6rem] transition sm:h-36 sm:w-24 ${isMyTurn ? "hover:-translate-y-2" : "opacity-75"}`}>
                        <span className="absolute inset-0 translate-x-2 translate-y-2 rotate-[8deg]"><UnoCardBack compact /></span>
                        <span className="absolute inset-0 -translate-x-1 translate-y-1 rotate-[-5deg]"><UnoCardBack compact /></span>
                        <span className="absolute inset-0"><UnoCardBack compact /></span>
                      </button>
                      <span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-1 text-[9px] font-black uppercase tracking-[.2em] text-[var(--theme-text-muted)]">Draw pile</span>
                    </div>
                    <div className="flex flex-col items-center gap-2">
                      <div className="relative h-28 w-[4.6rem] sm:h-36 sm:w-24">
                        {publicState.topDiscard && <motion.div key={publicState.topDiscard.id} initial={{ opacity: 0, y: -12, rotate: -9, scale: .9 }} animate={{ opacity: 1, y: 0, rotate: 2, scale: 1 }} transition={{ type: "spring", stiffness: 260, damping: 20 }} className="absolute inset-0"><UnoCardArt card={publicState.topDiscard} /></motion.div>}
                      </div>
                      <span className="rounded-full border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-1 text-[9px] font-black uppercase tracking-[.2em] text-[var(--theme-text-muted)]">Discard pile</span>
                    </div>
                  </div>
                  <div className="relative z-10 mt-4 flex flex-col items-center gap-2 px-4 text-center">
                    <div className="flex items-center gap-2 rounded-full border border-[var(--theme-border)] bg-[var(--theme-card)] px-3 py-1.5 text-[10px] font-black uppercase tracking-widest">
                      <span className="h-2.5 w-2.5 rounded-full ring-2 ring-white/25" style={{ background: UNO_CARD_COLORS[publicState.currentColor as Exclude<UnoColor, "wild">] || "#fff" }} />
                      {publicState.currentColor} active
                    </div>
                    <p className="max-w-xl text-xs font-semibold text-[var(--theme-text-muted)] sm:text-sm">{publicState.lastActionDescription}</p>
                    <p className={`text-[10px] font-black uppercase tracking-[.2em] sm:text-xs ${isMyTurn ? "text-[var(--theme-accent)]" : "text-[var(--theme-text-muted)]"}`}>
                      {isMyTurn ? "Your turn — play a matching card" : `Waiting for ${activePlayer?.name || "opponent"}`}
                    </p>
                  </div>
                </section>

                {/* Hand and action bar */}
                <section className="uno-hand-panel shrink-0 rounded-[1.7rem] border border-[var(--theme-border)] bg-[var(--theme-card)] p-3 sm:p-4">
                  <div className="mb-3 flex items-center justify-between gap-3 px-1">
                    <div><p className="text-xs font-black sm:text-sm">YOUR HAND <span className="ml-1 rounded-full bg-[var(--theme-bg)] px-2 py-0.5 text-[10px] text-[var(--theme-text-muted)]">{myHand.length}</span></p><p className="mt-1 text-[9px] font-bold uppercase tracking-[.18em] text-[var(--theme-text-muted)]">Tap a glowing card to play</p></div>
                    {myHand.length <= 2 && <motion.button type="button" whileTap={{ scale: .94 }} onClick={handleCallUno} className="rounded-full border border-amber-200/50 bg-gradient-to-r from-amber-300 to-orange-400 px-4 py-2 text-[10px] font-black italic tracking-widest text-[#171923] shadow-[0_0_22px_rgba(251,191,36,.22)] sm:text-xs"><Flame className="mr-1 inline h-3.5 w-3.5" /> CALL UNO!</motion.button>}
                  </div>
                  <div className="uno-hand-fan flex min-h-[118px] items-end gap-2 overflow-x-auto overflow-y-hidden px-1 pb-2 pt-1 scrollbar-thin sm:min-h-[142px] sm:gap-2.5">
                    {myHand.map((card, index) => {
                      const playable = isMyTurn && canPlayCard(card, publicState.topDiscard, publicState.currentColor);
                      const fanCenter = (myHand.length - 1) / 2;
                      const fanLimit = Math.min(16, Math.max(0, fanCenter * 3));
                      const fanAngle = fanCenter ? ((index - fanCenter) / fanCenter) * fanLimit : 0;
                      const fanDrop = Math.abs(index - fanCenter) * 3;
                      return (
                        <motion.button key={card.id} type="button" aria-label={`Play ${card.color} ${card.value}`} title={`${card.color} ${card.value}`} style={{ "--uno-hand-angle": `${fanAngle}deg`, "--uno-hand-drop": `${fanDrop}px` } as React.CSSProperties} whileHover={{ y: playable ? -12 : -2, rotate: playable ? 0 : index % 2 ? 2 : -2, scale: playable ? 1.04 : 1.01 }} whileTap={{ scale: .95 }} onClick={() => handleCardClick(card)} disabled={!playable} className={`uno-hand-card relative h-[108px] w-[70px] shrink-0 transition-all duration-150 sm:h-[132px] sm:w-[86px] ${playable ? "cursor-pointer drop-shadow-[0_8px_12px_rgba(255,255,255,.12)]" : "cursor-not-allowed opacity-45 grayscale-[.25]"} `}>
                          {playable && <span className="pointer-events-none absolute -inset-1 rounded-2xl bg-[var(--theme-bg)] blur-md" />}
                          <span className="relative block h-full w-full"><UnoCardArt card={card} compact /></span>
                        </motion.button>
                      );
                    })}
                  </div>
                </section>
              </div>
            </main>
          )}

          {/* SCREEN 4: GAME OVER / VICTORY */}
          {screen === "game_over" && publicState && (
            <main className="kora-game-theme flex-1 p-6 flex flex-col items-center justify-center max-w-md mx-auto w-full space-y-6 text-center bg-[var(--theme-bg)] text-[var(--theme-text)]">
              <div className="p-4 rounded-full bg-amber-500/10 text-amber-500 animate-bounce">
                <Trophy className="w-16 h-16" />
              </div>
              <div className="space-y-2">
                <h3 className="text-2xl font-serif font-bold text-kindle-text">
                  {publicState.winnerId === myId ? "Victory! You Won!" : "Game Over"}
                </h3>
                <p className="text-xs text-kindle-text-muted">
                  {publicState.lastActionDescription}
                </p>
              </div>

              <div className="flex gap-3 w-full">
                <button
                  type="button"
                  onClick={() => setScreen("menu")}
                  className="flex-1 py-3 rounded-xl border border-kindle-border text-xs font-bold text-kindle-text hover:bg-kindle-card transition cursor-pointer"
                >
                  Return to Menu
                </button>
                <button
                  type="button"
                  onClick={startSoloGame}
                  className="flex-1 py-3 rounded-xl bg-kindle-accent text-kindle-bg text-xs font-bold shadow-md hover:opacity-90 transition cursor-pointer flex items-center justify-center gap-1.5"
                >
                  <RotateCcw className="w-4 h-4" /> Rematch
                </button>
              </div>
            </main>
          )}

          {/* COLOR PICKER MODAL FOR WILDCARDS */}
          {selectedWildCard && (
            <div className="fixed inset-0 z-60 bg-black/60 backdrop-blur-xs flex items-center justify-center p-4">
              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                className="kora-game-theme bg-[var(--theme-bg)] border border-[var(--theme-border)] rounded-3xl p-6 max-w-xs w-full space-y-4 text-center shadow-2xl"
              >
                <h4 className="text-sm font-bold text-[var(--theme-text)]">
                  Choose Active Color
                </h4>
                <div className="grid grid-cols-2 gap-3">
                  {(["red", "blue", "green", "yellow"] as UnoColor[]).map((c) => {
                    const style = getCardColorStyle(c);
                    return (
                      <button
                        key={c}
                        type="button"
                        onClick={() => handleSelectWildColor(c)}
                        className={`py-4 rounded-2xl border-2 font-bold text-white text-xs uppercase shadow-md hover:scale-105 transition cursor-pointer ${style.bg} ${style.border}`}
                      >
                        {c}
                      </button>
                    );
                  })}
                </div>
              </motion.div>
            </div>
          )}
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
