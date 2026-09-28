import { readFileSync } from "node:fs";
import Database from "better-sqlite3";

/**
 * Backfill local des caractéristiques TMDB (spec recommendations-v1 FR-23) pour tous les items
 * qui ont un tmdb_id mais pas encore de `tmdb_features`. Aucun appel Notion : la colonne est
 * purement locale. Relançable sans risque, il ne traite que ce qui manque.
 *
 * Usage : node scripts/backfill-tmdb-features.mjs
 */

for (const line of readFileSync(new URL("../.env", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const token = process.env.TMDB_ACCESS_TOKEN;
const CAST_SIZE = 8; // même valeur que FEATURES_CAST_SIZE dans src/lib/tmdb.ts
const PRODUCERS_SIZE = 4; // même valeur que FEATURES_PRODUCERS_SIZE
const CONCURRENCY = 8;

const person = (p) => ({ id: p.id, name: p.name, profilePath: p.profile_path ?? null });

/** Même forme que `getTmdbFeatures` (src/lib/tmdb.ts). */
async function fetchFeatures(tmdbId, type) {
  const isMovie = type === "Movie";
  const url = isMovie
    ? `${TMDB_API_BASE}/movie/${tmdbId}?append_to_response=keywords,credits`
    : `${TMDB_API_BASE}/tv/${tmdbId}?append_to_response=keywords,aggregate_credits`;
  const res = await fetch(url, {
    headers: { accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const d = await res.json();

  const keywords = (isMovie ? d.keywords?.keywords : d.keywords?.results) ?? [];
  const cast = (isMovie ? d.credits?.cast : d.aggregate_credits?.cast) ?? [];
  const directors = isMovie
    ? (d.credits?.crew ?? []).filter((c) => c.job === "Director")
    : (d.created_by ?? []);
  const date = isMovie ? d.release_date : d.first_air_date;
  const producers = isMovie
    ? (d.credits?.crew ?? []).filter((c) => c.job === "Producer")
    : (d.aggregate_credits?.crew ?? []).filter((c) => (c.jobs ?? []).some((j) => j.job === "Executive Producer"));

  return {
    genres: (d.genres ?? []).map((g) => g.name),
    keywords: keywords.map((k) => k.name),
    cast: cast.slice(0, CAST_SIZE).map(person),
    directors: directors.map(person),
    producers: producers.slice(0, PRODUCERS_SIZE).map(person),
    year: date ? Number(date.slice(0, 4)) || null : null,
    runtime: isMovie ? d.runtime ?? null : (d.episode_run_time ?? [])[0] ?? null,
    language: d.original_language ?? null,
    countries: isMovie ? (d.production_countries ?? []).map((c) => c.iso_3166_1) : d.origin_country ?? [],
    voteAverage: typeof d.vote_average === "number" ? d.vote_average : null,
    voteCount: typeof d.vote_count === "number" ? d.vote_count : null,
    popularity: typeof d.popularity === "number" ? d.popularity : null,
  };
}

const dbPath = new URL("../data/watchlist.db", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const db = new Database(dbPath);

const columns = db.prepare(`PRAGMA table_info(items)`).all().map((c) => c.name);
if (!columns.includes("tmdb_features")) {
  db.exec(`ALTER TABLE items ADD COLUMN tmdb_features TEXT`);
}

// Sans caractéristiques, ou avec des caractéristiques antérieures à la production.
const rows = db
  .prepare(`SELECT id, name, type, tmdb_id, tmdb_features FROM items WHERE tmdb_id IS NOT NULL`)
  .all()
  .filter((r) => r.tmdb_features === null || !("producers" in JSON.parse(r.tmdb_features)));
console.log(`À traiter : ${rows.length} items (sans caractéristiques, ou sans la production)`);

const update = db.prepare(`UPDATE items SET tmdb_features = ? WHERE id = ?`);
let done = 0;
const failed = [];

const queue = [...rows];
async function worker() {
  while (queue.length > 0) {
    const row = queue.pop();
    try {
      const features = await fetchFeatures(row.tmdb_id, row.type);
      if (features) update.run(JSON.stringify(features), row.id);
      else failed.push(row.name);
    } catch (err) {
      failed.push(`${row.name} (${err.message})`);
    }
    if (++done % 150 === 0) console.log(`  ${done}/${rows.length}...`);
  }
}
await Promise.all(Array.from({ length: CONCURRENCY }, worker));

console.log(`\nTerminé : ${done - failed.length}/${rows.length} enrichis, ${failed.length} échecs.`);
if (failed.length > 0) console.log("Échecs :", failed.slice(0, 20).join(", "));
