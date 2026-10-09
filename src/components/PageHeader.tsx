"use client";

import { useRef, type ReactNode } from "react";
import { prefersReducedMotion, preset, useGSAP } from "@/lib/motion";

/**
 * En-tête de page (Changelog de Raycast ; docs/design-reference/raycast/composants/titres.md) :
 * grand titre seul en 600, précision en gris dessous, actions sous le titre, description à
 * droite ; un trait pleine largeur le sépare du contenu.
 *
 * Mouvement (spec design-system-v2 § 4.2) : à l'arrivée, titre, actions et description entrent
 * en courte cascade ; quand le titre change (source des recommandations, vue du classement), le
 * nouveau texte fond sur place, sans rien rejouer (règle 2).
 */
export function PageHeader({
  title,
  lead,
  description,
  actions,
}: {
  title: string;
  lead?: string;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  const root = useRef<HTMLElement | null>(null);
  // Le texte vit dans un élément à clé : React le remplace entier quand il change.
  const titleKey = `${title}|${lead ?? ""}`;
  // Comparaison de clés, pas un simple drapeau : le double montage du mode strict de React garde
  // ainsi l'entrée d'arrivée.
  const shownKey = useRef<string | null>(null);

  useGSAP(
    () => {
      const previous = shownKey.current;
      shownKey.current = titleKey;
      if (prefersReducedMotion() || !root.current) return;
      const heading = root.current.querySelector<HTMLElement>("[data-title]");
      if (!heading) return;
      if (previous !== null && previous !== titleKey) {
        preset.swap(heading);
        return;
      }
      preset.enter([heading, ...Array.from(root.current.querySelectorAll<HTMLElement>("[data-reveal]"))]);
    },
    { scope: root, dependencies: [titleKey], revertOnUpdate: true }
  );

  return (
    <>
      <header
        ref={root}
        className="grid gap-6 pb-10 pt-10 sm:pt-16 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)] lg:items-end lg:gap-16 lg:pb-14"
      >
        <div className="min-w-0">
          <div key={titleKey} data-title>
            <h1 className="text-balance text-heading text-foreground sm:text-heading-lg">{title}</h1>
            {lead && <p className="mt-3 max-w-2xl text-balance text-lg text-muted">{lead}</p>}
          </div>
          {actions && (
            <div data-reveal className="mt-8 flex flex-wrap items-center gap-2">
              {actions}
            </div>
          )}
        </div>
        {description && (
          <div data-reveal className="text-base leading-6 text-body">
            {description}
          </div>
        )}
      </header>
      <div className="rule mb-8" />
    </>
  );
}
