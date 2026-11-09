import type { ShowcaseTitle } from "./showcase";
import { listTmdb, type TmdbSearchResult } from "./tmdb";
import { alternate, presentable, toSuggestion, unique } from "./vitrine";

// Bienvenue — spec: specs/bienvenue-v1.md (FR-10). La suite du paquet de cartes quand la vitrine est
// épuisée : chaque page mêle des titres très vus (deux films pour une série) et des titres populaires du
// moment. Même logique que le serveur Rust (`serveur/src/bienvenue.rs`). Gardée six heures par page.

/** Au-delà, TMDB propose des titres trop confidentiels pour un premier geste. */
export const PAGES_MAX = 20;
const TTL_MS = 6 * 60 * 60 * 1000;
const pages = new Map<number, { at: number; value: ShowcaseTitle[] }>();

export function composerPage(
  filmsConnus: TmdbSearchResult[],
  seriesConnues: TmdbSearchResult[],
  tendances: TmdbSearchResult[],
  films: TmdbSearchResult[],
  series: TmdbSearchResult[]
): ShowcaseTitle[] {
  const connus = filmsConnus.flatMap((film, i) => (i % 2 === 1 && seriesConnues[(i - 1) / 2] ? [film, seriesConnues[(i - 1) / 2]] : [film]));
  const populaires = alternate(tendances, alternate(films, series));
  return unique(alternate(connus, populaires).filter(presentable)).map(toSuggestion);
}

export async function chargerPage(page: number): Promise<ShowcaseTitle[]> {
  const garde = pages.get(page);
  if (garde && Date.now() - garde.at < TTL_MS) return garde.value;
  // La vitrine a pris la première page des très vus et les deux premières des tendances.
  const connus = { sort_by: "vote_count.desc", page: String(page + 1) };
  const populaires = { region: "FR", page: String(page) };
  const [filmsConnus, seriesConnues, tendances, films, series] = await Promise.all([
    listTmdb("/discover/movie", connus, "Movie"),
    listTmdb("/discover/tv", connus, "TV Series"),
    listTmdb("/trending/all/week", { page: String(page + 2) }, null),
    listTmdb("/movie/popular", populaires, "Movie"),
    listTmdb("/tv/popular", populaires, "TV Series"),
  ]);
  const value = composerPage(filmsConnus, seriesConnues, tendances, films, series);
  // Une page vide (TMDB injoignable) n'est pas gardée : on réessaie à la prochaine demande.
  if (value.length > 0) pages.set(page, { at: Date.now(), value });
  return value;
}
