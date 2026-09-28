import { describe, expect, it } from "vitest";
import { pickPair, pairKey, RECENT_PAIR_WINDOW, SMALL_POOL_THRESHOLD } from "./pairSelection";

describe("pickPair", () => {
  // AC-2: moins de 2 items éligibles -> pas de paire
  it("retourne null avec moins de 2 items", () => {
    expect(pickPair([{ id: 1, duelsCount: 0 }], new Set())).toBeNull();
    expect(pickPair([], new Set())).toBeNull();
  });

  it("retourne toujours deux items distincts", () => {
    const eligible = [
      { id: 1, duelsCount: 0 },
      { id: 2, duelsCount: 0 },
    ];
    const pair = pickPair(eligible, new Set());
    expect(pair).not.toBeNull();
    expect(pair!.itemAId).not.toBe(pair!.itemBId);
  });

  // AC-7: pool >= 15, une paire récente ne doit pas être re-proposée
  it("évite une paire récente quand le pool est assez grand", () => {
    const eligible = Array.from({ length: 16 }, (_, i) => ({ id: i + 1, duelsCount: 0 }));
    expect(eligible.length).toBeGreaterThanOrEqual(SMALL_POOL_THRESHOLD);

    const recent = new Set([pairKey(1, 2)]);
    // rng fixé pour forcer le tirage de l'item 1 en position A à chaque appel
    const rng = () => 0; // weightedPick prend le premier élément du pool (poids égaux)

    for (let i = 0; i < 20; i++) {
      const pair = pickPair(eligible, recent, rng);
      expect(pair).not.toBeNull();
      const isForbiddenPair =
        (pair!.itemAId === 1 && pair!.itemBId === 2) ||
        (pair!.itemAId === 2 && pair!.itemBId === 1);
      expect(isForbiddenPair).toBe(false);
    }
  });

  // EC-3: pool trop petit pour éviter indéfiniment les répétitions -> contrainte assouplie
  it("assouplit la contrainte anti-répétition si le pool est trop petit", () => {
    const eligible = [
      { id: 1, duelsCount: 0 },
      { id: 2, duelsCount: 0 },
    ];
    // La seule paire possible est (1,2), déjà "récente" : sans assouplissement, pickPair échouerait.
    const recent = new Set([pairKey(1, 2)]);
    const pair = pickPair(eligible, recent, () => 0);
    expect(pair).not.toBeNull();
  });

  // AC-8: un item avec 0 duel doit être choisi significativement plus souvent
  // qu'un item avec un historique de duels important.
  it("favorise statistiquement les items avec le moins de duels", () => {
    const eligible = [
      { id: 1, duelsCount: 0 },
      { id: 2, duelsCount: 40 },
      { id: 3, duelsCount: 40 },
      { id: 4, duelsCount: 40 },
    ];

    let pickedAsA_item1 = 0;
    let pickedAsA_others = 0;
    const trials = 5000;

    for (let i = 0; i < trials; i++) {
      const pair = pickPair(eligible, new Set(), Math.random);
      if (pair!.itemAId === 1) pickedAsA_item1++;
      else pickedAsA_others++;
    }

    // item 1 (poids 1) vs 3 items à poids 1/41 chacun (poids total adverse ~3/41)
    // item 1 doit représenter une large majorité des tirages en position A.
    expect(pickedAsA_item1).toBeGreaterThan(pickedAsA_others);
  });

  it("respecte une fenêtre de rappel de 50 duels (constante de spec)", () => {
    expect(RECENT_PAIR_WINDOW).toBe(50);
  });
});
