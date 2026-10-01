import type { UnoCard, UnoColor, UnoValue } from "./types";

/**
 * Standard 108-card Uno deck:
 * - 4 Colors: Red, Blue, Green, Yellow
 *   - One 0 per color (4 cards)
 *   - Two each of 1-9 per color (72 cards)
 *   - Two each of Skip, Reverse, Draw Two per color (24 cards)
 * - Wild cards:
 *   - 4 Wild cards (4 cards)
 *   - 4 Wild Draw Four cards (4 cards)
 * Total: 4 + 72 + 24 + 8 = 108 cards.
 */
export function createUnoDeck(): UnoCard[] {
  const deck: UnoCard[] = [];
  const colors: Exclude<UnoColor, "wild">[] = ["red", "blue", "green", "yellow"];

  let idCounter = 1;
  const makeCard = (color: UnoColor, value: UnoValue, score: number): UnoCard => ({
    id: `c_${idCounter++}_${color}_${value}`,
    color,
    value,
    scoreValue: score,
  });

  colors.forEach((color) => {
    // One 0 per color
    deck.push(makeCard(color, "0", 0));
    // Two of 1-9 per color
    for (let num = 1; num <= 9; num++) {
      const v = String(num) as UnoValue;
      deck.push(makeCard(color, v, num));
      deck.push(makeCard(color, v, num));
    }
    // Action cards: 2 each
    for (let i = 0; i < 2; i++) {
      deck.push(makeCard(color, "skip", 20));
      deck.push(makeCard(color, "reverse", 20));
      deck.push(makeCard(color, "draw2", 20));
    }
  });

  // 4 Wild, 4 Wild Draw Four
  for (let i = 0; i < 4; i++) {
    deck.push(makeCard("wild", "wild", 50));
    deck.push(makeCard("wild", "wild4", 50));
  }

  return shuffleDeck(deck);
}

export function shuffleDeck<T>(array: T[]): T[] {
  const copy = [...array];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = copy[i]!;
    copy[i] = copy[j]!;
    copy[j] = temp;
  }
  return copy;
}

/**
 * Checks whether a card can legally be played on top of the current discard.
 */
export function canPlayCard(card: UnoCard, topCard: UnoCard, activeColor: UnoColor): boolean {
  if (card.color === "wild") return true;
  if (card.color === activeColor) return true;
  if (card.value === topCard.value && card.value !== "wild" && card.value !== "wild4") return true;
  return false;
}

/**
 * Helper to get card color classes for styling.
 */
export function getCardColorStyle(color: UnoColor): {
  bg: string;
  border: string;
  badge: string;
  text: string;
} {
  switch (color) {
    case "red":
      return {
        bg: "bg-red-600",
        border: "border-red-400",
        badge: "bg-red-700",
        text: "text-red-500",
      };
    case "blue":
      return {
        bg: "bg-blue-600",
        border: "border-blue-400",
        badge: "bg-blue-700",
        text: "text-blue-500",
      };
    case "green":
      return {
        bg: "bg-emerald-600",
        border: "border-emerald-400",
        badge: "bg-emerald-700",
        text: "text-emerald-500",
      };
    case "yellow":
      return {
        bg: "bg-amber-500",
        border: "border-amber-300",
        badge: "bg-amber-600",
        text: "text-amber-500",
      };
    case "wild":
      return {
        bg: "bg-gradient-to-br from-rose-500 via-amber-500 to-indigo-600",
        border: "border-purple-300",
        badge: "bg-black/60",
        text: "text-purple-400",
      };
  }
}
