import type { Availability } from "./availability";
import type { TitleData } from "./tmdb";
import type { Trailer } from "./trailer";

// La fiche d'une carte de bienvenue (specs/bienvenue-v1.md, FR-4) : ce qu'on montre en plus de l'affiche,
// pour un titre hors bibliothèque. Même forme en local (GET /api/tmdb/title, Next.js) et en ligne (serveur
// Rust, `decouverte::fiche_carte`).

export type FicheCarte = {
  trailer: Trailer | null;
  availability: Availability | null;
  /** Minutes (d'un épisode pour une série). */
  runtime: number | null;
  directors: string[];
  cast: string[];
};

export function ficheCarte(d: TitleData): FicheCarte {
  return {
    trailer: d.trailer?.trailer ?? null,
    availability: d.availability ?? null,
    runtime: d.features.runtime,
    directors: d.features.directors.slice(0, 2).map((p) => p.name),
    cast: d.features.cast.slice(0, 4).map((p) => p.name),
  };
}
