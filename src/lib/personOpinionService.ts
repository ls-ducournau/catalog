import type Database from "better-sqlite3";
import { centeredOpinions, opinionValue } from "./personPreference";

// Avis sur les personnes — spec: specs/tri-rapide-v1.md (FR-4, FR-7), specs/classement-v1.md
// (FR-12 réinitialiser, FR-13 noter). Local seulement, jamais envoyé à Notion.

export type OpinionRow = { personId: number; name: string; opinion: 1 | -1; rating: number | null; updatedAt: string };

export function isRating(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 5;
}

/**
 * Enregistre un avis. `rating` : note d'une personne aimée (FR-13) ; absent, la note existante est
 * gardée ; un « je n'aime pas » efface toujours la note.
 */
export function setOpinion(
  db: Database.Database,
  person: { id: number; name: string },
  opinion: 1 | -1,
  rating?: number | null
): void {
  const now = new Date().toISOString();
  if (opinion === -1 || rating !== undefined) {
    const kept = opinion === -1 ? null : (rating ?? null);
    db.prepare(
      `INSERT INTO person_opinions (person_id, name, opinion, updated_at, rating) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(person_id) DO UPDATE SET opinion = excluded.opinion, updated_at = excluded.updated_at, rating = excluded.rating`
    ).run(person.id, person.name, opinion, now, kept);
    return;
  }
  db.prepare(
    `INSERT INTO person_opinions (person_id, name, opinion, updated_at) VALUES (?, ?, ?, ?)
     ON CONFLICT(person_id) DO UPDATE SET opinion = excluded.opinion, updated_at = excluded.updated_at`
  ).run(person.id, person.name, opinion, now);
}

export function clearOpinion(db: Database.Database, personId: number): void {
  db.prepare(`DELETE FROM person_opinions WHERE person_id = ?`).run(personId);
}

/** FR-12 : efface tous les « j'aime » ou tous les « je n'aime pas », et rend ce qui a été effacé. */
export function resetOpinions(db: Database.Database, side: "liked" | "disliked"): OpinionRow[] {
  const opinion = side === "liked" ? 1 : -1;
  return db.transaction(() => {
    const rows = db
      .prepare(`SELECT person_id, name, opinion, rating, updated_at FROM person_opinions WHERE opinion = ?`)
      .all(opinion) as { person_id: number; name: string; opinion: 1 | -1; rating: number | null; updated_at: string }[];
    db.prepare(`DELETE FROM person_opinions WHERE opinion = ?`).run(opinion);
    return rows.map((r) => ({ personId: r.person_id, name: r.name, opinion: r.opinion, rating: r.rating, updatedAt: r.updated_at }));
  })();
}

/** FR-12 : « Annuler » rétablit les avis exactement (avis, note, date). */
export function restoreOpinions(db: Database.Database, rows: OpinionRow[]): void {
  const insert = db.prepare(
    `INSERT INTO person_opinions (person_id, name, opinion, updated_at, rating) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(person_id) DO UPDATE SET name = excluded.name, opinion = excluded.opinion,
       updated_at = excluded.updated_at, rating = excluded.rating`
  );
  db.transaction(() => {
    for (const r of rows) insert.run(r.personId, r.name, r.opinion, r.updatedAt, r.opinion === 1 && isRating(r.rating) ? r.rating : null);
  })();
}

export function getOpinions(db: Database.Database): Map<number, 1 | -1> {
  const rows = db.prepare(`SELECT person_id, opinion FROM person_opinions`).all() as {
    person_id: number;
    opinion: 1 | -1;
  }[];
  return new Map(rows.map((r) => [r.person_id, r.opinion]));
}

/**
 * Poids des avis dans le classement (FR-7) : centrés, pour qu'un « j'aime » donné à presque tout
 * le monde ne devienne pas une prime aux castings célèbres. Sur le banc, brut ou centré ne change
 * rien à la prédiction des notes (+0,001 / −0,000) : c'est ce biais qui a décidé. La note d'une
 * personne aimée module son poids (classement-v1 FR-13).
 */
export function getOpinionWeights(db: Database.Database): Map<number, number> {
  const rows = db.prepare(`SELECT person_id, opinion, rating FROM person_opinions`).all() as {
    person_id: number;
    opinion: 1 | -1;
    rating: number | null;
  }[];
  return centeredOpinions(new Map(rows.map((r) => [r.person_id, opinionValue(r.opinion, r.rating)])));
}
