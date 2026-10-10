import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createTestDb } from "./db";
import { exposureDay, getExposure, recordImpressions } from "./impressionService";

// spec: specs/recommandations-fraicheur-v1.md (AC-2, AC-3, AC-4, AC-6)

/** Un instant en heure locale : le 9 octobre 2026 à `hours` heures, décalé de `days` jours. */
const at = (days: number, hours = 20) => new Date(2026, 9, 9 + days, hours, 0);

function gesture(db: Database.Database, subjectType: string, subjectId: string, when: Date) {
  db.prepare(
    `INSERT INTO events (kind, subject_type, subject_id, context, created_at) VALUES ('opened', ?, ?, NULL, ?)`
  ).run(subjectType, subjectId, when.toISOString());
}

describe("exposureDay (FR-3)", () => {
  it("la journée commence à 4 h : une soirée qui passe minuit reste la même", () => {
    expect(exposureDay(new Date(2026, 9, 9, 23, 50))).toBe("2026-10-09");
    expect(exposureDay(new Date(2026, 9, 10, 0, 30))).toBe("2026-10-09");
    expect(exposureDay(new Date(2026, 9, 10, 4, 30))).toBe("2026-10-10");
  });
});

describe("recordImpressions (FR-2)", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = createTestDb();
  });

  it("un même titre vu le même jour sur trois surfaces donne une seule ligne, la première (AC-2)", () => {
    expect(recordImpressions(db, "home", ["item:7"], at(0, 18))).toBe(1);
    expect(recordImpressions(db, "pile", ["item:7"], at(0, 19))).toBe(0);
    expect(recordImpressions(db, "tonight", ["item:7"], at(0, 21))).toBe(0);
    const rows = db.prepare(`SELECT surface FROM impressions`).all();
    expect(rows).toEqual([{ surface: "home" }]);
  });

  it("ignore les clés invalides et garde les titres hors bibliothèque", () => {
    const keys = ["item:3", "tmdb:movie:603", "tmdb:tv:1399", "item:0", "tmdb:book:1", 12, "item:3"];
    expect(recordImpressions(db, "discover", keys, at(0))).toBe(3);
  });

  it("purge les impressions de plus de 90 jours", () => {
    recordImpressions(db, "pile", ["item:1"], at(-120));
    recordImpressions(db, "pile", ["item:2"], at(0));
    const ids = db.prepare(`SELECT subject_id FROM impressions`).all();
    expect(ids).toEqual([{ subject_id: "2" }]);
  });
});

describe("getExposure (FR-4, FR-5, FR-7)", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = createTestDb();
  });

  // Poids d'un jour montré il y a `n` jours : 1 la veille, la moitié une semaine plus tard.
  const weight = (n: number) => 0.5 ** ((n - 1) / 7);

  it("compte les jours montrés avant aujourd'hui, pas ceux d'aujourd'hui (AC-3)", () => {
    for (const day of [-3, -2, -1, 0]) recordImpressions(db, "pile", ["item:5", "tmdb:movie:603"], at(day));
    const exposure = getExposure(db, at(0, 22));
    expect(exposure.get("item:5")).toBeCloseTo(weight(1) + weight(2) + weight(3), 6);
    expect(exposure.get("tmdb:movie:603")).toBeCloseTo(weight(1) + weight(2) + weight(3), 6);
  });

  it("un jour montré compte 1 la veille, la moitié une semaine plus tard", () => {
    recordImpressions(db, "pile", ["item:5"], at(-1));
    recordImpressions(db, "pile", ["item:6"], at(-8));
    const exposure = getExposure(db, at(0));
    expect(exposure.get("item:5")).toBeCloseTo(1, 6);
    expect(exposure.get("item:6")).toBeCloseTo(0.5, 6);
  });

  it("le classement du jour ne bouge pas avec les impressions du jour", () => {
    recordImpressions(db, "pile", ["item:5"], at(-1));
    const before = getExposure(db, at(0, 9));
    recordImpressions(db, "pile", ["item:5", "item:6"], at(0, 10));
    expect(getExposure(db, at(0, 23))).toEqual(before);
  });

  it("ne lit plus ce qui a plus de 6 semaines", () => {
    recordImpressions(db, "pile", ["item:5"], at(-50));
    recordImpressions(db, "pile", ["item:5"], at(-2));
    expect(getExposure(db, at(0)).get("item:5")).toBeCloseTo(weight(2), 6);
  });

  it("un geste remet le compteur à zéro, jour du geste compris (AC-6)", () => {
    for (const day of [-4, -3, -2, -1]) recordImpressions(db, "pile", ["item:5"], at(day));
    gesture(db, "item", "5", at(-3, 21));
    expect(getExposure(db, at(0)).get("item:5")).toBeCloseTo(weight(1) + weight(2), 6);
  });

  it("un geste sur un titre hors bibliothèque compte aussi", () => {
    recordImpressions(db, "discover", ["tmdb:tv:1399"], at(-2));
    gesture(db, "tmdb", "tv:1399", at(-1));
    expect(getExposure(db, at(0)).has("tmdb:tv:1399")).toBe(false);
  });
});
