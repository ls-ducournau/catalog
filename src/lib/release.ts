// Dates de sortie et badge « Au cinéma » / « À venir » — spec: specs/sorties-v1.md (FR-1, FR-2)
//
// Module pur (aucun import) : partagé par le serveur, les cartes et les tests. Le badge dépend
// du jour ; il se calcule à l'affichage, jamais stocké.

/** FR-1 : ce que l'app garde des dates d'un titre. Dates au format AAAA-MM-JJ. */
export type ReleaseInfo = {
  kind: "movie" | "tv";
  /** Films : sortie en salle en France (type 3, sinon 2), à défaut la sortie mondiale. */
  theatrical: string | null;
  /** Films : sortie numérique en France (type 4) : elle marque la fin de « au cinéma ». */
  digital: string | null;
  /** Séries : première diffusion. */
  firstAir: string | null;
  /** Séries : prochain épisode annoncé. */
  nextEpisode: { date: string; season: number; episode: number } | null;
  /** Statut TMDB : « Released », « Returning Series », « In Production », « Planned »… */
  status: string | null;
  fetchedAt: string;
};

export type ReleaseBadge =
  | { kind: "in_theaters" }
  | { kind: "upcoming"; date: string | null; label: string };

/** FR-2 : un film reste « au cinéma » six semaines après sa sortie en salle. */
export const IN_THEATERS_DAYS = 42;
/** Comme la disponibilité : au-delà, les dates sont redemandées à TMDB. */
export const RELEASE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const ANNOUNCED = new Set(["In Production", "Planned", "Post Production", "Pilot"]);
const DAY_MS = 24 * 60 * 60 * 1000;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** « 15 oct. », avec l'année seulement si elle diffère de celle du jour. */
export function shortDate(iso: string, today: Date = new Date()): string {
  const date = new Date(`${iso}T12:00:00Z`);
  const sameYear = date.getUTCFullYear() === today.getUTCFullYear();
  return date.toLocaleDateString("fr-FR", {
    day: "numeric",
    month: "short",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

function validDay(value: unknown): string | null {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
}

/**
 * FR-2 : le badge d'un titre à une date donnée ; null s'il n'y a rien à signaler (sorti depuis
 * longtemps, ou pas de dates connues).
 */
export function releaseBadge(info: ReleaseInfo | null, today: Date = new Date()): ReleaseBadge | null {
  if (!info) return null;
  const day = isoDay(today);

  if (info.kind === "movie") {
    const { theatrical, digital } = info;
    if (theatrical && theatrical <= day) {
      const since = (today.getTime() - new Date(`${theatrical}T00:00:00Z`).getTime()) / DAY_MS;
      const stillOnlyInTheaters = !digital || digital > day;
      if (since <= IN_THEATERS_DAYS && stillOnlyInTheaters) return { kind: "in_theaters" };
      return null;
    }
    if (theatrical) {
      return { kind: "upcoming", date: theatrical, label: `Au cinéma le ${shortDate(theatrical, today)}` };
    }
    if (digital && digital > day) {
      return { kind: "upcoming", date: digital, label: `Sortie le ${shortDate(digital, today)}` };
    }
    return info.status && ANNOUNCED.has(info.status)
      ? { kind: "upcoming", date: null, label: "Prochainement" }
      : null;
  }

  if (info.firstAir && info.firstAir > day) {
    return { kind: "upcoming", date: info.firstAir, label: `Nouvelle série le ${shortDate(info.firstAir, today)}` };
  }
  const next = info.nextEpisode;
  if (next && next.episode === 1 && next.date >= day) {
    return { kind: "upcoming", date: next.date, label: `Saison ${next.season} le ${shortDate(next.date, today)}` };
  }
  if (!info.firstAir && info.status && ANNOUNCED.has(info.status)) {
    return { kind: "upcoming", date: null, label: "Prochainement" };
  }
  return null;
}

export function isReleaseStale(info: ReleaseInfo | null, now: Date = new Date()): boolean {
  return !info || now.getTime() - new Date(info.fetchedAt).getTime() > RELEASE_TTL_MS;
}

type RawReleaseDate = { release_date?: string; type?: number };
type RawReleaseDates = { results?: { iso_3166_1?: string; release_dates?: RawReleaseDate[] }[] };

/** Plus ancienne date d'un des types demandés, dans l'ordre de préférence des types. */
function earliestOfType(dates: RawReleaseDate[], types: number[]): string | null {
  for (const type of types) {
    const days = dates
      .filter((d) => d.type === type)
      .map((d) => validDay(d.release_date))
      .filter((d): d is string => d !== null)
      .sort();
    if (days.length > 0) return days[0];
  }
  return null;
}

/**
 * FR-1, AC-4 : lit les dates dans une fiche TMDB (enrichie de `release_dates` pour un film).
 * Pays : la France ; un film sans sortie française retombe sur sa date mondiale.
 */
export function releaseFromTmdb(
  raw: Record<string, unknown>,
  isMovie: boolean,
  now: Date = new Date()
): ReleaseInfo {
  const status = typeof raw.status === "string" ? raw.status : null;
  if (isMovie) {
    const france =
      (raw.release_dates as RawReleaseDates | undefined)?.results?.find((r) => r.iso_3166_1 === "FR")
        ?.release_dates ?? [];
    return {
      kind: "movie",
      theatrical: earliestOfType(france, [3, 2]) ?? validDay(raw.release_date),
      digital: earliestOfType(france, [4]),
      firstAir: null,
      nextEpisode: null,
      status,
      fetchedAt: now.toISOString(),
    };
  }

  const next = raw.next_episode_to_air as
    | { air_date?: string; season_number?: number; episode_number?: number }
    | null
    | undefined;
  const nextDate = validDay(next?.air_date);
  return {
    kind: "tv",
    theatrical: null,
    digital: null,
    firstAir: validDay(raw.first_air_date),
    nextEpisode:
      next && nextDate && typeof next.season_number === "number" && typeof next.episode_number === "number"
        ? { date: nextDate, season: next.season_number, episode: next.episode_number }
        : null,
    status,
    fetchedAt: now.toISOString(),
  };
}
