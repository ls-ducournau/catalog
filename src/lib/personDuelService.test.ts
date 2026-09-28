import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./db";
import {
  getNextPersonDuel,
  getPersonScope,
  resetPersonElo,
  restorePersonElo,
  submitPersonDuelResult,
} from "./personDuelService";

// spec: specs/duels-elo-v1.md — amendements v1.2 (AC-15 à AC-18)

const STARS = ["💩", "⭐️", "⭐️⭐️", "⭐️⭐️⭐️", "⭐️⭐️⭐️⭐️", "⭐️⭐️⭐️⭐️⭐️"];
const PEOPLE = {
  pitt: { id: 287, name: "Brad Pitt", profilePath: "/pitt.jpg" },
  dicaprio: { id: 6193, name: "Leonardo DiCaprio", profilePath: "/leo.jpg" },
  fiennes: { id: 5469, name: "Ralph Fiennes", profilePath: "/fiennes.jpg" },
  rare: { id: 1, name: "Second rôle", profilePath: null },
};

function seenTitle(
  db: Database.Database,
  name: string,
  cast: (typeof PEOPLE)[keyof typeof PEOPLE][],
  stars = 3
): number {
  const now = new Date().toISOString();
  const features = {
    genres: [],
    keywords: [],
    cast,
    directors: [],
    year: 2000,
    runtime: 120,
    language: "en",
    countries: [],
    voteAverage: 7,
    voteCount: 1000,
    popularity: 10,
  };
  return Number(
    db
      .prepare(
        `INSERT INTO items (notion_page_id, name, type, watch_status, rating, tmdb_features, notion_last_edited, updated_at)
         VALUES (?, ?, 'Movie', 'Watched', ?, ?, ?, ?)`
      )
      .run(`page-${name}`, name, STARS[stars], JSON.stringify(features), now, now).lastInsertRowid
  );
}

const elo = (db: Database.Database, id: number) =>
  (db.prepare(`SELECT elo_score FROM people WHERE id = ?`).get(id) as { elo_score: number }).elo_score;

describe("duels d'acteurs", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    // Pitt et DiCaprio : 3 titres chacun ; Fiennes : 3 ; le second rôle : 2 seulement.
    seenTitle(db, "Fight Club", [PEOPLE.pitt], 5);
    seenTitle(db, "Troie", [PEOPLE.pitt], 2);
    seenTitle(db, "Once Upon a Time in Hollywood", [PEOPLE.pitt, PEOPLE.dicaprio], 4);
    seenTitle(db, "Inception", [PEOPLE.dicaprio, PEOPLE.rare], 5);
    seenTitle(db, "Titanic", [PEOPLE.dicaprio, PEOPLE.rare], 3);
    seenTitle(db, "The Grand Budapest Hotel", [PEOPLE.fiennes], 5);
    seenTitle(db, "Harry Potter", [PEOPLE.fiennes], 3);
    seenTitle(db, "La Liste de Schindler", [PEOPLE.fiennes], 5);
  });

  it("n'oppose que des acteurs vus dans au moins 3 titres (AC-15)", () => {
    for (let i = 0; i < 20; i++) {
      const duel = getNextPersonDuel(db);
      if ("error" in duel) throw new Error("paire attendue");
      expect([duel.personA.id, duel.personB.id]).not.toContain(PEOPLE.rare.id);
    }
  });

  it("met à jour l'Elo des deux acteurs, et d'aucun titre (AC-16)", () => {
    getNextPersonDuel(db); // inscrit les éligibles
    const titlesBefore = db.prepare(`SELECT id, elo_score FROM items ORDER BY id`).all();

    submitPersonDuelResult(db, PEOPLE.pitt.id, PEOPLE.fiennes.id, "A");

    expect(elo(db, PEOPLE.pitt.id)).toBeGreaterThan(1200);
    expect(elo(db, PEOPLE.fiennes.id)).toBeLessThan(1200);
    expect(db.prepare(`SELECT id, elo_score FROM items ORDER BY id`).all()).toEqual(titlesBefore);
  });

  it("liste les titres où tu l'as croisé, du mieux noté au moins bien noté (AC-17)", () => {
    let pitt;
    for (let i = 0; i < 50 && !pitt; i++) {
      const duel = getNextPersonDuel(db);
      if ("error" in duel) throw new Error("paire attendue");
      pitt = [duel.personA, duel.personB].find((p) => p.id === PEOPLE.pitt.id);
    }
    expect(pitt?.seenIn).toEqual(["Fight Club", "Once Upon a Time in Hollywood", "Troie"]);
    expect(pitt?.photoUrl).toContain("/pitt.jpg");
  });

  it("réinitialise l'Elo des acteurs sans toucher aux titres, et s'annule (AC-18)", () => {
    getNextPersonDuel(db);
    submitPersonDuelResult(db, PEOPLE.pitt.id, PEOPLE.dicaprio.id, "B");
    const leo = elo(db, PEOPLE.dicaprio.id);
    const titlesBefore = db.prepare(`SELECT id, elo_score FROM items ORDER BY id`).all();

    expect(getPersonScope(db)).toEqual({ eligible: 3, scored: 2 });
    expect(resetPersonElo(db)).toEqual({ reset: 2 });
    expect(elo(db, PEOPLE.dicaprio.id)).toBe(1200);
    expect(db.prepare(`SELECT id, elo_score FROM items ORDER BY id`).all()).toEqual(titlesBefore);

    expect(restorePersonElo(db)).toEqual({ restored: 2 });
    expect(elo(db, PEOPLE.dicaprio.id)).toBe(leo);
  });

  it("signale l'absence de deux acteurs éligibles", () => {
    const empty = createTestDb();
    seenTitle(empty, "Seul", [PEOPLE.pitt]);
    expect(getNextPersonDuel(empty)).toEqual({ error: "not_enough_people", eligibleCount: 0 });
  });
});
