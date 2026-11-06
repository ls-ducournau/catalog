import { cache } from "react";
import { headers } from "next/headers";
import { ENTETE_JETON, estV2, revendications } from "./sessionV2";

// Qui est un visiteur — specs/visite-interactive-v1.md et accueil-vitrine-connexion-v1.md (§ 2, § 5).
// En ligne : quelqu'un sans session, ou un invité qui n'a encore rien gardé (bibliothèque vide). Il voit la
// vitrine, la visite et une barre sans réglages ni « Ajouter ». Dès qu'un invité a un titre, c'est un
// compte qui démarre. En local (v1), jamais de visiteur. Une seule lecture par requête (cache).

export const estVisiteur = cache(async (): Promise<boolean> => {
  const api = process.env.CATALOG_API_URL;
  if (!estV2() || !api) return false;
  const jeton = (await headers()).get(ENTETE_JETON);
  if (!jeton) return true;
  if (revendications(jeton)?.is_anonymous !== true) return false;
  try {
    const reponse = await fetch(new URL("/api/items?pageSize=1", api), {
      headers: {
        Authorization: `Bearer ${jeton}`,
        ...(process.env.CATALOG_API_BYPASS ? { "x-vercel-protection-bypass": process.env.CATALOG_API_BYPASS } : {}),
      },
      cache: "no-store",
    });
    if (!reponse.ok) return false;
    const corps = (await reponse.json()) as { total?: number };
    return (corps.total ?? 0) === 0;
  } catch {
    return false;
  }
});
