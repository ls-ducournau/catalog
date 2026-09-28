"use client";

import { useRef, useState } from "react";
import { DURATION, EASE, gsap, prefersReducedMotion, useGSAP } from "@/lib/motion";

/**
 * Nombre qui défile jusqu'à sa nouvelle valeur (compatibilité, compteurs). `from` : valeur de
 * départ au premier affichage (0 pour un compteur qui « monte ») ; sans elle, rien ne bouge au
 * premier affichage. 300 ms, sans ressort. spec: specs/design-system-v2-raycast.md (§ 4.2, règle 7)
 *
 * React écrit le texte une fois ; ensuite, seul GSAP le met à jour (sinon React et l'animation se
 * disputeraient le même nœud de texte).
 */
export function NumberRoll({
  value,
  from,
  suffix = "",
  className = "",
}: {
  value: number;
  from?: number;
  suffix?: string;
  className?: string;
}) {
  const el = useRef<HTMLSpanElement | null>(null);
  const shown = useRef<number | null>(null);
  // Figé au premier rendu : React ne réécrit plus ce texte, GSAP s'en charge.
  const [initial] = useState(() => `${from ?? value}${suffix}`);

  useGSAP(
    () => {
      const node = el.current;
      if (!node) return;
      const start = shown.current ?? from ?? value;
      shown.current = value;
      if (start === value || prefersReducedMotion()) {
        node.textContent = `${value}${suffix}`;
        return;
      }
      const counter = { n: start };
      gsap.to(counter, {
        n: value,
        duration: DURATION.base,
        ease: EASE.out,
        onUpdate: () => {
          node.textContent = `${Math.round(counter.n)}${suffix}`;
        },
      });
    },
    { dependencies: [value, suffix] }
  );

  return (
    <span ref={el} className={`tabular-nums ${className}`}>
      {initial}
    </span>
  );
}
