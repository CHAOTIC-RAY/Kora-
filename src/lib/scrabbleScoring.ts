export type ScrabblePremiumType = "TWS" | "DWS" | "TLS" | "DLS" | null;

export interface ScrabbleCpuPlacement {
  r: number;
  c: number;
  letter: string;
}

export interface ScrabbleCpuScoreResult {
  baseWordScore: number;
  wordMultiplier: number;
  bingoBonus: number;
  total: number;
}

/**
 * Scores the CPU's main word with standard letter/word premiums.
 *
 * The word score includes every character in the completed word, including
 * letters already on the board. Premiums apply only to newly placed tiles.
 * This avoids comparing letters by value/identity, which breaks repeated
 * letters (for example, playing a new E when the word already contains E).
 */
export function scoreScrabbleCpuWord(
  word: string,
  placements: readonly ScrabbleCpuPlacement[],
  tileValues: Readonly<Record<string, number>>,
  premiumAt: (row: number, column: number) => ScrabblePremiumType
): ScrabbleCpuScoreResult {
  const normalizedWord = word.toUpperCase();
  let baseWordScore = [...normalizedWord].reduce(
    (sum, letter) => sum + (tileValues[letter] ?? 1),
    0
  );
  let wordMultiplier = 1;

  for (const placement of placements) {
    const letter = placement.letter.toUpperCase();
    const value = tileValues[letter] ?? 1;
    switch (premiumAt(placement.r, placement.c)) {
      case "TLS":
        baseWordScore += value * 2;
        break;
      case "DLS":
        baseWordScore += value;
        break;
      case "TWS":
        wordMultiplier *= 3;
        break;
      case "DWS":
        wordMultiplier *= 2;
        break;
      default:
        break;
    }
  }

  const bingoBonus = placements.length === 7 ? 50 : 0;
  return {
    baseWordScore,
    wordMultiplier,
    bingoBonus,
    total: baseWordScore * wordMultiplier + bingoBonus,
  };
}
