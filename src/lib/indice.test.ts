import { describe, expect, it } from "vitest";
import { prochainIndice } from "./indice";

describe("indice du geste", () => {
  it("joue 1 s après l'arrivée, puis à 8, 16 et 32 s d'écart, et s'arrête", () => {
    expect([0, 1, 2, 3, 4].map(prochainIndice)).toEqual([1000, 8000, 16000, 32000, null]);
  });
});
