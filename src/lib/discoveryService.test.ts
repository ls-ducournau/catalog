import { describe, expect, it } from "vitest";
import { discoveryRows, mergeDiscoveries, type DiscoveredItem } from "./discoveryService";
import type { TmdbSearchResult } from "./tmdb";

// spec: specs/recommendations-v1.md — AC-12, AC-13, AC-14 (amendements v1.2)

function result(overrides: Partial<TmdbSearchResult> & { tmdbId: number }): TmdbSearchResult {
  return {
    type: "Movie",
    isDocumentary: false,
    genres: [],
    title: `Titre ${overrides.tmdbId}`,
    year: "2020",
    posterPath: null,
    voteAverage: 7,
    voteCount: 5000,
    overview: "",
    ...overrides,
  };
}

const seedA = { tmdbId: 1, type: "Movie" as const, name: "Whiplash" };
const seedB = { tmdbId: 2, type: "Movie" as const, name: "Sicario" };

describe("mergeDiscoveries", () => {
  it("écarte les titres déjà en bibliothèque (AC-12)", () => {
    const batches = [{ seed: seedA, results: [result({ tmdbId: 10 }), result({ tmdbId: 11 })] }];

    const merged = mergeDiscoveries(batches, { excludeTmdbIds: new Set([10]) });
    expect(merged.map((m) => m.tmdbId)).toEqual([11]);
  });

  it("classe un titre issu de deux semences avant un titre très populaire issu d'une seule (AC-13)", () => {
    const batches = [
      { seed: seedA, results: [result({ tmdbId: 10, voteCount: 800 })] },
      {
        seed: seedB,
        results: [result({ tmdbId: 10, voteCount: 800 }), result({ tmdbId: 20, voteCount: 90000 })],
      },
    ];

    const merged = mergeDiscoveries(batches, { excludeTmdbIds: new Set() });
    expect(merged.map((m) => m.tmdbId)).toEqual([10, 20]);
  });

  it("nomme les semences d'où vient un titre, sans doublon (AC-14)", () => {
    const batches = [
      { seed: seedA, results: [result({ tmdbId: 10 })] },
      { seed: seedB, results: [result({ tmdbId: 10 })] },
      { seed: seedB, results: [result({ tmdbId: 10 })] },
    ];

    const merged = mergeDiscoveries(batches, { excludeTmdbIds: new Set() });
    expect(merged[0].seeds).toEqual(["Whiplash", "Sicario"]);
  });

  it("écarte le confidentiel sous le plancher de votes", () => {
    const batches = [
      { seed: seedA, results: [result({ tmdbId: 10, voteCount: 5 }), result({ tmdbId: 11 })] },
    ];

    const merged = mergeDiscoveries(batches, { excludeTmdbIds: new Set(), minVoteCount: 120 });
    expect(merged.map((m) => m.tmdbId)).toEqual([11]);
  });

  it("applique la sémantique de catégorie de la bibliothèque", () => {
    const batches = [
      {
        seed: seedA,
        results: [
          result({ tmdbId: 10, type: "Movie", isDocumentary: false }),
          result({ tmdbId: 11, type: "Movie", isDocumentary: true }),
          result({ tmdbId: 12, type: "TV Series", isDocumentary: false }),
        ],
      },
    ];

    // Un film taggé documentaire appartient à Documentaire, pas à Film.
    expect(
      mergeDiscoveries(batches, { excludeTmdbIds: new Set(), category: "Movie" }).map((m) => m.tmdbId)
    ).toEqual([10]);
    expect(
      mergeDiscoveries(batches, { excludeTmdbIds: new Set(), category: "Documentary" }).map(
        (m) => m.tmdbId
      )
    ).toEqual([11]);
    expect(
      mergeDiscoveries(batches, { excludeTmdbIds: new Set(), category: "TV Series" }).map(
        (m) => m.tmdbId
      )
    ).toEqual([12]);
  });
});

// spec: specs/sorties-v1.md — AC-6
describe("discoveryRows", () => {
  function discovered(n: number, overrides: Partial<DiscoveredItem> = {}): DiscoveredItem {
    return {
      tmdbId: n,
      type: "Movie",
      title: `Titre ${n}`,
      year: "2015",
      posterUrl: null,
      voteAverage: 7,
      voteCount: 5000,
      isDocumentary: false,
      overview: "",
      seeds: ["Whiplash"],
      availability: null,
      compatibility: 0.5,
      release: null,
      runtime: 150,
      trailer: null,
      ...overrides,
    };
  }

  it("ne répète aucun titre d'une rangée à l'autre, et n'affiche pas de rangée de moins de 3", () => {
    const items = [
      ...Array.from({ length: 14 }, (_, i) => discovered(i + 1)),
      // Trois courts d'une même semence : « ce soir » et « parce que tu as adoré » se les disputent.
      ...[100, 101, 102].map((n) => discovered(n, { runtime: 95, seeds: ["Sicario"] })),
      // Deux titres récents seulement : pas de rangée « Sorties récentes ».
      ...[200, 201].map((n) => discovered(n, { year: "2026", runtime: 150 })),
    ];

    const rows = discoveryRows(items, { coveredServices: [], currentYear: 2026 });
    const keys = rows.flatMap((r) => r.keys);
    expect(new Set(keys).size).toBe(keys.length);
    expect(rows.every((r) => r.keys.length >= 3)).toBe(true);
    expect(rows[0].title).toBe("Le meilleur pour toi");
    expect(rows.some((r) => r.key === "recent")).toBe(false);
    expect(keys.every((k) => /^(Movie|TV Series):\d+$/.test(k))).toBe(true);
  });
});
