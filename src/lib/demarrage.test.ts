import { describe, expect, it } from "vitest";
import { ajouterAuBout, aNoter, apresReponse, composerPaquet, estPrete, insererDansFile, OBJECTIF_NOTES, OBJECTIF_TITRES, prochainPalier, type CarteSwipe } from "./demarrage";
import type { ShowcaseTitle } from "./showcase";
import type { Vitrine } from "./vitrine";

function titre(id: number, over: Partial<ShowcaseTitle> = {}): ShowcaseTitle {
  return {
    id,
    name: `Titre ${id}`,
    year: "2024",
    type: "Movie",
    category: "Movie",
    genres: ["Drame"],
    overview: "Un synopsis.",
    posterUrl: `/p${id}.jpg`,
    compatibility: null,
    reason: null,
    watchStatus: null,
    rating: null,
    voteAverage: 7,
    voteCount: 100,
    trailer: null,
    availability: null,
    neighbours: [],
    runtime: null,
    directors: [],
    cast: [],
    ...over,
  } as ShowcaseTitle;
}

const carte = (n: number): CarteSwipe => ({
  cle: `Movie:${n}`,
  tmdbId: n,
  type: "Movie",
  category: "Movie",
  name: `Titre ${n}`,
  year: null,
  genres: [],
  overview: "",
  posterUrl: `/p${n}.jpg`,
  voteAverage: null,
});

describe("bienvenue", () => {
  it("alterne un titre très vu et un titre du moment, sans doublon ni affiche manquante", () => {
    const vitrine: Vitrine = {
      rating: [titre(1), titre(2), titre(3, { posterUrl: null })],
      picks: [titre(10), titre(1)],
      lists: [{ value: "cinema", label: "Au cinéma", titles: [titre(11)] }],
      moods: [],
    };
    expect(composerPaquet(vitrine).map((c) => c.tmdbId)).toEqual([1, 10, 2, 11]);
    expect(composerPaquet(vitrine, new Set(["Movie:1"])).map((c) => c.tmdbId)).toEqual([2, 10, 11]);
  });

  it("écarte des vitrines les talk-shows, l'actualité et la téléréalité", () => {
    const vitrine: Vitrine = {
      rating: [titre(1), titre(2, { genres: ["Talk"] })],
      picks: [titre(10, { genres: ["Reality", "Drame"] }), titre(11)],
      lists: [],
      moods: [],
    };
    expect(composerPaquet(vitrine).map((c) => c.tmdbId)).toEqual([1, 11]);
  });

  it("glisse les cartes de la découverte après les deux du dessus, une sur deux", () => {
    const file = [carte(1), carte(2), carte(3), carte(4)];
    const ordre = insererDansFile(file, [carte(20), carte(2), carte(21)], new Set(["Movie:21"])).map((c) => c.tmdbId);
    expect(ordre).toEqual([1, 2, 20, 3, 4]);
  });

  it("met la page suivante au bout de la file, sans les cartes déjà là ni déjà répondues", () => {
    const ordre = ajouterAuBout([carte(1), carte(2)], [carte(2), carte(3), carte(4)], new Set(["Movie:4"])).map((c) => c.tmdbId);
    expect(ordre).toEqual([1, 2, 3]);
  });

  it("remplit la jauge : un titre par geste gardé ; un « déjà vu » reste à noter", () => {
    let p = { titres: 0, notes: 0, vusSansNote: 0 };
    p = apresReponse(p, { kind: "envie" });
    p = apresReponse(p, { kind: "non" });
    p = apresReponse(p, { kind: "vu" });
    p = apresReponse(p, { kind: "vu" });
    expect(p).toEqual({ titres: 3, notes: 0, vusSansNote: 2 });
    expect(apresReponse(p, { kind: "vu" }, -1)).toEqual({ titres: 2, notes: 0, vusSansNote: 1 });
    expect(aNoter(p)).toBe(true);
    expect(aNoter({ ...p, vusSansNote: 0 })).toBe(false);
  });

  it("annonce le prochain palier, les titres d'abord", () => {
    expect(prochainPalier({ titres: 29, notes: 0, vusSansNote: 0 })).toBe("Encore 1 titre pour une bibliothèque bien remplie.");
    expect(prochainPalier({ titres: OBJECTIF_TITRES, notes: 8, vusSansNote: 4 })).toBe("Note encore 2 titres vus pour tes recommandations.");
    expect(prochainPalier({ titres: OBJECTIF_TITRES, notes: OBJECTIF_NOTES, vusSansNote: 0 })).toBeNull();
    expect(estPrete({ titres: OBJECTIF_TITRES, notes: OBJECTIF_NOTES, vusSansNote: 0 })).toBe(true);
  });
});
