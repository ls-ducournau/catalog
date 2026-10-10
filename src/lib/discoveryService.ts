import type Database from "better-sqlite3";
import { DOCUMENTARY_TAG, RATING_RANK_SQL, getLibraryInfoByTmdbIds } from "./itemService";
import { includedIn, type Availability } from "./availability";
import type { ReleaseInfo } from "./release";
import type { Trailer } from "./trailer";
import type { Category } from "./libraryItem";
import type { ModelTitle } from "./preferenceModel";
import { featuresToTitle, rankTitles } from "./preferenceService";
import { applyFatigue, buildRows, type RowCandidate } from "./listShaping";
import { getExposure } from "./impressionService";
import { tmdbExposureKey } from "./impressionKeys";
import { diversify } from "./recommendationService";
import { dismissedTmdbKeys, tmdbKey } from "./dismissalService";
import { getOpinionWeights } from "./personOpinionService";
import { personBonus } from "./personPreference";
import {
  getRecommendedFor,
  getTitleData,
  posterUrl,
  type TitleData,
  type TmdbSearchResult,
} from "./tmdb";

// spec: specs/recommendations-v1.md — amendements v1.2 (FR-15 à FR-21) ; lassitude :
// specs/recommandations-fraicheur-v1.md (FR-9)

/** Titres candidats parmi lesquels on tire les semences : tes mieux notés (FR-27). */
const SEED_POOL_SIZE = 20;
/** Note minimale d'une semence : ⭐⭐⭐⭐ (rang 4 sur l'échelle 💩 = 0 … ⭐⭐⭐⭐⭐ = 5). */
const SEED_MIN_RATING_RANK = 4;
/** Candidats reclassés par le modèle : leurs caractéristiques coûtent un appel TMDB chacun. */
const RERANK_POOL = 40;
/** Plafond du reclassement : chaque titre reclassé coûte un appel TMDB (gardé 7 jours). */
const RERANK_MAX = 72;
/**
 * Bonus par semence supplémentaire, en unités du score du modèle (somme de trois composantes
 * centrées-réduites, soit un écart type d'environ 2) : être proche de plusieurs de tes favoris
 * reste un signal fort, sans écraser le modèle.
 */
const EXTRA_SEED_BONUS = 0.75;
const FEATURES_CONCURRENCY = 8;
/** Nombre de semences interrogées par calcul (autant d'appels TMDB). */
const SEED_COUNT = 6;
/** En dessous, on est dans le confidentiel : bruit plutôt que découverte (FR-19). */
const MIN_VOTE_COUNT = 120;

export type DiscoveredItem = {
  tmdbId: number;
  type: "Movie" | "TV Series";
  title: string;
  year: string | null;
  posterUrl: string | null;
  voteAverage: number | null;
  voteCount: number | null;
  isDocumentary: boolean;
  overview: string;
  /** Titres de la bibliothèque qui ont mené à celui-ci (FR-17). */
  seeds: string[];
  /** Où le voir en France ; connue pour les candidats reclassés, null au-delà. */
  availability: Availability | null;
  /** Probabilité que tu le notes ⭐⭐⭐⭐ ou plus ; connue pour les candidats reclassés. */
  compatibility: number | null;
  /** Dates de sortie (sorties-v1 FR-2) ; connues pour les candidats reclassés. */
  release: ReleaseInfo | null;
  /** Durée (minutes) ; connue pour les candidats reclassés. Sert à la rangée « ce soir ». */
  runtime: number | null;
  /** Bande-annonce (bandes-annonces-v1) ; connue pour les candidats reclassés. */
  trailer: Trailer | null;
};

export type DiscoveryResult =
  | { items: DiscoveredItem[]; seedsUsed: string[] }
  | { error: "not_enough_signal" };

type Seed = { tmdbId: number; type: "Movie" | "TV Series"; name: string };

/**
 * FR-18/FR-19 : fusionne les retours de plusieurs semences en une liste unique.
 *
 * Un titre remonté par plusieurs semences est un signal fort (plusieurs de tes favoris y mènent),
 * donc il passe devant ; à nombre de semences égal, la notoriété (`vote_count`) départage, puis
 * la note. Fonction pure : c'est elle qui porte la logique testable.
 */
export function mergeDiscoveries(
  batches: { seed: Seed; results: TmdbSearchResult[] }[],
  options: { excludeTmdbIds: Set<number>; minVoteCount?: number; category?: Category }
): DiscoveredItem[] {
  const minVoteCount = options.minVoteCount ?? MIN_VOTE_COUNT;
  const merged = new Map<number, DiscoveredItem>();

  for (const { seed, results } of batches) {
    for (const result of results) {
      if (options.excludeTmdbIds.has(result.tmdbId)) continue;
      if ((result.voteCount ?? 0) < minVoteCount) continue;

      // Même sémantique de catégorie que partout ailleurs (bibliotheque-v1 FR-9).
      if (options.category === "Documentary" && !result.isDocumentary) continue;
      if (
        options.category &&
        options.category !== "Documentary" &&
        (result.type !== options.category || result.isDocumentary)
      ) {
        continue;
      }

      const existing = merged.get(result.tmdbId);
      if (existing) {
        if (!existing.seeds.includes(seed.name)) existing.seeds.push(seed.name);
        continue;
      }

      merged.set(result.tmdbId, {
        tmdbId: result.tmdbId,
        type: result.type,
        title: result.title,
        year: result.year,
        posterUrl: posterUrl(result.posterPath),
        voteAverage: result.voteAverage,
        voteCount: result.voteCount,
        isDocumentary: result.isDocumentary,
        overview: result.overview,
        seeds: [seed.name],
        availability: null,
        compatibility: null,
        release: null,
        runtime: null,
        trailer: null,
      });
    }
  }

  return [...merged.values()].sort((a, b) => {
    if (b.seeds.length !== a.seeds.length) return b.seeds.length - a.seeds.length;
    const byVotes = (b.voteCount ?? 0) - (a.voteCount ?? 0);
    if (byVotes !== 0) return byVotes;
    return (b.voteAverage ?? 0) - (a.voteAverage ?? 0);
  });
}

/** Tirage sans remise parmi un lot — les semences changent à chaque recalcul (FR-16). */
function pickRandom<T>(pool: T[], count: number): T[] {
  const copy = [...pool];
  const picked: T[] = [];
  while (picked.length < count && copy.length > 0) {
    const index = Math.floor(Math.random() * copy.length);
    picked.push(copy.splice(index, 1)[0]);
  }
  return picked;
}

export async function getDiscoveries(
  db: Database.Database,
  options: { category?: Category; limit?: number; onServices?: number[] } = {}
): Promise<DiscoveryResult> {
  const limit = options.limit ?? 24;

  // FR-27 : semences = tes titres vus les mieux notés, résolus côté TMDB. L'Elo départage à
  // note égale, sans servir de critère (FR-26).
  //
  // FR-20 : quand une catégorie est demandée, on sème dans cette catégorie. Filtrer seulement
  // les résultats ne suffit pas : semer sur des fictions ne remonte jamais de documentaire, et
  // l'onglet renvoyait une liste vide. Semer sur tes meilleurs documentaires, si.
  const seedConditions = [
    `watch_status = 'Watched'`,
    `tmdb_id IS NOT NULL`,
    `${RATING_RANK_SQL} >= ${SEED_MIN_RATING_RANK}`,
  ];
  const seedParams: (string | number)[] = [];

  if (options.category === "Documentary") {
    seedConditions.push(DOCUMENTARY_TAG);
  } else if (options.category) {
    seedConditions.push(`type = ?`, `NOT ${DOCUMENTARY_TAG}`);
    seedParams.push(options.category);
  }

  const pool = db
    .prepare(
      `SELECT tmdb_id, type, name
       FROM items
       WHERE ${seedConditions.join(" AND ")}
       ORDER BY ${RATING_RANK_SQL} DESC, elo_score DESC
       LIMIT ?`
    )
    .all(...seedParams, SEED_POOL_SIZE) as { tmdb_id: number; type: string; name: string }[];

  // AC-15 : aucun signal exploitable, et surtout aucun appel TMDB à tenter.
  if (pool.length === 0) {
    return { error: "not_enough_signal" };
  }

  const seeds: Seed[] = pickRandom(pool, SEED_COUNT).map((row) => ({
    tmdbId: row.tmdb_id,
    type: row.type as "Movie" | "TV Series",
    name: row.name,
  }));

  const batches = await Promise.all(
    seeds.map(async (seed) => ({ seed, results: await getRecommendedFor(seed.tmdbId, seed.type) }))
  );

  // FR-18 : tout ce qui est déjà en bibliothèque sort, quel que soit son statut.
  const allTmdbIds = batches.flatMap(({ results }) => results.map((r) => r.tmdbId));
  const inLibrary = getLibraryInfoByTmdbIds(db, allTmdbIds);

  // FR-2 (tri rapide) : ce que tu as écarté ne revient pas.
  const dismissed = dismissedTmdbKeys(db);
  const merged = mergeDiscoveries(batches, {
    excludeTmdbIds: new Set(inLibrary.keys()),
    category: options.category,
  }).filter((item) => !dismissed.has(tmdbKey(item.type, item.tmdbId)));

  // FR-27 : les meilleurs candidats (semences, notoriété) sont reclassés par ton modèle, une
  // fois leurs caractéristiques récupérées ; le reste garde l'ordre de la fusion.
  // Les rangées (sorties-v1 FR-7) demandent plus de titres : on reclasse jusqu'à 72 d'entre eux.
  const rerankSize = Math.min(RERANK_MAX, Math.max(RERANK_POOL, limit));
  const head = merged.slice(0, rerankSize);
  const tail = merged.slice(rerankSize);
  // Lassitude (fraîcheur FR-5) sur les seuls titres reclassés : un recul ne doit pas faire
  // remonter dans la liste visible un titre de la traîne, sans disponibilité ni compatibilité.
  const exposure = getExposure(db);
  const reranked = applyFatigue(
    await rerankWithModel(db, head),
    (item) => exposure.get(tmdbExposureKey(item.type, item.tmdbId)) ?? 0
  );

  // FR-12 appliqué à la découverte : une semence prolifique (ses titres proches se ressemblent
  // tous) ne doit pas occuper tout le haut de liste. Au-delà de deux titres issus de la même
  // semence principale, les suivants passent après les autres.
  let ranked = [...reranked, ...tail];

  // FR-5 (disponibilité) : seulement ce qui est inclus dans tes abonnements. Un titre dont la
  // disponibilité n'a pas été récupérée (au-delà des candidats reclassés) ne peut pas le
  // prouver : il sort.
  if (options.onServices) {
    const covered = new Set(options.onServices);
    ranked = ranked.filter((item) => includedIn(item.availability, covered).length > 0);
  }

  const varied = diversify(ranked, (item) => item.seeds[0] ?? "");

  return { items: varied.slice(0, limit), seedsUsed: seeds.map((s) => s.name) };
}

type ExternalTitleData = TitleData;

/**
 * Caractéristiques et disponibilité des titres hors bibliothèque, en un appel par titre, gardées
 * le temps du processus. La disponibilité vieillit (FR-2 disponibilité) : au-delà de 7 jours,
 * l'entrée est redemandée.
 */
const externalData = new Map<string, { data: ExternalTitleData | null; at: number }>();
const EXTERNAL_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/** Fiche TMDB d'un titre hors bibliothèque, gardée 7 jours (partagée avec le calendrier). */
export async function externalTitleData(
  tmdbId: number,
  type: "Movie" | "TV Series"
): Promise<ExternalTitleData | null> {
  const key = `${type}:${tmdbId}`;
  const cached = externalData.get(key);
  if (cached && Date.now() - cached.at < EXTERNAL_TTL_MS) return cached.data;

  const data = await getTitleData(tmdbId, type);
  externalData.set(key, { data, at: Date.now() });
  return data;
}

function titleDataFor(item: DiscoveredItem): Promise<ExternalTitleData | null> {
  return externalTitleData(item.tmdbId, item.type);
}

async function rerankWithModel(
  db: Database.Database,
  candidates: DiscoveredItem[]
): Promise<DiscoveredItem[]> {
  if (candidates.length === 0) return [];

  const fetched: (ExternalTitleData | null)[] = new Array(candidates.length).fill(null);
  let next = 0;
  await Promise.all(
    Array.from({ length: FEATURES_CONCURRENCY }, async () => {
      while (next < candidates.length) {
        const index = next++;
        fetched[index] = await titleDataFor(candidates[index]);
      }
    })
  );
  const features = fetched.map((d) => d?.features ?? null);

  // Identifiants négatifs : un titre TMDB ne doit jamais être confondu avec un item local de
  // même numéro (le modèle écarte un titre de ses propres voisins par identifiant).
  const titles: ModelTitle[] = candidates.map((item, i) => {
    const f = features[i];
    if (f) return featuresToTitle(-item.tmdbId, item.title, f);
    return {
      id: -item.tmdbId,
      name: item.title,
      stars: null,
      genres: [],
      keywords: [],
      cast: [],
      directors: [],
      language: null,
      year: item.year ? Number(item.year) : null,
      runtime: null,
      voteAverage: item.voteAverage,
      voteCount: item.voteCount,
    };
  });

  const opinions = getOpinionWeights(db);
  const ranked = rankTitles(db, titles, (title) => personBonus(title.people ?? [], opinions));
  const scores = new Map(ranked.map((s) => [-s.id, s.score]));
  // Sans caractéristiques, le modèle ne saurait dire que la note TMDB : il classe, mais on
  // n'affiche pas de pourcentage qu'il ne peut pas étayer.
  const featured = new Set(titles.filter((_, i) => features[i] !== null).map((t) => -t.id));
  const compatibility = new Map(
    ranked.filter((s) => featured.has(-s.id)).map((s) => [-s.id, s.compatibility])
  );

  const withAvailability = candidates.map((item, i) => ({
    ...item,
    availability: fetched[i]?.availability ?? null,
    compatibility: compatibility.get(item.tmdbId) ?? null,
    release: fetched[i]?.release ?? null,
    runtime: fetched[i]?.features.runtime ?? null,
    trailer: fetched[i]?.trailer.trailer ?? null,
  }));

  return withAvailability.sort((a, b) => {
    const scoreA = (scores.get(a.tmdbId) ?? 0) + EXTRA_SEED_BONUS * (a.seeds.length - 1);
    const scoreB = (scores.get(b.tmdbId) ?? 0) + EXTRA_SEED_BONUS * (b.seeds.length - 1);
    return scoreB - scoreA;
  });
}

/** Clé stable d'une découverte : un même numéro peut désigner un film et une série. */
export function discoveryKey(item: { type: "Movie" | "TV Series"; tmdbId: number }): string {
  return `${item.type}:${item.tmdbId}`;
}

export type DiscoveryRow = { key: string; title: string; keys: string[]; anchor?: string };

/**
 * sorties-v1 FR-7 : les rangées expliquées de la découverte, avec les mêmes règles que celles de
 * la pile (buildRows). La semence principale joue le rôle du titre aimé qui explique ; la
 * compatibilité, celui du score. Les rangées désignent les titres par clé, dans la liste.
 */
export function discoveryRows(
  items: DiscoveredItem[],
  options: { coveredServices: number[]; currentYear: number }
): DiscoveryRow[] {
  const covered = new Set(options.coveredServices);
  const seedIds = new Map<string, number>();
  const candidates: RowCandidate[] = items.map((item, index) => {
    const seed = item.seeds[0];
    if (seed && !seedIds.has(seed)) seedIds.set(seed, seedIds.size + 1);
    return {
      id: index,
      score: item.compatibility ?? 0,
      genres: [],
      type: item.type,
      documentary: item.isDocumentary,
      runtime: item.runtime,
      year: item.year ? Number(item.year) : null,
      voteCount: item.voteCount,
      onMyServices: includedIn(item.availability, covered).length > 0,
      anchor: seed ? { id: seedIds.get(seed)!, name: seed, stars: 5 } : null,
      exploration: false,
    };
  });

  return buildRows(candidates, { currentYear: options.currentYear, hasSubscriptions: covered.size > 0 }).map(
    (row) => ({ key: row.key, title: row.title, anchor: row.anchor, keys: row.ids.map((id) => discoveryKey(items[id])) })
  );
}
