import type Database from "better-sqlite3";
import { RATING_RANK_SQL } from "./itemService";
import { creditsOf, type PersonRole } from "./personCredits";
import { posterUrl, type TmdbFeatures } from "./tmdb";

// Vue Personnes — spec: specs/classement-v1.md (FR-6, AC-8)

export type PersonView = {
  id: number;
  name: string;
  photoUrl: string | null;
  opinion: 1 | -1;
  /** Note de 0 (💩) à 5 d'une personne aimée (classement-v1 FR-13). */
  rating: number | null;
  roles: PersonRole[];
  /** Tes titres vus où elle figure, les mieux notés d'abord. */
  seen: { id: number; name: string; stars: number | null }[];
  /** Moyenne de tes notes sur ces titres (💩 = 0) ; null si aucun n'est noté. */
  averageStars: number | null;
  /** Ses titres dans ta pile à voir. */
  toWatch: { id: number; name: string; year: string | null; posterUrl: string | null }[];
  /** Elo des duels d'acteurs, s'il a servi. */
  duelElo: number | null;
  updatedAt: string;
};

type Row = {
  id: number;
  name: string;
  year: string | null;
  poster_path: string | null;
  watch_status: string | null;
  stars: number | null;
  tmdb_features: string;
};

/** Les personnes sur lesquelles tu as donné un avis, avec ce que ta bibliothèque dit d'elles. */
export function getPeopleWithOpinions(db: Database.Database): PersonView[] {
  const opinions = db
    .prepare(`SELECT person_id, name, opinion, rating, updated_at FROM person_opinions`)
    .all() as { person_id: number; name: string; opinion: 1 | -1; rating: number | null; updated_at: string }[];
  if (opinions.length === 0) return [];

  const views = new Map<number, PersonView & { roleSet: Set<PersonRole> }>(
    opinions.map((o) => [
      o.person_id,
      {
        id: o.person_id,
        name: o.name,
        photoUrl: null,
        opinion: o.opinion,
        rating: o.opinion === 1 ? o.rating : null,
        roles: [],
        roleSet: new Set<PersonRole>(),
        seen: [],
        averageStars: null,
        toWatch: [],
        duelElo: null,
        updatedAt: o.updated_at,
      },
    ])
  );

  const rows = db
    .prepare(
      `SELECT id, name, year, poster_path, watch_status, ${RATING_RANK_SQL} AS stars, tmdb_features
       FROM items WHERE tmdb_features IS NOT NULL`
    )
    .all() as Row[];

  for (const row of rows) {
    let features: TmdbFeatures;
    try {
      features = JSON.parse(row.tmdb_features) as TmdbFeatures;
    } catch {
      continue;
    }
    // Une même personne peut être créditée deux fois (actrice et productrice) : un titre, une fois.
    const counted = new Set<number>();
    for (const [role, people] of creditsOf(features)) {
      for (const person of people) {
        const view = views.get(person.id);
        if (!view) continue;
        view.roleSet.add(role);
        view.photoUrl ??= posterUrl(person.profilePath);
        if (counted.has(person.id)) continue;
        counted.add(person.id);
        if (row.watch_status === "Watched") {
          view.seen.push({ id: row.id, name: row.name, stars: row.stars });
        } else {
          view.toWatch.push({ id: row.id, name: row.name, year: row.year, posterUrl: posterUrl(row.poster_path) });
        }
      }
    }
  }

  const elos = new Map(
    (
      db.prepare(`SELECT id, elo_score FROM people WHERE duels_count > 0`).all() as {
        id: number;
        elo_score: number;
      }[]
    ).map((p) => [p.id, p.elo_score])
  );

  return [...views.values()].map(({ roleSet, ...view }) => {
    const rated = view.seen.filter((t) => t.stars !== null).map((t) => t.stars as number);
    return {
      ...view,
      roles: (["cast", "director", "producer"] as PersonRole[]).filter((r) => roleSet.has(r)),
      seen: [...view.seen].sort((a, b) => (b.stars ?? -1) - (a.stars ?? -1)),
      averageStars: rated.length > 0 ? rated.reduce((sum, s) => sum + s, 0) / rated.length : null,
      duelElo: elos.get(view.id) ?? null,
    };
  });
}
