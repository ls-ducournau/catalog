// Avis sur les personnes → classement — spec: specs/tri-rapide-v1.md (FR-7)
//
// Module pur. Le réglage n'est pas mesurable sur le banc tant qu'il n'existe pas d'avis : il est
// donc volontairement faible et plafonné, pour ne jamais écraser le modèle.

/**
 * Poids d'une personne aimée (ou pas) présente dans un titre, en unités du score du modèle
 * (somme de trois composantes centrées-réduites, écart type ≈ 2) : ≈ 0,15 écart type par
 * personne, plafonné à ≈ 0,45 écart type quel que soit le nombre de personnes.
 */
export const PERSON_BONUS = 0.3;
export const PERSON_BONUS_CAP = 0.9;

/** Poids d'un avis moyen fictif : avec peu d'avis, chacun garde presque toute sa valeur. */
export const OPINION_PRIOR = 10;

/**
 * Poids d'un avis avant centrage (classement-v1 FR-13) : « je n'aime pas » −1 ; « j'aime » 1, ou
 * note ÷ 3 quand la personne est notée (1 étoile 0,33 ; 3 étoiles 1 ; 5 étoiles 1,67).
 */
export function opinionValue(opinion: 1 | -1, rating: number | null): number {
  if (opinion === -1) return -1;
  return rating === null ? 1 : rating / 3;
}

/**
 * Avis centrés : un « j'aime » pèse d'autant moins que tu aimes presque tout le monde, et un
 * « je n'aime pas » d'autant plus qu'il est rare. Le centre est rétréci vers zéro tant qu'il y a
 * peu d'avis, pour que les premiers comptent dès le départ.
 */
export function centeredOpinions(opinions: ReadonlyMap<number, number>): Map<number, number> {
  let sum = 0;
  for (const value of opinions.values()) sum += value;
  const center = sum / (opinions.size + OPINION_PRIOR);
  return new Map([...opinions].map(([id, value]) => [id, value - center]));
}

/** Bonus (ou malus) d'un titre selon tes avis sur les personnes qui y figurent. */
export function personBonus(peopleIds: number[], opinions: ReadonlyMap<number, number>): number {
  if (opinions.size === 0 || peopleIds.length === 0) return 0;
  let total = 0;
  for (const id of new Set(peopleIds)) total += (opinions.get(id) ?? 0) * PERSON_BONUS;
  return Math.max(-PERSON_BONUS_CAP, Math.min(PERSON_BONUS_CAP, total));
}
