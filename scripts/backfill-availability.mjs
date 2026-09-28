import { readFileSync } from "node:fs";
import Database from "better-sqlite3";

/**
 * Disponibilité streaming en France (spec disponibilite-streaming-v1 FR-1, FR-2) pour les items
 * qui n'en ont pas, ou dont la disponibilité a plus de 7 jours. Local uniquement : rien n'est
 * envoyé vers Notion. Relançable à volonté — c'est aussi le moyen de tout rafraîchir.
 *
 * Source : TMDB, alimenté par JustWatch.
 * Usage : node scripts/backfill-availability.mjs
 */

for (const line of readFileSync(new URL("../.env", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const token = process.env.TMDB_ACCESS_TOKEN;
const REGION = "FR";
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // même valeur que AVAILABILITY_TTL_MS (src/lib/availability.ts)
const CONCURRENCY = 8;

const toProviders = (raw) =>
  Array.isArray(raw)
    ? raw.map((p) => ({ id: p.provider_id, name: p.provider_name, logoPath: p.logo_path ?? null }))
    : [];

/** Même forme que `getAvailability` (src/lib/tmdb.ts). */
async function fetchAvailability(tmdbId, type) {
  const path = type === "Movie" ? "movie" : "tv";
  const res = await fetch(`${TMDB_API_BASE}/${path}/${tmdbId}/watch/providers`, {
    headers: { accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const fr = (await res.json()).results?.[REGION];
  return {
    link: fr?.link ?? null,
    flatrate: toProviders(fr?.flatrate),
    free: toProviders(fr?.free),
    ads: toProviders(fr?.ads),
    rent: toProviders(fr?.rent),
    buy: toProviders(fr?.buy),
    fetchedAt: new Date().toISOString(),
  };
}

const dbPath = new URL("../data/watchlist.db", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const db = new Database(dbPath);

const columns = db.prepare(`PRAGMA table_info(items)`).all().map((c) => c.name);
if (!columns.includes("watch_providers")) {
  db.exec(`ALTER TABLE items ADD COLUMN watch_providers TEXT`);
}

const isStale = (json) => {
  if (!json) return true;
  try {
    return Date.now() - new Date(JSON.parse(json).fetchedAt).getTime() > TTL_MS;
  } catch {
    return true;
  }
};

const rows = db
  .prepare(`SELECT id, name, type, tmdb_id, watch_providers FROM items WHERE tmdb_id IS NOT NULL`)
  .all()
  .filter((r) => isStale(r.watch_providers));
console.log(`À traiter : ${rows.length} items (sans disponibilité, ou de plus de 7 jours)`);

const update = db.prepare(`UPDATE items SET watch_providers = ? WHERE id = ?`);
let done = 0;
let available = 0;
const failed = [];

const queue = [...rows];
async function worker() {
  while (queue.length > 0) {
    const row = queue.pop();
    try {
      const availability = await fetchAvailability(row.tmdb_id, row.type);
      if (availability) {
        update.run(JSON.stringify(availability), row.id);
        if (availability.flatrate.length + availability.free.length + availability.ads.length > 0) available++;
      } else {
        failed.push(row.name);
      }
    } catch (err) {
      failed.push(`${row.name} (${err.message})`);
    }
    if (++done % 150 === 0) console.log(`  ${done}/${rows.length}...`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(
  `\nTerminé : ${done - failed.length}/${rows.length} à jour, dont ${available} inclus dans au moins` +
    ` un abonnement ou gratuits. ${failed.length} échecs.`
);
if (failed.length > 0) console.log("Échecs :", failed.slice(0, 20).join(", "));
