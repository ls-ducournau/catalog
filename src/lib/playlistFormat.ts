import type { PlaylistRuntime } from "./playlistService";

// Libellés et limites des playlists (spec playlists-v1) : module pur, sans base, partagé par le
// service, les pages et les cartes.

/** FR-1 : nom de 1 à 60 caractères, description de 200 au plus. */
export const NAME_MAX = 60;
export const DESCRIPTION_MAX = 200;

/** « 3 h 30 », « 2 h », « 45 min ». */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
}

/** « 22 h 47 ». */
export function clock(date: Date): string {
  return `${date.getHours()} h ${String(date.getMinutes()).padStart(2, "0")}`;
}

/** v2 FR-6 : « 1 h 52, fin vers 22 h 47 » pour un film ; « 45 min par épisode » pour une série. */
export function timingLine(runtime: number | null, isSeries: boolean, now: Date | null): string | null {
  if (!runtime) return null;
  if (isSeries) return `${formatMinutes(runtime)} par épisode`;
  if (!now) return formatMinutes(runtime);
  return `${formatMinutes(runtime)}, fin vers ${clock(new Date(now.getTime() + runtime * 60_000))}`;
}

/** EC-3 : durée totale ; « au moins … » si certaines durées manquent, rien si aucune n'est connue. */
export function totalDuration(runtime: PlaylistRuntime, count: number): string | null {
  if (runtime.known === 0) return null;
  const text = formatMinutes(runtime.minutes);
  return runtime.known < count ? `au moins ${text}` : text;
}

export function countLine(count: number): string {
  return count === 0 ? "Vide" : `${count} titre${count > 1 ? "s" : ""}`;
}

/** « 5 sur 12 vus », « Tout vu ». */
export function watchedLine(watched: number, count: number): string {
  if (count === 0) return "";
  return watched === count ? "Tout vu" : `${watched} sur ${count} vu${watched > 1 ? "s" : ""}`;
}

/** Clé de session : la playlist supprimée depuis sa page, que la liste propose de rétablir (FR-3). */
export const DELETED_PLAYLIST_KEY = "catalog:playlistSupprimee";
