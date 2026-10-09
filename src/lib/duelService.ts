import type Database from "better-sqlite3";
import { parseGenres } from "./genres";
import { DEFAULT_ELO, computeElo } from "./elo";
import { pickPair, pairKey, RECENT_PAIR_WINDOW, type EligibleItem } from "./pairSelection";
import { categoryFilter } from "./itemService";
import { posterUrl } from "./tmdb";
import type { Category } from "./libraryItem";

// Orchestration des duels — spec: specs/duels-elo-v1.md (FR-3, FR-5..FR-10, amendements v1.1)


export type DuelItem = {
  id: number;
  notionPageId: string;
  name: string;
  year: string | null;
  type: "Movie" | "TV Series";
  /** Genres TMDB, en anglais (affichés avec `genreLabel`). */
  genres: string[];
  posterUrl: string | null;
  eloScore: number;
  duelsCount: number;
};

function toDuelItem(row: {
  id: number;
  notion_page_id: string;
  name: string;
  year: string | null;
  type: string;
  genre: string | null;
  poster_path: string | null;
  elo_score: number;
  duels_count: number;
}): DuelItem {
  return {
    id: row.id,
    notionPageId: row.notion_page_id,
    name: row.name,
    year: row.year,
    genres: parseGenres(row.genre),
    type: row.type as "Movie" | "TV Series",
    posterUrl: posterUrl(row.poster_path),
    eloScore: row.elo_score,
    duelsCount: row.duels_count,
  };
}

function getEligibleItems(db: Database.Database, category?: Category): EligibleItem[] {
  const filter = categoryFilter(category);
  return (
    db
      .prepare(`SELECT id, duels_count FROM items WHERE watch_status = 'Watched'${filter.sql}`)
      .all(...filter.params) as { id: number; duels_count: number }[]
  ).map((r) => ({ id: r.id, duelsCount: r.duels_count }));
}

function getRecentPairs(db: Database.Database): Set<string> {
  const rows = db
    .prepare(
      `SELECT item_a_id, item_b_id FROM duels ORDER BY id DESC LIMIT ?`
    )
    .all(RECENT_PAIR_WINDOW) as { item_a_id: number; item_b_id: number }[];
  return new Set(rows.map((r) => pairKey(r.item_a_id, r.item_b_id)));
}

export type NextDuelResult =
  | { itemA: DuelItem; itemB: DuelItem }
  | { error: "not_enough_watched_items"; eligibleCount: number };

/** FR-3, FR-5, AC-1, AC-2 : sélectionne la prochaine paire, dans la catégorie demandée (FR-16). */
export function getNextDuel(db: Database.Database, category?: Category): NextDuelResult {
  const eligible = getEligibleItems(db, category);
  if (eligible.length < 2) {
    return { error: "not_enough_watched_items", eligibleCount: eligible.length };
  }

  const recentPairs = getRecentPairs(db);
  const pair = pickPair(eligible, recentPairs);
  if (!pair) {
    return { error: "not_enough_watched_items", eligibleCount: eligible.length };
  }

  const getItem = db.prepare(`SELECT * FROM items WHERE id = ?`);
  const itemA = toDuelItem(getItem.get(pair.itemAId) as Parameters<typeof toDuelItem>[0]);
  const itemB = toDuelItem(getItem.get(pair.itemBId) as Parameters<typeof toDuelItem>[0]);

  return { itemA, itemB };
}

export type DuelChoice = "A" | "B" | "skip";

/** FR-7, FR-8, FR-9, FR-10, EC-5: applique le résultat d'un duel. */
export function submitDuelResult(
  db: Database.Database,
  itemAId: number,
  itemBId: number,
  choice: DuelChoice
): { itemA: DuelItem; itemB: DuelItem; duelId: number } {
  const getItem = db.prepare(`SELECT * FROM items WHERE id = ?`);
  const before = {
    a: getItem.get(itemAId) as { elo_score: number },
    b: getItem.get(itemBId) as { elo_score: number },
  };

  let eloAAfter = before.a.elo_score;
  let eloBAfter = before.b.elo_score;
  let winnerId: number | null = null;

  if (choice !== "skip") {
    const winner = choice === "A" ? "A" : "B";
    const result = computeElo(before.a.elo_score, before.b.elo_score, winner);
    eloAAfter = result.eloAAfter;
    eloBAfter = result.eloBAfter;
    winnerId = choice === "A" ? itemAId : itemBId;
  }

  const now = new Date().toISOString();

  let duelId = 0;
  const tx = db.transaction(() => {
    // classement-v1 FR-1 : l'identifiant du duel permet de l'annuler.
    duelId = Number(
      db
        .prepare(
          `INSERT INTO duels (item_a_id, item_b_id, winner_id, elo_a_before, elo_b_before, elo_a_after, elo_b_after, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(itemAId, itemBId, winnerId, before.a.elo_score, before.b.elo_score, eloAAfter, eloBAfter, now)
        .lastInsertRowid
    );

    // duels_count est incrémenté même sur skip : l'item a bien été proposé/exposé (FR-12).
    // local_dirty marque l'item pour le prochain push Notion (FR-13), uniquement si l'Elo a changé.
    db.prepare(
      `UPDATE items SET elo_score = ?, duels_count = duels_count + 1, last_duel_at = ?, updated_at = ?, local_dirty = local_dirty OR ?
       WHERE id = ?`
    ).run(eloAAfter, now, now, choice !== "skip" ? 1 : 0, itemAId);

    db.prepare(
      `UPDATE items SET elo_score = ?, duels_count = duels_count + 1, last_duel_at = ?, updated_at = ?, local_dirty = local_dirty OR ?
       WHERE id = ?`
    ).run(eloBAfter, now, now, choice !== "skip" ? 1 : 0, itemBId);
  });

  tx();

  return {
    itemA: toDuelItem(getItem.get(itemAId) as Parameters<typeof toDuelItem>[0]),
    itemB: toDuelItem(getItem.get(itemBId) as Parameters<typeof toDuelItem>[0]),
    duelId,
  };
}

export type DuelScope = {
  /** Titres vus de la catégorie : ceux qui peuvent entrer en duel. */
  watched: number;
  /** Titres de la catégorie dont l'Elo a déjà bougé : ceux qu'une réinitialisation touche. */
  scored: number;
};

/** Ce que couvre une catégorie de duel : sert à dire ce qu'une réinitialisation va toucher. */
export function getDuelScope(db: Database.Database, category?: Category): DuelScope {
  const filter = categoryFilter(category);
  const row = db
    .prepare(
      `SELECT SUM(watch_status = 'Watched') watched,
              SUM(elo_score != ? OR duels_count > 0) scored
       FROM items WHERE 1 = 1${filter.sql}`
    )
    .get(DEFAULT_ELO, ...filter.params) as { watched: number | null; scored: number | null };
  return { watched: row.watched ?? 0, scored: row.scored ?? 0 };
}

/**
 * FR-17 : remet l'Elo à son point de départ pour une catégorie (ou tout).
 *
 * Les scores d'avant sont copiés dans `elo_snapshot` dans la même transaction : l'opération
 * reste annulable par `restoreElo`. L'historique des duels est conservé — ce sont des jugements
 * réels, qui restent utiles même quand on repart de zéro pour le classement.
 * Seuls les items dont l'Elo change sont marqués pour le prochain envoi vers Notion.
 */
export function resetElo(db: Database.Database, category?: Category): { reset: number } {
  const filter = categoryFilter(category);
  const scope = `(elo_score != ? OR duels_count > 0)${filter.sql}`;
  const scopeParams = [DEFAULT_ELO, ...filter.params];
  const now = new Date().toISOString();

  let reset = 0;
  db.transaction(() => {
    db.prepare(`DELETE FROM elo_snapshot`).run();
    db.prepare(
      `INSERT INTO elo_snapshot (item_id, elo_score, duels_count, last_duel_at)
       SELECT id, elo_score, duels_count, last_duel_at FROM items WHERE ${scope}`
    ).run(...scopeParams);

    // SQLite évalue le SET sur les anciennes valeurs : local_dirty voit l'Elo d'avant.
    reset = db
      .prepare(
        `UPDATE items
         SET local_dirty = CASE WHEN elo_score != ? THEN 1 ELSE local_dirty END,
             elo_score = ?, duels_count = 0, last_duel_at = NULL, updated_at = ?
         WHERE ${scope}`
      )
      .run(DEFAULT_ELO, DEFAULT_ELO, now, ...scopeParams).changes;
  })();

  return { reset };
}

/** Annule la dernière réinitialisation : chaque item retrouve son Elo et son compteur d'avant. */
export function restoreElo(db: Database.Database): { restored: number } {
  const now = new Date().toISOString();

  let restored = 0;
  db.transaction(() => {
    restored = db
      .prepare(
        `UPDATE items
         SET elo_score = s.elo_score, duels_count = s.duels_count, last_duel_at = s.last_duel_at,
             updated_at = ?, local_dirty = 1
         FROM elo_snapshot s
         WHERE items.id = s.item_id`
      )
      .run(now).changes;
    db.prepare(`DELETE FROM elo_snapshot`).run();
  })();

  return { restored };
}
