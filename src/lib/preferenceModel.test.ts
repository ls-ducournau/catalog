import { describe, expect, it } from "vitest";
import {
  COMPATIBILITY_MIN_TITLES,
  spearman,
  trainCompatibility,
  trainPreferenceModel,
  type ModelTitle,
} from "./preferenceModel";

// spec: specs/recommendations-v1.md — AC-17, AC-18 (amendements v1.3)

/** Générateur pseudo-aléatoire à graine : les tests restent identiques d'une exécution à l'autre. */
function seededRandom(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const KEYWORDS = [
  "espace", "enquête", "zombie", "musique", "braquage", "romance", "guerre", "famille",
  "politique", "sport", "voyage", "vengeance", "amitié", "trahison", "futur", "passé",
];
/** Le goût caché que le modèle doit retrouver sans le connaître. */
const TASTE: Record<string, number> = { espace: 1.6, enquête: 1.2, zombie: -1.6, musique: -1.2 };
const GENRES = ["Drama", "Comedy", "Thriller", "Science Fiction", "Documentary", "Action"];
const CAST = Array.from({ length: 30 }, (_, i) => `Acteur ${i}`);

function syntheticLibrary(count: number, seed: number): ModelTitle[] {
  const random = seededRandom(seed);
  const pick = <T,>(pool: T[], n: number): T[] => {
    const copy = [...pool];
    const out: T[] = [];
    while (out.length < n) out.push(copy.splice(Math.floor(random() * copy.length), 1)[0]);
    return out;
  };

  return Array.from({ length: count }, (_, id) => {
    const keywords = pick(KEYWORDS, 2 + Math.floor(random() * 3));
    const voteAverage = 5 + random() * 3;
    const taste = keywords.reduce((sum, k) => sum + (TASTE[k] ?? 0), 0);
    // Goût réel = attrait pour certains thèmes + un peu de qualité générale + du bruit.
    const raw = 2.5 + taste + 0.3 * (voteAverage - 6.5) + (random() - 0.5) * 1.2;

    return {
      id,
      name: `Titre ${id}`,
      stars: Math.max(0, Math.min(5, Math.round(raw))),
      genres: pick(GENRES, 1 + Math.floor(random() * 2)),
      keywords,
      cast: pick(CAST, 3),
      directors: [],
      language: random() < 0.7 ? "en" : "fr",
      year: 1980 + Math.floor(random() * 45),
      runtime: 90 + Math.floor(random() * 60),
      voteAverage,
      voteCount: Math.floor(100 + random() * 20000),
    };
  });
}

describe("trainPreferenceModel", () => {
  const library = syntheticLibrary(300, 42);
  const train = library.slice(0, 240);
  // Le modèle ne voit jamais la note des titres évalués.
  const test = library.slice(240).map((t) => ({ ...t, stars: null }));
  const truth = library.slice(240).map((t) => t.stars as number);

  it("retrouve un goût connu mieux que la note TMDB seule, sur des titres jamais vus (AC-17)", () => {
    const model = trainPreferenceModel(train);
    const scores = model.scoreBatch(test).map((s) => s.score);

    const modelCorrelation = spearman(scores, truth);
    const tmdbCorrelation = spearman(
      test.map((t) => t.voteAverage as number),
      truth
    );

    expect(model.trainedOn).toBe(240);
    expect(modelCorrelation).toBeGreaterThan(tmdbCorrelation);
    expect(modelCorrelation).toBeGreaterThan(0.4);
  });

  it("n'explique une proposition que par des titres notés au moins ⭐⭐⭐⭐ (AC-18)", () => {
    const model = trainPreferenceModel(train);
    const scored = model.scoreBatch(test);

    const neighbours = scored.flatMap((s) => s.neighbours);
    expect(neighbours.length).toBeGreaterThan(0);
    for (const neighbour of neighbours) expect(neighbour.stars).toBeGreaterThanOrEqual(4);
  });

  it("est déterministe : mêmes notes, mêmes scores (condition du cache, FR-28)", () => {
    const first = trainPreferenceModel(train).scoreBatch(test);
    const second = trainPreferenceModel(train).scoreBatch(test);
    expect(second).toEqual(first);
  });

  it("n'utilise pas un titre comme son propre voisin", () => {
    const model = trainPreferenceModel(train);
    const [scored] = model.scoreBatch([train[0]]);
    expect(scored.neighbours.map((n) => n.id)).not.toContain(train[0].id);
  });

  it("classe par la seule qualité TMDB quand aucun titre n'est noté", () => {
    const unrated = library.slice(0, 3).map((t) => ({ ...t, stars: null }));
    const scored = trainPreferenceModel(unrated).scoreBatch(unrated);

    const byScore = [...scored].sort((a, b) => b.score - a.score).map((s) => s.id);
    const byQuality = [...unrated]
      .sort((a, b) => (b.voteAverage as number) - (a.voteAverage as number))
      .map((t) => t.id);
    expect(byScore).toEqual(byQuality);
  });

  it("supporte un titre sans aucune caractéristique de contenu", () => {
    const model = trainPreferenceModel(train);
    const bare: ModelTitle = {
      id: 9999,
      name: "Inconnu",
      stars: null,
      genres: [],
      keywords: [],
      cast: [],
      directors: [],
      language: null,
      year: null,
      runtime: null,
      voteAverage: null,
      voteCount: null,
    };
    const [scored] = model.scoreBatch([bare, test[0]]);
    expect(Number.isFinite(scored.score)).toBe(true);
    expect(scored.neighbours).toEqual([]);
  });
});

// spec: specs/recommendations-v1.md — amendements v1.5 (FR-34, FR-35)
describe("trainCompatibility", () => {
  const library = syntheticLibrary(300, 7);
  const train = library.slice(0, 220);
  const test = library.slice(220).map((t) => ({ ...t, stars: null }));
  const truth = library.slice(220).map((t) => t.stars as number);

  it("attend assez de notes pour caler une probabilité", () => {
    expect(trainCompatibility(library.slice(0, COMPATIBILITY_MIN_TITLES - 1))).toBeNull();
  });

  it("donne une probabilité entre 0 et 1, plus haute pour ce que tu aimes vraiment", () => {
    const compatibility = trainCompatibility(train)!;
    const model = trainPreferenceModel(train);
    const probabilities = test.map((t) => compatibility.probability(model.components(t)));

    expect(probabilities.every((p) => p > 0 && p < 1)).toBe(true);
    const liked = probabilities.filter((_, i) => truth[i] >= 4);
    const disliked = probabilities.filter((_, i) => truth[i] <= 1);
    const average = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    expect(average(liked)).toBeGreaterThan(average(disliked) + 0.2);
  });

  it("classe dans le même ordre que la probabilité, et un bonus la fait monter (FR-35)", () => {
    const compatibility = trainCompatibility(train)!;
    const model = trainPreferenceModel(train);
    const components = test.map((t) => model.components(t));
    const byScore = [...components].sort((a, b) => compatibility.score(b) - compatibility.score(a));
    const probabilities = byScore.map((c) => compatibility.probability(c));
    for (let i = 1; i < probabilities.length; i++) {
      expect(probabilities[i]).toBeLessThanOrEqual(probabilities[i - 1]);
    }
    expect(compatibility.probability(components[0], 0.6)).toBeGreaterThan(
      compatibility.probability(components[0])
    );
  });

  it("ne dépend pas du lot : un titre garde son pourcentage, seul ou parmi d'autres", () => {
    const compatibility = trainCompatibility(train)!;
    const model = trainPreferenceModel(train);
    const alone = compatibility.score(model.components(test[0]));
    const batch = test.map((t) => compatibility.score(model.components(t)));
    expect(batch[0]).toBe(alone);
  });
});

describe("spearman", () => {
  it("vaut 1 pour un ordre identique, -1 pour un ordre inverse", () => {
    expect(spearman([1, 2, 3, 4], [10, 20, 30, 40])).toBeCloseTo(1);
    expect(spearman([1, 2, 3, 4], [40, 30, 20, 10])).toBeCloseTo(-1);
  });
});
