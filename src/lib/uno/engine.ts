import { canPlayCard, createUnoDeck, shuffleDeck } from "./deck";
import type {
  UnoCard,
  UnoColor,
  UnoDirection,
  UnoPlayer,
  UnoPublicGameState,
} from "./types";

export interface UnoFullGameState {
  publicState: UnoPublicGameState;
  deck: UnoCard[];
  discardPile: UnoCard[];
  hands: Record<string, UnoCard[]>;
}

export function initializeGame(
  roomCode: string,
  players: UnoPlayer[]
): UnoFullGameState {
  let deck = createUnoDeck();
  const hands: Record<string, UnoCard[]> = {};

  // Deal 7 cards to each player
  players.forEach((p) => {
    hands[p.id] = deck.splice(0, 7);
    p.cardCount = 7;
    p.hasCalledUno = false;
  });

  // Draw the first discard card (non-wild preferred)
  let topDiscard = deck.pop()!;
  while (topDiscard.color === "wild") {
    deck.unshift(topDiscard);
    deck = shuffleDeck(deck);
    topDiscard = deck.pop()!;
  }

  const publicState: UnoPublicGameState = {
    roomCode,
    phase: "playing",
    players,
    activePlayerIndex: 0,
    direction: "clockwise",
    topDiscard,
    currentColor: topDiscard.color,
    drawStackCount: 0,
    winnerId: null,
    turnDeadline: Date.now() + 30000,
    lastActionDescription: `${players[0]?.name || "Player 1"} starts the game.`,
  };

  return {
    publicState,
    deck,
    discardPile: [topDiscard],
    hands,
  };
}

export function getNextPlayerIndex(
  currentIndex: number,
  playerCount: number,
  direction: UnoDirection,
  step = 1
): number {
  if (playerCount <= 0) return 0;
  if (direction === "clockwise") {
    return (currentIndex + step) % playerCount;
  } else {
    return (currentIndex - step + playerCount * 100) % playerCount;
  }
}

/**
 * Handle playing a card from a player's hand.
 */
export function playCard(
  state: UnoFullGameState,
  playerId: string,
  cardId: string,
  chosenColor?: UnoColor
): { success: boolean; message: string; gameOver?: boolean } {
  const { publicState, hands, discardPile } = state;
  const player = publicState.players[publicState.activePlayerIndex];

  if (!player || player.id !== playerId) {
    return { success: false, message: "It's not your turn!" };
  }

  const hand = hands[playerId] || [];
  const cardIndex = hand.findIndex((c) => c.id === cardId);
  if (cardIndex === -1) {
    return { success: false, message: "Card not in hand!" };
  }

  const card = hand[cardIndex]!;
  if (!canPlayCard(card, publicState.topDiscard, publicState.currentColor)) {
    return { success: false, message: "Cannot play that card on the current pile!" };
  }

  // Remove card from player hand and push to discard pile
  hand.splice(cardIndex, 1);
  player.cardCount = hand.length;
  discardPile.push(card);
  publicState.topDiscard = card;

  // Determine active color
  if (card.color === "wild") {
    publicState.currentColor = chosenColor || "red";
  } else {
    publicState.currentColor = card.color;
  }

  // Check victory condition
  if (hand.length === 0) {
    publicState.phase = "game_over";
    publicState.winnerId = playerId;
    publicState.lastActionDescription = `🏆 ${player.name} played their last card and WON the game!`;
    return { success: true, message: "Victory!", gameOver: true };
  }

  // Handle Uno call status
  if (hand.length === 1 && !player.hasCalledUno) {
    // Player forgot or hasn't called Uno yet
  } else if (hand.length > 1) {
    player.hasCalledUno = false;
  }

  // Process Action Cards
  let step = 1;
  let actionDesc = `${player.name} played ${card.color.toUpperCase()} ${card.value.toUpperCase()}`;

  if (card.value === "reverse") {
    if (publicState.players.length === 2) {
      // In 2-player Uno, Reverse acts as a Skip
      step = 2;
      actionDesc += " (Direction stays, turn skipped!)";
    } else {
      publicState.direction =
        publicState.direction === "clockwise" ? "counter-clockwise" : "clockwise";
      actionDesc += ` (Direction reversed to ${publicState.direction})`;
    }
  } else if (card.value === "skip") {
    step = 2;
    actionDesc += " (Next player is skipped!)";
  } else if (card.value === "draw2") {
    const nextIdx = getNextPlayerIndex(
      publicState.activePlayerIndex,
      publicState.players.length,
      publicState.direction,
      1
    );
    const targetPlayer = publicState.players[nextIdx];
    if (targetPlayer) {
      drawCardsForPlayer(state, targetPlayer.id, 2);
      step = 2; // target player draws and their turn is skipped
      actionDesc += ` (${targetPlayer.name} draws 2 and misses turn!)`;
    }
  } else if (card.value === "wild4") {
    const nextIdx = getNextPlayerIndex(
      publicState.activePlayerIndex,
      publicState.players.length,
      publicState.direction,
      1
    );
    const targetPlayer = publicState.players[nextIdx];
    if (targetPlayer) {
      drawCardsForPlayer(state, targetPlayer.id, 4);
      step = 2; // target player draws 4 and misses turn
      actionDesc += ` (${targetPlayer.name} draws 4 and misses turn! Color: ${publicState.currentColor.toUpperCase()})`;
    }
  } else if (card.value === "wild") {
    actionDesc += ` (Color set to ${publicState.currentColor.toUpperCase()})`;
  }

  // Advance turn
  publicState.activePlayerIndex = getNextPlayerIndex(
    publicState.activePlayerIndex,
    publicState.players.length,
    publicState.direction,
    step
  );
  publicState.turnDeadline = Date.now() + 30000;
  publicState.lastActionDescription = actionDesc;

  return { success: true, message: actionDesc };
}

/**
 * Handle drawing card(s) from deck.
 */
export function drawCardsForPlayer(
  state: UnoFullGameState,
  playerId: string,
  count = 1
): UnoCard[] {
  const { deck, discardPile, hands, publicState } = state;
  const hand = hands[playerId] || [];
  const drawn: UnoCard[] = [];

  for (let i = 0; i < count; i++) {
    if (deck.length === 0) {
      // Reshuffle discard pile into deck, keeping top card
      if (discardPile.length <= 1) break;
      const top = discardPile.pop()!;
      state.deck = shuffleDeck(discardPile);
      state.discardPile = [top];
    }
    const card = state.deck.pop();
    if (card) {
      hand.push(card);
      drawn.push(card);
    }
  }

  const p = publicState.players.find((pl) => pl.id === playerId);
  if (p) {
    p.cardCount = hand.length;
    p.hasCalledUno = false;
  }

  return drawn;
}

/**
 * Pass turn after drawing.
 */
export function passTurn(state: UnoFullGameState, playerId: string): boolean {
  const { publicState } = state;
  const player = publicState.players[publicState.activePlayerIndex];
  if (!player || player.id !== playerId) return false;

  publicState.activePlayerIndex = getNextPlayerIndex(
    publicState.activePlayerIndex,
    publicState.players.length,
    publicState.direction,
    1
  );
  publicState.turnDeadline = Date.now() + 30000;
  publicState.lastActionDescription = `${player.name} passed their turn.`;
  return true;
}

/**
 * Call UNO! when down to 1 card.
 */
export function callUno(state: UnoFullGameState, playerId: string): boolean {
  const p = state.publicState.players.find((pl) => pl.id === playerId);
  const hand = state.hands[playerId];
  if (p && hand && hand.length <= 2) {
    p.hasCalledUno = true;
    state.publicState.lastActionDescription = `🔔 ${p.name} shouted "UNO!"`;
    return true;
  }
  return false;
}

/**
 * Catch an opponent with 1 card who forgot to call UNO! (+2 penalty)
 */
export function catchUno(
  state: UnoFullGameState,
  catcherId: string,
  targetId: string
): boolean {
  const target = state.publicState.players.find((p) => p.id === targetId);
  const catcher = state.publicState.players.find((p) => p.id === catcherId);
  const hand = state.hands[targetId];

  if (target && hand && hand.length === 1 && !target.hasCalledUno) {
    drawCardsForPlayer(state, targetId, 2);
    state.publicState.lastActionDescription = `🚨 ${catcher?.name || "Player"} caught ${target.name} not calling UNO! (+2 penalty cards)`;
    return true;
  }
  return false;
}

/**
 * AI Bot Turn Decision Heuristic.
 */
export function chooseCpuMove(
  hand: UnoCard[],
  topCard: UnoCard,
  activeColor: UnoColor
): { action: "play"; card: UnoCard; chosenColor?: UnoColor } | { action: "draw" } {
  // 1. Check playable non-wild cards
  const playableNormal = hand.filter(
    (c) => c.color !== "wild" && canPlayCard(c, topCard, activeColor)
  );

  // Pick action card if available (Skip / Draw2 / Reverse)
  const actionCard = playableNormal.find((c) =>
    ["draw2", "skip", "reverse"].includes(c.value)
  );
  if (actionCard) {
    return { action: "play", card: actionCard };
  }

  // Or highest score normal card
  if (playableNormal.length > 0) {
    playableNormal.sort((a, b) => b.scoreValue - a.scoreValue);
    return { action: "play", card: playableNormal[0]! };
  }

  // 2. Play Wildcard if available
  const wildCard = hand.find((c) => c.color === "wild");
  if (wildCard) {
    // Pick the color the bot has the most of in hand
    const colorCounts: Record<UnoColor, number> = {
      red: 0,
      blue: 0,
      green: 0,
      yellow: 0,
      wild: 0,
    };
    hand.forEach((c) => {
      if (c.color !== "wild") colorCounts[c.color]++;
    });
    const bestColor = (
      Object.keys(colorCounts) as UnoColor[]
    ).filter((k) => k !== "wild").sort((a, b) => colorCounts[b] - colorCounts[a])[0] || "red";

    return { action: "play", card: wildCard, chosenColor: bestColor };
  }

  // 3. Otherwise Draw
  return { action: "draw" };
}
