import type Database from "better-sqlite3";
import { SURFACES, type Surface } from "./impressionKeys";
import { fatigueWeight } from "./listShaping";

// Fraîcheur des recommandations — spec: specs/recommandations-fraicheur-v1.md (FR-1 à FR-7, NFR-2)

/** Au plus autant de titres par lot envoyé par le navigateur. */
export const MAX_BATCH = 200;
/** Au-delà de 6 semaines, un jour montré ne pèse plus que 2 % (`fatigueWeight`) : il n'est plus lu. */
const FATIGUE_MEMORY_DAYS = 42;
/** Les impressions plus anciennes sont purgées à l'écriture (NFR-2). */
const RETENTION_DAYS = 90;
/** FR-3 : la journée commence à 4 h, pour qu'une soirée qui déborde minuit reste la même. */
const DAY_START_HOURS = 4;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Clé d'un sujet, la même côté navigateur et côté serveur (cf. `impressionKeys.ts`). */
const SUBJECT_KEY = /^(item):([1-9]\d*)$|^(tmdb):((?:movie|tv):[1-9]\d*)$/;

function parseSubjectKey(key: unknown): { type: "item" | "tmdb"; id: string } | null {
  if (typeof key !== "string") return null;
  const match = key.match(SUBJECT_KEY);
  if (!match) return null;
  return match[1] ? { type: "item", id: match[2] } : { type: "tmdb", id: match[4] };
}

/** FR-3 : le jour d'exposition d'un instant, en date locale décalée de 4 h (« 2026-10-09 »). */
export function exposureDay(at: Date): string {
  const shifted = new Date(at.getTime() - DAY_START_HOURS * 60 * 60 * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${shifted.getFullYear()}-${pad(shifted.getMonth() + 1)}-${pad(shifted.getDate())}`;
}

/** Valide la surface d'un corps de requête. */
export function parseSurface(value: unknown): Surface | null {
  return SURFACES.includes(value as Surface) ? (value as Surface) : null;
}

/**
 * FR-2 : enregistre un lot de titres montrés. Au plus une ligne par titre et par jour : la
 * première surface l'emporte, un doublon est ignoré (EC-4). Renvoie le nombre de lignes créées.
 */
export function recordImpressions(
  db: Database.Database,
  surface: Surface,
  keys: unknown[],
  now: Date = new Date()
): number {
  const subjects = keys
    .slice(0, MAX_BATCH)
    .map(parseSubjectKey)
    .filter((s) => s !== null);
  const day = exposureDay(now);
  const insert = db.prepare(
    `INSERT OR IGNORE INTO impressions (subject_type, subject_id, day, surface) VALUES (?, ?, ?, ?)`
  );

  return db.transaction(() => {
    let created = 0;
    for (const s of subjects) created += insert.run(s.type, s.id, day, surface).changes;
    db.prepare(`DELETE FROM impressions WHERE day < ?`).run(
      exposureDay(new Date(now.getTime() - RETENTION_DAYS * DAY_MS))
    );
    return created;
  })();
}

/** Valide le titre d'une fiche ouverte (FR-4). */
export function parseOpenedSubject(key: unknown): { type: "item" | "tmdb"; id: string } | null {
  return parseSubjectKey(key);
}

/** Jours écoulés entre deux jours d'exposition (« 2026-10-01 », « 2026-10-09 » : 8). */
function daysBetween(from: string, to: string): number {
  const utc = (day: string) => Date.UTC(Number(day.slice(0, 4)), Number(day.slice(5, 7)) - 1, Number(day.slice(8, 10)));
  return Math.round((utc(to) - utc(from)) / DAY_MS);
}

/**
 * FR-5, FR-7 : pour chaque titre, les jours où il a été montré, aujourd'hui exclu et après son
 * dernier geste (FR-4 : tout événement du journal qui le concerne), chacun pondéré par son
 * ancienneté : 1 pour hier, 0,5 il y a 8 jours. Clés : `itemExposureKey`, `tmdbExposureKey`.
 */
export function getExposure(db: Database.Database, now: Date = new Date()): Map<string, number> {
  const today = exposureDay(now);
  const since = exposureDay(new Date(now.getTime() - FATIGUE_MEMORY_DAYS * DAY_MS));

  const shown = db
    .prepare(`SELECT subject_type, subject_id, day FROM impressions WHERE day >= ? AND day < ?`)
    .all(since, today) as { subject_type: string; subject_id: string; day: string }[];
  if (shown.length === 0) return new Map();

  // Un jour de marge : `created_at` est en UTC, le jour d'exposition en heure locale.
  const gestures = db
    .prepare(
      `SELECT subject_type, subject_id, MAX(created_at) at FROM events
       WHERE subject_type IN ('item', 'tmdb') AND created_at >= ?
       GROUP BY subject_type, subject_id`
    )
    .all(new Date(now.getTime() - (FATIGUE_MEMORY_DAYS + 1) * DAY_MS).toISOString()) as {
    subject_type: string;
    subject_id: string;
    at: string;
  }[];
  const lastGestureDay = new Map(
    gestures.map((g) => [`${g.subject_type}:${g.subject_id}`, exposureDay(new Date(g.at))])
  );

  const exposure = new Map<string, number>();
  for (const row of shown) {
    const key = `${row.subject_type}:${row.subject_id}`;
    const gesture = lastGestureDay.get(key);
    // Un geste efface aussi les impressions du jour où il a eu lieu : le titre t'a intéressé.
    if (gesture !== undefined && row.day <= gesture) continue;
    exposure.set(key, (exposure.get(key) ?? 0) + fatigueWeight(daysBetween(row.day, today)));
  }
  return exposure;
}
