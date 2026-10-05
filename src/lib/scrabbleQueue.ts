/**
 * The letter queue behind per-letter placement.
 *
 * Why this exists. The rack is a fixed seven slots, and both existing
 * placement paths derive their order from it:
 *
 *   - tap-tap placed "the selected tile", so a five-letter word meant
 *     select, tap, re-select, tap — five times, in whatever order the rack
 *     happened to be arranged rather than the order the player wanted;
 *   - word drag lifted a *contiguous run* of rack tiles, so letters that were
 *     not adjacent could not be played together at all.
 *
 * Neither can express "I want C-H-A-I-N and my rack is scattered". This
 * module holds the pending sequence instead: the player adds letters one at a
 * time, in any order, reorders or drops them before committing, and the board
 * consumes the queue as the word goes down.
 *
 * Pure and separate from the component on purpose. This is the part with the
 * fiddly rules — a tile can only be queued once, removal must not leave a hole
 * that shifts every later letter — and it is far easier to test than a 1300
 * line component with Firestore writes in it.
 */

/** A queued letter, identified by the rack slot it came from. */
export interface QueuedLetter {
  /** Index into the player's fixed 7-slot rack. */
  rackIdx: number;
  /** The letter at that slot when it was queued, for display and validation. */
  letter: string;
}

/**
 * Add a rack tile to the end of the queue.
 *
 * Rejects a slot that is empty (already spent) and a slot already queued. The
 * second rule is the one that matters: placing blanks the rack slot, so
 * queueing the same slot twice would let a player put one physical tile into
 * two cells.
 *
 * Returns the same array reference when the add is rejected, so a caller can
 * compare identity and skip a pointless re-render.
 */
export function enqueueLetter(
  queue: QueuedLetter[],
  rackIdx: number,
  rack: readonly string[]
): QueuedLetter[] {
  if (!Number.isInteger(rackIdx) || rackIdx < 0 || rackIdx >= rack.length) return queue;
  const letter = rack[rackIdx];
  if (!letter) return queue;
  if (queue.some((q) => q.rackIdx === rackIdx)) return queue;
  return [...queue, { rackIdx, letter }];
}

/** Remove the queued letter at `index` — per-slot undo before anything is placed. */
export function removeQueuedAt(queue: QueuedLetter[], index: number): QueuedLetter[] {
  if (!Number.isInteger(index) || index < 0 || index >= queue.length) return queue;
  const next = [...queue];
  next.splice(index, 1);
  return next;
}

/**
 * Move a queued letter to a new position — drag-to-reorder.
 *
 * Clamps rather than rejecting an out-of-range target: a drag that ends past
 * the end of the queue should land at the end, not silently do nothing, which
 * is what makes a dragged chip feel dropped rather than broken.
 */
export function moveQueued(
  queue: QueuedLetter[],
  from: number,
  to: number
): QueuedLetter[] {
  if (!Number.isInteger(from) || from < 0 || from >= queue.length) return queue;
  const target = Math.min(Math.max(0, to), queue.length - 1);
  if (target === from) return queue;
  const next = [...queue];
  const [moved] = next.splice(from, 1);
  next.splice(target, 0, moved);
  return next;
}

/** The queued word, uppercase, for display and for the submit-time check. */
export function queuedWord(queue: readonly QueuedLetter[]): string {
  return queue.map((q) => q.letter).join("").toUpperCase();
}

/**
 * Drop every queued slot whose rack slot no longer holds that letter.
 *
 * The rack is mutated in place by every existing placement path, so a queue
 * built before a shuffle or a word drag can reference slots that now hold a
 * different letter — or nothing. Rendering that queue would show letters the
 * player no longer has, and submitting it would place tiles that were never
 * theirs. Cheap enough to run on every render.
 */
export function pruneQueue(
  queue: readonly QueuedLetter[],
  rack: readonly string[]
): QueuedLetter[] {
  const next = queue.filter((q) => rack[q.rackIdx] === q.letter);
  return next.length === queue.length ? [...queue] : next;
}

/**
 * A rack slot that is already spoken for, by either a placed tile or the queue.
 *
 * `placed` is the caller's `tempPlaced` list. The UI uses this to dim a rack
 * tile that cannot be added, so the reason a tap would do nothing is visible
 * before the tap rather than only after it.
 */
export function isRackSlotUnavailable(
  rackIdx: number,
  queue: readonly QueuedLetter[],
  placed: readonly { rackIdx: number }[]
): boolean {
  return (
    queue.some((q) => q.rackIdx === rackIdx) ||
    placed.some((p) => p.rackIdx === rackIdx)
  );
}

/** A rack is seven slots, so a queue can never usefully exceed it. */
export const QUEUE_LIMIT = 7;