import { describe, expect, it } from "vitest";
import { composerPage } from "./cartesBienvenue";
import type { TmdbSearchResult } from "./tmdb";

const r = (tmdbId: number, type: "Movie" | "TV Series", over: Partial<TmdbSearchResult> = {}): TmdbSearchResult =>
  ({
    tmdbId,
    type,
    isDocumentary: false,
    genres: ["Drame"],
    title: `Titre ${tmdbId}`,
    year: "2026",
    posterPath: `/p${tmdbId}.jpg`,
    voteAverage: 7.5,
    voteCount: 1000,
    overview: "Un synopsis.",
    ...over,
  }) as TmdbSearchResult;

describe("cartes de bienvenue", () => {
  it("alterne très vus (deux films, une série) et populaires, sans doublon ni titre sans affiche", () => {
    const page = composerPage(
      [r(1, "Movie"), r(2, "Movie"), r(3, "Movie")],
      [r(10, "TV Series")],
      [r(1, "Movie"), r(20, "Movie"), r(21, "Movie", { posterPath: null })],
      [r(30, "Movie")],
      [r(40, "TV Series")]
    );
    // Même ordre que le test du serveur Rust (serveur/src/bienvenue.rs).
    expect(page.map((t) => `${t.type}:${t.suggestion?.tmdbId}`)).toEqual(["Movie:1", "Movie:2", "Movie:30", "TV Series:10", "Movie:20", "Movie:3", "TV Series:40"]);
  });
});
