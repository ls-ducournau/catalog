import { MOOD_GENRES, MOOD_LABELS, type Mood } from "./tonight";
import { listTmdb, posterUrl, type TmdbSearchResult } from "./tmdb";
import { posterTint, tintVar } from "./posterTint";
import type { ShowcaseTab, ShowcaseTitle } from "./showcase";

// Vitrine de l'accueil — spec: specs/accueil-vitrine-connexion-v1.md (§ 2, § 3, § 6). Les titres
// tendances de TMDB (tendances de la semaine, à l'affiche et à venir en France, les mieux notés),
// au format des aperçus de l'accueil : pour un visiteur, qui n'a pas de bibliothèque, et pour
// compléter une bibliothèque qui démarre. Lecture seule : rien n'est écrit tant qu'on n'ajoute pas.

export type Vitrine = {
  /** Carrousel : une envie par onglet. */
  moods: ShowcaseTab[];
  /** « À la une » : les tendances de la semaine. */
  picks: ShowcaseTitle[];
  /** Liste à onglets : tendances, au cinéma, les mieux notés. */
  lists: ShowcaseTab[];
  /** Notation : les titres les plus vus (les plus votés sur TMDB), « Tu l'as vu ? Note-le. » */
  rating: ShowcaseTitle[];
};

export type VitrineSources = {
  trending: TmdbSearchResult[];
  /** À l'affiche et à venir en France, alternés, dans l'ordre de TMDB (popularité). */
  cinema: TmdbSearchResult[];
  /** Films et séries les mieux notés, alternés. */
  topRated: TmdbSearchResult[];
  /** Films et séries les plus votés (donc les plus vus), alternés. */
  famous: TmdbSearchResult[];
};

export const VITRINE_PER_MOOD = 8;
export const VITRINE_PER_LIST = 6;
export const VITRINE_PICKS = 10;
export const VITRINE_RATING = 12;
/** Une note TMDB ne dit quelque chose qu'avec assez de votes (même seuil que showcase.ts). */
const MIN_VOTES = 300;

/**
 * Identifiant d'une suggestion : négatif (jamais celui d'un titre de la bibliothèque) et unique par
 * film ou série, pour servir de clé aux cartes.
 */
export function suggestionId(type: "Movie" | "TV Series", tmdbId: number): number {
  return -(tmdbId * 2 + (type === "TV Series" ? 1 : 0)) - 1;
}

/** Clé d'un titre, dans la vitrine comme dans la bibliothèque : « type:tmdbId ». */
export const titleKey = (type: "Movie" | "TV Series", tmdbId: number) => `${type}:${tmdbId}`;

export function toSuggestion(r: TmdbSearchResult): ShowcaseTitle {
  return {
    id: suggestionId(r.type, r.tmdbId),
    name: r.title,
    year: r.year,
    type: r.type,
    category: r.isDocumentary ? "Documentary" : r.type,
    genres: r.genres,
    overview: r.overview,
    posterUrl: posterUrl(r.posterPath),
    compatibility: null,
    reason: null,
    watchStatus: null,
    rating: null,
    voteAverage: r.voteAverage,
    voteCount: r.voteCount,
    trailer: null,
    availability: null,
    neighbours: [],
    runtime: null,
    directors: [],
    cast: [],
    suggestion: { tmdbId: r.tmdbId },
  };
}

/** Un aperçu montre une affiche et un synopsis : les titres qui n'en ont pas n'y entrent pas. */
export const presentable = (r: TmdbSearchResult) => Boolean(r.posterPath && r.overview.trim());

function matchesMood(r: TmdbSearchResult, mood: Exclude<Mood, "any">): boolean {
  if (mood === "think" && r.isDocumentary) return true;
  return r.genres.some((g) => MOOD_GENRES[mood].includes(g));
}

/** Sans doublon (un titre peut être à la fois tendance et à l'affiche), dans l'ordre d'arrivée. */
export function unique(rows: TmdbSearchResult[]): TmdbSearchResult[] {
  const seen = new Set<string>();
  return rows.filter((r) => {
    const key = titleKey(r.type, r.tmdbId);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** [a0, b0, a1, b1, …] : deux listes classées, mêlées sans qu'aucune n'écrase l'autre. */
export function alternate<T>(a: T[], b: T[]): T[] {
  const out: T[] = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if (i < a.length) out.push(a[i]);
    if (i < b.length) out.push(b[i]);
  }
  return out;
}

export function buildVitrine(sources: VitrineSources): Vitrine {
  const trending = unique(sources.trending).filter(presentable);
  const cinema = unique(sources.cinema).filter(presentable);
  const topRated = unique(sources.topRated).filter((r) => presentable(r) && (r.voteCount ?? 0) >= MIN_VOTES);
  const pool = unique([...trending, ...cinema, ...topRated]);

  const moods: ShowcaseTab[] = (Object.keys(MOOD_LABELS) as Exclude<Mood, "any">[])
    .map((mood) => ({
      value: mood,
      label: MOOD_LABELS[mood],
      titles: pool.filter((r) => matchesMood(r, mood)).slice(0, VITRINE_PER_MOOD).map(toSuggestion),
    }))
    .filter((tab) => tab.titles.length > 0);

  const lists: ShowcaseTab[] = [
    { value: "trending", label: "Tendances", titles: trending.slice(0, VITRINE_PER_LIST).map(toSuggestion) },
    { value: "cinema", label: "Au cinéma", titles: cinema.slice(0, VITRINE_PER_LIST).map(toSuggestion) },
    { value: "top", label: "Les mieux notés", titles: topRated.slice(0, VITRINE_PER_LIST).map(toSuggestion) },
  ].filter((tab) => tab.titles.length > 0);

  const famous = unique(sources.famous).filter(presentable);
  return {
    moods,
    picks: trending.slice(0, VITRINE_PICKS).map(toSuggestion),
    lists,
    rating: famous.slice(0, VITRINE_RATING).map(toSuggestion),
  };
}

/**
 * La vitrine sans ce que la bibliothèque contient déjà (clés « type:tmdbId ») : on ne propose pas
 * d'ajouter un titre qu'on a.
 */
export function withoutOwned(vitrine: Vitrine, owned: Set<string>): Vitrine {
  if (owned.size === 0) return vitrine;
  const keep = (t: ShowcaseTitle) => !t.suggestion || !owned.has(titleKey(t.type, t.suggestion.tmdbId));
  const tabs = (list: ShowcaseTab[]) => list.map((tab) => ({ ...tab, titles: tab.titles.filter(keep) })).filter((tab) => tab.titles.length > 0);
  return { moods: tabs(vitrine.moods), picks: vitrine.picks.filter(keep), lists: tabs(vitrine.lists), rating: vitrine.rating.filter(keep) };
}

/** Teinte de chaque affiche (variable CSS `--tint`), comme les aperçus de la bibliothèque. */
async function withTints(titles: ShowcaseTitle[]): Promise<void> {
  const urls = [...new Set(titles.map((t) => t.posterUrl))];
  const tints = new Map(await Promise.all(urls.map(async (url) => [url, tintVar(await posterTint(url))] as const)));
  for (const t of titles) t.tint = tints.get(t.posterUrl);
}

const TTL_MS = 6 * 60 * 60 * 1000;
/** TMDB n'a pas répondu : on réessaie bientôt, sans attendre six heures. */
const RETRY_MS = 5 * 60 * 1000;
let cache: { at: number; ttl: number; value: Promise<Vitrine> } | null = null;

async function fetchVitrine(): Promise<Vitrine> {
  const famousParams = { sort_by: "vote_count.desc", page: "1" };
  const [trending1, trending2, nowPlaying, upcoming, topMovies, topSeries, famousMovies, famousSeries] = await Promise.all([
    listTmdb("/trending/all/week", { page: "1" }, null),
    listTmdb("/trending/all/week", { page: "2" }, null),
    listTmdb("/movie/now_playing", { region: "FR", page: "1" }, "Movie"),
    listTmdb("/movie/upcoming", { region: "FR", page: "1" }, "Movie"),
    listTmdb("/movie/top_rated", { region: "FR", page: "1" }, "Movie"),
    listTmdb("/tv/top_rated", { page: "1" }, "TV Series"),
    listTmdb("/discover/movie", famousParams, "Movie"),
    listTmdb("/discover/tv", famousParams, "TV Series"),
  ]);
  const vitrine = buildVitrine({
    trending: [...trending1, ...trending2],
    cinema: alternate(nowPlaying, upcoming),
    topRated: alternate(topMovies, topSeries),
    // Deux films pour une série : on a vu plus de films que de séries en entier.
    famous: famousMovies.flatMap((movie, i) => (i % 2 === 1 && famousSeries[(i - 1) / 2] ? [movie, famousSeries[(i - 1) / 2]] : [movie])),
  });
  await withTints([...vitrine.moods.flatMap((t) => t.titles), ...vitrine.picks, ...vitrine.lists.flatMap((t) => t.titles), ...vitrine.rating]);
  return vitrine;
}

/**
 * La vitrine, partagée par tous (NFR-3 de la spec v2) : un appel par liste TMDB toutes les six
 * heures, quel que soit le nombre de visiteurs. Les appels simultanés attendent le même résultat.
 */
export async function getVitrine(): Promise<Vitrine> {
  if (cache && Date.now() - cache.at < cache.ttl) return cache.value;
  const entry = { at: Date.now(), ttl: TTL_MS, value: fetchVitrine().catch((): Vitrine => ({ moods: [], picks: [], lists: [], rating: [] })) };
  cache = entry;
  const vitrine = await entry.value;
  if (vitrine.picks.length === 0 && vitrine.lists.length === 0) entry.ttl = RETRY_MS;
  return vitrine;
}
