/**
 * Unit Tests for Kora Uno (Wildcard Clash) rules, deck generation, and engine state.
 */

import { canPlayCard, createUnoDeck } from "../uno/deck";
import {
  chooseCpuMove,
  drawCardsForPlayer,
  getNextPlayerIndex,
  initializeGame,
  passTurn,
  playCard,
} from "../uno/engine";
import type { UnoCard, UnoPlayer } from "../uno/types";

let pass = 0;
let fail = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    pass++;
    console.log("PASS ", name);
  } catch (e) {
    fail++;
    console.log("FAIL ", name, "—", e instanceof Error ? e.message : e);
  }
}

function eq(actual: unknown, expected: unknown, msg = "") {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error(`${msg} expected ${b}, got ${a}`);
}

function ok(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg);
}

// 1. Deck Count & Composition
test("Deck contains exactly 108 cards", () => {
  const deck = createUnoDeck();
  eq(deck.length, 108, "Total cards");

  const colors = { red: 0, blue: 0, green: 0, yellow: 0, wild: 0 };
  deck.forEach((c) => colors[c.color]++);

  eq(colors.red, 25, "Red cards count");
  eq(colors.blue, 25, "Blue cards count");
  eq(colors.green, 25, "Green cards count");
  eq(colors.yellow, 25, "Yellow cards count");
  eq(colors.wild, 8, "Wild cards count (4 wild + 4 wild4)");
});

// 2. Play Validation
test("Card play legality rules", () => {
  const red5: UnoCard = { id: "1", color: "red", value: "5", scoreValue: 5 };
  const red7: UnoCard = { id: "2", color: "red", value: "7", scoreValue: 7 };
  const blue5: UnoCard = { id: "3", color: "blue", value: "5", scoreValue: 5 };
  const green9: UnoCard = { id: "4", color: "green", value: "9", scoreValue: 9 };
  const wild: UnoCard = { id: "5", color: "wild", value: "wild", scoreValue: 50 };

  // Matching color
  ok(canPlayCard(red7, red5, "red"), "Same color can be played");
  // Matching value
  ok(canPlayCard(blue5, red5, "red"), "Same value different color can be played");
  // Wild can always be played
  ok(canPlayCard(wild, red5, "red"), "Wild can be played on anything");
  // Non-matching rejected
  ok(!canPlayCard(green9, red5, "red"), "Different color and value rejected");
});

// 3. Direction and Next Player indexing
test("Direction and turn rotation", () => {
  eq(getNextPlayerIndex(0, 4, "clockwise", 1), 1, "Clockwise step 1");
  eq(getNextPlayerIndex(3, 4, "clockwise", 1), 0, "Clockwise wrap-around");
  eq(getNextPlayerIndex(0, 4, "counter-clockwise", 1), 3, "Counter-clockwise step 1");
  eq(getNextPlayerIndex(0, 4, "clockwise", 2), 2, "Skip 1 player clockwise");
});

// 4. Initial Game State Setup
test("Game initialization deals 7 cards and sets valid start card", () => {
  const players: UnoPlayer[] = [
    { id: "p1", name: "Alice", isHost: true, isCpu: false, avatarSeed: "a", cardCount: 0, hasCalledUno: false },
    { id: "p2", name: "Bob", isHost: false, isCpu: true, avatarSeed: "b", cardCount: 0, hasCalledUno: false },
  ];

  const state = initializeGame("TEST_ROOM", players);
  eq(state.hands["p1"]?.length, 7, "Player 1 has 7 cards");
  eq(state.hands["p2"]?.length, 7, "Player 2 has 7 cards");
  ok(state.publicState.topDiscard.color !== "wild", "Start discard card is not wild");
  eq(state.publicState.phase, "playing", "Phase is playing");
});

// 5. Action Cards & Turns
test("Skip card skips opponent turn", () => {
  const players: UnoPlayer[] = [
    { id: "p1", name: "Alice", isHost: true, isCpu: false, avatarSeed: "a", cardCount: 2, hasCalledUno: false },
    { id: "p2", name: "Bob", isHost: false, isCpu: true, avatarSeed: "b", cardCount: 2, hasCalledUno: false },
    { id: "p3", name: "Charlie", isHost: false, isCpu: true, avatarSeed: "c", cardCount: 2, hasCalledUno: false },
  ];

  const state = initializeGame("TEST_SKIP", players);
  const skipCard: UnoCard = { id: "skip_1", color: "red", value: "skip", scoreValue: 20 };
  const extraCard: UnoCard = { id: "extra_1", color: "blue", value: "1", scoreValue: 1 };
  state.hands["p1"] = [skipCard, extraCard];
  state.publicState.currentColor = "red";
  state.publicState.topDiscard = { id: "top_1", color: "red", value: "2", scoreValue: 2 };

  const result = playCard(state, "p1", "skip_1");
  ok(result.success, "Played skip card");
  // Active player should now be Charlie (index 2), skipping Bob (index 1)
  eq(state.publicState.activePlayerIndex, 2, "Bob was skipped, Charlie is active");
});

// 6. Victory Condition
test("Playing last card triggers game_over", () => {
  const players: UnoPlayer[] = [
    { id: "p1", name: "Alice", isHost: true, isCpu: false, avatarSeed: "a", cardCount: 1, hasCalledUno: true },
    { id: "p2", name: "Bob", isHost: false, isCpu: true, avatarSeed: "b", cardCount: 5, hasCalledUno: false },
  ];

  const state = initializeGame("TEST_WIN", players);
  const winCard: UnoCard = { id: "win_1", color: "red", value: "7", scoreValue: 7 };
  state.hands["p1"] = [winCard];
  state.publicState.currentColor = "red";
  state.publicState.topDiscard = { id: "top_1", color: "red", value: "2", scoreValue: 2 };

  const result = playCard(state, "p1", "win_1");
  ok(result.success, "Played last card");
  eq(state.publicState.phase, "game_over", "Phase transitions to game_over");
  eq(state.publicState.winnerId, "p1", "Alice is crowned winner");
});

// 6. CPU Heuristic Check
test("CPU Bot picks playable card or decides to draw", () => {
  const topCard: UnoCard = { id: "top", color: "green", value: "3", scoreValue: 3 };
  const handWithPlayable: UnoCard[] = [
    { id: "c1", color: "red", value: "8", scoreValue: 8 },
    { id: "c2", color: "green", value: "5", scoreValue: 5 },
  ];

  const move = chooseCpuMove(handWithPlayable, topCard, "green");
  eq(move.action, "play", "Bot chooses to play");
  if (move.action === "play") {
    eq(move.card.id, "c2", "Bot picked green card");
  }

  const handWithoutPlayable: UnoCard[] = [
    { id: "c1", color: "red", value: "8", scoreValue: 8 },
    { id: "c2", color: "blue", value: "5", scoreValue: 5 },
  ];
  const drawMove = chooseCpuMove(handWithoutPlayable, topCard, "green");
  eq(drawMove.action, "draw", "Bot chooses to draw when no cards match");
});

console.log(`\nUno Rules Test Results: ${pass} passed, ${fail} failed.\n`);
if (fail > 0) process.exit(1);
