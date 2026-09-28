"use client";

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";

/** Marge minimale conservée avec les bords du viewport. */
const VIEWPORT_MARGIN = 8;
/** Écart entre la carte et l'infobulle. */
const GAP = 10;
/** Attente avant la première infobulle, puis fenêtre pendant laquelle les suivantes sont immédiates. */
const FIRST_DELAY_MS = 300;
const WARM_MS = 600;

/**
 * Dernière fermeture, partagée par toutes les cartes : la première infobulle se mérite, les
 * suivantes suivent la souris tant qu'on reste dans la série.
 */
let lastShownAt = 0;

/** Attente avant d'ouvrir : nulle si une infobulle vient de se fermer, sinon le délai normal. */
export function tooltipDelayMs(): number {
  return Date.now() - lastShownAt < WARM_MS ? 0 : FIRST_DELAY_MS;
}

/** À appeler à la fermeture, pour que la carte suivante réponde immédiatement. */
export function markTooltipShown(): void {
  lastShownAt = Date.now();
}

type Placement = "right" | "left" | "bottom" | "top";

/**
 * Infobulle de synopsis ancrée à une carte.
 *
 * Positionnement : on mesure l'infobulle une fois rendue (sa hauteur dépend du texte, sa largeur
 * est fixe donc le retour à la ligne ne change pas selon l'endroit où on la pose), puis on choisit
 * la place disponible — à droite, sinon à gauche, sinon dessous, sinon dessus — avant de borner le
 * résultat dans le viewport. Rendue en portal sur `body` : aucun `overflow` de la grille ne peut
 * la rogner, et elle ne dépend pas de l'ordre d'empilement des cartes voisines.
 */
export function SynopsisTooltip({
  anchor,
  text,
  onDismiss,
}: {
  anchor: HTMLElement;
  text: string;
  onDismiss: () => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [layout, setLayout] = useState<{ top: number; left: number; placement: Placement } | null>(
    null
  );

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;

    const card = anchor.getBoundingClientRect();
    const tip = el.getBoundingClientRect();
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const fitsRight = card.right + GAP + tip.width <= vw - VIEWPORT_MARGIN;
    const fitsLeft = card.left - GAP - tip.width >= VIEWPORT_MARGIN;

    let left: number;
    let top: number;
    let placement: Placement;

    if (fitsRight || fitsLeft) {
      placement = fitsRight ? "right" : "left";
      left = fitsRight ? card.right + GAP : card.left - GAP - tip.width;
      // Centrée sur la carte, puis ramenée dans le viewport.
      top = card.top + card.height / 2 - tip.height / 2;
    } else {
      // Pas la place sur les côtés (petite fenêtre, carte large) : on bascule dessous ou dessus.
      const fitsBottom = card.bottom + GAP + tip.height <= vh - VIEWPORT_MARGIN;
      placement = fitsBottom ? "bottom" : "top";
      top = fitsBottom ? card.bottom + GAP : card.top - GAP - tip.height;
      left = card.left + card.width / 2 - tip.width / 2;
    }

    const clamp = (value: number, max: number) =>
      Math.min(Math.max(VIEWPORT_MARGIN, value), Math.max(VIEWPORT_MARGIN, max));

    setLayout({
      top: clamp(top, vh - VIEWPORT_MARGIN - tip.height),
      left: clamp(left, vw - VIEWPORT_MARGIN - tip.width),
      placement,
    });
  }, [anchor, text]);

  // Au moindre défilement ou redimensionnement, l'ancre bouge : on referme plutôt que de
  // recalculer en continu (le pointeur a de toute façon quitté la carte).
  useEffect(() => {
    window.addEventListener("scroll", onDismiss, true);
    window.addEventListener("resize", onDismiss);
    return () => {
      window.removeEventListener("scroll", onDismiss, true);
      window.removeEventListener("resize", onDismiss);
    };
  }, [onDismiss]);

  // L'origine de l'animation suit le côté d'apparition : l'infobulle sort de la carte.
  const origin: Record<Placement, string> = {
    right: "center left",
    left: "center right",
    bottom: "top center",
    top: "bottom center",
  };

  return createPortal(
    <div
      ref={ref}
      role="tooltip"
      style={
        {
          position: "fixed",
          top: layout?.top ?? 0,
          left: layout?.left ?? 0,
          // Premier rendu invisible : le temps de mesurer, on évite de la voir sauter.
          visibility: layout ? "visible" : "hidden",
          "--menu-origin": layout ? origin[layout.placement] : "center",
        } as CSSProperties
      }
      className="menu-pop pointer-events-none z-[70] w-[19rem] max-w-[calc(100vw-1rem)] card rounded-xl p-3 text-xs leading-relaxed text-foreground shadow-xl"
    >
      <span className="line-clamp-6">{text}</span>
    </div>,
    document.body
  );
}
