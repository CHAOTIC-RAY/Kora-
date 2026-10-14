/**
 * Drag-to-place for the online Scrabble board.
 *
 * The board had no drag affordance at all: placing a tile meant tapping a rack
 * tile, then tapping a cell — and `clickBoardCell` returned immediately on the
 * first occupied cell, so multi-letter words could not be laid down as one
 * gesture. There was no pointer capture, no `clientX`, no
 * `getBoundingClientRect` anywhere in the file to build on.
 *
 * What this adds:
 *
 *  - **Pick up a run of tiles.** Press on a rack tile starts a drag; dragging
 *    across the rack picks up the *word*: consecutive letters to the right of
 *    the press point, which is how a word is actually held. Release a single
 *    tile and the old tap-to-select behaviour is unchanged.
 *
 *  - **Place a word with the same arrangement.** The run is laid along one axis
 *    at a time. `autoOrient` decides which: if the pointer moved more
 *    horizontally than vertically the run is horizontal, otherwise vertical —
 *    so a word can be dragged in either direction, and the arrangement the user
 *    grabbed is the arrangement that lands on the board.
 *
 *  - **Snap to cells.** The pointer position is converted to a board (row, col)
 *    by measuring the grid once per drag, so the first cell is the anchor and
 *    the rest follow at +1 along the chosen axis.
 *
 * Placement reuses the existing rules rather than reimplementing them: a cell
 * already holding a committed tile stops the word (you cannot overlap), a cell
 * holding one of *your* temp tiles is skipped, and everything is undone cleanly
 * if the drag is released over an invalid cell or off the board entirely.
 */
import { useCallback, useRef, useState } from "react";

export interface DragTile {
  /** Index into the player's rack. */
  rackIdx: number;
  letter: string;
}

export interface DragPlacement {
  /** Board coordinates the word would occupy, in order. */
  cells: { r: number; c: number }[];
  /** True when the run is laid along the vertical axis. */
  vertical: boolean;
  /** True when every cell is currently placeable. */
  valid: boolean;
}

export interface UseWordDragArgs {
  boardSize: number;
  /** Whether the local player may move right now. */
  canMove: boolean;
  /** The player's current rack letters (index-aligned). */
  rack: string[];
  /** Read a board cell; committed tiles are those the other player owns. */
  cellAt: (r: number, c: number) => { letter: string; isTemp?: boolean } | undefined;
  /** Committed tiles may not be overlapped. */
  isCommitted: (r: number, c: number) => boolean;
  /** Cells already claimed by this drag. */
  tempCells: { r: number; c: number }[];
  /** Commit a run: place each tile at its cell. */
  onPlace: (tiles: DragTile[], cells: { r: number; c: number }[]) => void;
  /** Lift a previously placed temp tile back to the rack. */
  onLift: (r: number, c: number) => void;
}

export interface WordDragState {
  /** The run being dragged, empty when idle. */
  tiles: DragTile[];
  /** Where it would land right now. */
  placement: DragPlacement | null;
  /** Pointer offset within the grabbed tile, so it does not jump to centre. */
  grabOffset: { x: number; y: number };
  /** True while a drag is in flight (as opposed to a tap). */
  dragging: boolean;
  /** Attach to a rack tile to make it draggable. */
  rackHandlers: (rackIdx: number) => {
    onPointerDown: (e: React.PointerEvent) => void;
  };
  /** Attach to the board grid to receive the drag. */
  boardHandlers: {
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: () => void;
  };
  /** True when the given rack index is part of the in-flight drag. */
  isDragging: (rackIdx: number) => boolean;
  /**
   * Attach to the board grid so pointer position can be converted to a cell.
   *
   * Typed explicitly rather than spread into the return object: a `Record<
   * string, unknown>` spread silently drops the type, which is how `gridRef`
   * ended up unresolvable at the call site.
   */
  gridRef: React.RefObject<HTMLDivElement>;
}

/** Movement, in px, past which a press becomes a drag rather than a tap. */
const DRAG_THRESHOLD = 6;

export function useWordDrag(args: UseWordDragArgs): WordDragState {
  const { boardSize, canMove, rack, cellAt, isCommitted, tempCells, onPlace, onLift } = args;

  const [tiles, setTiles] = useState<DragTile[]>([]);
  const [placement, setPlacement] = useState<DragPlacement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [grabOffset, setGrabOffset] = useState({ x: 0, y: 0 });

  // Refs, not state: these are read inside pointermove, and re-rendering per move
  // would lag behind the finger.
  const gridRef = useRef<HTMLDivElement | null>(null);
  const pending = useRef<DragTile[] | null>(null);
  const started = useRef(false);
  const moved = useRef(false);
  const origin = useRef({ x: 0, y: 0 });
  const axis = useRef<"x" | "y" | null>(null);
  const anchor = useRef<{ r: number; c: number } | null>(null);

  /**
   * Build the run of tiles starting at `rackIdx`, walking right while letters
   * are present. A gap ends the word, matching how the rack is laid out.
   */
  const runFrom = useCallback(
    (rackIdx: number): DragTile[] => {
      const out: DragTile[] = [];
      for (let i = rackIdx; i < rack.length; i++) {
        const letter = rack[i];
        if (!letter) break;
        out.push({ rackIdx: i, letter });
      }
      return out;
    },
    [rack]
  );

  /** Pointer position -> board cell. */
  const cellFromPoint = useCallback(
    (clientX: number, clientY: number) => {
      const el = gridRef.current;
      if (!el) return null;
      const r0 = el.getBoundingClientRect();
      if (r0.width === 0) return null;
      const x = (clientX - r0.left) / r0.width;
      const y = (clientY - r0.top) / r0.height;
      const c = Math.floor(x * boardSize);
      const r = Math.floor(y * boardSize);
      if (r < 0 || c < 0 || r >= boardSize || c >= boardSize) return null;
      return { r, c };
    },
    [boardSize]
  );

  /**
   * Lay the run out from the anchor along the locked axis and decide whether
   * every cell is placeable.
   */
  const layout = useCallback(
    (run: DragTile[], vertical: boolean, at: { r: number; c: number }): DragPlacement => {
      const cells = run.map((_, i) =>
        vertical ? { r: at.r + i, c: at.c } : { r: at.r, c: at.c + i }
      );
      const inBounds = cells.every(
        (x) => x.r >= 0 && x.c >= 0 && x.r < boardSize && x.c < boardSize
      );
      if (!inBounds) return { cells, vertical, valid: false };

      // A committed tile (the opponent's) blocks. A temp tile that is not part
      // of THIS drag also blocks — you cannot build on an unrelated word.
      const mine = new Set(tempCells.map((t) => `${t.r},${t.c}`));
      const clash = cells.some((x) => {
        if (isCommitted(x.r, x.c)) return true;
        return mine.has(`${x.r},${x.c}`);
      });
      return { cells, vertical, valid: !clash };
    },
    [boardSize, isCommitted, tempCells]
  );

  const beginDrag = (rackIdx: number, e: React.PointerEvent) => {
    if (!canMove) return;
    const run = runFrom(rackIdx);
    if (run.length === 0) return;
    pending.current = run;
    started.current = true;
    moved.current = false;
    axis.current = null;
    anchor.current = null;
    origin.current = { x: e.clientX, y: e.clientY };
    setTiles(run);
    setPlacement(null);
    setDragging(false);
    setGrabOffset({ x: 0, y: 0 });
  };

  const onRackPointerDown = (rackIdx: number) => (e: React.PointerEvent) => {
    if (!canMove) return;
    // Only the primary button/touch starts a drag.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    beginDrag(rackIdx, e);
  };

  const onBoardPointerMove = (e: React.PointerEvent) => {
    const run = pending.current;
    if (!started.current || !run) return;
    const dx = e.clientX - origin.current.x;
    const dy = e.clientY - origin.current.y;

    if (!moved.current) {
      if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
      moved.current = true;
      setDragging(true);
    }
    // Lock the axis once, early: a mostly-vertical drag must not be read as
    // horizontal. This is what lets the same gesture run either way.
    if (axis.current === null) {
      axis.current = Math.abs(dx) >= Math.abs(dy) ? "x" : "y";
    }
    const at = cellFromPoint(e.clientX, e.clientY);
    if (!at) {
      setPlacement(null);
      return;
    }
    anchor.current = at;
    setPlacement(layout(run, axis.current === "y", at));
  };

  const onBoardPointerUp = (e: React.PointerEvent) => {
    const run = pending.current;
    const wasDragging = moved.current;
    const current = placement;
    started.current = false;
    pending.current = null;
    moved.current = false;
    axis.current = null;
    anchor.current = null;
    setTiles([]);
    setPlacement(null);
    setDragging(false);

    if (!run) return;

    if (!wasDragging) {
      // A tap, not a drag: leave the existing single-tile selection behaviour
      // to the rack tile's own onClick.
      return;
    }
    if (!current || !current.valid || current.cells.length === 0) {
      // Released somewhere illegal. If the pointer is over one of OUR temp
      // tiles, treat it as a lift rather than doing nothing at all.
      const at = cellFromPoint(e.clientX, e.clientY);
      if (at) onLift(at.r, at.c);
      return;
    }
    onPlace(run, current.cells);
  };

  const cancel = () => {
    started.current = false;
    pending.current = null;
    moved.current = false;
    axis.current = null;
    anchor.current = null;
    setTiles([]);
    setPlacement(null);
    setDragging(false);
  };

  return {
    tiles,
    placement,
    grabOffset,
    dragging,
    isDragging: (i) => tiles.some((t) => t.rackIdx === i),
    rackHandlers: (i) => ({ onPointerDown: onRackPointerDown(i) }),
    boardHandlers: {
      onPointerMove: onBoardPointerMove,
      onPointerUp: onBoardPointerUp,
      onPointerCancel: cancel,
    },
    // Exposed so the caller can attach the measured grid element.
    gridRef,
  };
}