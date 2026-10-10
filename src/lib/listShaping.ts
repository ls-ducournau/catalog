// Façonnage de la liste — spec: specs/recommendations-v1.md, amendements v1.4 (FR-30 à FR-32)
//
// Module pur : il réordonne la sortie du modèle sans jamais la recalculer, et le banc
// d'évaluation l'exécute directement avec Node (aucun import).

export type Shapeable = { id: number; score: number; genres: string[] };

/** Part de chaque genre ; un titre répartit son poids à parts égales entre ses genres. */
export type GenreDistribution = Map<string, number>;

/** Lissage de Steck : évite une divergence infinie quand un genre manque dans la liste. */
const CALIBRATION_ALPHA = 0.01;

/**
 * Poids de la calibration face à la pertinence. Mesuré sur le banc (FR-33) : à 0,8, l'écart de
 * calibration des 20 premiers baisse de 79 % pour 0,04 étoile de note réelle moyenne ; 0,9 coûte
 * 0,08 étoile, trop près du plafond de 0,1 compte tenu de la variance entre plis. Depuis la v1.5
 * (groupes rangés par pertinence, classement par compatibilité) : −65 % d'écart pour −0,08
 * étoile, et un premier titre noté 4,4 en moyenne au lieu de 3,3.
 */
export const CALIBRATION_LAMBDA = 0.8;

export function genreDistribution(titles: { genres: string[] }[]): GenreDistribution {
  const totals = new Map<string, number>();
  let mass = 0;
  for (const title of titles) {
    if (title.genres.length === 0) continue;
    const share = 1 / title.genres.length;
    for (const genre of title.genres) totals.set(genre, (totals.get(genre) ?? 0) + share);
    mass += 1;
  }
  if (mass === 0) return totals;
  for (const [genre, value] of totals) totals.set(genre, value / mass);
  return totals;
}

/**
 * Écart de calibration de Steck : KL(p ‖ q̃), avec q̃ = (1 − α)·q + α·p. Nul quand la liste
 * reproduit exactement tes proportions ; grand quand un de tes intérêts en est absent.
 */
export function miscalibration(target: GenreDistribution, list: GenreDistribution): number {
  let kl = 0;
  for (const [genre, p] of target) {
    if (p <= 0) continue;
    const q = (1 - CALIBRATION_ALPHA) * (list.get(genre) ?? 0) + CALIBRATION_ALPHA * p;
    kl += p * Math.log(p / q);
  }
  return kl;
}

/**
 * Taille des groupes rangés par pertinence après calibration (FR-30, précision v1.5) : celle
 * d'une rangée. Sans ça, le glouton plaçait en tête le titre qui couvre le plus de genres à lui
 * seul, quelle que soit sa pertinence (un film à 37 % en « Le meilleur pour toi »).
 */
export const CALIBRATION_BLOCK = 12;

/**
 * Portée de la calibration : à chaque rang, seuls les `window` titres les mieux classés parmi
 * ceux qui restent sont candidats. Elle réordonne localement ; elle ne va pas chercher un titre
 * classé très bas pour représenter un genre. Mesuré (banc, 20 premiers) : sans limite, elle
 * remontait jusqu'au 79e rang en moyenne ; à 48, jusqu'au 45e, pour le même écart de calibration
 * (0,236 contre 0,223) et la même note réelle.
 */
export const CALIBRATION_WINDOW = 48;

/**
 * FR-30 : ré-ordonnancement glouton de Steck. À chaque rang, on retient le titre qui maximise
 * `(1 − λ) · pertinence cumulée − λ · écart de calibration` de la liste obtenue. La calibration
 * décide quels titres entrent dans chaque groupe de `block` ; à l'intérieur d'un groupe, le plus
 * pertinent passe devant. Au-delà de `size`, l'ordre du modèle est conservé.
 */
export function calibrate<T extends Shapeable>(
  ranked: T[],
  target: GenreDistribution,
  {
    lambda = CALIBRATION_LAMBDA,
    size = 48,
    block = CALIBRATION_BLOCK,
    window = CALIBRATION_WINDOW,
  }: { lambda?: number; size?: number; block?: number; window?: number } = {}
): T[] {
  if (ranked.length === 0 || target.size === 0) return [...ranked];

  // Pertinence ramenée entre 0 et 1, pour être comparable à l'écart de calibration.
  const scores = ranked.map((t) => t.score);
  const min = Math.min(...scores);
  const span = Math.max(...scores) - min || 1;
  const relevance = new Map(ranked.map((t) => [t.id, (t.score - min) / span]));

  const remaining = [...ranked];
  const selected: T[] = [];
  const counts = new Map<string, number>();
  let listed = 0;
  let relevanceSum = 0;

  const distributionWith = (candidate: T): GenreDistribution => {
    const withCandidate = new Map(counts);
    let total = listed;
    if (candidate.genres.length > 0) {
      const share = 1 / candidate.genres.length;
      for (const genre of candidate.genres) {
        withCandidate.set(genre, (withCandidate.get(genre) ?? 0) + share);
      }
      total += 1;
    }
    if (total > 0) for (const [genre, value] of withCandidate) withCandidate.set(genre, value / total);
    return withCandidate;
  };

  while (selected.length < Math.min(size, ranked.length)) {
    let bestIndex = 0;
    let bestObjective = -Infinity;

    remaining.slice(0, window).forEach((candidate, index) => {
      const objective =
        (1 - lambda) * (relevanceSum + (relevance.get(candidate.id) ?? 0)) -
        lambda * miscalibration(target, distributionWith(candidate));
      if (objective > bestObjective) {
        bestObjective = objective;
        bestIndex = index;
      }
    });

    const [chosen] = remaining.splice(bestIndex, 1);
    selected.push(chosen);
    relevanceSum += relevance.get(chosen.id) ?? 0;
    if (chosen.genres.length > 0) {
      const share = 1 / chosen.genres.length;
      for (const genre of chosen.genres) counts.set(genre, (counts.get(genre) ?? 0) + share);
      listed += 1;
    }
  }

  const ordered: T[] = [];
  for (let start = 0; start < selected.length; start += block) {
    ordered.push(...selected.slice(start, start + block).sort((a, b) => b.score - a.score));
  }
  return [...ordered, ...remaining];
}

export type ExplorationCandidate = Shapeable & {
  voteAverage: number | null;
  voteCount: number | null;
};

/** Seuils de FR-31 : un genre sous cette part de ton historique est « hors de tes habitudes ». */
const EXPLORATION_MAX_SHARE = 0.05;
const EXPLORATION_MIN_VOTE_AVERAGE = 7;
const EXPLORATION_MIN_VOTES = 500;

/**
 * FR-31 : titres d'un genre peu présent dans ton historique (genre principal), reconnus par
 * ailleurs, et que le modèle ne prédit pas mauvais (score au moins médian du lot).
 */
export function explorationPool<T extends ExplorationCandidate>(
  candidates: T[],
  target: GenreDistribution
): T[] {
  if (candidates.length === 0) return [];
  const sortedScores = candidates.map((c) => c.score).sort((a, b) => a - b);
  const median = sortedScores[Math.floor(sortedScores.length / 2)];

  return candidates
    .filter((c) => {
      const primary = c.genres[0];
      if (!primary) return false;
      return (
        (target.get(primary) ?? 0) < EXPLORATION_MAX_SHARE &&
        (c.voteAverage ?? 0) >= EXPLORATION_MIN_VOTE_AVERAGE &&
        (c.voteCount ?? 0) >= EXPLORATION_MIN_VOTES &&
        c.score >= median
      );
    })
    .sort((a, b) => b.score - a.score);
}

/**
 * FR-31 : un rang sur `every` (6, 12, 18… en comptant à partir de 1) reçoit le prochain titre
 * d'exploration, marqué comme tel. Un titre d'exploration déjà présent dans la liste y est
 * déplacé plutôt que dupliqué.
 */
export function interleaveExploration<T extends { id: number }>(
  main: T[],
  pool: T[],
  every: number = 6
): (T & { exploration: boolean })[] {
  const poolIds = new Set(pool.map((t) => t.id));
  const rest = main.filter((t) => !poolIds.has(t.id)).map((t) => ({ ...t, exploration: false }));
  const picks = pool.map((t) => ({ ...t, exploration: true }));

  const result: (T & { exploration: boolean })[] = [];
  let restIndex = 0;
  let pickIndex = 0;
  const targetLength = main.length;

  while (result.length < targetLength && (restIndex < rest.length || pickIndex < picks.length)) {
    const position = result.length + 1;
    if (position % every === 0 && pickIndex < picks.length) {
      result.push(picks[pickIndex++]);
    } else if (restIndex < rest.length) {
      result.push(rest[restIndex++]);
    } else {
      result.push(picks[pickIndex++]);
    }
  }
  return result;
}

// ---------- lassitude (recommandations-fraicheur-v1 FR-5 à FR-8) ----------

/**
 * Places perdues par jour où un titre a été montré sans geste (FR-5), et recul maximal : une
 * rangée. 0 désactive la lassitude (NFR-3). Mesuré sur le banc (FR-10), 42 jours sans geste,
 * 12 titres en tête chaque jour : 19 titres différents la première semaine (12 sans
 * lassitude), 22 sur les quatre suivantes, jamais plus de 3 nouveaux en un jour une fois la
 * rotation établie, et une note réelle des titres montrés inchangée (+0,03).
 *
 * Pourquoi des places plutôt qu'une part du score : les scores sont épars en tête et serrés plus
 * bas, si bien qu'une même pénalité en écarts types déplace un titre de plus en plus loin. À
 * 0,05 écart type par jour, 4 titres nouveaux par jour la première semaine, 7 la suivante.
 *
 * Pourquoi un plafond plutôt qu'un repos : un titre « au repos » (renvoyé en fin de liste après
 * 5 jours) partait en même temps que ceux entrés avec lui, puis revenait avec eux à la sortie de
 * la fenêtre : toute la rangée changeait d'un coup, tous les 14 jours. Avec une mémoire qui
 * s'efface mais sans plafond, la rotation s'emballait jusqu'à renouveler toute la rangée chaque
 * jour. Détail des mesures : specs/recommandations-fraicheur-v1.md § 7.
 */
export const FATIGUE_STEP = 3;
export const FATIGUE_MAX_SHIFT = 12;

/** Un jour montré compte 1 la veille, puis s'efface de moitié chaque semaine (FR-5). */
export const FATIGUE_HALF_LIFE_DAYS = 7;

/** Poids d'un jour où le titre a été montré, il y a `daysAgo` jours (1 : hier). */
export function fatigueWeight(daysAgo: number): number {
  return 0.5 ** ((daysAgo - 1) / FATIGUE_HALF_LIFE_DAYS);
}

/**
 * FR-5 : sur la liste finale (après diversité, calibration et exploration), un titre recule de
 * `step` places par jour où il a été montré sans geste, au plus de `maxShift` places. `fatigueOf`
 * rend ce nombre de jours, pondéré par leur ancienneté (cf. `getExposure`). Rien n'est retiré ni
 * modifié : seule la place change.
 */
export function applyFatigue<T>(
  shaped: T[],
  fatigueOf: (item: T) => number,
  { step = FATIGUE_STEP, maxShift = FATIGUE_MAX_SHIFT }: { step?: number; maxShift?: number } = {}
): T[] {
  if (step === 0) return [...shaped];

  const placed = shaped.map((item, index) => {
    const fatigue = fatigueOf(item);
    return { item, index, fatigue, place: index + Math.min(step * fatigue, maxShift) };
  });
  // À place égale, le moins montré passe devant : reculer de 3 places, c'est finir derrière le
  // titre qui était 3 places plus bas.
  placed.sort((a, b) => a.place - b.place || a.fatigue - b.fatigue || a.index - b.index);
  return placed.map((p) => p.item);
}

// ---------- rangées expliquées (FR-32) ----------

export type RowCandidate = {
  id: number;
  score: number;
  genres: string[];
  type: "Movie" | "TV Series";
  documentary: boolean;
  runtime: number | null;
  year: number | null;
  voteCount: number | null;
  /** Inclus dans l'un de tes abonnements. */
  onMyServices: boolean;
  /** Premier titre aimé qui l'explique. */
  anchor: { id: number; name: string; stars: number } | null;
  exploration: boolean;
};

/** `anchor` : le titre aimé qui explique toute la rangée (« Parce que tu as adoré X »). */
export type Row = { key: string; title: string; ids: number[]; anchor?: string };

const ROW_SIZE = 12;
/** Une rangée de moins de trois titres a l'air cassée : on ne l'affiche pas. */
const ROW_MIN = 3;
const TONIGHT_MAX_MINUTES = 120;
const GEM_MAX_VOTES = 1500;
const GEM_MIN_PERCENTILE = 0.7;
const RECENT_YEARS = 2;

/**
 * FR-32 : compose les rangées à partir de la liste déjà façonnée (calibrée, exploration
 * incluse). Les titres de la première rangée ne sont repris nulle part ; les rangées suivantes
 * ne se répètent pas entre elles.
 */
export function buildRows(
  shaped: RowCandidate[],
  options: { currentYear: number; hasSubscriptions: boolean }
): Row[] {
  const rows: Row[] = [];
  const claimed = new Set<number>();

  const best = shaped.slice(0, ROW_SIZE).map((c) => c.id);
  best.forEach((id) => claimed.add(id));
  if (best.length >= ROW_MIN) rows.push({ key: "best", title: "Le meilleur pour toi", ids: best });

  const add = (key: string, title: string, pick: (c: RowCandidate) => boolean, anchor?: string) => {
    const ids = shaped
      .filter((c) => !claimed.has(c.id) && pick(c))
      .slice(0, ROW_SIZE)
      .map((c) => c.id);
    if (ids.length < ROW_MIN) return;
    ids.forEach((id) => claimed.add(id));
    rows.push(anchor ? { key, title, ids, anchor } : { key, title, ids });
  };

  if (options.hasSubscriptions) {
    add("services", "Disponible sur tes abonnements", (c) => c.onMyServices);
  }

  // « Parce que tu as adoré X » : les titres aimés qui expliquent le plus de candidats restants.
  const anchorCounts = new Map<number, { name: string; stars: number; count: number }>();
  for (const c of shaped) {
    if (claimed.has(c.id) || !c.anchor) continue;
    const entry = anchorCounts.get(c.anchor.id) ?? { name: c.anchor.name, stars: c.anchor.stars, count: 0 };
    entry.count += 1;
    anchorCounts.set(c.anchor.id, entry);
  }
  const anchors = [...anchorCounts]
    .filter(([, a]) => a.count >= ROW_MIN)
    .sort((a, b) => b[1].count - a[1].count || b[1].stars - a[1].stars)
    .slice(0, 2);

  if (anchors[0]) {
    const [anchorId, anchor] = anchors[0];
    add(`because-${anchorId}`, `Parce que tu as adoré ${anchor.name}`, (c) => c.anchor?.id === anchorId, anchor.name);
  }

  add(
    "tonight",
    "Pour ce soir, en moins de 2 h",
    (c) => c.type === "Movie" && c.runtime !== null && c.runtime <= TONIGHT_MAX_MINUTES
  );

  const scores = shaped.map((c) => c.score).sort((a, b) => a - b);
  const gemThreshold = scores[Math.floor(scores.length * GEM_MIN_PERCENTILE)] ?? Infinity;
  add(
    "gems",
    "Pépites peu connues",
    (c) => (c.voteCount ?? 0) > 0 && (c.voteCount ?? 0) < GEM_MAX_VOTES && c.score >= gemThreshold
  );

  if (anchors[1]) {
    const [anchorId, anchor] = anchors[1];
    add(`because-${anchorId}`, `Parce que tu as adoré ${anchor.name}`, (c) => c.anchor?.id === anchorId, anchor.name);
  }

  add(
    "recent",
    "Sorties récentes",
    (c) => c.year !== null && c.year >= options.currentYear - RECENT_YEARS
  );
  add("explore", "Pour sortir de tes habitudes", (c) => c.exploration);

  return rows;
}
