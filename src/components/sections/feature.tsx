import type { ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Check, Layers } from "lucide-react";
import { MonoMeta } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

// Sections de fonctionnalité de l'accueil — fiche docs/design-reference/raycast/composants/vitrine.md.
// Le format « texte et visuel côte à côte » de raycast.com (Shared Quicklinks), en alternant les
// côtés ; le visuel est une vraie commande de Catalog (`.feature-stage`), pas une capture.

/** Lien « voir plus » (Ash, blanc au survol, la flèche avance de 2 px). */
export function ArrowLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <Link href={href} className="arrow-link">
      {children}
      <ArrowRight size={16} aria-hidden="true" />
    </Link>
  );
}

/** Surtitre d'une section : la fonction et son icône (le badge Graphite du mur de fonctionnalités). */
export function FeatureEyebrow({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="feature-badge">
      <span aria-hidden="true" className="flex size-4 items-center justify-center">
        {icon}
      </span>
      {children}
    </span>
  );
}

/**
 * Texte d'un côté (surtitre, titre, explication, chiffres, actions), visuel de l'autre ; `reverse`
 * met le visuel à gauche. Côte à côte dès 768 px, le visuel plafonné à 38 rem (demande de
 * l'utilisateur : le texte reste à côté plus longtemps) ; sur téléphone, le texte passe au-dessus.
 */
export function FeatureSection({
  id,
  eyebrow,
  title,
  lead,
  meta,
  points,
  apres,
  actions,
  visual,
  reverse = false,
}: {
  id: string;
  eyebrow: ReactNode;
  title: ReactNode;
  lead: ReactNode;
  /** Chiffres en Geist Mono sous l'explication. */
  meta?: ReactNode;
  /** Comment ça marche, en quelques points (page d'arrivée : plus explicatif que dans l'application). */
  points?: string[];
  /** Ce que les gestes du visiteur y changent (le balayage ouvre la suite, specs/bienvenue-v1.md). */
  apres?: ReactNode;
  actions?: ReactNode;
  visual: ReactNode;
  reverse?: boolean;
}) {
  const headingId = `${id}-titre`;
  return (
    <section
      id={id}
      aria-labelledby={headingId}
      className={cn(
        "grid items-center gap-8 md:gap-10 lg:gap-16",
        reverse
          ? "md:grid-cols-[minmax(0,6fr)_minmax(0,5fr)] lg:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]"
          : "md:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]"
      )}
    >
      <div className={cn("flex max-w-md flex-col items-start gap-6", reverse && "md:order-2")}>
        {eyebrow}
        <div className="flex flex-col gap-3">
          <h2 id={headingId} className="text-balance text-heading-sm text-foreground lg:text-heading">
            {title}
          </h2>
          <p className="text-base text-muted">{lead}</p>
        </div>
        {points && points.length > 0 && (
          <ul className="flex flex-col gap-2 text-sm text-muted">
            {points.map((point) => (
              <li key={point} className="flex items-start gap-2">
                <Check size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-subtle" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        )}
        {apres && (
          <p className="flex items-start gap-2 border-l border-divider pl-3 text-sm text-foreground">
            <Layers size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-subtle" />
            <span>{apres}</span>
          </p>
        )}
        {meta && <MonoMeta>{meta}</MonoMeta>}
        {actions && <div className="flex flex-wrap items-center gap-x-6 gap-y-3">{actions}</div>}
      </div>
      <div className={cn("w-full min-w-0 max-w-[38rem]", reverse ? "md:order-1 md:justify-self-start" : "md:justify-self-end")}>
        {visual}
      </div>
    </section>
  );
}
