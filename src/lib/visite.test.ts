import { describe, expect, it } from "vitest";
import type { ShowcaseTitle } from "./showcase";
import { aGarder, apresDuel, classement, cleTitre, ETAT_VIDE, pourCeSoir, prochainePaire, recommandations, versVisite, type EtatVisite } from "./visite";

// spec: specs/visite-interactive-v1.md

function titre(tmdbId: number, genres: string[], over: Partial<ShowcaseTitle> = {}): ShowcaseTitle {
  return {
    id: -(tmdbId * 2) - 1,
    name: `Titre ${tmdbId}`,
    year: "2020",
    type: "Movie",
    category: "Movie",
    genres,
    overview: "x",
    posterUrl: null,
    compatibility: null,
    reason: null,
    watchStatus: null,
    rating: null,
    voteAverage: 7,
    voteCount: 1000,
    trailer: null,
    availability: null,
    neighbours: [],
    runtime: null,
    directors: [],
    cast: [],
    suggestion: { tmdbId },
    ...over,
  };
}

describe("visite", () => {
  it("envoie chaque page de l'application au bon chapitre", () => {
    expect(versVisite("/library")).toBe("/visite#tri");
    expect(versVisite("/tri?famille=seen")).toBe("/visite#notation");
    expect(versVisite("/tri?famille=unseen")).toBe("/visite#tri");
    expect(versVisite("/classement?vue=personnes")).toBe("/visite#classement");
    expect(versVisite("/ce-soir")).toBe("/visite#ce-soir");
    expect(versVisite("/")).toBe("/");
  });

  it("fait gagner des points au vainqueur d'un duel, autant que le perdant en cède", () => {
    const e = apresDuel(ETAT_VIDE, "a", "b", "A");
    expect(e.elo.a).toBe(1516);
    expect(e.elo.b).toBe(1484);
    expect(e.duels).toHaveLength(1);
  });

  it("oppose d'abord deux titres de même note, puis ceux qui ont le moins combattu", () => {
    const etat: EtatVisite = { ...ETAT_VIDE, notes: { a: 5, b: 3, c: 5, d: 3 } };
    const paire = prochainePaire(etat);
    expect(paire && etat.notes[paire[0]] === etat.notes[paire[1]]).toBe(true);
    expect(prochainePaire({ ...ETAT_VIDE, notes: { a: 4 } })).toBeNull();
    expect(prochainePaire(ETAT_VIDE, ["x", "y"])).toEqual(["x", "y"]);
  });

  it("range par palier, puis par Elo", () => {
    let etat: EtatVisite = { ...ETAT_VIDE, notes: { a: 4, b: 4, c: 5, d: 0 } };
    etat = apresDuel(etat, "a", "b", "B");
    expect(classement(etat)).toEqual([
      { note: 5, cles: ["c"] },
      { note: 4, cles: ["b", "a"] },
      { note: 0, cles: ["d"] },
    ]);
  });

  it("recommande ce qui partage des genres avec les titres aimés, sans ce qui est déjà trié", () => {
    const aime = titre(1, ["Science Fiction", "Drama"]);
    const proche = titre(2, ["Science Fiction"]);
    const loin = titre(3, ["Comedy"]);
    const deja = titre(4, ["Science Fiction"]);
    const titres = new Map([aime, proche, loin, deja].map((t) => [cleTitre(t), t]));
    const etat: EtatVisite = { ...ETAT_VIDE, tri: { [cleTitre(aime)]: "vu", [cleTitre(deja)]: "pasvu" }, notes: { [cleTitre(aime)]: 5 } };
    const recos = recommandations(etat, [aime, proche, loin, deja], titres);
    expect(recos.map((r) => r.titre.suggestion?.tmdbId)).toEqual([2]);
    expect(recos[0].parce.name).toBe("Titre 1");
    expect(recommandations(ETAT_VIDE, [proche], titres)).toEqual([]);
  });

  it("propose ce soir tes envies d'abord, jamais un titre déjà vu", () => {
    const envie = titre(1, ["Comedy"]);
    const autre = titre(2, ["Comedy"]);
    const vu = titre(3, ["Comedy"]);
    const etat: EtatVisite = { ...ETAT_VIDE, tri: { [cleTitre(envie)]: "envie", [cleTitre(vu)]: "vu" } };
    expect(pourCeSoir(etat, [autre, vu, envie], "light").map((t) => t.suggestion?.tmdbId)).toEqual([1, 2]);
  });

  it("garde les titres vus et les envies, leurs notes et les duels entre titres notés", () => {
    const etat: EtatVisite = { tri: { a: "vu", b: "vu", c: "envie", d: "pasvu" }, notes: { a: 4, b: 5 }, duels: [{ a: "a", b: "b", gagnant: "B" }, { a: "a", b: "x", gagnant: "A" }], elo: {} };
    expect(aGarder(etat)).toEqual({ titres: ["a", "b", "c"], vus: 2, envies: 1, notes: 2, duels: 1 });
  });
});
