import type Database from "better-sqlite3";
import { getItemsByIds, RATING_SCALE, updateItem } from "./itemService";
import { logEvent } from "./journalService";
import type { LibraryItem } from "./libraryItem";
import { DESCRIPTION_MAX, NAME_MAX } from "./playlistFormat";
import { loadModelTitles } from "./preferenceService";

// Playlists faites à la main — spec: specs/playlists-v1.md et specs/playlists-v2.md. Des listes
// nommées et ordonnées de titres de la bibliothèque, locales (NFR-1) : rien n'est écrit vers
// Notion. Chaque geste est journalisé en local (v2 FR-12), pour mesurer le résultat visé.

/** D'où vient un geste (v2 FR-12) : fiche, carte, sélection, suggestion, Ce soir… */
export type PlaylistSource =
  | "fiche"
  | "carte"
  | "selection"
  | "suggestion"
  | "recherche"
  | "ce-soir"
  | "sorties"
  | "tri"
  | "decouvrir"
  | "accueil"
  | "playlist";

const SOURCES: PlaylistSource[] = [
  "fiche",
  "carte",
  "selection",
  "suggestion",
  "recherche",
  "ce-soir",
  "sorties",
  "tri",
  "decouvrir",
  "accueil",
  "playlist",
];

export function parseSource(value: unknown): PlaylistSource | undefined {
  return SOURCES.includes(value as PlaylistSource) ? (value as PlaylistSource) : undefined;
}

export type Playlist = {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * EC-3 : durée des titres dont TMDB donne la durée (`known` sur `count`) ; une série compte pour
 * un épisode (`hasSeries`, que l'affichage précise).
 */
export type PlaylistRuntime = { minutes: number; known: number; hasSeries: boolean };

export type PlaylistSummary = Playlist & {
  count: number;
  watched: number;
  runtime: PlaylistRuntime;
  /** FR-10, EC-2 : affiches des quatre premiers titres (moins s'il y en a moins). */
  covers: string[];
  /** FR-4 : avec un titre donné, la playlist le contient-elle ? */
  contains?: boolean;
  /** v2 FR-11 : le prochain titre à voir (le premier non vu, dans l'ordre) ; null si tout est vu. */
  next: { id: number; name: string; posterUrl: string | null } | null;
};

/** `touchedAt` : dernière modification du titre (le plus récemment vu passe en tête de « À noter »). */
export type PlaylistEntry = LibraryItem & { position: number; runtime: number | null; touchedAt: string | null };

export type PlaylistDetail = PlaylistSummary & {
  items: PlaylistEntry[];
  /** FR-12 : le premier titre non vu, dans l'ordre de la liste ; null si tout est vu. */
  nextId: number | null;
};

/** FR-3 : de quoi recréer une playlist supprimée (même nom, mêmes titres, même ordre). */
export type PlaylistSnapshot = {
  id: number;
  name: string;
  description: string | null;
  createdAt: string;
  itemIds: number[];
};

export type PlaylistError = "invalid_name" | "invalid_description" | "invalid_order" | "invalid_rating" | "not_found";

type PlaylistRow = { id: number; name: string; description: string | null; created_at: string; updated_at: string };

const now = () => new Date().toISOString();

/** EC-1 : 1 à 60 caractères, espaces superflus retirés ; null si invalide. */
export function parseName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/\s+/g, " ");
  return name.length >= 1 && name.length <= NAME_MAX ? name : null;
}

/** Description facultative (200 caractères au plus) : null si vide, `false` si invalide. */
export function parseDescription(value: unknown): string | null | false {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") return false;
  const text = value.trim();
  if (text.length === 0) return null;
  return text.length <= DESCRIPTION_MAX ? text : false;
}

function toPlaylist(row: PlaylistRow): Playlist {
  return { id: row.id, name: row.name, description: row.description, createdAt: row.created_at, updatedAt: row.updated_at };
}

function getRow(db: Database.Database, id: number): PlaylistRow | undefined {
  return db.prepare(`SELECT * FROM playlists WHERE id = ?`).get(id) as PlaylistRow | undefined;
}

function touch(db: Database.Database, id: number): void {
  db.prepare(`UPDATE playlists SET updated_at = ? WHERE id = ?`).run(now(), id);
}

/** Identifiants des titres, dans l'ordre de la playlist. */
function itemIdsOf(db: Database.Database, playlistId: number): number[] {
  return (
    db.prepare(`SELECT item_id FROM playlist_items WHERE playlist_id = ? ORDER BY position, added_at`).all(playlistId) as {
      item_id: number;
    }[]
  ).map((r) => r.item_id);
}

/** Durées TMDB en cache (aucun appel réseau), par titre. */
function runtimesOf(db: Database.Database, ids: number[]): Map<number, number | null> {
  if (ids.length === 0) return new Map();
  const titles = loadModelTitles(db, `id IN (${ids.map(() => "?").join(",")})`, ids);
  return new Map(titles.map((t) => [t.id, t.runtime]));
}

function summarize(playlist: Playlist, items: LibraryItem[], runtimes: Map<number, number | null>): PlaylistSummary {
  let minutes = 0;
  let known = 0;
  for (const item of items) {
    const runtime = runtimes.get(item.id) ?? null;
    if (runtime) {
      minutes += runtime;
      known += 1;
    }
  }
  return {
    ...playlist,
    count: items.length,
    watched: items.filter((i) => i.watchStatus === "Watched").length,
    runtime: { minutes, known, hasSeries: items.some((i) => i.type === "TV Series") },
    covers: items
      .map((i) => i.posterUrl)
      .filter((url): url is string => Boolean(url))
      .slice(0, 4),
    next: (() => {
      const next = items.find((i) => i.watchStatus !== "Watched");
      return next ? { id: next.id, name: next.name, posterUrl: next.posterUrl } : null;
    })(),
  };
}

/** Les titres d'une playlist, dans l'ordre (les titres disparus sont ignorés). */
function orderedItems(db: Database.Database, ids: number[]): LibraryItem[] {
  const byId = new Map(getItemsByIds(db, ids).map((item) => [item.id, item]));
  return ids.map((id) => byId.get(id)).filter((item): item is LibraryItem => Boolean(item));
}

/** FR-10 : tes playlists, la dernière modifiée d'abord ; `itemId` coche celles qui le contiennent. */
export function listPlaylists(db: Database.Database, options: { itemId?: number } = {}): PlaylistSummary[] {
  const rows = db.prepare(`SELECT * FROM playlists ORDER BY updated_at DESC, id DESC`).all() as PlaylistRow[];
  const idsByPlaylist = new Map(rows.map((row) => [row.id, itemIdsOf(db, row.id)]));
  const allIds = [...new Set([...idsByPlaylist.values()].flat())];
  const items = new Map(getItemsByIds(db, allIds).map((item) => [item.id, item]));
  const runtimes = runtimesOf(db, allIds);
  return rows.map((row) => {
    const ids = idsByPlaylist.get(row.id) ?? [];
    const summary = summarize(
      toPlaylist(row),
      ids.map((id) => items.get(id)).filter((item): item is LibraryItem => Boolean(item)),
      runtimes
    );
    return options.itemId !== undefined ? { ...summary, contains: ids.includes(options.itemId) } : summary;
  });
}

/** FR-11, FR-12 : une playlist, ses titres dans l'ordre et le prochain à voir. */
export function getPlaylist(db: Database.Database, id: number): PlaylistDetail | null {
  const row = getRow(db, id);
  if (!row) return null;
  const items = orderedItems(db, itemIdsOf(db, id));
  const runtimes = runtimesOf(
    db,
    items.map((i) => i.id)
  );
  const touched = new Map(
    items.length === 0
      ? []
      : (
          db.prepare(`SELECT id, updated_at FROM items WHERE id IN (${items.map(() => "?").join(",")})`).all(...items.map((i) => i.id)) as {
            id: number;
            updated_at: string;
          }[]
        ).map((r) => [r.id, r.updated_at])
  );
  return {
    ...summarize(toPlaylist(row), items, runtimes),
    items: items.map((item, position) => ({ ...item, position, runtime: runtimes.get(item.id) ?? null, touchedAt: touched.get(item.id) ?? null })),
    nextId: items.find((item) => item.watchStatus !== "Watched")?.id ?? null,
  };
}

/** FR-1 (et FR-4 « Nouvelle playlist… ») : crée la playlist, avec un premier titre s'il est donné. */
export function createPlaylist(
  db: Database.Database,
  input: { name: unknown; description?: unknown; itemId?: number; source?: PlaylistSource }
): { playlist: Playlist } | { error: PlaylistError } {
  const name = parseName(input.name);
  if (!name) return { error: "invalid_name" };
  const description = parseDescription(input.description);
  if (description === false) return { error: "invalid_description" };

  const at = now();
  const tx = db.transaction(() => {
    const id = Number(
      db.prepare(`INSERT INTO playlists (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(name, description, at, at)
        .lastInsertRowid
    );
    logEvent(db, "playlist_created", "playlist", id, { source: input.source ?? null });
    if (input.itemId !== undefined && getItemsByIds(db, [input.itemId]).length === 1) {
      db.prepare(`INSERT INTO playlist_items (playlist_id, item_id, position, added_at) VALUES (?, ?, 0, ?)`).run(id, input.itemId, at);
      logEvent(db, "playlist_item_added", "item", input.itemId, { playlistId: id, source: input.source ?? null });
    }
    return id;
  });
  return { playlist: toPlaylist(getRow(db, tx())!) };
}

/** FR-2 : nom et description. */
export function updatePlaylist(
  db: Database.Database,
  id: number,
  patch: { name?: unknown; description?: unknown }
): { playlist: Playlist } | { error: PlaylistError } {
  if (!getRow(db, id)) return { error: "not_found" };
  const sets: string[] = [];
  const params: (string | null)[] = [];
  if (patch.name !== undefined) {
    const name = parseName(patch.name);
    if (!name) return { error: "invalid_name" };
    sets.push("name = ?");
    params.push(name);
  }
  if (patch.description !== undefined) {
    const description = parseDescription(patch.description);
    if (description === false) return { error: "invalid_description" };
    sets.push("description = ?");
    params.push(description);
  }
  sets.push("updated_at = ?");
  params.push(now());
  db.prepare(`UPDATE playlists SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
  return { playlist: toPlaylist(getRow(db, id)!) };
}

/** FR-3 : supprime la playlist (pas ses titres) et rend de quoi l'annuler. */
export function deletePlaylist(db: Database.Database, id: number): PlaylistSnapshot | null {
  const row = getRow(db, id);
  if (!row) return null;
  const snapshot: PlaylistSnapshot = {
    id,
    name: row.name,
    description: row.description,
    createdAt: row.created_at,
    itemIds: itemIdsOf(db, id),
  };
  db.transaction(() => {
    db.prepare(`DELETE FROM playlist_items WHERE playlist_id = ?`).run(id);
    db.prepare(`DELETE FROM playlist_suggestion_dismissals WHERE playlist_id = ?`).run(id);
    db.prepare(`DELETE FROM playlists WHERE id = ?`).run(id);
    logEvent(db, "playlist_deleted", "playlist", id, { count: snapshot.itemIds.length });
  })();
  return snapshot;
}

/** Lit un instantané reçu par l'API ; null s'il est mal formé. */
export function parseSnapshot(value: unknown): PlaylistSnapshot | null {
  const v = value as Record<string, unknown> | null;
  const isId = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x > 0;
  if (!v || !isId(v.id) || typeof v.name !== "string" || typeof v.createdAt !== "string") return null;
  if (v.description !== null && typeof v.description !== "string") return null;
  if (!Array.isArray(v.itemIds) || !v.itemIds.every(isId)) return null;
  return { id: v.id, name: v.name, description: (v.description as string | null) ?? null, createdAt: v.createdAt, itemIds: v.itemIds };
}

/**
 * Annulation de FR-3 : recrée la playlist, sous le même identifiant s'il est libre, avec ses titres
 * dans le même ordre (ceux qui ont quitté la bibliothèque entre-temps sont ignorés).
 */
export function restorePlaylist(db: Database.Database, snapshot: PlaylistSnapshot): { playlist: Playlist } | { error: PlaylistError } {
  const name = parseName(snapshot.name);
  if (!name) return { error: "invalid_name" };
  const description = parseDescription(snapshot.description);
  if (description === false) return { error: "invalid_description" };

  const at = now();
  const id = db.transaction(() => {
    let newId = snapshot.id;
    if (!getRow(db, snapshot.id)) {
      db.prepare(`INSERT INTO playlists (id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(
        snapshot.id,
        name,
        description,
        snapshot.createdAt,
        at
      );
    } else {
      newId = Number(
        db.prepare(`INSERT INTO playlists (name, description, created_at, updated_at) VALUES (?, ?, ?, ?)`).run(name, description, snapshot.createdAt, at)
          .lastInsertRowid
      );
    }
    const existing = new Set(getItemsByIds(db, snapshot.itemIds).map((item) => item.id));
    const insert = db.prepare(`INSERT OR IGNORE INTO playlist_items (playlist_id, item_id, position, added_at) VALUES (?, ?, ?, ?)`);
    snapshot.itemIds.filter((itemId) => existing.has(itemId)).forEach((itemId, position) => insert.run(newId, itemId, position, at));
    return newId;
  })();
  return { playlist: toPlaylist(getRow(db, id)!) };
}

/**
 * FR-4, FR-5, FR-6 : ajoute un titre, en fin de liste (ou à `position`, pour annuler un retrait).
 * Déjà présent : rien ne change (`added: false`).
 */
export function addToPlaylist(
  db: Database.Database,
  playlistId: number,
  itemId: number,
  position?: number,
  source?: PlaylistSource
): { added: boolean } | { error: PlaylistError } {
  if (!getRow(db, playlistId) || getItemsByIds(db, [itemId]).length === 0) return { error: "not_found" };
  const exists = db.prepare(`SELECT 1 FROM playlist_items WHERE playlist_id = ? AND item_id = ?`).get(playlistId, itemId);
  if (exists) return { added: false };

  db.transaction(() => {
    const ids = itemIdsOf(db, playlistId);
    const at = Math.max(0, Math.min(position ?? ids.length, ids.length));
    ids.splice(at, 0, itemId);
    db.prepare(`INSERT INTO playlist_items (playlist_id, item_id, position, added_at) VALUES (?, ?, ?, ?)`).run(playlistId, itemId, at, now());
    renumber(db, playlistId, ids);
    touch(db, playlistId);
    logEvent(db, "playlist_item_added", "item", itemId, { playlistId, source: source ?? null });
  })();
  return { added: true };
}

/**
 * v2 FR-4 : ajoute plusieurs titres d'un coup, en fin de liste et dans l'ordre donné ; ceux qui
 * y sont déjà sont ignorés (et comptés à part, pour le message).
 */
export function addManyToPlaylist(
  db: Database.Database,
  playlistId: number,
  itemIds: number[],
  source?: PlaylistSource
): { added: number[]; already: number[] } | { error: PlaylistError } {
  if (!getRow(db, playlistId)) return { error: "not_found" };
  const known = new Set(getItemsByIds(db, itemIds).map((item) => item.id));
  const added: number[] = [];
  const already: number[] = [];
  db.transaction(() => {
    const ids = itemIdsOf(db, playlistId);
    const insert = db.prepare(`INSERT INTO playlist_items (playlist_id, item_id, position, added_at) VALUES (?, ?, ?, ?)`);
    const at = now();
    for (const itemId of [...new Set(itemIds)]) {
      if (!known.has(itemId)) continue;
      if (ids.includes(itemId)) {
        already.push(itemId);
        continue;
      }
      insert.run(playlistId, itemId, ids.length, at);
      ids.push(itemId);
      added.push(itemId);
      logEvent(db, "playlist_item_added", "item", itemId, { playlistId, source: source ?? null });
    }
    if (added.length > 0) touch(db, playlistId);
  })();
  return { added, already };
}

/** FR-8 : retire un titre ; rend sa place, pour l'annulation. */
export function removeFromPlaylist(
  db: Database.Database,
  playlistId: number,
  itemId: number
): { removed: boolean; position: number | null } | { error: PlaylistError } {
  if (!getRow(db, playlistId)) return { error: "not_found" };
  const ids = itemIdsOf(db, playlistId);
  const position = ids.indexOf(itemId);
  if (position < 0) return { removed: false, position: null };
  db.transaction(() => {
    db.prepare(`DELETE FROM playlist_items WHERE playlist_id = ? AND item_id = ?`).run(playlistId, itemId);
    renumber(
      db,
      playlistId,
      ids.filter((id) => id !== itemId)
    );
    touch(db, playlistId);
    logEvent(db, "playlist_item_removed", "item", itemId, { playlistId });
  })();
  return { removed: true, position };
}

/** Positions 0, 1, 2… dans l'ordre donné. */
function renumber(db: Database.Database, playlistId: number, ids: number[]): void {
  const update = db.prepare(`UPDATE playlist_items SET position = ? WHERE playlist_id = ? AND item_id = ?`);
  ids.forEach((id, position) => update.run(position, playlistId, id));
}

/** FR-7 : nouvel ordre, qui doit reprendre exactement les titres de la playlist. */
export function reorderPlaylist(
  db: Database.Database,
  playlistId: number,
  itemIds: number[]
): { ok: true } | { error: PlaylistError } {
  if (!getRow(db, playlistId)) return { error: "not_found" };
  const current = itemIdsOf(db, playlistId);
  const same = itemIds.length === current.length && new Set(itemIds).size === itemIds.length && itemIds.every((id) => current.includes(id));
  if (!same) return { error: "invalid_order" };
  db.transaction(() => {
    renumber(db, playlistId, itemIds);
    touch(db, playlistId);
  })();
  return { ok: true };
}

/** Le titre fait-il partie de la playlist ? */
function contains(db: Database.Database, playlistId: number, itemId: number): boolean {
  return Boolean(db.prepare(`SELECT 1 FROM playlist_items WHERE playlist_id = ? AND item_id = ?`).get(playlistId, itemId));
}

/**
 * v2 FR-9 : « Je regarde ça » depuis une playlist : le titre passe à vu (le statut d'avant est
 * rendu, pour l'annulation), la playlist devient la plus récente, le geste est journalisé.
 */
export function watchFromPlaylist(
  db: Database.Database,
  playlistId: number,
  itemId: number,
  source: PlaylistSource = "playlist"
): { previous: "Watched" | "Unwatched" } | { error: PlaylistError } {
  if (!getRow(db, playlistId) || !contains(db, playlistId, itemId)) return { error: "not_found" };
  const item = getItemsByIds(db, [itemId])[0];
  if (!item) return { error: "not_found" };
  db.transaction(() => {
    updateItem(db, itemId, { watchStatus: "Watched" });
    touch(db, playlistId);
    logEvent(db, "playlist_watched", "item", itemId, { playlistId, source });
  })();
  return { previous: item.watchStatus === "Watched" ? "Watched" : "Unwatched" };
}

/** v2 FR-7 : note (0 pour 💩, 1 à 5) d'un titre vu de la playlist ; rend la note d'avant. */
export function rateFromPlaylist(
  db: Database.Database,
  playlistId: number,
  itemId: number,
  stars: number
): { previous: string | null; rating: string } | { error: PlaylistError } {
  if (!Number.isInteger(stars) || stars < 0 || stars > 5) return { error: "invalid_rating" };
  if (!getRow(db, playlistId) || !contains(db, playlistId, itemId)) return { error: "not_found" };
  const item = getItemsByIds(db, [itemId])[0];
  if (!item) return { error: "not_found" };
  db.transaction(() => {
    updateItem(db, itemId, { rating: RATING_SCALE[stars] });
    touch(db, playlistId);
    logEvent(db, "playlist_rated", "item", itemId, { playlistId, stars });
  })();
  return { previous: item.rating, rating: RATING_SCALE[stars] };
}

/**
 * v2 FR-10 : la playlist en cours, celle qui a un titre non vu et le geste le plus récent ; null
 * si aucune n'a de titre à voir.
 */
/** La dernière playlist modifiée, même vide ou finie (accueil, audit UX W2-8). */
export function latestPlaylist(db: Database.Database): PlaylistDetail | null {
  const row = db.prepare(`SELECT id FROM playlists ORDER BY updated_at DESC, id DESC LIMIT 1`).get() as { id: number } | undefined;
  return row ? getPlaylist(db, row.id) : null;
}

export function currentPlaylist(db: Database.Database): PlaylistDetail | null {
  const rows = db.prepare(`SELECT id FROM playlists ORDER BY updated_at DESC, id DESC`).all() as { id: number }[];
  for (const { id } of rows) {
    const playlist = getPlaylist(db, id);
    if (playlist && playlist.nextId !== null) return playlist;
  }
  return null;
}

/** Ce qui rapproche une suggestion de la playlist, en une phrase. */
export type PlaylistSuggestion = LibraryItem & { reason: string | null };

const FEATURE_WEIGHT = { director: 4, keyword: 2, cast: 1.5, genre: 1 } as const;
type FeatureKind = keyof typeof FEATURE_WEIGHT;

/**
 * v2 FR-5 : jusqu'à `limit` titres de la bibliothèque, absents de la playlist et non écartés, les
 * plus proches de ceux qu'elle contient. La proximité additionne les traits partagés (réalisation,
 * mots-clés, distribution, genres), pondérés par leur poids et par leur fréquence dans la
 * playlist. Rien sous deux titres (EC-3). Depuis le cache TMDB, sans réseau (NFR-2).
 */
export function suggestForPlaylist(db: Database.Database, playlistId: number, limit = 8): PlaylistSuggestion[] {
  const inside = itemIdsOf(db, playlistId);
  if (inside.length < 2) return [];
  const dismissed = new Set(
    (db.prepare(`SELECT item_id FROM playlist_suggestion_dismissals WHERE playlist_id = ?`).all(playlistId) as { item_id: number }[]).map(
      (r) => r.item_id
    )
  );
  const titles = loadModelTitles(db, "1 = 1");
  const insideSet = new Set(inside);
  const traitsOf = (t: (typeof titles)[number]): [FeatureKind, string][] => [
    ...t.directors.map((v): [FeatureKind, string] => ["director", v]),
    ...t.keywords.map((v): [FeatureKind, string] => ["keyword", v]),
    ...t.cast.slice(0, 5).map((v): [FeatureKind, string] => ["cast", v]),
    ...t.genres.map((v): [FeatureKind, string] => ["genre", v]),
  ];

  // Ce que la playlist a en commun : chaque trait, la part de ses titres qui le portent.
  const profile = new Map<string, number>();
  const members = titles.filter((t) => insideSet.has(t.id));
  for (const t of members) {
    for (const [kind, value] of new Map(traitsOf(t).map(([k, v]) => [`${k}:${v}`, [k, v] as const])).values()) {
      const key = `${kind}:${value}`;
      profile.set(key, (profile.get(key) ?? 0) + 1 / members.length);
    }
  }

  const scored = titles
    .filter((t) => !insideSet.has(t.id) && !dismissed.has(t.id))
    .map((t) => {
      let score = 0;
      let best: { kind: FeatureKind; value: string; weight: number } | null = null;
      for (const [kind, value] of traitsOf(t)) {
        const share = profile.get(`${kind}:${value}`);
        if (!share) continue;
        const weight = FEATURE_WEIGHT[kind] * share;
        score += weight;
        if (!best || weight > best.weight) best = { kind, value, weight };
      }
      return { id: t.id, score, best };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  const items = new Map(getItemsByIds(db, scored.map((s) => s.id)).map((item) => [item.id, item]));
  return scored
    .map((s) => {
      const item = items.get(s.id);
      if (!item) return null;
      const reason = !s.best
        ? null
        : s.best.kind === "director"
          ? `Même réalisation : ${s.best.value}`
          : s.best.kind === "cast"
            ? `Avec ${s.best.value}`
            : s.best.kind === "keyword"
              ? "Même univers"
              : "Même genre";
      return { ...item, reason };
    })
    .filter((s): s is PlaylistSuggestion => s !== null);
}

/** v2 FR-5 : « Pas celui-là » écarte un titre des suggestions de cette playlist. */
export function dismissSuggestion(db: Database.Database, playlistId: number, itemId: number): { ok: true } | { error: PlaylistError } {
  if (!getRow(db, playlistId)) return { error: "not_found" };
  db.prepare(`INSERT OR IGNORE INTO playlist_suggestion_dismissals (playlist_id, item_id) VALUES (?, ?)`).run(playlistId, itemId);
  return { ok: true };
}

/** Correspondance erreur → statut HTTP. */
export function playlistErrorStatus(error: PlaylistError): number {
  return error === "not_found" ? 404 : 400;
}
