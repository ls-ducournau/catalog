"use client";

import { useRef, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { gsap, prefersReducedMotion, preset, useGSAP } from "@/lib/motion";

/**
 * Choix exclusif (mode de duel, famille de tri, catégorie) : rail sombre, option choisie en
 * pastille claire, comme les sélecteurs d'Eno. La pastille glisse d'une option à l'autre.
 * spec: specs/design-system-v1.md (FR-4, FR-8)
 */
export function SegmentedControl<T extends string>({
  label,
  options,
  value,
  onChange,
  subtle = false,
}: {
  label: string;
  /**
   * `icon` facultatif : un libellé qui se suffit n'en a pas besoin. `display` : rendu riche (des
   * étoiles) à la place du libellé ; le nom lu devient alors `title`, sinon `label`.
   */
  options: { value: T; label: string; icon?: LucideIcon; title?: string; display?: ReactNode }[];
  value: T;
  onChange: (value: T) => void;
  /** Rang secondaire (la catégorie, sous le mode) : sans rail, choix en gris. */
  subtle?: boolean;
}) {
  const rail = useRef<HTMLDivElement | null>(null);
  const placed = useRef(false);

  // La pastille suit l'option choisie : posée d'emblée la première fois, glissée ensuite. Tant
  // qu'elle n'est pas posée (rendu serveur), chaque option dessine son propre fond.
  useGSAP(
    (_context, contextSafe) => {
      const railEl = rail.current;
      const pill = railEl?.querySelector<HTMLElement>(".segmented-pill");
      if (!railEl || !pill || !contextSafe) return;

      const place = contextSafe((animated: boolean) => {
        const active = railEl.querySelector<HTMLElement>('[aria-checked="true"]');
        if (!active) {
          gsap.set(pill, { autoAlpha: 0 });
          return;
        }
        const target = {
          x: active.offsetLeft,
          y: active.offsetTop,
          width: active.offsetWidth,
          height: active.offsetHeight,
          autoAlpha: 1,
        };
        // Glisse seulement depuis une pastille réellement affichée. Après un remontage (changement
        // de palier des Duels) ou le double montage du mode strict, le contexte GSAP a été annulé :
        // la pastille est retombée invisible à l'origine, elle se pose sans glisser.
        const shown = parseFloat(getComputedStyle(pill).opacity) > 0;
        if (animated && placed.current && shown && !prefersReducedMotion()) {
          preset.slide(pill, target);
        } else {
          gsap.set(pill, target);
        }
        placed.current = true;
        railEl.dataset.pill = "";
      });

      place(true);
      // Le rail peut passer à la ligne (mobile) : la pastille se recale sans animation.
      const observer = new ResizeObserver(() => place(false));
      observer.observe(railEl);
      return () => observer.disconnect();
    },
    { scope: rail, dependencies: [value, options.length] }
  );

  return (
    <div ref={rail} role="radiogroup" aria-label={label} className={`segmented ${subtle ? "segmented-subtle" : ""}`}>
      <span aria-hidden="true" className="segmented-pill" />
      {options.map((option) => {
        const Icon = option.icon;
        return (
          <button
            key={option.label}
            role="radio"
            aria-checked={option.value === value}
            title={option.title}
            aria-label={option.display ? (option.title ?? option.label) : undefined}
            onClick={() => onChange(option.value)}
            className="segmented-item"
          >
            {/* Rang secondaire : sans icône sur mobile, pour tenir sur une ligne. */}
            {Icon && <Icon size={14} aria-hidden="true" className={subtle ? "hidden sm:block" : undefined} />}
            {option.display ?? option.label}
          </button>
        );
      })}
    </div>
  );
}
