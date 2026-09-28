"use client";

import { useEffect, useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { CASCADE_MAX, STAGGER, gsap, prefersReducedMotion, preset } from "@/lib/motion";

// Apparitions — spec: specs/design-system-v2-raycast.md (§ 4.2, règles 2 et 3)
//
// Un conteneur marqué `data-stagger` s'anime une fois, à son apparition :
// - première arrivée sur une page (rien n'a encore été touché) : cascade courte, 30 ms d'écart,
//   plafonnée à 8 pas (400 ms au total) ;
// - après un geste (clic, touche), c'est un changement de vue : simple fondu de 150 ms, rien ne
//   monte. C'était la cause des « rebonds » : la cascade se rejouait à chaque onglet ou filtre.
// Quand un filtre change le contenu d'un conteneur déjà là, c'est FlipGrid qui réorganise.

/** Au-delà, les éléments sont sous la ligne de flottaison : ils apparaissent sans animation. */
const ANIMATED_MAX = 40;

export function MotionRoot() {
  const pathname = usePathname();
  const interacted = useRef(false);

  // Nouvelle page : ses listes font leur première arrivée. Effet de mise en page : il passe avant
  // l'observateur de mutations, qui découvre les listes de la nouvelle page.
  useLayoutEffect(() => {
    interacted.current = false;
  }, [pathname]);

  useEffect(() => {
    if (prefersReducedMotion()) return;
    // Toutes les animations vivent dans un contexte GSAP, annulé si la racine disparaît.
    const ctx = gsap.context(() => {});
    function onInteract() {
      interacted.current = true;
    }
    document.addEventListener("pointerdown", onInteract, true);
    document.addEventListener("keydown", onInteract, true);

    function animate(container: HTMLElement) {
      const items = Array.from(container.children).slice(0, ANIMATED_MAX) as HTMLElement[];
      if (items.length === 0) return;
      container.dataset.staggered = "";
      ctx.add(() => {
        if (interacted.current) preset.swap(container);
        else preset.enter(items, { stagger: (i: number) => Math.min(i, CASCADE_MAX - 1) * STAGGER });
      });
    }

    function scan() {
      document.querySelectorAll<HTMLElement>("[data-stagger]:not([data-staggered])").forEach(animate);
    }
    scan();
    // Les observateurs de mutation passent avant l'affichage : l'état de départ est posé avant que
    // le contenu ne soit peint, sans clignotement.
    const observer = new MutationObserver(scan);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      observer.disconnect();
      document.removeEventListener("pointerdown", onInteract, true);
      document.removeEventListener("keydown", onInteract, true);
      ctx.revert();
    };
  }, []);

  return null;
}
