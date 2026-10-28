import { getDb } from "./db";
import { getHomeFeatures, type HomeFeatures } from "./homeFeatures";
import { getHomeShowcase, type HomeShowcase } from "./showcase";
import type { Compteurs, DonneesAccueil } from "./accueilDonnees";

// Les données de l'accueil lues dans la base locale (v1). Reprend à l'identique ce que faisait
// src/app/page.tsx : rien plutôt qu'une erreur si la base ou TMDB ne répondent pas.

function counts(): Compteurs | null {
  try {
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN rating IS NOT NULL AND rating <> '' THEN 1 ELSE 0 END) AS rated,
                SUM(CASE WHEN watch_status = 'Unwatched' THEN 1 ELSE 0 END) AS toWatch
         FROM items`
      )
      .get() as { total: number; rated: number | null; toWatch: number | null };
    return { total: row.total, rated: row.rated ?? 0, toWatch: row.toWatch ?? 0 };
  } catch {
    return null;
  }
}

async function showcase(): Promise<HomeShowcase | null> {
  try {
    return await getHomeShowcase(getDb());
  } catch {
    return null;
  }
}

async function features(): Promise<HomeFeatures | null> {
  try {
    return await getHomeFeatures(getDb());
  } catch {
    return null;
  }
}

export async function chargerAccueilLocal(): Promise<DonneesAccueil> {
  const stats = counts();
  const [preview, keys] = await Promise.all([showcase(), features()]);
  return { stats, showcase: preview, features: keys };
}
