// Durées et heures affichées — audit UX 2026-10-09 (W1-8). Un seul formateur pour toute l'app,
// avec des espaces insécables : « 1 h 05 » ne se coupe jamais entre deux lignes.

const NBSP = " ";

/** « 3 h 30 », « 2 h », « 45 min ». */
export function formatMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}${NBSP}min`;
  return m === 0 ? `${h}${NBSP}h` : `${h}${NBSP}h${NBSP}${String(m).padStart(2, "0")}`;
}

/** « 22 h 47 ». */
export function clock(date: Date): string {
  return `${date.getHours()}${NBSP}h${NBSP}${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * « de » devant un titre, contracté comme en français (audit UX 2026-10-09, W2-11) :
 * « du Seigneur des anneaux », « des Visiteurs », « de La Haine », « de Breaking Bad ».
 * Rend l'article et le titre séparément, pour qu'une page puisse mettre le titre en valeur.
 */
export function ofTitle(title: string): { article: string; title: string } {
  const match = title.match(/^(Le|Les) (.+)$/);
  if (!match) return { article: "de", title };
  return { article: match[1] === "Le" ? "du" : "des", title: match[2] };
}

/** « Proche du Seigneur des anneaux ». */
export function closeTo(title: string): string {
  const { article, title: rest } = ofTitle(title);
  return `Proche ${article} ${rest}`;
}
