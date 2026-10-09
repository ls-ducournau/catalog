import { expect, test } from "@playwright/test";
import { bloquerEcritures } from "../securite";

// Phase 3 du système de design v2 (spec § 10) : le guide /design, stable (aucune image du réseau,
// aucune donnée), sert de référence au pixel ; on y vérifie aussi les recettes et le focus.

test.beforeEach(async ({ page }) => {
  await bloquerEcritures(page);
  await page.goto("/design");
  await page.evaluate(() => document.fonts.ready);
});

test("AC-3.1 : le guide /design ne change pas sans qu'on le veuille", async ({ page }, info) => {
  test.skip(info.project.name === "tablette", "Deux largeurs suffisent au pixel : téléphone et ordinateur.");
  await expect(page).toHaveScreenshot("design.png", {
    fullPage: true,
    animations: "disabled",
    caret: "hide",
    maxDiffPixelRatio: 0.01,
  });
});

// Recette relevée sur raycast.com (docs/design-reference/raycast/composants/bouton.md).
test("AC-3.2 : le bouton d'action suit la recette relevée sur raycast.com", async ({ page }, info) => {
  test.skip(info.project.name !== "ordinateur");
  const bouton = page.locator("main .btn-primary").first();
  const style = await bouton.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      fond: s.backgroundColor,
      texte: s.color,
      rayon: s.borderRadius,
      ombre: s.boxShadow,
      police: `${s.fontSize} ${s.fontWeight}`,
      marges: s.paddingLeft,
    };
  });
  expect(style.fond).toBe("rgb(230, 230, 230)");
  expect(style.texte).toBe("rgb(47, 48, 49)");
  expect(style.rayon).toBe("8px");
  expect(style.police).toBe("14px 500");
  expect(style.marges).toBe("12px");
  expect(style.ombre).toBe(
    "rgba(0, 0, 0, 0.5) 0px 0px 0px 2px, rgba(255, 255, 255, 0.08) 0px 0px 10px 0px, rgba(0, 0, 0, 0.2) 0px -1px 0.4px 0px inset, rgb(255, 255, 255) 0px 1px 0.4px 0px inset"
  );
});

test("AC-3.3 : chaque contrôle montre le focus clavier", async ({ page }, info) => {
  test.skip(info.project.name !== "ordinateur");
  const sansFocus: string[] = [];
  // Parcours au clavier : Tab, et on lit ce qui marque l'élément atteint.
  for (let i = 0; i < 60; i++) {
    await page.keyboard.press("Tab");
    const etat = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      // Un champ montre le focus sur son conteneur `.field` (:focus-within).
      const porteur = el.closest<HTMLElement>(".field") ?? el;
      // L'arête d'un champ s'éclaircit en 200 ms : on lit l'état d'arrivée, pas une étape.
      porteur.getAnimations().forEach((animation) => animation.finish());
      const s = getComputedStyle(porteur);
      // Ce que seul le focus produit : l'anneau décalé (outline), l'anneau `--focus` à 40 %
      // (focus-visible:ring-focus) ou le halo de 3 px d'un champ où l'on tape. Le relief « touche »
      // d'un bouton au repos (anneau de 1 px à 12 %) ne compte pas.
      const marque = s.outlineStyle !== "none" && parseFloat(s.outlineWidth) > 0;
      const anneau =
        /rgba\(255, 255, 255, 0\.4\) 0px 0px 0px [1-9]/.test(s.boxShadow) ||
        /rgba\(255, 255, 255, 0\.06\) 0px 0px 0px 3px/.test(s.boxShadow);
      return { nom: `${el.tagName.toLowerCase()} « ${(el.getAttribute("aria-label") ?? el.textContent ?? "").trim().slice(0, 30)} »`, visible: marque || anneau };
    });
    if (etat && !etat.visible) sansFocus.push(etat.nom);
  }
  expect(sansFocus, `sans focus visible : ${sansFocus.join(", ")}`).toEqual([]);
});
