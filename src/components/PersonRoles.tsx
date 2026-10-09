import { BriefcaseBusiness, Clapperboard, Drama, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/primitives";
import type { PersonRole } from "@/lib/personCredits";
import { cn } from "@/lib/utils";

// Rôles d'une personne (interprète, réalisation, production), lisibles d'un coup d'œil : un badge
// par rôle, avec son icône, partout où une personne est présentée (Classement, Tri rapide).

export const ROLE_LABEL: Record<PersonRole, string> = {
  cast: "Interprète",
  director: "Réalisation",
  producer: "Production",
};

/** Pluriel, pour les filtres (« Interprètes »). */
export const ROLE_PLURAL: Record<PersonRole, string> = {
  cast: "Interprètes",
  director: "Réalisation",
  producer: "Production",
};

export const ROLE_ICON: Record<PersonRole, LucideIcon> = {
  cast: Drama,
  director: Clapperboard,
  producer: BriefcaseBusiness,
};

/** Ordre de lecture : on reconnaît d'abord une personne à l'écran, puis derrière la caméra. */
export const ROLE_ORDER: PersonRole[] = ["cast", "director", "producer"];

export function RoleBadges({ roles, className }: { roles: PersonRole[]; className?: string }) {
  const sorted = ROLE_ORDER.filter((role) => roles.includes(role));
  if (sorted.length === 0) return null;
  return (
    <span className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {sorted.map((role) => {
        const Icon = ROLE_ICON[role];
        return (
          <Badge key={role}>
            <Icon size={12} aria-hidden="true" />
            {ROLE_LABEL[role]}
          </Badge>
        );
      })}
    </span>
  );
}
