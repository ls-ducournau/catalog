import { describe, expect, it } from "vitest";
import { composerAccueil, completer, DEMARRAGE_TITRES } from "./amorce";
import type { HomeShowcase, ShowcaseTitle } from "./showcase";
import type { TmdbSearchResult } from "./tmdb";
import { alternate, buildVitrine, suggestionId, titleKey, withoutOwned, type Vitrine } from "./vitrine";

// spec: specs/accueil-vitrine-connexion-v1.md (§ 2, § 3, § 6).

function tmdb(tmdbId: number, over: Partial<TmdbSearchResult> = {}): TmdbSearchResult {
  return {
    tmdbId,
    type: "Movie",
    isDocumentary: false,
    genres: ["Comedy"],
    title: `Titre ${tmdbId}`,
    year: "2026",
    posterPath: `/p${tmdbId}.jpg`,
    voteAverage: 7.5,
    voteCount: 1000,
    overview: "Un synopsis.",
    ...over,
  };
}

function mine(id: number): ShowcaseTitle {
  return {
    id,
    name: `Mien ${id}`,
    year: "2020",
    type: "Movie",
    category: "Movie",
    genres: ["Comedy"],
    overview: "x",
    posterUrl: "https://image.tmdb.org/t/p/w500/x.jpg",
    compatibility: null,
    reason: null,
    watchStatus: "Unwatched",
    rating: null,
    voteAverage: 7,
    voteCount: 500,
    trailer: null,
    availability: null,
    neighbours: [],
    runtime: null,
    directors: [],
    cast: [],
  };
}

function preview(over: Partial<HomeShowcase> = {}): HomeShowcase {
  return {
    moods: [],
    featured: [],
    picks: [],
    profile: null,
    pileGenres: {},
    lists: [],
    stats: { total: 0, watched: 0, toWatch: 0, categories: [], ratings: [0, 0, 0, 0, 0, 0] },
    ...over,
  };
}

const sources = {
  trending: Array.from({ length: 14 }, (_, i) => tmdb(100 + i)),
  cinema: [tmdb(200, { genres: ["Thriller"] }), tmdb(201, { genres: ["Drama"] })],
  topRated: [tmdb(300, { type: "TV Series", genres: ["Drama"] }), tmdb(301, { voteCount: 12 })],
  famous: Array.from({ length: 15 }, (_, i) => tmdb(400 + i)),
};

describe("vitrine", () => {
  it("donne aux suggestions un identifiant négatif, distinct entre film et série", () => {
    expect(suggestionId("Movie", 7)).toBeLessThan(0);
    expect(suggestionId("Movie", 7)).not.toBe(suggestionId("TV Series", 7));
    expect(suggestionId("Movie", 0)).toBeLessThan(0);
  });

  it("alterne deux listes sans en perdre", () => {
    expect(alternate([1, 2, 3], [9])).toEqual([1, 9, 2, 3]);
  });

  it("range les tendances par envie, en listes et à la une, sans titre sans affiche ni synopsis", () => {
    const v = buildVitrine({ ...sources, trending: [...sources.trending, tmdb(999, { posterPath: null }), tmdb(998, { overview: " " })] });
    expect(v.picks).toHaveLength(10);
    expect(v.picks.every((t) => t.suggestion && t.id < 0)).toBe(true);
    expect(v.picks.some((t) => t.suggestion?.tmdbId === 999 || t.suggestion?.tmdbId === 998)).toBe(false);
    expect(v.lists.map((t) => t.value)).toEqual(["trending", "cinema", "top"]);
    // Les mieux notés : au moins 300 votes.
    expect(v.lists.find((t) => t.value === "top")?.titles.map((t) => t.suggestion?.tmdbId)).toEqual([300]);
    const light = v.moods.find((t) => t.value === "light");
    expect(light?.titles).toHaveLength(8);
    expect(v.moods.find((t) => t.value === "intense")?.titles.map((t) => t.suggestion?.tmdbId)).toEqual([200]);
    expect(v.rating).toHaveLength(12);
  });

  it("retire ce que la bibliothèque contient déjà", () => {
    const v = buildVitrine(sources);
    const sans = withoutOwned(v, new Set([titleKey("Movie", 100), titleKey("Movie", 200)]));
    expect(sans.picks.some((t) => t.suggestion?.tmdbId === 100)).toBe(false);
    expect(sans.moods.some((t) => t.value === "intense")).toBe(false);
    expect(withoutOwned(v, new Set())).toBe(v);
    expect(withoutOwned(v, new Set([titleKey("Movie", 400)])).rating.some((t) => t.suggestion?.tmdbId === 400)).toBe(false);
  });
});

describe("composerAccueil", () => {
  const vitrine: Vitrine = buildVitrine(sources);

  it("montre la vitrine seule à un visiteur", () => {
    const c = composerAccueil(null, vitrine, null);
    expect(c.visiteur).toBe(true);
    expect(c.picks).toBe(vitrine.picks);
    // Pas d'onglet « Tendances » en double avec « À la une ».
    expect(c.lists.map((t) => t.value)).toEqual(["cinema", "top"]);
  });

  it("complète une bibliothèque qui démarre : ses titres d'abord", () => {
    const own = preview({ picks: [mine(1), mine(2)], moods: [{ value: "light", label: "Léger", titles: [mine(1)] }], lists: [{ value: "recent", label: "Derniers ajouts", titles: [mine(1)] }] });
    const c = composerAccueil(own, vitrine, 3);
    expect(c.demarrage).toBe(true);
    expect(c.picks.slice(0, 2).map((t) => t.id)).toEqual([1, 2]);
    expect(c.picks).toHaveLength(10);
    expect(c.moods[0].titles[0].id).toBe(1);
    expect(c.moods[0].titles).toHaveLength(8);
    expect(c.lists.map((t) => t.value)).toEqual(["recent", "suggestions"]);
  });

  it("laisse l'accueil d'une bibliothèque garnie à l'identique", () => {
    const own = preview({ picks: [mine(1)], moods: [{ value: "light", label: "Léger", titles: [mine(1)] }], lists: [{ value: "recent", label: "Derniers ajouts", titles: [mine(1)] }] });
    const c = composerAccueil(own, vitrine, DEMARRAGE_TITRES);
    expect(c.demarrage).toBe(false);
    expect(c.picks).toBe(own.picks);
    expect(c.moods).toBe(own.moods);
    expect(c.lists).toBe(own.lists);
  });

  it("remplit une section vide plutôt que de la cacher, même garnie", () => {
    const c = composerAccueil(preview(), vitrine, 500);
    expect(c.picks).toHaveLength(10);
    expect(c.lists).toBe(vitrine.lists);
    expect(c.moods.length).toBeGreaterThan(0);
  });

  it("ne complète jamais avec un titre déjà montré", () => {
    expect(completer([mine(1)], [mine(1), mine(2)], 3, true).map((t) => t.id)).toEqual([1, 2]);
  });
});

describe("seuils", () => {
  it("annonce le même nombre de notes que le modèle de préférence", async () => {
    const { MIN_RATED_TITLES } = await import("./preferenceService");
    const { NOTES_POUR_RECOS } = await import("./amorce");
    expect(NOTES_POUR_RECOS).toBe(MIN_RATED_TITLES);
  });
});
