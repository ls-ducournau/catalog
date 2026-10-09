import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

// Base SQLite locale — spec: specs/duels-elo-v1.md section 7 (Modèles de données)

const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "watchlist.db");

let db: Database.Database | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  notion_page_id TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  type TEXT CHECK (type IN ('Movie','TV Series')),
  year TEXT,
  watch_status TEXT CHECK (watch_status IN ('Watched','Unwatched')),
  imdb_id TEXT,
  tmdb_id INTEGER,
  tmdb_resolve_failed_at TEXT,
  poster_path TEXT,
  genre TEXT,
  director TEXT,
  tmdb_rating REAL,
  elo_score REAL NOT NULL DEFAULT 1200,
  duels_count INTEGER NOT NULL DEFAULT 0,
  last_duel_at TEXT,
  ressenti TEXT,
  rating TEXT,
  notion_last_edited TEXT NOT NULL,
  local_dirty INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS duels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_a_id INTEGER NOT NULL REFERENCES items(id),
  item_b_id INTEGER NOT NULL REFERENCES items(id),
  winner_id INTEGER REFERENCES items(id),
  elo_a_before REAL NOT NULL,
  elo_b_before REAL NOT NULL,
  elo_a_after REAL NOT NULL,
  elo_b_after REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_state (
  key TEXT PRIMARY KEY,
  value TEXT
);

-- Scores d'avant la dernière réinitialisation de l'Elo : c'est ce qui rend l'opération annulable
-- (spec duels-elo : réinitialisation). Une seule génération, remplacée à chaque réinitialisation.
CREATE TABLE IF NOT EXISTS elo_snapshot (
  item_id INTEGER PRIMARY KEY REFERENCES items(id),
  elo_score REAL NOT NULL,
  duels_count INTEGER NOT NULL,
  last_duel_at TEXT
);

-- Duels d'acteurs (spec duels-elo-v1 FR-18 à FR-22) : Elo propre aux personnes, purement local.
-- L'identifiant est celui de la personne chez TMDB, stable d'un titre à l'autre.
CREATE TABLE IF NOT EXISTS people (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  profile_path TEXT,
  elo_score REAL NOT NULL DEFAULT 1200,
  duels_count INTEGER NOT NULL DEFAULT 0,
  last_duel_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS person_duels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  person_a_id INTEGER NOT NULL REFERENCES people(id),
  person_b_id INTEGER NOT NULL REFERENCES people(id),
  winner_id INTEGER REFERENCES people(id),
  elo_a_before REAL NOT NULL,
  elo_b_before REAL NOT NULL,
  elo_a_after REAL NOT NULL,
  elo_b_after REAL NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS person_elo_snapshot (
  person_id INTEGER PRIMARY KEY REFERENCES people(id),
  elo_score REAL NOT NULL,
  duels_count INTEGER NOT NULL,
  last_duel_at TEXT
);

-- Journal local des gestes (spec tri-rapide-v1 FR-1) : la matière de la boucle d'apprentissage.
-- subject_type : 'item' (id local), 'tmdb' (titre hors bibliothèque, "movie:603"), 'person'.
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL,
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  context TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_kind ON events(kind);

-- « Ne plus me proposer ça » (tri-rapide-v1 FR-2) : n'affecte que les recommandations.
CREATE TABLE IF NOT EXISTS dismissals (
  subject_type TEXT NOT NULL,
  subject_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (subject_type, subject_id)
);

-- Avis sur une personne (tri-rapide-v1 FR-4, FR-7) : +1 aimée, -1 pas aimée.
CREATE TABLE IF NOT EXISTS person_opinions (
  person_id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  opinion INTEGER NOT NULL CHECK (opinion IN (-1, 1)),
  updated_at TEXT NOT NULL,
  -- Note de 1 à 5 d'une personne aimée (classement-v1 FR-13) ; NULL sinon.
  rating INTEGER
);

-- Duels de départage (spec classement-v1 FR-3, FR-4) : entre titres d'une même note, avec un
-- score propre au palier. Purement local, n'affecte ni l'Elo général ni Notion.
CREATE TABLE IF NOT EXISTS tier_duels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  item_a_id INTEGER NOT NULL REFERENCES items(id),
  item_b_id INTEGER NOT NULL REFERENCES items(id),
  winner_id INTEGER REFERENCES items(id),
  rating TEXT NOT NULL,
  elo_a_before REAL NOT NULL,
  elo_b_before REAL NOT NULL,
  elo_a_after REAL NOT NULL,
  elo_b_after REAL NOT NULL,
  created_at TEXT NOT NULL
);

-- Départage v1.1 (spec classement-v1 FR-9, FR-10) : une répartition ou un quatuor par ligne,
-- avec l'état avant/après de chaque titre touché (c'est ce qui permet de l'annuler en entier).
CREATE TABLE IF NOT EXISTS tier_rounds (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  rating TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('band', 'quad')),
  payload TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- Réglages de l'utilisateur, en clé/valeur JSON (ex. ses abonnements streaming).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- Playlists faites à la main (spec playlists-v1) : locales, rien vers Notion (NFR-1).
CREATE TABLE IF NOT EXISTS playlists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  description TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS playlist_items (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  position INTEGER NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (playlist_id, item_id)
);

CREATE INDEX IF NOT EXISTS idx_playlist_items_item ON playlist_items(item_id);

-- « Pas celui-là » dans les suggestions d'une playlist (spec playlists-v2 FR-5).
CREATE TABLE IF NOT EXISTS playlist_suggestion_dismissals (
  playlist_id INTEGER NOT NULL REFERENCES playlists(id),
  item_id INTEGER NOT NULL REFERENCES items(id),
  PRIMARY KEY (playlist_id, item_id)
);
CREATE INDEX IF NOT EXISTS idx_items_watch_status ON items(watch_status);
CREATE INDEX IF NOT EXISTS idx_duels_pair ON duels(item_a_id, item_b_id);
`;

export function getDb(): Database.Database {
  if (db) return db;

  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);
  migrate(db);
  return db;
}

/** Base en mémoire avec le même schéma — réservé aux tests. */
export function createTestDb(): Database.Database {
  const testDb = new Database(":memory:");
  testDb.exec(SCHEMA);
  migrate(testDb);
  return testDb;
}

/** Migrations additives pour les bases créées avant l'ajout d'une colonne. */
function migrate(database: Database.Database): void {
  const columns = database.prepare(`PRAGMA table_info(items)`).all() as { name: string }[];
  const hasColumn = (name: string) => columns.some((c) => c.name === name);

  if (!hasColumn("director")) {
    database.exec(`ALTER TABLE items ADD COLUMN director TEXT`);
  }
  if (!hasColumn("tmdb_rating")) {
    database.exec(`ALTER TABLE items ADD COLUMN tmdb_rating REAL`);
  }
  if (!hasColumn("overview")) {
    database.exec(`ALTER TABLE items ADD COLUMN overview TEXT`);
  }
  if (!hasColumn("vote_count")) {
    database.exec(`ALTER TABLE items ADD COLUMN vote_count INTEGER`);
  }
  // FR-23 (recommandations v1.3) : caractéristiques TMDB complètes, en JSON.
  if (!hasColumn("tmdb_features")) {
    database.exec(`ALTER TABLE items ADD COLUMN tmdb_features TEXT`);
  }
  // Disponibilité streaming en France (spec disponibilite-streaming-v1 FR-1), en JSON.
  if (!hasColumn("watch_providers")) {
    database.exec(`ALTER TABLE items ADD COLUMN watch_providers TEXT`);
  }
  // Bande-annonce retenue (spec bandes-annonces-v1 FR-2), en JSON ; null = pas encore cherchée.
  if (!hasColumn("trailer_info")) {
    database.exec(`ALTER TABLE items ADD COLUMN trailer_info TEXT`);
  }
  // Dates de sortie (spec sorties-v1 FR-1), en JSON.
  if (!hasColumn("release_info")) {
    database.exec(`ALTER TABLE items ADD COLUMN release_info TEXT`);
  }
  // Score de palier (spec classement-v1 FR-4) : ne vaut que pour la note `tier_rating`.
  if (!hasColumn("tier_elo")) {
    database.exec(`ALTER TABLE items ADD COLUMN tier_elo REAL NOT NULL DEFAULT 1200`);
    database.exec(`ALTER TABLE items ADD COLUMN tier_duels_count INTEGER NOT NULL DEFAULT 0`);
    database.exec(`ALTER TABLE items ADD COLUMN tier_rating TEXT`);
  }
  // Groupe du palier (spec classement-v1 FR-9) : 0 Bas, 1 Milieu, 2 Haut ; vaut pour `tier_rating`.
  if (!hasColumn("tier_band")) {
    database.exec(`ALTER TABLE items ADD COLUMN tier_band INTEGER`);
  }
  // Note d'une personne aimée (spec classement-v1 FR-13).
  const opinionColumns = database.prepare(`PRAGMA table_info(person_opinions)`).all() as { name: string }[];
  if (!opinionColumns.some((c) => c.name === "rating")) {
    database.exec(`ALTER TABLE person_opinions ADD COLUMN rating INTEGER`);
  }
}
