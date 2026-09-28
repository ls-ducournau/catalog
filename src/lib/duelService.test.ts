import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./db";
import { getDuelScope, getNextDuel, resetElo, restoreElo, submitDuelResult } from "./duelService";

// spec: specs/duels-elo-v1.md — amendements v1.1 (FR-16, FR-17)

function seed(
  db: Database.Database,
  item: { name: string; type?: "Movie" | "TV Series"; documentary?: boolean; elo?: number; duels?: number }
): number {
  const now = new Date().toISOString();
  const genre = JSON.stringify(item.documentary ? ["Documentary"] : ["Drama"]);
  return Number(
    db
      .prepare(
        `INSERT INTO items (notion_page_id, name, type, watch_status, genre, elo_score, duels_count, notion_last_edited, updated_at)
         VALUES (?, ?, ?, 'Watched', ?, ?, ?, ?, ?)`
      )
      .run(`page-${item.name}`, item.name, item.type ?? "Movie", genre, item.elo ?? 1200, item.duels ?? 0, now, now)
      .lastInsertRowid
  );
}

const row = (db: Database.Database, id: number) =>
  db.prepare(`SELECT elo_score, duels_count, local_dirty FROM items WHERE id = ?`).get(id) as {
    elo_score: number;
    duels_count: number;
    local_dirty: number;
  };

describe("getNextDuel — catégorie (FR-16)", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    seed(db, { name: "Film 1" });
    seed(db, { name: "Film 2" });
    seed(db, { name: "Série 1", type: "TV Series" });
    seed(db, { name: "Série 2", type: "TV Series" });
    seed(db, { name: "Docu 1", documentary: true });
    seed(db, { name: "Docu 2", type: "TV Series", documentary: true });
  });

  it("ne tire que des films quand on demande des films, documentaires exclus", () => {
    for (let i = 0; i < 10; i++) {
      const duel = getNextDuel(db, "Movie");
      if ("error" in duel) throw new Error("paire attendue");
      expect([duel.itemA.name, duel.itemB.name].sort()).toEqual(["Film 1", "Film 2"]);
    }
  });

  it("range un film ou une série documentaire dans Documentaires", () => {
    const duel = getNextDuel(db, "Documentary");
    if ("error" in duel) throw new Error("paire attendue");
    expect([duel.itemA.name, duel.itemB.name].sort()).toEqual(["Docu 1", "Docu 2"]);
  });

  it("signale une catégorie où il n'y a pas de quoi faire un duel", () => {
    const empty = createTestDb();
    seed(empty, { name: "Seul film" });
    expect(getNextDuel(empty, "Movie")).toEqual({ error: "not_enough_watched_items", eligibleCount: 1 });
  });
});

describe("resetElo / restoreElo (FR-17)", () => {
  let db: Database.Database;
  let film: number;
  let serie: number;

  beforeEach(() => {
    db = createTestDb();
    film = seed(db, { name: "Film", elo: 1320, duels: 7 });
    serie = seed(db, { name: "Série", type: "TV Series", elo: 1110, duels: 4 });
    db.prepare(`UPDATE items SET local_dirty = 0`).run();
  });

  it("remet l'Elo à zéro dans la seule catégorie demandée", () => {
    expect(getDuelScope(db, "Movie")).toEqual({ watched: 1, scored: 1 });

    expect(resetElo(db, "Movie")).toEqual({ reset: 1 });
    expect(row(db, film)).toEqual({ elo_score: 1200, duels_count: 0, local_dirty: 1 });
    // La série n'est pas touchée.
    expect(row(db, serie)).toEqual({ elo_score: 1110, duels_count: 4, local_dirty: 0 });
  });

  it("conserve l'historique des duels", () => {
    submitDuelResult(db, film, serie, "A");
    resetElo(db);
    expect((db.prepare(`SELECT COUNT(*) c FROM duels`).get() as { c: number }).c).toBe(1);
  });

  it("annule exactement la dernière réinitialisation", () => {
    resetElo(db);
    expect(row(db, film).elo_score).toBe(1200);

    expect(restoreElo(db)).toEqual({ restored: 2 });
    expect(row(db, film)).toMatchObject({ elo_score: 1320, duels_count: 7 });
    expect(row(db, serie)).toMatchObject({ elo_score: 1110, duels_count: 4 });

    // L'instantané est consommé : une seconde annulation ne fait rien.
    expect(restoreElo(db)).toEqual({ restored: 0 });
  });

  it("ne marque pas pour Notion un item dont l'Elo n'a pas bougé", () => {
    const neuf = seed(db, { name: "Jamais dualisé mais exposé", duels: 2 });
    db.prepare(`UPDATE items SET local_dirty = 0`).run();

    resetElo(db);
    expect(row(db, neuf)).toEqual({ elo_score: 1200, duels_count: 0, local_dirty: 0 });
  });
});
