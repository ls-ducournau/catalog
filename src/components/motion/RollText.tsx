"use client";

import { useRef } from "react";
import { DURATION, EASE, gsap, prefersReducedMotion, useGSAP } from "@/lib/motion";

/**
 * Libellé qui « roule » quand il change (« Vu » ⇄ « À voir ») : le nouveau monte du bas et se pose,
 * sans dépassement. Rien au premier affichage. spec: specs/design-system-v2-raycast.md (§ 4.2)
 */
export function RollText({ text, className = "" }: { text: string; className?: string }) {
  const clip = useRef<HTMLSpanElement | null>(null);
  const previous = useRef<string | null>(null);

  useGSAP(
    () => {
      const before = previous.current;
      previous.current = text;
      if (before === null || before === text || prefersReducedMotion()) return;
      gsap.from("[data-roll]", { yPercent: 60, autoAlpha: 0, duration: DURATION.fast, ease: EASE.out });
    },
    { scope: clip, dependencies: [text] }
  );

  return (
    <span ref={clip} className={`inline-flex overflow-hidden ${className}`}>
      <span data-roll className="inline-block">
        {text}
      </span>
    </span>
  );
}
