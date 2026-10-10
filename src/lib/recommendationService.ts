import type Database from "better-sqlite3";
import { DOCUMENTARY_TAG, getItemsByIds, onServicesCondition } from "./itemService";
import type { Category, LibraryItem } from "./libraryItem";
import { includedIn } from "./availability";
import { NOT_DISMISSED_ITEM } from "./dismissalService";
import { getExposure } from "./impressionService";
import { itemExposureKey } from "./impressionKeys";
import { getOpinionWeights } from "./personOpinionService";
import { personBonus } from "./personPreference";
import {
  applyFatigue,
  buildRows,
  calibrate,
  explorationPool,
  genreDistribution,
  interleaveExploration,
  type RowCandidate,
} from "./listShaping";
import type { ModelTitle, Neighbour, ScoredTitle } from "./preferenceModel";
import {
  MIN_RATED_TITLES,
  countRatedTitles,
  getCompatibility,
  rankTitles,
  likedTitles,
  loadModelTitles,
  ratingAffinity,
  type AffinityEntry,
} from "./preferenceService";

// spec: specs/recommendations-v1.md (FR-6 à FR-14, amendements v1.3 FR-23 à FR-28, v1.4 FR-30 à FR-32),
// specs/recommandations-fraicheur-v1.md (FR-9)

/**
 * Une recommandation est un item de bibliothèque complet (mêmes composants de carte et de fiche
 * que l'écran bibliothèque), enrichi de son score et des titres aimés qui l'expliquent.
 */
export type RecommendedItem = LibraryItem & {
  recommendationScore: number;
  /** Titres notés au moins ⭐⭐⭐⭐ qui ressemblent à celui-ci (FR-25). */
  neighbours: Pick<Neighbour, "id" | "name" | "stars">[];
  /** Placé là pour sortir de tes habitudes (FR-31). */
  exploration: boolean;
  /** Probabilité que tu le notes ⭐⭐⭐⭐ ou plus ; null avant assez de notes. */
  compatibility: number | null;
};

/** FR-32 : une rangée expliquée, prête à afficher. */
export type RecommendationRow = { key: string; title: string; items: RecommendedItem[] };

export type RecommendationRowsResult =
  | { rows: RecommendationRow[]; total: number; profile: RecommendationProfile }
  | { error: "not_enough_signal"; ratedCount: number };

/** De quoi expliquer le classement, avec les chiffres réellement utilisés. */
export type RecommendationProfile = {
  genres: AffinityEntry[];
  directors: AffinityEntry[];
  /** Titres vus et notés : la base d'apprentissage du modèle. */
  ratedCount: number;
  /** Part de tes titres notés ⭐⭐⭐⭐ ou plus : le repère de la compatibilité (null si non calée). */
  compatibilityBaseRate: number | null;
};

export type RecommendationsResult =
  | {
      items: RecommendedItem[];
      /** Candidats correspondant aux filtres, avant la troncature à `limit`. */
      total: number;
      profile: RecommendationProfile;
    }
  | { error: "not_enough_signal"; ratedCount: number };

/** Au-delà de ce nombre, les titres d'un même lot sont repoussés plus bas dans la liste. */
export const MAX_PER_AFFINITY_GROUP = 2;

/**
 * Diversité du haut de liste (FR-12).
 *
 * Des titres expliqués par exactement les mêmes voisins forment un lot (trois épisodes d'une même
 * série documentaire, par exemple) : sans garde-fou, ils occupent tout le haut de la liste et
 * l'écran ne propose en réalité qu'une idée. On garde l'ordre par score, mais un titre dont le
 * lot a déjà `maxPerGroup` représentants au-dessus de lui est différé, jamais supprimé.
 */
export function diversify<T>(
  ranked: T[],
  groupOf: (item: T) => string,
  maxPerGroup: number = MAX_PER_AFFINITY_GROUP
): T[] {
  const kept: T[] = [];
  const deferred: T[] = [];
  const seen = new Map<string, number>();

  for (const item of ranked) {
    const key = groupOf(item);
    const count = seen.get(key) ?? 0;

    // Clé vide : rien ne relie ce titre à un lot, il n'est jamais différé.
    if (key !== "" && count >= maxPerGroup) {
      deferred.push(item);
      continue;
    }

    seen.set(key, count + 1);
    kept.push(item);
  }

  return [...kept, ...deferred];
}

/** Le lot d'un titre : ses deux voisins explicatifs principaux, dans un ordre stable. */
function neighbourGroup(neighbours: { id: number }[]): string {
  return neighbours
    .slice(0, 2)
    .map((n) => n.id)
    .sort((a, b) => a - b)
    .join("|");
}

type PileOptions = { category?: Category; genre?: string; onServices?: number[] };

type ShapedTitle = ScoredTitle & ModelTitle & { exploration: boolean; compatibility: number | null };

/**
 * Le classement de « Ma pile à voir », partagé par la grille, les rangées et l'accueil : modèle
 * (v1.3), diversité (FR-12), calibration (FR-30), exploration (FR-31), puis lassitude
 * (fraîcheur FR-5) : un titre montré sans geste cède sa place.
 */
function rankPile(
  db: Database.Database,
  options: PileOptions
):
  | { shaped: ShapedTitle[]; total: number; profile: RecommendationProfile }
  | { error: "not_enough_signal"; ratedCount: number } {
  // FR-26 : le goût se lit dans tes notes ; en dessous du seuil, tout classement serait du bruit.
  const ratedCount = countRatedTitles(db);
  if (ratedCount < MIN_RATED_TITLES) {
    return { error: "not_enough_signal", ratedCount };
  }

  const profile: RecommendationProfile = {
    genres: ratingAffinity(db, "genre"),
    directors: ratingAffinity(db, "director"),
    ratedCount,
    compatibilityBaseRate: getCompatibility(db)?.baseRate ?? null,
  };

  const conditions: string[] = [`watch_status = 'Unwatched'`, NOT_DISMISSED_ITEM];
  const params: (string | number)[] = [];

  if (options.category === "Documentary") {
    conditions.push(DOCUMENTARY_TAG);
  } else if (options.category) {
    conditions.push(`type = ?`, `NOT ${DOCUMENTARY_TAG}`);
    params.push(options.category);
  }

  if (options.genre) {
    conditions.push(`EXISTS (SELECT 1 FROM json_each(items.genre) je WHERE je.value = ?)`);
    params.push(options.genre);
  }

  // Disponibilité (disponibilite-streaming-v1 FR-5) : seulement ce qui est inclus dans tes
  // abonnements.
  if (options.onServices) {
    const services = onServicesCondition(options.onServices);
    conditions.push(services.sql);
    params.push(...services.params);
  }

  const candidates = loadModelTitles(db, conditions.join(" AND "), params);

  // EC-1 : aucun item à voir -> liste vide, pas d'erreur.
  if (candidates.length === 0) {
    return { shaped: [], total: 0, profile };
  }

  const titleById = new Map(candidates.map((t) => [t.id, t]));
  const opinions = getOpinionWeights(db);
  const scored = rankTitles(db, candidates, (title) => personBonus(title.people ?? [], opinions))
    .map((s) => ({ ...titleById.get(s.id)!, ...s }))
    .sort((a, b) => b.score - a.score);

  // Diversité d'abord, calibration ensuite : la calibration part d'une liste déjà variée.
  const varied = diversify(scored, (s) => neighbourGroup(s.neighbours));
  const target = genreDistribution(likedTitles(db));
  const calibrated = calibrate(varied, target);
  const exposure = getExposure(db);
  const shaped = applyFatigue(
    interleaveExploration(calibrated, explorationPool(calibrated, target)),
    (s) => exposure.get(itemExposureKey(s.id)) ?? 0
  );

  return { shaped, total: candidates.length, profile };
}

function toRecommendedItems(db: Database.Database, shaped: ShapedTitle[]): RecommendedItem[] {
  const byId = new Map(shaped.map((s) => [s.id, s]));
  // Les champs affichés viennent du même mapping que la bibliothèque : une seule source de
  // vérité pour la forme d'un item.
  return getItemsByIds(
    db,
    shaped.map((s) => s.id)
  ).map((item) => {
    const s = byId.get(item.id)!;
    return {
      ...item,
      recommendationScore: s.score,
      neighbours: s.neighbours.map(({ id, name, stars }) => ({ id, name, stars })),
      exploration: s.exploration,
      compatibility: s.compatibility,
    };
  });
}

/** La grille : le classement complet, tronqué. */
export function getRecommendations(
  db: Database.Database,
  options: PileOptions & { limit?: number } = {}
): RecommendationsResult {
  const ranking = rankPile(db, options);
  if ("error" in ranking) return ranking;

  const items = toRecommendedItems(db, ranking.shaped.slice(0, options.limit ?? 24));
  return { items, total: ranking.total, profile: ranking.profile };
}

/**
 * FR-32 : la même liste, découpée en rangées expliquées. `coveredServices` = tes abonnements
 * (formules avec publicité comprises), pour la rangée « Disponible sur tes abonnements ».
 */
export function getRecommendationRows(
  db: Database.Database,
  options: PileOptions & { coveredServices: number[]; currentYear?: number }
): RecommendationRowsResult {
  const ranking = rankPile(db, options);
  if ("error" in ranking) return ranking;
  if (ranking.shaped.length === 0) return { rows: [], total: 0, profile: ranking.profile };

  const items = toRecommendedItems(db, ranking.shaped);
  const itemById = new Map(items.map((i) => [i.id, i]));
  const covered = new Set(options.coveredServices);

  const candidates: RowCandidate[] = ranking.shaped.map((s) => {
    const item = itemById.get(s.id)!;
    return {
      id: s.id,
      score: s.score,
      genres: s.genres,
      type: item.type,
      documentary: item.category === "Documentary",
      runtime: s.runtime,
      year: s.year ?? (item.year ? Number(item.year) : null),
      voteCount: s.voteCount,
      onMyServices: includedIn(item.availability, covered).length > 0,
      anchor: s.neighbours[0] ?? null,
      exploration: s.exploration,
    };
  });

  const rows = buildRows(candidates, {
    currentYear: options.currentYear ?? new Date().getFullYear(),
    hasSubscriptions: covered.size > 0,
  });

  return {
    rows: rows.map((row) => ({
      key: row.key,
      title: row.title,
      items: row.ids.map((id) => itemById.get(id)!),
    })),
    total: ranking.total,
    profile: ranking.profile,
  };
}
