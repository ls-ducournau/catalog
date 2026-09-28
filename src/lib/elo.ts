// Moteur Elo — spec: specs/duels-elo-v1.md (FR-8, AC-4)

export const DEFAULT_ELO = 1200;
export const K_FACTOR = 32;

export type EloResult = {
  eloAAfter: number;
  eloBAfter: number;
};

function expectedScore(ratingSelf: number, ratingOpponent: number): number {
  return 1 / (1 + Math.pow(10, (ratingOpponent - ratingSelf) / 400));
}

/**
 * Recalcule les scores Elo de deux items après un duel.
 * winner: "A" ou "B". Ne pas appeler pour un skip (FR-9) — aucun recalcul dans ce cas.
 */
export function computeElo(eloA: number, eloB: number, winner: "A" | "B"): EloResult {
  const expectedA = expectedScore(eloA, eloB);
  const expectedB = expectedScore(eloB, eloA);
  const scoreA = winner === "A" ? 1 : 0;
  const scoreB = winner === "B" ? 1 : 0;

  const eloAAfter = eloA + K_FACTOR * (scoreA - expectedA);
  const eloBAfter = eloB + K_FACTOR * (scoreB - expectedB);

  return { eloAAfter, eloBAfter };
}
