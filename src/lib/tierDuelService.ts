import type Database from "better-sqlite3";
import { parseGenres } from "./genres";
import { DEFAULT_ELO, K_FACTOR } from "./elo";
import { categoryFilter, RATING_SCALE } from "./itemService";
import { displayYear, type Category } from "./libraryItem";
import { posterUrl } from "./tmdb";

// Classement par étoiles et départage — spec: specs/classement-v1.md (FR-2 à FR-11)

/** Un palier = un nombre d'étoiles, 0 pour 💩 (index dans RATING_SCALE). */
export type Stars = 0 | 1 | 2 | 3 | 4 | 5;

/** FR-9 : 0 = Bas, 1 = Milieu, 2 = Haut du palier. */
export type Band = 0 | 1 | 2;

export function parseStars(value: unknown): Stars | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 0 && n <= 5 ? (n as Stars) : null;
}

export function parseBand(value: unknown): Band | null {
  return value === 0 || value === 1 || value === 2 ? value : null;
}

/**
 * FR-7 : un titre est départagé après ce nombre de comparaisons dans son palier (duels v1 et
 * quatuors comptent pareil). Avec des adversaires proches en score, c'est assez pour le situer.
 */
export const TIER_SETTLED_DUELS = 5;
/** FR-8 : à partir de cette taille (dans la catégorie choisie), on répartit avant d'affiner. */
export const BAND_MIN_TITLES = 60;
/**
 * FR-10 : titres montrés à la fois. Deux (un duel) depuis le 2026-09-28 : quatre titres à
 * classer d'un coup demandaient trop d'effort (décision de l'utilisateur).
 */
export const QUAD_SIZE = 2;

/**
 * FR-4 : les données de départage (score, comparaisons, groupe) ne valent que pour la note à
 * laquelle elles ont été établies. Si la note a changé, le titre repart de zéro.
 */
const TIER_VALID = `tier_rating = rating`;

type Member = { id: number; comparisons: number; score: number; band: Band | null };

function tierMembers(db: Database.Database, stars: Stars, category?: Category): Member[] {
  const filter = categoryFilter(category);
  return db
    .prepare(
      `SELECT id,
              CASE WHEN ${TIER_VALID} THEN tier_duels_count ELSE 0 END comparisons,
              CASE WHEN ${TIER_VALID} THEN tier_elo ELSE ${DEFAULT_ELO} END score,
              CASE WHEN ${TIER_VALID} THEN tier_band END band
       FROM items WHERE watch_status = 'Watched' AND rating = ?${filter.sql}`
    )
    .all(RATING_SCALE[stars], ...filter.params) as Member[];
}

export type TierItem = {
  id: number;
  name: string;
  year: string | null;
  /** Genres TMDB, en anglais (affichés avec `genreLabel`). */
  genres: string[];
  posterUrl: string | null;
  /** Score de palier ; null tant que le titre n'a pas été comparé dans ce palier. */
  tierScore: number | null;
  comparisons: number;
  band: Band | null;
};

export type TierScope = {
  titles: number;
  /** Titres qui ont au moins une comparaison (ils ont un rang). */
  compared: number;
  /** Titres départagés (FR-7). */
  settled: number;
  /** FR-8 : le palier passe par la répartition. */
  banded: boolean;
  /** Titres déjà répartis (FR-9). */
  placed: number;
};

export type TierStep =
  | { step: "band"; item: TierItem; scope: TierScope }
  | {
      step: "quad";
      items: TierItem[];
      /** Groupe affiné (FR-11) ; null pour un palier non réparti. */
      group: Band | null;
      groupScope: { titles: number; settled: number };
      scope: TierScope;
    }
  /** FR-7 : palier départagé ; `nextTier` = palier suivant qui reste à départager. */
  | { step: "done"; scope: TierScope; nextTier: Stars | null }
  | { error: "not_enough_titles"; eligibleCount: number };

function scopeOf(members: Member[]): TierScope {
  return {
    titles: members.length,
    compared: members.filter((m) => m.comparisons > 0).length,
    settled: members.filter((m) => m.comparisons >= TIER_SETTLED_DUELS).length,
    banded: members.length >= BAND_MIN_TITLES,
    placed: members.filter((m) => m.band !== null).length,
  };
}

function isUnfinished(members: Member[]): boolean {
  if (members.length < 2) return false;
  if (members.length >= BAND_MIN_TITLES && members.some((m) => m.band === null)) return true;
  return members.some((m) => m.comparisons < TIER_SETTLED_DUELS);
}

/** Palier suivant (du plus haut au plus bas, après celui-ci puis en reprenant du haut) à finir. */
function nextUnsettledTier(db: Database.Database, stars: Stars, category?: Category): Stars | null {
  const order = [5, 4, 3, 2, 1, 0].filter((s) => s !== stars) as Stars[];
  const after = [...order.filter((s) => s < stars), ...order.filter((s) => s > stars)];
  for (const candidate of after) {
    if (isUnfinished(tierMembers(db, candidate, category))) return candidate;
  }
  return null;
}

function toItems(db: Database.Database, members: Member[]): TierItem[] {
  const get = db.prepare(`SELECT name, year, genre, poster_path FROM items WHERE id = ?`);
  return members.map((m) => {
    const row = get.get(m.id) as { name: string; year: string | null; genre: string | null; poster_path: string | null };
    return {
      id: m.id,
      name: row.name,
      year: displayYear(row.year),
      genres: parseGenres(row.genre),
      posterUrl: posterUrl(row.poster_path),
      tierScore: m.comparisons > 0 ? m.score : null,
      comparisons: m.comparisons,
      band: m.band,
    };
  });
}

/**
 * FR-10 : un quatuor d'un groupe. L'ancre est prise parmi les titres les moins comparés ; ses
 * partenaires sont proches d'elle en score (départager ce qui est serré), de préférence pas encore
 * départagés, avec un peu de hasard pour ne pas revoir toujours les mêmes voisins.
 */
export function pickQuad<T extends { comparisons: number; score: number }>(
  group: T[],
  rng: () => number = Math.random,
  { onlyUnsettled = true, size = QUAD_SIZE }: { onlyUnsettled?: boolean; size?: number } = {}
): T[] {
  if (group.length <= size) return [...group].sort(() => rng() - 0.5);

  const unsettled = group.filter((m) => m.comparisons < TIER_SETTLED_DUELS);
  const anchorPool = onlyUnsettled && unsettled.length > 0 ? unsettled : group;
  const weights = anchorPool.map((m) => 1 / (m.comparisons + 1));
  let r = rng() * weights.reduce((a, b) => a + b, 0);
  let anchor = anchorPool[anchorPool.length - 1];
  for (let i = 0; i < anchorPool.length; i++) {
    r -= weights[i];
    if (r <= 0) {
      anchor = anchorPool[i];
      break;
    }
  }

  const partners = group
    .filter((m) => m !== anchor)
    .map((m) => ({
      m,
      key:
        Math.abs(m.score - anchor.score) / 100 +
        (m.comparisons >= TIER_SETTLED_DUELS ? 0.5 : 0) +
        rng() * 0.8,
    }))
    .sort((a, b) => a.key - b.key)
    .slice(0, size - 1)
    .map((p) => p.m);

  return [anchor, ...partners].sort(() => rng() - 0.5);
}

/**
 * FR-8 à FR-11 : la prochaine étape du départage. Palier de 60 titres ou plus : répartir d'abord
 * chaque titre, puis affiner le Haut, le Milieu, le Bas. Plus petit : directement les quatuors.
 * `refine` : le palier est départagé, on affine quand même.
 */
export function getTierStep(
  db: Database.Database,
  stars: Stars,
  category?: Category,
  rng: () => number = Math.random,
  { refine = false }: { refine?: boolean } = {}
): TierStep {
  const members = tierMembers(db, stars, category);
  if (members.length < 2) return { error: "not_enough_titles", eligibleCount: members.length };
  const scope = scopeOf(members);

  if (scope.banded) {
    const unplaced = members.filter((m) => m.band === null);
    if (unplaced.length > 0) {
      const next = unplaced[Math.floor(rng() * unplaced.length)];
      return { step: "band", item: toItems(db, [next])[0], scope };
    }
  }

  // FR-11 : le Haut d'abord. Un palier non réparti forme un seul groupe.
  const groups: { band: Band | null; members: Member[] }[] = scope.banded
    ? ([2, 1, 0] as Band[]).map((band) => ({ band, members: members.filter((m) => m.band === band) }))
    : [{ band: null, members }];
  const open = groups.find(
    (g) => g.members.length >= 2 && g.members.some((m) => m.comparisons < TIER_SETTLED_DUELS)
  );

  if (!open && !refine) return { step: "done", scope, nextTier: nextUnsettledTier(db, stars, category) };

  // Affiner encore : un groupe au hasard parmi ceux qui ont de quoi comparer.
  const playable = groups.filter((g) => g.members.length >= 2);
  const group = open ?? playable[Math.floor(rng() * playable.length)];
  const quad = pickQuad(group.members, rng, { onlyUnsettled: !!open });
  return {
    step: "quad",
    items: toItems(db, quad),
    group: group.band,
    groupScope: {
      titles: group.members.length,
      settled: group.members.filter((m) => m.comparisons >= TIER_SETTLED_DUELS).length,
    },
    scope,
  };
}

// ---------- réponses, et leur annulation (FR-1, FR-9, FR-10) ----------

type TierState = { elo: number; count: number; band: Band | null; rating: string | null };
type RoundPayload = { items: { id: number; before: TierState; after: TierState }[] };

type ItemRow = {
  id: number;
  rating: string | null;
  watch_status: string | null;
  tier_rating: string | null;
  tier_elo: number;
  tier_duels_count: number;
  tier_band: number | null;
};

function readRows(db: Database.Database, ids: number[]): Map<number, ItemRow> {
  const get = db.prepare(
    `SELECT id, rating, watch_status, tier_rating, tier_elo, tier_duels_count, tier_band FROM items WHERE id = ?`
  );
  const rows = new Map<number, ItemRow>();
  for (const id of ids) {
    const row = get.get(id) as ItemRow | undefined;
    if (row) rows.set(id, row);
  }
  return rows;
}

const stateOf = (row: ItemRow): TierState => ({
  elo: row.tier_elo,
  count: row.tier_duels_count,
  band: row.tier_band as Band | null,
  rating: row.tier_rating,
});

/** État de départage effectif pour la note du palier : ce qui vaut pour une autre note repart de zéro. */
function effective(row: ItemRow, rating: string): TierState {
  return row.tier_rating === rating
    ? stateOf(row)
    : { elo: DEFAULT_ELO, count: 0, band: null, rating };
}

function writeRound(db: Database.Database, rating: string, kind: "band" | "quad", changes: RoundPayload["items"]): number {
  const update = db.prepare(
    `UPDATE items SET tier_elo = ?, tier_duels_count = ?, tier_band = ?, tier_rating = ? WHERE id = ?`
  );
  let roundId = 0;
  db.transaction(() => {
    for (const { id, after } of changes) update.run(after.elo, after.count, after.band, after.rating, id);
    roundId = Number(
      db
        .prepare(`INSERT INTO tier_rounds (rating, kind, payload, created_at) VALUES (?, ?, ?, ?)`)
        .run(rating, kind, JSON.stringify({ items: changes }), new Date().toISOString()).lastInsertRowid
    );
  })();
  return roundId;
}

/** EC-2 : refusé si le titre n'est plus (vu et) noté comme le palier annoncé. */
export function submitBand(
  db: Database.Database,
  itemId: number,
  stars: Stars,
  band: Band
): { roundId: number } | { error: "stale" } {
  const rating = RATING_SCALE[stars];
  const row = readRows(db, [itemId]).get(itemId);
  if (!row || row.watch_status !== "Watched" || row.rating !== rating) return { error: "stale" };

  const before = stateOf(row);
  const after = { ...effective(row, rating), band, rating };
  return { roundId: writeRound(db, rating, "band", [{ id: itemId, before, after }]) };
}

/**
 * FR-10, AC-12 : le meilleur bat tous les autres ; chacun des autres bat le moins bon (s'il est
 * désigné). Les scores bougent tous ensemble, calculés depuis ceux d'avant le quatuor.
 */
export function submitQuad(
  db: Database.Database,
  itemIds: number[],
  stars: Stars,
  bestId: number,
  worstId: number | null
): { roundId: number } | { error: "stale" | "invalid" } {
  const rating = RATING_SCALE[stars];
  const unique = new Set(itemIds);
  if (
    itemIds.length < 2 ||
    unique.size !== itemIds.length ||
    !unique.has(bestId) ||
    (worstId !== null && (!unique.has(worstId) || worstId === bestId))
  ) {
    return { error: "invalid" };
  }

  const rows = readRows(db, itemIds);
  if (itemIds.some((id) => rows.get(id)?.watch_status !== "Watched" || rows.get(id)?.rating !== rating)) {
    return { error: "stale" };
  }

  const start = new Map(itemIds.map((id) => [id, effective(rows.get(id)!, rating)]));
  const delta = new Map(itemIds.map((id) => [id, 0]));
  const count = new Map(itemIds.map((id) => [id, 0]));
  const play = (winner: number, loser: number) => {
    const expected = 1 / (1 + Math.pow(10, (start.get(loser)!.elo - start.get(winner)!.elo) / 400));
    const change = K_FACTOR * (1 - expected);
    delta.set(winner, delta.get(winner)! + change);
    delta.set(loser, delta.get(loser)! - change);
    count.set(winner, count.get(winner)! + 1);
    count.set(loser, count.get(loser)! + 1);
  };
  for (const id of itemIds) if (id !== bestId) play(bestId, id);
  if (worstId !== null) {
    for (const id of itemIds) if (id !== bestId && id !== worstId) play(id, worstId);
  }

  const changes = itemIds.map((id) => {
    const from = start.get(id)!;
    return {
      id,
      before: stateOf(rows.get(id)!),
      after: { ...from, elo: from.elo + delta.get(id)!, count: from.count + count.get(id)!, rating },
    };
  });
  return { roundId: writeRound(db, rating, "quad", changes) };
}

const SAME = 1e-6;

/** FR-1 : défait une répartition ou un quatuor, si aucun des titres n'a bougé depuis. */
export function undoRound(db: Database.Database, roundId: number): { ok: true } | { error: "not_found" | "conflict" } {
  const round = db.prepare(`SELECT payload FROM tier_rounds WHERE id = ?`).get(roundId) as
    | { payload: string }
    | undefined;
  if (!round) return { error: "not_found" };
  const { items } = JSON.parse(round.payload) as RoundPayload;

  const rows = readRows(db, items.map((i) => i.id));
  const unchanged = items.every(({ id, after }) => {
    const row = rows.get(id);
    return (
      row !== undefined &&
      Math.abs(row.tier_elo - after.elo) < SAME &&
      row.tier_duels_count === after.count &&
      (row.tier_band ?? null) === after.band &&
      row.tier_rating === after.rating
    );
  });
  if (!unchanged) return { error: "conflict" };

  const update = db.prepare(
    `UPDATE items SET tier_elo = ?, tier_duels_count = ?, tier_band = ?, tier_rating = ? WHERE id = ?`
  );
  db.transaction(() => {
    for (const { id, before } of items) update.run(before.elo, before.count, before.band, before.rating, id);
    db.prepare(`DELETE FROM tier_rounds WHERE id = ?`).run(roundId);
  })();
  return { ok: true };
}

// ---------- classement (FR-2, FR-9) ----------

/** Juste de quoi afficher une affiche : la fiche complète se charge à l'ouverture. */
export type RankedItem = {
  id: number;
  name: string;
  year: string | null;
  posterUrl: string | null;
  /** Score de palier ; null = pas encore comparé. */
  tierScore: number | null;
  tierDuels: number;
  band: Band | null;
};

export type Tier = {
  stars: Stars;
  rating: string;
  /** Par groupe (Haut, Milieu, Bas, non réparti) si le palier est réparti, puis par score. */
  items: RankedItem[];
  compared: number;
  /** Titres départagés (FR-7) ; le palier est fini quand ils le sont tous. */
  settled: number;
  /** FR-8 : palier assez grand pour passer par la répartition. */
  banded: boolean;
  placed: number;
};

export type Ranking = { tiers: Tier[]; unrated: number };

type RankRow = {
  id: number;
  year: string | null;
  poster_path: string | null;
  rating: string;
  tier_score: number | null;
  tier_duels: number;
  band: number | null;
  elo_score: number;
  duels_count: number;
  name: string;
};

/** FR-2 : les titres vus, palier par palier, du plus haut au plus bas. */
export function getRanking(db: Database.Database, category?: Category): Ranking {
  const filter = categoryFilter(category);
  const rows = db
    .prepare(
      `SELECT id, rating, name, year, poster_path, elo_score, duels_count,
              CASE WHEN ${TIER_VALID} AND tier_duels_count > 0 THEN tier_elo END tier_score,
              CASE WHEN ${TIER_VALID} THEN tier_duels_count ELSE 0 END tier_duels,
              CASE WHEN ${TIER_VALID} THEN tier_band END band
       FROM items WHERE watch_status = 'Watched' AND rating IS NOT NULL${filter.sql}`
    )
    .all(...filter.params) as RankRow[];

  const { unrated } = db
    .prepare(
      `SELECT COUNT(*) unrated FROM items WHERE watch_status = 'Watched' AND rating IS NULL${filter.sql}`
    )
    .get(...filter.params) as { unrated: number };

  // Dans un groupe : les titres comparés par score ; les autres gardent l'ordre de l'Elo général
  // (s'il a servi), puis le nom, sans prétendre les avoir comparés.
  const byScore = (x: RankRow, y: RankRow) => {
    if (x.tier_score !== null && y.tier_score !== null) return y.tier_score - x.tier_score;
    if (x.tier_score !== null) return -1;
    if (y.tier_score !== null) return 1;
    const eloX = x.duels_count > 0 ? x.elo_score : -Infinity;
    const eloY = y.duels_count > 0 ? y.elo_score : -Infinity;
    if (eloX !== eloY) return eloY - eloX;
    return x.name.localeCompare(y.name, "fr");
  };

  const tiers: Tier[] = [];
  for (let stars = 5; stars >= 0; stars--) {
    const rating = RATING_SCALE[stars];
    const inTier = rows.filter((r) => r.rating === rating);
    if (inTier.length === 0) continue;
    const banded = inTier.length >= BAND_MIN_TITLES;
    // AC-15 : Haut, Milieu, Bas, puis les titres pas encore répartis.
    const bandRank = (r: RankRow) => (banded ? (r.band ?? -1) : 0);
    inTier.sort((x, y) => bandRank(y) - bandRank(x) || byScore(x, y));
    tiers.push({
      stars: stars as Stars,
      rating,
      compared: inTier.filter((r) => r.tier_score !== null).length,
      settled: inTier.filter((r) => r.tier_duels >= TIER_SETTLED_DUELS).length,
      banded,
      placed: inTier.filter((r) => r.band !== null).length,
      items: inTier.map((r) => ({
        id: r.id,
        name: r.name,
        year: displayYear(r.year),
        posterUrl: posterUrl(r.poster_path),
        tierScore: r.tier_score,
        tierDuels: r.tier_duels,
        band: banded ? (r.band as Band | null) : null,
      })),
    });
  }

  return { tiers, unrated };
}
