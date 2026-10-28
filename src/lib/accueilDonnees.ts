import { headers } from "next/headers";
import type { HomeFeatures } from "./homeFeatures";
import type { HomeShowcase } from "./showcase";
import { ENTETE_JETON } from "./sessionV2";

// Les données de l'accueil (src/app/page.tsx) : compteurs, aperçus et fonctions clés. En local (v1),
// lues dans la base SQLite ; en ligne (v2, CATALOG_API_URL défini), demandées au serveur Rust
// (`GET /api/accueil`), avec le jeton que le proxy a posé pour cette requête. Même forme dans les deux
// cas : la page ne sait pas d'où elles viennent. Une partie qui échoue vaut null, comme avant.

export type Compteurs = { total: number; rated: number; toWatch: number };
export type DonneesAccueil = { stats: Compteurs | null; showcase: HomeShowcase | null; features: HomeFeatures | null };

const VIDE: DonneesAccueil = { stats: null, showcase: null, features: null };

async function depuisApi(api: string): Promise<DonneesAccueil> {
  const jeton = (await headers()).get(ENTETE_JETON);
  if (!jeton) return VIDE;
  try {
    const reponse = await fetch(new URL("/api/accueil", api), {
      headers: {
        Authorization: `Bearer ${jeton}`,
        ...(process.env.CATALOG_API_BYPASS ? { "x-vercel-protection-bypass": process.env.CATALOG_API_BYPASS } : {}),
      },
      cache: "no-store",
    });
    if (!reponse.ok) return VIDE;
    const corps = (await reponse.json()) as Partial<DonneesAccueil>;
    return { stats: corps.stats ?? null, showcase: corps.showcase ?? null, features: corps.features ?? null };
  } catch {
    return VIDE;
  }
}

export async function chargerAccueil(): Promise<DonneesAccueil> {
  const api = process.env.CATALOG_API_URL;
  if (api) return depuisApi(api);
  // La base locale n'est chargée qu'en v1 : la v2 n'embarque jamais SQLite à l'exécution.
  const { chargerAccueilLocal } = await import("./accueilLocal");
  return chargerAccueilLocal();
}
