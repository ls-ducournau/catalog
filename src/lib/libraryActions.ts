import type Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import {
  deleteItemLocally,
  findByTmdbId,
  getNotionPageId,
  insertItem,
  type LibraryItem,
} from "./itemService";
import { logEvent, type AddSource } from "./journalService";
import { getDetails, getDetailsFr, getTitleData } from "./tmdb";

// Ajouter et retirer un titre, partagés par les routes et le tri rapide.
// spec: specs/ajout-item-v1.md (FR-3, FR-4, FR-5, EC-3, EC-4), bibliotheque-v1 (FR-9),
// tri-rapide-v1 (FR-1 : chaque ajout et retrait est journalisé avec son origine).
// Décision de Louis (2026-10-26, specs/catalog-v2-rust-supabase.md FR-1) : la base locale est la seule
// source ; ajouter et retirer ne passent plus par aucun service externe, comme dans la v2.

export type ActionError = "tmdb_not_found" | "not_found";

export type AddResult =
  | { item: LibraryItem; alreadyExists: boolean }
  | { error: ActionError };

/**
 * Crée le titre en local, avec sa fiche TMDB. Idempotent : un titre déjà présent est renvoyé tel
 * quel (et son ajout n'est pas compté deux fois dans le journal).
 */
export async function addTitleToLibrary(
  db: Database.Database,
  tmdbId: number,
  type: "Movie" | "TV Series",
  source: AddSource = "search"
): Promise<AddResult> {
  const existing = findByTmdbId(db, tmdbId);
  if (existing) return { item: existing, alreadyExists: true };

  // Titre + synopsis (+ vote_count) en français quand TMDB en a une traduction ; genres/
  // réalisateur restent dans la langue de getDetails. Les caractéristiques du modèle de
  // préférence (FR-23) et la disponibilité arrivent dans le même aller-retour, en parallèle.
  const [details, detailsFr, titleData] = await Promise.all([
    getDetails(tmdbId, type),
    getDetailsFr(tmdbId, type),
    getTitleData(tmdbId, type),
  ]);
  if (!details) return { error: "tmdb_not_found" };
  const title = detailsFr?.title || details.title;

  // La colonne historique `notion_page_id` reste unique et obligatoire : un identifiant local.
  const item = insertItem(db, {
    notionPageId: `local-${randomUUID()}`,
    name: title,
    type: details.type,
    year: details.year,
    imdbId: details.imdbId,
    tmdbId: details.tmdbId,
    posterPath: details.posterPath,
    genre: details.genres,
    director: details.director,
    tmdbRating: details.voteAverage,
    voteCount: detailsFr?.voteCount ?? details.voteCount,
    overview: detailsFr?.overview ?? "",
    tmdbFeatures: titleData?.features ?? null,
    availability: titleData?.availability ?? null,
    release: titleData?.release ?? null,
    trailer: titleData?.trailer ?? null,
  });

  logEvent(db, "added", "item", item.id, { source, tmdbId, type });
  return { item, alreadyExists: false };
}

/** FR-9 (bibliothèque) : supprime le titre en local (et ce qui en dépend, comme avant). */
export async function removeFromLibrary(
  db: Database.Database,
  itemId: number
): Promise<{ ok: true } | { error: ActionError }> {
  if (!getNotionPageId(db, itemId)) return { error: "not_found" };

  deleteItemLocally(db, itemId);
  logEvent(db, "removed", "item", itemId);
  return { ok: true };
}

/** Correspondance erreur → statut HTTP, commune aux routes. */
export function actionErrorStatus(error: ActionError): number {
  if (error === "not_found") return 404;
  return 502;
}
