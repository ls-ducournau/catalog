import type Database from "better-sqlite3";
import { DEFAULT_ELO, computeElo } from "./elo";
import { RATING_RANK_SQL } from "./itemService";
import { pairKey, pickPair, RECENT_PAIR_WINDOW } from "./pairSelection";
import { posterUrl, type TmdbFeatures } from "./tmdb";
import type { DuelChoice } from "./duelService";

// Duels d'acteurs — spec: specs/duels-elo-v1.md, amendements v1.2 (FR-18 à FR-22)

/** FR-19 : une préférence doit reposer sur une vraie exposition, pas sur un seul rôle. */
export const MIN_TITLES_PER_PERSON = 3;

export type PersonDuelItem = {
  id: number;
  name: string;
  photoUrl: string | null;
  eloScore: number;
  duelsCount: number;
  /** Titres vus où tu l'as croisé, les mieux notés d'abord (FR-21). */
  seenIn: string[];
};

export type NextPersonDuelResult =
  | { personA: PersonDuelItem; personB: PersonDuelItem }
  | { error: "not_enough_people"; eligibleCount: number };

type Appearance = { id: number; name: string; profilePath: string | null; titles: { name: string; stars: number }[] };

/**
 * Acteurs éligibles, recalculés depuis le casting des titres vus : un titre qui passe « Vu »
 * peut faire entrer un acteur, un titre qui repasse « À voir » peut en faire sortir un.
 */
function eligibleAppearances(db: Database.Database): Appearance[] {
  const rows = db
    .prepare(
      `SELECT name, ${RATING_RANK_SQL} AS stars, tmdb_features
       FROM items WHERE watch_status = 'Watched' AND tmdb_features IS NOT NULL`
    )
    .all() as { name: string; stars: number | null; tmdb_features: string }[];

  const byPerson = new Map<number, Appearance>();
  for (const row of rows) {
    let features: TmdbFeatures;
    try {
      features = JSON.parse(row.tmdb_features) as TmdbFeatures;
    } catch {
      continue;
    }
    for (const person of features.cast) {
      const entry = byPerson.get(person.id) ?? {
        id: person.id,
        name: person.name,
        profilePath: person.profilePath,
        titles: [],
      };
      entry.titles.push({ name: row.name, stars: row.stars ?? -1 });
      byPerson.set(person.id, entry);
    }
  }

  return [...byPerson.values()].filter((p) => p.titles.length >= MIN_TITLES_PER_PERSON);
}

/** Inscrit les nouveaux éligibles (Elo de départ) et rafraîchit nom et photo des autres. */
function syncPeople(db: Database.Database, appearances: Appearance[]): void {
  const upsert = db.prepare(
    `INSERT INTO people (id, name, profile_path, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET name = excluded.name, profile_path = excluded.profile_path`
  );
  const now = new Date().toISOString();
  db.transaction(() => {
    for (const p of appearances) upsert.run(p.id, p.name, p.profilePath, now);
  })();
}

type PersonRow = {
  id: number;
  name: string;
  profile_path: string | null;
  elo_score: number;
  duels_count: number;
};

function toDuelItem(row: PersonRow, appearance: Appearance | undefined): PersonDuelItem {
  return {
    id: row.id,
    name: row.name,
    photoUrl: posterUrl(row.profile_path),
    eloScore: row.elo_score,
    duelsCount: row.duels_count,
    seenIn: [...(appearance?.titles ?? [])]
      .sort((a, b) => b.stars - a.stars)
      .map((t) => t.name),
  };
}

/** FR-18/FR-19/FR-20 : prochaine paire d'acteurs, avec la sélection de paires des titres. */
export function getNextPersonDuel(db: Database.Database): NextPersonDuelResult {
  const appearances = eligibleAppearances(db);
  if (appearances.length < 2) {
    return { error: "not_enough_people", eligibleCount: appearances.length };
  }
  syncPeople(db, appearances);

  const ids = appearances.map((p) => p.id);
  const rows = db
    .prepare(`SELECT id, name, profile_path, elo_score, duels_count FROM people WHERE id IN (${ids.map(() => "?").join(",")})`)
    .all(...ids) as PersonRow[];
  const byId = new Map(rows.map((r) => [r.id, r]));

  const recentPairs = new Set(
    (
      db
        .prepare(`SELECT person_a_id a, person_b_id b FROM person_duels ORDER BY id DESC LIMIT ?`)
        .all(RECENT_PAIR_WINDOW) as { a: number; b: number }[]
    ).map((r) => pairKey(r.a, r.b))
  );

  const pair = pickPair(
    rows.map((r) => ({ id: r.id, duelsCount: r.duels_count })),
    recentPairs
  );
  if (!pair) return { error: "not_enough_people", eligibleCount: appearances.length };

  const appearanceById = new Map(appearances.map((p) => [p.id, p]));
  return {
    personA: toDuelItem(byId.get(pair.itemAId)!, appearanceById.get(pair.itemAId)),
    personB: toDuelItem(byId.get(pair.itemBId)!, appearanceById.get(pair.itemBId)),
  };
}

/** FR-20 : même formule Elo que les titres ; seules les personnes sont touchées. */
export function submitPersonDuelResult(
  db: Database.Database,
  personAId: number,
  personBId: number,
  choice: DuelChoice
): { duelId: number } | null {
  const get = db.prepare(`SELECT elo_score FROM people WHERE id = ?`);
  const a = get.get(personAId) as { elo_score: number } | undefined;
  const b = get.get(personBId) as { elo_score: number } | undefined;
  if (!a || !b) return null;

  let eloA = a.elo_score;
  let eloB = b.elo_score;
  let winnerId: number | null = null;

  if (choice !== "skip") {
    const result = computeElo(a.elo_score, b.elo_score, choice);
    eloA = result.eloAAfter;
    eloB = result.eloBAfter;
    winnerId = choice === "A" ? personAId : personBId;
  }

  const now = new Date().toISOString();
  const update = db.prepare(
    `UPDATE people SET elo_score = ?, duels_count = duels_count + 1, last_duel_at = ?, updated_at = ? WHERE id = ?`
  );

  let duelId = 0;
  db.transaction(() => {
    duelId = Number(
      db
        .prepare(
          `INSERT INTO person_duels (person_a_id, person_b_id, winner_id, elo_a_before, elo_b_before, elo_a_after, elo_b_after, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(personAId, personBId, winnerId, a.elo_score, b.elo_score, eloA, eloB, now).lastInsertRowid
    );
    // Comme pour les titres, un « passer » compte comme une exposition (FR-12).
    update.run(eloA, now, now, personAId);
    update.run(eloB, now, now, personBId);
  })();
  // classement-v1 FR-1 : l'identifiant du duel permet de l'annuler.
  return { duelId };
}

/** Ce que couvre le mode Acteurs : sert à annoncer une réinitialisation. */
export function getPersonScope(db: Database.Database): { eligible: number; scored: number } {
  const eligible = eligibleAppearances(db).length;
  const { scored } = db
    .prepare(`SELECT COUNT(*) scored FROM people WHERE elo_score != ? OR duels_count > 0`)
    .get(DEFAULT_ELO) as { scored: number };
  return { eligible, scored };
}

/** FR-22 : remet l'Elo des acteurs à zéro, avec instantané pour l'annulation. */
export function resetPersonElo(db: Database.Database): { reset: number } {
  const now = new Date().toISOString();
  let reset = 0;

  db.transaction(() => {
    db.prepare(`DELETE FROM person_elo_snapshot`).run();
    db.prepare(
      `INSERT INTO person_elo_snapshot (person_id, elo_score, duels_count, last_duel_at)
       SELECT id, elo_score, duels_count, last_duel_at FROM people
       WHERE elo_score != ? OR duels_count > 0`
    ).run(DEFAULT_ELO);
    reset = db
      .prepare(
        `UPDATE people SET elo_score = ?, duels_count = 0, last_duel_at = NULL, updated_at = ?
         WHERE elo_score != ? OR duels_count > 0`
      )
      .run(DEFAULT_ELO, now, DEFAULT_ELO).changes;
  })();

  return { reset };
}

/** Annule la dernière réinitialisation des acteurs. */
export function restorePersonElo(db: Database.Database): { restored: number } {
  const now = new Date().toISOString();
  let restored = 0;

  db.transaction(() => {
    restored = db
      .prepare(
        `UPDATE people
         SET elo_score = s.elo_score, duels_count = s.duels_count, last_duel_at = s.last_duel_at, updated_at = ?
         FROM person_elo_snapshot s
         WHERE people.id = s.person_id`
      )
      .run(now).changes;
    db.prepare(`DELETE FROM person_elo_snapshot`).run();
  })();

  return { restored };
}
