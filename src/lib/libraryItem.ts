/**
 * Modèle d'item partagé par les écrans qui manipulent la bibliothèque (bibliothèque,
 * recommandations) : mêmes champs, mêmes libellés de statut, mêmes règles de notation, pour que
 * les deux écrans se comportent exactement pareil.
 */

import type { Availability } from "./availability";
import type { ReleaseInfo } from "./release";
import type { Trailer } from "./trailer";

export type WatchStatus = "Watched" | "Unwatched";

export type Category = "Movie" | "TV Series" | "Documentary";

/** Lit une catégorie venue d'une URL ou d'un corps de requête ; toute autre valeur = aucune. */
export function parseCategory(value: unknown): Category | undefined {
  return value === "Movie" || value === "TV Series" || value === "Documentary" ? value : undefined;
}

export type LibraryItem = {
  id: number;
  name: string;
  year: string | null;
  type: "Movie" | "TV Series";
  category: Category;
  /** Genres TMDB, en anglais (affichés avec `genreLabel`, src/lib/genres.ts). */
  genres: string[];
  watchStatus: WatchStatus | null;
  posterUrl: string | null;
  rating: string | null;
  ressenti: string | null;
  eloScore: number | null;
  duelsCount: number;
  /** null = pas encore récupéré depuis TMDB, "" = récupéré mais aucun synopsis disponible. */
  overview: string | null;
  voteAverage: number | null;
  voteCount: number | null;
  /** Où le voir en France ; null si jamais récupéré (spec disponibilite-streaming-v1). */
  availability: Availability | null;
  /** Dates de sortie (sorties-v1 FR-1) : de quoi dire « au cinéma » ou « à venir ». */
  release: ReleaseInfo | null;
  /** Bande-annonce (bandes-annonces-v1) ; null si pas encore cherchée ou s'il n'y en a pas. */
  trailer: Trailer | null;
};

/** Modification applicable depuis une carte ou une fiche. */
export type ItemPatch = Partial<Pick<LibraryItem, "watchStatus" | "rating">>;

export const STATUS_META: Record<WatchStatus, { label: string; dot: string }> = {
  Watched: { label: "Vu", dot: "bg-success" },
  Unwatched: { label: "À voir", dot: "bg-subtle" },
};

/**
 * Noter implique avoir vu : on bascule le statut du même geste. Indispensable côté serveur aussi,
 * où une note posée sur un item non-vu est ignorée sauf si le passage à Watched est dans le
 * même appel (cf. updateItem).
 */
export function ratingPatch(item: LibraryItem, next: string | null): ItemPatch {
  const patch: ItemPatch = { rating: next };
  if (next !== null && item.watchStatus !== "Watched") patch.watchStatus = "Watched";
  return patch;
}
