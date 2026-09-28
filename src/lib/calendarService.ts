import type Database from "better-sqlite3";
import { eventsOf, type CalendarEvent } from "./calendar";
import { externalTitleData } from "./discoveryService";
import { dismissedTmdbKeys, tmdbKey } from "./dismissalService";
import { storeRelease } from "./itemService";
import type { WatchStatus } from "./libraryItem";
import { getOpinionWeights } from "./personOpinionService";
import { personBonus } from "./personPreference";
import { featuresToTitle, getCompatibility, loadModelTitles, rankTitles } from "./preferenceService";
import { isReleaseStale, type ReleaseInfo } from "./release";
import type { Trailer, TrailerInfo } from "./trailer";
import { discoverReleases, getRelease, posterUrl, type TmdbSearchResult } from "./tmdb";

// Calendrier des sorties — spec: specs/sorties-v1.md (FR-3 à FR-6, NFR-1, NFR-2)

export type CalendarEntry = {
  /** Unique par titre et par événement (une série peut avoir sa première et une saison). */
  key: string;
  date: string;
  event: CalendarEvent;
  season: number | null;
  tmdbId: number;
  mediaType: "Movie" | "TV Series";
  isDocumentary: boolean;
  title: string;
  posterUrl: string | null;
  overview: string;
  /** Présent dans ta bibliothèque : son id local et son statut. */
  libraryId: number | null;
  libraryStatus: WatchStatus | null;
  compatibility: number | null;
  /** Bande-annonce (bandes-annonces-v1), quand elle est connue. */
  trailer: Trailer | null;
};

export type CalendarResult = {
  from: string;
  to: string;
  entries: CalendarEntry[];
  /** Repère de « pour toi » (FR-4) : la part de tes titres vus notés ⭐⭐⭐⭐ ou plus. */
  baseRate: number | null;
  /** EC-1 : TMDB n'a rien renvoyé ; la frise ne montre que ta bibliothèque. */
  externalUnavailable: boolean;
};

/** FR-3 : la frise remonte jusqu'à 30 jours en arrière. */
export const PAST_DAYS = 30;
/** FR-6 bis : jusqu'où la frise peut aller devant (un an et un peu de marge). */
export const MAX_FUTURE_DAYS = 400;
/** FR-6 ter : une requête couvre au plus une tranche de cette durée. */
export const MAX_WINDOW_DAYS = 70;
/** NFR-2 : dates de la bibliothèque rafraîchies au plus par ce nombre, à chaque visite. */
const LIBRARY_REFRESH_BATCH = 60;
const CONCURRENCY = 8;
const LISTS_TTL_MS = 24 * 60 * 60 * 1000;
/** Titres dont les dates peuvent encore bouger : une série qui continue, un film pas encore sorti. */
const MAY_CHANGE = new Set(["Returning Series", "In Production", "Planned", "Post Production", "Pilot"]);

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (date: Date) => date.toISOString().slice(0, 10);


/** NFR-2 : les listes TMDB d'une tranche, gardées une journée. */
const listsByKey = new Map<string, { at: number; results: TmdbSearchResult[] }>();

/**
 * FR-6 ter : les titres les plus populaires de la tranche. Chaque tranche a ses propres têtes
 * d'affiche : sur une période d'un an d'un seul tenant, les sorties du moment (au pic de leur
 * popularité) évinçaient toutes celles des mois suivants. Séries : les nouvelles, et celles qui
 * diffusent un épisode sur la tranche (leurs débuts de saison sont retenus ensuite).
 */
async function releaseLists(from: string, to: string): Promise<TmdbSearchResult[]> {
  const key = `${from}|${to}`;
  const cached = listsByKey.get(key);
  if (cached && Date.now() - cached.at < LISTS_TTL_MS) return cached.results;
  const span = (new Date(to).getTime() - new Date(from).getTime()) / DAY_MS;
  const moviePages = span > 40 ? 2 : 1;
  const lists = await Promise.all([
    ...Array.from({ length: moviePages }, (_, i) => discoverReleases("Movie", from, to, i + 1)),
    discoverReleases("TV Series", from, to, 1),
    discoverReleases("TV Series", from, to, 1, { airing: true }),
  ]);
  const seen = new Set<string>();
  const results = lists.flat().filter((r) => {
    const k = `${r.type}:${r.tmdbId}`;
    return seen.has(k) ? false : (seen.add(k), true);
  });
  // Une liste vide (TMDB injoignable) n'est pas gardée : on retentera à la visite suivante.
  if (results.length > 0) listsByKey.set(key, { at: Date.now(), results });
  return results;
}

async function inParallel<T>(items: T[], work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    })
  );
}

type LibraryRow = {
  id: number;
  name: string;
  type: "Movie" | "TV Series";
  tmdb_id: number | null;
  poster_path: string | null;
  overview: string | null;
  watch_status: WatchStatus | null;
  genre: string | null;
  release_info: string | null;
  trailer_info: string | null;
};

function parseTrailer(json: string | null): Trailer | null {
  if (!json) return null;
  try {
    return (JSON.parse(json) as TrailerInfo).trailer;
  } catch {
    return null;
  }
}

function parseRelease(json: string | null): ReleaseInfo | null {
  if (!json) return null;
  try {
    return JSON.parse(json) as ReleaseInfo;
  } catch {
    return null;
  }
}

/** NFR-2 : rafraîchit par lots les dates qui peuvent encore bouger. Local uniquement (NFR-1). */
async function refreshLibraryDates(db: Database.Database, rows: LibraryRow[], from: string): Promise<void> {
  const stale = rows
    .filter((row) => row.tmdb_id !== null)
    .filter((row) => {
      const release = parseRelease(row.release_info);
      if (!isReleaseStale(release)) return false;
      if (!release) return true;
      if (release.kind === "tv") return release.status === null || MAY_CHANGE.has(release.status);
      return release.theatrical === null || release.theatrical >= from || MAY_CHANGE.has(release.status ?? "");
    })
    .slice(0, LIBRARY_REFRESH_BATCH);

  await inParallel(stale, async (row) => {
    const release = await getRelease(row.tmdb_id!, row.type);
    if (!release) return;
    storeRelease(db, row.id, release);
    row.release_info = JSON.stringify(release);
  });
}

const isDocumentaryGenre = (json: string | null) => {
  try {
    return json ? (JSON.parse(json) as string[]).includes("Documentary") : false;
  } catch {
    return false;
  }
};

/** Tranche demandée, bornée : pas plus de 30 jours en arrière, ni plus d'un an devant. */
export function clampWindow(
  from: string,
  to: string,
  today: Date = new Date()
): { from: string; to: string } | null {
  const valid = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && !Number.isNaN(new Date(d).getTime());
  if (!valid(from) || !valid(to) || from > to) return null;
  const earliest = isoDay(new Date(today.getTime() - PAST_DAYS * DAY_MS));
  const latest = isoDay(new Date(today.getTime() + MAX_FUTURE_DAYS * DAY_MS));
  const start = from < earliest ? earliest : from;
  const end = to > latest ? latest : to;
  if (start > end) return null;
  const span = (new Date(end).getTime() - new Date(start).getTime()) / DAY_MS;
  return span > MAX_WINDOW_DAYS ? null : { from: start, to: end };
}

/**
 * FR-3 à FR-5, FR-6 ter : les sorties d'une tranche de la frise. La page charge les tranches une
 * à une (le mois en cours, puis les suivants à mesure qu'on descend), jusqu'à l'horizon choisi.
 */
export async function getCalendar(
  db: Database.Database,
  { from, to }: { from: string; to: string }
): Promise<CalendarResult> {

  // ---- ta bibliothèque : films à voir, et toutes tes séries (une saison qui revient compte) ----
  const rows = db
    .prepare(
      `SELECT id, name, type, tmdb_id, poster_path, overview, watch_status, genre, release_info, trailer_info
       FROM items WHERE tmdb_id IS NOT NULL`
    )
    .all() as LibraryRow[];
  await refreshLibraryDates(db, rows, from);

  const entries: CalendarEntry[] = [];
  const inLibrary = new Set<string>();
  for (const row of rows) {
    inLibrary.add(tmdbKey(row.type, row.tmdb_id!));
    const release = parseRelease(row.release_info);
    // Un film déjà vu n'a plus de sortie à attendre ; une série vue peut revenir.
    if (row.type === "Movie" && row.watch_status === "Watched") continue;
    for (const e of eventsOf(release, from, to, { withDigital: true })) {
      entries.push({
        key: `${row.type}:${row.tmdb_id}:${e.event}:${e.season ?? ""}`,
        date: e.date,
        event: e.event,
        season: e.season,
        tmdbId: row.tmdb_id!,
        mediaType: row.type,
        isDocumentary: isDocumentaryGenre(row.genre),
        title: row.name,
        posterUrl: posterUrl(row.poster_path),
        overview: row.overview ?? "",
        libraryId: row.id,
        libraryStatus: row.watch_status,
        compatibility: null,
        trailer: parseTrailer(row.trailer_info),
      });
    }
  }

  // Compatibilité des titres de ta pile (pas des séries déjà vues : tu les as notées).
  const opinions = getOpinionWeights(db);
  const pileIds = [...new Set(entries.filter((e) => e.libraryStatus !== "Watched").map((e) => e.libraryId!))];
  if (pileIds.length > 0) {
    const pile = loadModelTitles(db, `id IN (${pileIds.map(() => "?").join(",")})`, pileIds);
    const byId = new Map(
      rankTitles(db, pile, (title) => personBonus(title.people ?? [], opinions)).map((s) => [s.id, s.compatibility])
    );
    for (const entry of entries) {
      if (entry.libraryStatus !== "Watched") entry.compatibility = byId.get(entry.libraryId!) ?? null;
    }
  }

  // ---- le reste : sorties en salle en France et nouvelles séries, hors bibliothèque ----
  const dismissed = dismissedTmdbKeys(db);
  const fetchedLists = await releaseLists(from, to);
  const external = fetchedLists.filter((r) => {
    const key = tmdbKey(r.type, r.tmdbId);
    return !inLibrary.has(key) && !dismissed.has(key);
  });

  const fetched = new Map<string, Awaited<ReturnType<typeof externalTitleData>>>();
  await inParallel(external, async (r) => {
    fetched.set(tmdbKey(r.type, r.tmdbId), await externalTitleData(r.tmdbId, r.type));
  });

  // Compatibilité (recommendations v1.5 FR-34) : même calcul que la découverte.
  const withData = external.filter((r) => fetched.get(tmdbKey(r.type, r.tmdbId)));
  const compatibility = new Map(
    rankTitles(
      db,
      withData.map((r) => featuresToTitle(-r.tmdbId, r.title, fetched.get(tmdbKey(r.type, r.tmdbId))!.features)),
      (title) => personBonus(title.people ?? [], opinions)
    ).map((s, i) => [tmdbKey(withData[i].type, withData[i].tmdbId), s.compatibility])
  );

  for (const r of external) {
    const key = tmdbKey(r.type, r.tmdbId);
    // Les dates exactes (sortie française) viennent de la fiche ; sans elle, on ne devine pas.
    for (const e of eventsOf(fetched.get(key)?.release ?? null, from, to)) {
      entries.push({
        key: `${r.type}:${r.tmdbId}:${e.event}:${e.season ?? ""}`,
        date: e.date,
        event: e.event,
        season: e.season,
        tmdbId: r.tmdbId,
        mediaType: r.type,
        isDocumentary: r.isDocumentary,
        title: r.title,
        posterUrl: posterUrl(r.posterPath),
        overview: r.overview,
        libraryId: null,
        libraryStatus: null,
        compatibility: compatibility.get(key) ?? null,
        trailer: fetched.get(key)?.trailer.trailer ?? null,
      });
    }
  }

  return {
    from,
    to,
    entries,
    baseRate: getCompatibility(db)?.baseRate ?? null,
    externalUnavailable: fetchedLists.length === 0,
  };
}
