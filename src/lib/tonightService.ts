import type Database from "better-sqlite3";
import type { Availability } from "./availability";
import { externalTitleData } from "./discoveryService";
import { NOT_DISMISSED_ITEM, dismissedTmdbKeys, tmdbKey } from "./dismissalService";
import { getItemsByIds, getLibraryInfoByTmdbIds, onServicesCondition } from "./itemService";
import type { WatchStatus } from "./libraryItem";
import type { ModelTitle } from "./preferenceModel";
import { getOpinionWeights } from "./personOpinionService";
import { personBonus } from "./personPreference";
import { featuresToTitle, getCompatibility, loadModelTitles, rankTitles } from "./preferenceService";
import type { ReleaseInfo } from "./release";
import type { Trailer } from "./trailer";
import { discoverForTonight, posterUrl, type TmdbSearchResult } from "./tmdb";
import {
  FAMILY_GENRES,
  MOOD_GENRES,
  matchesContext,
  mostRestrictive,
  type TonightCandidate,
  type TonightContext,
} from "./tonight";

// Ce soir v2 — spec: specs/ce-soir-v2.md (FR-5, NFR-1, EC-1 à EC-3)

export type TonightPick = {
  key: string;
  tmdbId: number | null;
  libraryId: number | null;
  libraryStatus: WatchStatus | null;
  type: "Movie" | "TV Series";
  isDocumentary: boolean;
  title: string;
  year: string | null;
  posterUrl: string | null;
  overview: string;
  runtime: number | null;
  genres: string[];
  voteAverage: number | null;
  voteCount: number | null;
  compatibility: number | null;
  /** Pourquoi ce titre : un titre aimé qui lui ressemble. */
  reason: string | null;
  availability: Availability | null;
  release: ReleaseInfo | null;
  trailer: Trailer | null;
};

export type TonightResult = {
  picks: TonightPick[];
  /** Titres qui correspondent au contexte, avant de garder les meilleurs. */
  matched: number;
  /** EC-1 : le réglage à relâcher quand rien ne correspond. */
  relax: "mood" | "format" | "maxMinutes" | "company" | null;
  /** EC-3 : TMDB n'a rien renvoyé pour « tout le catalogue ». */
  catalogUnavailable: boolean;
  baseRate: number | null;
};

const MAX_PICKS = 24;
const CATALOG_PAGES = 2;
/** Fiches TMDB demandées au plus (gardées 7 jours) : les plus populaires qui correspondent. */
const CATALOG_DETAILS = 36;
const CONCURRENCY = 8;

async function inParallel<T>(items: T[], work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, items.length) }, async () => {
      while (next < items.length) await work(items[next++]);
    })
  );
}

function reasonOf(neighbours: { name: string }[]): string | null {
  return neighbours[0] ? `Proche de ${neighbours[0].name}` : null;
}

// ---------- ma pile (local, NFR-1) ----------

function fromPile(db: Database.Database, context: TonightContext, covered: number[]): TonightResult {
  const conditions = [`watch_status = 'Unwatched'`, NOT_DISMISSED_ITEM];
  const params: (string | number)[] = [];
  if (context.where === "services" && covered.length > 0) {
    const services = onServicesCondition(covered);
    conditions.push(services.sql);
    params.push(...services.params);
  }

  const titles = loadModelTitles(db, conditions.join(" AND "), params);
  const items = new Map(getItemsByIds(db, titles.map((t) => t.id)).map((item) => [item.id, item]));
  const candidateOf = (t: ModelTitle): TonightCandidate => {
    const item = items.get(t.id)!;
    return { type: item.type, isDocumentary: item.category === "Documentary", genres: t.genres, runtime: t.runtime };
  };

  const matching = titles.filter((t) => items.has(t.id) && matchesContext(candidateOf(t), context));
  const opinions = getOpinionWeights(db);
  const ranked = rankTitles(db, matching, (title) => personBonus(title.people ?? [], opinions)).sort(
    (a, b) => b.score - a.score
  );
  const byId = new Map(matching.map((t) => [t.id, t]));

  return {
    picks: ranked.slice(0, MAX_PICKS).map((s) => {
      const item = items.get(s.id)!;
      const title = byId.get(s.id)!;
      return {
        key: `item:${item.id}`,
        tmdbId: null,
        libraryId: item.id,
        libraryStatus: item.watchStatus,
        type: item.type,
        isDocumentary: item.category === "Documentary",
        title: item.name,
        year: item.year,
        posterUrl: item.posterUrl,
        overview: item.overview ?? "",
        runtime: title.runtime,
        genres: title.genres,
        voteAverage: item.voteAverage,
        voteCount: item.voteCount,
        compatibility: s.compatibility,
        reason: reasonOf(s.neighbours),
        availability: item.availability,
        release: item.release,
        trailer: item.trailer,
      };
    }),
    matched: matching.length,
    relax: matching.length === 0 ? mostRestrictive(titles.map(candidateOf), context) : null,
    catalogUnavailable: false,
    baseRate: getCompatibility(db)?.baseRate ?? null,
  };
}

// ---------- tout le catalogue ----------

async function fromCatalog(db: Database.Database, context: TonightContext, covered: number[]): Promise<TonightResult> {
  const kinds: ("Movie" | "TV Series")[] =
    context.format === "Movie" ? ["Movie"] : context.format === "TV Series" ? ["TV Series"] : ["Movie", "TV Series"];
  // Dégrossir côté TMDB : les genres de l'envie (ou de la soirée en famille), le documentaire.
  const genreNames =
    context.format === "Documentary"
      ? ["Documentary"]
      : context.mood !== "any"
        ? MOOD_GENRES[context.mood]
        : context.company === "family"
          ? FAMILY_GENRES
          : null;
  const providerIds = context.where === "services" && covered.length > 0 ? covered : null;

  const pages = await Promise.all(
    kinds.flatMap((kind) =>
      Array.from({ length: CATALOG_PAGES }, (_, i) =>
        discoverForTonight(kind, { genreNames, maxMinutes: context.maxMinutes, providerIds, page: i + 1 })
      )
    )
  );
  const found = pages.flat();
  if (found.length === 0) {
    return { picks: [], matched: 0, relax: null, catalogUnavailable: true, baseRate: getCompatibility(db)?.baseRate ?? null };
  }

  // Hors titres vus et titres écartés ; un titre de ta pile est gardé, et signalé.
  const library = getLibraryInfoByTmdbIds(db, found.map((r) => r.tmdbId));
  const dismissed = dismissedTmdbKeys(db);
  const seen = new Set<string>();
  const firstPass = found.filter((r) => {
    const key = tmdbKey(r.type, r.tmdbId);
    if (seen.has(key) || dismissed.has(key)) return false;
    seen.add(key);
    if (library.get(r.tmdbId)?.watchStatus === "Watched") return false;
    return matchesContext({ type: r.type, isDocumentary: r.isDocumentary, genres: r.genres, runtime: null }, context);
  });

  const head = firstPass.slice(0, CATALOG_DETAILS);
  const details = new Map<string, Awaited<ReturnType<typeof externalTitleData>>>();
  await inParallel(head, async (r) => {
    details.set(tmdbKey(r.type, r.tmdbId), await externalTitleData(r.tmdbId, r.type));
  });

  // Durée connue maintenant : on revérifie (FR-4).
  const matching: { result: TmdbSearchResult; title: ModelTitle; runtime: number | null }[] = [];
  for (const r of head) {
    const data = details.get(tmdbKey(r.type, r.tmdbId));
    if (!data) continue;
    const runtime = data.features.runtime;
    if (!matchesContext({ type: r.type, isDocumentary: r.isDocumentary, genres: data.features.genres, runtime }, context)) {
      continue;
    }
    matching.push({ result: r, title: featuresToTitle(-matching.length - 1, r.title, data.features), runtime });
  }

  const opinions = getOpinionWeights(db);
  const ranked = rankTitles(
    db,
    matching.map((m) => m.title),
    (title) => personBonus(title.people ?? [], opinions)
  ).sort((a, b) => b.score - a.score);
  const byTitleId = new Map(matching.map((m) => [m.title.id, m]));

  return {
    picks: ranked.slice(0, MAX_PICKS).map((s) => {
      const { result: r, runtime } = byTitleId.get(s.id)!;
      const data = details.get(tmdbKey(r.type, r.tmdbId))!;
      const inLibrary = library.get(r.tmdbId) ?? null;
      return {
        key: tmdbKey(r.type, r.tmdbId),
        tmdbId: r.tmdbId,
        libraryId: inLibrary?.id ?? null,
        libraryStatus: inLibrary?.watchStatus ?? null,
        type: r.type,
        isDocumentary: r.isDocumentary,
        title: r.title,
        year: r.year,
        posterUrl: posterUrl(r.posterPath),
        overview: r.overview,
        runtime,
        genres: data.features.genres,
        voteAverage: r.voteAverage,
        voteCount: r.voteCount,
        compatibility: s.compatibility,
        reason: reasonOf(s.neighbours),
        availability: data.availability,
        release: data.release,
        trailer: data.trailer.trailer,
      };
    }),
    matched: matching.length,
    relax: null,
    catalogUnavailable: false,
    baseRate: getCompatibility(db)?.baseRate ?? null,
  };
}

/** FR-5 : les propositions de la soirée, les plus compatibles d'abord. */
export async function getTonight(
  db: Database.Database,
  context: TonightContext,
  coveredServices: number[]
): Promise<TonightResult> {
  return context.source === "pile"
    ? fromPile(db, context, coveredServices)
    : fromCatalog(db, context, coveredServices);
}
