import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "motion/react";
import {
  X,
  RotateCcw,
  Volume2,
  VolumeX,
  Cpu,
  Users,
  Trophy,
  Swords,
  ArrowUpDown,
  RefreshCw,
  Crown,
  Flag,
  BookOpen,
  Lightbulb,
  Sparkles,
  Info,
  CheckCircle2,
  HelpCircle,
  Zap,
  Award,
} from "lucide-react";
import { isSoundEffectsEnabled } from "../../lib/featureToggles";

export type PieceType = "king" | "queen" | "rook" | "bishop" | "knight" | "pawn";
export type PieceColor = "white" | "black";

export interface Piece {
  type: PieceType;
  color: PieceColor;
  hasMoved?: boolean;
}

export type BoardState = (Piece | null)[][];

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const RANKS = [1, 2, 3, 4, 5, 6, 7, 8] as const;

const FAMOUS_OPENINGS: { moves: string[]; name: string; creator: string; description: string }[] = [
  {
    moves: ["e4", "e5", "Nf3", "Nc6", "Bc4"],
    name: "Italian Game (Giuoco Piano)",
    creator: "Damiano & Greco (16th Century)",
    description: "One of the oldest recorded chess openings, emphasizing rapid piece development and central control."
  },
  {
    moves: ["e4", "e5", "Nf3", "Nc6", "Bb5"],
    name: "Ruy Lopez (Spanish Opening)",
    creator: "Ruy López de Segura (1561)",
    description: "A classical master-level opening creating pressure on the knight defending e5."
  },
  {
    moves: ["e4", "c5"],
    name: "Sicilian Defense",
    creator: "Gioachino Greco (1620)",
    description: "The most popular and aggressive counter-attacking defense against 1.e4."
  },
  {
    moves: ["d4", "d5", "c4"],
    name: "Queen's Gambit",
    creator: "Lucena (1497)",
    description: "A classical closed opening offering a pawn to fight for central supremacy."
  },
  {
    moves: ["f3", "e5", "g4", "Qh4#"],
    name: "Fool's Mate",
    creator: "Fastest Possible Checkmate in Chess",
    description: "The quickest checkmate achievable in just 2 moves by neglecting king safety."
  },
  {
    moves: ["e4", "e5", "Qh5", "Nc6", "Bc4", "Nf6", "Qxf7#"],
    name: "Scholar's Mate",
    creator: "Classic 4-Move Checkmate",
    description: "A swift tactical trap targeting the vulnerable f7 square."
  },
  {
    moves: ["d4", "Nf6", "c4", "g6"],
    name: "King's Indian Defense",
    creator: "Hypermodern Grandmasters",
    description: "A dynamic hypermodern defense allowing White a broad center before launching counterstrikes."
  },
  {
    moves: ["e4", "e6"],
    name: "French Defense",
    creator: "Paris vs. London Correspondence (1834)",
    description: "A solid, semi-closed defense creating a sturdy pawn chain."
  }
];

export function getStartingPosition(): BoardState {
  const board: BoardState = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => null));

  // Rank 1 (White pieces)
  board[0] = [
    { type: "rook", color: "white" },
    { type: "knight", color: "white" },
    { type: "bishop", color: "white" },
    { type: "queen", color: "white" },
    { type: "king", color: "white" },
    { type: "bishop", color: "white" },
    { type: "knight", color: "white" },
    { type: "rook", color: "white" },
  ];
  // Rank 2 (White pawns)
  board[1] = Array.from({ length: 8 }, () => ({ type: "pawn", color: "white" }));

  // Rank 7 (Black pawns)
  board[6] = Array.from({ length: 8 }, () => ({ type: "pawn", color: "black" }));
  // Rank 8 (Black pieces)
  board[7] = [
    { type: "rook", color: "black" },
    { type: "knight", color: "black" },
    { type: "bishop", color: "black" },
    { type: "queen", color: "black" },
    { type: "king", color: "black" },
    { type: "bishop", color: "black" },
    { type: "knight", color: "black" },
    { type: "rook", color: "black" },
  ];

  return board;
}

export function squareToCoords(square: string): [number, number] | null {
  if (square.length !== 2) return null;
  const f = square[0].toLowerCase();
  const r = parseInt(square[1], 10);
  const fileIdx = FILES.indexOf(f as (typeof FILES)[number]);
  const rankIdx = r - 1;
  if (fileIdx < 0 || rankIdx < 0 || rankIdx > 7) return null;
  return [fileIdx, rankIdx];
}

export function coordsToSquare(fileIdx: number, rankIdx: number): string {
  return `${FILES[fileIdx]}${rankIdx + 1}`;
}

export function cloneBoard(board: BoardState): BoardState {
  return board.map((row) => row.map((cell) => (cell ? { ...cell } : null)));
}

function inBounds(fileIdx: number, rankIdx: number): boolean {
  return fileIdx >= 0 && fileIdx < 8 && rankIdx >= 0 && rankIdx < 8;
}

function getPseudoLegalMoves(
  board: BoardState,
  fromFile: number,
  fromRank: number
): [number, number][] {
  const piece = board[fromRank]?.[fromFile];
  if (!piece) return [];
  const moves: [number, number][] = [];
  const color = piece.color;
  const enemyColor: PieceColor = color === "white" ? "black" : "white";

  if (piece.type === "pawn") {
    const dir = color === "white" ? 1 : -1;
    const startRank = color === "white" ? 1 : 6;

    if (inBounds(fromFile, fromRank + dir) && !board[fromRank + dir][fromFile]) {
      moves.push([fromFile, fromRank + dir]);
      if (
        fromRank === startRank &&
        inBounds(fromFile, fromRank + 2 * dir) &&
        !board[fromRank + 2 * dir][fromFile]
      ) {
        moves.push([fromFile, fromRank + 2 * dir]);
      }
    }

    for (const df of [-1, 1]) {
      const targetFile = fromFile + df;
      const targetRank = fromRank + dir;
      if (inBounds(targetFile, targetRank)) {
        const targetPiece = board[targetRank][targetFile];
        if (targetPiece && targetPiece.color === enemyColor) {
          moves.push([targetFile, targetRank]);
        }
      }
    }
  } else if (piece.type === "knight") {
    const knightOffsets = [
      [1, 2], [1, -2], [-1, 2], [-1, -2],
      [2, 1], [2, -1], [-2, 1], [-2, -1],
    ];
    for (const [df, dr] of knightOffsets) {
      const f = fromFile + df;
      const r = fromRank + dr;
      if (inBounds(f, r)) {
        const target = board[r][f];
        if (!target || target.color === enemyColor) {
          moves.push([f, r]);
        }
      }
    }
  } else if (piece.type === "bishop" || piece.type === "rook" || piece.type === "queen") {
    const rays: [number, number][] = [];
    if (piece.type === "bishop" || piece.type === "queen") {
      rays.push([1, 1], [1, -1], [-1, 1], [-1, -1]);
    }
    if (piece.type === "rook" || piece.type === "queen") {
      rays.push([1, 0], [-1, 0], [0, 1], [0, -1]);
    }

    for (const [df, dr] of rays) {
      let f = fromFile + df;
      let r = fromRank + dr;
      while (inBounds(f, r)) {
        const target = board[r][f];
        if (!target) {
          moves.push([f, r]);
        } else {
          if (target.color === enemyColor) {
            moves.push([f, r]);
          }
          break;
        }
        f += df;
        r += dr;
      }
    }
  } else if (piece.type === "king") {
    for (let df = -1; df <= 1; df++) {
      for (let dr = -1; dr <= 1; dr++) {
        if (df === 0 && dr === 0) continue;
        const f = fromFile + df;
        const r = fromRank + dr;
        if (inBounds(f, r)) {
          const target = board[r][f];
          if (!target || target.color === enemyColor) {
            moves.push([f, r]);
          }
        }
      }
    }
  }

  return moves;
}

export function isKingInCheck(board: BoardState, color: PieceColor): boolean {
  let kingCoords: [number, number] | null = null;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (p && p.type === "king" && p.color === color) {
        kingCoords = [f, r];
        break;
      }
    }
    if (kingCoords) break;
  }
  if (!kingCoords) return false;

  const enemyColor: PieceColor = color === "white" ? "black" : "white";
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (p && p.color === enemyColor) {
        const rawMoves = getPseudoLegalMoves(board, f, r);
        if (rawMoves.some(([mf, mr]) => mf === kingCoords![0] && mr === kingCoords![1])) {
          return true;
        }
      }
    }
  }
  return false;
}

export function getLegalMovesForSquare(
  board: BoardState,
  fromFile: number,
  fromRank: number
): [number, number][] {
  const piece = board[fromRank]?.[fromFile];
  if (!piece) return [];
  const pseudoMoves = getPseudoLegalMoves(board, fromFile, fromRank);

  return pseudoMoves.filter(([toFile, toRank]) => {
    const simBoard = cloneBoard(board);
    simBoard[toRank][toFile] = simBoard[fromRank][fromFile];
    simBoard[fromRank][fromFile] = null;
    return !isKingInCheck(simBoard, piece.color);
  });
}

export function getAllLegalMoves(
  board: BoardState,
  color: PieceColor
): { from: [number, number]; to: [number, number] }[] {
  const allMoves: { from: [number, number]; to: [number, number] }[] = [];
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (p && p.color === color) {
        const destinations = getLegalMovesForSquare(board, f, r);
        for (const dest of destinations) {
          allMoves.push({ from: [f, r], to: dest });
        }
      }
    }
  }
  return allMoves;
}

const PIECE_VALS: Record<PieceType, number> = {
  pawn: 100,
  knight: 330,
  bishop: 340,
  rook: 500,
  queen: 900,
  king: 20000,
};

function evaluateBoard(board: BoardState, botColor: PieceColor): number {
  let score = 0;
  for (let r = 0; r < 8; r++) {
    for (let f = 0; f < 8; f++) {
      const p = board[r][f];
      if (!p) continue;
      let val = PIECE_VALS[p.type];

      if ((f === 3 || f === 4) && (r === 3 || r === 4)) {
        val += 40;
      } else if (f >= 2 && f <= 5 && r >= 2 && r <= 5) {
        val += 20;
      }

      if (p.type === "pawn") {
        const adv = p.color === "white" ? r : 7 - r;
        val += adv * 10;
      }

      if (p.type === "knight") {
        if (f >= 2 && f <= 5 && r >= 2 && r <= 5) val += 25;
      }

      if (p.color === botColor) {
        score += val;
      } else {
        score -= val;
      }
    }
  }
  return score;
}

function minimax(
  board: BoardState,
  depth: number,
  alpha: number,
  beta: number,
  isMaximizing: boolean,
  botColor: PieceColor
): { score: number; move?: { from: [number, number]; to: [number, number] } } {
  const currentColor: PieceColor = isMaximizing ? botColor : (botColor === "white" ? "black" : "white");
  const legalMoves = getAllLegalMoves(board, currentColor);

  if (depth === 0 || legalMoves.length === 0) {
    return { score: evaluateBoard(board, botColor) };
  }

  legalMoves.sort((a, b) => {
    const targetA = board[a.to[1]][a.to[0]] ? 1 : 0;
    const targetB = board[b.to[1]][b.to[0]] ? 1 : 0;
    return targetB - targetA;
  });

  let bestMove = legalMoves[0];

  if (isMaximizing) {
    let maxEval = -Infinity;
    for (const m of legalMoves) {
      const sim = cloneBoard(board);
      const moving = sim[m.from[1]][m.from[0]];
      sim[m.to[1]][m.to[0]] = moving;
      sim[m.from[1]][m.from[0]] = null;
      if (moving?.type === "pawn" && (m.to[1] === 7 || m.to[1] === 0)) {
        sim[m.to[1]][m.to[0]] = { ...moving, type: "queen" };
      }
      const evalRes = minimax(sim, depth - 1, alpha, beta, false, botColor);
      if (evalRes.score > maxEval) {
        maxEval = evalRes.score;
        bestMove = m;
      }
      alpha = Math.max(alpha, evalRes.score);
      if (beta <= alpha) break;
    }
    return { score: maxEval, move: bestMove };
  } else {
    let minEval = Infinity;
    for (const m of legalMoves) {
      const sim = cloneBoard(board);
      const moving = sim[m.from[1]][m.from[0]];
      sim[m.to[1]][m.to[0]] = moving;
      sim[m.from[1]][m.from[0]] = null;
      if (moving?.type === "pawn" && (m.to[1] === 7 || m.to[1] === 0)) {
        sim[m.to[1]][m.to[0]] = { ...moving, type: "queen" };
      }
      const evalRes = minimax(sim, depth - 1, alpha, beta, true, botColor);
      if (evalRes.score < minEval) {
        minEval = evalRes.score;
        bestMove = m;
      }
      beta = Math.min(beta, evalRes.score);
      if (beta <= alpha) break;
    }
    return { score: minEval, move: bestMove };
  }
}

function playChessSound(type: "move" | "capture" | "check" | "gameover") {
  if (typeof window === "undefined" || !isSoundEffectsEnabled()) return;
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);

    if (type === "move") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(320, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(180, ctx.currentTime + 0.08);
      gain.gain.setValueAtTime(0.12, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.08);
      osc.start();
      osc.stop(ctx.currentTime + 0.08);
    } else if (type === "capture") {
      osc.type = "triangle";
      osc.frequency.setValueAtTime(440, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(140, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.18, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } else if (type === "check") {
      osc.type = "sawtooth";
      osc.frequency.setValueAtTime(580, ctx.currentTime);
      osc.frequency.linearRampToValueAtTime(740, ctx.currentTime + 0.15);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
    } else if (type === "gameover") {
      osc.type = "sine";
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      osc.frequency.setValueAtTime(650, ctx.currentTime + 0.1);
      osc.frequency.setValueAtTime(780, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.15, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start();
      osc.stop(ctx.currentTime + 0.35);
    }
  } catch {
    // Ignore audio failure
  }
}

export function ChessPieceIcon({
  type,
  color,
  className = "w-full h-full",
}: {
  type: PieceType;
  color: PieceColor;
  className?: string;
}) {
  const isWhite = color === "white";
  const fill = isWhite ? "#FFF9F0" : "#262220";
  const stroke = isWhite ? "#473C35" : "#E2D7CE";

  switch (type) {
    case "king":
      return (
        <svg viewBox="0 0 45 45" className={className}>
          <g
            fill="none"
            fillRule="evenodd"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22.5 11.63V6M20 8h5" stroke={stroke} strokeLinejoin="miter" />
            <path
              d="M22.5 25s4.5-7.5 3-10.5c0 0-1-2.5-3-2.5s-3 2.5-3 2.5c-1.5 3 3 10.5 3 10.5"
              fill={fill}
              stroke={stroke}
            />
            <path
              d="M11.5 37c5.5 3.5 15.5 3.5 21 0v-7s9-4.5 6-10.5c-4-6.5-13.5-3.5-16 4V23c-2.5-7.5-12-10.5-16-4-3 6 6 10.5 6 10.5v7z"
              fill={fill}
              stroke={stroke}
            />
            <path d="M11.5 30c5.5-3 15.5-3 21 0M11.5 33.5c5.5-3 15.5-3 21 0M11.5 37c5.5-3 15.5-3 21 0" />
          </g>
        </svg>
      );
    case "queen":
      return (
        <svg viewBox="0 0 45 45" className={className}>
          <g
            fill={fill}
            fillRule="evenodd"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M8 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM24.5 7.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM41 12a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM16 8.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0zM33 8.5a2 2 0 1 1-4 0 2 2 0 1 1 4 0z" />
            <path
              d="M9 26c8.5-1.5 21-1.5 27 0l2-12-7 11V11l-5.5 13.5-3-15-3 15-5.5-14V25L7 14l2 12z"
              stroke={stroke}
            />
            <path
              d="M9 26c0 2 1.5 2 2.5 4 1 1.5 1 1 .5 3.5-1.5 1-1.5 2.5-1.5 2.5-1.5 1.5.5 2.5.5 2.5 6.5 1 16.5 1 23 0 0 0 1.5-1 0-2.5 0 0 0-1.5-1.5-2.5-.5-2.5-.5-2 .5-3.5 1-2 2.5-2 2.5-4-8.5-1.5-18.5-1.5-27 0z"
              stroke={stroke}
            />
            <path d="M11 38.5a35 35 1 0 0 23 0" fill="none" stroke={stroke} />
            <path d="M11 29a35 35 1 0 1 23 0M12.5 31.5h20M11.5 34.5a35 35 1 0 0 22 0M10.5 37.5a35 35 1 0 0 24 0" fill="none" stroke={stroke} />
          </g>
        </svg>
      );
    case "rook":
      return (
        <svg viewBox="0 0 45 45" className={className}>
          <g
            fill={fill}
            fillRule="evenodd"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path
              d="M9 39h27v-3H9v3zM12 36v-4h21v4H12zM11 14V9h4v2h5V9h5v2h5V9h4v5"
              strokeLinejoin="miter"
            />
            <path d="M34 14l-3 3H14l-3-3" />
            <path d="M31 17v12.5H14V17" strokeLinejoin="miter" strokeLinecap="butt" />
            <path d="M31 29.5l1.5 2.5h-20l1.5-2.5" />
            <path d="M11 14h23" fill="none" stroke={stroke} strokeLinejoin="miter" />
          </g>
        </svg>
      );
    case "bishop":
      return (
        <svg viewBox="0 0 45 45" className={className}>
          <g
            fill="none"
            fillRule="evenodd"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <g fill={fill} stroke={stroke} strokeLinecap="butt">
              <path d="M9 36c3.39-.97 10.11.43 13.5-2 3.39 2.43 10.11 1.03 13.5 2 0 0 1.65.54 3 2-.68.97-1.65.99-3 .5-3.39-.97-10.11.46-13.5-1-3.39 1.46-10.11.03-13.5 1-1.35.49-2.32.47-3-.5 1.35-1.46 3-2 3-2z" />
              <path d="M15 32c2.5 2.5 12.5 2.5 15 0 .5-1.5 0-2 0-2 0-2.5-2.5-4-2.5-4 5.5-1.5 6-11.5-5-15.5-11 4-10.5 14-5 15.5 0 0-2.5 1.5-2.5 4 0 0-.5.5 0 2z" />
              <path d="M25 8a2.5 2.5 0 1 1-5 0 2.5 2.5 0 1 1 5 0z" />
            </g>
            <path
              d="M17.5 26h10M15 30h15M22.5 15.5v5M20 18h5"
              stroke={stroke}
              strokeLinejoin="miter"
            />
          </g>
        </svg>
      );
    case "knight":
      return (
        <svg viewBox="0 0 45 45" className={className}>
          <g
            fill="none"
            fillRule="evenodd"
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M22 10c10.5 1 16.5 8 16 29H15c0-9 10-6.5 8-21" fill={fill} />
            <path
              d="M24 18c.38 2.91-5.55 7.37-8 9-3 2-2.82 4.34-5 4-1.042-.94 1.41-3.04 0-3-1 0-.632 1.2-1 2.5-.5 1.5-2.02 1.5-2 0 .044-3.13 2.52-5.46 4.5-6.5C14 23 17 21 16.5 19s-3-2-3-2l1-4c1.5-2 6-4 9-3z"
              fill={fill}
            />
            <path d="M9.5 25.5a.5.5 0 1 1-1 0 .5.5 0 1 1 1 0z" fill={stroke} stroke={stroke} />
            <path d="M15 15.5c.5.5 2 1.5 4 1.5" fill="none" stroke={stroke} strokeLinecap="round" />
            <path d="M24.55 10.4s-.55 1.6-1.55 2.6" fill="none" stroke={stroke} strokeLinecap="round" />
          </g>
        </svg>
      );
    case "pawn":
    default:
      return (
        <svg viewBox="0 0 45 45" className={className}>
          <path
            d="M22.5 9c-2.21 0-4 1.79-4 4 0 .89.29 1.71.78 2.38C17.33 16.5 16 18.59 16 21c0 2.03.94 3.84 2.41 5.03-3 1.06-7.41 5.55-7.41 13.47h23c0-7.92-4.41-12.41-7.41-13.47 1.47-1.19 2.41-3 2.41-5.03 0-2.41-1.33-4.5-3.28-5.62.49-.67.78-1.49.78-2.38 0-2.21-1.79-4-4-4z"
            fill={fill}
            stroke={stroke}
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      );
  }
}

export interface ChessGameProps {
  open: boolean;
  onClose: () => void;
  variant?: "fullscreen" | "popup";
  onOpenScores?: () => void;
}

export default function ChessGame({
  open,
  onClose,
  variant = "fullscreen",
  onOpenScores,
}: ChessGameProps) {
  const [board, setBoard] = useState<BoardState>(getStartingPosition);
  const [currentTurn, setCurrentTurn] = useState<PieceColor>("white");
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [gameMode, setGameMode] = useState<"vs-kora" | "pass-and-play">("vs-kora");
  const [playerColor, setPlayerColor] = useState<PieceColor>("white");
  const [flipped, setFlipped] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(() => isSoundEffectsEnabled());
  const [moveHistory, setMoveHistory] = useState<string[]>([]);
  const [capturedWhite, setCapturedWhite] = useState<PieceType[]>([]);
  const [capturedBlack, setCapturedBlack] = useState<PieceType[]>([]);
  const [lastMove, setLastMove] = useState<{ from: string; to: string } | null>(null);
  const [isBotThinking, setIsBotThinking] = useState(false);
  const [gameOverResult, setGameOverResult] = useState<string | null>(null);
  const [famousMoveMatch, setFamousMoveMatch] = useState<{ name: string; creator: string; description: string } | null>(null);

  // Modals for Match Recap, Strategy Tips, and Learn Methods
  const [showMatchRecap, setShowMatchRecap] = useState(false);
  const [showTips, setShowTips] = useState(false);
  const [showMethods, setShowMethods] = useState(false);

  const startNewGame = useCallback(() => {
    setBoard(getStartingPosition());
    setCurrentTurn("white");
    setSelectedSquare(null);
    setMoveHistory([]);
    setCapturedWhite([]);
    setCapturedBlack([]);
    setLastMove(null);
    setIsBotThinking(false);
    setGameOverResult(null);
    setFamousMoveMatch(null);
    setShowMatchRecap(false);
    setShowMethods(false);
    setShowTips(false);
  }, []);

  const isWhiteCheck = useMemo(() => isKingInCheck(board, "white"), [board]);
  const isBlackCheck = useMemo(() => isKingInCheck(board, "black"), [board]);
  const currentInCheck = currentTurn === "white" ? isWhiteCheck : isBlackCheck;

  const legalMovesForSelected = useMemo(() => {
    if (!selectedSquare) return [];
    const coords = squareToCoords(selectedSquare);
    if (!coords) return [];
    return getLegalMovesForSquare(board, coords[0], coords[1]);
  }, [board, selectedSquare]);

  const executeMove = useCallback(
    (
      fromF: number,
      fromR: number,
      toF: number,
      toR: number,
      isBot = false
    ) => {
      const piece = board[fromR][fromF];
      if (!piece) return;
      const target = board[toR][toF];

      const newBoard = cloneBoard(board);
      newBoard[toR][toF] = { ...piece, hasMoved: true };
      newBoard[fromR][fromF] = null;

      if (piece.type === "pawn" && (toR === 7 || toR === 0)) {
        newBoard[toR][toF] = { type: "queen", color: piece.color, hasMoved: true };
      }

      if (target) {
        if (target.color === "white") {
          setCapturedWhite((prev) => [...prev, target.type]);
        } else {
          setCapturedBlack((prev) => [...prev, target.type]);
        }
        playChessSound("capture");
      } else {
        playChessSound("move");
      }

      const nextTurn: PieceColor = currentTurn === "white" ? "black" : "white";
      const fromSq = coordsToSquare(fromF, fromR);
      const toSq = coordsToSquare(toF, toR);
      setLastMove({ from: fromSq, to: toSq });

      const notation = `${piece.type !== "pawn" ? piece.type[0].toUpperCase() : ""}${
        target ? "x" : ""
      }${toSq}`;

      const updatedHistory = [...moveHistory, notation];
      setMoveHistory(updatedHistory);

      // Check famous move openings match
      const matchedOpening = FAMOUS_OPENINGS.find((op) => {
        if (updatedHistory.length < op.moves.length) return false;
        return op.moves.every((m, idx) => updatedHistory[idx]?.toLowerCase() === m.toLowerCase());
      });
      if (matchedOpening) {
        setFamousMoveMatch({
          name: matchedOpening.name,
          creator: matchedOpening.creator,
          description: matchedOpening.description,
        });
      }

      const nextInCheck = isKingInCheck(newBoard, nextTurn);
      const nextLegalMoves = getAllLegalMoves(newBoard, nextTurn);

      if (nextLegalMoves.length === 0) {
        if (nextInCheck) {
          const winner = currentTurn === "white" ? "White" : "Black";
          setGameOverResult(`Checkmate! ${winner} wins.`);
          playChessSound("gameover");
        } else {
          setGameOverResult("Stalemate! Draw game.");
          playChessSound("gameover");
        }
      } else if (nextInCheck) {
        playChessSound("check");
      }

      setBoard(newBoard);
      setCurrentTurn(nextTurn);
      setSelectedSquare(null);
    },
    [board, currentTurn, moveHistory]
  );

  useEffect(() => {
    if (gameMode !== "vs-kora" || currentTurn === playerColor || gameOverResult || isBotThinking) {
      return;
    }

    const botLegalMoves = getAllLegalMoves(board, currentTurn);
    if (botLegalMoves.length === 0) return;

    setIsBotThinking(true);
    const timer = setTimeout(() => {
      try {
        const best = minimax(board, 2, -Infinity, Infinity, true, currentTurn);
        const bestMove = best.move || botLegalMoves[0];

        if (bestMove && bestMove.from && bestMove.to) {
          executeMove(
            bestMove.from[0],
            bestMove.from[1],
            bestMove.to[0],
            bestMove.to[1],
            true
          );
        } else {
          const fallback = botLegalMoves[0];
          executeMove(fallback.from[0], fallback.from[1], fallback.to[0], fallback.to[1], true);
        }
      } catch (e) {
        console.error("Kora AI error:", e);
        const fallback = botLegalMoves[0];
        if (fallback) {
          executeMove(fallback.from[0], fallback.from[1], fallback.to[0], fallback.to[1], true);
        }
      } finally {
        setIsBotThinking(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [
    gameMode,
    currentTurn,
    playerColor,
    board,
    gameOverResult,
    executeMove,
  ]);

  const handleSquareClick = (f: number, r: number) => {
    if (gameOverResult || (gameMode === "vs-kora" && currentTurn !== playerColor)) {
      return;
    }

    const sq = coordsToSquare(f, r);
    const piece = board[r][f];

    if (selectedSquare) {
      const fromCoords = squareToCoords(selectedSquare);
      if (fromCoords) {
        const [fromF, fromR] = fromCoords;
        const isLegal = legalMovesForSelected.some(
          ([destF, destR]) => destF === f && destR === r
        );

        if (isLegal) {
          executeMove(fromF, fromR, f, r);
          return;
        }
      }

      if (piece && piece.color === currentTurn) {
        setSelectedSquare(sq);
        playChessSound("move");
        return;
      }

      setSelectedSquare(null);
    } else {
      if (piece && piece.color === currentTurn) {
        setSelectedSquare(sq);
        playChessSound("move");
      }
    }
  };

  const handleUndo = () => {
    if (moveHistory.length === 0 || isBotThinking) return;
    startNewGame();
  };

  if (!open) return null;

  const displayRanks = flipped ? [0, 1, 2, 3, 4, 5, 6, 7] : [7, 6, 5, 4, 3, 2, 1, 0];
  const displayFiles = flipped ? [7, 6, 5, 4, 3, 2, 1, 0] : [0, 1, 2, 3, 4, 5, 6, 7];

  return createPortal(
    <AnimatePresence>
      <div className="kora-game-theme fixed inset-0 z-[9999] bg-kindle-bg text-kindle-text flex flex-col p-0 sm:items-center sm:justify-center sm:p-4 select-none overflow-hidden">
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, scale: 0.96 }}
          transition={{ duration: 0.2 }}
          className="w-full h-full sm:max-w-4xl sm:max-h-[96vh] bg-kindle-bg border-0 sm:border-2 border-kindle-border rounded-none sm:rounded-3xl shadow-2xl flex flex-col overflow-hidden text-kindle-text"
        >
          {/* Header Bar — compact on mobile so the board keeps the viewport */}
          <div className="border-b border-kindle-border shrink-0 bg-kindle-card kora-safe-top">
            <div className="px-2.5 sm:px-4 py-2 sm:py-3 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <div className="p-1.5 sm:p-2 rounded-lg sm:rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-600 dark:text-amber-400 shrink-0">
                  <Crown className="w-4 h-4 sm:w-5 sm:h-5" />
                </div>
                <div className="min-w-0">
                  <h2 className="font-serif font-bold text-sm sm:text-base leading-tight text-kindle-text truncate">
                    Kora Chess
                  </h2>
                  <p className="text-[9px] sm:text-[10px] uppercase tracking-wider text-kindle-text-muted truncate">
                    {gameMode === "vs-kora" ? "VS Kora" : "Pass & Play"}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1 sm:gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowMethods(true)}
                  className="p-2 sm:px-2.5 sm:py-1.5 rounded-lg border border-kindle-border hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-bold text-kindle-accent flex items-center gap-1 transition"
                  title="Learn Chess Methods & Lessons"
                  aria-label="Learn methods"
                >
                  <BookOpen className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Learn</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowTips(true)}
                  className="p-2 sm:px-2.5 sm:py-1.5 rounded-lg border border-kindle-border hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-bold text-amber-600 flex items-center gap-1 transition"
                  title="GPU & Strategy Tips"
                  aria-label="Tips"
                >
                  <Lightbulb className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Tips</span>
                </button>
                <button
                  type="button"
                  onClick={() => setShowMatchRecap(true)}
                  className="p-2 sm:px-2.5 sm:py-1.5 rounded-lg border border-kindle-border hover:bg-neutral-100 dark:hover:bg-neutral-800 text-xs font-bold text-kindle-accent flex items-center gap-1 transition"
                  title="Match Recap & Insights"
                  aria-label="Match recap"
                >
                  <Trophy className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Recap</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="p-2 rounded-xl hover:bg-neutral-200 dark:hover:bg-neutral-800 text-kindle-text transition"
                  title="Close"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Mode Selector Subheader */}
            <div className="px-2.5 sm:px-4 py-1.5 sm:py-2 bg-kindle-bg/60 border-t border-kindle-border flex items-center justify-between gap-2 text-xs overflow-x-auto">
              <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    setGameMode("vs-kora");
                    startNewGame();
                  }}
                  className={`px-2.5 sm:px-3 py-1 rounded-lg font-bold transition flex items-center gap-1 ${
                    gameMode === "vs-kora"
                      ? "bg-amber-600 text-white shadow-xs"
                      : "bg-kindle-card border border-kindle-border text-kindle-text"
                  }`}
                >
                  <Cpu className="w-3.5 h-3.5" /> <span className="sm:hidden">AI</span><span className="hidden sm:inline">VS Kora</span>
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setGameMode("pass-and-play");
                    startNewGame();
                  }}
                  className={`px-2.5 sm:px-3 py-1 rounded-lg font-bold transition flex items-center gap-1 ${
                    gameMode === "pass-and-play"
                      ? "bg-amber-600 text-white shadow-xs"
                      : "bg-kindle-card border border-kindle-border text-kindle-text"
                  }`}
                >
                  <Users className="w-3.5 h-3.5" /> <span className="sm:hidden">2P</span><span className="hidden sm:inline">Pass & Play</span>
                </button>
              </div>

              {gameMode === "vs-kora" && (
                <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setPlayerColor("white");
                      setFlipped(false);
                      startNewGame();
                    }}
                    className={`px-2 sm:px-2.5 py-1 rounded-lg font-bold transition ${
                      playerColor === "white"
                        ? "bg-kindle-accent text-kindle-bg"
                        : "bg-kindle-card border border-kindle-border text-kindle-text"
                    }`}
                  >
                    White
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPlayerColor("black");
                      setFlipped(true);
                      startNewGame();
                    }}
                    className={`px-2 sm:px-2.5 py-1 rounded-lg font-bold transition ${
                      playerColor === "black"
                        ? "bg-kindle-accent text-kindle-bg"
                        : "bg-kindle-card border border-kindle-border text-kindle-text"
                    }`}
                  >
                    Black
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Main Board Container — prioritize board size on small screens */}
          <div className="flex-1 min-h-0 overflow-y-auto px-2 py-2 sm:p-6 flex flex-col items-center justify-start sm:justify-center gap-1.5 sm:gap-3">
            {/* Famous Move Notification Banner */}
            <AnimatePresence>
              {famousMoveMatch && (
                <motion.div
                  initial={{ opacity: 0, y: -10, scale: 0.95 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.95 }}
                  className="w-full max-w-xl p-2 sm:p-3 rounded-xl sm:rounded-2xl bg-amber-500/15 border border-amber-500/40 sm:border-2 shadow-lg flex items-center justify-between text-xs gap-2"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <div className="p-1.5 sm:p-2 rounded-lg sm:rounded-xl bg-amber-500 text-white shadow-md shrink-0">
                      <Award className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-serif font-bold text-amber-700 dark:text-amber-300 text-xs sm:text-sm truncate">
                        {famousMoveMatch.name}
                      </p>
                      <p className="text-[10px] text-kindle-text-muted line-clamp-1 sm:line-clamp-2">
                        <span className="font-semibold text-kindle-text">{famousMoveMatch.creator}</span>
                        <span className="hidden sm:inline"> — {famousMoveMatch.description}</span>
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setFamousMoveMatch(null)}
                    className="p-1 rounded-lg hover:bg-amber-500/20 text-amber-700 dark:text-amber-300 shrink-0"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            {/* Status Indicator Bar */}
            <div className="w-full max-w-xl flex items-center justify-between px-2.5 sm:px-3 py-1.5 sm:py-2 rounded-lg sm:rounded-xl bg-kindle-card border border-kindle-border text-[11px] sm:text-xs font-bold">
              <div className="flex items-center gap-2 min-w-0">
                <span
                  className={`w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full animate-pulse shrink-0 ${
                    currentTurn === "white" ? "bg-amber-100 border border-neutral-400" : "bg-neutral-900"
                  }`}
                />
                <span className="text-kindle-text truncate">
                  {gameOverResult
                    ? gameOverResult
                    : isBotThinking
                    ? "Kora thinking…"
                    : `${currentTurn === "white" ? "White" : "Black"}'s turn${currentInCheck ? " — check" : ""}`}
                </span>
              </div>
              {isBotThinking && (
                <div className="hidden sm:flex items-center gap-1.5 text-amber-600 animate-pulse shrink-0">
                  <Cpu className="w-4 h-4" /> Analyzing…
                </div>
              )}
            </div>

            {/* Captured Pieces (White's losses) */}
            <div className="w-full max-w-xl flex items-center justify-between px-1 sm:px-2 text-xs">
              <div className="flex items-center gap-0.5 sm:gap-1 min-h-[20px] sm:min-h-[24px] overflow-x-auto">
                <span className="text-[9px] sm:text-[10px] font-bold uppercase text-kindle-text-muted mr-1 shrink-0">
                  Taken
                </span>
                {capturedWhite.map((type, idx) => (
                  <div key={idx} className="w-4 h-4 sm:w-5 sm:h-5 shrink-0 opacity-80">
                    <ChessPieceIcon type={type} color="white" />
                  </div>
                ))}
              </div>
            </div>

            {/* Chessboard Grid (8x8) — fill available width on phones */}
            <div className="relative w-full max-w-[min(100%,92vw,520px)] sm:max-w-[400px] aspect-square bg-kindle-card p-1 sm:p-3 rounded-xl sm:rounded-2xl border border-kindle-border sm:border-2 shadow-lg sm:shadow-2xl flex flex-col">
              <div className="w-full h-full grid grid-cols-8 grid-rows-8 rounded-xl overflow-hidden border border-kindle-border shadow-inner">
                {displayRanks.map((r) =>
                  displayFiles.map((f) => {
                    const piece = board[r][f];
                    const sq = coordsToSquare(f, r);
                    const isSelected = selectedSquare === sq;
                    const isLegalMove = legalMovesForSelected.some(([df, dr]) => df === f && dr === r);
                    const isLight = (f + r) % 2 === 1;
                    const isLastMoved = lastMove?.from === sq || lastMove?.to === sq;
                    const isKingCheckedSquare =
                      piece?.type === "king" &&
                      ((piece.color === "white" && isWhiteCheck) || (piece.color === "black" && isBlackCheck));

                    return (
                      <div
                        key={sq}
                        onClick={() => handleSquareClick(f, r)}
                        className={`kora-chess-square relative flex items-center justify-center cursor-pointer transition-colors duration-150 ${
                          isLight ? "kora-chess-square-light" : "kora-chess-square-dark"
                        } ${isSelected ? "!bg-amber-600/40 ring-2 ring-amber-500 z-10" : ""} ${
                          isLastMoved ? "bg-amber-500/20" : ""
                        } ${isKingCheckedSquare ? "!bg-red-500/50 animate-pulse" : ""}`}
                      >
                        {f === (flipped ? 7 : 0) && (
                          <span className="absolute top-0.5 left-1 text-[9px] font-bold opacity-40 pointer-events-none text-kindle-text">
                            {r + 1}
                          </span>
                        )}
                        {r === (flipped ? 0 : 7) && (
                          <span className="absolute bottom-0.5 right-1 text-[9px] font-bold opacity-40 pointer-events-none text-kindle-text">
                            {FILES[f]}
                          </span>
                        )}

                        {piece && (
                          <motion.div
                            initial={{ scale: 0.9, opacity: 0.6 }}
                            animate={{ scale: 1, opacity: 1 }}
                            transition={{ duration: 0.15 }}
                            className="w-[84%] h-[84%] flex items-center justify-center drop-shadow-sm pointer-events-none"
                          >
                            <ChessPieceIcon type={piece.type} color={piece.color} />
                          </motion.div>
                        )}

                        {isLegalMove && (
                          <div className="absolute inset-0 flex items-center justify-center pointer-events-none z-20">
                            {piece ? (
                              <div className="w-full h-full border-2 sm:border-4 border-amber-600/70 rounded-none animate-pulse" />
                            ) : (
                              <div className="w-2.5 h-2.5 sm:w-3 sm:h-3 rounded-full bg-amber-600/60 dark:bg-amber-400/80 shadow-xs" />
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Captured Pieces (Black's losses) */}
            <div className="w-full max-w-xl flex items-center justify-between px-1 sm:px-2 text-xs">
              <div className="flex items-center gap-0.5 sm:gap-1 min-h-[20px] sm:min-h-[24px] overflow-x-auto">
                <span className="text-[9px] sm:text-[10px] font-bold uppercase text-kindle-text-muted mr-1 shrink-0">
                  Taken
                </span>
                {capturedBlack.map((type, idx) => (
                  <div key={idx} className="w-4 h-4 sm:w-5 sm:h-5 shrink-0 opacity-80">
                    <ChessPieceIcon type={type} color="black" />
                  </div>
                ))}
              </div>
              {moveHistory.length > 0 && (
                <span className="text-[10px] sm:text-[11px] font-mono text-kindle-text-muted shrink-0">
                  {Math.ceil(moveHistory.length / 2)}
                </span>
              )}
            </div>

            {/* Bottom Actions Bar */}
            <div className="w-full max-w-xl flex flex-wrap items-center justify-center gap-1.5 sm:gap-2 pt-1.5 sm:pt-2 border-t border-kindle-border kora-safe-bottom">
              <button
                type="button"
                onClick={startNewGame}
                className="px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-lg sm:rounded-xl bg-kindle-card border border-kindle-border hover:border-amber-500/50 text-kindle-text font-bold text-[11px] sm:text-xs flex items-center gap-1 sm:gap-1.5 transition active:scale-95 shadow-xs"
              >
                <RefreshCw className="w-3.5 h-3.5 text-amber-600" /> New
              </button>
              <button
                type="button"
                onClick={() => setFlipped(!flipped)}
                className="px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-lg sm:rounded-xl bg-kindle-card border border-kindle-border hover:border-amber-500/50 text-kindle-text font-bold text-[11px] sm:text-xs flex items-center gap-1 sm:gap-1.5 transition active:scale-95 shadow-xs"
              >
                <ArrowUpDown className="w-3.5 h-3.5 text-amber-600" /> Flip
              </button>
              <button
                type="button"
                onClick={handleUndo}
                disabled={moveHistory.length === 0 || isBotThinking}
                className="px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-lg sm:rounded-xl bg-kindle-card border border-kindle-border hover:border-amber-500/50 text-kindle-text font-bold text-[11px] sm:text-xs flex items-center gap-1 sm:gap-1.5 transition active:scale-95 shadow-xs disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <RotateCcw className="w-3.5 h-3.5 text-amber-600" /> Undo
              </button>
            </div>
          </div>
        </motion.div>

        {/* Match Recap Modal */}
        {showMatchRecap && (
          <div className="absolute inset-0 z-[11000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-kindle-card border border-kindle-border rounded-2xl p-6 space-y-5 shadow-2xl max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-kindle-border pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-amber-500/15 border border-amber-500/30 text-amber-600 rounded-xl">
                    <Trophy className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-serif font-bold text-base text-kindle-text">Match Recap & Insights</h3>
                    <p className="text-[10px] text-kindle-text-muted uppercase tracking-wider">
                      {gameOverResult ? gameOverResult : "Ongoing Battle Summary"}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMatchRecap(false)}
                  className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-kindle-text"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-2 gap-3">
                  <div className="p-3 rounded-xl bg-kindle-bg border border-kindle-border">
                    <p className="text-[10px] uppercase font-bold text-kindle-text-muted mb-1">Total Moves</p>
                    <p className="text-xl font-serif font-bold text-kindle-text">{moveHistory.length}</p>
                  </div>
                  <div className="p-3 rounded-xl bg-kindle-bg border border-kindle-border">
                    <p className="text-[10px] uppercase font-bold text-kindle-text-muted mb-1">Captured Advantage</p>
                    <p className="text-xl font-serif font-bold text-amber-600">
                      White: {capturedBlack.length} | Black: {capturedWhite.length}
                    </p>
                  </div>
                </div>

                <div className="space-y-2">
                  <h4 className="text-[10px] font-bold uppercase tracking-widest text-kindle-text-muted">
                    Move Timeline ({moveHistory.length} recorded)
                  </h4>
                  <div className="p-3 rounded-xl bg-kindle-bg border border-kindle-border max-h-40 overflow-y-auto font-mono text-[11px] grid grid-cols-2 gap-x-4 gap-y-1">
                    {moveHistory.map((m, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="text-kindle-text-muted">{Math.floor(idx / 2) + 1}.</span>
                        <span className="font-bold text-kindle-text">{m}</span>
                      </div>
                    ))}
                    {moveHistory.length === 0 && (
                      <p className="text-kindle-text-muted italic col-span-2">No moves played yet.</p>
                    )}
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-amber-500/10 border border-amber-500/30 space-y-1.5">
                  <div className="flex items-center gap-2 text-amber-700 dark:text-amber-400 font-bold">
                    <Sparkles className="w-4 h-4" /> Kora's Depth-3 AI Analysis
                  </div>
                  <p className="text-[11px] text-kindle-text-muted leading-relaxed">
                    {moveHistory.length < 4
                      ? "Opening phase: Controlling central squares (d4, d5, e4, e5) and preparing knight development."
                      : moveHistory.length < 15
                      ? "Middlegame battle: Kora's 3-ply alpha-beta minimax is actively evaluating tactical pins and center control."
                      : "Endgame phase: Coordinating rooks and queens to restrict enemy king movement and secure checkmate."}
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-kindle-border flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowMatchRecap(false)}
                  className="px-4 py-2 rounded-xl bg-kindle-accent text-kindle-bg font-bold text-xs uppercase tracking-wider"
                >
                  Resume Match
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Learn Chess Methods Modal */}
        {showMethods && (
          <div className="absolute inset-0 z-[11000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-kindle-card border border-kindle-border rounded-2xl p-6 space-y-5 shadow-2xl max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-kindle-border pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-kindle-accent/15 border border-kindle-accent/30 text-kindle-accent rounded-xl">
                    <BookOpen className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-serif font-bold text-base text-kindle-text">Learn Chess Methods & Tactics</h3>
                    <p className="text-[10px] text-kindle-text-muted uppercase tracking-wider">Master fundamental principles</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowMethods(false)}
                  className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-kindle-text"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 text-xs text-kindle-text leading-relaxed">
                <div className="p-3 rounded-xl bg-kindle-bg border border-kindle-border space-y-1">
                  <h4 className="font-bold text-amber-600 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" /> 1. Opening Principles
                  </h4>
                  <p className="text-kindle-text-muted">
                    Control the center (d4, d5, e4, e5) with pawns and minor pieces. Develop knights before bishops, and castle early within the first 7 moves to protect your king.
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-kindle-bg border border-kindle-border space-y-1">
                  <h4 className="font-bold text-amber-600 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" /> 2. Tactical Motifs: The Fork & Pin
                  </h4>
                  <p className="text-kindle-text-muted">
                    A knight fork attacks two enemy pieces (like King and Queen) simultaneously. A pin immobilizes an enemy piece because moving it would expose a higher-value piece behind it.
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-kindle-bg border border-kindle-border space-y-1">
                  <h4 className="font-bold text-amber-600 flex items-center gap-1.5">
                    <CheckCircle2 className="w-4 h-4" /> 3. King Safety & Castling
                  </h4>
                  <p className="text-kindle-text-muted">
                    Never leave your king stranded in the center of the board. Castling tucks your king safely into the corner behind three protective pawns while activating your rook.
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-kindle-border flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowMethods(false)}
                  className="px-4 py-2 rounded-xl bg-kindle-accent text-kindle-bg font-bold text-xs uppercase tracking-wider"
                >
                  Got It
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Strategy & GPU Tips Modal */}
        {showTips && (
          <div className="absolute inset-0 z-[11000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="w-full max-w-lg bg-kindle-card border border-kindle-border rounded-2xl p-6 space-y-5 shadow-2xl max-h-[85vh] overflow-y-auto">
              <div className="flex items-center justify-between border-b border-kindle-border pb-3">
                <div className="flex items-center gap-2.5">
                  <div className="p-2 bg-amber-500/15 border border-amber-500/30 text-amber-600 rounded-xl">
                    <Zap className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="font-serif font-bold text-base text-kindle-text">GPU & Strategy Tips</h3>
                    <p className="text-[10px] text-kindle-text-muted uppercase tracking-wider">Hardware acceleration & AI play</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setShowTips(false)}
                  className="p-1.5 rounded-lg hover:bg-neutral-100 dark:hover:bg-neutral-800 text-kindle-text"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="space-y-3 text-xs text-kindle-text leading-relaxed">
                <div className="p-3 rounded-xl bg-kindle-bg border border-kindle-border space-y-1">
                  <h4 className="font-bold text-amber-600">1. GPU Hardware Acceleration</h4>
                  <p className="text-kindle-text-muted">
                    Kora Chess uses CSS transforms and Motion animations optimized for GPU compositing. Ensure hardware acceleration is enabled in your browser settings for butter-smooth 60fps piece dragging.
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-kindle-bg border border-kindle-border space-y-1">
                  <h4 className="font-bold text-amber-600">2. Playing on Dedicated GPUs</h4>
                  <p className="text-kindle-text-muted">
                    When running intense web apps alongside hardware-accelerated games, browsers offload vector rendering (SVG pieces and board shadows) directly to your GPU, ensuring zero CPU bottlenecking during 3-ply minimax searches.
                  </p>
                </div>
                <div className="p-3 rounded-xl bg-kindle-bg border border-kindle-border space-y-1">
                  <h4 className="font-bold text-amber-600">3. Outsmarting VS Kora (Depth-3)</h4>
                  <p className="text-kindle-text-muted">
                    Kora evaluates material value, piece-square tables, and central control 3 moves ahead. Avoid hanging pieces and look for tactical forks to gain an advantage!
                  </p>
                </div>
              </div>

              <div className="pt-3 border-t border-kindle-border flex justify-end">
                <button
                  type="button"
                  onClick={() => setShowTips(false)}
                  className="px-4 py-2 rounded-xl bg-kindle-accent text-kindle-bg font-bold text-xs uppercase tracking-wider"
                >
                  Got It
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </AnimatePresence>,
    document.body
  );
}

export function useChess() {
  const [board, setBoard] = useState<Piece[][]>(getStartingPosition);
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [currentTurn, setCurrentTurn] = useState<PieceColor>("white");

  const handleSquareClick = (square: string) => {
    setSelectedSquare(square);
  };

  return {
    board,
    selectedSquare,
    currentTurn,
    handleSquareClick,
    setSelectedSquare,
  };
}

export function ChessBoard({
  onMove,
  onGameEnd,
}: {
  onMove?: (from: string, to: string) => void;
  onGameEnd?: (winner: string) => void;
}) {
  return (
    <div className="w-full flex items-center justify-center p-4">
      <ChessGame open={true} onClose={() => {}} />
    </div>
  );
}