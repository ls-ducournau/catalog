import { describe, expect, it } from "vitest";
import {
  applyFatigue,
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

// spec: specs/recommandations-fraicheur-v1.md (AC-4, AC-5)
describe("applyFatigue (lassitude)", () => {
  const lot = Array.from({ length: 20 }, (_, i) => ({ id: i + 1, compatibility: 0.9 - i / 40 }));
  const ids = (list: { id: number }[]) => list.map((t) => t.id);
  const shown = (days: Record<number, number>) => (t: { id: number }) => days[t.id] ?? 0;

  it("un pas de 0 rend l'ordre d'entrée (NFR-3)", () => {
    expect(applyFatigue(lot, shown({ 1: 9 }), { step: 0 })).toEqual(lot);
  });

  it("sans exposition, l'ordre ne bouge pas", () => {
    expect(applyFatigue(lot, () => 0)).toEqual(lot);
  });

  it("chaque jour montré sans geste fait reculer le titre de `step` places", () => {
    expect(ids(applyFatigue(lot, shown({ 1: 1 }), { step: 3 })).slice(0, 5)).toEqual([2, 3, 4, 1, 5]);
    expect(ids(applyFatigue(lot, shown({ 1: 2 }), { step: 3 })).slice(0, 8)).toEqual([2, 3, 4, 5, 6, 7, 1, 8]);
  });

  it("un jour ancien, à moitié effacé, fait reculer à moitié", () => {
    expect(ids(applyFatigue(lot, shown({ 1: 0.5 }), { step: 4 })).slice(0, 4)).toEqual([2, 3, 1, 4]);
  });

  it("le recul est plafonné à une rangée : un titre montré longtemps reste dans la course", () => {
    const result = ids(applyFatigue(lot, shown({ 1: 30 }), { step: 3, maxShift: 12 }));
    expect(result.indexOf(1)).toBe(12);
  });

  it("à place égale, le moins montré passe devant, puis l'ordre d'entrée", () => {
    // Le 1 recule de 3 places, sur la place du 4 : le 4 garde la sienne.
    expect(ids(applyFatigue(lot, shown({ 1: 1 }), { step: 3 })).slice(2, 4)).toEqual([4, 1]);
    // Deux titres montrés autant de jours gardent leur ordre entre eux.
    expect(ids(applyFatigue(lot, shown({ 1: 1, 2: 1 }), { step: 3 })).slice(0, 6)).toEqual([3, 4, 1, 5, 2, 6]);
  });

  it("si tout le lot est autant montré, l'ordre ne bouge pas (EC-1)", () => {
    expect(ids(applyFatigue(lot, () => 3))).toEqual(ids(lot));
  });

  it("ne retire ni ne modifie rien : seule la place change (AC-5)", () => {
    const result = applyFatigue(lot, shown({ 1: 2, 4: 1 }));
    expect([...result].sort((a, b) => a.id - b.id)).toEqual(lot);
    expect(result.find((t) => t.id === 1)).toBe(lot[0]);
  });
});
