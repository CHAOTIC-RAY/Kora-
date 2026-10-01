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
      console.warn("Firestore signaling offline, relying on LAN/BroadcastChannel:", err);
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
    }

    // Announce presence
    transport.send({ type: "JOIN", player: guestPlayer });
    setScreen("lobby");
    toast.success(`Joined room ${code}!`);
  };

  // Host launches game after players gather in lobby
  const launchP2pGame = () => {
    if (!transportRef.current || !transportRef.current.isHost) return;

    const host = transportRef.current.localPlayer;
    // Fill up to 4 players with bots if fewer than 2 human players
    const currentGuests: UnoPlayer[] = []; // In peer map or state
    const players: UnoPlayer[] = [host, ...currentGuests];

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
  const handleP2pPacket = (packet: UnoPacket, senderId: string) => {
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
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-2 sm:p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.95 }}
          className={`w-full bg-kindle-bg border border-kindle-border rounded-3xl overflow-hidden shadow-2xl flex flex-col ${
            variant === "fullscreen" ? "h-full max-w-full rounded-none" : "h-[90vh] max-w-5xl"
          }`}
        >
          {/* Header Bar */}
          <header className="px-5 py-3 border-b border-kindle-border/60 flex items-center justify-between shrink-0 bg-kindle-card/60">
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
            <main className="flex-1 p-6 flex flex-col items-center justify-center max-w-xl mx-auto w-full space-y-6 text-center">
              <div className="p-4 rounded-3xl bg-rose-500/10 text-rose-500 ring-8 ring-rose-500/5">
                <Flame className="w-12 h-12" />
              </div>
              <div className="space-y-2">
                <h3 className="text-xl font-serif font-bold text-kindle-text">
                  Choose Game Arena
                </h3>
                <p className="text-xs text-kindle-text-muted leading-relaxed max-w-md">
                  Play peer-to-peer with friends on the same Wi-Fi network, or practice solo offline against intelligent bots.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full pt-2">
                {/* Solo Offline Mode */}
                <button
                  type="button"
                  onClick={startSoloGame}
                  className="p-5 rounded-2xl border border-kindle-border hover:border-amber-500/50 bg-kindle-card/50 text-left transition duration-200 group cursor-pointer shadow-xs hover:shadow-md flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500 w-fit">
                      <Cpu className="w-5 h-5" />
                    </div>
                    <h4 className="text-sm font-bold text-kindle-text group-hover:text-amber-500 transition">
                      Solo vs Bots
                    </h4>
                    <p className="text-[11px] text-kindle-text-muted leading-relaxed">
                      Instant offline match against 3 tactical CPU scholars. Zero network needed.
                    </p>
                  </div>
                  <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest mt-4 flex items-center gap-1">
                    Play Solo →
                  </span>
                </button>

                {/* Same-Network P2P Mode */}
                <button
                  type="button"
                  onClick={hostP2pRoom}
                  className="p-5 rounded-2xl border border-kindle-border hover:border-rose-500/50 bg-kindle-card/50 text-left transition duration-200 group cursor-pointer shadow-xs hover:shadow-md flex flex-col justify-between"
                >
                  <div className="space-y-2">
                    <div className="p-2.5 rounded-xl bg-rose-500/10 text-rose-500 w-fit">
                      <Wifi className="w-5 h-5" />
                    </div>
                    <h4 className="text-sm font-bold text-kindle-text group-hover:text-rose-500 transition">
                      Host P2P Arena
                    </h4>
                    <p className="text-[11px] text-kindle-text-muted leading-relaxed">
                      Create a room. Connect phones and laptops over the same Wi-Fi via WebRTC.
                    </p>
                  </div>
                  <span className="text-[10px] font-bold text-rose-500 uppercase tracking-widest mt-4 flex items-center gap-1">
                    Create Room →
                  </span>
                </button>
              </div>

              {/* Join Existing Room Bar */}
              <div className="w-full pt-4 border-t border-kindle-border/60">
                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Enter 6-letter room code (e.g. AB3X9Z)"
                    value={joinInput}
                    onChange={(e) => setJoinInput(e.target.value.toUpperCase())}
                    maxLength={6}
                    className="flex-1 px-4 py-2.5 rounded-xl border border-kindle-border bg-kindle-card text-xs font-mono text-kindle-text focus:outline-none focus:border-kindle-accent uppercase"
                  />
                  <button
                    type="button"
                    onClick={() => joinP2pRoom(joinInput)}
                    className="px-5 py-2.5 rounded-xl bg-kindle-accent text-kindle-bg font-bold text-xs hover:opacity-90 transition cursor-pointer"
                  >
                    Join
                  </button>
                </div>
              </div>
            </main>
          )}

          {/* SCREEN 2: P2P LOBBY */}
          {screen === "lobby" && (
            <main className="flex-1 p-6 flex flex-col items-center justify-center max-w-lg mx-auto w-full space-y-6 text-center">
              <div className="space-y-2">
                <span className="text-[10px] font-bold uppercase tracking-widest text-rose-500">
                  Local Network Arena
                </span>
                <h3 className="text-2xl font-serif font-bold text-kindle-text">
                  Room Code: <span className="font-mono text-kindle-accent">{roomCode}</span>
                </h3>
                <p className="text-xs text-kindle-text-muted max-w-sm mx-auto">
                  Share this code with other players connected to the same Wi-Fi network.
                </p>
              </div>

              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={copyRoomCode}
                  className="px-4 py-2 rounded-xl border border-kindle-border hover:bg-kindle-card text-xs font-bold text-kindle-text flex items-center gap-2 transition cursor-pointer"
                >
                  {copiedCode ? <Check className="w-4 h-4 text-emerald-500" /> : <Copy className="w-4 h-4" />}
                  {copiedCode ? "Copied!" : "Copy Code"}
                </button>
              </div>

              <div className="w-full p-4 rounded-2xl bg-kindle-card border border-kindle-border text-left space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-kindle-text pb-2 border-b border-kindle-border/60">
                  <span>Connected Players</span>
                  <span className="text-[10px] text-kindle-accent font-mono">LAN Peer Ready</span>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-xs text-kindle-text">
                    <span className="font-medium flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-emerald-500" />
                      {myName} (You)
                    </span>
                    <span className="text-[10px] uppercase font-bold text-kindle-text-muted">Host</span>
                  </div>
                </div>
              </div>

              <div className="flex gap-3 w-full">
                <button
                  type="button"
                  onClick={() => setScreen("menu")}
                  className="flex-1 py-3 rounded-xl border border-kindle-border text-xs font-bold text-kindle-text hover:bg-kindle-card transition cursor-pointer"
                >
                  Back to Menu
                </button>
                <button
                  type="button"
                  onClick={launchP2pGame}
                  className="flex-1 py-3 rounded-xl bg-rose-600 text-white text-xs font-bold shadow-md hover:bg-rose-700 transition cursor-pointer flex items-center justify-center gap-2"
                >
                  <Play className="w-4 h-4 fill-white" /> Start Match
                </button>
              </div>
            </main>
          )}

          {/* SCREEN 3: ACTIVE PLAYING ARENA */}
          {screen === "playing" && publicState && (
            <main className="flex-1 relative flex flex-col justify-between p-3 sm:p-5 overflow-hidden select-none">
              {/* Top Ring: Opponents */}
              <div className="flex justify-around items-center gap-2 pb-2">
                {publicState.players
                  .filter((p) => p.id !== myId)
                  .map((p) => {
                    const isActive = p.id === activePlayer?.id;
                    return (
                      <div
                        key={p.id}
                        className={`px-3 py-2 rounded-2xl border transition-all flex items-center gap-2.5 ${
                          isActive
                            ? "border-rose-500 bg-rose-500/10 shadow-md ring-2 ring-rose-500/20"
                            : "border-kindle-border bg-kindle-card/60"
                        }`}
                      >
                        <div className="w-7 h-7 rounded-full bg-kindle-border flex items-center justify-center text-xs font-bold text-kindle-text shrink-0">
                          {p.name.charAt(0)}
                        </div>
                        <div className="text-left min-w-0">
                          <p className="text-xs font-bold text-kindle-text truncate max-w-[90px]">
                            {p.name}
                          </p>
                          <div className="flex items-center gap-1.5 text-[10px] text-kindle-text-muted">
                            <span>🎴 {p.cardCount} cards</span>
                            {p.cardCount === 1 && !p.hasCalledUno && (
                              <button
                                type="button"
                                onClick={() => handleCatchUno(p.id)}
                                className="px-1.5 py-0.5 rounded bg-amber-500 text-white text-[9px] font-bold uppercase animate-pulse"
                              >
                                Catch!
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>

              {/* Center Table: Deck, Top Discard, Active Color & Status */}
              <div className="my-auto flex flex-col items-center justify-center space-y-4">
                <div className="flex items-center justify-center gap-6 sm:gap-10">
                  {/* Draw Deck */}
                  <button
                    type="button"
                    onClick={handleDrawCard}
                    disabled={!isMyTurn}
                    className={`w-20 h-28 sm:w-24 sm:h-36 rounded-2xl border-2 border-dashed border-kindle-border flex flex-col items-center justify-center text-center p-2 transition cursor-pointer shadow-md ${
                      isMyTurn
                        ? "bg-kindle-card hover:border-kindle-accent hover:scale-105"
                        : "opacity-60 cursor-not-allowed bg-kindle-card/40"
                    }`}
                  >
                    <span className="text-2xl mb-1">🎴</span>
                    <span className="text-[10px] font-bold uppercase tracking-wider text-kindle-text">
                      Draw
                    </span>
                  </button>

                  {/* Top Discard Pile */}
                  {publicState.topDiscard && (
                    <div
                      className={`w-20 h-28 sm:w-24 sm:h-36 rounded-2xl border-2 shadow-xl flex flex-col justify-between p-2.5 transition-transform duration-300 ${
                        getCardColorStyle(publicState.topDiscard.color).bg
                      } ${getCardColorStyle(publicState.topDiscard.color).border}`}
                    >
                      <div className="text-[10px] font-bold text-white uppercase tracking-wider">
                        {publicState.topDiscard.value}
                      </div>
                      <div className="text-2xl sm:text-3xl font-black text-white text-center drop-shadow-md">
                        {publicState.topDiscard.value === "skip"
                          ? "⊘"
                          : publicState.topDiscard.value === "reverse"
                          ? "⇄"
                          : publicState.topDiscard.value === "draw2"
                          ? "+2"
                          : publicState.topDiscard.value === "wild4"
                          ? "+4"
                          : publicState.topDiscard.value === "wild"
                          ? "★"
                          : publicState.topDiscard.value}
                      </div>
                      <div className="text-[9px] font-bold text-white text-right uppercase">
                        {publicState.currentColor}
                      </div>
                    </div>
                  )}
                </div>

                {/* Status Bar: Last Action & Turn Prompt */}
                <div className="text-center space-y-1">
                  <p className="text-xs text-kindle-text font-medium">
                    {publicState.lastActionDescription}
                  </p>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-kindle-accent">
                    {isMyTurn ? "👉 It's your turn!" : `Waiting for ${activePlayer?.name || "opponent"}...`}
                  </p>
                </div>
              </div>

              {/* Bottom: Player's Hand Carousel & Uno Button */}
              <div className="pt-2 space-y-2 shrink-0">
                <div className="flex items-center justify-between px-2">
                  <span className="text-xs font-bold text-kindle-text">
                    Your Hand ({myHand.length})
                  </span>
                  {myHand.length <= 2 && (
                    <button
                      type="button"
                      onClick={handleCallUno}
                      className="px-4 py-1.5 rounded-full bg-rose-600 text-white font-bold text-xs shadow-lg animate-bounce hover:bg-rose-700 transition cursor-pointer"
                    >
                      SHOUT UNO!
                    </button>
                  )}
                </div>

                {/* Hand Cards */}
                <div className="flex items-center gap-2 overflow-x-auto pb-2 pt-1 px-1 scrollbar-thin">
                  {myHand.map((card) => {
                    const playable =
                      isMyTurn && canPlayCard(card, publicState.topDiscard, publicState.currentColor);
                    const colorStyle = getCardColorStyle(card.color);

                    return (
                      <motion.button
                        key={card.id}
                        type="button"
                        whileHover={{ y: -8, scale: 1.05 }}
                        whileTap={{ scale: 0.95 }}
                        onClick={() => handleCardClick(card)}
                        disabled={!playable}
                        className={`w-14 h-20 sm:w-16 sm:h-24 rounded-xl border-2 flex flex-col justify-between p-1.5 shrink-0 transition-shadow shadow-md cursor-pointer ${
                          colorStyle.bg
                        } ${colorStyle.border} ${
                          playable ? "ring-2 ring-white/60" : "opacity-45 cursor-not-allowed"
                        }`}
                      >
                        <span className="text-[9px] font-bold text-white uppercase">
                          {card.value}
                        </span>
                        <span className="text-lg sm:text-xl font-black text-white text-center">
                          {card.value === "skip"
                            ? "⊘"
                            : card.value === "reverse"
                            ? "⇄"
                            : card.value === "draw2"
                            ? "+2"
                            : card.value === "wild4"
                            ? "+4"
                            : card.value === "wild"
                            ? "★"
                            : card.value}
                        </span>
                        <span className="text-[8px] font-bold text-white text-right uppercase">
                          {card.color}
                        </span>
                      </motion.button>
                    );
                  })}
                </div>
              </div>
            </main>
          )}

          {/* SCREEN 4: GAME OVER / VICTORY */}
          {screen === "game_over" && publicState && (
            <main className="flex-1 p-6 flex flex-col items-center justify-center max-w-md mx-auto w-full space-y-6 text-center">
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
                className="bg-kindle-bg border border-kindle-border rounded-3xl p-6 max-w-xs w-full space-y-4 text-center shadow-2xl"
              >
                <h4 className="text-sm font-bold text-kindle-text">
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
