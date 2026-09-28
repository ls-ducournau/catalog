import type Database from "better-sqlite3";
import { logEvent } from "./journalService";

// « Ne plus me proposer ça » — spec: specs/tri-rapide-v1.md (FR-2)

/** Un item de ta bibliothèque, ou un titre TMDB hors bibliothèque. */
export type DismissalSubject =
  | { type: "item"; id: number }
  | { type: "tmdb"; mediaType: "Movie" | "TV Series"; tmdbId: number };

/** Clé stable d'un titre TMDB : un même numéro peut désigner un film et une série. */
export function tmdbKey(mediaType: "Movie" | "TV Series", tmdbId: number): string {
  return `${mediaType === "Movie" ? "movie" : "tv"}:${tmdbId}`;
}

/** Valide un sujet venu d'un corps de requête. */
export function parseDismissalSubject(value: unknown): DismissalSubject | null {
  const v = value as Record<string, unknown> | null;
  const isId = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x > 0;
  if (v?.type === "item" && isId(v.id)) return { type: "item", id: v.id };
  if (v?.type === "tmdb" && isId(v.tmdbId) && (v.mediaType === "Movie" || v.mediaType === "TV Series")) {
    return { type: "tmdb", mediaType: v.mediaType, tmdbId: v.tmdbId };
  }
  return null;
}

function subjectId(subject: DismissalSubject): string {
  return subject.type === "item" ? String(subject.id) : tmdbKey(subject.mediaType, subject.tmdbId);
}

export function dismiss(db: Database.Database, subject: DismissalSubject): void {
  db.prepare(
    `INSERT INTO dismissals (subject_type, subject_id, created_at) VALUES (?, ?, ?)
     ON CONFLICT(subject_type, subject_id) DO NOTHING`
  ).run(subject.type, subjectId(subject), new Date().toISOString());
  logEvent(db, "dismissed", subject.type, subjectId(subject));
}

export function undismiss(db: Database.Database, subject: DismissalSubject): void {
  const removed = db
    .prepare(`DELETE FROM dismissals WHERE subject_type = ? AND subject_id = ?`)
    .run(subject.type, subjectId(subject)).changes;
  if (removed > 0) logEvent(db, "undismissed", subject.type, subjectId(subject));
}

/** Tout réafficher (FR-2 : réversible depuis le profil de goûts). */
export function clearDismissals(db: Database.Database): number {
  const rows = db.prepare(`SELECT subject_type, subject_id FROM dismissals`).all() as {
    subject_type: "item" | "tmdb";
    subject_id: string;
  }[];
  db.prepare(`DELETE FROM dismissals`).run();
  for (const row of rows) logEvent(db, "undismissed", row.subject_type, row.subject_id);
  return rows.length;
}

export function countDismissals(db: Database.Database): number {
  return (db.prepare(`SELECT COUNT(*) c FROM dismissals`).get() as { c: number }).c;
}

/** Condition SQL qui écarte des recommandations les items de la bibliothèque écartés. */
export const NOT_DISMISSED_ITEM = `items.id NOT IN (SELECT CAST(subject_id AS INTEGER) FROM dismissals WHERE subject_type = 'item')`;

/** Clés des titres hors bibliothèque écartés (cf. `tmdbKey`). */
export function dismissedTmdbKeys(db: Database.Database): Set<string> {
  return new Set(
    (
      db.prepare(`SELECT subject_id FROM dismissals WHERE subject_type = 'tmdb'`).all() as {
        subject_id: string;
      }[]
    ).map((r) => r.subject_id)
  );
}
