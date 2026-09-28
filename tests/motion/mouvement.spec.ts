import { expect, test, type Page } from "@playwright/test";
import { bloquerEcritures } from "../securite";

// Phase 1 du système de design v2 (spec § 10, AC-1.2 à AC-1.4) : ce qui bouge après un geste. On
// enregistre, image par image, les tweens GSAP (exposés en développement par src/lib/motion.ts)
// et les animations CSS, puis on vérifie les règles du § 4.2.

type Releve = {
  gsap: { duree: number; proprietes: string[]; cascade: boolean; cibles: string }[];
  css: { nom: string; duree: number; proprietes: string[] }[];
};

/** Propriétés qui déplacent ou déforment : interdites après un geste (hors repères glissants). */
const MOUVEMENT = ["x", "y", "xPercent", "yPercent", "scale", "scaleX", "scaleY", "rotation", "filter"];
/** Repères qui glissent jusqu'à leur cible (préréglage `slide`) : permis. */
const REPERES = /segmented-pill|glide-pill/;
const REGLAGES = new Set([
  "onComplete", "onUpdate", "onStart", "onInterrupt", "callbackScope", "clearProps", "overwrite", "immediateRender",
  "lazy", "runBackwards", "startAt", "data", "ease", "parent", "id", "stagger", "delay", "duration", "paused", "inherit",
]);

async function relever(page: Page, geste: () => Promise<void>, ms = 900): Promise<Releve> {
  const enregistrement = page.evaluate(
    async ({ ms, reglages }) => {
      const g = (window as unknown as { __gsap?: { globalTimeline: { getChildren: (a: boolean, b: boolean, c: boolean) => unknown[] } } }).__gsap;
      type T = { duration: () => number; vars: Record<string, unknown>; targets: () => unknown[] };
      const vus = new Map<unknown, Releve["gsap"][number]>();
      const css = new Map<unknown, Releve["css"][number]>();
      const debut = performance.now();
      while (performance.now() - debut < ms) {
        for (const t of (g?.globalTimeline.getChildren(true, true, false) ?? []) as T[]) {
          if (vus.has(t)) continue;
          vus.set(t, {
            duree: t.duration(),
            proprietes: Object.keys(t.vars).filter((k) => !reglages.includes(k)),
            cascade: Boolean(t.vars.stagger),
            cibles: t
              .targets()
              .map((c) => (c instanceof Element ? `${c.tagName.toLowerCase()}.${String(c.className).slice(0, 50)}` : typeof c))
              .join(" | ")
              .slice(0, 160),
          });
        }
        for (const a of document.getAnimations()) {
          if (css.has(a) || !(a instanceof CSSAnimation)) continue;
          const effet = a.effect as KeyframeEffect | null;
          const images = effet?.getKeyframes() ?? [];
          const proprietes = [
            ...new Set(images.flatMap((k) => Object.keys(k).filter((p) => !["offset", "easing", "composite", "computedOffset"].includes(p)))),
          ];
          css.set(a, { nom: a.animationName, duree: Number(effet?.getTiming().duration ?? 0), proprietes });
        }
        await new Promise((r) => requestAnimationFrame(r));
      }
      return { gsap: [...vus.values()], css: [...css.values()] };
    },
    { ms, reglages: [...REGLAGES] }
  );
  await geste();
  return enregistrement;
}

function sansMouvement(releve: Releve) {
  for (const t of releve.gsap) {
    if (REPERES.test(t.cibles)) continue;
    expect(t.cascade, `cascade après un geste : ${t.cibles}`).toBe(false);
    expect(t.proprietes.filter((p) => MOUVEMENT.includes(p)), `mouvement après un geste : ${t.cibles}`).toEqual([]);
    expect(t.duree, `fondu trop long : ${t.cibles}`).toBeLessThanOrEqual(0.15 + 1e-6);
  }
  for (const a of releve.css) {
    if (a.nom === "shimmer") continue;
    expect(a.proprietes.filter((p) => p !== "opacity"), `animation CSS qui bouge : ${a.nom}`).toEqual([]);
    expect(a.duree, `animation CSS trop longue : ${a.nom}`).toBeLessThanOrEqual(200);
  }
}

async function ouvrir(page: Page, chemin: string): Promise<string[]> {
  const bloquees = await bloquerEcritures(page);
  await page.goto(chemin);
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  await page.waitForTimeout(1200);
  return bloquees;
}

test.beforeEach(({}, info) => {
  test.skip(info.project.name !== "ordinateur", "Mouvement : vérifié une fois, à la largeur ordinateur.");
});

test.describe("mouvement standard", () => {
  test.use({ reducedMotion: "no-preference" });

  test("AC-1.2 : changer de vue ne rejoue ni cascade ni montée", async ({ page }) => {
    await ouvrir(page, "/classement");
    const releve = await relever(page, () => page.getByRole("radio", { name: "Personnes" }).click());
    sansMouvement(releve);
  });

  test("AC-1.3 : une touche de duel n'anime pas le résultat", async ({ page }) => {
    const bloquees = await ouvrir(page, "/duels");
    const releve = await relever(page, () => page.keyboard.press("1"));
    // Le duel est bien parti (réponse simulée, rien n'est écrit) et la paire suivante est là.
    expect(bloquees).toContain("POST /api/duels/result");
    sansMouvement(releve);
  });

  test("Règle 3 : l'arrivée sur une page est une cascade courte, sans dépassement", async ({ page }) => {
    await ouvrir(page, "/classement");
    const releve = await relever(
      page,
      () => page.getByRole("navigation", { name: "Navigation principale" }).getByRole("link", { name: "Bibliothèque" }).click(),
      2500
    );
    const cascades = releve.gsap.filter((t) => t.cascade);
    expect(cascades.length, "une cascade d'arrivée").toBeGreaterThan(0);
    for (const t of cascades) {
      expect(t.proprietes).toContain("y");
      expect(t.duree, `cascade trop longue : ${t.cibles}`).toBeLessThanOrEqual(0.45);
    }
  });
});

test.describe("mouvement réduit", () => {
  test.use({ reducedMotion: "reduce" });

  test("AC-1.4 : en mouvement réduit, seulement des opacités de 150 ms au plus", async ({ page }) => {
    await ouvrir(page, "/classement");
    const vue = await relever(page, () => page.getByRole("radio", { name: "Personnes" }).click());
    await ouvrir(page, "/duels");
    const duel = await relever(page, () => page.keyboard.press("1"));
    for (const releve of [vue, duel]) {
      for (const t of releve.gsap) {
        if (REPERES.test(t.cibles)) continue;
        expect(t.proprietes.filter((p) => MOUVEMENT.includes(p)), t.cibles).toEqual([]);
        expect(t.duree).toBeLessThanOrEqual(0.15 + 1e-6);
      }
      for (const a of releve.css) {
        expect(a.proprietes.filter((p) => p !== "opacity"), a.nom).toEqual([]);
        expect(a.duree, a.nom).toBeLessThanOrEqual(150);
      }
    }
  });
});
