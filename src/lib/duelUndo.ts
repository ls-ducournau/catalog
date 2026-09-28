import type Database from "better-sqlite3";

// Annulation d'un duel — spec: specs/classement-v1.md (FR-1, AC-1, AC-2, EC-3)

export type DuelMode = "titles" | "people";

/**
 * Où vit chaque sorte de duel. Identifiants SQL fixés ici, jamais venus d'une requête.
 * `lastDuelAt` : colonne de date du dernier duel à recalculer, s'il y en a une.
 * `marksNotion` : l'Elo général des titres est synchronisé avec Notion, les autres scores non.
 */
const TABLES: Record<
  DuelMode,
  {
    duels: string;
    a: string;
    b: string;
    subjects: string;
    score: string;
    count: string;
    lastDuelAt: string | null;
    marksNotion: boolean;
  }
> = {
  titles: {
    duels: "duels",
    a: "item_a_id",
    b: "item_b_id",
    subjects: "items",
    score: "elo_score",
    count: "duels_count",
    lastDuelAt: "last_duel_at",
    marksNotion: true,
  },
  people: {
    duels: "person_duels",
    a: "person_a_id",
    b: "person_b_id",
    subjects: "people",
    score: "elo_score",
    count: "duels_count",
    lastDuelAt: "last_duel_at",
    marksNotion: false,
  },
};

type DuelRow = {
  id: number;
  a: number;
  b: number;
  winner_id: number | null;
  elo_a_before: number;
  elo_b_before: number;
  elo_a_after: number;
  elo_b_after: number;
};

const SAME_SCORE = 1e-6;

/**
 * Défait un duel : scores et compteurs d'avant, duel retiré de l'historique. Refusé si un duel
 * plus récent a touché l'un des deux, ou si leurs scores ont bougé depuis (réinitialisation…) :
 * revenir en arrière écraserait alors autre chose que ce duel.
 */
export function undoDuel(
  db: Database.Database,
  mode: DuelMode,
  duelId: number
): { ok: true } | { error: "not_found" | "conflict" } {
  const t = TABLES[mode];
  const duel = db
    .prepare(
      `SELECT id, ${t.a} a, ${t.b} b, winner_id, elo_a_before, elo_b_before, elo_a_after, elo_b_after
       FROM ${t.duels} WHERE id = ?`
    )
    .get(duelId) as DuelRow | undefined;
  if (!duel) return { error: "not_found" };

  const later = db
    .prepare(
      `SELECT 1 FROM ${t.duels}
       WHERE id > ? AND (${t.a} IN (?, ?) OR ${t.b} IN (?, ?)) LIMIT 1`
    )
    .get(duel.id, duel.a, duel.b, duel.a, duel.b);
  if (later) return { error: "conflict" };

  const current = db.prepare(`SELECT ${t.score} score FROM ${t.subjects} WHERE id = ?`);
  const scoreA = (current.get(duel.a) as { score: number } | undefined)?.score;
  const scoreB = (current.get(duel.b) as { score: number } | undefined)?.score;
  if (
    scoreA === undefined ||
    scoreB === undefined ||
    Math.abs(scoreA - duel.elo_a_after) > SAME_SCORE ||
    Math.abs(scoreB - duel.elo_b_after) > SAME_SCORE
  ) {
    return { error: "conflict" };
  }

  const now = new Date().toISOString();
  const changedScore = duel.winner_id !== null;

  db.transaction(() => {
    db.prepare(`DELETE FROM ${t.duels} WHERE id = ?`).run(duel.id);

    const restore = (id: number, score: number) => {
      const sets = [`${t.score} = ?`, `${t.count} = MAX(0, ${t.count} - 1)`];
      const params: (number | string | null)[] = [score];
      if (t.lastDuelAt) {
        // Date du duel précédent de ce sujet, maintenant que celui-ci n'existe plus.
        sets.push(
          `${t.lastDuelAt} = (SELECT MAX(created_at) FROM ${t.duels} WHERE ${t.a} = ? OR ${t.b} = ?)`
        );
        params.push(id, id);
      }
      sets.push("updated_at = ?");
      params.push(now);
      if (t.marksNotion && changedScore) sets.push("local_dirty = 1");
      db.prepare(`UPDATE ${t.subjects} SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
    };

    restore(duel.a, duel.elo_a_before);
    restore(duel.b, duel.elo_b_before);
  })();

  return { ok: true };
}
