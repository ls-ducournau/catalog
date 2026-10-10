import { describe, expect, it } from "vitest";
import { displayYear } from "./libraryItem";

// Audit UX 2026-10-09 (W1-4) : l'année telle qu'on la lit.
describe("displayYear", () => {
  it("garde une année seule", () => {
    expect(displayYear("2016")).toBe("2016");
  });

  it("met en forme une période, et la réduit quand elle tient en une année", () => {
    expect(displayYear("2013 - 2022")).toBe("2013–2022");
    expect(displayYear("2001 - 2001")).toBe("2001");
  });

  it("dit qu'une série est en cours", () => {
    expect(displayYear("2022 -")).toBe("depuis 2022");
    expect(displayYear("2022 - ")).toBe("depuis 2022");
  });

  it("rend null pour une année absente, et laisse passer une forme inconnue", () => {
    expect(displayYear(null)).toBeNull();
    expect(displayYear("  ")).toBeNull();
    expect(displayYear("vers 1990")).toBe("vers 1990");
  });
});
