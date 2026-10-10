// Clés et surfaces des impressions, partagées par le navigateur et le serveur
// — spec: specs/recommandations-fraicheur-v1.md (FR-1)

/** Les surfaces qui proposent des titres. */
export const SURFACES = ["pile", "discover", "tonight", "home", "triage"] as const;
export type Surface = (typeof SURFACES)[number];

/** Clé d'un titre de la bibliothèque : `item:12`. */
export const itemExposureKey = (id: number) => `item:${id}`;

/** Clé d'un titre hors bibliothèque : `tmdb:movie:603`, `tmdb:tv:1399` (cf. `tmdbKey`). */
export const tmdbExposureKey = (type: "Movie" | "TV Series", tmdbId: number) =>
  `tmdb:${type === "Movie" ? "movie" : "tv"}:${tmdbId}`;
