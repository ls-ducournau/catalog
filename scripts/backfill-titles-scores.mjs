import { readFileSync } from "node:fs";
import Database from "better-sqlite3";

// Charge .env manuellement (pas de dépendance dotenv dans ce script ponctuel)
const envContent = readFileSync(new URL("../.env", import.meta.url), "utf-8");
for (const line of envContent.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const token = process.env.TMDB_ACCESS_TOKEN;

/**
 * Backfill local uniquement (aucun appel Notion, choix explicite de l'utilisateur) : titre FR,
 * synopsis FR, note et nombre de votes, pour tous les items ayant déjà un tmdb_id résolu.
 * Le titre local divergera de celui affiché dans Notion — accepté sciemment, cf. conversation.
 */
async function fetchDetailsFr(tmdbId, type) {
  const path = type === "Movie" ? "movie" : "tv";
  const res = await fetch(`${TMDB_API_BASE}/${path}/${tmdbId}?language=fr-FR`, {
    headers: { accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return null;
  const data = await res.json();
  const title = path === "movie" ? data.title : data.name;
  return {
    title: title || null,
    overview: typeof data.overview === "string" ? data.overview : "",
    voteAverage: typeof data.vote_average === "number" ? data.vote_average : null,
    voteCount: typeof data.vote_count === "number" ? data.vote_count : null,
  };
}

const dbPath = new URL("../data/watchlist.db", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const db = new Database(dbPath);

const rows = db.prepare(`SELECT id, name, type, tmdb_id FROM items WHERE tmdb_id IS NOT NULL`).all();
console.log(`À traiter : ${rows.length} items (avec tmdb_id résolu)`);

const update = db.prepare(
  `UPDATE items SET name = ?, overview = ?, tmdb_rating = ?, vote_count = ? WHERE id = ?`
);

const CONCURRENCY = 8;
let done = 0;
let renamed = 0;
let failed = 0;
const failedItems = [];

async function worker(queue) {
  while (queue.length > 0) {
    const row = queue.pop();
    try {
      const details = await fetchDetailsFr(row.tmdb_id, row.type);
      if (details) {
        const newName = details.title || row.name;
        if (newName !== row.name) renamed++;
        update.run(newName, details.overview, details.voteAverage, details.voteCount, row.id);
      } else {
        failed++;
        failedItems.push(row.name);
      }
    } catch (err) {
      failed++;
      failedItems.push(`${row.name} (${err.message})`);
    }
    done++;
    if (done % 100 === 0) console.log(`  ${done}/${rows.length}...`);
  }
}

const queue = [...rows];
await Promise.all(Array.from({ length: CONCURRENCY }, () => worker(queue)));

console.log(`\nTerminé : ${done} traités, ${renamed} titres passés en français, ${failed} échecs.`);
if (failedItems.length > 0) {
  console.log("Échecs :", failedItems.slice(0, 20).join(", "), failedItems.length > 20 ? "…" : "");
}
