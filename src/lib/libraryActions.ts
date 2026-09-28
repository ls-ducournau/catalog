import type Database from "better-sqlite3";
import {
  deleteItemLocally,
  findByTmdbId,
  getNotionPageId,
  insertItem,
  type LibraryItem,
} from "./itemService";
import { logEvent, type AddSource } from "./journalService";
import { archiveNotionPage, createNotionItem, NotionNotConfiguredError } from "./notion";
import { getDetails, getDetailsFr, getTitleData } from "./tmdb";

// Ajouter et retirer un titre, partagés par les routes et le tri rapide.
// spec: specs/ajout-item-v1.md (FR-3, FR-4, FR-5, EC-3, EC-4), bibliotheque-v1 (FR-9),
// tri-rapide-v1 (FR-1 : chaque ajout et retrait est journalisé avec son origine).

export type ActionError = "tmdb_not_found" | "notion_not_configured" | "notion_unreachable" | "not_found";

export type AddResult =
  | { item: LibraryItem; alreadyExists: boolean }
  | { error: ActionError };

/**
 * Crée le titre dans Notion puis en local. Idempotent : un titre déjà présent est renvoyé tel
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

  try {
    const notionPageId = await createNotionItem({
      title,
      type: details.type,
      year: details.year,
      imdbId: details.imdbId,
      genres: details.genres,
      director: details.director,
      tmdbRating: details.voteAverage,
    });

    const item = insertItem(db, {
      notionPageId,
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
  } catch (err) {
    return { error: err instanceof NotionNotConfiguredError ? "notion_not_configured" : "notion_unreachable" };
  }
}

/**
 * FR-9 (bibliothèque) : archive la page Notion puis supprime l'item en local. Si Notion n'est
 * pas configuré, on refuse plutôt que de supprimer seulement en local (l'item reviendrait au
 * prochain pull, ce qui serait trompeur).
 */
export async function removeFromLibrary(
  db: Database.Database,
  itemId: number
): Promise<{ ok: true } | { error: ActionError }> {
  const notionPageId = getNotionPageId(db, itemId);
  if (!notionPageId) return { error: "not_found" };

  try {
    await archiveNotionPage(notionPageId);
  } catch (err) {
    return { error: err instanceof NotionNotConfiguredError ? "notion_not_configured" : "notion_unreachable" };
  }

  deleteItemLocally(db, itemId);
  logEvent(db, "removed", "item", itemId);
  return { ok: true };
}

/** Correspondance erreur → statut HTTP, commune aux routes. */
export function actionErrorStatus(error: ActionError): number {
  if (error === "not_found") return 404;
  if (error === "notion_not_configured") return 503;
  return 502;
}
