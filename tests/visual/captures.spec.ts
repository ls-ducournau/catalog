import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
import { test } from "@playwright/test";
import { attendreEcran, ECRANS } from "./ecrans";

// Phase 0 du système de design v2 (spec § 10, AC-0.1) : capture de chaque écran à chaque largeur,
// et relevé de ce que les captures ne montrent pas (violations axe, textes sous 12 px). Les
// données sont réelles : ce sont des références à relire d'une phase à l'autre, pas des
// assertions au pixel (celles-ci visent la page /design, stable, en phase 3).
const SERIE = process.env.SERIE ?? "courant";
const DOSSIER = path.join(__dirname, "captures", SERIE);

for (const ecran of ECRANS) {
  test(ecran.nom, async ({ page }, info) => {
    await page.goto(ecran.chemin);
    await attendreEcran(page);
    if (ecran.ouvrir) {
      await ecran.ouvrir(page);
      await attendreEcran(page);
    }

    const dossier = path.join(DOSSIER, info.project.name);
    mkdirSync(dossier, { recursive: true });
    await page.screenshot({ path: path.join(dossier, `${ecran.nom}.png`) });

    // Textes rendus sous 12 px (plancher de l'utilisateur).
    const petitsTextes = await page.evaluate(() => {
      const trouves: string[] = [];
      const marcheur = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = marcheur.nextNode(); n; n = marcheur.nextNode()) {
        const texte = n.textContent?.trim();
        const el = n.parentElement;
        if (!texte || !el || el.closest("[aria-hidden='true'], script, style")) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const taille = parseFloat(getComputedStyle(el).fontSize);
        if (taille < 12) trouves.push(`${taille}px « ${texte.slice(0, 40)} »`);
      }
      return trouves;
    });

    // Accessibilité : une fois par écran suffit, à la largeur ordinateur.
    let axe: Record<string, number> | undefined;
    let regles: { id: string; impact: string | null | undefined; noeuds: number }[] | undefined;
    if (info.project.name === "ordinateur") {
      const resultat = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
      axe = { critical: 0, serious: 0, moderate: 0, minor: 0 };
      for (const v of resultat.violations) axe[v.impact ?? "minor"] = (axe[v.impact ?? "minor"] ?? 0) + v.nodes.length;
      regles = resultat.violations.map((v) => ({ id: v.id, impact: v.impact, noeuds: v.nodes.length }));
    }

    writeFileSync(
      path.join(dossier, `${ecran.nom}.json`),
      JSON.stringify({ ecran: ecran.nom, largeur: page.viewportSize()?.width, petitsTextes, axe, regles }, null, 2)
    );
  });
}
