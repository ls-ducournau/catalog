import type Database from "better-sqlite3";
import { coveredProviderIds } from "./availability";
import { listFrenchProviders } from "./tmdb";

// Réglages de l'utilisateur, stockés localement — spec: specs/disponibilite-streaming-v1.md (FR-3)

const SUBSCRIPTIONS_KEY = "streaming_subscriptions";

/** Identifiants TMDB des services auxquels l'utilisateur est abonné. */
export function getSubscriptions(db: Database.Database): number[] {
  const row = db.prepare(`SELECT value FROM settings WHERE key = ?`).get(SUBSCRIPTIONS_KEY) as
    | { value: string }
    | undefined;
  if (!row) return [];
  try {
    const ids = JSON.parse(row.value);
    return Array.isArray(ids) ? ids.filter((id): id is number => Number.isInteger(id)) : [];
  } catch {
    return [];
  }
}

export function setSubscriptions(db: Database.Database, ids: number[]): number[] {
  const clean = [...new Set(ids.filter((id) => Number.isInteger(id) && id > 0))];
  db.prepare(
    `INSERT INTO settings (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).run(SUBSCRIPTIONS_KEY, JSON.stringify(clean));
  return clean;
}

/**
 * FR-4/FR-5 : services couverts par tes abonnements, formules avec publicité comprises —
 * c'est cette liste que les filtres « sur mes abonnements » appliquent.
 */
export async function getCoveredServiceIds(db: Database.Database): Promise<number[]> {
  const subscriptions = getSubscriptions(db);
  if (subscriptions.length === 0) return [];
  return [...coveredProviderIds(subscriptions, await listFrenchProviders())];
}
