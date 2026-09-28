import { describe, expect, it } from "vitest";
import { computeElo, DEFAULT_ELO, K_FACTOR } from "./elo";

describe("computeElo", () => {
  // AC-4: deux items à 1200/1200, l'item 1 gagne -> 1216 / 1184 (K=32)
  it("applique le gain/perte attendu pour deux scores égaux", () => {
    const { eloAAfter, eloBAfter } = computeElo(1200, 1200, "A");
    expect(eloAAfter).toBeCloseTo(1216, 5);
    expect(eloBAfter).toBeCloseTo(1184, 5);
  });

  it("est symétrique quand B gagne", () => {
    const { eloAAfter, eloBAfter } = computeElo(1200, 1200, "B");
    expect(eloAAfter).toBeCloseTo(1184, 5);
    expect(eloBAfter).toBeCloseTo(1216, 5);
  });

  it("fait gagner moins de points au favori qui bat un outsider", () => {
    const { eloAAfter } = computeElo(1400, 1000, "A");
    const gain = eloAAfter - 1400;
    expect(gain).toBeGreaterThan(0);
    expect(gain).toBeLessThan(K_FACTOR / 2);
  });

  it("fait perdre beaucoup de points au favori qui perd contre un outsider", () => {
    const { eloAAfter } = computeElo(1400, 1000, "B");
    const loss = 1400 - eloAAfter;
    expect(loss).toBeGreaterThan(K_FACTOR / 2);
  });

  it("conserve la somme totale des scores (jeu à somme nulle)", () => {
    const { eloAAfter, eloBAfter } = computeElo(1350, 1180, "A");
    expect(eloAAfter + eloBAfter).toBeCloseTo(1350 + 1180, 5);
  });

  it("expose un score initial par défaut à 1200 (AC-3)", () => {
    expect(DEFAULT_ELO).toBe(1200);
  });
});
