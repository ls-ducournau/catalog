// Import d'une base SQLite de la v1 dans UN compte de la v2 (Supabase). specs/catalog-v2-donnees.md §10.
//
//   node supabase/import/importer.mjs --compte <uuid> [--source <watchlist.db>] [--purger]
//
// - Le compte (auth.users) doit exister déjà ; l'import n'en crée pas.
// - Sans --source, une sauvegarde COHÉRENTE est faite par l'API de SQLite depuis data/watchlist.db
//   (ouvert en lecture seule) : copier le seul fichier .db perdrait les écritures du journal WAL.
// - Le catalogue partagé (fiches TMDB, personnes) est écrit une fois : un second compte le réutilise.
// - Identifiants v1 conservés ; les nouvelles lignes partent de 1 000 000 (0001_schema.sql).
// - --purger efface d'abord les données personnelles de ce compte (jamais celles d'un autre).
// - Aucune clé n'est affichée. Connexion : DATABASE_URL (variable d'environnement ou poc/.env.local).
import { createRequire } from "node:module";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { isDeepStrictEqual } from "node:util";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
const { Client } = require("pg");
const DEPOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..", "..");

const arg = (nom) => {
  const i = process.argv.indexOf(nom);
  return i < 0 ? null : (process.argv[i + 1] ?? true);
};
const compte = arg("--compte");
if (!compte || !/^[0-9a-f-]{36}$/i.test(compte)) throw new Error("usage : --compte <uuid du compte>");

let url = process.env.DATABASE_URL;
if (!url) {
  const f = path.join(DEPOT, "poc", ".env.local");
  url = fs.readFileSync(f, "utf8").split(/\r?\n/).find((l) => l.startsWith("DATABASE_URL="))?.slice(13).trim();
}
if (!url) throw new Error("DATABASE_URL absente");
const clean = (m) => String(m).split(url).join("***");

// --- Source : une sauvegarde cohérente, jamais le fichier vivant.
let sourcePath = typeof arg("--source") === "string" ? arg("--source") : null;
if (!sourcePath) {
  sourcePath = path.join(os.tmpdir(), `catalog-import-${Date.now()}.db`);
  const vivant = new Database(path.join(DEPOT, "data", "watchlist.db"), { readonly: true, fileMustExist: true });
  await vivant.backup(sourcePath);
  vivant.close();
}
const src = new Database(sourcePath, { readonly: true, fileMustExist: true });
const all = (sql) => src.prepare(sql).all();

const ECHELLE = ["💩", "⭐️", "⭐️⭐️", "⭐️⭐️⭐️", "⭐️⭐️⭐️⭐️", "⭐️⭐️⭐️⭐️⭐️"];
const etoiles = (v) => {
  if (v === null || v === undefined) return null;
  const i = ECHELLE.indexOf(v);
  if (i < 0) throw new Error(`note inconnue : ${JSON.stringify(v)}`);
  return i;
};
const json = (t) => (t === null || t === undefined ? null : JSON.parse(t));
const fetchedAt = (t) => json(t)?.fetchedAt ?? null;

const c = new Client({ connectionString: url, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 20000 });
await c.connect();
const q = (sql, p) => c.query(sql, p);

try {
  const existe = (await q(`select 1 from auth.users where id = $1`, [compte])).rowCount;
  if (!existe) throw new Error("ce compte n'existe pas dans auth.users");
  if (arg("--purger")) {
    await q(`delete from public.library_items where user_id = $1`, [compte]);
    for (const t of [
      "playlists", "events", "dismissals", "impressions", "settings", "person_scores", "person_elo_snapshot", "person_duels",
      "person_opinions", "elo_snapshot", "duels", "tier_duels", "tier_rounds", "playlist_items", "playlist_suggestion_dismissals",
    ]) {
      await q(`delete from public.${t} where user_id = $1`, [compte]);
    }
  }
  const deja = Number((await q(`select count(*) n from public.library_items where user_id = $1`, [compte])).rows[0].n);
  if (deja > 0) throw new Error(`ce compte a déjà ${deja} titre(s) : relance avec --purger pour repartir de zéro`);

  const t0 = Date.now();
  await q("begin");
  const items = all(`SELECT * FROM items ORDER BY id`);

  // 1. Catalogue partagé : une fiche par (type, tmdb_id), doublons fusionnés (première valeur non vide ;
  //    JSON daté le plus frais).
  const groupes = new Map();
  for (const it of items) {
    if (it.tmdb_id === null) continue;
    const k = `${it.type}:${it.tmdb_id}`;
    groupes.set(k, [...(groupes.get(k) ?? []), it]);
  }
  const plusFrais = (rows, col) =>
    rows.map((r) => r[col]).filter((v) => v !== null).sort((x, y) => (fetchedAt(y) ?? "").localeCompare(fetchedAt(x) ?? ""))[0] ?? null;
  const premier = (rows, col) => rows.map((r) => r[col]).find((v) => v !== null) ?? null;
  const titreDe = new Map();
  for (const [k, rows] of groupes) {
    const b = rows[0];
    const wp = plusFrais(rows, "watch_providers");
    const ri = plusFrais(rows, "release_info");
    const valeurs = [
      b.type, b.tmdb_id, premier(rows, "imdb_id"), premier(rows, "name"), premier(rows, "year"), premier(rows, "poster_path"),
      premier(rows, "genre"), premier(rows, "director"), premier(rows, "tmdb_rating"), premier(rows, "vote_count"), premier(rows, "overview"),
      premier(rows, "tmdb_features"), wp, fetchedAt(wp), ri, fetchedAt(ri), plusFrais(rows, "trailer_info"),
    ];
    const r = await q(
      `insert into public.catalog_titles (type, tmdb_id, imdb_id, name, year, poster_path, genres, director, tmdb_rating, vote_count, overview,
         tmdb_features, watch_providers, availability_fetched_at, release_info, release_fetched_at, trailer_info)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
       on conflict (type, tmdb_id) do update set tmdb_id = excluded.tmdb_id returning id`,
      valeurs
    );
    titreDe.set(k, r.rows[0].id);
  }
  for (const p of all(`SELECT id, name, profile_path, updated_at FROM people`)) {
    await q(`insert into public.catalog_people (id, name, profile_path, updated_at) values ($1,$2,$3,$4) on conflict (id) do nothing`, [
      p.id, p.name, p.profile_path, p.updated_at,
    ]);
  }

  // 2. Données personnelles, dans l'ordre des dépendances.
  const connus = new Set();
  const ignorees = {};
  for (const it of items) {
    const k = it.tmdb_id === null ? null : `${it.type}:${it.tmdb_id}`;
    const doublon = k !== null && groupes.get(k)[0].id !== it.id;
    await q(
      `insert into public.library_items (user_id, id, title_id, local_name, local_type, local_year, local_genres, watch_status, rating,
         ressenti, elo_score, duels_count, last_duel_at, tier_elo, tier_duels_count, tier_rating, tier_band, import_duplicate, updated_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
      [
        compte, it.id, k ? titreDe.get(k) : null, k ? null : it.name, k ? null : it.type, k ? null : it.year, k ? null : it.genre,
        it.watch_status, etoiles(it.rating), it.ressenti, it.elo_score, it.duels_count, it.last_duel_at, it.tier_elo,
        it.tier_duels_count, etoiles(it.tier_rating), it.tier_band, doublon, it.updated_at,
      ]
    );
    connus.add(it.id);
  }
  const garde = (table, ok) => {
    if (!ok) ignorees[table] = (ignorees[table] ?? 0) + 1;
    return ok;
  };
  for (const s of all(`SELECT * FROM elo_snapshot`)) {
    if (garde("elo_snapshot", connus.has(s.item_id)))
      await q(`insert into public.elo_snapshot values ($1,$2,$3,$4,$5)`, [compte, s.item_id, s.elo_score, s.duels_count, s.last_duel_at]);
  }
  for (const d of all(`SELECT * FROM duels ORDER BY id`)) {
    if (garde("duels", connus.has(d.item_a_id) && connus.has(d.item_b_id)))
      await q(`insert into public.duels values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
        compte, d.id, d.item_a_id, d.item_b_id, d.winner_id, d.elo_a_before, d.elo_b_before, d.elo_a_after, d.elo_b_after, d.created_at,
      ]);
  }
  for (const d of all(`SELECT * FROM tier_duels ORDER BY id`)) {
    if (garde("tier_duels", connus.has(d.item_a_id) && connus.has(d.item_b_id)))
      await q(`insert into public.tier_duels values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [
        compte, d.id, d.item_a_id, d.item_b_id, d.winner_id, etoiles(d.rating), d.elo_a_before, d.elo_b_before, d.elo_a_after, d.elo_b_after, d.created_at,
      ]);
  }
  for (const r of all(`SELECT * FROM tier_rounds ORDER BY id`)) {
    const p = JSON.parse(r.payload);
    for (const e of p.items) {
      e.before.rating = etoiles(e.before.rating);
      e.after.rating = etoiles(e.after.rating);
    }
    await q(`insert into public.tier_rounds values ($1,$2,$3,$4,$5,$6)`, [compte, r.id, etoiles(r.rating), r.kind, JSON.stringify(p), r.created_at]);
  }
  for (const p of all(`SELECT * FROM people`))
    await q(`insert into public.person_scores values ($1,$2,$3,$4,$5,$6)`, [compte, p.id, p.elo_score, p.duels_count, p.last_duel_at, p.updated_at]);
  for (const s of all(`SELECT * FROM person_elo_snapshot`))
    await q(`insert into public.person_elo_snapshot values ($1,$2,$3,$4,$5)`, [compte, s.person_id, s.elo_score, s.duels_count, s.last_duel_at]);
  for (const d of all(`SELECT * FROM person_duels ORDER BY id`))
    await q(`insert into public.person_duels values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [
      compte, d.id, d.person_a_id, d.person_b_id, d.winner_id, d.elo_a_before, d.elo_b_before, d.elo_a_after, d.elo_b_after, d.created_at,
    ]);
  for (const o of all(`SELECT * FROM person_opinions`))
    await q(`insert into public.person_opinions values ($1,$2,$3,$4,$5,$6)`, [compte, o.person_id, o.name, o.opinion, o.rating, o.updated_at]);
  for (const p of all(`SELECT * FROM playlists ORDER BY id`))
    await q(`insert into public.playlists values ($1,$2,$3,$4,$5,$6)`, [compte, p.id, p.name, p.description, p.created_at, p.updated_at]);
  for (const p of all(`SELECT * FROM playlist_items`))
    await q(`insert into public.playlist_items values ($1,$2,$3,$4,$5)`, [compte, p.playlist_id, p.item_id, p.position, p.added_at]);
  for (const p of all(`SELECT * FROM playlist_suggestion_dismissals`))
    await q(`insert into public.playlist_suggestion_dismissals values ($1,$2,$3)`, [compte, p.playlist_id, p.item_id]);
  for (const e of all(`SELECT * FROM events ORDER BY id`))
    await q(`insert into public.events values ($1,$2,$3,$4,$5,$6,$7)`, [compte, e.id, e.kind, e.subject_type, e.subject_id, e.context, e.created_at]);
  for (const d of all(`SELECT * FROM dismissals`))
    await q(`insert into public.dismissals values ($1,$2,$3,$4)`, [compte, d.subject_type, d.subject_id, d.created_at]);
  for (const i of all(`SELECT * FROM impressions`))
    await q(`insert into public.impressions values ($1,$2,$3,$4,$5)`, [compte, i.subject_type, i.subject_id, i.day, i.surface]);
  for (const s of all(`SELECT * FROM settings`)) await q(`insert into public.settings values ($1,$2,$3)`, [compte, s.key, s.value]);

  // 3. Contrôles : mêmes comptes qu'à la source, classement Elo identique ; sinon on annule tout.
  const correspondance = {
    items: "library_items", elo_snapshot: "elo_snapshot", duels: "duels", tier_duels: "tier_duels", tier_rounds: "tier_rounds",
    people: "person_scores", person_duels: "person_duels", person_elo_snapshot: "person_elo_snapshot", person_opinions: "person_opinions",
    events: "events", dismissals: "dismissals", impressions: "impressions", settings: "settings", playlists: "playlists",
    playlist_items: "playlist_items", playlist_suggestion_dismissals: "playlist_suggestion_dismissals",
  };
  const ecarts = [];
  console.log("Comptes (source -> compte importé) :");
  for (const [v1, v2] of Object.entries(correspondance)) {
    const avant = src.prepare(`SELECT COUNT(*) c FROM ${v1}`).get().c;
    const apres = Number((await q(`select count(*) n from public.${v2} where user_id = $1`, [compte])).rows[0].n);
    console.log(`  ${v1.padEnd(31)} ${String(avant).padStart(5)} -> ${String(apres).padStart(5)}`);
    if (avant !== apres && !ignorees[v1]) ecarts.push(`${v1} : ${avant} / ${apres}`);
  }
  const eloV1 = all(`SELECT id, elo_score, duels_count FROM items ORDER BY elo_score DESC, id`);
  // Le serveur peut arrondir à 15 chiffres à l'affichage ; l'égalité se vérifie à la précision maximale.
  await q(`set local extra_float_digits = 3`);
  const eloV2 = (await q(`select id::int, elo_score, duels_count from public.library_items where user_id = $1 order by elo_score desc, id`, [compte])).rows;
  if (!isDeepStrictEqual(eloV1, eloV2)) {
    const i = eloV1.findIndex((x, n) => !isDeepStrictEqual(x, eloV2[n]));
    ecarts.push(`classement Elo différent (${eloV1.length} / ${eloV2.length} lignes ; première différence à la place ${i} : ${JSON.stringify(eloV1[i])} / ${JSON.stringify(eloV2[i])})`);
  }
  if (Object.keys(ignorees).length) console.log(`Lignes ignorées (orphelines) : ${JSON.stringify(ignorees)}`);
  if (ecarts.length) {
    await q("rollback");
    throw new Error(`import annulé, ${ecarts.length} écart(s) : ${ecarts.join(" ; ")}`);
  }
  await q("commit");
  console.log(`\nImport terminé en ${Math.round((Date.now() - t0) / 1000)} s : classement Elo identique, comptes égaux.`);
} catch (e) {
  await q("rollback").catch(() => {});
  console.error("ÉCHEC :", clean(e.message));
  process.exitCode = 1;
} finally {
  await c.end();
  src.close();
}
