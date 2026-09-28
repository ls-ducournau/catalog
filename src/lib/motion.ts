"use client";

// Mouvement — spec: specs/design-system-v2-raycast.md (§ 4)
//
// Registre productif, relevé sur Raycast : court, courbes « out », aucun dépassement ni ressort.
// Valeurs générées depuis design/tokens.json (src/lib/tokens.ts), comme les variables CSS --dur-*
// et --ease-*. Règles du skill gsap-react : extensions enregistrées une seule fois, côté
// navigateur ; animations créées dans useGSAP() ou un gsap.context().
//
// Hors de ce fichier et de components/motion/, on n'écrit pas de tween : on appelle un préréglage
// (`preset.enter`, `preset.swap`, `preset.slide`), pour que tout bouge de la même façon.

import { gsap } from "gsap";
import { CustomEase } from "gsap/CustomEase";
import { Flip } from "gsap/Flip";
import { useGSAP } from "@gsap/react";
import { CASCADE_MAX_TOKEN, DURATION_TOKENS, EASING_TOKENS, ENTER_Y_TOKEN, STAGGER_TOKEN } from "@/lib/tokens";

/** Courbes (§ 4.1). `out` : entrées, déplacements ; `standard` : couleurs, opacités d'état. */
export const EASE = { out: "out", standard: "standard" } as const;

/** Durées (§ 4.1), en secondes. `swap` : fondu d'un changement de vue (règle 2). */
export const DURATION = DURATION_TOKENS;

/** Cascade d'arrivée (règle 3) : 30 ms d'écart, 8 éléments au plus. */
export const STAGGER = STAGGER_TOKEN;
export const CASCADE_MAX = CASCADE_MAX_TOKEN;

/** Entrée : opacité et 8 px de montée, sans flou (règle 6). */
export const ENTER_FROM = { autoAlpha: 0, y: ENTER_Y_TOKEN } as const;

/** Réagencement d'une grille (règle 5). */
export const FLIP = { duration: DURATION.slow, ease: EASE.out, max: 120 } as const;

if (typeof window !== "undefined") {
  gsap.registerPlugin(useGSAP, CustomEase, Flip);
  CustomEase.create(EASE.out, EASING_TOKENS.out);
  CustomEase.create(EASE.standard, EASING_TOKENS.standard);
  gsap.defaults({ ease: EASE.out, duration: DURATION.base });

  gsap.registerEffect({
    name: "enter",
    effect: (targets: gsap.TweenTarget, config: { duration: number; stagger: gsap.TweenVars["stagger"] }) =>
      gsap.from(targets, {
        ...ENTER_FROM,
        duration: config.duration,
        ease: EASE.out,
        stagger: config.stagger,
        clearProps: "opacity,visibility,transform",
      }),
    defaults: { duration: DURATION.fast, stagger: STAGGER },
  });

  gsap.registerEffect({
    name: "swap",
    effect: (targets: gsap.TweenTarget) =>
      gsap.from(targets, { autoAlpha: 0, duration: DURATION.swap, ease: EASE.standard, clearProps: "opacity,visibility" }),
  });

  gsap.registerEffect({
    name: "slide",
    effect: (targets: gsap.TweenTarget, config: { to: gsap.TweenVars; duration: number }) =>
      gsap.to(targets, { ...config.to, duration: config.duration, ease: EASE.out, overwrite: true }),
    defaults: { duration: DURATION.base },
  });
}

type Tween = gsap.core.Tween;

/** Les préréglages, typés. */
export const preset = {
  /** Arrivée : opacité et montée, en cascade si plusieurs cibles. */
  enter: (targets: gsap.TweenTarget, config?: { stagger?: gsap.TweenVars["stagger"] }): Tween =>
    gsap.effects.enter(targets, config),
  /** Changement de vue, de filtre, de texte : fondu de 150 ms, rien ne bouge. */
  swap: (targets: gsap.TweenTarget): Tween => gsap.effects.swap(targets),
  /** Un repère (pastille d'onglet, de lien) glisse jusqu'à sa cible. */
  slide: (targets: gsap.TweenTarget, to: gsap.TweenVars, config?: { duration?: number }): Tween =>
    gsap.effects.slide(targets, { to, ...config }),
};

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// En développement, les tests de mouvement (tests/motion) lisent les tweens en cours.
if (typeof window !== "undefined" && process.env.NODE_ENV !== "production") {
  (window as unknown as { __gsap?: typeof gsap }).__gsap = gsap;
}

export { gsap, Flip, useGSAP };
