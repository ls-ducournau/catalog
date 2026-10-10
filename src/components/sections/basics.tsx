import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

// Blocs de base des sections (spec design-system-v2-raycast.md § 6), à part de l'index pour que
// les sections client (vitrine) les importent sans dépendance circulaire.

/** Barre d'outils d'une liste (Store) : onglets à gauche ; filtres et recherche à droite. */
/**
 * Barre d'outils : filtres au début, tri à la fin. Au téléphone, les filtres défilent sur une
 * seule ligne jusqu'aux bords de l'écran au lieu de s'empiler (audit UX 2026-10-09, W3-1) ; la
 * marge verticale garde les anneaux de focus visibles malgré le défilement.
 */
export function Toolbar({ start, end, className }: { start?: ReactNode; end?: ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-3", className)}>
      {start && (
        <div className="scroll-row -mx-4 -my-1 flex w-[calc(100%+2rem)] min-w-0 flex-nowrap items-center gap-2 overflow-x-auto px-4 py-1 *:shrink-0 sm:mx-0 sm:my-0 sm:w-auto sm:flex-wrap sm:overflow-visible sm:p-0">
          {start}
        </div>
      )}
      {end && <div className="ml-auto flex min-w-0 flex-wrap items-center gap-2">{end}</div>}
    </div>
  );
}

/** Titre de section (« Featured » du Store) : titre de 20 px en 500, précision en gris dessous, action à droite. */
export function SectionHeading({
  title,
  lead,
  action,
  as: Tag = "h2",
  id,
}: {
  title: ReactNode;
  lead?: ReactNode;
  action?: ReactNode;
  as?: "h2" | "h3";
  id?: string;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        <Tag id={id} className="text-subheading text-foreground">
          {title}
        </Tag>
        {lead && <p className="mt-2 text-sm text-muted">{lead}</p>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
