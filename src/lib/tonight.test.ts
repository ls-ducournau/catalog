import { describe, expect, it } from "vitest";
import { DEFAULT_CONTEXT, matchesContext, mostRestrictive, parseContext, type TonightCandidate } from "./tonight";

// spec: specs/ce-soir-v2.md (AC-1 à AC-3, EC-1)

const film = (genres: string[], runtime: number | null = 110): TonightCandidate => ({
  type: "Movie",
  isDocumentary: false,
  genres,
  runtime,
});

describe("matchesContext", () => {
  it("« Léger » garde une comédie dramatique, pas un drame pur (AC-1)", () => {
    const light = { ...DEFAULT_CONTEXT, mood: "light" as const };
    expect(matchesContext(film(["Drama"]), light)).toBe(false);
    expect(matchesContext(film(["Comedy", "Drama"]), light)).toBe(true);
  });

  it("« En famille » exclut l'horreur et exige un genre familial (AC-2)", () => {
    const family = { ...DEFAULT_CONTEXT, company: "family" as const };
    expect(matchesContext(film(["Animation", "Horror"]), family)).toBe(false);
    expect(matchesContext(film(["Animation", "Family"]), family)).toBe(true);
    expect(matchesContext(film(["Thriller"]), family)).toBe(false);
  });

  it("n'applique la durée qu'aux films, et garde un film sans durée connue (AC-3)", () => {
    const short = { ...DEFAULT_CONTEXT, maxMinutes: 90 };
    expect(matchesContext(film(["Drama"], 130), short)).toBe(false);
    expect(matchesContext({ type: "TV Series", isDocumentary: false, genres: ["Drama"], runtime: 50 }, short)).toBe(true);
    expect(matchesContext(film(["Drama"], null), short)).toBe(true);
  });

  it("range un documentaire à part des films et des séries", () => {
    const doc: TonightCandidate = { type: "Movie", isDocumentary: true, genres: ["Documentary"], runtime: 90 };
    expect(matchesContext(doc, { ...DEFAULT_CONTEXT, format: "Movie" })).toBe(false);
    expect(matchesContext(doc, { ...DEFAULT_CONTEXT, format: "Documentary" })).toBe(true);
    expect(matchesContext(doc, { ...DEFAULT_CONTEXT, mood: "think" })).toBe(true);
  });

  it("un genre précis s'ajoute à l'envie ; un documentaire vaut « Documentary »", () => {
    const western = { ...DEFAULT_CONTEXT, genre: "Western" };
    expect(matchesContext(film(["Western", "Drama"]), western)).toBe(true);
    expect(matchesContext(film(["Drama"]), western)).toBe(false);
    expect(matchesContext(film(["Western"]), { ...western, mood: "light" })).toBe(false);
    const doc: TonightCandidate = { type: "Movie", isDocumentary: true, genres: [], runtime: 90 };
    expect(matchesContext(doc, { ...DEFAULT_CONTEXT, genre: "Documentary" })).toBe(true);
  });
});

describe("mostRestrictive (EC-1)", () => {
  it("désigne le réglage dont le relâchement rend le plus de titres", () => {
    const candidates = [film(["Drama"], 150), film(["Drama"], 140), film(["Comedy"], 150)];
    const context = { ...DEFAULT_CONTEXT, mood: "light" as const, maxMinutes: 90 };
    // Relâcher la durée rend la comédie (1) ; relâcher l'envie ne rend rien (tous trop longs).
    expect(mostRestrictive(candidates, context)).toBe("maxMinutes");
  });

  it("propose de retirer le genre quand c'est lui qui vide la soirée", () => {
    const candidates = [film(["Drama"]), film(["Comedy"])];
    expect(mostRestrictive(candidates, { ...DEFAULT_CONTEXT, genre: "Western" })).toBe("genre");
  });

  it("ne désigne rien quand aucun réglage ne filtre", () => {
    expect(mostRestrictive([film(["Drama"])], DEFAULT_CONTEXT)).toBeNull();
  });
});

describe("parseContext", () => {
  it("garde les réglages valides et remplace les autres par leur défaut", () => {
    expect(parseContext({ mood: "intense", format: "Série", maxMinutes: "120", source: "catalog" })).toEqual({
      ...DEFAULT_CONTEXT,
      mood: "intense",
      maxMinutes: 120,
      source: "catalog",
    });
  });

  it("playlists-v2 FR-8 : lit la source « playlist » et sa playlist ; sans playlist, revient à la pile", () => {
    expect(parseContext({ source: "playlist", playlistId: "7" })).toMatchObject({ source: "playlist", playlistId: 7 });
    expect(parseContext({ source: "playlist" })).toMatchObject({ source: "pile", playlistId: null });
    expect(parseContext({ source: "pile", playlistId: "7" })).toMatchObject({ source: "pile", playlistId: null });
  });

  it("lit un genre, et ignore un genre vide", () => {
    expect(parseContext({ genre: "Western" }).genre).toBe("Western");
    expect(parseContext({ genre: "  " }).genre).toBeNull();
    expect(parseContext({}).genre).toBeNull();
  });
});
