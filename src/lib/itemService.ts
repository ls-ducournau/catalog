import type Database from "better-sqlite3";
import { isStale, type Availability } from "./availability";
import { isReleaseStale, type ReleaseInfo } from "./release";
import type { TrailerInfo } from "./trailer";
import type { Category, LibraryItem, WatchStatus } from "./libraryItem";
import { parseGenres } from "./genres";
import {
  getDetails,
  getDetailsFr,
  getTitleData,
  posterUrl,
  type TmdbFeatures,
} from "./tmdb";

// spec: specs/bibliotheque-v1.md (FR-1..FR-7)

// Le modèle d'item est partagé avec l'interface : une seule définition, dans libraryItem.ts.
// Notion ne connaît que `Type` = Movie/TV Series ; la catégorie "Documentary" dérive du tag
// Genre, cf. `Category`.
export type { Category, LibraryItem, WatchStatus } from "./libraryItem";

type ItemRow = {
  id: number;
  name: string;
  year: string | null;
  type: string;
  genre: string | null;
  director: string | null;
  watch_status: string | null;
  poster_path: string | null;
  rating: string | null;
  ressenti: string | null;
  elo_score: number;
  duels_count: number;
  tmdb_id: number | null;
  overview: string | null;
  tmdb_rating: number | null;
  vote_count: number | null;
  tmdb_features: string | null;
  watch_providers: string | null;
  release_info: string | null;
  trailer_info: string | null;
};

function isDocumentaryGenre(genreJson: string | null): boolean {
  if (!genreJson) return false;
  try {
    const genres = JSON.parse(genreJson) as string[];
    return genres.includes("Documentary");
  } catch {
    return false;
  }
}

function toLibraryItem(row: ItemRow): LibraryItem {
  return {
    id: row.id,
    name: row.name,
    year: row.year,
    type: row.type as "Movie" | "TV Series",
    category: isDocumentaryGenre(row.genre) ? "Documentary" : (row.type as "Movie" | "TV Series"),
    genres: parseGenres(row.genre),
    watchStatus: row.watch_status as WatchStatus | null,
    posterUrl: posterUrl(row.poster_path),
    rating: row.rating,
    ressenti: row.ressenti,
    eloScore: row.duels_count >= 1 ? row.elo_score : null,
    duelsCount: row.duels_count,
    overview: row.overview,
    voteAverage: row.tmdb_rating,
    voteCount: row.vote_count,
    availability: parseAvailabilityColumn(row.watch_providers),
    release: parseReleaseColumn(row.release_info),
    trailer: parseTrailerColumn(row.trailer_info)?.trailer ?? null,
  };
}

function parseTrailerColumn(json: string | null): TrailerInfo | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as TrailerInfo;
  } catch {
    return null;
  }
}

function parseReleaseColumn(json: string | null): ReleaseInfo | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as ReleaseInfo;
  } catch {
    return null;
  }
}

function parseAvailabilityColumn(json: string | null): Availability | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as Availability;
  } catch {
    return null;
  }
}

// Échelle de note personnelle Notion, du plus bas au plus haut (index = nb d'étoiles, 0 = 💩).
export const RATING_SCALE = ["💩", "⭐️", "⭐️⭐️", "⭐️⭐️⭐️", "⭐️⭐️⭐️⭐️", "⭐️⭐️⭐️⭐️⭐️"] as const;

export type SortBy =
  | "name"
  | "year"
  | "elo"
  | "tmdbRating"
  | "added"
  | "rating"
  | "status"
  | "category"
  | "genre";
export type SortDir = "asc" | "desc";

/** Même sémantique de catégorie partout (bibliotheque-v1 FR-9) : la seule définition. */
export const DOCUMENTARY_TAG = `EXISTS (SELECT 1 FROM json_each(items.genre) je WHERE je.value = 'Documentary')`;

/**
 * Condition SQL d'une catégorie, à ajouter à un WHERE (elle commence par « AND ») ; vide sans
 * catégorie. Un documentaire est un documentaire, qu'il soit film ou série.
 */
export function categoryFilter(category: Category | undefined): { sql: string; params: string[] } {
  if (category === "Documentary") return { sql: ` AND ${DOCUMENTARY_TAG}`, params: [] };
  if (category) return { sql: ` AND type = ? AND NOT ${DOCUMENTARY_TAG}`, params: [category] };
  return { sql: "", params: [] };
}

/** Rang d'une note perso : 💩 = 0 … 5 étoiles = 5 ; NULL si pas notée (trié en fin de liste). */
export const RATING_RANK_SQL = `(CASE rating ${RATING_SCALE.map((r, i) => `WHEN '${r}' THEN ${i}`).join(" ")} END)`;

const SORT_COLUMN: Record<SortBy, string> = {
  name: "name COLLATE NOCASE",
  year: "year",
  // elo_score vaut 1200 par défaut même sans duel réel (cf. toLibraryItem) — pour le tri,
  // on le traite comme NULL tant que duels_count = 0, pour ne pas le mélanger à de vrais scores.
  elo: "(CASE WHEN duels_count >= 1 THEN elo_score END)",
  tmdbRating: "tmdb_rating",
  // Pas de colonne de date de création : l'id auto-incrémenté suit l'ordre d'arrivée en base.
  // Exact pour tout ce qui est ajouté depuis l'app ; l'import initial Notion garde son ordre
  // d'import.
  added: "id",
  rating: RATING_RANK_SQL,
  status: "(CASE watch_status WHEN 'Watched' THEN 1 ELSE 0 END)",
  category: `(CASE WHEN ${DOCUMENTARY_TAG} THEN 'Documentaire' WHEN type = 'Movie' THEN 'Film' ELSE 'Série' END)`,
  // Premier genre TMDB de l'item : regroupe les titres par famille.
  genre: "json_extract(genre, '$[0]') COLLATE NOCASE",
};

// Direction par défaut la plus utile pour chaque tri (ex: Elo/note -> les meilleurs d'abord).
const DEFAULT_SORT_DIR: Record<SortBy, SortDir> = {
  name: "asc",
  year: "desc",
  elo: "desc",
  tmdbRating: "desc",
  added: "desc",
  rating: "desc",
  // La pile à voir d'abord : c'est la partie sur laquelle on agit.
  status: "asc",
  category: "asc",
  genre: "asc",
};

export type ListItemsOptions = {
  category?: Category;
  watchStatus?: WatchStatus;
  q?: string;
  genre?: string;
  /** Note personnelle minimale, 1 à 5 étoiles (💩 exclu de ce filtre : ce n'est pas "au moins 0 étoile"). */
  minRating?: number;
  /** Note personnelle exacte, de 0 (💩) à 5 étoiles : une barre de l'histogramme de l'accueil. */
  rating?: number;
  /**
   * Identifiants de services couverts par tes abonnements (formules avec publicité comprises) :
   * ne garde que les titres inclus sur l'un d'eux (disponibilite-streaming-v1 FR-5).
   */
  onServices?: number[];
  sortBy?: SortBy;
  sortDir?: SortDir;
  page?: number;
  pageSize?: number;
};

export type ListItemsResult = {
  items: LibraryItem[];
  page: number;
  pageSize: number;
  total: number;
};

/** Genres distincts présents dans la bibliothèque, pour peupler le filtre. */
export function listDistinctGenres(db: Database.Database): string[] {
  const rows = db
    .prepare(
      `SELECT DISTINCT je.value AS genre
       FROM items, json_each(items.genre) je
       WHERE items.genre IS NOT NULL
       ORDER BY genre COLLATE NOCASE`
    )
    .all() as { genre: string }[];
  return rows.map((r) => r.genre);
}

/** FR-1/FR-2/AC-1/AC-5: liste paginée et filtrable (+ genre, note perso, tri). */
export function listItems(db: Database.Database, options: ListItemsOptions = {}): ListItemsResult {
  const page = Math.max(1, options.page ?? 1);
  const pageSize = Math.max(1, options.pageSize ?? 24);

  const conditions: string[] = [];
  const params: (string | number)[] = [];

  if (options.category === "Documentary") {
    conditions.push(DOCUMENTARY_TAG);
  } else if (options.category === "Movie" || options.category === "TV Series") {
    // Un item Movie/TV Series taggé Documentary appartient à la catégorie Documentary,
    // pas à Film/Série (cf. Category ci-dessus) — on l'exclut donc ici.
    conditions.push(`type = ? AND NOT ${DOCUMENTARY_TAG}`);
    params.push(options.category);
  }
  if (options.watchStatus) {
    conditions.push("watch_status = ?");
    params.push(options.watchStatus);
  }
  if (options.q) {
    conditions.push("LOWER(name) LIKE ?");
    params.push(`%${options.q.toLowerCase()}%`);
  }
  if (options.genre) {
    conditions.push(
      `EXISTS (SELECT 1 FROM json_each(items.genre) je WHERE je.value = ?)`
    );
    params.push(options.genre);
  }
  if (options.minRating && options.minRating >= 1 && options.minRating <= 5) {
    const acceptable = RATING_SCALE.slice(options.minRating); // exclut 💩, inclut N étoiles et plus
    conditions.push(`rating IN (${acceptable.map(() => "?").join(",")})`);
    params.push(...acceptable);
  }
  if (options.rating !== undefined && Number.isInteger(options.rating) && options.rating >= 0 && options.rating <= 5) {
    conditions.push("rating = ?");
    params.push(RATING_SCALE[options.rating]);
  }

  if (options.onServices) {
    const services = onServicesCondition(options.onServices);
    conditions.push(services.sql);
    params.push(...services.params);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = (
    db.prepare(`SELECT COUNT(*) c FROM items ${where}`).get(...params) as { c: number }
  ).c;

  const sortBy = options.sortBy ?? "name";
  const sortDir = options.sortDir ?? DEFAULT_SORT_DIR[sortBy];
  const orderColumn = SORT_COLUMN[sortBy];
  // NULLS LAST manuel (SQLite trie NULL en premier par défaut en ASC) pour ne pas polluer
  // le haut du classement avec des items sans Elo/note TMDB quand on trie desc.
  //
  // Départage par nom puis id : les tris qui regroupent (statut, type, genre, note) créent des
  // centaines d'égalités, et sans ordre total la pagination par OFFSET du défilement infini
  // pouvait répéter un titre d'une page à l'autre ou en sauter un.
  const orderClause = `ORDER BY ${orderColumn} IS NULL, ${orderColumn} ${sortDir.toUpperCase()}, name COLLATE NOCASE ASC, id ASC`;

  const rows = db
    .prepare(`SELECT * FROM items ${where} ${orderClause} LIMIT ? OFFSET ?`)
    .all(...params, pageSize, (page - 1) * pageSize) as ItemRow[];

  return { items: rows.map(toLibraryItem), page, pageSize, total };
}

export type UpdateItemPatch = Partial<{
  watchStatus: WatchStatus;
  rating: string | null;
  ressenti: string | null;
}>;

/**
 * FR-4/FR-5/FR-6/FR-7/EC-2/EC-3: applique une modification et marque l'item pour push.
 *
 * Règles métier autour de la note :
 * - on ne peut poser une note que sur ce qui est (ou devient, dans le même appel) `Watched` —
 *   noter un item "à voir" n'a pas de sens ; sinon le champ `rating` est silencieusement ignoré ;
 * - repasser un item en `Unwatched` efface sa note, quel que soit l'appelant (garder une note
 *   sur un item non-vu serait incohérent, et elle resurgirait au prochain passage en "vu") ;
 * - effacer une note (`rating: null`) est toujours autorisé.
 */
export function updateItem(
  db: Database.Database,
  id: number,
  patch: UpdateItemPatch
): LibraryItem | null {
  const sets: string[] = [];
  const params: (string | number | null)[] = [];

  if (patch.watchStatus !== undefined) {
    sets.push("watch_status = ?");
    params.push(patch.watchStatus);
  }

  const clearsRating = patch.watchStatus === "Unwatched";
  if (clearsRating) {
    sets.push("rating = ?");
    params.push(null);
  }

  // `clearsRating` a déjà posé la note à null : on n'écrit pas deux fois la même colonne.
  if (patch.rating !== undefined && !clearsRating) {
    if (patch.rating === null) {
      sets.push("rating = ?");
      params.push(null);
    } else {
      const current = db.prepare(`SELECT watch_status FROM items WHERE id = ?`).get(id) as
        | { watch_status: string | null }
        | undefined;
      const effectiveStatus = patch.watchStatus ?? current?.watch_status;

      if (effectiveStatus === "Watched") {
        sets.push("rating = ?");
        params.push(patch.rating);
      }
      // sinon : ignoré volontairement (règle métier ci-dessus)
    }
  }
  if (patch.ressenti !== undefined) {
    // EC-2: une chaîne vide est une valeur valide (effacement volontaire), distincte de "non modifié".
    sets.push("ressenti = ?");
    params.push(patch.ressenti);
  }

  if (sets.length === 0) {
    const row = db.prepare(`SELECT * FROM items WHERE id = ?`).get(id) as ItemRow | undefined;
    return row ? toLibraryItem(row) : null;
  }

  sets.push("local_dirty = 1", "updated_at = ?");
  params.push(new Date().toISOString());

  const result = db
    .prepare(`UPDATE items SET ${sets.join(", ")} WHERE id = ?`)
    .run(...params, id);

  if (result.changes === 0) return null;

  const row = db.prepare(`SELECT * FROM items WHERE id = ?`).get(id) as ItemRow;
  return toLibraryItem(row);
}

/** FR-5 (ajout-item) : détecte un doublon avant de créer une nouvelle page Notion. */
export function findByTmdbId(db: Database.Database, tmdbId: number): LibraryItem | null {
  const row = db.prepare(`SELECT * FROM items WHERE tmdb_id = ?`).get(tmdbId) as
    | ItemRow
    | undefined;
  return row ? toLibraryItem(row) : null;
}

/**
 * Items complets pour une liste d'ids, dans l'ordre demandé (les ids inconnus sont ignorés) —
 * une seule requête. Sert aux écrans qui calculent d'abord un classement d'ids (recommandations)
 * puis ont besoin des mêmes champs que la bibliothèque pour réutiliser ses composants.
 */
export function getItemsByIds(db: Database.Database, ids: number[]): LibraryItem[] {
  if (ids.length === 0) return [];

  const placeholders = ids.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT * FROM items WHERE id IN (${placeholders})`)
    .all(...ids) as ItemRow[];

  const byId = new Map(rows.map((row) => [row.id, toLibraryItem(row)]));
  return ids.map((id) => byId.get(id)).filter((item): item is LibraryItem => item !== undefined);
}

/**
 * NFR-1 (ce-soir) : id local + statut de plusieurs tmdb_id en une seule requête groupée, pour
 * croiser un lot de résultats /discover sans une requête par item. L'id local est nécessaire
 * pour retirer rapidement un item déjà ajouté (DELETE /api/items/:id, pas /:tmdbId).
 */
export function getLibraryInfoByTmdbIds(
  db: Database.Database,
  tmdbIds: number[]
): Map<number, { id: number; watchStatus: WatchStatus | null }> {
  const result = new Map<number, { id: number; watchStatus: WatchStatus | null }>();
  if (tmdbIds.length === 0) return result;

  const placeholders = tmdbIds.map(() => "?").join(",");
  const rows = db
    .prepare(`SELECT id, tmdb_id, watch_status FROM items WHERE tmdb_id IN (${placeholders})`)
    .all(...tmdbIds) as { id: number; tmdb_id: number; watch_status: string | null }[];

  for (const row of rows) {
    result.set(row.tmdb_id, { id: row.id, watchStatus: row.watch_status as WatchStatus | null });
  }
  return result;
}

export type NewItemInput = {
  notionPageId: string;
  name: string;
  type: "Movie" | "TV Series";
  year: string | null;
  imdbId: string | null;
  tmdbId: number;
  posterPath: string | null;
  genre: string[];
  director: string | null;
  tmdbRating: number | null;
  voteCount: number | null;
  overview: string;
  /** FR-23 (recommandations v1.3) : null si TMDB n'a pas répondu, le backfill rattrapera. */
  tmdbFeatures: TmdbFeatures | null;
  /** Disponibilité streaming, récupérée dans le même appel que les caractéristiques. */
  availability: Availability | null;
  /** Dates de sortie, du même appel. */
  release: ReleaseInfo | null;
  /** Bande-annonce, du même appel. */
  trailer: TrailerInfo | null;
};

/**
 * FR-3/FR-4 (ajout-item) : insère localement un item déjà créé côté Notion (propriétés déjà
 * connues via TMDB, pas besoin d'un pull complet). `Watch Status` = Unwatched par défaut.
 */
export function insertItem(db: Database.Database, input: NewItemInput): LibraryItem {
  const now = new Date().toISOString();

  db.prepare(
    `INSERT INTO items (
      notion_page_id, name, type, year, watch_status, imdb_id, tmdb_id, poster_path, genre, director, tmdb_rating, vote_count, overview,
      tmdb_features, watch_providers, release_info, trailer_info, notion_last_edited, updated_at
    ) VALUES (@notion_page_id, @name, @type, @year, 'Unwatched', @imdb_id, @tmdb_id, @poster_path, @genre, @director, @tmdb_rating, @vote_count, @overview,
      @tmdb_features, @watch_providers, @release_info, @trailer_info, @now, @now)`
  ).run({
    notion_page_id: input.notionPageId,
    name: input.name,
    type: input.type,
    year: input.year,
    imdb_id: input.imdbId,
    tmdb_id: input.tmdbId,
    poster_path: input.posterPath,
    genre: input.genre.length > 0 ? JSON.stringify(input.genre) : null,
    director: input.director,
    tmdb_rating: input.tmdbRating,
    vote_count: input.voteCount,
    overview: input.overview,
    tmdb_features: input.tmdbFeatures ? JSON.stringify(input.tmdbFeatures) : null,
    watch_providers: input.availability ? JSON.stringify(input.availability) : null,
    release_info: input.release ? JSON.stringify(input.release) : null,
    trailer_info: input.trailer ? JSON.stringify(input.trailer) : null,
    now,
  });

  const row = db
    .prepare(`SELECT * FROM items WHERE notion_page_id = ?`)
    .get(input.notionPageId) as ItemRow;
  return toLibraryItem(row);
}

/** FR-9: retourne le notion_page_id d'un item, nécessaire pour archiver côté Notion avant suppression locale. */
export function getNotionPageId(db: Database.Database, id: number): string | null {
  const row = db.prepare(`SELECT notion_page_id FROM items WHERE id = ?`).get(id) as
    | { notion_page_id: string }
    | undefined;
  return row?.notion_page_id ?? null;
}

/**
 * Récupère un item avec son synopsis, en le mettant en cache localement à la demande (jamais
 * pré-chargé en masse) : la première fois qu'on ouvre le détail d'un item, on va le chercher
 * sur TMDB et on le stocke ; les ouvertures suivantes lisent le cache sans nouvel appel réseau.
 * `overview = ""` signifie "déjà tenté, rien à afficher" (pas de tmdb_id, ou TMDB n'en a pas) —
 * distinct de `null` ("pas encore tenté"), pour ne jamais retenter inutilement.
 */
export async function getItemWithOverview(
  db: Database.Database,
  id: number
): Promise<LibraryItem | null> {
  const row = db.prepare(`SELECT * FROM items WHERE id = ?`).get(id) as ItemRow | undefined;
  if (!row) return null;

  if (row.overview === null) {
    if (row.tmdb_id !== null) {
      const details = await getDetailsFr(row.tmdb_id, row.type as "Movie" | "TV Series");
      if (details !== null) {
        // vote_count/tmdb_rating rafraîchis au passage (même appel, sans coût réseau
        // supplémentaire) — utile pour les items importés avant leur ajout à l'app, jamais
        // enrichis avec ces deux champs.
        db.prepare(`UPDATE items SET overview = ?, tmdb_rating = ?, vote_count = ? WHERE id = ?`).run(
          details.overview,
          details.voteAverage,
          details.voteCount,
          id
        );
        row.overview = details.overview;
        row.tmdb_rating = details.voteAverage;
        row.vote_count = details.voteCount;
      }
      // sinon (échec réseau/API) : overview reste null, on retentera à la prochaine ouverture.
    } else {
      db.prepare(`UPDATE items SET overview = ? WHERE id = ?`).run("", id);
      row.overview = "";
    }
  }

  // Disponibilité (disponibilite-streaming-v1 FR-2) et dates de sortie (sorties-v1 FR-1) :
  // rafraîchies à l'ouverture de la fiche si absentes ou vieilles de plus de 7 jours, en un seul
  // appel ; en cas d'échec, on garde les précédentes.
  if (
    row.tmdb_id !== null &&
    (isStale(parseAvailabilityColumn(row.watch_providers)) ||
      isReleaseStale(parseReleaseColumn(row.release_info)) ||
      row.trailer_info === null)
  ) {
    const titleData = await getTitleData(row.tmdb_id, row.type as "Movie" | "TV Series");
    if (titleData) {
      storeTitleData(db, id, titleData);
      row.watch_providers = JSON.stringify(titleData.availability);
      row.release_info = JSON.stringify(titleData.release);
      row.trailer_info = JSON.stringify(titleData.trailer);
      row.tmdb_features = JSON.stringify(titleData.features);
    }
  }

  return toLibraryItem(row);
}

/**
 * Refetch explicite depuis TMDB, à la demande de l'utilisateur : titre et synopsis en français,
 * note, nombre de votes, affiche, genres, réalisateur, année. Local uniquement — rien n'est
 * poussé vers Notion (même choix que le backfill : le titre local peut diverger sciemment).
 * Retourne null si l'item n'existe pas ou n'a pas de tmdb_id, et l'item inchangé si TMDB échoue.
 */
export async function refreshItemFromTmdb(
  db: Database.Database,
  id: number
): Promise<LibraryItem | null> {
  const row = db.prepare(`SELECT * FROM items WHERE id = ?`).get(id) as ItemRow | undefined;
  if (!row) return null;
  if (row.tmdb_id === null) return toLibraryItem(row);

  const type = row.type as "Movie" | "TV Series";
  const [details, detailsFr, titleData] = await Promise.all([
    getDetails(row.tmdb_id, type),
    getDetailsFr(row.tmdb_id, type),
    getTitleData(row.tmdb_id, type),
  ]);
  const features = titleData?.features ?? null;

  if (!details && !detailsFr) return toLibraryItem(row);

  const name = detailsFr?.title || details?.title || row.name;
  const overview = detailsFr?.overview ?? row.overview;
  const tmdbRating = detailsFr?.voteAverage ?? details?.voteAverage ?? row.tmdb_rating;
  const voteCount = detailsFr?.voteCount ?? details?.voteCount ?? row.vote_count;
  const posterPath = details?.posterPath ?? row.poster_path;
  // `genre` est stocké en JSON (cf. insertItem et les filtres json_each) — surtout pas en texte
  // concaténé, sinon le filtre par genre et la catégorie Documentaire cassent.
  const genre = details
    ? details.genres.length > 0
      ? JSON.stringify(details.genres)
      : null
    : row.genre;
  const director = details?.director ?? row.director;
  const year = details?.year ?? row.year;
  const tmdbFeatures = features ? JSON.stringify(features) : row.tmdb_features;
  // EC-3 (disponibilité) : en cas d'échec TMDB, on garde la précédente.
  const watchProviders = titleData ? JSON.stringify(titleData.availability) : row.watch_providers;
  const releaseInfo = titleData ? JSON.stringify(titleData.release) : row.release_info;
  const trailerInfo = titleData ? JSON.stringify(titleData.trailer) : row.trailer_info;

  db.prepare(
    `UPDATE items
     SET name = ?, overview = ?, tmdb_rating = ?, vote_count = ?, poster_path = ?,
         genre = ?, director = ?, year = ?, tmdb_features = ?, watch_providers = ?, release_info = ?,
         trailer_info = ?, updated_at = ?
     WHERE id = ?`
  ).run(
    name,
    overview,
    tmdbRating,
    voteCount,
    posterPath,
    genre,
    director,
    year,
    tmdbFeatures,
    watchProviders,
    releaseInfo,
    trailerInfo,
    new Date().toISOString(),
    id
  );

  row.name = name;
  row.overview = overview;
  row.tmdb_rating = tmdbRating;
  row.vote_count = voteCount;
  row.poster_path = posterPath;
  row.genre = genre;
  row.director = director;
  row.year = year;
  row.tmdb_features = tmdbFeatures;
  row.watch_providers = watchProviders;
  row.release_info = releaseInfo;
  row.trailer_info = trailerInfo;

  return toLibraryItem(row);
}

/**
 * FR-9: supprime un item localement (et l'historique de duels qui le référence, pour
 * ne laisser aucune ligne orpheline). L'archivage côté Notion doit être fait séparément
 * par l'appelant AVANT cet appel (voir la route API), pour ne jamais désynchroniser
 * l'app locale d'une page Notion encore active si l'archivage échoue.
 */
export function deleteItemLocally(db: Database.Database, id: number): boolean {
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM duels WHERE item_a_id = ? OR item_b_id = ?`).run(id, id);
    db.prepare(`DELETE FROM tier_duels WHERE item_a_id = ? OR item_b_id = ?`).run(id, id);
    // playlists-v1 FR-9 : un titre retiré de la bibliothèque quitte aussi les playlists.
    db.prepare(`DELETE FROM playlist_items WHERE item_id = ?`).run(id);
    db.prepare(`DELETE FROM playlist_suggestion_dismissals WHERE item_id = ?`).run(id);
    return db.prepare(`DELETE FROM items WHERE id = ?`).run(id);
  });

  const result = tx();
  return result.changes > 0;
}

/**
 * FR-5 (disponibilité) : titre inclus (abonnement, gratuit ou avec publicité) sur l'un des
 * services donnés. La location et l'achat ne comptent pas. Sans service, rien ne passe.
 */
export function onServicesCondition(serviceIds: number[]): { sql: string; params: number[] } {
  if (serviceIds.length === 0) return { sql: "0", params: [] };
  const placeholders = serviceIds.map(() => "?").join(",");
  const block = (path: string) =>
    `EXISTS (SELECT 1 FROM json_each(items.watch_providers, '$.${path}') p WHERE json_extract(p.value, '$.id') IN (${placeholders}))`;
  return {
    sql: `(${block("flatrate")} OR ${block("free")} OR ${block("ads")})`,
    params: [...serviceIds, ...serviceIds, ...serviceIds],
  };
}

export function storeAvailability(db: Database.Database, id: number, availability: Availability): void {
  db.prepare(`UPDATE items SET watch_providers = ? WHERE id = ?`).run(JSON.stringify(availability), id);
}

/** Dates de sortie seules (sorties-v1 NFR-2 : rafraîchissement par lots). */
export function storeRelease(db: Database.Database, id: number, release: ReleaseInfo): void {
  db.prepare(`UPDATE items SET release_info = ? WHERE id = ?`).run(JSON.stringify(release), id);
}

/**
 * Enregistre ce qu'un appel TMDB groupé rapporte : disponibilité, dates, caractéristiques. Ne
 * touche pas `updated_at` (ce n'est pas une modification du titre, et elle relancerait
 * l'entraînement du modèle) ; les caractéristiques, elles, le relanceront via leur empreinte.
 */
export function storeTitleData(
  db: Database.Database,
  id: number,
  data: { availability: Availability; release: ReleaseInfo; features: TmdbFeatures; trailer: TrailerInfo }
): void {
  db.prepare(
    `UPDATE items SET watch_providers = ?, release_info = ?, trailer_info = ?, tmdb_features = ? WHERE id = ?`
  ).run(
    JSON.stringify(data.availability),
    JSON.stringify(data.release),
    JSON.stringify(data.trailer),
    JSON.stringify(data.features),
    id
  );
}
