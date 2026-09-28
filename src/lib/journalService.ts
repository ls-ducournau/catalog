import type Database from "better-sqlite3";
import { RATING_RANK_SQL } from "./itemService";

// Journal local des gestes — spec: specs/tri-rapide-v1.md (FR-1, FR-8)

export type EventKind = "added" | "removed" | "rated" | "dismissed" | "undismissed" | "triage";
export type SubjectType = "item" | "tmdb" | "person";

/** D'où vient un ajout : seuls les ajouts issus d'une proposition comptent pour FR-8. */
export type AddSource = "search" | "discover" | "suggestions" | "triage" | "tonight" | "calendar";
const PROPOSAL_SOURCES: AddSource[] = ["discover", "suggestions", "triage"];

export function logEvent(
  db: Database.Database,
  kind: EventKind,
  subjectType: SubjectType,
  subjectId: string | number,
  context?: Record<string, unknown>
): void {
  db.prepare(
    `INSERT INTO events (kind, subject_type, subject_id, context, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(kind, subjectType, String(subjectId), context ? JSON.stringify(context) : null, new Date().toISOString());
}

export type AcceptanceStats = {
  /** Propositions tranchées : ajoutées depuis une proposition, ou écartées. */
  decided: number;
  /** Part gardée (ajoutée plutôt qu'écartée) ; null s'il n'y a rien à mesurer. */
  keptRate: number | null;
  /** Titres gardés que tu as vus et notés depuis. */
  seen: number;
  /** Parmi eux, part notée ⭐⭐⭐⭐ ou plus ; null s'il n'y en a pas. */
  lovedRate: number | null;
};

/**
 * FR-8 : l'équivalent personnel d'un test A/B. Une proposition est « gardée » si elle a été
 * ajoutée depuis la découverte, les suggestions ou le tri rapide, « écartée » sinon ; et une
 * proposition gardée est « réussie » si tu l'as notée ⭐⭐⭐⭐ ou plus après l'avoir vue.
 */
export function acceptanceStats(db: Database.Database): AcceptanceStats {
  const placeholders = PROPOSAL_SOURCES.map(() => "?").join(",");
  const keptIds = (
    db
      .prepare(
        `SELECT DISTINCT CAST(subject_id AS INTEGER) id FROM events
         WHERE kind = 'added' AND subject_type = 'item'
           AND json_extract(context, '$.source') IN (${placeholders})`
      )
      .all(...PROPOSAL_SOURCES) as { id: number }[]
  ).map((r) => r.id);

  const dismissed = (
    db
      .prepare(
        `SELECT COUNT(DISTINCT subject_type || ':' || subject_id) c FROM events WHERE kind = 'dismissed'`
      )
      .get() as { c: number }
  ).c;

  const decided = keptIds.length + dismissed;

  let seen = 0;
  let loved = 0;
  if (keptIds.length > 0) {
    const row = db
      .prepare(
        `SELECT COUNT(*) seen, SUM(${RATING_RANK_SQL} >= 4) loved
         FROM items
         WHERE id IN (${keptIds.map(() => "?").join(",")})
           AND watch_status = 'Watched' AND rating IS NOT NULL`
      )
      .get(...keptIds) as { seen: number; loved: number | null };
    seen = row.seen;
    loved = row.loved ?? 0;
  }

  return {
    decided,
    keptRate: decided > 0 ? keptIds.length / decided : null,
    seen,
    lovedRate: seen > 0 ? loved / seen : null,
  };
}
