import type Database from "better-sqlite3";
import { RATING_RANK_SQL } from "./itemService";
import {
  trainCompatibility,
  trainPreferenceModel,
  type CompatibilityModel,
  type ModelOptions,
  type ModelTitle,
  type PreferenceModel,
  type ScoredTitle,
} from "./preferenceModel";
import type { TmdbFeatures } from "./tmdb";

// spec: specs/recommendations-v1.md — amendements v1.3 (FR-24, FR-26, FR-28)

/** En dessous, aucun classement fiable : démarrage à froid (FR-26). */
export const MIN_RATED_TITLES = 10;

/**
 * Réglages du modèle en service, chacun validé sur le banc en écart apparié :
 * - la production (tri-rapide FR-9) : +0,010, meilleure sur 13 plis sur 15 ;
 * - la note TMDB en moyenne bayésienne à 150 votes (sorties v1) : +0,014, 12 plis sur 15, et une
 *   compatibilité plus fiable (AUC 0,670 → 0,691). Un 9/10 sur 3 votes ne vaut plus un 9/10 sur
 *   20 000 : sans ça, des séries confidentielles sortaient à 85 % dans le calendrier.
 */
export const MODEL_OPTIONS: ModelOptions = { useProducers: true, qualityPriorVotes: 150 };

type TitleRow = {
  id: number;
  name: string;
  stars: number | null;
  genre: string | null;
  director: string | null;
  tmdb_rating: number | null;
  vote_count: number | null;
  tmdb_features: string | null;
};

const TITLE_COLUMNS = `id, name, ${RATING_RANK_SQL} AS stars, genre, director, tmdb_rating, vote_count, tmdb_features`;

function parseJson<T>(json: string | null): T | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    return null;
  }
}

/**
 * Traduit une ligne de la base en entrée du modèle. Sans caractéristiques TMDB (item pas encore
 * enrichi), on retombe sur ce que la base sait déjà : genres, réalisateur, note TMDB.
 */
function rowToTitle(row: TitleRow): ModelTitle {
  const features = parseJson<TmdbFeatures>(row.tmdb_features);
  return {
    id: row.id,
    name: row.name,
    stars: row.stars,
    genres: features?.genres ?? parseJson<string[]>(row.genre) ?? [],
    keywords: features?.keywords ?? [],
    cast: features?.cast.map((p) => p.name) ?? [],
    directors: features?.directors.map((p) => p.name) ?? (row.director ? [row.director] : []),
    producers: features?.producers?.map((p) => p.name) ?? [],
    language: features?.language ?? null,
    year: features?.year ?? null,
    runtime: features?.runtime ?? null,
    voteAverage: features?.voteAverage ?? row.tmdb_rating,
    voteCount: features?.voteCount ?? row.vote_count,
    people: features ? peopleOf(features) : [],
  };
}

/** Toutes les personnes d'un titre, pour le poids des avis (tri-rapide-v1 FR-7). */
export function peopleOf(features: TmdbFeatures): number[] {
  return [...features.cast, ...features.directors, ...(features.producers ?? [])].map((p) => p.id);
}

/** Titres de la base, au format du modèle, selon un filtre SQL. */
export function loadModelTitles(
  db: Database.Database,
  where: string,
  params: (string | number)[] = []
): ModelTitle[] {
  const rows = db
    .prepare(`SELECT ${TITLE_COLUMNS} FROM items WHERE ${where}`)
    .all(...params) as TitleRow[];
  return rows.map(rowToTitle);
}

/** Un titre venu de TMDB (hors bibliothèque), au format du modèle. */
export function featuresToTitle(
  id: number,
  name: string,
  features: TmdbFeatures
): ModelTitle {
  return {
    id,
    name,
    stars: null,
    genres: features.genres,
    keywords: features.keywords,
    cast: features.cast.map((p) => p.name),
    directors: features.directors.map((p) => p.name),
    producers: (features.producers ?? []).map((p) => p.name),
    language: features.language,
    year: features.year,
    runtime: features.runtime,
    voteAverage: features.voteAverage,
    voteCount: features.voteCount,
    people: peopleOf(features),
  };
}

/** Le signal d'apprentissage : tes titres vus et notés. */
const TRAINING_WHERE = `watch_status = 'Watched' AND rating IS NOT NULL`;

/**
 * Ce que tu aimes (titres vus notés ⭐⭐⭐ ou plus) : c'est la répartition de genres que la
 * calibration (recommendations v1.4 FR-30) cherche à reproduire.
 */
export function likedTitles(db: Database.Database): ModelTitle[] {
  return loadModelTitles(db, `${TRAINING_WHERE} AND ${RATING_RANK_SQL} >= 3`);
}

export function countRatedTitles(db: Database.Database): number {
  return (
    db.prepare(`SELECT COUNT(*) c FROM items WHERE ${TRAINING_WHERE}`).get() as { c: number }
  ).c;
}

/**
 * Empreinte des données d'entraînement. Elle change dès qu'une note, un statut ou une
 * caractéristique change : nombre de titres, somme des rangs de note pondérée par l'id (une
 * note modifiée la déplace), nombre de titres enrichis, dernière modification.
 */
function trainingFingerprint(db: Database.Database): string {
  const row = db
    .prepare(
      `SELECT COUNT(*) n,
              SUM(id * (${RATING_RANK_SQL} + 1)) s,
              SUM(tmdb_features IS NOT NULL) f,
              MAX(updated_at) m
       FROM items WHERE ${TRAINING_WHERE}`
    )
    .get() as { n: number; s: number | null; f: number | null; m: string | null };
  return `${row.n}|${row.s}|${row.f}|${row.m}`;
}

let cached: {
  fingerprint: string;
  model: PreferenceModel;
  /** Calculée à la première demande (cinq entraînements de plus) ; undefined = pas encore. */
  compatibility?: CompatibilityModel | null;
} | null = null;

/**
 * FR-28 : le modèle est reconstruit seulement quand ses données ont changé. Une note posée
 * depuis n'importe quel écran suffit : aucun bouton, aucune tâche de fond.
 */
export function getPreferenceModel(db: Database.Database): PreferenceModel {
  const fingerprint = trainingFingerprint(db);
  if (cached && cached.fingerprint === fingerprint) return cached.model;

  const model = trainPreferenceModel(loadModelTitles(db, TRAINING_WHERE), MODEL_OPTIONS);
  cached = { fingerprint, model };
  return model;
}

/**
 * Score de recommandation affiché : probabilité que tu notes un titre ⭐⭐⭐⭐ ou plus, calée sur
 * tes notes par validation croisée (vérifiée sur le banc). Null avant 30 titres notés.
 */
export function getCompatibility(db: Database.Database): CompatibilityModel | null {
  getPreferenceModel(db);
  if (cached!.compatibility === undefined) {
    cached!.compatibility = trainCompatibility(loadModelTitles(db, TRAINING_WHERE), MODEL_OPTIONS);
  }
  return cached!.compatibility;
}

/**
 * Classe un lot (recommendations v1.5 FR-35) : par compatibilité dès qu'elle est calée — même
 * corrélation avec tes notes que le mélange d'avant sur le banc, mais un ordre qui suit le
 * pourcentage affiché — et par le mélange sinon. `bonusOf` ajoute tes avis sur les personnes.
 */
export function rankTitles(
  db: Database.Database,
  titles: ModelTitle[],
  bonusOf: (title: ModelTitle) => number
): (ScoredTitle & { compatibility: number | null })[] {
  const model = getPreferenceModel(db);
  const compatibility = getCompatibility(db);
  const byId = new Map(titles.map((t) => [t.id, t]));

  return model.scoreBatch(titles).map((scored) => {
    const title = byId.get(scored.id)!;
    const bonus = bonusOf(title);
    if (!compatibility) return { ...scored, score: scored.score + bonus, compatibility: null };
    const components = model.components(title);
    return {
      ...scored,
      score: compatibility.score(components) + bonus,
      compatibility: compatibility.probability(components, bonus),
    };
  });
}

/** Réservé aux tests : repart d'un cache vide. */
export function resetPreferenceModelCache(): void {
  cached = null;
}

export type AffinityEntry = { name: string; affinity: number; count: number };

/** Poids de ta note moyenne dans une affinité : un genre vu deux fois ne doit pas dominer. */
const AFFINITY_PRIOR = 8;

/**
 * FR-13 réinterprété : ce que tu notes le mieux, par genre ou par réalisateur, en moyenne de
 * notes lissée vers ta moyenne globale. Mêmes données que l'entraînement du modèle.
 */
export function ratingAffinity(
  db: Database.Database,
  kind: "genre" | "director"
): AffinityEntry[] {
  const titles = loadModelTitles(db, TRAINING_WHERE).filter((t) => t.stars !== null);
  if (titles.length === 0) return [];

  const global = titles.reduce((sum, t) => sum + (t.stars as number), 0) / titles.length;
  const buckets = new Map<string, number[]>();
  for (const title of titles) {
    for (const key of kind === "genre" ? title.genres : title.directors) {
      buckets.set(key, [...(buckets.get(key) ?? []), title.stars as number]);
    }
  }

  return [...buckets]
    .filter(([, stars]) => stars.length >= 2)
    .map(([name, stars]) => ({
      name,
      affinity: (stars.reduce((a, b) => a + b, 0) + AFFINITY_PRIOR * global) / (stars.length + AFFINITY_PRIOR),
      count: stars.length,
    }))
    .sort((a, b) => b.affinity - a.affinity);
}
