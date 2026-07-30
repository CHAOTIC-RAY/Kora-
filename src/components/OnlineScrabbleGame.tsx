import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  X,
  Shuffle,
  RefreshCw,
  Send,
  HelpCircle,
  Play,
  Users,
  Cpu,
  ArrowRight,
  RotateCcw,
  Volume2,
  VolumeX,
  Award,
} from "lucide-react";
import { db, auth, isRealFirebase } from "../lib/firebase";
import { doc, onSnapshot, setDoc, getDoc, updateDoc } from "firebase/firestore";
import { WORD_BANK } from "../lib/wordGamesBank";

// Scrabble tile values
const TILE_VALUES: Record<string, number> = {
  A: 1, B: 3, C: 3, D: 2, E: 1, F: 4, G: 2, H: 4, I: 1, J: 8, K: 5, L: 1, M: 3,
  N: 1, O: 1, P: 3, Q: 10, R: 1, S: 1, T: 1, U: 1, V: 4, W: 4, X: 8, Y: 4, Z: 10,
};

const DEFAULT_BAG = [
  ...Array(9).fill("A"), ...Array(2).fill("B"), ...Array(2).fill("C"), ...Array(4).fill("D"),
  ...Array(12).fill("E"), ...Array(2).fill("F"), ...Array(3).fill("G"), ...Array(2).fill("H"),
  ...Array(9).fill("I"), ...Array(1).fill("J"), ...Array(1).fill("K"), ...Array(4).fill("L"),
  ...Array(2).fill("M"), ...Array(6).fill("N"), ...Array(8).fill("O"), ...Array(2).fill("P"),
  ...Array(1).fill("Q"), ...Array(6).fill("R"), ...Array(4).fill("S"), ...Array(6).fill("T"),
  ...Array(4).fill("U"), ...Array(2).fill("V"), ...Array(2).fill("W"), ...Array(1).fill("X"),
  ...Array(2).fill("Y"), ...Array(1).fill("Z")
];

// Board Multipliers (15x15 grid, row and column 0-14)
const TWS = [[0,0], [0,7], [0,14], [7,0], [7,14], [14,0], [14,7], [14,14]];
const DWS = [[1,1], [2,2], [3,3], [4,4], [1,13], [2,12], [3,11], [4,10],
             [13,1], [12,2], [11,3], [10,4], [13,13], [12,12], [11,11], [10,10], [7,7]];
const TLS = [[1,5], [1,9], [5,1], [5,5], [5,9], [5,13], [9,1], [9,5], [9,9], [9,13],
             [13,5], [13,9]];
const DLS = [[0,3], [0,11], [2,6], [2,8], [3,0], [3,7], [3,14], [6,2], [6,6], [6,8], [6,12],
             [7,3], [7,11], [8,2], [8,6], [8,8], [8,12], [11,0], [11,7], [11,14], [12,6], [12,8],
             [14,3], [14,11]];

const COMMON_SCRABBLE_WORDS = Array.from(new Set([
  ...WORD_BANK.map((w) => w.word.toUpperCase()),
  "IN", "ON", "NO", "GO", "TO", "DO", "AT", "IT", "IS", "AN", "AM", "ME", "HE", "WE", "SO", "UP", "BE", "OR", "MY", "IF", "BY", "HI", "OH", "AH", "RE", "FA", "LA", "TI", "US", "OK", "AY", "EX", "AX", "OX",
  "CAT", "DOG", "SUN", "MAP", "PEN", "INK", "BAG", "BOX", "CUP", "KEY", "LOG", "NET", "PIN", "ROW", "SEA", "TOY", "WIN", "RUN", "BAT", "HAT", "LIP", "ARM", "LEG", "EYE", "EAR", "JAM", "OAK", "ICE", "DAY", "WAY",
  "BOOK", "PAGE", "READ", "STAR", "TREE", "FISH", "BIRD", "MILK", "CAKE", "ROAD", "CITY", "HOME", "DOOR", "LAMP", "DESK", "NOTE", "WORD", "SONG", "HOPE", "LOVE", "LEAF", "ROOT", "SEED", "MOON", "RAIN", "SNOW", "WIND", "FIRE", "WAVE", "SHIP", "BOAT", "ACRE", "ARCH", "BARK", "CAMP", "DUSK", "ECHO", "FARM", "GLOW", "HERO", "IRON", "JAZZ", "KING", "LION", "MINT", "NEST", "PARK", "QUIET", "ROSE", "SILK", "TIDE", "UNIT", "VINE", "ZONE",
  "STORY", "PEACE", "LIGHT", "NIGHT", "BLOOM", "RIVER", "STONE", "CLOUD", "CROWN", "DREAM", "FLAME", "HEART", "MUSIC", "PIANO", "SWEET", "WORLD", "YOUTH"
]));

function getCellMultiplier(r: number, c: number): { type: "TWS" | "DWS" | "TLS" | "DLS" | null, label: string, color: string } {
  if (TWS.some(([tr, tc]) => tr === r && tc === c)) return { type: "TWS", label: "TWS", color: "bg-rose-600 text-white font-bold" };
  if (DWS.some(([tr, tc]) => tr === r && tc === c)) return { type: "DWS", label: "DWS", color: "bg-pink-600/80 text-white font-bold" };
  if (TLS.some(([tr, tc]) => tr === r && tc === c)) return { type: "TLS", label: "TLS", color: "bg-blue-600 text-white font-bold" };
  if (DLS.some(([tr, tc]) => tr === r && tc === c)) return { type: "DLS", label: "DLS", color: "bg-sky-600/80 text-white font-bold" };
  return { type: null, label: "", color: "" };
}

interface Player {
  id: string;
  name: string;
  score: number;
  tiles: string[];
}

interface BoardCell {
  letter: string;
  score: number;
  isTemp?: boolean;
}

interface OnlineScrabbleGameProps {
  open: boolean;
  onClose: () => void;
  variant?: "fullscreen" | "popup";
  onOpenScores?: () => void;
}

export default function OnlineScrabbleGame({ open, onClose, variant = "fullscreen" }: OnlineScrabbleGameProps) {
  const [screen, setScreen] = useState<"menu" | "lobby" | "game">("menu");
  const [gameMode, setGameMode] = useState<"cpu" | "online">("cpu");
  const [roomCode, setRoomCode] = useState("");
  const [roomMsg, setRoomMsg] = useState("");
  const [isHost, setIsHost] = useState(false);
  
  // Game state
  const [board, setBoard] = useState<Record<string, BoardCell>>({});
  const [players, setPlayers] = useState<Player[]>([]);
  const [turnIdx, setTurnIdx] = useState(0);
  const [bag, setBag] = useState<string[]>([]);
  const [selectedRackIdx, setSelectedRackIdx] = useState<number | null>(null);
  const [tempPlaced, setTempPlaced] = useState<{ r: number; c: number; letter: string; rackIdx: number }[]>([]);
  const [log, setLog] = useState<string[]>([]);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [invalidMsg, setInvalidMsg] = useState<string | null>(null);

  const unsubRef = useRef<(() => void) | undefined>(undefined);
  const myUid = () => auth?.currentUser?.uid || "guest_" + Math.random().toString(36).substr(2, 6);
  const myName = () => auth?.currentUser?.displayName || "You";

  const roomRef = (code: string) => doc(db, "scrabbleRooms", code.toUpperCase());

  useEffect(() => {
    return () => unsubRef.current?.();
  }, []);

  const playClickSound = () => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(350, audioCtx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(800, audioCtx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.08, audioCtx.currentTime);
      gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.08);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.08);
    } catch { /* ignore */ }
  };

  const playScoreSound = () => {
    if (!soundEnabled) return;
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const playTone = (freq: number, start: number, duration: number) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.frequency.setValueAtTime(freq, start);
        gain.gain.setValueAtTime(0.08, start);
        gain.gain.linearRampToValueAtTime(0.01, start + duration);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(start);
        osc.stop(start + duration);
      };
      playTone(523.25, audioCtx.currentTime, 0.1);
      playTone(659.25, audioCtx.currentTime + 0.1, 0.15);
    } catch { /* ignore */ }
  };

  const genCode = () => {
    return Math.floor(100000 + Math.random() * 900000).toString();
  };

  const drawTiles = (count: number, currentBag: string[]) => {
    const drawn: string[] = [];
    const remaining = [...currentBag];
    for (let i = 0; i < count; i++) {
      if (remaining.length === 0) break;
      const idx = Math.floor(Math.random() * remaining.length);
      drawn.push(remaining[idx]);
      remaining.splice(idx, 1);
    }
    return { drawn, remaining };
  };

  const initCpuGame = () => {
    setGameMode("cpu");
    setRoomMsg("");
    let currentBag = [...DEFAULT_BAG];
    const p1Draw = drawTiles(7, currentBag);
    currentBag = p1Draw.remaining;
    const cpuDraw = drawTiles(7, currentBag);
    currentBag = cpuDraw.remaining;

    const initialPlayers: Player[] = [
      { id: "player", name: myName(), score: 0, tiles: p1Draw.drawn },
      { id: "cpu", name: "Kora", score: 0, tiles: cpuDraw.drawn },
    ];

    setPlayers(initialPlayers);
    setBag(currentBag);
    setBoard({});
    setTurnIdx(0);
    setTempPlaced([]);
    setLog(["Game started vs Kora! Your turn.", "Place words connected to center grid or other tiles."]);
    setScreen("game");
  };

  const createOnlineRoom = async () => {
    if (!isRealFirebase || !db) {
      setRoomMsg("Firebase is disabled or unconfigured.");
      return;
    }
    const code = genCode();
    setRoomCode(code);
    setIsHost(true);
    setGameMode("online");
    setRoomMsg("");

    let currentBag = [...DEFAULT_BAG];
    const hostDraw = drawTiles(7, currentBag);
    currentBag = hostDraw.remaining;

    const initialPlayers: Player[] = [
      { id: myUid(), name: myName(), score: 0, tiles: hostDraw.drawn },
    ];

    try {
      await setDoc(roomRef(code), {
        hostUid: myUid(),
        players: initialPlayers,
        board: {},
        turnIdx: 0,
        bag: currentBag,
        status: "waiting",
        log: [`Room ${code} created by ${myName()}. Waiting for player 2...`],
      });

      subscribeToRoom(code);
      setScreen("lobby");
    } catch (e) {
      setRoomMsg("Error creating room: " + (e as Error).message);
    }
  };

  const joinOnlineRoom = async () => {
    if (!isRealFirebase || !db) {
      setRoomMsg("Firebase is disabled or unconfigured.");
      return;
    }
    if (!roomCode || roomCode.length < 5) {
      setRoomMsg("Enter a valid 6-digit room code.");
      return;
    }
    setRoomMsg("Joining room...");
    setIsHost(false);
    setGameMode("online");

    try {
      const snap = await getDoc(roomRef(roomCode));
      if (!snap.exists()) {
        setRoomMsg("Room code not found.");
        return;
      }
      const data = snap.data();
      const currentPlayers: Player[] = data.players || [];
      const currentBag: string[] = data.bag || DEFAULT_BAG;

      if (currentPlayers.some((p) => p.id === myUid())) {
        subscribeToRoom(roomCode);
        setScreen("game");
        return;
      }

      if (currentPlayers.length >= 4) {
        setRoomMsg("Room is full (max 4 players).");
        return;
      }

      const drawRes = drawTiles(7, currentBag);
      const newPlayer: Player = {
        id: myUid(),
        name: myName(),
        score: 0,
        tiles: drawRes.drawn,
      };

      const updatedPlayers = [...currentPlayers, newPlayer];
      const updatedLog = [...(data.log || []), `${myName()} joined the clash!`];

      await updateDoc(roomRef(roomCode), {
        players: updatedPlayers,
        bag: drawRes.remaining,
        log: updatedLog,
        status: "playing",
      });

      subscribeToRoom(roomCode);
      setScreen("game");
    } catch (e) {
      setRoomMsg("Error joining room: " + (e as Error).message);
    }
  };

  const subscribeToRoom = (code: string) => {
    if (unsubRef.current) unsubRef.current();
    unsubRef.current = onSnapshot(roomRef(code), (snap) => {
      if (!snap.exists()) return;
      const data = snap.data();
      setPlayers(data.players || []);
      setBoard(data.board || {});
      setTurnIdx(data.turnIdx || 0);
      setBag(data.bag || []);
      setLog(data.log || []);

      if (data.status === "playing" && screen === "lobby") {
        setScreen("game");
      }
    });
  };

  const leaveRoom = () => {
    if (unsubRef.current) unsubRef.current();
    setScreen("menu");
    setBoard({});
    setPlayers([]);
    setTempPlaced([]);
  };

  const isMyTurn = () => {
    if (players.length === 0) return false;
    const currentP = players[turnIdx % players.length];
    if (gameMode === "cpu") {
      return currentP.id === "player";
    }
    return currentP.id === myUid();
  };

  const getMyPlayer = () => {
    if (gameMode === "cpu") return players.find((p) => p.id === "player");
    return players.find((p) => p.id === myUid());
  };

  const selectRackTile = (rackIdx: number) => {
    if (!isMyTurn()) return;
    const me = getMyPlayer();
    if (!me || !me.tiles[rackIdx]) return;
    playClickSound();
    setSelectedRackIdx(selectedRackIdx === rackIdx ? null : rackIdx);
  };

  const clickBoardCell = (r: number, c: number) => {
    if (!isMyTurn()) return;
    const key = `${r},${c}`;

    const tempIdx = tempPlaced.findIndex((tp) => tp.r === r && tp.c === c);
    if (tempIdx !== -1) {
      playClickSound();
      const removed = tempPlaced[tempIdx];
      const me = getMyPlayer();
      if (me) {
        me.tiles[removed.rackIdx] = removed.letter;
      }
      const newTemp = [...tempPlaced];
      newTemp.splice(tempIdx, 1);
      setTempPlaced(newTemp);

      const newBoard = { ...board };
      delete newBoard[key];
      setBoard(newBoard);
      return;
    }

    if (board[key] && !board[key].isTemp) return;

    if (selectedRackIdx !== null) {
      const me = getMyPlayer();
      if (!me) return;
      const letter = me.tiles[selectedRackIdx];
      if (!letter) return;

      playClickSound();
      me.tiles[selectedRackIdx] = "";

      const newTemp = [...tempPlaced, { r, c, letter, rackIdx: selectedRackIdx }];
      setTempPlaced(newTemp);

      setBoard((prev) => ({
        ...prev,
        [key]: { letter, score: TILE_VALUES[letter] || 1, isTemp: true },
      }));

      setSelectedRackIdx(null);
    }
  };

  const recallTempTiles = () => {
    if (tempPlaced.length === 0) return;
    playClickSound();
    const me = getMyPlayer();
    if (me) {
      tempPlaced.forEach((tp) => {
        me.tiles[tp.rackIdx] = tp.letter;
      });
    }

    const newBoard = { ...board };
    tempPlaced.forEach((tp) => {
      delete newBoard[`${tp.r},${tp.c}`];
    });

    setBoard(newBoard);
    setTempPlaced([]);
  };

  const shuffleRack = () => {
    playClickSound();
    const me = getMyPlayer();
    if (!me) return;
    const shuffled = [...me.tiles].sort(() => Math.random() - 0.5);
    setPlayers(players.map((p) => (p.id === me.id ? { ...p, tiles: shuffled } : p)));
  };

  const passTurn = async () => {
    if (!isMyTurn()) return;
    playClickSound();
    recallTempTiles();

    const nextTurn = turnIdx + 1;
    const nextLog = [...log, `${myName()} passed turn.`];

    if (gameMode === "cpu") {
      setTurnIdx(nextTurn);
      setLog(nextLog);
      setTimeout(() => triggerCpuTurn(nextTurn, board, bag), 1200);
    } else {
      try {
        await updateDoc(roomRef(roomCode), {
          turnIdx: nextTurn,
          log: nextLog,
        });
      } catch (e) {
        setRoomMsg("Error passing turn: " + (e as Error).message);
      }
    }
  };

  const exchangeTiles = async () => {
    if (!isMyTurn()) return;
    playClickSound();
    recallTempTiles();

    const me = getMyPlayer();
    if (!me) return;

    const tilesToSwap = me.tiles.filter((t) => t !== "");
    let currentBag = [...bag, ...tilesToSwap];
    const drawRes = drawTiles(7, currentBag);

    const updatedPlayers = players.map((p) =>
      p.id === me.id ? { ...p, tiles: drawRes.drawn } : p
    );
    const nextTurn = turnIdx + 1;
    const nextLog = [...log, `${myName()} exchanged tiles.`];

    if (gameMode === "cpu") {
      setPlayers(updatedPlayers);
      setBag(drawRes.remaining);
      setTurnIdx(nextTurn);
      setLog(nextLog);
      setTimeout(() => triggerCpuTurn(nextTurn, board, drawRes.remaining, updatedPlayers), 1200);
    } else {
      try {
        await updateDoc(roomRef(roomCode), {
          players: updatedPlayers,
          bag: drawRes.remaining,
          turnIdx: nextTurn,
          log: nextLog,
        });
      } catch (e) {
        setRoomMsg("Error exchanging: " + (e as Error).message);
      }
    }
  };

  const submitTurn = async () => {
    if (!isMyTurn() || tempPlaced.length === 0) return;
    setInvalidMsg(null);

    const rows = tempPlaced.map((t) => t.r);
    const cols = tempPlaced.map((t) => t.c);
    const uniqueRows = Array.from(new Set(rows));
    const uniqueCols = Array.from(new Set(cols));

    const isRowLine = uniqueRows.length === 1;
    const isColLine = uniqueCols.length === 1;

    if (!isRowLine && !isColLine) {
      setInvalidMsg("Placed tiles must be in a straight line.");
      return;
    }

    const isHorizontal = isRowLine;
    const lineIndex = isHorizontal ? uniqueRows[0] : uniqueCols[0];
    const tempCoords = tempPlaced.map((t) => (isHorizontal ? t.c : t.r));
    const minCoord = Math.min(...tempCoords);
    const maxCoord = Math.max(...tempCoords);

    let wordLetters: { letter: string; r: number; c: number; isTemp: boolean }[] = [];

    if (isHorizontal) {
      for (let c = minCoord; c <= maxCoord; c++) {
        const cell = board[`${lineIndex},${c}`];
        if (!cell) {
          setInvalidMsg("No gaps allowed between placed letters.");
          return;
        }
      }
      let left = minCoord;
      while (left > 0 && board[`${lineIndex},${left - 1}`]) left--;
      let right = maxCoord;
      while (right < 14 && board[`${lineIndex},${right + 1}`]) right++;
      for (let c = left; c <= right; c++) {
        const cell = board[`${lineIndex},${c}`];
        const isTemp = tempPlaced.some((tp) => tp.r === lineIndex && tp.c === c);
        wordLetters.push({ letter: cell.letter, r: lineIndex, c, isTemp });
      }
    } else {
      for (let r = minCoord; r <= maxCoord; r++) {
        const cell = board[`${r},${lineIndex}`];
        if (!cell) {
          setInvalidMsg("No gaps allowed between placed letters.");
          return;
        }
      }
      let top = minCoord;
      while (top > 0 && board[`${top - 1},${lineIndex}`]) top--;
      let bottom = maxCoord;
      while (bottom < 14 && board[`${bottom + 1},${lineIndex}`]) bottom++;
      for (let r = top; r <= bottom; r++) {
        const cell = board[`${r},${lineIndex}`];
        const isTemp = tempPlaced.some((tp) => tp.r === r && tp.c === lineIndex);
        wordLetters.push({ letter: cell.letter, r, c: lineIndex, isTemp });
      }
    }

    const primaryWord = wordLetters.map((wl) => wl.letter).join("");

    const isFirstWord = Object.values(board).filter((c) => !c.isTemp).length === 0;
    if (isFirstWord) {
      const coversCenter = tempPlaced.some((tp) => tp.r === 7 && tp.c === 7);
      if (!coversCenter) {
        setInvalidMsg("First word must cover the center star (row 8, column 8).");
        return;
      }
    } else {
      const touchesExisting = tempPlaced.some((tp) => {
        const adjacents = [
          [tp.r - 1, tp.c],
          [tp.r + 1, tp.c],
          [tp.r, tp.c - 1],
          [tp.r, tp.c + 1],
        ];
        return adjacents.some(([ar, ac]) => {
          const cell = board[`${ar},${ac}`];
          return cell && !cell.isTemp;
        });
      });
      if (!touchesExisting) {
        setInvalidMsg("Placed tiles must connect to existing tiles.");
        return;
      }
    }

    let mainWordScore = 0;
    let wordMultiplier = 1;

    wordLetters.forEach((wl) => {
      const cellVal = TILE_VALUES[wl.letter] || 1;
      if (wl.isTemp) {
        const mult = getCellMultiplier(wl.r, wl.c);
        if (mult.type === "TLS") mainWordScore += cellVal * 3;
        else if (mult.type === "DLS") mainWordScore += cellVal * 2;
        else mainWordScore += cellVal;

        if (mult.type === "TWS") wordMultiplier *= 3;
        if (mult.type === "DWS") wordMultiplier *= 2;
      } else {
        mainWordScore += cellVal;
      }
    });
    let totalTurnScore = mainWordScore * wordMultiplier;

    const isBingo = tempPlaced.length === 7;
    if (isBingo) totalTurnScore += 50;

    const me = getMyPlayer();
    if (!me) return;

    const updatedBoard = { ...board };
    tempPlaced.forEach((tp) => {
      const key = `${tp.r},${tp.c}`;
      updatedBoard[key] = { letter: tp.letter, score: TILE_VALUES[tp.letter] || 1 };
    });

    const remainingRack = me.tiles.filter((t) => t !== "");
    const drawRes = drawTiles(7 - remainingRack.length, bag);
    const finalRack = [...remainingRack, ...drawRes.drawn];

    const updatedPlayers = players.map((p) =>
      p.id === me.id ? { ...p, score: p.score + totalTurnScore, tiles: finalRack } : p
    );

    const dictionaryBadge = COMMON_SCRABBLE_WORDS.includes(primaryWord.toUpperCase()) ? " (Dict ✓)" : "";
    const bingoBadge = isBingo ? " [BINGO! +50]" : "";
    const nextLog = [
      ...log,
      `${myName()} played '${primaryWord}' for ${totalTurnScore} pts${dictionaryBadge}${bingoBadge}.`,
    ];

    const nextTurn = turnIdx + 1;

    setTempPlaced([]);
    setInvalidMsg(null);
    playScoreSound();

    if (gameMode === "cpu") {
      setBoard(updatedBoard);
      setPlayers(updatedPlayers);
      setBag(drawRes.remaining);
      setTurnIdx(nextTurn);
      setLog(nextLog);

      setTimeout(() => triggerCpuTurn(nextTurn, updatedBoard, drawRes.remaining, updatedPlayers), 1500);
    } else {
      try {
        await updateDoc(roomRef(roomCode), {
          board: updatedBoard,
          players: updatedPlayers,
          bag: drawRes.remaining,
          turnIdx: nextTurn,
          log: nextLog,
        });
      } catch (e) {
        setRoomMsg("Error submitting turn: " + (e as Error).message);
      }
    }
  };

  // Kora CPU Turn logic
  const triggerCpuTurn = (
    currentTurn: number,
    currentBoard: Record<string, BoardCell>,
    currentBag: string[],
    currentPlayers?: Player[]
  ) => {
    const activePlayers = currentPlayers || players;
    const cpuPlayer = activePlayers.find((p) => p.id === "cpu");
    if (!cpuPlayer) return;

    const cpuRack = cpuPlayer.tiles.filter((t) => t !== "");
    if (cpuRack.length === 0) return;

    const isFirstWord = Object.keys(currentBoard).length === 0;
    let chosenWord = "";
    let placedCoords: { r: number; c: number; letter: string }[] = [];

    const canFormWithRackAndBoard = (
      word: string,
      neededFromRack: string[]
    ) => {
      const tempRack = [...cpuRack];
      for (const char of neededFromRack) {
        const idx = tempRack.indexOf(char);
        if (idx === -1) return false;
        tempRack.splice(idx, 1);
      }
      return true;
    };

    if (isFirstWord) {
      const playable = COMMON_SCRABBLE_WORDS.filter((w) => {
        const tempRack = [...cpuRack];
        for (const char of w) {
          const idx = tempRack.indexOf(char);
          if (idx === -1) return false;
          tempRack.splice(idx, 1);
        }
        return true;
      });

      if (playable.length > 0) {
        playable.sort((a, b) => b.length - a.length);
        chosenWord = playable[0];
        const startC = 7 - Math.floor(chosenWord.length / 2);
        for (let i = 0; i < chosenWord.length; i++) {
          placedCoords.push({ r: 7, c: startC + i, letter: chosenWord[i] });
        }
      }
    } else {
      const boardKeys = Object.keys(currentBoard);

      outerLoop: for (const key of boardKeys) {
        const [rStr, cStr] = key.split(",");
        const br = parseInt(rStr);
        const bc = parseInt(cStr);
        const boardLetter = currentBoard[key].letter.toUpperCase();

        const matchWords = COMMON_SCRABBLE_WORDS.filter((w) => w.includes(boardLetter));

        for (const word of matchWords) {
          for (let letterIdx = 0; letterIdx < word.length; letterIdx++) {
            if (word[letterIdx] !== boardLetter) continue;

            // Horizontal check
            const startCol = bc - letterIdx;
            const endCol = startCol + word.length - 1;

            if (startCol >= 0 && endCol <= 14) {
              let canPlaceH = true;
              let tempPlacements: typeof placedCoords = [];
              let neededRack: string[] = [];

              for (let i = 0; i < word.length; i++) {
                const col = startCol + i;
                const exist = currentBoard[`${br},${col}`];
                if (exist) {
                  if (exist.letter.toUpperCase() !== word[i]) {
                    canPlaceH = false;
                    break;
                  }
                } else {
                  tempPlacements.push({ r: br, c: col, letter: word[i] });
                  neededRack.push(word[i]);
                }
              }

              if (canPlaceH && tempPlacements.length > 0 && canFormWithRackAndBoard(word, neededRack)) {
                chosenWord = word;
                placedCoords = tempPlacements;
                break outerLoop;
              }
            }

            // Vertical check
            const startRow = br - letterIdx;
            const endRow = startRow + word.length - 1;

            if (startRow >= 0 && endRow <= 14) {
              let canPlaceV = true;
              let tempPlacements: typeof placedCoords = [];
              let neededRack: string[] = [];

              for (let i = 0; i < word.length; i++) {
                const row = startRow + i;
                const exist = currentBoard[`${row},${bc}`];
                if (exist) {
                  if (exist.letter.toUpperCase() !== word[i]) {
                    canPlaceV = false;
                    break;
                  }
                } else {
                  tempPlacements.push({ r: row, c: bc, letter: word[i] });
                  neededRack.push(word[i]);
                }
              }

              if (canPlaceV && tempPlacements.length > 0 && canFormWithRackAndBoard(word, neededRack)) {
                chosenWord = word;
                placedCoords = tempPlacements;
                break outerLoop;
              }
            }
          }
        }
      }
    }

    if (chosenWord && placedCoords.length > 0) {
      const nextBoard = { ...currentBoard };
      let turnScore = 0;
      let wordMult = 1;

      placedCoords.forEach((p) => {
        nextBoard[`${p.r},${p.c}`] = { letter: p.letter, score: TILE_VALUES[p.letter] || 1 };

        const cellVal = TILE_VALUES[p.letter] || 1;
        const mult = getCellMultiplier(p.r, p.c);
        if (mult.type === "TLS") turnScore += cellVal * 3;
        else if (mult.type === "DLS") turnScore += cellVal * 2;
        else turnScore += cellVal;

        if (mult.type === "TWS") wordMult *= 3;
        if (mult.type === "DWS") wordMult *= 2;
      });

      chosenWord.split("").forEach((char) => {
        if (!placedCoords.some((p) => p.letter === char)) {
          turnScore += TILE_VALUES[char] || 1;
        }
      });

      let finalCpuScore = turnScore * wordMult;
      if (placedCoords.length === 7) finalCpuScore += 50;

      const usedLetters = placedCoords.map((p) => p.letter);
      const remainingCpuRack = [...cpuRack];
      usedLetters.forEach((l) => {
        const idx = remainingCpuRack.indexOf(l);
        if (idx >= 0) remainingCpuRack.splice(idx, 1);
      });

      const drawRes = drawTiles(7 - remainingCpuRack.length, currentBag);
      const nextCpuRack = [...remainingCpuRack, ...drawRes.drawn];

      const nextPlayers = activePlayers.map((p) =>
        p.id === "cpu" ? { ...p, score: p.score + finalCpuScore, tiles: nextCpuRack } : p
      );

      setBoard(nextBoard);
      setPlayers(nextPlayers);
      setBag(drawRes.remaining);
      setTurnIdx(currentTurn + 1);
      setLog([
        ...log,
        `Kora played '${chosenWord}' for ${finalCpuScore} pts. Your turn!`,
      ]);
      playScoreSound();
    } else {
      if (cpuRack.length > 0 && currentBag.length > 0) {
        const drawRes = drawTiles(Math.min(3, currentBag.length), currentBag);
        const keptTiles = cpuRack.slice(3);
        const nextCpuRack = [...keptTiles, ...drawRes.drawn];
        const nextPlayers = activePlayers.map((p) =>
          p.id === "cpu" ? { ...p, tiles: nextCpuRack } : p
        );
        setPlayers(nextPlayers);
        setBag(drawRes.remaining);
        setTurnIdx(currentTurn + 1);
        setLog([...log, "Kora swapped tiles for fresh letters."]);
      } else {
        setTurnIdx(currentTurn + 1);
        setLog([...log, "Kora passed."]);
      }
    }
  };

  if (!open) return null;

  return createPortal(
    <AnimatePresence>
      <div className="fixed inset-0 z-[9999] bg-kindle-bg text-kindle-text flex flex-col p-0 sm:items-center sm:justify-center sm:p-4 sm:backdrop-blur-md select-none overflow-hidden">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.2 }}
          className="w-full h-full sm:max-w-5xl sm:max-h-[96vh] bg-kindle-bg border-0 sm:border-2 border-kindle-border rounded-none sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden text-kindle-text"
        >
          {/* Header Bar */}
          <div className="border-b-2 border-kindle-border shrink-0 bg-kindle-card kora-safe-top">
            <div className="px-4 py-3 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400">
                <Award className="w-5 h-5" />
              </div>
              <div>
                <h2 className="font-serif font-bold text-base leading-tight text-amber-900 ">Online Scrabble</h2>
                <p className="text-[10px] uppercase tracking-wider text-kindle-text-muted ">
                  {screen === "game"
                    ? gameMode === "cpu"
                      ? "Play VS Kora"
                      : `Online Room #${roomCode}`
                    : "Lobby & Matchmaking"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setSoundEnabled(!soundEnabled)}
                className="p-2 rounded-full border border-kindle-border hover:bg-white/5 text-kindle-accent"
                title={soundEnabled ? "Mute Sound" : "Enable Sound"}
              >
                {soundEnabled ? <Volume2 className="w-4 h-4" /> : <VolumeX className="w-4 h-4" />}
              </button>
              <button
                type="button"
                onClick={onClose}
                className="p-2 rounded-full border border-kindle-border hover:bg-white/5 text-neutral-300"
                title="Close Scrabble"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

            </div>
          {/* Main Body */}
          <div className="flex-1 overflow-y-auto p-3 sm:p-6 space-y-4 pb-12">
            {screen === "menu" && (
              <div className="max-w-md mx-auto space-y-6 pt-4 text-center">
                <div className="w-20 h-20 mx-auto rounded-3xl bg-kindle-card  border-2 border-kindle-border  flex items-center justify-center text-3xl font-serif font-bold text-kindle-accent shadow-xl">
                  S<span className="text-xs text-amber-500 font-mono ml-0.5">1</span>
                </div>
                <div className="space-y-2">
                  <h3 className="font-serif text-2xl font-extrabold text-kindle-text ">Classic Scrabble</h3>
                  <p className="text-xs text-kindle-text-muted  leading-relaxed">
                    Test your vocabulary offline against Kora or host an online multiplayer clash room using Firebase sync.
                  </p>
                </div>

                <div className="space-y-3 pt-2">
                  <button
                    type="button"
                    onClick={initCpuGame}
                    className="w-full py-3.5 px-4 rounded-xl bg-kindle-accent hover:opacity-80 text-kindle-bg font-bold text-sm tracking-wider uppercase flex items-center justify-center gap-2 shadow-lg transition active:scale-95"
                  >
                    <Cpu className="w-4 h-4" /> Play VS Kora
                  </button>

                  <div className="relative py-2">
                    <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-kindle-border " /></div>
                    <span className="relative bg-kindle-bg  px-3 text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted ">Online Matchmaking</span>
                  </div>

                  <button
                    type="button"
                    onClick={createOnlineRoom}
                    className="w-full py-3 px-4 rounded-xl border-2 border-kindle-border  hover:border-kindle-accent/60 bg-kindle-card  text-xs font-bold uppercase tracking-wider text-kindle-text  flex items-center justify-center gap-2 transition"
                  >
                    <Users className="w-4 h-4 text-amber-600 dark:text-amber-400" /> Host Online Room
                  </button>

                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={roomCode}
                      onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                      placeholder="6-Digit Code"
                      maxLength={6}
                      className="flex-1 bg-kindle-card  border-2 border-kindle-border  rounded-xl px-3 py-2 text-center font-mono text-sm tracking-widest text-kindle-text dark:text-white uppercase outline-none focus:border-kindle-accent"
                    />
                    <button
                      type="button"
                      onClick={joinOnlineRoom}
                      className="px-5 py-2 rounded-xl bg-amber-800 dark:bg-white text-white dark:text-black font-bold text-xs uppercase tracking-wider hover:brightness-110 transition"
                    >
                      Join
                    </button>
                  </div>

                  {roomMsg && <p className="text-xs text-rose-400 font-medium">{roomMsg}</p>}
                </div>
              </div>
            )}

            {screen === "lobby" && (
              <div className="max-w-md mx-auto space-y-6 pt-6 text-center">
                <div className="p-6 rounded-2xl bg-kindle-card border-2 border-kindle-border space-y-4">
                  <div className="text-xs uppercase tracking-widest text-kindle-text-muted">Room Code</div>
                  <div className="text-4xl font-mono font-bold tracking-widest text-kindle-accent">{roomCode}</div>
                  <p className="text-xs text-kindle-text-muted">Share this code with friends to join your match.</p>

                  <div className="pt-2 border-t border-kindle-border">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted mb-2">Connected Players ({players.length}/4)</div>
                    <div className="space-y-1.5">
                      {players.map((p) => (
                        <div key={p.id} className="p-2 rounded-lg bg-kindle-bg/50 text-xs font-bold text-kindle-accent">
                          {p.name}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setScreen("game")}
                  className="w-full py-3 rounded-xl bg-kindle-accent text-kindle-bg font-bold text-xs uppercase tracking-wider shadow-lg"
                >
                  Start Match Now
                </button>
              </div>
            )}

            {screen === "game" && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-start">
                {/* Left Column: Board */}
                <div className="lg:col-span-7 flex flex-col items-center">
                  <div className="w-full max-w-md sm:max-w-lg aspect-square bg-kindle-card  p-1.5 sm:p-2.5 rounded-2xl border-2 border-kindle-border  shadow-2xl grid grid-cols-15 gap-[1px] sm:gap-[2px] select-none">
                    {Array.from({ length: 15 }).map((_, r) =>
                      Array.from({ length: 15 }).map((_, c) => {
                        const key = `${r},${c}`;
                        const cell = board[key];
                        const mult = getCellMultiplier(r, c);

                        return (
                          <div
                            key={key}
                            onClick={() => clickBoardCell(r, c)}
                            className={`aspect-square rounded flex flex-col items-center justify-center relative cursor-pointer transition ${
                              cell
                                ? cell.isTemp
                                  ? "bg-kindle-accent text-kindle-bg font-bold border-2 border-amber-300 animate-pulse shadow-md"
                                  : "bg-kindle-accent text-kindle-bg font-bold border border-kindle-accent shadow"
                                : mult.type
                                ? mult.color
                                : "bg-white  hover:bg-neutral-100  text-kindle-text  border border-kindle-border/40 dark:border-transparent"
                            }`}
                          >
                            {cell ? (
                              <div className="w-full h-full flex items-center justify-center relative">
                                <span className="text-[10px] sm:text-xs md:text-sm font-serif font-bold leading-none">
                                  {cell.letter}
                                </span>
                                <span className="absolute bottom-[0.5px] right-[1px] text-[6px] sm:text-[7px] font-mono leading-none opacity-80">
                                  {cell.score}
                                </span>
                              </div>
                            ) : mult.type ? (
                              <span className="text-[6px] sm:text-[8px] font-bold leading-none uppercase">
                                {mult.label}
                              </span>
                            ) : r === 7 && c === 7 ? (
                              <span className="text-xs sm:text-sm text-amber-500">★</span>
                            ) : null}
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Right Column: Scores, Rack & Controls */}
                <div className="lg:col-span-5 space-y-3">
                  {/* Scores Bar */}
                  <div className="bg-kindle-card  rounded-2xl border border-kindle-border  p-3 shadow-md">
                    <div className="flex items-center justify-between border-b border-kindle-border  pb-2 mb-2">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted ">Player Scores</h3>
                      <span className="text-[10px] bg-amber-500/15 border border-amber-500/30 text-amber-800 dark:text-amber-300 px-2 py-0.5 rounded-full font-bold">
                        {bag.length} Tiles Left
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {players.map((p, idx) => {
                        const isCurrent = turnIdx % players.length === idx;
                        return (
                          <div
                            key={p.id}
                            className={`p-2.5 rounded-xl border transition ${
                              isCurrent
                                ? "bg-kindle-accent/20 border-kindle-accent ring-1 ring-kindle-accent/30"
                                : "bg-kindle-bg  border-kindle-border "
                            }`}
                          >
                            <div className="flex items-center gap-1.5 mb-0.5 min-w-0">
                              <div className={`w-2 h-2 rounded-full ${isCurrent ? "bg-amber-500 animate-pulse" : "bg-neutral-400"}`} />
                              <span className="text-xs font-bold text-kindle-text  truncate">{p.name}</span>
                            </div>
                            <p className="text-xl font-serif font-black text-kindle-text dark:text-white">
                              {p.score} <span className="text-[10px] text-kindle-text-muted  font-normal">pts</span>
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* Tile Rack */}
                  <div className="bg-kindle-card  border border-kindle-border  rounded-2xl p-3 shadow-md space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted ">Your Tile Rack</h3>
                      {tempPlaced.length > 0 && (
                        <button
                          type="button"
                          onClick={recallTempTiles}
                          className="text-[10px] font-bold text-amber-700 dark:text-amber-400 hover:underline uppercase tracking-wider"
                        >
                          Recall Tiles
                        </button>
                      )}
                    </div>

                    <div className="flex justify-center gap-1.5 sm:gap-2">
                      {Array.from({ length: 7 }).map((_, idx) => {
                        const me = getMyPlayer();
                        const letter = me?.tiles[idx];
                        const isEmpty = !letter;
                        const isSelected = selectedRackIdx === idx;

                        return (
                          <div
                            key={idx}
                            onClick={() => selectRackTile(idx)}
                            className={`w-10 h-12 sm:w-12 sm:h-14 rounded-xl border flex flex-col items-center justify-center relative select-none transition cursor-pointer ${
                              isEmpty
                                ? "bg-kindle-bg  border-dashed border-kindle-border  text-neutral-400"
                                : isSelected
                                ? "bg-kindle-accent border-amber-300 text-kindle-bg font-bold scale-105 shadow-lg -translate-y-1"
                                : "bg-kindle-accent border-kindle-accent text-kindle-bg font-bold hover:-translate-y-0.5 shadow-md"
                            }`}
                          >
                            {!isEmpty && (
                              <div className="w-full h-full flex items-center justify-center relative">
                                <span className="text-lg font-serif font-extrabold leading-none">
                                  {letter}
                                </span>
                                <span className="absolute bottom-0.5 right-1 text-[8px] font-mono font-bold opacity-75">
                                  {TILE_VALUES[letter] || 1}
                                </span>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {invalidMsg && (
                      <p className="text-xs text-rose-500 font-semibold text-center">{invalidMsg}</p>
                    )}

                    {/* Controls Grid */}
                    <div className="grid grid-cols-2 gap-2 pt-1">
                      <button
                        type="button"
                        disabled={!isMyTurn() || tempPlaced.length === 0}
                        onClick={submitTurn}
                        className="col-span-2 py-3 bg-kindle-accent hover:opacity-80 text-kindle-bg font-extrabold text-xs uppercase tracking-wider rounded-xl transition disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-md active:scale-95"
                      >
                        <Send className="w-3.5 h-3.5" /> Play Word
                      </button>

                      <button
                        type="button"
                        disabled={!isMyTurn()}
                        onClick={shuffleRack}
                        className="py-2 bg-kindle-bg  border border-kindle-border  rounded-xl font-bold text-xs text-kindle-text  hover:opacity-80 transition flex items-center justify-center gap-1.5"
                      >
                        <Shuffle className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" /> Shuffle
                      </button>

                      <button
                        type="button"
                        disabled={!isMyTurn()}
                        onClick={exchangeTiles}
                        className="py-2 bg-kindle-bg  border border-kindle-border  rounded-xl font-bold text-xs text-kindle-text  hover:opacity-80 transition flex items-center justify-center gap-1.5"
                      >
                        <RefreshCw className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400" /> Swap Tiles
                      </button>

                      <button
                        type="button"
                        disabled={!isMyTurn()}
                        onClick={passTurn}
                        className="col-span-2 py-2 bg-kindle-bg  border border-kindle-border  rounded-xl font-bold text-xs text-kindle-text-muted hover:text-kindle-text transition flex items-center justify-center gap-1.5"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> Pass Turn
                      </button>
                    </div>
                  </div>

                  {/* Clash Log */}
                  <div className="bg-kindle-card  border border-kindle-border  rounded-2xl p-3 max-h-32 flex flex-col shadow-md">
                    <h3 className="text-[9px] font-bold uppercase tracking-widest text-kindle-text-muted  mb-1 pb-1 border-b border-kindle-border ">
                      Clash Log
                    </h3>
                    <div className="flex-1 overflow-y-auto space-y-1 pr-1 text-[11px] font-mono">
                      {log.map((line, i) => (
                        <p key={i} className="text-kindle-text  border-l-2 border-amber-500/40 pl-2">
                          {line}
                        </p>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>,
    document.body
  );
}
