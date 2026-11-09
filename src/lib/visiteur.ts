import { cache } from "react";
import { headers } from "next/headers";
import { NOTES_POUR_RECOS } from "./seuils";
import { ENTETE_JETON, estV2, revendications } from "./sessionV2";

// Qui est un visiteur — specs/visite-interactive-v1.md, accueil-vitrine-connexion-v1.md (§ 2, § 5) et
// bienvenue-v1.md (FR-18). En ligne : quelqu'un sans session, ou un invité qui n'a pas fini sa découverte (moins
// de 10 notes : ses recommandations ne sont pas encore ouvertes). Il voit la page d'arrivée et la barre épurée,
// jamais les menus de l'application (demande de Louis, 2026-11-09 : « pourquoi j'ai toujours ça dans la top app
// bar quand j'ai ajouté des titres depuis la landing page »). Un compte durable, ou un invité qui a ses dix
// notes : l'application. En local (v1), jamais de visiteur. Une seule lecture par requête (cache).

export type EtatVisiteur = { visiteur: boolean; titres: number; notes: number };

const AUCUN: EtatVisiteur = { visiteur: false, titres: 0, notes: 0 };

async function total(api: string, jeton: string, filtre: string): Promise<number | null> {
  try {
    const reponse = await fetch(new URL(`/api/items?pageSize=1${filtre}`, api), {
      headers: {
        Authorization: `Bearer ${jeton}`,
        ...(process.env.CATALOG_API_BYPASS ? { "x-vercel-protection-bypass": process.env.CATALOG_API_BYPASS } : {}),
      },
      cache: "no-store",
    });
    if (!reponse.ok) return null;
    return ((await reponse.json()) as { total?: number }).total ?? 0;
  } catch {
    return null;
  }
}

export const etatVisiteur = cache(async (): Promise<EtatVisiteur> => {
  const api = process.env.CATALOG_API_URL;
  if (!estV2() || !api) return AUCUN;
  const jeton = (await headers()).get(ENTETE_JETON);
  if (!jeton) return { visiteur: true, titres: 0, notes: 0 };
  if (revendications(jeton)?.is_anonymous !== true) return AUCUN;
  // Les titres, et les notes (de 1 à 5 étoiles, plus 💩) : trois petites lectures, en parallèle.
  const [titres, etoiles, caca] = await Promise.all([total(api, jeton, ""), total(api, jeton, "&minRating=1"), total(api, jeton, "&rating=0")]);
  if (titres === null || etoiles === null || caca === null) return AUCUN;
  const notes = etoiles + caca;
  return { visiteur: notes < NOTES_POUR_RECOS, titres, notes };
});

export const estVisiteur = cache(async (): Promise<boolean> => (await etatVisiteur()).visiteur);

/**
 * Pas de compte durable : pas de session, ou une session invitée (en ligne). Ce qu'il a fait sans compte
 * (visite, page d'arrivée) peut alors entrer dans sa bibliothèque (specs/bienvenue-v1.md, FR-13). En local
 * (v1), jamais : c'est la bibliothèque de Louis.
 */
export const estInvite = cache(async (): Promise<boolean> => {
  if (!estV2() || !process.env.CATALOG_API_URL) return false;
  const jeton = (await headers()).get(ENTETE_JETON);
  return !jeton || revendications(jeton)?.is_anonymous === true;
});
