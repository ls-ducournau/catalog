// Calendrier des sorties — spec: specs/sorties-v1.md (FR-3, AC-5)
//
// Module pur (aucun import de valeur) : quels événements d'un titre tombent dans la période, et
// comment la frise se découpe en semaines.

import type { ReleaseInfo } from "./release";

export type CalendarEvent = "theatrical" | "digital" | "series_premiere" | "season_premiere";

export type DatedEvent = { date: string; event: CalendarEvent; season: number | null };

const EVENT_LABEL: Record<CalendarEvent, string> = {
  theatrical: "Sortie en salle",
  digital: "Sortie numérique",
  series_premiere: "Nouvelle série",
  season_premiere: "Nouvelle saison",
};

/** « Sortie en salle », « Nouvelle série », « Saison 3 ». */
export function eventLabel(entry: { event: CalendarEvent; season: number | null }): string {
  return entry.event === "season_premiere" && entry.season !== null ? `Saison ${entry.season}` : EVENT_LABEL[entry.event];
}

/** « Film », « Série » ou « Documentaire ». */
export function kindLabel(entry: { mediaType: "Movie" | "TV Series"; isDocumentary: boolean }): string {
  if (entry.isDocumentary) return "Documentaire";
  return entry.mediaType === "Movie" ? "Film" : "Série";
}

/** « Lundi 21 » : le jour dans la semaine (date AAAA-MM-JJ). */
export function dayLabel(iso: string): string {
  const label = new Date(`${iso}T12:00:00Z`).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", timeZone: "UTC" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

/**
 * Événements datés d'un titre dans [from, to] (dates AAAA-MM-JJ). La sortie numérique n'est
 * demandée que pour ta bibliothèque : pour le reste, la sortie en salle suffit à le signaler.
 */
export function eventsOf(
  release: ReleaseInfo | null,
  from: string,
  to: string,
  { withDigital = false }: { withDigital?: boolean } = {}
): DatedEvent[] {
  if (!release) return [];
  const inWindow = (date: string | null): date is string => date !== null && date >= from && date <= to;
  const events: DatedEvent[] = [];

  if (release.kind === "movie") {
    if (inWindow(release.theatrical)) events.push({ date: release.theatrical, event: "theatrical", season: null });
    if (withDigital && inWindow(release.digital)) events.push({ date: release.digital, event: "digital", season: null });
    return events;
  }

  if (inWindow(release.firstAir)) events.push({ date: release.firstAir, event: "series_premiere", season: null });
  const next = release.nextEpisode;
  // La saison 1 d'une série, c'est sa première diffusion : déjà comptée.
  if (next && next.episode === 1 && next.season > 1 && inWindow(next.date)) {
    events.push({ date: next.date, event: "season_premiere", season: next.season });
  }
  return events;
}

export type CalendarWeek<T> = {
  /** Lundi de la semaine, AAAA-MM-JJ. */
  start: string;
  label: string;
  entries: T[];
};

const DAY_MS = 24 * 60 * 60 * 1000;

function mondayOf(iso: string): Date {
  const date = new Date(`${iso}T12:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7; // lundi = 0
  return new Date(date.getTime() - offset * DAY_MS);
}

function dayMonth(date: Date): string {
  return date.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
}

/** « Cette semaine », « La semaine prochaine », sinon « Semaine du 13 oct. ». */
export function weekLabel(start: Date, today: Date): string {
  const weeks = Math.round((start.getTime() - mondayOf(today.toISOString().slice(0, 10)).getTime()) / (7 * DAY_MS));
  if (weeks === 0) return "Cette semaine";
  if (weeks === 1) return "La semaine prochaine";
  if (weeks === -1) return "La semaine dernière";
  return `Semaine du ${dayMonth(start)}`;
}

/**
 * AC-5 : la frise, semaine par semaine dans l'ordre, chaque semaine triée par date puis par
 * `order` (le plus prometteur d'abord), sans doublon de clé.
 */
export function groupByWeek<T extends { key: string; date: string }>(
  entries: T[],
  today: Date,
  order: (a: T, b: T) => number = () => 0
): CalendarWeek<T>[] {
  const seen = new Set<string>();
  const unique = entries.filter((e) => (seen.has(e.key) ? false : (seen.add(e.key), true)));
  const sorted = [...unique].sort((a, b) => a.date.localeCompare(b.date) || order(a, b));

  const weeks = new Map<string, CalendarWeek<T>>();
  for (const entry of sorted) {
    const monday = mondayOf(entry.date);
    const start = monday.toISOString().slice(0, 10);
    const week = weeks.get(start) ?? { start, label: weekLabel(monday, today), entries: [] };
    week.entries.push(entry);
    weeks.set(start, week);
  }
  return [...weeks.values()].sort((a, b) => a.start.localeCompare(b.start));
}

export type CalendarWindow = { from: string; to: string };

/**
 * FR-6 ter : les tranches de la frise, dans l'ordre de chargement. D'abord les 30 derniers jours
 * jusqu'à la fin du mois en cours, puis un mois calendaire à la fois, la dernière tranche coupée
 * à l'horizon (`months` mois après aujourd'hui).
 */
export function calendarWindows(today: Date, months: number, pastDays = 30): CalendarWindow[] {
  const day = (date: Date) => date.toISOString().slice(0, 10);
  const endOfMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0, 12));

  const horizon = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + months, today.getUTCDate(), 12));
  const last = day(horizon);
  const windows: CalendarWindow[] = [];

  let from = day(new Date(today.getTime() - pastDays * 24 * 60 * 60 * 1000));
  let year = today.getUTCFullYear();
  let month = today.getUTCMonth();
  while (from <= last) {
    const monthEnd = day(endOfMonth(year, month));
    const to = monthEnd < last ? monthEnd : last;
    windows.push({ from, to });
    month += 1;
    if (month === 12) {
      month = 0;
      year += 1;
    }
    from = day(new Date(Date.UTC(year, month, 1, 12)));
  }
  return windows;
}
