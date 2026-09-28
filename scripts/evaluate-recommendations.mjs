import Database from "better-sqlite3";
import {
  COMPATIBILITY_MIN_STARS,
  spearman,
  trainCompatibility,
  trainPreferenceModel,
} from "../src/lib/preferenceModel.ts";
import { calibrate, genreDistribution, miscalibration } from "../src/lib/listShaping.ts";
import { centeredOpinions, personBonus } from "../src/lib/personPreference.ts";

/**
 * Banc d'évaluation du moteur de recommandation (spec recommendations-v1 FR-29).
 *
 * Validation croisée par titre sur la base locale : le modèle est entraîné sans jamais voir les
 * titres de test, puis on mesure la corrélation (Spearman) entre son classement et tes notes.
 * C'est la question que pose une recommandation : « vais-je aimer un titre que je n'ai pas vu ? ».
 *
 * Usage : npm run eval:recos
 */

const RATING = { "💩": 0, "⭐️": 1, "⭐️⭐️": 2, "⭐️⭐️⭐️": 3, "⭐️⭐️⭐️⭐️": 4, "⭐️⭐️⭐️⭐️⭐️": 5 };
const FOLDS = 5;
const REPEATS = 3;

const dbPath = new URL("../data/watchlist.db", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const db = new Database(dbPath, { readonly: true });

const rows = db
  .prepare(
    `SELECT id, name, rating, elo_score, duels_count, genre, director, tmdb_rating, vote_count, tmdb_features
     FROM items WHERE watch_status = 'Watched' AND rating IS NOT NULL`
  )
  .all()
  .filter((r) => r.rating in RATING);

const titles = rows.map((r) => {
  const f = r.tmdb_features ? JSON.parse(r.tmdb_features) : null;
  return {
    id: r.id,
    name: r.name,
    stars: RATING[r.rating],
    genres: f?.genres ?? (r.genre ? JSON.parse(r.genre) : []),
    keywords: f?.keywords ?? [],
    cast: (f?.cast ?? []).map((p) => p.name),
    directors: (f?.directors ?? []).map((p) => p.name),
    producers: (f?.producers ?? []).map((p) => p.name),
    people: [...(f?.cast ?? []), ...(f?.directors ?? []), ...(f?.producers ?? [])].map((p) => p.id),
    language: f?.language ?? null,
    year: f?.year ?? null,
    runtime: f?.runtime ?? null,
    voteAverage: f?.voteAverage ?? r.tmdb_rating,
    voteCount: f?.voteCount ?? r.vote_count,
    // Pour rejouer l'ancien moteur : Elo et genres/réalisateur tels qu'en base.
    legacy: {
      elo: r.elo_score,
      duels: r.duels_count,
      genres: r.genre ? JSON.parse(r.genre) : [],
      director: r.director,
    },
  };
});

/** Moteur v1 (FR-1 à FR-5), rejoué pour garder la comparaison dans le temps. */
function legacyEngine(train) {
  const affinity = (keysOf) => {
    const buckets = new Map();
    for (const t of train) {
      if (t.legacy.duels < 1) continue;
      for (const key of keysOf(t)) buckets.set(key, [...(buckets.get(key) ?? []), t.legacy.elo]);
    }
    return new Map(
      [...buckets].filter(([, v]) => v.length >= 2).map(([k, v]) => [k, v.reduce((a, b) => a + b, 0) / v.length])
    );
  };
  const genres = affinity((t) => t.legacy.genres);
  const directors = affinity((t) => (t.legacy.director ? [t.legacy.director] : []));

  return (t) => {
    const g = t.legacy.genres.filter((x) => genres.has(x)).map((x) => genres.get(x));
    const ga = g.length ? g.reduce((a, b) => a + b, 0) / g.length : null;
    const d = t.legacy.director && directors.has(t.legacy.director) ? directors.get(t.legacy.director) : null;
    if (ga !== null && d !== null) return 0.6 * ga + 0.4 * d;
    return ga ?? d ?? -1;
  };
}

/** Mélange déterministe (graine) : deux exécutions du banc donnent les mêmes plis. */
function seededShuffle(values, seed) {
  let a = seed;
  const random = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Avis du tri rapide sur les personnes (tri-rapide FR-7). Attention, mesure optimiste : un avis
 * sur une personne s'est souvent formé en voyant les titres testés. Elle sert à comparer deux
 * façons de l'appliquer, pas à chiffrer son apport réel.
 */
const opinions = new Map(
  db.prepare(`SELECT person_id, opinion FROM person_opinions`).all().map((r) => [r.person_id, r.opinion])
);
const centered = centeredOpinions(opinions);

/** Réglages du modèle en service (src/lib/preferenceService.ts, MODEL_OPTIONS). */
const MODEL_OPTIONS = { useProducers: true, qualityPriorVotes: 150 };

const REFERENCE = "Modèle en service (compatibilité)";
const results = {
  [REFERENCE]: [],
  "Mélange à poids égaux (v1.3)": [],
  "Sans la production": [],
  "Note TMDB brute (sans a priori)": [],
  "Avec avis (bruts)": [],
  "Avec avis (centrés, en service)": [],
  "Note TMDB seule": [],
  "Moteur v1 (Elo moyen)": [],
};

/** Compatibilité affichée : probabilité prédite et verdict réel, sur des titres jamais vus. */
const predictions = [];

/** FR-33 : taille de la tête de liste mesurée, et valeurs de λ comparées. */
const TOP = 20;
const LAMBDAS = [0, 0.3, 0.5, 0.7, 0.8, 0.9];
const calibration = Object.fromEntries(LAMBDAS.map((l) => [l, { stars: [], gap: [] }]));
/** Même λ, sans ranger les groupes par pertinence : l'ordre glouton brut d'avant la v1.5. */
const rawGreedy = { stars: [], gap: [] };
const firstPick = { service: [], raw: [], model: [] };
/** Portée de la calibration (λ en service) : fenêtre de candidats à chaque rang. */
const WINDOWS = [Infinity, 48, 24, 16];
const windows = Object.fromEntries(WINDOWS.map((w) => [w, { stars: [], gap: [], rankGap: [] }]));
const started = performance.now();

for (let repeat = 0; repeat < REPEATS; repeat++) {
  const shuffled = seededShuffle(titles, 1000 + repeat);
  for (let fold = 0; fold < FOLDS; fold++) {
    const testIds = new Set(shuffled.filter((_, i) => i % FOLDS === fold).map((t) => t.id));
    const train = titles.filter((t) => !testIds.has(t.id));
    const test = titles.filter((t) => testIds.has(t.id));
    const truth = test.map((t) => t.stars);

    const unseen = test.map((t) => ({ ...t, stars: null }));
    const model = trainPreferenceModel(train, MODEL_OPTIONS);
    const scored = model.scoreBatch(unseen);
    results["Mélange à poids égaux (v1.3)"].push(spearman(scored.map((s) => s.score), truth));

    // Le classement de l'app (recommendations v1.5 FR-35) : par compatibilité, calée sur
    // l'entraînement seul (validation croisée interne), exactement comme en service.
    const compatibility = trainCompatibility(train, MODEL_OPTIONS);
    const components = unseen.map((t) => model.components(t));
    const serviceScores = components.map((c) => compatibility.score(c));
    results[REFERENCE].push(spearman(serviceScores, truth));
    test.forEach((t, i) => {
      predictions.push({
        p: compatibility.probability(components[i]),
        y: t.stars >= COMPATIBILITY_MIN_STARS ? 1 : 0,
      });
    });

    const withOpinions = (weights) =>
      spearman(serviceScores.map((score, i) => score + personBonus(test[i].people, weights)), truth);
    results["Avec avis (bruts)"].push(withOpinions(opinions));
    results["Avec avis (centrés, en service)"].push(withOpinions(centered));

    // Témoin de la moyenne bayésienne (sorties v1) : 50 votes −0,002, 500 votes −0,000, brute
    // −0,014 face à 150 lors du réglage ; on garde la note brute comme repère.
    {
      const variant = { ...MODEL_OPTIONS, qualityPriorVotes: 0 };
      const variantModel = trainPreferenceModel(train, variant);
      const variantCompatibility = trainCompatibility(train, variant);
      results["Note TMDB brute (sans a priori)"].push(
        spearman(unseen.map((t) => variantCompatibility.score(variantModel.components(t))), truth)
      );
    }

    // Témoin tri-rapide FR-9 : le même classement sans la production.
    const bareModel = trainPreferenceModel(train);
    const bareCompatibility = trainCompatibility(train);
    results["Sans la production"].push(
      spearman(unseen.map((t) => bareCompatibility.score(bareModel.components(t))), truth)
    );

    // Calibration : cible = proportions de genres de ce que tu aimes (⭐⭐⭐ ou plus) dans
    // l'entraînement ; on mesure la note réelle moyenne et l'écart de calibration des 20 premiers.
    const target = genreDistribution(train.filter((t) => t.stars >= 3));
    const byId = new Map(test.map((t) => [t.id, t]));
    const ranked = test
      .map((t, i) => ({ id: t.id, score: serviceScores[i], genres: t.genres }))
      .sort((a, b) => b.score - a.score);
    const rawHead = calibrate(ranked, target, { size: 48, block: 1 }).slice(0, TOP);
    rawGreedy.stars.push(rawHead.reduce((sum, t) => sum + byId.get(t.id).stars, 0) / rawHead.length);
    rawGreedy.gap.push(miscalibration(target, genreDistribution(rawHead)));
    // Premier titre de la liste : c'est lui qu'affiche « Le meilleur pour toi ».
    const first = calibrate(ranked, target, { size: 48 })[0];
    firstPick.service.push(byId.get(first.id).stars);
    firstPick.raw.push(byId.get(rawHead[0].id).stars);
    firstPick.model.push(byId.get(ranked[0].id).stars);
    const modelRank = new Map(ranked.map((t, i) => [t.id, i]));
    for (const window of WINDOWS) {
      const head = calibrate(ranked, target, { size: 48, window }).slice(0, TOP);
      windows[window].stars.push(head.reduce((sum, t) => sum + byId.get(t.id).stars, 0) / head.length);
      windows[window].gap.push(miscalibration(target, genreDistribution(head)));
      // Rang du modèle le plus bas remonté dans les 20 premiers : ce que « va chercher » la calibration.
      windows[window].rankGap.push(Math.max(...head.map((t) => modelRank.get(t.id))));
    }
    for (const lambda of LAMBDAS) {
      const head = (lambda === 0 ? ranked : calibrate(ranked, target, { lambda, size: 48 })).slice(0, TOP);
      calibration[lambda].stars.push(head.reduce((sum, t) => sum + byId.get(t.id).stars, 0) / head.length);
      calibration[lambda].gap.push(miscalibration(target, genreDistribution(head)));
    }

    results["Note TMDB seule"].push(spearman(test.map((t) => t.voteAverage ?? 0), truth));

    const legacy = legacyEngine(train);
    results["Moteur v1 (Elo moyen)"].push(spearman(test.map(legacy), truth));
  }
}

const mean = (v) => v.reduce((a, b) => a + b, 0) / v.length;
const sd = (v) => Math.sqrt(mean(v.map((x) => (x - mean(v)) ** 2)));
const withFeatures = titles.filter((t) => t.keywords.length > 0).length;

console.log(
  `Titres vus notés : ${titles.length} (dont ${withFeatures} avec caractéristiques TMDB)` +
    ` | ${FOLDS} plis × ${REPEATS} répétitions | ${((performance.now() - started) / 1000).toFixed(1)} s\n`
);
console.log("Méthode".padEnd(32), "Corrélation avec tes notes (titres jamais vus)");
Object.entries(results)
  .sort((a, b) => mean(b[1]) - mean(a[1]))
  .forEach(([name, values]) =>
    console.log(name.padEnd(32), `${mean(values).toFixed(3)} ±${sd(values).toFixed(3)}`)
  );

// Écart apparié : les deux méthodes sont mesurées sur les mêmes plis, c'est ce qui départage.
const base = results[REFERENCE];
console.log(`\nÉcart apparié avec le modèle en service (${base.length} plis)`);
for (const [name, values] of Object.entries(results)) {
  if (values === base || name.startsWith("Moteur") || name.startsWith("Note")) continue;
  const diffs = values.map((v, i) => v - base[i]);
  const se = sd(diffs) / Math.sqrt(diffs.length);
  const better = diffs.filter((d) => d > 0).length;
  console.log(
    name.padEnd(32),
    `${mean(diffs) >= 0 ? "+" : ""}${mean(diffs).toFixed(3)} ±${se.toFixed(3)} (erreur type)`,
    `| meilleur sur ${better}/${diffs.length} plis`
  );
}

console.log(`\nCalibration des ${TOP} premiers (FR-33) : note réelle moyenne et écart de calibration`);
console.log("λ".padEnd(8), "Note moyenne".padEnd(16), "Écart (KL)");
const baseStars = mean(calibration[0].stars);
for (const lambda of LAMBDAS) {
  const stars = mean(calibration[lambda].stars);
  const delta = stars - baseStars;
  console.log(
    String(lambda).padEnd(8),
    `${stars.toFixed(2)} (${delta >= 0 ? "+" : ""}${delta.toFixed(2)})`.padEnd(16),
    mean(calibration[lambda].gap).toFixed(3)
  );
}
{
  const stars = mean(rawGreedy.stars);
  console.log(
    "0.8 brut".padEnd(8),
    `${stars.toFixed(2)} (${stars - baseStars >= 0 ? "+" : ""}${(stars - baseStars).toFixed(2)})`.padEnd(16),
    mean(rawGreedy.gap).toFixed(3),
    "  (ordre glouton, sans groupes rangés : avant v1.5)"
  );
}
console.log("\nPortée de la calibration (λ en service)");
console.log("Fenêtre".padEnd(10), "Note moyenne".padEnd(16), "Écart (KL)".padEnd(12), "Rang le plus bas remonté");
for (const window of WINDOWS) {
  const stars = mean(windows[window].stars);
  console.log(
    String(window === Infinity ? "illimitée" : window).padEnd(10),
    `${stars.toFixed(2)} (${stars - baseStars >= 0 ? "+" : ""}${(stars - baseStars).toFixed(2)})`.padEnd(16),
    mean(windows[window].gap).toFixed(3).padEnd(12),
    mean(windows[window].rankGap).toFixed(0)
  );
}
console.log(
  `Note réelle du 1er titre : ${mean(firstPick.service).toFixed(2)} en service,` +
    ` ${mean(firstPick.raw).toFixed(2)} en glouton brut, ${mean(firstPick.model).toFixed(2)} sans calibration`
);

// ---------- compatibilité (score de recommandation affiché) ----------

const baseRate = mean(predictions.map((r) => r.y));
const brier = mean(predictions.map((r) => (r.p - r.y) ** 2));
const brierBase = mean(predictions.map((r) => (baseRate - r.y) ** 2));
// AUC : probabilité qu'un titre aimé passe devant un titre pas aimé.
const positives = predictions.filter((r) => r.y === 1).map((r) => r.p);
const negatives = predictions.filter((r) => r.y === 0).map((r) => r.p);
let wins = 0;
for (const pos of positives) for (const neg of negatives) wins += pos > neg ? 1 : pos === neg ? 0.5 : 0;
const auc = wins / (positives.length * negatives.length);

console.log(
  `\nCompatibilité (probabilité de ${"⭐".repeat(COMPATIBILITY_MIN_STARS)} ou plus, titres jamais vus)`
);
console.log(
  `Brier ${brier.toFixed(3)} (sans modèle : ${brierBase.toFixed(3)}, gain ${((1 - brier / brierBase) * 100).toFixed(0)} %)` +
    ` | AUC ${auc.toFixed(3)} | taux de base ${(baseRate * 100).toFixed(0)} %`
);
console.log("Tranche prévue".padEnd(16), "Prévu".padEnd(8), "Réel".padEnd(8), "Titres");
for (let low = 0; low < 1; low += 0.2) {
  const bucket = predictions.filter((r) => r.p >= low && (r.p < low + 0.2 || (low >= 0.8 && r.p <= 1)));
  if (bucket.length === 0) continue;
  console.log(
    `${Math.round(low * 100)}-${Math.round((low + 0.2) * 100)} %`.padEnd(16),
    `${(mean(bucket.map((r) => r.p)) * 100).toFixed(0)} %`.padEnd(8),
    `${(mean(bucket.map((r) => r.y)) * 100).toFixed(0)} %`.padEnd(8),
    bucket.length
  );
}
