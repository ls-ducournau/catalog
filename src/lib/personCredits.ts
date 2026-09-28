import type { TmdbFeatures, TmdbPerson } from "./tmdb";

// Rôles d'une personne dans un titre, partagés par le tri rapide et la vue Personnes.

export type PersonRole = "cast" | "director" | "producer";

/** Toutes les personnes créditées d'un titre, par rôle (tri-rapide FR-9 : production comprise). */
export function creditsOf(features: TmdbFeatures): [PersonRole, TmdbPerson[]][] {
  return [
    ["cast", features.cast],
    ["director", features.directors],
    ["producer", features.producers ?? []],
  ];
}
