// Résolution TMDB — spec: specs/duels-elo-v1.md (FR-14, FR-15, EC-4)

import type { Availability, Provider } from "./availability";
import { releaseFromTmdb, type ReleaseInfo } from "./release";
import { chooseTrailer, rankTrailers, TRAILER_VIDEO_LANGUAGES, type TrailerInfo } from "./trailer";
import { checkYouTubeVideo } from "./youtube";

const TMDB_API_BASE = "https://api.themoviedb.org/3";
const POSTER_BASE = "https://image.tmdb.org/t/p/w500";

// Délai avant de retenter une résolution TMDB échouée (EC-4).
export const TMDB_RETRY_DELAY_MS = 24 * 60 * 60 * 1000; // 24h

function authHeaders(): HeadersInit {
  const token = process.env.TMDB_ACCESS_TOKEN;
  return {
    accept: "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

export type TmdbResolution = {
  tmdbId: number;
  posterPath: string | null;
} | null;

/**
 * Résout un tmdb_id + poster_path à partir d'un IMDb ID, via l'endpoint /find.
 * Retourne null si introuvable ou en cas d'erreur réseau (EC-4) — l'appelant
 * est responsable de marquer `tmdb_resolve_failed_at` pour throttler les retries.
 */
export async function resolveByImdbId(imdbId: string): Promise<TmdbResolution> {
  try {
    const res = await fetch(
      `${TMDB_API_BASE}/find/${imdbId}?external_source=imdb_id`,
      { headers: authHeaders() }
    );
    if (!res.ok) return null;

    const data = await res.json();
    const result =
      data.movie_results?.[0] ?? data.tv_results?.[0] ?? null;

    if (!result) return null;

    return {
      tmdbId: result.id,
      posterPath: result.poster_path ?? null,
    };
  } catch {
    return null;
  }
}

export function posterUrl(posterPath: string | null): string | null {
  if (!posterPath) return null;
  return `${POSTER_BASE}${posterPath}`;
}

export function shouldRetryResolution(failedAt: string | null): boolean {
  if (!failedAt) return true;
  const elapsed = Date.now() - new Date(failedAt).getTime();
  return elapsed >= TMDB_RETRY_DELAY_MS;
}

// Recherche + détails TMDB pour l'ajout d'item — spec: specs/ajout-item-v1.md (FR-1..FR-3)

// Id de genre TMDB "Documentary" — identique pour les films et les séries.
const DOCUMENTARY_GENRE_ID = 99;

type GenreMaps = { movie: Record<number, string>; tv: Record<number, string> };
let genreMapsCache: GenreMaps | null = null;
let genreMapsPromise: Promise<GenreMaps> | null = null;

async function fetchGenreList(kind: "movie" | "tv"): Promise<Record<number, string>> {
  try {
    const res = await fetch(`${TMDB_API_BASE}/genre/${kind}/list`, { headers: authHeaders() });
    if (!res.ok) return {};
    const data = await res.json();
    const map: Record<number, string> = {};
    for (const g of (data.genres ?? []) as { id: number; name: string }[]) map[g.id] = g.name;
    return map;
  } catch {
    return {};
  }
}

/** Dictionnaires id→nom des genres TMDB (distincts films/séries), mis en cache en mémoire process. */
async function getGenreMaps(): Promise<GenreMaps> {
  if (genreMapsCache) return genreMapsCache;
  if (!genreMapsPromise) {
    genreMapsPromise = Promise.all([fetchGenreList("movie"), fetchGenreList("tv")]).then(
      ([movie, tv]) => {
        genreMapsCache = { movie, tv };
        return genreMapsCache;
      }
    );
  }
  return genreMapsPromise;
}

function resolveGenreNames(type: "Movie" | "TV Series", genreIds: number[], maps: GenreMaps): string[] {
  const dict = type === "Movie" ? maps.movie : maps.tv;
  return genreIds.map((id) => dict[id]).filter((n): n is string => !!n);
}

function genreIdByName(name: string, dict: Record<number, string>): number | null {
  const entry = Object.entries(dict).find(([, n]) => n === name);
  return entry ? Number(entry[0]) : null;
}

export type PersonRole = "director" | "producer" | "actor";

const PRODUCER_JOBS = ["Producer", "Executive Producer"];

export type TmdbSearchResult = {
  tmdbId: number;
  type: "Movie" | "TV Series";
  isDocumentary: boolean;
  genres: string[];
  title: string;
  year: string | null;
  posterPath: string | null;
  voteAverage: number | null;
  /** Nombre de votes TMDB — proxy de notoriété (un blockbuster connu en a des dizaines de
   * milliers, un titre obscur quelques centaines), à ne pas confondre avec `voteAverage`
   * (qualité perçue) : un titre culte mais clivant doit quand même ressortir devant un petit
   * film bien noté par une poignée de votants. */
  voteCount: number | null;
  /** Synopsis brut de la ligne TMDB — langue selon l'appel (fr-FR pour /discover, cf. ce-soir). */
  overview: string;
  /**
   * Renseigné quand ce résultat vient de la filmographie d'une personne recherchée par son nom.
   * `roles` peut contenir plusieurs entrées (ex. réalisateur ET acteur sur son propre film) —
   * spec: specs/recherche-personne-v1.md FR-5, aucun rôle ne doit être supprimé silencieusement.
   */
  personCredit?: { name: string; roles: PersonRole[] };
};

/**
 * Fusionne les résultats en doublon (même type+tmdbId) au lieu de n'en garder qu'un : un même
 * titre peut apparaître une fois par rôle détecté (réalisateur, producteur, acteur) pour la
 * personne recherchée — spec: specs/recherche-personne-v1.md FR-5.
 */
function mergeSearchResults(results: TmdbSearchResult[]): TmdbSearchResult[] {
  const map = new Map<string, TmdbSearchResult>();

  for (const r of results) {
    const key = `${r.type}-${r.tmdbId}`;
    const existing = map.get(key);

    if (!existing) {
      map.set(key, { ...r, personCredit: r.personCredit ? { ...r.personCredit, roles: [...r.personCredit.roles] } : undefined });
      continue;
    }

    if (r.personCredit) {
      if (!existing.personCredit) {
        existing.personCredit = { ...r.personCredit, roles: [...r.personCredit.roles] };
      } else {
        for (const role of r.personCredit.roles) {
          if (!existing.personCredit.roles.includes(role)) existing.personCredit.roles.push(role);
        }
      }
    }
  }

  return Array.from(map.values());
}

/** Mappe une ligne brute (recherche ou discover) déjà connue comme Movie/TV vers un résultat. */
function rowToResult(
  r: Record<string, unknown>,
  type: "Movie" | "TV Series",
  maps: GenreMaps
): TmdbSearchResult | null {
  const isMovie = type === "Movie";
  const title = (isMovie ? r.title : r.name) as string | undefined;
  if (!title) return null;
  const dateStr = (isMovie ? r.release_date : r.first_air_date) as string | undefined;
  const genreIds = Array.isArray(r.genre_ids) ? (r.genre_ids as number[]) : [];

  return {
    tmdbId: r.id as number,
    type,
    isDocumentary: genreIds.includes(DOCUMENTARY_GENRE_ID),
    genres: resolveGenreNames(type, genreIds, maps),
    title,
    year: dateStr ? dateStr.slice(0, 4) : null,
    posterPath: (r.poster_path as string | null) ?? null,
    voteAverage: typeof r.vote_average === "number" ? r.vote_average : null,
    voteCount: typeof r.vote_count === "number" ? r.vote_count : null,
    overview: typeof r.overview === "string" ? r.overview : "",
  };
}

function toSearchResult(r: Record<string, unknown>, maps: GenreMaps): TmdbSearchResult | null {
  if (r.media_type !== "movie" && r.media_type !== "tv") return null;
  return rowToResult(r, r.media_type === "movie" ? "Movie" : "TV Series", maps);
}

type CreditRow = {
  id: number;
  job?: string;
  title?: string;
  name?: string;
  release_date?: string;
  first_air_date?: string;
  poster_path: string | null;
  vote_average?: number;
  vote_count?: number;
  genre_ids?: number[];
  overview?: string;
};

/**
 * Recherche un nom de personne (ex. "Dupieux") ne matche aucun titre — TMDB le remonte comme
 * un résultat `person` dans /search/multi. On va alors chercher directement sa filmographie,
 * quel que soit son rôle : réalisateur (crew, job="Director"), producteur (crew, job="Producer"
 * ou "Executive Producer") ou acteur (cast) — taper un nom doit remonter ses films sans avoir
 * à préciser dans quel rôle chercher.
 */
async function getPersonFilmography(
  personId: number,
  personName: string,
  maps: GenreMaps
): Promise<TmdbSearchResult[]> {
  function toResults(rows: CreditRow[], type: "Movie" | "TV Series", role: PersonRole): TmdbSearchResult[] {
    const out: TmdbSearchResult[] = [];
    for (const c of rows) {
      const title = type === "Movie" ? c.title : c.name;
      if (!title) continue;
      const dateStr = type === "Movie" ? c.release_date : c.first_air_date;
      const genreIds = c.genre_ids ?? [];
      out.push({
        tmdbId: c.id,
        type,
        isDocumentary: genreIds.includes(DOCUMENTARY_GENRE_ID),
        genres: resolveGenreNames(type, genreIds, maps),
        title,
        year: dateStr ? dateStr.slice(0, 4) : null,
        posterPath: c.poster_path ?? null,
        voteAverage: typeof c.vote_average === "number" ? c.vote_average : null,
        voteCount: typeof c.vote_count === "number" ? c.vote_count : null,
        overview: typeof c.overview === "string" ? c.overview : "",
        personCredit: { name: personName, roles: [role] },
      });
    }
    return out;
  }

  try {
    const [movieRes, tvRes] = await Promise.all([
      fetch(`${TMDB_API_BASE}/person/${personId}/movie_credits`, { headers: authHeaders() }),
      fetch(`${TMDB_API_BASE}/person/${personId}/tv_credits`, { headers: authHeaders() }),
    ]);

    const results: TmdbSearchResult[] = [];

    if (movieRes.ok) {
      const data = await movieRes.json();
      const crew = (Array.isArray(data.crew) ? data.crew : []) as CreditRow[];
      const cast = (Array.isArray(data.cast) ? data.cast : []) as CreditRow[];
      results.push(...toResults(crew.filter((c) => c.job === "Director"), "Movie", "director"));
      results.push(
        ...toResults(crew.filter((c) => c.job && PRODUCER_JOBS.includes(c.job)), "Movie", "producer")
      );
      results.push(...toResults(cast, "Movie", "actor"));
    }

    if (tvRes.ok) {
      const data = await tvRes.json();
      const crew = (Array.isArray(data.crew) ? data.crew : []) as CreditRow[];
      const cast = (Array.isArray(data.cast) ? data.cast : []) as CreditRow[];
      results.push(...toResults(crew.filter((c) => c.job === "Director"), "TV Series", "director"));
      results.push(
        ...toResults(crew.filter((c) => c.job && PRODUCER_JOBS.includes(c.job)), "TV Series", "producer")
      );
      results.push(...toResults(cast, "TV Series", "actor"));
    }

    return results;
  } catch {
    return [];
  }
}

export type TmdbSearchPage = {
  results: TmdbSearchResult[];
  totalPages: number;
};

/**
 * FR-1/FR-2: recherche films+séries par titre, paginée (scroll infini côté client). Un résultat
 * `person` (recherche par nom de réalisateur/acteur/producteur) déclenche en plus la récupération
 * de sa filmographie complète — uniquement sur la page 1, pour ne pas la refaire à chaque page
 * suivante. Liste vide en cas d'erreur (EC-1/EC-2).
 */
export async function searchMulti(query: string, page: number = 1): Promise<TmdbSearchPage> {
  if (!query.trim()) return { results: [], totalPages: 0 };
  try {
    const [res, maps] = await Promise.all([
      // `language=fr-FR` : les titres et synopsis proposés à l'ajout sont dans la langue de
      // l'interface (TMDB retombe sur l'original quand il n'a pas de traduction). La recherche
      // elle-même reste insensible à la langue : on trouve toujours un titre tapé en anglais.
      fetch(
        `${TMDB_API_BASE}/search/multi?query=${encodeURIComponent(query)}&include_adult=false&page=${page}&language=fr-FR`,
        { headers: authHeaders() }
      ),
      getGenreMaps(),
    ]);
    if (!res.ok) return { results: [], totalPages: 0 };
    const data = await res.json();
    if (!Array.isArray(data.results)) return { results: [], totalPages: 0 };

    const rawResults = data.results as Record<string, unknown>[];
    const totalPages = typeof data.total_pages === "number" ? data.total_pages : 1;

    const titleResults = rawResults
      .map((r) => toSearchResult(r, maps))
      .filter((r): r is TmdbSearchResult => r !== null);

    let personResults: TmdbSearchResult[] = [];
    if (page === 1) {
      // Un nom de personne peut coïncider avec un mot d'un titre (ex. "Fjord", nom de famille
      // scandinave courant) sans rapport avec l'intention de recherche. On ne déclenche la
      // filmographie que si aucun titre ne domine clairement en popularité TMDB — une simple
      // marge (>=1x) est trop fragile : un documentaire "à propos de" une personne a souvent
      // une popularité très proche de la sienne (cf. "Dupieux" : titre 1.24 vs personne 1.17,
      // un cas qu'on veut quand même garder). Seuil retenu : le titre doit être NETTEMENT plus
      // connu (≥2x) que la personne pour l'emporter — cf. "Fjord" (8.0 vs 0.6, x13).
      const POPULARITY_DOMINANCE = 2;
      const bestTitlePopularity = Math.max(
        0,
        ...rawResults
          .filter((r) => r.media_type === "movie" || r.media_type === "tv")
          .map((r) => (typeof r.popularity === "number" ? r.popularity : 0))
      );

      // Limité à 3 homonymes pour éviter une explosion d'appels réseau sur un nom courant.
      const people = rawResults
        .filter(
          (r) =>
            r.media_type === "person" &&
            typeof r.popularity === "number" &&
            r.popularity * POPULARITY_DOMINANCE >= bestTitlePopularity
        )
        .slice(0, 3) as { id: number; name: string }[];

      const filmographies = await Promise.all(
        people.map((p) => getPersonFilmography(p.id, p.name, maps))
      );
      personResults = filmographies.flat();
    }

    const results = mergeSearchResults([...titleResults, ...personResults]);

    return { results, totalPages };
  } catch {
    return { results: [], totalPages: 0 };
  }
}

export type TmdbDetails = {
  tmdbId: number;
  type: "Movie" | "TV Series";
  title: string;
  year: string | null;
  posterPath: string | null;
  voteAverage: number | null;
  voteCount: number | null;
  imdbId: string | null;
  genres: string[];
  director: string | null;
};

/** FR-3: détails complets (genres, réalisateur/créateurs, IMDb ID, note) pour créer l'item. Null si introuvable (EC-4). */
export async function getDetails(
  tmdbId: number,
  type: "Movie" | "TV Series"
): Promise<TmdbDetails | null> {
  const path = type === "Movie" ? "movie" : "tv";
  try {
    const res = await fetch(
      `${TMDB_API_BASE}/${path}/${tmdbId}?append_to_response=external_ids,credits`,
      { headers: authHeaders() }
    );
    if (!res.ok) return null;
    const data = await res.json();

    const title: string | undefined = type === "Movie" ? data.title : data.name;
    if (!title) return null;
    const dateStr: string | undefined = type === "Movie" ? data.release_date : data.first_air_date;

    const director =
      type === "Movie"
        ? ((data.credits?.crew as { job: string; name: string }[] | undefined)?.find(
            (c) => c.job === "Director"
          )?.name ?? null)
        : (data.created_by as { name: string }[] | undefined)?.map((c) => c.name).join(", ") || null;

    return {
      tmdbId: data.id,
      type,
      title,
      year: dateStr ? dateStr.slice(0, 4) : null,
      posterPath: data.poster_path ?? null,
      voteAverage: typeof data.vote_average === "number" ? data.vote_average : null,
      voteCount: typeof data.vote_count === "number" ? data.vote_count : null,
      imdbId: data.external_ids?.imdb_id ?? null,
      genres: Array.isArray(data.genres) ? data.genres.map((g: { name: string }) => g.name) : [],
      director,
    };
  } catch {
    return null;
  }
}

export type TmdbDetailsFr = {
  /** Titre localisé s'il existe côté TMDB, sinon le titre original (jamais vide). */
  title: string;
  overview: string;
  voteAverage: number | null;
  voteCount: number | null;
};

/**
 * Titre + synopsis en français, + note/nombre de votes au passage (même réponse TMDB, aucun
 * coût réseau supplémentaire) — genres/réalisateur restent dans la langue par défaut de
 * `getDetails` (cohérence avec les items déjà en base, importés en anglais ; seuls le titre et
 * le synopsis sont volontairement basculés en français, cf. demande explicite). Un appel séparé
 * et léger, plutôt que de tout basculer `getDetails` en `language=fr-FR`, pour ne pas faire
 * dériver le vocabulaire du filtre Genre entre anciens et nouveaux items.
 * Retourne `null` en cas d'échec réseau/API (à retenter), overview="" si TMDB n'a simplement
 * pas de traduction française (pas la peine de retenter).
 */
export async function getDetailsFr(
  tmdbId: number,
  type: "Movie" | "TV Series"
): Promise<TmdbDetailsFr | null> {
  const path = type === "Movie" ? "movie" : "tv";
  try {
    const res = await fetch(`${TMDB_API_BASE}/${path}/${tmdbId}?language=fr-FR`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const title: string | undefined = type === "Movie" ? data.title : data.name;
    return {
      title: title || "",
      overview: typeof data.overview === "string" ? data.overview : "",
      voteAverage: typeof data.vote_average === "number" ? data.vote_average : null,
      voteCount: typeof data.vote_count === "number" ? data.vote_count : null,
    };
  } catch {
    return null;
  }
}

/**
 * FR-16 : titres proches d'un titre donné, selon TMDB (`/recommendations`, mieux curé que
 * `/similar`, qui se contente de recouper genres et mots-clés). Langue FR comme le reste :
 * titre et synopsis arrivent traduits quand TMDB en a une version.
 *
 * Liste vide en cas d'échec réseau/API : une semence muette ne doit pas faire tomber le lot.
 */
export async function getRecommendedFor(
  tmdbId: number,
  type: "Movie" | "TV Series"
): Promise<TmdbSearchResult[]> {
  const kind = type === "Movie" ? "movie" : "tv";

  try {
    const [res, maps] = await Promise.all([
      fetch(`${TMDB_API_BASE}/${kind}/${tmdbId}/recommendations?language=fr-FR&page=1`, {
        headers: authHeaders(),
      }),
      getGenreMaps(),
    ]);
    if (!res.ok) return [];

    const data = await res.json();
    if (!Array.isArray(data.results)) return [];

    return (data.results as Record<string, unknown>[])
      .map((row) => {
        // `/recommendations` d'un film peut renvoyer des séries (et l'inverse) : on se fie au
        // `media_type` de chaque ligne, pas au type de la semence.
        const rowType: "Movie" | "TV Series" = row.media_type === "tv" ? "TV Series" : "Movie";
        return rowToResult(row, rowType, maps);
      })
      .filter((r): r is TmdbSearchResult => r !== null);
  } catch {
    return [];
  }
}

/** Personne TMDB : identifiant et photo gardés pour les futurs duels d'acteurs (FR-23). */
export type TmdbPerson = { id: number; name: string; profilePath: string | null };

/** FR-23 : tout ce que le modèle de préférence sait d'un titre. */
export type TmdbFeatures = {
  genres: string[];
  keywords: string[];
  cast: TmdbPerson[];
  directors: TmdbPerson[];
  /**
   * Production (tri-rapide-v1 FR-9) : films, « Producer » ; séries, producteurs exécutifs.
   * Absent des caractéristiques récupérées avant son ajout. Pas utilisé par le modèle.
   */
  producers?: TmdbPerson[];
  year: number | null;
  runtime: number | null;
  language: string | null;
  countries: string[];
  voteAverage: number | null;
  voteCount: number | null;
  popularity: number | null;
};

/** Nombre d'acteurs principaux retenus : au-delà, ce sont des seconds rôles sans signal. */
const FEATURES_CAST_SIZE = 8;
/** Producteurs retenus : les premiers crédités, les autres sont rarement des signatures. */
const FEATURES_PRODUCERS_SIZE = 4;

function toPerson(raw: Record<string, unknown>): TmdbPerson {
  return {
    id: raw.id as number,
    name: raw.name as string,
    profilePath: (raw.profile_path as string | null) ?? null,
  };
}

/**
 * Caractéristiques complètes d'un titre, en un appel (`keywords` + crédits en `append`).
 * Genres et mots-clés restent en anglais, comme dans le reste de la base : ils servent au
 * modèle, pas à l'affichage. Null en cas d'échec : l'appelant garde ce qu'il avait.
 */
export async function getTmdbFeatures(
  tmdbId: number,
  type: "Movie" | "TV Series"
): Promise<TmdbFeatures | null> {
  const isMovie = type === "Movie";
  const url = isMovie
    ? `${TMDB_API_BASE}/movie/${tmdbId}?append_to_response=keywords,credits`
    : `${TMDB_API_BASE}/tv/${tmdbId}?append_to_response=keywords,aggregate_credits`;

  try {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) return null;
    return parseFeatures(await res.json(), isMovie);
  } catch {
    return null;
  }
}

type RawDetails = {
  genres?: { name: string }[];
  keywords?: { keywords?: { name: string }[]; results?: { name: string }[] };
  credits?: { cast?: Record<string, unknown>[]; crew?: Record<string, unknown>[] };
  aggregate_credits?: { cast?: Record<string, unknown>[]; crew?: Record<string, unknown>[] };
  created_by?: Record<string, unknown>[];
  release_date?: string;
  first_air_date?: string;
  runtime?: number | null;
  episode_run_time?: number[];
  original_language?: string;
  production_countries?: { iso_3166_1: string }[];
  origin_country?: string[];
  vote_average?: unknown;
  vote_count?: unknown;
  popularity?: unknown;
  "watch/providers"?: Record<string, unknown>;
};

/** Lit les caractéristiques dans une fiche TMDB enrichie de `keywords` et des crédits. */
function parseFeatures(d: RawDetails, isMovie: boolean): TmdbFeatures {
  const keywords = (isMovie ? d.keywords?.keywords : d.keywords?.results) ?? [];
  const cast = (isMovie ? d.credits?.cast : d.aggregate_credits?.cast) ?? [];
  const directors = isMovie
    ? (d.credits?.crew ?? []).filter((c) => c.job === "Director")
    : (d.created_by ?? []);
  const date = isMovie ? d.release_date : d.first_air_date;
  // Séries : les crédits agrégés listent les métiers dans `jobs`, sur toute la série.
  const producers = isMovie
    ? (d.credits?.crew ?? []).filter((c) => c.job === "Producer")
    : (d.aggregate_credits?.crew ?? []).filter((c) =>
        ((c.jobs as { job: string }[] | undefined) ?? []).some((j) => j.job === "Executive Producer")
      );

  return {
    genres: (d.genres ?? []).map((g) => g.name),
    keywords: keywords.map((k) => k.name),
    cast: cast.slice(0, FEATURES_CAST_SIZE).map(toPerson),
    directors: directors.map(toPerson),
    producers: producers.slice(0, FEATURES_PRODUCERS_SIZE).map(toPerson),
    year: date ? Number(date.slice(0, 4)) || null : null,
    runtime: isMovie ? (d.runtime ?? null) : ((d.episode_run_time ?? [])[0] ?? null),
    language: d.original_language ?? null,
    countries: isMovie
      ? (d.production_countries ?? []).map((c) => c.iso_3166_1)
      : (d.origin_country ?? []),
    voteAverage: typeof d.vote_average === "number" ? d.vote_average : null,
    voteCount: typeof d.vote_count === "number" ? d.vote_count : null,
    popularity: typeof d.popularity === "number" ? d.popularity : null,
  };
}

// ---------- disponibilité streaming — spec: specs/disponibilite-streaming-v1.md ----------

/** Pays couvert (OS-1 : la France seulement). */
const WATCH_REGION = "FR";

function toProviders(raw: unknown): Provider[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((p: Record<string, unknown>) => ({
    id: p.provider_id as number,
    name: p.provider_name as string,
    logoPath: (p.logo_path as string | null) ?? null,
  }));
}

/** Disponibilité en France à partir du bloc `watch/providers` de TMDB (source JustWatch). */
function parseAvailability(block: Record<string, unknown> | undefined): Availability {
  const results = block?.results as Record<string, Record<string, unknown>> | undefined;
  const fr = results?.[WATCH_REGION];
  return {
    link: (fr?.link as string | undefined) ?? null,
    flatrate: toProviders(fr?.flatrate),
    free: toProviders(fr?.free),
    ads: toProviders(fr?.ads),
    rent: toProviders(fr?.rent),
    buy: toProviders(fr?.buy),
    fetchedAt: new Date().toISOString(),
  };
}

/** FR-2 : rafraîchissement seul, plus léger qu'une fiche complète. Null si TMDB échoue (EC-3). */
export async function getAvailability(
  tmdbId: number,
  type: "Movie" | "TV Series"
): Promise<Availability | null> {
  const path = type === "Movie" ? "movie" : "tv";
  try {
    const res = await fetch(`${TMDB_API_BASE}/${path}/${tmdbId}/watch/providers`, {
      headers: authHeaders(),
    });
    if (!res.ok) return null;
    return parseAvailability(await res.json());
  } catch {
    return null;
  }
}

export type TitleData = {
  features: TmdbFeatures;
  availability: Availability;
  release: ReleaseInfo;
  /** Bande-annonce retenue (bandes-annonces-v1 FR-1), du même appel. */
  trailer: TrailerInfo;
};

/**
 * Caractéristiques du modèle, disponibilité et dates de sortie en un seul appel : c'est ce qui
 * permet de les avoir à la création, au refetch et dans la découverte sans requête de plus.
 */
export async function getTitleData(tmdbId: number, type: "Movie" | "TV Series"): Promise<TitleData | null> {
  const isMovie = type === "Movie";
  // Séries : dates (première diffusion, prochain épisode, statut) déjà dans la fiche.
  const videos = `include_video_language=${TRAILER_VIDEO_LANGUAGES}`;
  const url = isMovie
    ? `${TMDB_API_BASE}/movie/${tmdbId}?append_to_response=keywords,credits,watch/providers,release_dates,videos&${videos}`
    : `${TMDB_API_BASE}/tv/${tmdbId}?append_to_response=keywords,aggregate_credits,watch/providers,videos&${videos}`;

  try {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) return null;
    const d: RawDetails = await res.json();
    return {
      features: parseFeatures(d, isMovie),
      availability: parseAvailability(d["watch/providers"]),
      release: releaseFromTmdb(d as Record<string, unknown>, isMovie),
      trailer: {
        // FR-8 : la meilleure bande-annonce que l'app peut lire elle-même.
        trailer: await chooseTrailer(
          rankTrailers((d as { videos?: { results?: Record<string, unknown>[] } }).videos?.results),
          checkYouTubeVideo
        ),
        fetchedAt: new Date().toISOString(),
      },
    };
  } catch {
    return null;
  }
}

// ---------- sorties — spec: specs/sorties-v1.md ----------

/** Dates de sortie seules (FR-1), plus léger qu'une fiche complète. Null si TMDB échoue. */
export async function getRelease(tmdbId: number, type: "Movie" | "TV Series"): Promise<ReleaseInfo | null> {
  const isMovie = type === "Movie";
  const url = isMovie
    ? `${TMDB_API_BASE}/movie/${tmdbId}?append_to_response=release_dates`
    : `${TMDB_API_BASE}/tv/${tmdbId}`;
  try {
    const res = await fetch(url, { headers: authHeaders() });
    if (!res.ok) return null;
    return releaseFromTmdb(await res.json(), isMovie);
  } catch {
    return null;
  }
}

/**
 * FR-3 : titres qui sortent sur une période, les plus populaires d'abord. Films : sorties en
 * salle en France (larges ou limitées) ; séries : premières diffusions, ou (`airing`) séries qui
 * diffusent un épisode sur la période, pour y trouver les débuts de saison.
 */
export async function discoverReleases(
  kind: "Movie" | "TV Series",
  from: string,
  to: string,
  page: number,
  { airing = false }: { airing?: boolean } = {}
): Promise<TmdbSearchResult[]> {
  const params = new URLSearchParams({
    sort_by: "popularity.desc",
    page: String(page),
    include_adult: "false",
    language: "fr-FR",
  });
  if (kind === "Movie") {
    params.set("region", WATCH_REGION);
    params.set("with_release_type", "2|3");
    params.set("release_date.gte", from);
    params.set("release_date.lte", to);
  } else if (airing) {
    params.set("air_date.gte", from);
    params.set("air_date.lte", to);
  } else {
    params.set("first_air_date.gte", from);
    params.set("first_air_date.lte", to);
    params.set("include_null_first_air_dates", "false");
  }

  try {
    const [res, maps] = await Promise.all([
      fetch(`${TMDB_API_BASE}/discover/${kind === "Movie" ? "movie" : "tv"}?${params}`, {
        headers: authHeaders(),
      }),
      getGenreMaps(),
    ]);
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data.results)) return [];
    return (data.results as Record<string, unknown>[])
      .map((row) => rowToResult(row, kind, maps))
      .filter((r): r is TmdbSearchResult => r !== null);
  } catch {
    return [];
  }
}

/**
 * Ce soir v2 (FR-5, « tout le catalogue ») : titres populaires d'un genre parmi `genreNames`
 * (tous si null), d'une durée maximale (films), et inclus chez l'un des services donnés en
 * France (tous si null). Le filtrage exact reste fait localement : ceci ne fait que dégrossir.
 */
export async function discoverForTonight(
  kind: "Movie" | "TV Series",
  options: { genreNames: string[] | null; maxMinutes: number | null; providerIds: number[] | null; page: number }
): Promise<TmdbSearchResult[]> {
  const maps = await getGenreMaps();
  const dict = kind === "Movie" ? maps.movie : maps.tv;
  const params = new URLSearchParams({
    sort_by: "popularity.desc",
    page: String(options.page),
    include_adult: "false",
    language: "fr-FR",
    "vote_count.gte": "150",
  });
  if (options.genreNames) {
    const ids = options.genreNames.map((name) => genreIdByName(name, dict)).filter((id): id is number => id !== null);
    // Aucun genre de cette envie n'existe pour ce média : rien à chercher de ce côté.
    if (ids.length === 0) return [];
    params.set("with_genres", ids.join("|"));
  }
  if (kind === "Movie" && options.maxMinutes !== null) params.set("with_runtime.lte", String(options.maxMinutes));
  if (options.providerIds && options.providerIds.length > 0) {
    params.set("watch_region", WATCH_REGION);
    params.set("with_watch_providers", options.providerIds.join("|"));
    params.set("with_watch_monetization_types", "flatrate|free|ads");
  }

  try {
    const res = await fetch(`${TMDB_API_BASE}/discover/${kind === "Movie" ? "movie" : "tv"}?${params}`, {
      headers: authHeaders(),
    });
    if (!res.ok) return [];
    const data = await res.json();
    if (!Array.isArray(data.results)) return [];
    return (data.results as Record<string, unknown>[])
      .map((row) => rowToResult(row, kind, maps))
      .filter((r): r is TmdbSearchResult => r !== null);
  } catch {
    return [];
  }
}

let providerCatalog: { providers: Provider[]; fetchedAt: number } | null = null;
const CATALOG_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * FR-3 : services disponibles en France, films et séries confondus, du plus au moins populaire
 * (ordre d'affichage de TMDB pour la France). Gardé en mémoire une journée.
 */
export async function listFrenchProviders(): Promise<Provider[]> {
  if (providerCatalog && Date.now() - providerCatalog.fetchedAt < CATALOG_TTL_MS) {
    return providerCatalog.providers;
  }

  try {
    const lists = await Promise.all(
      ["movie", "tv"].map(async (kind) => {
        const res = await fetch(
          `${TMDB_API_BASE}/watch/providers/${kind}?watch_region=${WATCH_REGION}&language=fr-FR`,
          { headers: authHeaders() }
        );
        if (!res.ok) return [];
        const data = await res.json();
        return Array.isArray(data.results) ? (data.results as Record<string, unknown>[]) : [];
      })
    );

    const byId = new Map<number, { provider: Provider; priority: number }>();
    for (const raw of lists.flat()) {
      const priorities = raw.display_priorities as Record<string, number> | undefined;
      const priority = priorities?.[WATCH_REGION] ?? (raw.display_priority as number) ?? 999;
      const id = raw.provider_id as number;
      const existing = byId.get(id);
      if (!existing || existing.priority > priority) {
        byId.set(id, {
          provider: { id, name: raw.provider_name as string, logoPath: (raw.logo_path as string | null) ?? null },
          priority,
        });
      }
    }

    const providers = [...byId.values()].sort((a, b) => a.priority - b.priority).map((e) => e.provider);
    providerCatalog = { providers, fetchedAt: Date.now() };
    return providers;
  } catch {
    return providerCatalog?.providers ?? [];
  }
}
