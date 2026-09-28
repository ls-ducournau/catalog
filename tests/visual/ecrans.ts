import type { Page } from "@playwright/test";

/**
 * Les 10 écrans du système de design v2 (spec § 8.5). `ouvrir` amène l'écran dans l'état capturé,
 * sans jamais déclencher d'écriture (ni statut, ni note, ni synchronisation).
 */
export type Ecran = { nom: string; chemin: string; ouvrir?: (page: Page) => Promise<void> };

export const ECRANS: Ecran[] = [
  { nom: "accueil", chemin: "/" },
  { nom: "bibliotheque", chemin: "/library" },
  {
    nom: "fiche",
    chemin: "/library",
    // Clavier plutôt que clic : la carte porte aussi des boutons (statut, suppression).
    ouvrir: async (page) => {
      const carte = page.locator('[data-flip-id] > [role="button"]').first();
      await carte.focus();
      await page.keyboard.press("Enter");
      await page.getByRole("dialog").first().waitFor({ state: "visible", timeout: 10_000 });
    },
  },
  {
    nom: "ajouter",
    chemin: "/library?ajouter=1",
    ouvrir: async (page) => {
      await page.getByRole("dialog").first().waitFor({ state: "visible", timeout: 10_000 });
    },
  },
  { nom: "recommandations", chemin: "/recommendations" },
  { nom: "classement", chemin: "/classement" },
  { nom: "duels", chemin: "/duels" },
  { nom: "tri", chemin: "/tri" },
  { nom: "sorties", chemin: "/sorties" },
  { nom: "ce-soir", chemin: "/ce-soir" },
];

/** Laisse les données arriver (TMDB, disponibilités), sans attendre une page jamais au repos. */
export async function attendreEcran(page: Page): Promise<void> {
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(1200);
}
