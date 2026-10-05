/**
 * Letter-queue tests.
 *
 * The load-bearing claims, each of which maps to a way the feature is useless
 * if it is untrue:
 *
 *   1. A rack tile can be queued only once. The rack blanks a slot when a tile
 *      is placed, so a duplicate queue entry would put one physical tile on two
 *      cells.
 *   2. Order is the player's, not the rack's — that is the whole point.
 *   3. Removing or reordering never silently shifts another letter's identity.
 *   4. A queue built before a shuffle cannot place a letter the player lost.
 */
import {
  enqueueLetter,
  removeQueuedAt,
  moveQueued,
  queuedWord,
  pruneQueue,
  isRackSlotUnavailable,
  QUEUE_LIMIT,
  type QueuedLetter,
} from "../scrabbleQueue";

let passed = 0;
let failed = 0;
function check(name: string, actual: unknown, expected: unknown) {
  if (actual === expected) passed++;
  else {
    failed++;
    console.log(`FAIL  ${name}\n        expected ${expected}, got ${actual}`);
  }
}

const rack = ["C", "H", "A", "I", "N", "", ""];

// ── Order is the player's ──────────────────────────────────────────────────
// The rack is C,H,A,I,N. The player wants C-H-A-I-N, which happens to match,
// so build a case where it does NOT.
const scattered = ["A", "X", "C", "X", "H", "X", "X"];
let q: QueuedLetter[] = [];
q = enqueueLetter(q, 2, scattered); // C
q = enqueueLetter(q, 4, scattered); // H
q = enqueueLetter(q, 0, scattered); // A
check("queue order follows the player, not the rack", queuedWord(q), "CHA");

// ── Duplicate rejection ────────────────────────────────────────────────────
const dupBefore = q;
q = enqueueLetter(q, 2, scattered);
check("same slot cannot be queued twice", q === dupBefore, true);
check("queue length unchanged after a rejected add", q.length, 3);

// ── Empty / invalid slots ──────────────────────────────────────────────────
const gappy = ["A", "", "C", "", "H", "", ""]; // slots 1, 3, 5 are empty
check("empty slot rejected", enqueueLetter(q, 1, gappy) === q, true);
check("negative index rejected", enqueueLetter(q, -1, scattered) === q, true);
check("out-of-range index rejected", enqueueLetter(q, 99, scattered) === q, true);
check("fractional index rejected", enqueueLetter(q, 1.5, scattered) === q, true);
check("index equal to rack length rejected", enqueueLetter(q, 7, scattered) === q, true);

// ── Removal ────────────────────────────────────────────────────────────────
const removed = removeQueuedAt(q, 1); // drop the H
check("removal shortens the queue", removed.length, 2);
check("removal keeps the right survivors", queuedWord(removed), "CA");
check("removal does not mutate the source", queuedWord(q), "CHA");
check("out-of-range removal is a no-op", removeQueuedAt(q, 9) === q, true);
check("negative removal is a no-op", removeQueuedAt(q, -1) === q, true);

// Identity must survive a removal — the later letters must NOT slide down and
// become attached to the wrong rack slot.
check(
  "survivors keep their rack slots after a removal",
  JSON.stringify(removed.map((x) => x.rackIdx)),
  "[2,0]"
);

// ── Reorder ────────────────────────────────────────────────────────────────
let m = enqueueLetter([], 2, scattered); // C
m = enqueueLetter(m, 4, scattered); // H
m = enqueueLetter(m, 0, scattered); // A
const moved = moveQueued(m, 2, 0);
check("reorder puts the last letter first", queuedWord(moved), "ACH");
check("reorder does not mutate the source", queuedWord(m), "CHA");
check(
  "reorder carries rack slots with the letters",
  JSON.stringify(moved.map((x) => x.rackIdx)),
  "[0,2,4]"
);
check("reorder out of range clamps to the end", queuedWord(moveQueued(m, 0, 99)), "HAC");
check("reorder out of range clamps to the start", queuedWord(moveQueued(m, 2, -5)), "ACH");
check("reorder to the same slot is a no-op", moveQueued(m, 1, 1) === m, true);
check("reorder from an invalid index is a no-op", moveQueued(m, 9, 0) === m, true);

// ── pruneQueue: the shuffle guard ──────────────────────────────────────────
const beforeShuffle = enqueueLetter(enqueueLetter([], 2, scattered), 4, scattered);
check("queue built before a shuffle", queuedWord(beforeShuffle), "CH");

const shuffled = ["X", "X", "Z", "X", "H", "X", "X"]; // slot 2 changed C -> Z
const pruned = pruneQueue(beforeShuffle, shuffled);
check("stale slot dropped after a shuffle", queuedWord(pruned), "H");
check(
  "prune drops the changed slot",
  pruned.some((x) => x.rackIdx === 2),
  false
);

// A slot that was blanked by another placement must go too.
const blanked = pruneQueue(beforeShuffle, ["X", "X", "C", "X", "", "X", "X"]);
check("slot blanked by a placement is dropped", queuedWord(blanked), "C");

// Nothing stale -> a copy, same contents.
const intact = pruneQueue(beforeShuffle, scattered);
check("prune with no change preserves the word", queuedWord(intact), "CH");
// `intact === beforeShuffle` must be FALSE: prune hands back a fresh array
// so a caller cannot mutate the state it passed in.
check("prune returns a fresh array, not the caller's", intact === beforeShuffle, false);
// And it must not hand back a mutable alias of the caller's array either way.
intact.push({ rackIdx: 0, letter: "Z" });
check("mutating the result cannot corrupt the source", queuedWord(beforeShuffle), "CH");

// ── Availability ───────────────────────────────────────────────────────────
const placed: { rackIdx: number }[] = [{ rackIdx: 2 }];
check("slot already placed is unavailable", isRackSlotUnavailable(2, [], placed), true);
check("queued slot is unavailable", isRackSlotUnavailable(4, beforeShuffle, []), true);
check("free slot is available", isRackSlotUnavailable(6, beforeShuffle, placed), false);
check("empty queue, nothing placed", isRackSlotUnavailable(1, [], []), false);

// ── Limits ─────────────────────────────────────────────────────────────────
let full: QueuedLetter[] = [];
const seven = ["A", "B", "C", "D", "E", "F", "G"];
for (let i = 0; i < QUEUE_LIMIT; i++) full = enqueueLetter(full, i, seven);
check("a whole rack queues", full.length, QUEUE_LIMIT);
check("whole rack word", queuedWord(full), "ABCDEFG");
// An eighth slot cannot exist, but a longer rack must still respect the array.
// The array bound is what protects us, not QUEUE_LIMIT: a shorter rack is
// rejected by index, and a longer one is allowed because the real rack is
// always seven and the caller owns that shape.
const nine = ["A", "B", "C", "D", "E", "F", "G", "H", "I"];
check("index past a 7-rack is rejected", enqueueLetter(full, 7, seven) === full, true);
check("valid index on a 9-slot array is accepted", enqueueLetter(full, 7, nine).length, QUEUE_LIMIT + 1);

// ── Hostile input ──────────────────────────────────────────────────────────
check("empty queue word", queuedWord([]), "");
check("prune with a short rack", pruneQueue(beforeShuffle, []).length, 0);

console.log(`\nscrabbleQueue: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);