// Sélection de paires pour les duels — spec: specs/duels-elo-v1.md (FR-11, FR-12, EC-3)

export type EligibleItem = {
  id: number;
  duelsCount: number;
};

export const RECENT_PAIR_WINDOW = 50;
export const SMALL_POOL_THRESHOLD = 15;

function pairKey(idA: number, idB: number): string {
  return idA < idB ? `${idA}:${idB}` : `${idB}:${idA}`;
}

/** Poids de sélection inversement proportionnel au nombre de duels déjà disputés (FR-12). */
function weightFor(item: EligibleItem): number {
  return 1 / (item.duelsCount + 1);
}

function weightedPick<T extends EligibleItem>(pool: T[], rng: () => number): T {
  const totalWeight = pool.reduce((sum, item) => sum + weightFor(item), 0);
  let r = rng() * totalWeight;
  for (const item of pool) {
    r -= weightFor(item);
    if (r <= 0) return item;
  }
  return pool[pool.length - 1];
}

/**
 * Choisit une paire d'items éligibles pour un duel.
 * - Exclut les paires vues dans `recentPairs` (FR-11), sauf si le pool est trop petit
 *   pour l'éviter (EC-3), auquel cas la contrainte est assouplie automatiquement.
 * - Retourne null si moins de 2 items éligibles.
 */
export function pickPair(
  eligible: EligibleItem[],
  recentPairs: Set<string>,
  rng: () => number = Math.random
): { itemAId: number; itemBId: number } | null {
  if (eligible.length < 2) return null;

  const itemA = weightedPick(eligible, rng);

  const relaxRecentConstraint = eligible.length < SMALL_POOL_THRESHOLD;

  let candidatesB = eligible.filter(
    (item) =>
      item.id !== itemA.id &&
      (relaxRecentConstraint || !recentPairs.has(pairKey(itemA.id, item.id)))
  );

  // EC-3: si la contrainte anti-répétition élimine tous les candidats
  // (petit pool malgré tout), on l'assouplit plutôt que d'échouer.
  if (candidatesB.length === 0) {
    candidatesB = eligible.filter((item) => item.id !== itemA.id);
  }

  const itemB = weightedPick(candidatesB, rng);

  return { itemAId: itemA.id, itemBId: itemB.id };
}

export { pairKey };
