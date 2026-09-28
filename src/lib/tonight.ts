// Ce soir v2 : le contexte de la soirée — spec: specs/ce-soir-v2.md (FR-1 à FR-4)
//
// Module pur (aucun import) : partagé par le serveur, la page et les tests.

export type Mood = "any" | "light" | "intense" | "moving" | "escape" | "think";
export type Format = "any" | "Movie" | "TV Series" | "Documentary";
export type Company = "alone" | "duo" | "family";
export type Where = "services" | "anywhere";
export type Source = "pile" | "catalog";

export type TonightContext = {
  mood: Mood;
  format: Format;
  /** Films seulement (FR-4) ; null = sans limite. */
  maxMinutes: number | null;
  company: Company;
  where: Where;
  source: Source;
};

export const DEFAULT_CONTEXT: TonightContext = {
  mood: "any",
  format: "any",
  maxMinutes: null,
  company: "alone",
  where: "services",
  source: "pile",
};

/** FR-2 : genres TMDB (films et séries, noms anglais) de chaque envie. */
export const MOOD_GENRES: Record<Exclude<Mood, "any">, string[]> = {
  light: ["Comedy", "Animation", "Family", "Kids"],
  intense: ["Thriller", "Action", "Crime", "Horror", "Mystery", "Action & Adventure"],
  moving: ["Drama", "Romance"],
  escape: ["Science Fiction", "Fantasy", "Adventure", "Sci-Fi & Fantasy", "Action & Adventure"],
  think: ["Documentary", "History", "War", "War & Politics"],
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
  const { format, mood, company, maxMinutes } = context;

  if (format === "Documentary" && !candidate.isDocumentary) return false;
  if ((format === "Movie" || format === "TV Series") && (candidate.type !== format || candidate.isDocumentary)) {
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
export function mostRestrictive(
  candidates: TonightCandidate[],
  context: TonightContext
): "mood" | "format" | "maxMinutes" | "company" | null {
  const relaxations: ["mood" | "format" | "maxMinutes" | "company", TonightContext][] = [
    ["mood", { ...context, mood: "any" }],
    ["format", { ...context, format: "any" }],
    ["maxMinutes", { ...context, maxMinutes: null }],
    ["company", { ...context, company: "alone" }],
  ];
  let best: { key: "mood" | "format" | "maxMinutes" | "company"; gained: number } | null = null;
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
  return {
    mood: pick(value.mood, ["any", "light", "intense", "moving", "escape", "think"] as const, DEFAULT_CONTEXT.mood),
    format: pick(value.format, ["any", "Movie", "TV Series", "Documentary"] as const, DEFAULT_CONTEXT.format),
    maxMinutes: Number.isFinite(minutes) && minutes > 0 ? minutes : null,
    company: pick(value.company, ["alone", "duo", "family"] as const, DEFAULT_CONTEXT.company),
    where: pick(value.where, ["services", "anywhere"] as const, DEFAULT_CONTEXT.where),
    source: pick(value.source, ["pile", "catalog"] as const, DEFAULT_CONTEXT.source),
  };
}
