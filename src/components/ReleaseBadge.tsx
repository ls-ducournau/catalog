import { CalendarDays, Clapperboard } from "lucide-react";
import { releaseBadge, type ReleaseInfo } from "@/lib/release";

/**
 * Sorties (sorties-v1 FR-2) : « Au cinéma » et « À venir » (daté), en pastilles sombres sur l'affiche.
 * Aucune couleur : l'icône et le libellé portent l'information (DESIGN.md, système monochrome).
 * Rien quand il n'y a rien à signaler. Calculé à l'affichage : il dépend du jour.
 */
export function ReleaseBadge({ release }: { release: ReleaseInfo | null }) {
  const badge = releaseBadge(release);
  if (!badge) return null;

  if (badge.kind === "in_theaters") {
    return (
      <span className="overlay-pill shrink-0">
        <Clapperboard size={12} aria-hidden="true" />
        Au cinéma
      </span>
    );
  }

  return (
    <span
      title={badge.label}
      className="overlay-pill min-w-0"
    >
      <CalendarDays size={12} className="shrink-0" aria-hidden="true" />
      <span className="truncate">{badge.label}</span>
    </span>
  );
}
