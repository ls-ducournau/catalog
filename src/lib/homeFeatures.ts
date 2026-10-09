import type Database from "better-sqlite3";
import { getNextDuel, type DuelItem } from "./duelService";
import { currentPlaylist, type PlaylistDetail } from "./playlistService";
import { posterTint, tintVar } from "./posterTint";
import { getRanking } from "./tierDuelService";
import { getTriageBatch, type SeenCard } from "./triageService";

// Aperçus des fonctions clés de l'accueil (Notation, Duels) — fiche
// docs/design-reference/raycast/composants/vitrine.md. Lecture seule : rien n'est écrit ici, les
// aperçus écrivent seulement quand tu notes ou tranches toi-même.

export type RatingCard = SeenCard & { tint?: string };

export type RatingPreviewData = {
  /** Quelques titres vus sans note, les plus récents d'abord. */
  cards: RatingCard[];
  unratedSeen: number;
  /** Personnes aimées sans note (Tri rapide, mode « Noter »). */
  unratedPeople: number;
};

export type DuelPreviewData = {
  pair: { a: DuelItem; b: DuelItem } | null;
  /** Titres notés, donc classés ; paliers non vides ; titres départagés dans leur palier. */
  ranked: number;
  tiers: number;
  settled: number;
};

/** Section Playlists (spec playlists-v2 FR-10) : la playlist en cours, et combien tu en as. */
export type PlaylistPreviewData = { current: PlaylistDetail | null; count: number };

export type HomeFeatures = { rating: RatingPreviewData; duel: DuelPreviewData; playlist: PlaylistPreviewData };

const RATING_CARDS = 6;

function count(db: Database.Database, sql: string): number {
  return (db.prepare(sql).get() as { n: number | null }).n ?? 0;
}

export async function getHomeFeatures(db: Database.Database): Promise<HomeFeatures> {
  const seen = (await getTriageBatch(db, "seen", { limit: RATING_CARDS })) as SeenCard[];
  const tints = await Promise.all(seen.map(async (card) => tintVar(await posterTint(card.posterUrl))));
  const rating: RatingPreviewData = {
    cards: seen.map((card, i) => ({ ...card, tint: tints[i] })),
    unratedSeen: count(db, `SELECT COUNT(*) AS n FROM items WHERE watch_status = 'Watched' AND rating IS NULL`),
    unratedPeople: count(db, `SELECT COUNT(*) AS n FROM person_opinions WHERE opinion = 1 AND rating IS NULL`),
  };

  const next = getNextDuel(db);
  const ranking = getRanking(db);
  const filled = ranking.tiers.filter((t) => t.items.length > 0);
  const duel: DuelPreviewData = {
    pair: "error" in next ? null : { a: next.itemA, b: next.itemB },
    ranked: filled.reduce((sum, t) => sum + t.items.length, 0),
    tiers: filled.length,
    settled: filled.reduce((sum, t) => sum + t.settled, 0),
  };

  const playlist: PlaylistPreviewData = {
    current: currentPlaylist(db),
    count: count(db, `SELECT COUNT(*) AS n FROM playlists`),
  };

  return { rating, duel, playlist };
}
