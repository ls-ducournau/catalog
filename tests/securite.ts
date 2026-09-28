import type { Page } from "@playwright/test";

/**
 * Filet de sécurité des tests : aucune écriture n'atteint la base locale ni Notion. Toute requête
 * `/api` autre qu'une lecture est interceptée ; le résultat d'un duel reçoit une réponse simulée
 * (la page passe alors à la paire suivante, comme en vrai).
 */
export async function bloquerEcritures(page: Page): Promise<string[]> {
  const bloquees: string[] = [];
  await page.route("**/api/**", async (route) => {
    const requete = route.request();
    if (requete.method() === "GET") return route.continue();
    bloquees.push(`${requete.method()} ${new URL(requete.url()).pathname}`);
    if (/\/api\/duels\/(people\/)?result$/.test(new URL(requete.url()).pathname)) {
      return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ duelId: -1 }) });
    }
    return route.abort();
  });
  return bloquees;
}
