import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { isReleaseStale, releaseFromTmdb } from "../src/lib/release.ts";

/**
 * Dates de sortie (spec sorties-v1 FR-1) pour les items qui n'en ont pas, ou dont les dates ont
 * plus de 7 jours. Local uniquement : rien n'est envoyé vers Notion. Relançable à volonté.
 * La lecture des dates est celle de l'app (src/lib/release.ts), importée telle quelle.
 *
 * Usage : node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/backfill-release.mjs
 */

for (const line of readFileSync(new URL("../.env", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const token = process.env.TMDB_ACCESS_TOKEN;
const CONCURRENCY = 8;

/** Même appel que les dates de `getTitleData` (src/lib/tmdb.ts), sans le reste de la fiche. */
async function fetchRelease(tmdbId, type) {
  const isMovie = type === "Movie";
  const url = isMovie
    ? `${TMDB_API_BASE}/movie/${tmdbId}?append_to_response=release_dates`
    : `${TMDB_API_BASE}/tv/${tmdbId}`;
  const res = await fetch(url, { headers: { accept: "application/json", Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return releaseFromTmdb(await res.json(), isMovie);
}

const dbPath = new URL("../data/watchlist.db", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const db = new Database(dbPath);

const columns = db.prepare(`PRAGMA table_info(items)`).all().map((c) => c.name);
if (!columns.includes("release_info")) {
  db.exec(`ALTER TABLE items ADD COLUMN release_info TEXT`);
}

const parse = (json) => {
  try {
    return json ? JSON.parse(json) : null;
  } catch {
    return null;
  }
};

const rows = db
  .prepare(`SELECT id, name, type, tmdb_id, release_info FROM items WHERE tmdb_id IS NOT NULL`)
  .all()
  .filter((r) => isReleaseStale(parse(r.release_info)));
console.log(`À traiter : ${rows.length} items (sans dates, ou de plus de 7 jours)`);

const update = db.prepare(`UPDATE items SET release_info = ? WHERE id = ?`);
let done = 0;
const failed = [];

const queue = [...rows];
async function worker() {
  while (queue.length > 0) {
    const row = queue.pop();
    try {
      const release = await fetchRelease(row.tmdb_id, row.type);
      if (release) update.run(JSON.stringify(release), row.id);
      else failed.push(row.name);
    } catch (err) {
      failed.push(`${row.name} (${err.message})`);
    }
    if (++done % 150 === 0) console.log(`  ${done}/${rows.length}...`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`\nTerminé : ${done - failed.length}/${rows.length} à jour. ${failed.length} échecs.`);
if (failed.length > 0) console.log("Échecs :", failed.slice(0, 20).join(", "));
