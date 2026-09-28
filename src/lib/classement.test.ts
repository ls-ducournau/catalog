import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "./db";
import { submitDuelResult } from "./duelService";
import { undoDuel } from "./duelUndo";
import { updateItem } from "./itemService";
import { getPeopleWithOpinions } from "./peopleService";
import { submitPersonDuelResult } from "./personDuelService";
import { setOpinion } from "./personOpinionService";
import {
  BAND_MIN_TITLES,
  getRanking,
  getTierStep,
  pickQuad,
  QUAD_SIZE,
  submitBand,
  submitQuad,
  TIER_SETTLED_DUELS,
  undoRound,
} from "./tierDuelService";

// spec: specs/classement-v1.md (AC-1 à AC-8, EC-1 à EC-3)

vi.mock("./tmdb", () => ({
  posterUrl: (path: string | null) => (path ? `https://image.tmdb.org/t/p/w500${path}` : null),
}));

const STARS = ["💩", "⭐️", "⭐️⭐️", "⭐️⭐️⭐️", "⭐️⭐️⭐️⭐️", "⭐️⭐️⭐️⭐️⭐️"];

function seed(
  db: Database.Database,
  item: {
    name: string;
    stars?: number;
    status?: "Watched" | "Unwatched";
    type?: "Movie" | "TV Series";
    elo?: number;
    cast?: number[];
  }
): number {
  const now = new Date().toISOString();
  const features = {
    genres: ["Drama"],
    keywords: [],
    cast: (item.cast ?? []).map((id) => ({ id, name: `Personne ${id}`, profilePath: `/p${id}.jpg` })),
    directors: [],
    year: 2010,
    runtime: 110,
    language: "en",
    countries: ["US"],
    voteAverage: 7,
    voteCount: 5000,
    popularity: 20,
  };
  return Number(
    db
      .prepare(
        `INSERT INTO items (notion_page_id, name, type, watch_status, rating, genre, elo_score, tmdb_features, notion_last_edited, updated_at)
         VALUES (?, ?, ?, ?, ?, '["Drama"]', ?, ?, ?, ?)`
      )
      .run(
        `page-${item.name}`,
        item.name,
        item.type ?? "Movie",
        item.status ?? "Watched",
        item.stars === undefined ? null : STARS[item.stars],
        item.elo ?? 1200,
        JSON.stringify(features),
        now,
        now
      ).lastInsertRowid
  );
}

const itemRow = (db: Database.Database, id: number) =>
  db
    .prepare(
      `SELECT elo_score, duels_count, local_dirty, updated_at, tier_elo, tier_duels_count FROM items WHERE id = ?`
    )
    .get(id) as {
    elo_score: number;
    duels_count: number;
    local_dirty: number;
    updated_at: string;
    tier_elo: number;
    tier_duels_count: number;
  };

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
});

describe("Annulation d'un duel (FR-1)", () => {
  it("rend aux deux titres leur Elo et leur compteur, et retire le duel (AC-1)", () => {
    const a = seed(db, { name: "A", elo: 1250 });
    const b = seed(db, { name: "B", elo: 1180 });

    const { duelId } = submitDuelResult(db, a, b, "A");
    expect(itemRow(db, a).elo_score).toBeGreaterThan(1250);

    expect(undoDuel(db, "titles", duelId)).toEqual({ ok: true });
    expect(itemRow(db, a)).toMatchObject({ elo_score: 1250, duels_count: 0 });
    expect(itemRow(db, b)).toMatchObject({ elo_score: 1180, duels_count: 0 });
    expect(db.prepare(`SELECT COUNT(*) c FROM duels`).get()).toEqual({ c: 0 });
  });

  it("refuse d'annuler un duel qu'un duel plus récent a suivi (AC-2)", () => {
    const a = seed(db, { name: "A" });
    const b = seed(db, { name: "B" });
    const c = seed(db, { name: "C" });

    const first = submitDuelResult(db, a, b, "A");
    submitDuelResult(db, a, c, "B");
    const before = itemRow(db, a);

    expect(undoDuel(db, "titles", first.duelId)).toEqual({ error: "conflict" });
    expect(itemRow(db, a)).toEqual(before);
  });

  it("refuse d'annuler un duel antérieur à une réinitialisation (EC-3)", () => {
    const a = seed(db, { name: "A" });
    const b = seed(db, { name: "B" });
    const { duelId } = submitDuelResult(db, a, b, "A");
    db.prepare(`UPDATE items SET elo_score = 1200`).run();

    expect(undoDuel(db, "titles", duelId)).toEqual({ error: "conflict" });
  });

  it("annule aussi un duel d'acteurs", () => {
    const now = new Date().toISOString();
    const insert = db.prepare(`INSERT INTO people (id, name, elo_score, updated_at) VALUES (?, ?, 1200, ?)`);
    insert.run(1, "Une", now);
    insert.run(2, "Autre", now);

    const result = submitPersonDuelResult(db, 1, 2, "B");
    expect(undoDuel(db, "people", result!.duelId)).toEqual({ ok: true });
    expect(db.prepare(`SELECT elo_score, duels_count FROM people WHERE id = 2`).get()).toEqual({
      elo_score: 1200,
      duels_count: 0,
    });
  });
});

describe("Départage (FR-3, FR-4, FR-10)", () => {
  it("ne touche que le score de palier : Elo général, date et marque Notion inchangés (AC-3)", () => {
    const [a, b, c, d] = ["A", "B", "C", "D"].map((name) => seed(db, { name, stars: 4, elo: 1300 }));
    db.prepare(`UPDATE items SET local_dirty = 0`).run();
    const before = itemRow(db, a);

    const result = submitQuad(db, [a, b, c, d], 4, a, d);
    if ("error" in result) throw new Error(result.error);

    const after = itemRow(db, a);
    expect(after.tier_elo).toBeGreaterThan(1200);
    expect(after.elo_score).toBe(before.elo_score);
    expect(after.local_dirty).toBe(0);
    expect(after.updated_at).toBe(before.updated_at);
  });

  it("compte 5 comparaisons pour un quatuor : le meilleur devant tous, tous devant le moins bon (AC-12)", () => {
    const [a, b, c, d] = ["A", "B", "C", "D"].map((name) => seed(db, { name, stars: 4 }));
    submitQuad(db, [a, b, c, d], 4, a, d);

    const [ra, rb, rc, rd] = [a, b, c, d].map((id) => itemRow(db, id));
    expect([ra, rb, rc, rd].map((r) => r.tier_duels_count)).toEqual([3, 2, 2, 3]);
    expect(ra.tier_elo).toBeGreaterThan(rb.tier_elo);
    expect(rb.tier_elo).toBeCloseTo(rc.tier_elo, 9);
    expect(rc.tier_elo).toBeGreaterThan(rd.tier_elo);
    // Sans « moins bon » : seul le meilleur est connu, 3 comparaisons.
    const [e, f, g] = ["E", "F", "G"].map((name) => seed(db, { name, stars: 3 }));
    submitQuad(db, [e, f, g], 3, e, null);
    expect([e, f, g].map((id) => itemRow(db, id).tier_duels_count)).toEqual([2, 1, 1]);
  });

  it("annule un quatuor en entier (AC-14)", () => {
    const ids = ["A", "B", "C", "D"].map((name) => seed(db, { name, stars: 4 }));
    const before = ids.map((id) => itemRow(db, id));
    const result = submitQuad(db, ids, 4, ids[1], ids[2]);
    if ("error" in result) throw new Error(result.error);

    expect(undoRound(db, result.roundId)).toEqual({ ok: true });
    expect(ids.map((id) => itemRow(db, id))).toEqual(before);
    expect(undoRound(db, result.roundId)).toEqual({ error: "not_found" });
  });

  it("refuse d'annuler un quatuor que d'autres réponses ont suivi", () => {
    const ids = ["A", "B", "C", "D"].map((name) => seed(db, { name, stars: 4 }));
    const first = submitQuad(db, ids, 4, ids[0], ids[3]);
    submitQuad(db, ids, 4, ids[3], ids[0]);
    if ("error" in first) throw new Error(first.error);
    expect(undoRound(db, first.roundId)).toEqual({ error: "conflict" });
  });

  it("ne propose que des titres du palier et de la catégorie demandés (AC-6)", () => {
    seed(db, { name: "Film 4 étoiles 1", stars: 4 });
    seed(db, { name: "Film 4 étoiles 2", stars: 4 });
    seed(db, { name: "Film 5 étoiles", stars: 5 });
    seed(db, { name: "Série 4 étoiles", stars: 4, type: "TV Series" });
    seed(db, { name: "Film 4 étoiles à voir", stars: 4, status: "Unwatched" });

    const step = getTierStep(db, 4, "Movie");
    if (!("step" in step) || step.step !== "quad") throw new Error("quatuor attendu");
    expect(step.items.map((i) => i.name).sort()).toEqual(["Film 4 étoiles 1", "Film 4 étoiles 2"]);
    expect(step.scope).toMatchObject({ titles: 2, compared: 0, settled: 0, banded: false });
  });

  it("signale un palier où il n'y a pas de quoi départager (EC-1)", () => {
    seed(db, { name: "Seul", stars: 5 });
    expect(getTierStep(db, 5)).toEqual({ error: "not_enough_titles", eligibleCount: 1 });
  });

  it("refuse une réponse quand la note a changé entre-temps (EC-2)", () => {
    const [a, b] = ["A", "B"].map((name) => seed(db, { name, stars: 4 }));
    updateItem(db, b, { rating: STARS[5] });

    expect(submitQuad(db, [a, b], 4, a, null)).toEqual({ error: "stale" });
    expect(submitBand(db, b, 4, 2)).toEqual({ error: "stale" });
    expect(itemRow(db, a).tier_duels_count).toBe(0);
  });
});

describe("Gros palier : répartir puis affiner (FR-8, FR-9, FR-11)", () => {
  function bigTier(count: number): number[] {
    return Array.from({ length: count }, (_, i) => seed(db, { name: `Titre ${String(i).padStart(3, "0")}`, stars: 4 }));
  }

  it("répartit d'abord un gros palier, pas un petit (AC-11)", () => {
    bigTier(BAND_MIN_TITLES);
    const step = getTierStep(db, 4);
    if (!("step" in step)) throw new Error("étape attendue");
    expect(step.step).toBe("band");
    expect(step.scope).toMatchObject({ banded: true, placed: 0, titles: BAND_MIN_TITLES });

    ["A", "B", "C"].forEach((name) => seed(db, { name, stars: 3 }));
    const small = getTierStep(db, 3);
    expect("step" in small && small.step).toBe("quad");
  });

  it("affine le Haut d'abord, puis le Milieu (AC-13)", () => {
    const ids = bigTier(BAND_MIN_TITLES);
    ids.forEach((id, i) => submitBand(db, id, 4, (i % 3) as 0 | 1 | 2));
    const high = new Set(ids.filter((_, i) => i % 3 === 2));

    const step = getTierStep(db, 4);
    if (!("step" in step) || step.step !== "quad") throw new Error("quatuor attendu");
    expect(step.group).toBe(2);
    expect(step.items).toHaveLength(QUAD_SIZE);
    expect(step.items.every((i) => high.has(i.id))).toBe(true);

    db.prepare(
      `UPDATE items SET tier_duels_count = ? WHERE id IN (${[...high].map(() => "?").join(",")})`
    ).run(TIER_SETTLED_DUELS, ...high);
    const next = getTierStep(db, 4);
    if (!("step" in next) || next.step !== "quad") throw new Error("quatuor attendu");
    expect(next.group).toBe(1);
  });

  it("range le classement par groupe : Haut, Milieu, Bas, puis non répartis (AC-15)", () => {
    const ids = bigTier(BAND_MIN_TITLES);
    submitBand(db, ids[0], 4, 0);
    submitBand(db, ids[1], 4, 2);
    submitBand(db, ids[2], 4, 1);

    const tier = getRanking(db).tiers.find((t) => t.stars === 4)!;
    expect(tier.banded).toBe(true);
    expect(tier.placed).toBe(3);
    expect(tier.items.slice(0, 3).map((i) => i.id)).toEqual([ids[1], ids[2], ids[0]]);
    expect(tier.items[3].band).toBeNull();
  });

  it("annule une répartition", () => {
    const ids = bigTier(BAND_MIN_TITLES);
    const result = submitBand(db, ids[0], 4, 2);
    if ("error" in result) throw new Error(result.error);
    expect(undoRound(db, result.roundId)).toEqual({ ok: true });
    expect(getRanking(db).tiers.find((t) => t.stars === 4)!.placed).toBe(0);
  });
});

describe("Fin du départage (FR-7)", () => {
  /** Donne à un titre `comparisons` comparaisons de départage dans son palier actuel. */
  function settle(id: number, comparisons: number) {
    db.prepare(`UPDATE items SET tier_duels_count = ?, tier_rating = rating WHERE id = ?`).run(comparisons, id);
  }

  it("met toujours en jeu un titre qui reste à départager (AC-9)", () => {
    const ids = [1, 2, 3, 4, 5, 6, 7].map((n) => seed(db, { name: `Titre ${n}`, stars: 4 }));
    ids.slice(0, 6).forEach((id) => settle(id, TIER_SETTLED_DUELS));

    for (let i = 0; i < 20; i++) {
      const step = getTierStep(db, 4);
      if (!("step" in step) || step.step !== "quad") throw new Error("quatuor attendu");
      expect(step.items.map((item) => item.id)).toContain(ids[6]);
      expect(step.scope.settled).toBe(6);
    }
  });

  it("annonce la fin du palier et le suivant à départager, puis affine sur demande (AC-10)", () => {
    const four = [1, 2, 3].map((n) => seed(db, { name: `Quatre ${n}`, stars: 4 }));
    four.forEach((id) => settle(id, TIER_SETTLED_DUELS));
    seed(db, { name: "Trois 1", stars: 3 });
    seed(db, { name: "Trois 2", stars: 3 });

    expect(getTierStep(db, 4)).toEqual({
      step: "done",
      scope: { titles: 3, compared: 3, settled: 3, banded: false, placed: 0 },
      nextTier: 3,
    });
    const refined = getTierStep(db, 4, undefined, Math.random, { refine: true });
    expect("step" in refined && refined.step).toBe("quad");
  });

  it("rouvre un palier départagé quand un titre y entre", () => {
    const four = [1, 2].map((n) => seed(db, { name: `Quatre ${n}`, stars: 4 }));
    four.forEach((id) => settle(id, TIER_SETTLED_DUELS));
    expect("step" in getTierStep(db, 4) && (getTierStep(db, 4) as { step: string }).step).toBe("done");

    seed(db, { name: "Nouveau venu", stars: 4 });
    const step = getTierStep(db, 4);
    expect("step" in step && step.step).toBe("quad");
  });
});

describe("Classement par étoiles (FR-2)", () => {
  it("range les titres comparés d'abord, par score, puis les autres (AC-5)", () => {
    const [top, second, third] = ["Premier", "Deuxième", "Troisième"].map((name) => seed(db, { name, stars: 4 }));
    seed(db, { name: "Pas encore comparé", stars: 4 });
    seed(db, { name: "Cinq étoiles", stars: 5 });
    seed(db, { name: "Vu sans note" });

    submitQuad(db, [top, second, third], 4, top, third);

    const ranking = getRanking(db);
    expect(ranking.unrated).toBe(1);
    expect(ranking.tiers.map((t) => t.stars)).toEqual([5, 4]);

    const four = ranking.tiers[1];
    expect(four.items.map((i) => i.name)).toEqual(["Premier", "Deuxième", "Troisième", "Pas encore comparé"]);
    expect(four.compared).toBe(3);
    expect(four.items[3].tierScore).toBeNull();
  });

  it("remet « pas encore comparé » un titre dont la note change (AC-4)", () => {
    const [a, b] = ["A", "B"].map((name) => seed(db, { name, stars: 4 }));
    seed(db, { name: "C", stars: 5 });
    submitQuad(db, [a, b], 4, a, null);

    updateItem(db, a, { rating: STARS[5] });

    const five = getRanking(db).tiers.find((t) => t.stars === 5)!;
    const moved = five.items.find((i) => i.name === "A")!;
    expect(moved.tierScore).toBeNull();
    expect(moved.tierDuels).toBe(0);
  });
});

describe("Choix des quatuors (FR-5, AC-7)", () => {
  it("réunit autour d'un titre ceux qui lui sont proches en score", () => {
    let seedValue = 7;
    const rng = () => {
      seedValue = (seedValue * 16807) % 2147483647;
      return seedValue / 2147483647;
    };
    // Un titre à comparer (ancre), trois voisins proches, trois titres lointains déjà départagés.
    const anchor = { id: 1, comparisons: 0, score: 1200 };
    const near = [2, 3, 4].map((id) => ({ id, comparisons: 1, score: 1200 + id * 5 }));
    const far = [5, 6, 7].map((id) => ({ id, comparisons: TIER_SETTLED_DUELS, score: 1600 + id }));
    let nearCount = 0;
    for (let i = 0; i < 200; i++) {
      const quad = pickQuad([anchor, ...near, ...far], rng);
      nearCount += quad.filter((m) => near.includes(m)).length;
    }
    // Sur 200 quatuors, les voisins proches dominent largement.
    expect(nearCount / 200).toBeGreaterThan(2.2);
  });
});

describe("Vue Personnes (FR-6, AC-8)", () => {
  it("compte les titres vus, fait la moyenne des notes et liste les titres à voir", () => {
    seed(db, { name: "Cinq", stars: 5, cast: [7] });
    seed(db, { name: "Quatre", stars: 4, cast: [7] });
    seed(db, { name: "Trois", stars: 3, cast: [7] });
    seed(db, { name: "À voir", status: "Unwatched", cast: [7] });
    seed(db, { name: "Sans elle", stars: 1, cast: [8] });
    setOpinion(db, { id: 7, name: "Personne 7" }, 1);

    const [person] = getPeopleWithOpinions(db);
    expect(person.seen.map((t) => t.name)).toEqual(["Cinq", "Quatre", "Trois"]);
    expect(person.averageStars).toBe(4);
    expect(person.toWatch.map((t) => t.name)).toEqual(["À voir"]);
    expect(person.roles).toEqual(["cast"]);
    expect(person.photoUrl).toBe("https://image.tmdb.org/t/p/w500/p7.jpg");
  });

  it("ne renvoie rien tant qu'aucun avis n'a été donné", () => {
    seed(db, { name: "Titre", stars: 5, cast: [7] });
    expect(getPeopleWithOpinions(db)).toEqual([]);
  });
});
