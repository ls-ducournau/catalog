// Modèle de préférence — spec: specs/recommendations-v1.md, amendements v1.3 (FR-24, FR-25)
//
// Module volontairement autonome (aucun import) : le banc d'évaluation
// (scripts/evaluate-recommendations.mjs) l'exécute directement avec Node, sans build.

/** Ce que le modèle sait d'un titre : ses caractéristiques de contenu, et ta note s'il en a une. */
export type ModelTitle = {
  id: number;
  name: string;
  /** Ta note : 💩 = 0 … ⭐⭐⭐⭐⭐ = 5 ; null si pas notée. */
  stars: number | null;
  genres: string[];
  keywords: string[];
  cast: string[];
  directors: string[];
  /** Production (tri-rapide FR-9) : n'entre dans le modèle qu'avec `useProducers`. */
  producers?: string[];
  language: string | null;
  year: number | null;
  runtime: number | null;
  voteAverage: number | null;
  voteCount: number | null;
  /**
   * Identifiants TMDB des personnes du titre (interprètes, réalisation, production). Ignoré par
   * le modèle : sert seulement au poids de tes avis (tri-rapide-v1 FR-7).
   */
  people?: number[];
};

export type Neighbour = { id: number; name: string; stars: number; similarity: number };

export type ScoredTitle = {
  id: number;
  /** Relatif au lot évalué : n'a de sens que pour classer ce lot. */
  score: number;
  /** Titres que tu as aimés et qui ressemblent à celui-ci (FR-25). */
  neighbours: Neighbour[];
};

/**
 * Les trois avis du modèle, en unités absolues (note TMDB, étoiles estimées par les voisins,
 * étoiles estimées par la régression) : contrairement au score, ils ne dépendent pas du lot.
 */
export type RawComponents = [quality: number, neighbours: number, ridge: number];

export type PreferenceModel = {
  scoreBatch(titles: ModelTitle[]): ScoredTitle[];
  /** Composantes brutes d'un titre : c'est d'elles que part la compatibilité. */
  components(title: ModelTitle): RawComponents;
  /** Nombre de titres notés ayant servi à l'entraînement. */
  trainedOn: number;
};

export type ModelOptions = {
  /** Jetons de production dans le contenu : expérience du banc, désactivée par défaut. */
  useProducers?: boolean;
  /**
   * Votes fictifs à la note moyenne ajoutés à la note TMDB (moyenne bayésienne) : un 9/10 sur
   * 3 votes ne vaut pas un 9/10 sur 20 000. 0 = note brute (comportement d'avant).
   */
  qualityPriorVotes?: number;
};

// ---------- réglages, tels que mesurés sur le banc ----------

/** Voisins pris en compte pour estimer ta note d'un titre. */
const KNN_NEIGHBOURS = 25;
/** Poids de ta note moyenne dans l'estimation par voisins : peu de voisins proches = prudence. */
const KNN_SHRINK = 1;
/** Une caractéristique doit apparaître dans assez de titres pour peser dans la régression. */
const RIDGE_MIN_TITLES = 12;
const RIDGE_L2 = 8;
const RIDGE_EPOCHS = 300;
const RIDGE_RATE = 0.01;
/** Seuls les titres que tu as vraiment aimés servent d'explication. */
const EXPLANATION_MIN_STARS = 4;
const EXPLANATION_COUNT = 3;
/**
 * Part minimale de la ressemblance qui doit venir de thèmes, d'acteurs ou de réalisateurs
 * partagés pour qu'un voisin serve d'explication. Mesuré : sans ce garde-fou, la langue et la
 * décennie suffisaient à « expliquer » Monsieur Aznavour par L'Âge d'or des animaux.
 */
const EXPLANATION_MIN_SUBSTANCE = 0.5;
/**
 * Ressemblance minimale d'un voisin explicatif. Relu sur des exemples réels : au-dessus de
 * 0,15, les liens se défendent (Call Me by Your Name ← Billy Elliot) ; entre 0,12 et 0,14, un
 * sur deux ne tient pas (Orgueil et Préjugés ← Adolescence). Environ 3 propositions sur 4
 * gardent une explication ; les autres n'en affichent pas plutôt que d'en inventer une.
 */
const EXPLANATION_MIN_SIMILARITY = 0.15;

/** Ce qui se nomme dans une explication : un thème, un acteur, un réalisateur. */
function isSubstantive(token: string): boolean {
  return (
    token.startsWith("motcle:") ||
    token.startsWith("acteur:") ||
    token.startsWith("real:") ||
    token.startsWith("prod:")
  );
}
const DEFAULT_VOTE_AVERAGE = 6.5;
const DEFAULT_RUNTIME = 60;

// ---------- utilitaires ----------

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length;
}

function standardDeviation(values: number[]): number {
  const m = mean(values);
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)));
}

/** Centre-réduit un lot ; un lot sans dispersion donne des zéros plutôt qu'une division par zéro. */
function zScores(values: number[]): number[] {
  const m = mean(values);
  const s = standardDeviation(values) || 1;
  return values.map((v) => (v - m) / s);
}

/** Tout ce qui décrit le contenu d'un titre, en jetons préfixés par famille. */
function contentTokens(title: ModelTitle, options: ModelOptions = {}): string[] {
  return [
    ...title.genres.map((g) => `genre:${g}`),
    ...title.keywords.map((k) => `motcle:${k}`),
    ...title.cast.map((c) => `acteur:${c}`),
    ...title.directors.map((d) => `real:${d}`),
    ...(options.useProducers ? (title.producers ?? []).map((p) => `prod:${p}`) : []),
    ...(title.language ? [`langue:${title.language}`] : []),
    ...(title.year ? [`decennie:${Math.floor(title.year / 10) * 10}`] : []),
  ];
}

function numericFeatures(title: ModelTitle): number[] {
  return [
    title.voteAverage ?? DEFAULT_VOTE_AVERAGE,
    Math.log1p(title.voteCount ?? 0),
    title.runtime ?? DEFAULT_RUNTIME,
  ];
}

// ---------- composante 1 : voisins de contenu ----------

type SparseVector = Map<string, number>;

function buildNeighbourIndex(rated: ModelTitle[], options: ModelOptions) {
  // TF-IDF : un mot-clé présent partout ne dit rien, un mot-clé rare et partagé dit beaucoup.
  const documentFrequency = new Map<string, number>();
  for (const title of rated) {
    for (const token of new Set(contentTokens(title, options))) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const total = rated.length;

  const vectorize = (title: ModelTitle): SparseVector => {
    const vector: SparseVector = new Map();
    for (const token of new Set(contentTokens(title, options))) {
      const df = documentFrequency.get(token);
      // Un jeton vu dans un seul titre ne relie ce titre à aucun autre.
      if (df !== undefined && df >= 2) vector.set(token, Math.log(total / df));
    }
    let norm = 0;
    for (const weight of vector.values()) norm += weight * weight;
    norm = Math.sqrt(norm) || 1;
    for (const [token, weight] of vector) vector.set(token, weight / norm);
    return vector;
  };

  const ratedVectors = rated.map((title) => ({ title, vector: vectorize(title) }));
  const meanStars = mean(rated.map((t) => t.stars as number));

  return (title: ModelTitle): { estimate: number; neighbours: Neighbour[] } => {
    const vector = vectorize(title);
    const similarities: { title: ModelTitle; similarity: number; substance: number }[] = [];

    for (const candidate of ratedVectors) {
      if (candidate.title.id === title.id) continue;
      let dot = 0;
      let substance = 0;
      for (const [token, weight] of vector) {
        const other = candidate.vector.get(token);
        if (other === undefined) continue;
        dot += weight * other;
        if (isSubstantive(token)) substance += weight * other;
      }
      if (dot > 0) similarities.push({ title: candidate.title, similarity: dot, substance });
    }

    similarities.sort((a, b) => b.similarity - a.similarity);
    const top = similarities.slice(0, KNN_NEIGHBOURS);
    const weightSum = top.reduce((sum, n) => sum + n.similarity, 0);
    const estimate =
      weightSum === 0
        ? meanStars
        : (top.reduce((sum, n) => sum + n.similarity * (n.title.stars as number), 0) +
            KNN_SHRINK * meanStars) /
          (weightSum + KNN_SHRINK);

    // L'estimation ci-dessus utilise toute la ressemblance ; l'explication, elle, doit reposer
    // sur quelque chose de nommable (FR-25) : sinon deux titres français des années 2020 se
    // « ressemblent » par la seule langue et la seule décennie.
    const neighbours = top
      .filter(
        (n) =>
          (n.title.stars as number) >= EXPLANATION_MIN_STARS &&
          n.similarity >= EXPLANATION_MIN_SIMILARITY &&
          n.substance >= EXPLANATION_MIN_SUBSTANCE * n.similarity
      )
      .slice(0, EXPLANATION_COUNT)
      .map((n) => ({
        id: n.title.id,
        name: n.title.name,
        stars: n.title.stars as number,
        similarity: n.similarity,
      }));

    return { estimate, neighbours };
  };
}

// ---------- composante 2 : régression ridge sur caractéristiques robustes ----------

function trainRidge(rated: ModelTitle[], options: ModelOptions): (title: ModelTitle) => number {
  const counts = new Map<string, number>();
  for (const title of rated) {
    for (const token of new Set(contentTokens(title, options))) {
      counts.set(token, (counts.get(token) ?? 0) + 1);
    }
  }
  // Seules les caractéristiques fréquentes : c'est ce qui évite le sur-apprentissage mesuré
  // avec un modèle à plus de mille dimensions.
  const vocabulary = [...counts].filter(([, c]) => c >= RIDGE_MIN_TITLES).map(([t]) => t);
  const index = new Map(vocabulary.map((token, i) => [token, i]));

  const numericCount = numericFeatures(rated[0]).length;
  const numericMeans = Array.from({ length: numericCount }, (_, j) =>
    mean(rated.map((t) => numericFeatures(t)[j]))
  );
  const numericDeviations = Array.from(
    { length: numericCount },
    (_, j) => standardDeviation(rated.map((t) => numericFeatures(t)[j])) || 1
  );

  const dimension = vocabulary.length + numericCount;
  const encode = (title: ModelTitle): Float64Array => {
    const x = new Float64Array(dimension);
    for (const token of contentTokens(title, options)) {
      const i = index.get(token);
      if (i !== undefined) x[i] = 1;
    }
    numericFeatures(title).forEach((value, j) => {
      x[vocabulary.length + j] = (value - numericMeans[j]) / numericDeviations[j];
    });
    return x;
  };

  const targetMean = mean(rated.map((t) => t.stars as number));
  const weights = new Float64Array(dimension);
  const encoded = rated.map(encode);
  const decay = RIDGE_L2 / rated.length;

  for (let epoch = 0; epoch < RIDGE_EPOCHS; epoch++) {
    encoded.forEach((x, n) => {
      let prediction = 0;
      for (let d = 0; d < dimension; d++) prediction += weights[d] * x[d];
      const error = (rated[n].stars as number) - targetMean - prediction;
      for (let d = 0; d < dimension; d++) {
        weights[d] += RIDGE_RATE * (error * x[d] - decay * weights[d]);
      }
    });
  }

  return (title) => {
    const x = encode(title);
    let prediction = targetMean;
    for (let d = 0; d < dimension; d++) prediction += weights[d] * x[d];
    return prediction;
  };
}

// ---------- composante 3 : qualité reconnue ----------

/**
 * Note TMDB, rétrécie vers la moyenne de tes titres notés quand elle repose sur peu de votes.
 * Un titre à venir (0 vote) vaut la moyenne, au lieu de 0.
 */
function qualityEstimator(rated: ModelTitle[], priorVotes: number): (title: ModelTitle) => number {
  const known = rated.map((t) => t.voteAverage).filter((v): v is number => v !== null && v > 0);
  const prior = known.length > 0 ? mean(known) : DEFAULT_VOTE_AVERAGE;
  return (title) => {
    const votes = title.voteCount ?? 0;
    const average = title.voteAverage ?? prior;
    if (priorVotes <= 0) return title.voteAverage ?? DEFAULT_VOTE_AVERAGE;
    return (average * votes + prior * priorVotes) / (votes + priorVotes);
  };
}

// ---------- assemblage ----------

/**
 * Entraîne le modèle sur les titres notés. Déterministe : mêmes notes, mêmes scores — c'est ce
 * qui permet de le garder en cache et de le tester.
 */
export function trainPreferenceModel(titles: ModelTitle[], options: ModelOptions = {}): PreferenceModel {
  const rated = titles.filter((t) => t.stars !== null);
  if (rated.length === 0) {
    return {
      trainedOn: 0,
      components: (title) => [title.voteAverage ?? DEFAULT_VOTE_AVERAGE, 0, 0],
      scoreBatch: (batch) =>
        zScores(batch.map((t) => t.voteAverage ?? DEFAULT_VOTE_AVERAGE)).map((score, i) => ({
          id: batch[i].id,
          score,
          neighbours: [],
        })),
    };
  }

  const neighbourEstimate = buildNeighbourIndex(rated, options);
  const ridgeEstimate = trainRidge(rated, options);
  const qualityOf = qualityEstimator(rated, options.qualityPriorVotes ?? 0);

  return {
    trainedOn: rated.length,
    components: (title) => [qualityOf(title), neighbourEstimate(title).estimate, ridgeEstimate(title)],
    scoreBatch(batch) {
      if (batch.length === 0) return [];

      const quality = batch.map(qualityOf);
      const knn = batch.map(neighbourEstimate);
      const ridge = batch.map(ridgeEstimate);

      // Mélange à poids égaux de trois composantes centrées-réduites : c'est la
      // configuration mesurée sur le banc (0,38, contre 0,35 pour la qualité seule).
      const zQuality = zScores(quality);
      const zKnn = zScores(knn.map((k) => k.estimate));
      const zRidge = zScores(ridge);

      return batch.map((title, i) => ({
        id: title.id,
        score: zQuality[i] + zKnn[i] + zRidge[i],
        neighbours: knn[i].neighbours,
      }));
    },
  };
}

// ---------- compatibilité : probabilité d'aimer (score de recommandation affiché) ----------

/** « Aimer », c'est noter ⭐⭐⭐⭐ ou plus. */
export const COMPATIBILITY_MIN_STARS = 4;
/** En dessous, trop peu d'exemples pour caler une probabilité honnête. */
export const COMPATIBILITY_MIN_TITLES = 30;
const COMPATIBILITY_FOLDS = 5;
const LOGISTIC_L2 = 1;
const LOGISTIC_EPOCHS = 500;
const LOGISTIC_RATE = 0.5;

/**
 * Échelle du score de classement : celle du mélange historique (trois composantes
 * centrées-réduites, écart type ≈ 2). Les réglages exprimés dans ces unités (avis sur les
 * personnes, bonus de semences de la découverte) gardent ainsi le même poids.
 */
export const RANK_SCORE_SCALE = 2;

export type CompatibilityModel = {
  /**
   * Probabilité que tu notes le titre ⭐⭐⭐⭐ ou plus, entre 0 et 1. `bonus` (unités du score de
   * classement) y reporte tes avis sur les personnes, pour que le pourcentage suive l'ordre.
   */
  probability(components: RawComponents, bonus?: number): number;
  /** Score de classement : croissant avec la probabilité, indépendant du lot évalué. */
  score(components: RawComponents): number;
  /** Part de tes titres notés ⭐⭐⭐⭐ ou plus : le point de départ sans rien savoir du titre. */
  baseRate: number;
};

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Régression logistique sur composantes centrées-réduites, légèrement régularisée. */
function fitLogistic(rows: { x: RawComponents; y: number }[]): CompatibilityModel {
  const dimension = rows[0].x.length;
  const means = Array.from({ length: dimension }, (_, j) => mean(rows.map((r) => r.x[j])));
  const deviations = Array.from(
    { length: dimension },
    (_, j) => standardDeviation(rows.map((r) => r.x[j])) || 1
  );
  const standardize = (x: RawComponents) => x.map((v, j) => (v - means[j]) / deviations[j]);
  const encoded = rows.map((r) => ({ x: standardize(r.x), y: r.y }));

  const baseRate = mean(rows.map((r) => r.y));
  const clamped = Math.min(0.99, Math.max(0.01, baseRate));
  let bias = Math.log(clamped / (1 - clamped));
  const weights = new Array<number>(dimension).fill(0);
  const n = encoded.length;

  for (let epoch = 0; epoch < LOGISTIC_EPOCHS; epoch++) {
    let gradBias = 0;
    const grad = new Array<number>(dimension).fill(0);
    for (const { x, y } of encoded) {
      const error = sigmoid(bias + x.reduce((sum, v, j) => sum + v * weights[j], 0)) - y;
      gradBias += error;
      for (let j = 0; j < dimension; j++) grad[j] += error * x[j];
    }
    bias -= (LOGISTIC_RATE * gradBias) / n;
    for (let j = 0; j < dimension; j++) {
      weights[j] -= (LOGISTIC_RATE * (grad[j] + LOGISTIC_L2 * weights[j])) / n;
    }
  }

  const logit = (components: RawComponents) =>
    bias + standardize(components).reduce((sum, v, j) => sum + v * weights[j], 0);
  // Centre et dispersion des logits sur tes titres notés : c'est ce qui rend le score comparable
  // d'un lot à l'autre (la pile, la découverte, le tri rapide).
  const logits = rows.map((r) => logit(r.x));
  const logitMean = mean(logits);
  const logitDeviation = standardDeviation(logits) || 1;

  return {
    baseRate,
    probability: (components, bonus = 0) =>
      sigmoid(logit(components) + (bonus * logitDeviation) / RANK_SCORE_SCALE),
    score: (components) => ((logit(components) - logitMean) / logitDeviation) * RANK_SCORE_SCALE,
  };
}

/**
 * Cale la compatibilité sur tes notes, sans tricher : chaque titre noté est prédit par un modèle
 * qui ne l'a jamais vu (validation croisée), puis une régression logistique apprend à traduire
 * ces avis en probabilité. Déterministe : plis attribués par ordre d'identifiant.
 */
export function trainCompatibility(
  titles: ModelTitle[],
  options: ModelOptions = {}
): CompatibilityModel | null {
  const rated = titles.filter((t) => t.stars !== null).sort((a, b) => a.id - b.id);
  if (rated.length < COMPATIBILITY_MIN_TITLES) return null;

  const rows: { x: RawComponents; y: number }[] = [];
  for (let fold = 0; fold < COMPATIBILITY_FOLDS; fold++) {
    const held = rated.filter((_, i) => i % COMPATIBILITY_FOLDS === fold);
    const model = trainPreferenceModel(
      rated.filter((_, i) => i % COMPATIBILITY_FOLDS !== fold),
      options
    );
    for (const title of held) {
      rows.push({
        x: model.components({ ...title, stars: null }),
        y: (title.stars as number) >= COMPATIBILITY_MIN_STARS ? 1 : 0,
      });
    }
  }
  return fitLogistic(rows);
}

/** Corrélation de rang de Spearman : l'unique mesure du banc (FR-29). */
export function spearman(xs: number[], ys: number[]): number {
  const rank = (values: number[]): number[] => {
    const sorted = values.map((value, i) => [value, i] as const).sort((a, b) => a[0] - b[0]);
    const ranks = new Array<number>(values.length);
    let i = 0;
    while (i < sorted.length) {
      let j = i;
      while (j + 1 < sorted.length && sorted[j + 1][0] === sorted[i][0]) j++;
      for (let k = i; k <= j; k++) ranks[sorted[k][1]] = (i + j) / 2;
      i = j + 1;
    }
    return ranks;
  };

  const rx = rank(xs);
  const ry = rank(ys);
  const mx = mean(rx);
  const my = mean(ry);
  let covariance = 0;
  let vx = 0;
  let vy = 0;
  for (let i = 0; i < xs.length; i++) {
    covariance += (rx[i] - mx) * (ry[i] - my);
    vx += (rx[i] - mx) ** 2;
    vy += (ry[i] - my) ** 2;
  }
  return vx === 0 || vy === 0 ? 0 : covariance / Math.sqrt(vx * vy);
}
