import type { DonneesAccueil } from "./accueilDonnees";
import { posterTint, tintVar } from "./posterTint";
import type { Vitrine } from "./vitrine";

// La teinte des affiches de l'accueil (variable CSS `--tint`). En local (v1), showcase.ts et
// homeFeatures.ts la calculent avec sharp ; le serveur Rust (v2) ne peut pas la reproduire au pixel
// près, alors l'interface la calcule ici, avec la même fonction, sur les mêmes titres : envies, choix,
// listes et cartes de notation (serveur/src/accueil.rs, « écart connu »).

export async function teinterAccueil(donnees: DonneesAccueil): Promise<DonneesAccueil> {
  const { showcase, features } = donnees;
  const titres = showcase
    ? [...showcase.moods.flatMap((t) => t.titles), ...showcase.picks, ...showcase.featured, ...showcase.lists.flatMap((t) => t.titles)]
    : [];
  const cartes = features?.rating.cards ?? [];
  const adresses = [...new Set([...titres.map((t) => t.posterUrl), ...cartes.map((c) => c.posterUrl)])];
  const teintes = new Map(await Promise.all(adresses.map(async (url) => [url, tintVar(await posterTint(url))] as const)));
  for (const t of titres) if (t.tint === undefined) t.tint = teintes.get(t.posterUrl);
  for (const c of cartes) if (c.tint === undefined) c.tint = teintes.get(c.posterUrl);
  return donnees;
}

/** La vitrine (src/lib/vitrine.ts teinte ses titres en v1 ; le serveur Rust ne le fait pas). */
export async function teinterVitrine(vitrine: Vitrine): Promise<Vitrine> {
  const titres = [...vitrine.moods.flatMap((t) => t.titles), ...vitrine.picks, ...vitrine.lists.flatMap((t) => t.titles), ...vitrine.rating];
  const adresses = [...new Set(titres.map((t) => t.posterUrl))];
  const teintes = new Map(await Promise.all(adresses.map(async (url) => [url, tintVar(await posterTint(url))] as const)));
  for (const t of titres) if (t.tint === undefined) t.tint = teintes.get(t.posterUrl);
  return vitrine;
}
