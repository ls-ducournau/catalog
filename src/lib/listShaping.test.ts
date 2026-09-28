import { describe, expect, it } from "vitest";
import {
  buildRows,
  CALIBRATION_BLOCK,
  calibrate,
  explorationPool,
  genreDistribution,
  interleaveExploration,
  miscalibration,
  type RowCandidate,
} from "./listShaping";

// spec: specs/recommendations-v1.md — amendements v1.4 (AC-21 à AC-23)

describe("miscalibration", () => {
  it("est nulle quand la liste reproduit exactement tes proportions", () => {
    const history = genreDistribution([{ genres: ["Drama"] }, { genres: ["Documentary"] }]);
    expect(miscalibration(history, history)).toBeCloseTo(0, 5);
  });

  it("grandit quand un de tes intérêts manque", () => {
    const history = genreDistribution([{ genres: ["Drama"] }, { genres: ["Documentary"] }]);
    const dramaOnly = genreDistribution([{ genres: ["Drama"] }]);
    expect(miscalibration(history, dramaOnly)).toBeGreaterThan(0.5);
  });
});

describe("calibrate (AC-21)", () => {
  // Historique : 70 % de drames, 30 % de documentaires.
  const history = genreDistribution([
    ...Array.from({ length: 7 }, () => ({ genres: ["Drama"] })),
    ...Array.from({ length: 3 }, () => ({ genres: ["Documentary"] })),
  ]);
  // Candidats : les mieux notés par le modèle sont tous des drames, mais de peu — comme dans
  // les données réelles. (Face à un écart écrasant, la calibration doit s'effacer devant le
  // modèle, et c'est ce qu'elle fait : elle ne remonte alors qu'un seul documentaire.)
  const ranked = [
    ...Array.from({ length: 20 }, (_, i) => ({ id: i, score: 10 - i * 0.1, genres: ["Drama"] })),
    ...Array.from({ length: 10 }, (_, i) => ({ id: 100 + i, score: 9 - i * 0.1, genres: ["Documentary"] })),
  ];

  it("fait remonter tes intérêts secondaires dans leurs vraies proportions, groupe par groupe", () => {
    const firstBlock = calibrate(ranked, history).slice(0, CALIBRATION_BLOCK);
    const documentaries = firstBlock.filter((t) => t.genres[0] === "Documentary").length;
    // 30 % de 12 : trois ou quatre documentaires.
    expect(documentaries).toBeGreaterThanOrEqual(3);
    expect(documentaries).toBeLessThanOrEqual(5);
  });

  it("range chaque groupe par pertinence : le premier titre est le meilleur de son groupe (v1.5)", () => {
    const firstBlock = calibrate(ranked, history).slice(0, CALIBRATION_BLOCK);
    const scores = firstBlock.map((t) => t.score);
    expect(scores).toEqual([...scores].sort((a, b) => b - a));
    // Un titre qui coche beaucoup de genres ne passe plus devant pour cette seule raison.
    const withAllRounder = [{ id: 999, score: 0, genres: ["Drama", "Documentary"] }, ...ranked];
    expect(calibrate(withAllRounder, history)[0].id).not.toBe(999);
  });

  it("sans calibration, les dix premiers ne contiennent aucun documentaire", () => {
    expect(ranked.slice(0, 10).every((t) => t.genres[0] === "Drama")).toBe(true);
  });

  it("ne perd ni ne duplique aucun titre", () => {
    const calibrated = calibrate(ranked, history);
    expect(calibrated).toHaveLength(ranked.length);
    expect(new Set(calibrated.map((t) => t.id)).size).toBe(ranked.length);
  });
});

describe("explorationPool", () => {
  const history = genreDistribution([
    ...Array.from({ length: 30 }, () => ({ genres: ["Drama"] })),
    { genres: ["Western"] },
  ]);
  const base = { voteAverage: 7.5, voteCount: 2000 };

  it("retient un genre peu présent, reconnu, que le modèle ne prédit pas mauvais", () => {
    const candidates = [
      { id: 1, score: 3, genres: ["Western"], ...base },
      { id: 2, score: 2, genres: ["Drama"], ...base },
      { id: 3, score: 1, genres: ["Western"], voteAverage: 5, voteCount: 2000 },
      { id: 4, score: -5, genres: ["Western"], ...base },
    ];
    expect(explorationPool(candidates, history).map((c) => c.id)).toEqual([1]);
  });
});

describe("interleaveExploration (AC-22)", () => {
  it("place l'exploration aux rangs 6, 12 et 18, étiquetée et sans doublon", () => {
    const main = Array.from({ length: 20 }, (_, i) => ({ id: i }));
    const pool = [{ id: 100 }, { id: 101 }, { id: 102 }, { id: 3 }];

    const result = interleaveExploration(main, pool);
    expect(result).toHaveLength(20);
    expect([result[5], result[11], result[17]].map((t) => t.id)).toEqual([100, 101, 102]);
    expect([result[5], result[11], result[17]].every((t) => t.exploration)).toBe(true);
    expect(new Set(result.map((t) => t.id)).size).toBe(20);
  });
});

describe("buildRows (AC-23)", () => {
  const candidate = (id: number, overrides: Partial<RowCandidate> = {}): RowCandidate => ({
    id,
    score: 100 - id,
    genres: ["Drama"],
    type: "Movie",
    documentary: false,
    runtime: 100,
    year: 2010,
    voteCount: 5000,
    onMyServices: false,
    anchor: null,
    exploration: false,
    ...overrides,
  });

  it("ne répète nulle part les titres de la première rangée, ni entre rangées thématiques", () => {
    const shaped = Array.from({ length: 60 }, (_, i) =>
      candidate(i, {
        onMyServices: i % 2 === 0,
        anchor: i % 3 === 0 ? { id: 999, name: "Whiplash", stars: 5 } : null,
        year: i % 4 === 0 ? 2026 : 2010,
      })
    );

    const rows = buildRows(shaped, { currentYear: 2026, hasSubscriptions: true });
    const best = new Set(rows[0].ids);
    const seen = new Set<number>();

    expect(rows[0].title).toBe("Le meilleur pour toi");
    for (const row of rows.slice(1)) {
      for (const id of row.ids) {
        expect(best.has(id)).toBe(false);
        expect(seen.has(id)).toBe(false);
        seen.add(id);
      }
    }
    expect(rows.map((r) => r.title)).toContain("Parce que tu as adoré Whiplash");
    expect(rows.map((r) => r.title)).toContain("Disponible sur tes abonnements");
  });

  it("n'affiche pas de rangée de moins de trois titres, ni celle des abonnements sans abonnement", () => {
    const shaped = Array.from({ length: 14 }, (_, i) => candidate(i, { onMyServices: true }));
    const rows = buildRows(shaped, { currentYear: 2026, hasSubscriptions: false });
    expect(rows.map((r) => r.key)).toEqual(["best"]);
  });
});
