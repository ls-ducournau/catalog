import type Database from "better-sqlite3";
import type { Availability } from "./availability";
import { getItemsByIds, listItems, RATING_SCALE } from "./itemService";
import type { Category, LibraryItem, WatchStatus } from "./libraryItem";
import { posterTint, tintVar } from "./posterTint";
import { loadModelTitles } from "./preferenceService";
import { getRecommendations, type RecommendationProfile, type RecommendedItem } from "./recommendationService";
import { MOOD_GENRES, MOOD_LABELS, type Mood } from "./tonight";
import type { Trailer } from "./trailer";

// Aperçus de l'accueil (sections reprises de raycast.com : carrousel d'extensions, « Featured » et
// liste du Store ; fiche docs/design-reference/raycast/composants/vitrine.md). Lecture seule.

export type ShowcaseTitle = {
  id: number;
  name: string;
  year: string | null;
  /** Film ou série (un documentaire est l'un ou l'autre) : l'heure de fin ne vaut que pour un film. */
  type: "Movie" | "TV Series";
  category: Category;
  genres: string[];
  overview: string;
  posterUrl: string | null;
  /** Variable CSS `--tint` (« r g b ») tirée de l'affiche ; absente = carte neutre. */
  tint?: string;
  /** Probabilité que tu le notes 4 étoiles ou plus ; null hors pile classée. */
  compatibility: number | null;
  /** « Proche de … » : le titre noté qui l'explique le mieux. */
  reason: string | null;
  watchStatus: WatchStatus | null;
  rating: string | null;
  voteAverage: number | null;
  voteCount: number | null;
  /** Bande-annonce, lisible depuis la carte. */
  trailer: Trailer | null;
  /** Où le voir ; la carte dit « Sur … » quand c'est inclus dans tes abonnements. */
  availability: Availability | null;
  /** Titres notés qui l'expliquent, avec leur affiche (la fenêtre des cartes « à la une »). */
  neighbours: { id: number; name: string; posterUrl: string | null }[];
  /** Durée en minutes (d'un épisode pour une série), d'après TMDB ; null si inconnue. */
  runtime: number | null;
  /** Réalisation et têtes d'affiche, d'après TMDB. */
  directors: string[];
  cast: string[];
};

/** Ta collection en chiffres (panneau de « Ta bibliothèque »). */
export type LibraryStats = {
  total: number;
  watched: number;
  toWatch: number;
  categories: { value: Category; count: number }[];
  /** Titres vus par note, de 💩 (indice 0) à 5 étoiles. */
  ratings: number[];
};

export type ShowcaseTab = { value: string; label: string; titles: ShowcaseTitle[] };

export type HomeShowcase = {
  /** Carrousel : ta pile, une envie par onglet. */
  moods: ShowcaseTab[];
  /** « À la une » : les trois titres de ta pile qui te promettent le plus. */
  featured: ShowcaseTitle[];
  /** Fenêtre des recommandations : le haut de ta pile classée, avec ce qui l'explique. */
  picks: ShowcaseTitle[];
  /** Ce que Catalog a appris de toi (genres et réalisateurs les mieux notés) ; null sans assez de notes. */
  profile: RecommendationProfile | null;
  /** Titres de ta pile par genre (mêmes genres TMDB que le profil) : le second polygone du radar. */
  pileGenres: Record<string, number>;
  /** Liste : derniers ajouts, coups de cœur, à voir bien notés. */
  lists: ShowcaseTab[];
  stats: LibraryStats;
};

const PER_MOOD = 8;
const PER_LIST = 6;
const PICKS = 10;
const MIN_VOTES = 300;

function toTitle(item: LibraryItem | RecommendedItem): ShowcaseTitle {
  const recommended = "compatibility" in item ? item : null;
  const neighbour = recommended?.neighbours[0];
  return {
    id: item.id,
    name: item.name,
    year: item.year,
    type: item.type,
    category: item.category,
    genres: item.genres,
    overview: item.overview ?? "",
    posterUrl: item.posterUrl,
    compatibility: recommended?.compatibility ?? null,
    reason: neighbour ? `Proche de ${neighbour.name}` : null,
    watchStatus: item.watchStatus,
    rating: item.rating,
    voteAverage: item.voteAverage,
    voteCount: item.voteCount,
    trailer: item.trailer,
    availability: item.availability,
    neighbours: [],
    runtime: null,
    directors: [],
    cast: [],
  };
}

/** Durée et générique, lus dans les caractéristiques TMDB en cache (aucun appel réseau). */
function withCredits(db: Database.Database, titles: ShowcaseTitle[]): void {
  const ids = [...new Set(titles.map((t) => t.id))];
  if (ids.length === 0) return;
  const byId = new Map(loadModelTitles(db, `id IN (${ids.map(() => "?").join(",")})`, ids).map((m) => [m.id, m]));
  for (const t of titles) {
    const model = byId.get(t.id);
    if (!model) continue;
    t.runtime = model.runtime;
    t.directors = model.directors.slice(0, 2);
    t.cast = model.cast.slice(0, 3);
  }
}

function libraryStats(db: Database.Database): LibraryStats {
  const counts = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN watch_status = 'Watched' THEN 1 ELSE 0 END) AS watched,
              SUM(CASE WHEN watch_status = 'Unwatched' THEN 1 ELSE 0 END) AS toWatch
       FROM items`
    )
    .get() as { total: number; watched: number | null; toWatch: number | null };
  const byRating = new Map(
    (
      db.prepare(`SELECT rating, COUNT(*) AS n FROM items WHERE watch_status = 'Watched' AND rating IS NOT NULL GROUP BY rating`).all() as {
        rating: string;
        n: number;
      }[]
    ).map((r) => [r.rating, r.n])
  );
  // Même définition des catégories que la bibliothèque (listItems).
  const categories = (["Movie", "TV Series", "Documentary"] as Category[]).map((value) => ({
    value,
    count: listItems(db, { category: value, pageSize: 1 }).total,
  }));
  return {
    total: counts.total,
    watched: counts.watched ?? 0,
    toWatch: counts.toWatch ?? 0,
    categories,
    ratings: RATING_SCALE.map((r) => byRating.get(r) ?? 0),
  };
}

/** Les titres « proches » d'un titre recommandé, avec leurs affiches. */
function withNeighbours(db: Database.Database, item: LibraryItem | RecommendedItem, title: ShowcaseTitle): ShowcaseTitle {
  if (!("neighbours" in item) || item.neighbours.length === 0) return title;
  const ids = item.neighbours.slice(0, 4).map((n) => n.id);
  const byId = new Map(getItemsByIds(db, ids).map((i) => [i.id, i]));
  return {
    ...title,
    neighbours: item.neighbours.slice(0, 4).map((n) => ({ id: n.id, name: n.name, posterUrl: byId.get(n.id)?.posterUrl ?? null })),
  };
}

/** Un aperçu montre une affiche et un synopsis : les titres qui n'en ont pas n'y entrent pas. */
const presentable = (item: LibraryItem) => Boolean(item.posterUrl && item.overview);

function matchesMood(item: LibraryItem, mood: Exclude<Mood, "any">): boolean {
  if (mood === "think" && item.category === "Documentary") return true;
  return item.genres.some((g) => MOOD_GENRES[mood].includes(g));
}

/** Ta pile classée et le profil qui la classe ; sans assez de notes, la pile par note TMDB. */
function rankedPile(db: Database.Database): { items: (LibraryItem | RecommendedItem)[]; profile: RecommendationProfile | null } {
  const ranked = getRecommendations(db, { limit: 240 });
  if (!("error" in ranked)) return { items: ranked.items, profile: ranked.profile };
  return { items: listItems(db, { watchStatus: "Unwatched", sortBy: "tmdbRating", pageSize: 240 }).items, profile: null };
}

async function withTints(titles: ShowcaseTitle[]): Promise<void> {
  const unique = [...new Map(titles.map((t) => [t.posterUrl, t])).keys()];
  const tints = new Map(await Promise.all(unique.map(async (url) => [url, tintVar(await posterTint(url))] as const)));
  for (const t of titles) t.tint = tints.get(t.posterUrl);
}

export async function getHomeShowcase(db: Database.Database): Promise<HomeShowcase> {
  const ranked = rankedPile(db);
  const pile = ranked.items.filter(presentable);
  const titled = (item: LibraryItem | RecommendedItem) => withNeighbours(db, item, toTitle(item));

  const moods: ShowcaseTab[] = (Object.keys(MOOD_LABELS) as Exclude<Mood, "any">[])
    .map((mood) => ({
      value: mood,
      label: MOOD_LABELS[mood],
      titles: pile.filter((item) => matchesMood(item, mood)).slice(0, PER_MOOD).map(titled),
    }))
    .filter((tab) => tab.titles.length > 0);

  const picks = pile.slice(0, PICKS).map(titled);
  const featured = picks.slice(0, 3);

  const list = (options: Parameters<typeof listItems>[1], keep: (item: LibraryItem) => boolean = () => true) =>
    listItems(db, { ...options, pageSize: 60 })
      .items.filter((item) => presentable(item) && keep(item))
      .slice(0, PER_LIST)
      .map(toTitle);
  const lists: ShowcaseTab[] = [
    { value: "recent", label: "Derniers ajouts", titles: list({ sortBy: "added", sortDir: "desc" }) },
    { value: "favorites", label: "Tes coups de cœur", titles: list({ watchStatus: "Watched", minRating: 5, sortBy: "elo" }) },
    {
      value: "acclaimed",
      label: "À voir, bien notés",
      // Une note TMDB ne dit quelque chose qu'avec assez de votes.
      titles: list({ watchStatus: "Unwatched", sortBy: "tmdbRating" }, (item) => (item.voteCount ?? 0) >= MIN_VOTES),
    },
  ].filter((tab) => tab.titles.length > 0);

  const shown = [...moods.flatMap((tab) => tab.titles), ...picks, ...lists.flatMap((tab) => tab.titles)];
  withCredits(db, shown);
  await withTints(shown);

  const profile = ranked.profile
    ? { ...ranked.profile, genres: ranked.profile.genres.slice(0, 6), directors: ranked.profile.directors.slice(0, 4) }
    : null;

  // Même source que les affinités (caractéristiques TMDB, sinon genres de la base).
  const pileGenres: Record<string, number> = {};
  for (const t of loadModelTitles(db, "watch_status = 'Unwatched'")) {
    for (const g of t.genres) pileGenres[g] = (pileGenres[g] ?? 0) + 1;
  }

  return { moods, featured, picks, lists, profile, pileGenres, stats: libraryStats(db) };
}
