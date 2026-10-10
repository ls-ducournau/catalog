import { describe, expect, it } from "vitest";
import { closeTo, formatMinutes } from "./format";

// Audit UX 2026-10-09 (W1-8, W2-11).
describe("formatMinutes", () => {
  it("ne se coupe jamais : espaces insécables", () => {
    expect(formatMinutes(65)).toBe("1 h 05");
    expect(formatMinutes(120)).toBe("2 h");
    expect(formatMinutes(45)).toBe("45 min");
  });
});

describe("closeTo", () => {
  it("contracte « de le » et « de les », comme en français", () => {
    expect(closeTo("Le Seigneur des anneaux")).toBe("Proche du Seigneur des anneaux");
    expect(closeTo("Les Visiteurs")).toBe("Proche des Visiteurs");
  });

  it("laisse les autres titres tels quels", () => {
    expect(closeTo("La Haine")).toBe("Proche de La Haine");
    expect(closeTo("L'Odyssée")).toBe("Proche de L'Odyssée");
    expect(closeTo("Breaking Bad")).toBe("Proche de Breaking Bad");
    expect(closeTo("Leon")).toBe("Proche de Leon");
  });
});
