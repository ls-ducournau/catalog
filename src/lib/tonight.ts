// Ce soir v2 : le contexte de la soirée — spec: specs/ce-soir-v2.md (FR-1 à FR-4)
//
// Module pur (aucun import) : partagé par le serveur, la page et les tests.

export type Mood = "any" | "light" | "intense" | "moving" | "escape" | "think";
export type Format = "any" | "Movie" | "TV Series" | "Documentary";
export type Company = "alone" | "duo" | "family";
export type Where = "services" | "anywhere";
/** `playlist` (playlists-v2 FR-8) : les titres pas encore vus d'une playlist (`playlistId`). */
export type Source = "pile" | "catalog" | "playlist";

export type TonightContext = {
  mood: Mood;
  format: Format;
  /** Films seulement (FR-4) ; null = sans limite. */
  maxMinutes: number | null;
  company: Company;
  where: Where;
  source: Source;
  /** La playlist choisie quand `source` vaut « playlist » ; null sinon. */
  playlistId: number | null;
  /** Un genre TMDB précis (nom anglais), en plus de l'envie ; null = tous les genres. */
  genre: string | null;
};

export const DEFAULT_CONTEXT: TonightContext = {
  mood: "any",
  format: "any",
  maxMinutes: null,
  company: "alone",
  where: "services",
  source: "pile",
  playlistId: null,
  genre: null,
};

/** FR-2 : genres TMDB (films et séries, noms anglais) de chaque envie. */
export const MOOD_GENRES: Record<Exclude<Mood, "any">, string[]> = {
  light: ["Comedy", "Animation", "Family", "Kids"],
  intense: ["Thriller", "Action", "Crime", "Horror", "Mystery", "Action & Adventure"],
  moving: ["Drama", "Romance"],
  escape: ["Science Fiction", "Fantasy", "Adventure", "Sci-Fi & Fantasy", "Action & Adventure"],
  think: ["Documentary", "History", "War", "War & Politics"],
};

/** Nom d'une envie, partout où on la propose (Ce soir, accueil). */
export const MOOD_LABELS: Record<Exclude<Mood, "any">, string> = {
  light: "Léger",
  intense: "Intense",
  moving: "Émouvant",
  escape: "Évasion",
  think: "Réfléchir",
};

/** FR-3 : « en famille », il faut un de ces genres, et jamais l'horreur. */
export const FAMILY_GENRES = ["Family", "Animation", "Comedy", "Adventure", "Fantasy", "Kids"];
export const FAMILY_EXCLUDED = ["Horror"];

export type TonightCandidate = {
  type: "Movie" | "TV Series";
  isDocumentary: boolean;
  genres: string[];
  runtime: number | null;
};

/** FR-1 à FR-4 : ce titre convient-il à la soirée décrite ? */
export function matchesContext(candidate: TonightCandidate, context: TonightContext): boolean {
  const { format, mood, company, maxMinutes, genre } = context;

  if (format === "Documentary" && !candidate.isDocumentary) return false;
  if ((format === "Movie" || format === "TV Series") && (candidate.type !== format || candidate.isDocumentary)) {
    return false;
  }

  // Un genre précis : le titre doit le porter (un documentaire vaut « Documentary »).
  if (genre !== null && !candidate.genres.includes(genre) && !(genre === "Documentary" && candidate.isDocumentary)) {
    return false;
  }

  if (mood !== "any") {
    const wanted = MOOD_GENRES[mood];
    // « Réfléchir » : un documentaire convient, qu'il porte ou non le genre en toutes lettres.
    const moodOk = candidate.genres.some((g) => wanted.includes(g)) || (mood === "think" && candidate.isDocumentary);
    if (!moodOk) return false;
  }

  if (company === "family") {
    if (candidate.genres.some((g) => FAMILY_EXCLUDED.includes(g))) return false;
    if (!candidate.genres.some((g) => FAMILY_GENRES.includes(g))) return false;
  }

  // FR-4 : une série se regarde à l'épisode ; un film sans durée connue est gardé.
  if (maxMinutes !== null && candidate.type === "Movie" && candidate.runtime !== null && candidate.runtime > maxMinutes) {
    return false;
  }

  return true;
}

/**
 * EC-1 : le réglage qui élimine le plus de titres, pour savoir lequel proposer de relâcher.
 * Null si rien ne filtre (ou s'il n'y a aucun titre à évaluer).
 */
export type Relaxation = "mood" | "genre" | "format" | "maxMinutes" | "company";

export function mostRestrictive(candidates: TonightCandidate[], context: TonightContext): Relaxation | null {
  const relaxations: [Relaxation, TonightContext][] = [
    ["mood", { ...context, mood: "any" }],
    ["genre", { ...context, genre: null }],
    ["format", { ...context, format: "any" }],
    ["maxMinutes", { ...context, maxMinutes: null }],
    ["company", { ...context, company: "alone" }],
  ];
  let best: { key: Relaxation; gained: number } | null = null;
  for (const [key, relaxed] of relaxations) {
    if (JSON.stringify(relaxed) === JSON.stringify(context)) continue;
    const gained = candidates.filter((c) => matchesContext(c, relaxed)).length;
    if (gained > 0 && (!best || gained > best.gained)) best = { key, gained };
  }
  return best?.key ?? null;
}

/** Contexte lu d'une requête ou du stockage local, réglage par réglage (défaut sinon). */
export function parseContext(value: Record<string, unknown>): TonightContext {
  const pick = <T extends string>(raw: unknown, allowed: readonly T[], fallback: T): T =>
    allowed.includes(raw as T) ? (raw as T) : fallback;
  const minutes = Number(value.maxMinutes);
  const playlistId = Number(value.playlistId);
  const validPlaylist = Number.isInteger(playlistId) && playlistId > 0 ? playlistId : null;
  const source = pick(value.source, ["pile", "catalog", "playlist"] as const, DEFAULT_CONTEXT.source);
  return {
    mood: pick(value.mood, ["any", "light", "intense", "moving", "escape", "think"] as const, DEFAULT_CONTEXT.mood),
    format: pick(value.format, ["any", "Movie", "TV Series", "Documentary"] as const, DEFAULT_CONTEXT.format),
    maxMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
    company: pick(value.company, ["alone", "duo", "family"] as const, DEFAULT_CONTEXT.company),
    where: pick(value.where, ["services", "anywhere"] as const, DEFAULT_CONTEXT.where),
    // Une playlist sans identifiant n'a pas de sens : retour à la pile.
    source: source === "playlist" && validPlaylist === null ? "pile" : source,
    playlistId: source === "playlist" ? validPlaylist : null,
    genre: typeof value.genre === "string" && value.genre.trim() !== "" && value.genre.length <= 60 ? value.genre.trim() : null,
  };
}
