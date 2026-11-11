// Les exemples de la page d'arrivée (demande de Louis, 2026-11-10) : le radar de « Tes goûts » et la
// bibliothèque en chiffres, tels qu'un compte les voit, bâtis sur les titres de la vitrine. Ce sont des
// illustrations, toujours signalées « Exemple » à l'écran : les notes n'appartiennent à personne.

import type { RecommendationProfile } from "@/lib/recommendationService";
import type { LibraryStats, ShowcaseTitle } from "@/lib/showcase";

/** Des goûts d'exemple, en étoiles : une forme irrégulière, pour que le radar ait du relief. */
const AFFINITES = [4.4, 3.6, 4.1, 3.2, 3.9, 3.5];

/**
 * Un profil de goûts d'exemple sur les genres les plus présents parmi `titres` (six au plus), et la pile
 * qui va avec : combien de ces titres portent chaque genre. Les puces du radar filtrent alors la liste
 * sans jamais la vider. Les genres combinés des séries (« Sci-Fi & Fantasy ») restent dehors : ils
 * doubleraient leurs voisins. Null sous trois genres : le radar n'aurait pas de forme.
 */
export function goutsExemple(titres: ShowcaseTitle[]): {
  profile: RecommendationProfile;
  pileGenres: Record<string, number>;
} | null {
  const pileGenres: Record<string, number> = {};
  for (const t of titres)
    for (const g of new Set(t.genres))
      if (!g.includes("&")) pileGenres[g] = (pileGenres[g] ?? 0) + 1;
  const genres = Object.entries(pileGenres)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, AFFINITES.length);
  if (genres.length < 3) return null;
  return {
    profile: {
      genres: genres.map(([name, count], i) => ({
        name,
        affinity: AFFINITES[i],
        count,
      })),
      directors: [],
      ratedCount: 0,
      compatibilityBaseRate: null,
    },
    pileGenres,
  };
}

/** La part des titres vus, et la répartition de leurs notes (💩 à 5 étoiles), dans la bibliothèque d'exemple. */
const PART_VUS = 0.6;
const POIDS_NOTES = [0.05, 0.05, 0.12, 0.25, 0.33, 0.2];

/**
 * Une bibliothèque d'exemple faite de `titres` (sans doublon) : leur nombre et leurs types sont vrais, ce
 * qui laisse les puces filtrer la liste d'à côté ; la part des vus et leurs notes sont illustratives.
 */
export function bibliothequeExemple(titres: ShowcaseTitle[]): LibraryStats {
  const uniques = [...new Map(titres.map((t) => [t.id, t])).values()];
  const total = uniques.length;
  const watched = Math.round(total * PART_VUS);
  const ratings = POIDS_NOTES.map((p) => Math.round(watched * p));
  // L'arrondi tombe juste : l'écart va aux 4 étoiles, la note la plus donnée.
  ratings[4] = Math.max(
    0,
    ratings[4] + watched - ratings.reduce((s, n) => s + n, 0),
  );
  const parType = new Map<
    LibraryStats["categories"][number]["value"],
    number
  >();
  for (const t of uniques)
    parType.set(t.category, (parType.get(t.category) ?? 0) + 1);
  const categories = [...parType]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count);
  return { total, watched, toWatch: total - watched, categories, ratings };
}
