import type Database from "better-sqlite3";
import type { Availability } from "./availability";
import type { ReleaseInfo } from "./release";
import type { Trailer } from "./trailer";
import { getDiscoveries } from "./discoveryService";
import { dismiss, tmdbKey, undismiss } from "./dismissalService";
import { categoryFilter, getItemsByIds, RATING_RANK_SQL, RATING_SCALE, updateItem } from "./itemService";
import { logEvent } from "./journalService";
import { addTitleToLibrary, removeFromLibrary, type ActionError } from "./libraryActions";
import type { Category } from "./libraryItem";
import { creditsOf, type PersonRole } from "./personCredits";
import { clearOpinion, setOpinion } from "./personOpinionService";
import { posterUrl, type TmdbFeatures } from "./tmdb";

// Tri rapide — spec: specs/tri-rapide-v1.md (FR-3, FR-4, FR-6)

export type TriageFamily = "unseen" | "seen" | "person";
export type TriageAnswer = "like" | "dislike" | "skip";
export type { PersonRole };

export type UnseenCard = {
  family: "unseen";
  key: string;
  tmdbId: number;
  mediaType: "Movie" | "TV Series";
  title: string;
  year: string | null;
  posterUrl: string | null;
  overview: string;
  voteAverage: number | null;
  voteCount: number | null;
  seeds: string[];
  availability: Availability | null;
  /** Score de recommandation : probabilité que tu le notes ⭐⭐⭐⭐ ou plus. */
  compatibility: number | null;
  release: ReleaseInfo | null;
  trailer: Trailer | null;
};

export type SeenCard = {
  family: "seen";
  key: string;
  id: number;
  title: string;
  year: string | null;
  posterUrl: string | null;
  overview: string | null;
  category: Category;
  trailer: Trailer | null;
};

export type PersonCard = {
  family: "person";
  key: string;
  id: number;
  name: string;
  photoUrl: string | null;
  roles: PersonRole[];
  /** Titres vus où tu l'as croisé, les mieux notés d'abord. */
  seenIn: string[];
};

export type TriageCard = UnseenCard | SeenCard | PersonCard;

/** Comme pour les duels d'acteurs : une préférence doit reposer sur une vraie exposition. */
const MIN_TITLES_PER_PERSON = 3;
/** FR-4 : note grossière posée par le tri d'un titre déjà vu, à affiner ensuite. */
export const SEEN_LIKE_RATING = RATING_SCALE[4];
export const SEEN_DISLIKE_RATING = RATING_SCALE[2];

// ---------- cartes ----------

async function unseenCards(
  db: Database.Database,
  category: Category | undefined,
  limit: number,
  exclude: Set<string>
): Promise<UnseenCard[]> {
  // Les semences sont tirées au hasard : chaque lot diffère, mais peut recroiser une carte passée.
  const result = await getDiscoveries(db, { category, limit: Math.min(limit + exclude.size, 60) });
  if ("error" in result) return [];
  return result.items
    .filter((d) => !exclude.has(`${d.type}:${d.tmdbId}`))
    .slice(0, limit)
    .map((d) => ({
    family: "unseen",
    key: `${d.type}:${d.tmdbId}`,
    tmdbId: d.tmdbId,
    mediaType: d.type,
    title: d.title,
    year: d.year,
    posterUrl: d.posterUrl,
    overview: d.overview,
    voteAverage: d.voteAverage,
    voteCount: d.voteCount,
    seeds: d.seeds,
    availability: d.availability,
    compatibility: d.compatibility,
    release: d.release,
    trailer: d.trailer,
    }));
}

function seenCards(
  db: Database.Database,
  category: Category | undefined,
  limit: number,
  exclude: Set<string>
): SeenCard[] {
  const filter = categoryFilter(category);
  // Sans cela, un lot fait uniquement de cartes passées paraîtrait épuisé alors qu'il en reste.
  const skipped = [...exclude].filter((k) => k.startsWith("item:")).map((k) => Number(k.slice(5)));
  const notSkipped = skipped.length > 0 ? ` AND id NOT IN (${skipped.map(() => "?").join(",")})` : "";
  const ids = (
    db
      .prepare(
        `SELECT id FROM items
         WHERE watch_status = 'Watched' AND rating IS NULL${filter.sql}${notSkipped}
         ORDER BY updated_at DESC, id DESC LIMIT ?`
      )
      .all(...filter.params, ...skipped, limit) as { id: number }[]
  ).map((r) => r.id);

  return getItemsByIds(db, ids).map((item) => ({
    family: "seen",
    key: `item:${item.id}`,
    id: item.id,
    title: item.name,
    year: item.year,
    posterUrl: item.posterUrl,
    overview: item.overview,
    category: item.category,
    trailer: item.trailer,
  }));
}

/**
 * Personnes présentes dans au moins 3 titres vus, tous rôles confondus, sans avis encore. Les
 * plus présentes d'abord : ce sont les plus reconnaissables, et celles dont l'avis pèsera le plus.
 */
function personCards(db: Database.Database, limit: number, exclude: Set<string>): PersonCard[] {
  const rows = db
    .prepare(
      `SELECT name, ${RATING_RANK_SQL} AS stars, tmdb_features FROM items
       WHERE watch_status = 'Watched' AND tmdb_features IS NOT NULL`
    )
    .all() as { name: string; stars: number | null; tmdb_features: string }[];

  const people = new Map<
    number,
    { name: string; profilePath: string | null; roles: Set<PersonRole>; titles: Map<string, number> }
  >();
  for (const row of rows) {
    let features: TmdbFeatures;
    try {
      features = JSON.parse(row.tmdb_features) as TmdbFeatures;
    } catch {
      continue;
    }
    for (const [role, list] of creditsOf(features)) {
      for (const person of list) {
        const entry = people.get(person.id) ?? {
          name: person.name,
          profilePath: person.profilePath,
          roles: new Set<PersonRole>(),
          titles: new Map<string, number>(),
        };
        entry.roles.add(role);
        entry.profilePath ??= person.profilePath;
        entry.titles.set(row.name, row.stars ?? -1);
        people.set(person.id, entry);
      }
    }
  }

  const answered = new Set(
    (db.prepare(`SELECT person_id FROM person_opinions`).all() as { person_id: number }[]).map(
      (r) => r.person_id
    )
  );

  return [...people]
    .filter(
      ([id, p]) =>
        !answered.has(id) && !exclude.has(`person:${id}`) && p.titles.size >= MIN_TITLES_PER_PERSON
    )
    .sort((a, b) => b[1].titles.size - a[1].titles.size)
    .slice(0, limit)
    .map(([id, p]) => ({
      family: "person",
      key: `person:${id}`,
      id,
      name: p.name,
      photoUrl: posterUrl(p.profilePath),
      roles: (["cast", "director", "producer"] as PersonRole[]).filter((r) => p.roles.has(r)),
      seenIn: [...p.titles].sort((a, b) => b[1] - a[1]).map(([title]) => title),
    }));
}

/**
 * Un lot de cartes d'une famille. `exclude` = clés des cartes déjà montrées dans la session
 * (surtout les passées, qui n'ont laissé aucune trace et reviendraient sinon).
 */
export async function getTriageBatch(
  db: Database.Database,
  family: TriageFamily,
  options: { category?: Category; limit?: number; exclude?: Iterable<string> } = {}
): Promise<TriageCard[]> {
  const limit = options.limit ?? 20;
  const exclude = new Set(options.exclude ?? []);
  if (family === "unseen") return unseenCards(db, options.category, limit, exclude);
  if (family === "seen") return seenCards(db, options.category, limit, exclude);
  return personCards(db, limit, exclude);
}

// ---------- réponses et annulation (FR-4, FR-6) ----------

/** Ce qu'il faut savoir d'une carte pour appliquer une réponse : une carte complète convient. */
export type TriageSubject =
  | { family: "unseen"; tmdbId: number; mediaType: "Movie" | "TV Series" }
  | { family: "seen"; id: number }
  | { family: "person"; id: number; name: string };

/** De quoi défaire exactement une réponse. */
export type TriageUndo =
  | { kind: "none" }
  | { kind: "remove"; itemId: number }
  | { kind: "undismiss"; mediaType: "Movie" | "TV Series"; tmdbId: number }
  | { kind: "rating"; itemId: number; previous: string | null }
  | { kind: "opinion"; personId: number; name: string; previous: 1 | -1 | null };

export async function answerTriage(
  db: Database.Database,
  card: TriageSubject,
  answer: TriageAnswer
): Promise<{ undo: TriageUndo } | { error: ActionError }> {
  if (card.family === "unseen") {
    logEvent(db, "triage", "tmdb", tmdbKey(card.mediaType, card.tmdbId), { family: card.family, answer });
  } else {
    logEvent(db, "triage", card.family === "seen" ? "item" : "person", card.id, { family: card.family, answer });
  }

  // FR-4 : « passer » n'a aucun effet, sinon le journal.
  if (answer === "skip") return { undo: { kind: "none" } };

  if (card.family === "unseen") {
    if (answer === "like") {
      const result = await addTitleToLibrary(db, card.tmdbId, card.mediaType, "triage");
      if ("error" in result) return result;
      // Un titre déjà présent n'est pas « défait » : il était là avant la réponse.
      return { undo: result.alreadyExists ? { kind: "none" } : { kind: "remove", itemId: result.item.id } };
    }
    dismiss(db, { type: "tmdb", mediaType: card.mediaType, tmdbId: card.tmdbId });
    return { undo: { kind: "undismiss", mediaType: card.mediaType, tmdbId: card.tmdbId } };
  }

  if (card.family === "seen") {
    const previous = (
      db.prepare(`SELECT rating FROM items WHERE id = ?`).get(card.id) as { rating: string | null } | undefined
    )?.rating ?? null;
    updateItem(db, card.id, { rating: answer === "like" ? SEEN_LIKE_RATING : SEEN_DISLIKE_RATING });
    return { undo: { kind: "rating", itemId: card.id, previous } };
  }

  const previous =
    (db.prepare(`SELECT opinion FROM person_opinions WHERE person_id = ?`).get(card.id) as
      | { opinion: 1 | -1 }
      | undefined)?.opinion ?? null;
  setOpinion(db, { id: card.id, name: card.name }, answer === "like" ? 1 : -1);
  return { undo: { kind: "opinion", personId: card.id, name: card.name, previous } };
}

export async function undoTriage(
  db: Database.Database,
  undo: TriageUndo
): Promise<{ ok: true } | { error: ActionError }> {
  switch (undo.kind) {
    case "none":
      return { ok: true };
    case "remove":
      return removeFromLibrary(db, undo.itemId);
    case "undismiss":
      undismiss(db, { type: "tmdb", mediaType: undo.mediaType, tmdbId: undo.tmdbId });
      return { ok: true };
    case "rating":
      updateItem(db, undo.itemId, { rating: undo.previous });
      return { ok: true };
    case "opinion":
      if (undo.previous === null) clearOpinion(db, undo.personId);
      else setOpinion(db, { id: undo.personId, name: undo.name }, undo.previous);
      return { ok: true };
  }
}

// ---------- validation des corps de requête ----------

const isId = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v) && v > 0;
const isMediaType = (v: unknown): v is "Movie" | "TV Series" => v === "Movie" || v === "TV Series";

export function parseTriageSubject(value: unknown): TriageSubject | null {
  const v = value as Record<string, unknown> | null;
  if (v?.family === "unseen" && isId(v.tmdbId) && isMediaType(v.mediaType)) {
    return { family: "unseen", tmdbId: v.tmdbId, mediaType: v.mediaType };
  }
  if (v?.family === "seen" && isId(v.id)) return { family: "seen", id: v.id };
  if (v?.family === "person" && isId(v.id) && typeof v.name === "string") {
    return { family: "person", id: v.id, name: v.name };
  }
  return null;
}

export function parseTriageUndo(value: unknown): TriageUndo | null {
  const v = value as Record<string, unknown> | null;
  switch (v?.kind) {
    case "none":
      return { kind: "none" };
    case "remove":
      return isId(v.itemId) ? { kind: "remove", itemId: v.itemId } : null;
    case "undismiss":
      return isId(v.tmdbId) && isMediaType(v.mediaType)
        ? { kind: "undismiss", mediaType: v.mediaType, tmdbId: v.tmdbId }
        : null;
    case "rating":
      return isId(v.itemId) &&
        (v.previous === null || (RATING_SCALE as readonly unknown[]).includes(v.previous))
        ? { kind: "rating", itemId: v.itemId, previous: v.previous as string | null }
        : null;
    case "opinion":
      return isId(v.personId) &&
        typeof v.name === "string" &&
        (v.previous === null || v.previous === 1 || v.previous === -1)
        ? { kind: "opinion", personId: v.personId, name: v.name, previous: v.previous }
        : null;
    default:
      return null;
  }
}
