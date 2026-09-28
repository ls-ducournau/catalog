import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "./db";
import { updateItem } from "./itemService";
import { diversify, getRecommendations } from "./recommendationService";
import { getPreferenceModel, resetPreferenceModelCache } from "./preferenceService";

// spec: specs/recommendations-v1.md — FR-12, amendements v1.3 (AC-19, AC-20)

vi.mock("./tmdb", () => ({
  getDetailsFr: vi.fn(),
  getDetails: vi.fn(),
  getTmdbFeatures: vi.fn(),
  posterUrl: (path: string | null) => (path ? `https://image.tmdb.org/t/p/w500${path}` : null),
}));

const STARS = ["💩", "⭐️", "⭐️⭐️", "⭐️⭐️⭐️", "⭐️⭐️⭐️⭐️", "⭐️⭐️⭐️⭐️⭐️"];

function seed(
  db: Database.Database,
  item: {
    name: string;
    status: "Watched" | "Unwatched";
    stars?: number;
    keywords?: string[];
    voteAverage?: number;
  }
): number {
  const now = new Date().toISOString();
  const features = {
    genres: ["Drama"],
    keywords: item.keywords ?? [],
    cast: [],
    directors: [],
    year: 2010,
    runtime: 110,
    language: "en",
    countries: ["US"],
    voteAverage: item.voteAverage ?? 7,
    voteCount: 5000,
    popularity: 20,
  };
  const result = db
    .prepare(
      `INSERT INTO items (notion_page_id, name, type, watch_status, rating, genre, tmdb_features, notion_last_edited, updated_at)
       VALUES (?, ?, 'Movie', ?, ?, '["Drama"]', ?, ?, ?)`
    )
    .run(
      `page-${item.name}`,
      item.name,
      item.status,
      item.stars === undefined ? null : STARS[item.stars],
      JSON.stringify(features),
      now,
      now
    );
  return Number(result.lastInsertRowid);
}

describe("diversify", () => {
  it("repousse les titres au-delà de deux par lot, sans en perdre aucun (FR-12)", () => {
    const ranked = [
      { id: 1, group: "docs" },
      { id: 2, group: "docs" },
      { id: 3, group: "docs" },
      { id: 4, group: "comédies" },
    ];
    expect(diversify(ranked, (r) => r.group).map((r) => r.id)).toEqual([1, 2, 4, 3]);
  });

  it("ne diffère jamais un titre sans lot", () => {
    const ranked = [1, 2, 3].map((id) => ({ id, group: "" }));
    expect(diversify(ranked, (r) => r.group).map((r) => r.id)).toEqual([1, 2, 3]);
  });
});

describe("getRecommendations", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
    resetPreferenceModelCache();
  });

  it("signale un démarrage à froid sous 10 titres vus notés (AC-20)", () => {
    for (let i = 0; i < 9; i++) seed(db, { name: `Vu ${i}`, status: "Watched", stars: 4 });
    seed(db, { name: "À voir", status: "Unwatched" });

    expect(getRecommendations(db)).toEqual({ error: "not_enough_signal", ratedCount: 9 });
  });

  it("classe la pile d'après les thèmes que tu notes le mieux, et l'explique par eux", () => {
    // Tu adores l'espace, tu détestes les zombies.
    for (let i = 0; i < 8; i++) {
      seed(db, { name: `Espace ${i}`, status: "Watched", stars: 5, keywords: ["space", "astronaut"] });
      seed(db, { name: `Zombie ${i}`, status: "Watched", stars: 1, keywords: ["zombie", "undead"] });
    }
    seed(db, { name: "Candidat zombie", status: "Unwatched", keywords: ["zombie", "undead"] });
    seed(db, { name: "Candidat espace", status: "Unwatched", keywords: ["space", "astronaut"] });

    const result = getRecommendations(db);
    if ("error" in result) throw new Error("démarrage à froid inattendu");

    expect(result.items.map((i) => i.name)).toEqual(["Candidat espace", "Candidat zombie"]);
    // AC-18 : l'explication cite des titres aimés, jamais les zombies notés ⭐.
    expect(result.items[0].neighbours.length).toBeGreaterThan(0);
    expect(result.items[0].neighbours.every((n) => n.name.startsWith("Espace"))).toBe(true);
  });
});

describe("getPreferenceModel — recalcul silencieux (AC-19)", () => {
  it("réutilise le modèle tant que rien ne change, le reconstruit après une note", () => {
    const db = createTestDb();
    resetPreferenceModelCache();
    const ids = Array.from({ length: 12 }, (_, i) =>
      seed(db, { name: `Vu ${i}`, status: "Watched", stars: 3, keywords: ["drama"] })
    );

    const first = getPreferenceModel(db);
    expect(getPreferenceModel(db)).toBe(first);

    updateItem(db, ids[0], { rating: "⭐️⭐️⭐️⭐️⭐️" });
    expect(getPreferenceModel(db)).not.toBe(first);
  });
});
