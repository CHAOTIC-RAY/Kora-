import React, { useState, useEffect, useRef } from "react";
import { King, Queen, Rook, Bishop, Knight, Pawn } from "lucide-react";

interface Square {
  file: "a" | "b" | "c" | "d" | "e" | "f" | "g" | "h";
  rank: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;
}

interface Piece {
  type: "king" | "queen" | "rook" | "bishop" | "knight" | "pawn";
  color: "white" | "black";
  hasMoved?: boolean;
}

const STARTING_POSITION: Record<string, Piece | null> = {
  a1: { type: "rook", color: "white" }, b1: { type: "knight", color: "white" },
  c1: { type: "bishop", color: "white" }, d1: { type: "queen", color: "white" },
  e1: { type: "king", color: "white" }, f1: { type: "bishop", color: "white" },
  g1: { type: "knight", color: "white" }, h1: { type: "rook", color: "white" },
  a2: { type: "pawn", color: "white" }, b2: { type: "pawn", color: "white" },
  c2: { type: "pawn", color: "white" }, d2: { type: "pawn", color: "white" },
  e2: { type: "pawn", color: "white" }, f2: { type: "pawn", color: "white" },
  g2: { type: "pawn", color: "white" }, h2: { type: "pawn", color: "white" },
  a8: { type: "rook", color: "black" }, b8: { type: "knight", color: "black" },
  c8: { type: "bishop", color: "black" }, d8: { type: "queen", color: "black" },
  e8: { type: "king", color: "black" }, f8: { type: "bishop", color: "black" },
  g8: { type: "knight", color: "black" }, h8: { type: "rook", color: "black" },
  others: null,
};

const FILES = ["a", "b", "c", "d", "e", "f", "g", "h"];
const RANKS = [1, 2, 3, 4, 5, 6, 7, 8];

const PIECE_SYMBOLS: Record<string, string> = {
  king: "K",
  queen: "Q",
  rook: "R",
  bishop: "B",
  knight: "N",
  pawn: "P",
};

const pieceColors: Record<string, string> = {
  white: "text-kindle-text",
  black: "text-kindle-inverted",
};

export function getStartingPosition(): Piece[][] {
  const board: Piece[][] = RANKS.map(() => RANKS.map(() => null));
  // White pieces
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
  board[1] = RANKS.map(() => ({ type: "pawn", color: "white" }));
  // Black pieces
  board[6] = RANKS.map(() => ({ type: "pawn", color: "black" }));
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

function isValidSquare(square: string): square is keyof Piece {
  return square in STARTING_POSITION || square === "others";
}

function getPieceColor(piece: Piece | null): "white" | "black" | null {
  return piece ? piece.color : null;
}

function isSameColor(piece1: Piece | null, piece2: Piece | null): boolean {
  const c1 = getPieceColor(piece1);
  const c2 = getPieceColor(piece2);
  return c1 !== null && c2 !== null && c1 === c2;
}

function isOpponentColor(piece: Piece | null, color: "white" | "black"): boolean {
  return getPieceColor(piece) === color;
}

function getLegalMoves(
  board: Piece[][],
  piece: Piece,
  square: string
): { from: string; to: string }[] {
  const moves: { from: string; to: string }[] = [];
  const [file, rank] = square.split("") as [string, number];
  const fileIdx = FILES.indexOf(file);
  const rankIdx = RANKS.indexOf(rank as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8);

  if (piece.type === "pawn") {
    const direction = piece.color === "white" ? 1 : -1;
    const startRank = piece.color === "white" ? 2 : 7;

    // Forward one square
    if (rankIdx + direction >= 0 && rankIdx + direction < 8) {
      const targetRank = RANKS[rankIdx + direction];
      const targetFile = file;
      const targetSquare = `${targetFile}${targetRank}`;
      if (!board[rankIdx + direction]?.[fileIdx]) {
        moves.push({ from: square, to: targetSquare });
        // Forward two from starting position
        if (rank === startRank) {
          const doubleTargetRank = RANKS[rankIdx + 2 * direction];
          if (!board[rankIdx + 2 * direction]?.[fileIdx]) {
            moves.push({ from: square, to: `${file}${doubleTargetRank}` });
          }
        }
      }
    }

    // Captures diagonally
    const captureDirs = [1, -1];
    for (const dc of captureDirs) {
      const targetFile = FILES[(fileIdx + dc + 8) % 8];
      const targetRank = RANKS[rankIdx + direction];
      if (targetRank >= 0 && targetRank < 8) {
        const targetSquare = `${targetFile}${targetRank}`;
        const targetPiece = board[rankIdx + direction]?.[(FILES.indexOf(targetFile) as number)];
        if (targetPiece && getPieceColor(targetPiece) !== piece.color) {
          moves.push({ from: square, to: targetSquare });
        }
      }
    }
  } else if (piece.type === "rook") {
    // Horizontal and vertical
    const directions = ["a1", "h1", "a8", "h8"].map((corner) => {
      const cornerFile = corner[0];
      const cornerRank = parseInt(corner[1]);
      const fileDelta = cornerFile === file ? 0 : cornerFile > file ? 1 : -1;
      const rankDelta = cornerRank === rank ? 0 : cornerRank > rank ? 1 : -1;
      return { fileDelta, rankDelta };
    });

    for (const { fileDelta, rankDelta } of directions) {
      let x = fileIdx + fileDelta;
      let y = rankIdx + rankDelta;
      while (x >= 0 && x < 8 && y >= 0 && y < 8) {
        const targetSquare = `${FILES[x]}${RANKS[y]}`;
        const targetPiece = board[y][x];
        if (!targetPiece) {
          moves.push({ from: square, to: targetSquare });
        } else if (isOpponentColor(targetPiece, piece.color)) {
          moves.push({ from: square, to: targetSquare });
          break;
        } else {
          break;
        }
        x += fileDelta;
        y += rankDelta;
      }
    }
  } else if (piece.type === "knight") {
    const knightMoves = [
      [1, 2], [1, -2], [-1, 2], [-1, -2],
      [2, 1], [2, -1], [-2, 1], [-2, -1]
    ];
    for (const [dx, dy] of knightMoves) {
      const x = fileIdx + dx;
      const y = rankIdx + dy;
      if (x >= 0 && x < 8 && y >= 0 && y < 8) {
        const targetSquare = `${FILES[x]}${RANKS[y]}`;
        const targetPiece = board[y][x];
        if (!targetPiece || isOpponentColor(targetPiece, piece.color)) {
          moves.push({ from: square, to: targetSquare });
        }
      }
    }
  } else if (piece.type === "bishop") {
    // Diagonal directions
    const diagonals = [
      [1, 1], [1, -1], [-1, 1], [-1, -1]
    ];
    for (const [dx, dy] of diagonals) {
      let x = fileIdx + dx;
      let y = rankIdx + dy;
      while (x >= 0 && x < 8 && y >= 0 && y < 8) {
        const targetSquare = `${FILES[x]}${RANKS[y]}`;
        const targetPiece = board[y][x];
        if (!targetPiece) {
          moves.push({ from: square, to: targetSquare });
        } else if (isOpponentColor(targetPiece, piece.color)) {
          moves.push({ from: square, to: targetSquare });
          break;
        } else {
          break;
        }
        x += dx;
        y += dy;
      }
    }
  } else if (piece.type === "queen") {
    // Queen moves like rook + bishop
    const rookDirections = ["a1", "h1", "a8", "h8"].map((corner) => {
      const cornerFile = corner[0];
      const cornerRank = parseInt(corner[1]);
      const fileDelta = cornerFile === file ? 0 : cornerFile > file ? 1 : -1;
      const rankDelta = cornerRank === rank ? 0 : cornerRank > rank ? 1 : -1;
      return { fileDelta, rankDelta };
    });
    const diagonals = [[1, 1], [1, -1], [-1, 1], [-1, -1]];

    const allDirs = [...rookDirections, ...diagonals];
    for (const { fileDelta, rankDelta } of allDirs) {
      let x = fileIdx + fileDelta;
      let y = rankIdx + rankDelta;
      while (x >= 0 && x < 8 && y >= 0 && y < 8) {
        const targetSquare = `${FILES[x]}${RANKS[y]}`;
        const targetPiece = board[y][x];
        if (!targetPiece) {
          moves.push({ from: square, to: targetSquare });
        } else if (isOpponentColor(targetPiece, piece.color)) {
          moves.push({ from: square, to: targetSquare });
          break;
        } else {
          break;
        }
        x += fileDelta;
        y += rankDelta;
      }
    }
  } else if (piece.type === "king") {
    // King moves one square in any direction
    const kingMoves = [
      [1, 0], [-1, 0], [0, 1], [0, -1],
      [1, 1], [1, -1], [-1, 1], [-1, -1]
    ];
    for (const [dx, dy] of kingMoves) {
      const x = fileIdx + dx;
      const y = rankIdx + dy;
      if (x >= 0 && x < 8 && y >= 0 && y < 8) {
        const targetSquare = `${FILES[x]}${RANKS[y]}`;
        const targetPiece = board[y][x];
        if (!targetPiece || isOpponentColor(targetPiece, piece.color)) {
          moves.push({ from: square, to: targetSquare });
        }
      }
    }
    // Castling not implemented for simplicity
  }

  return moves;
}

function squareToIndex(square: string): [number, number] | null {
  if (square.length !== 2) return null;
  const file = square[0];
  const rank = square[1];
  const fileIdx = FILES.indexOf(file);
  const rankIdx = RANKS.indexOf(parseInt(rank) as 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8);
  if (fileIdx === -1 || rankIdx === -1) return null;
  return [fileIdx, rankIdx];
}

function indexToSquare([fileIdx, rankIdx]: [number, number]): string {
  return `${FILES[fileIdx]}${RANKS[rankIdx]}`;
}

function getPieceSvg(piece: Piece | null, size: number = 32): string {
  if (!piece) return "";
  const symbol = PIECE_SYMBOLS[piece.type];
  const colorClass = pieceColors[piece.color];
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" class="${colorClass}">
    <text x="50%" y="50%" fill="currentColor" font-size="${size * 0.5}" font-family="system-ui, -apple-system, sans-serif" text-anchor="middle" dominant-baseline="middle">${symbol}</text>
  </svg>`;
}

/* Responsive chess configuration */
const SQUARE_MOBILE = 48;
const SQUARE_DESKTOP = 64;
const BOARD_MAX_MOBILE = 360;
const BOARD_MAX_DESKTOP = 460;
  const [board, setBoard] = useState<Piece[][]>(() => {
    if (initialFen) {
      // Parse FEN - simplified
      return getStartingPosition();
    }
    return getStartingPosition();
  });

  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);
  const [currentTurn, setCurrentTurn] = useState("white");
  const [gameOver, setGameOver] = useState(false);
  const [message, setMessage] = useState<string>("White to move");

  const handleSquareClick = (square: string) => {
    const piece = board[squareToIndex(square)![1]][squareToIndex(square)![0]];

    if (selectedSquare === null) {
      // Select a piece
      if (piece && getPieceColor(piece, currentTurn)) {
        setSelectedSquare(square);
      }
    } else {
      // Try to move
      const legalMoves = getLegalMoves(board, piece!, selectedSquare);
      const move = legalMoves.find((m) => m.to === square);

      if (move) {
        // Make the move
        const newBoard = structuredClone(board);
        const [fromFile, fromRank] = squareToIndex(selectedSquare!);
        const [toFile, toRank] = squareToIndex(square);

        // Move piece
        newBoard[toRank][toFile] = newBoard[fromRank][fromFile];
        newBoard[fromRank][fromFile] = null;

        // Check for pawn promotion
        const movedPiece = newBoard[toRank][toFile];
        if (movedPiece?.type === "pawn" && (toRank === 0 || toRank === 7)) {
          newBoard[toRank][toFile] = { ...movedPiece, type: "queen" };
        }

        setBoard(newBoard);
        setSelectedSquare(null);

        // Switch turn
        setCurrentTurn(currentTurn === "white" ? "black" : "white");

        // Check game state
        checkGameState();
      } else {
        // Deselect if clicking same piece or invalid move
        setSelectedSquare(null);
      }
    }
  };

  const checkGameState = () => {
    // Simplified check detection
    // In a real implementation, would check if the king is in check
    setMessage(`${currentTurn.toUpperCase()} to move`);

    // Check for stalemate/checkmate logic would go here
  };

  useEffect(() => {
    // Initialize from FEN if provided
    if (initialFen) {
      // Parse FEN logic
    }
  }, [initialFen]);

  return {
    board,
    selectedSquare,
    currentTurn,
    gameOver,
    message,
    handleSquareClick,
    setSelectedSquare,
  };
}

interface ChessBoardProps {
  onMove?: (from: string, to: string, promotion?: "queen" | "rook" | "bishop" | "knight") => void;
  onGameEnd?: (winner: "white" | "black" | "draw") => void;
}

/* Square size based on viewport */
const useSquareSize = () => {
  const width = window.innerWidth;
  return width < 640 ? SQUARE_MOBILE : SQUARE_DESKTOP;
};

  const handleClick = (square: string) => {
    handleSquareClick(square);
    // Convert move to FEN-algebraic notation
    if (selectedSquare && square !== selectedSquare) {
      const legalMoves = getLegalMoves(board, board[squareToIndex(selectedSquare)!]!, selectedSquare);
      const move = legalMoves.find((m) => m.to === square);
      if (move && onMove) {
        // Determine promotion piece for pawn promotion
        const promotion = move.from.includes("2") || move.from.includes("7")
          ? "queen"
          : undefined;
        onMove(move.from, move.to, promotion);
      }
    }
  };

  return (
    <div className="chess-board" style={{ width: useSquareSize(), height: useSquareSize() }}>
      <div className="chess-board-grid">
        {RANKS.map((rank) => (
          <div key={rank} className="chess-board-rank">
            <span className="chess-board-rank-label">
              {rank === 8 ? "8" : rank === 7 ? "7" : rank === 6 ? "6" : rank === 5 ? "5" : rank === 4 ? "4" : rank === 3 ? "3" : rank === 2 ? "2" : "1"}
            </span>
            {FILES.map((file) => {
              const square = `${file}${rank}`;
              const piece = board[squareToIndex(square)![1]][squareToIndex(square)![0]];
              const isDark = (FILE.indexOf(file) + rank) % 2 === 1;

              return (
                <div
                  key={square}
                  className={`chess-board-square ${isDark ? "dark" : "light"} ${selectedSquare === square ? "selected" : ""} ${
                    piece ? "has-piece" : ""
                  }`}
                  onClick={() => handleClick(square)}
                >
                  {piece && (
                    <span className="piece" title={`${piece.color} ${piece.type}`}>
                      {indexToSquare(squareToIndex(square) as [number, number])}
                    </span>
                  )}
                </div>
              );
            })}
            <span className="chess-board-rank-label">
              {rank === 8 ? "8" : rank === 7 ? "7" : rank === 6 ? "6" : rank === 5 ? "5" : rank === 4 ? "4" : rank === 3 ? "3" : rank === 2 ? "2" : "1"}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}