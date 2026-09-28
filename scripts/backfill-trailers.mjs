import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { chooseTrailer, interpretOEmbed, rankTrailers, TRAILER_VIDEO_LANGUAGES } from "../src/lib/trailer.ts";

/**
 * Bandes-annonces (spec bandes-annonces-v1 FR-2) pour les items qui ne les ont jamais cherchées.
 * Local uniquement : rien n'est envoyé vers Notion. Relançable : ne reprend que ce qui manque.
 * Le choix de la vidéo est celui de l'app (src/lib/trailer.ts), importé tel quel.
 *
 * FR-8 : parmi les vidéos du titre, la meilleure que sa chaîne laisse lire hors de YouTube
 * (point d'accès public oEmbed, comme src/lib/youtube.ts) ; à défaut, la meilleure réservée à
 * YouTube, marquée comme telle.
 *
 * Usage : node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/backfill-trailers.mjs [--recheck]
 *   --recheck : revérifie tous les titres (pas seulement ceux jamais cherchés).
 */

for (const line of readFileSync(new URL("../.env", import.meta.url), "utf-8").split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const token = process.env.TMDB_ACCESS_TOKEN;
const CONCURRENCY = 6;

const recheck = process.argv.includes("--recheck");

async function checkYouTube(key) {
  try {
    const url = `https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(`https://www.youtube.com/watch?v=${key}`)}`;
    const res = await fetch(url, { signal: AbortSignal.timeout(4000) });
    return interpretOEmbed(res.status, res.ok ? await res.json() : null);
  } catch {
    return { state: "unknown" };
  }
}

async function fetchTrailer(tmdbId, type) {
  const path = type === "Movie" ? "movie" : "tv";
  const res = await fetch(`${TMDB_API_BASE}/${path}/${tmdbId}/videos?include_video_language=${TRAILER_VIDEO_LANGUAGES}`, {
    headers: { accept: "application/json", Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return undefined;
  const trailer = await chooseTrailer(rankTrailers((await res.json()).results), checkYouTube);
  return { trailer, fetchedAt: new Date().toISOString() };
}

const dbPath = new URL("../data/watchlist.db", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const db = new Database(dbPath);

const columns = db.prepare(`PRAGMA table_info(items)`).all().map((c) => c.name);
if (!columns.includes("trailer_info")) {
  db.exec(`ALTER TABLE items ADD COLUMN trailer_info TEXT`);
}

const rows = db
  .prepare(
    `SELECT id, name, type, tmdb_id, trailer_info FROM items WHERE tmdb_id IS NOT NULL${recheck ? "" : " AND trailer_info IS NULL"}`
  )
  .all();
console.log(`À traiter : ${rows.length} items${recheck ? " (revérification complète)" : " sans bande-annonce cherchée"}`);
let changed = 0;
let restricted = 0;

const update = db.prepare(`UPDATE items SET trailer_info = ? WHERE id = ?`);
let done = 0;
let found = 0;
let french = 0;
const failed = [];

const queue = [...rows];
async function worker() {
  while (queue.length > 0) {
    const row = queue.pop();
    try {
      const info = await fetchTrailer(row.tmdb_id, row.type);
      if (info) {
        const before = row.trailer_info ? JSON.parse(row.trailer_info).trailer?.key ?? null : null;
        if (before !== (info.trailer?.key ?? null)) changed++;
        if (info.trailer?.embeddable === false) restricted++;
        update.run(JSON.stringify(info), row.id);
        if (info.trailer) found++;
        if (info.trailer?.language === "fr") french++;
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
  `\nTerminé : ${done - failed.length}/${rows.length} cherchés, ${found} avec bande-annonce (dont ${french} en VF), ` +
    `${changed} remplacées, ${restricted} réservées à YouTube. ${failed.length} échecs.`
);
if (failed.length > 0) console.log("Échecs :", failed.slice(0, 20).join(", "));
