import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { Divider, Eyebrow, IconCircle, MetaRow } from "@/components/ui/primitives";
import { ActionBar, type Action } from "@/components/ui/command";
import { SectionHeading } from "./basics";

// Sections — spec: specs/design-system-v2-raycast.md § 6. Blocs réutilisables qu'un archétype
// (components/layouts) assemble ; chacun reprend une section relevée sur raycast.com.

export { PageHeader } from "@/components/PageHeader";
export { SectionHeading, Toolbar } from "./basics";
export { FeatureWall, ShowcaseCard, ShowcaseCarousel, TitleListSection, TitleRowCard } from "./showcase";
export { ArrowLink, FeatureEyebrow, FeatureSection } from "./feature";
export { DuelPreview, RatingPreview, ReleasesPreview } from "./previews";
export { RecommendationsWall } from "./recommendations-wall";
export { PlaylistPreview } from "./playlist-preview";
export { FlipGrid as MediaGrid } from "@/components/motion/FlipGrid";
export { RecommendationRow as MediaRow } from "@/components/RecommendationRow";

/** Rangée « Featured » du Store : trois cartes centrées sous un titre. */
export function FeaturedRow({ title, lead, children }: { title: ReactNode; lead?: ReactNode; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-8">
      <SectionHeading title={title} lead={lead} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 lg:gap-8">{children}</div>
    </section>
  );
}

/**
 * Entrée de chronologie (Changelog) : colonne gauche collante (badge, date), contenu à droite.
 * Sur téléphone, la date passe au-dessus.
 */
export function TimelineSection({
  aside,
  children,
  id,
  className,
  ...aria
}: {
  aside?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  return (
    <section id={id} {...aria} className={cn("grid md:grid-cols-[11rem_minmax(0,1fr)] md:gap-10", aside && "gap-3", className)}>
      {aside && (
        // Collante sous la barre de navigation : sur téléphone, elle passe au-dessus du contenu
        // (fond de page et léger flou pour rester lisible), sur ordinateur dans sa colonne.
        <div className="sticky top-[4.25rem] z-20 -mx-4 bg-background/85 px-4 py-2 backdrop-blur-md md:top-20 md:z-auto lg:top-28 md:mx-0 md:self-start md:bg-transparent md:p-0 md:backdrop-blur-none">
          {aside}
        </div>
      )}
      <div className={cn("min-w-0", !aside && "md:col-start-2")}>{children}</div>
    </section>
  );
}

/** En-tête de fiche (page d'extension) : visuel, titre, résumé, métadonnées, actions. */
export function DetailHeader({
  media,
  title,
  summary,
  meta,
  actions,
}: {
  media?: ReactNode;
  title: ReactNode;
  summary?: ReactNode;
  meta?: ReactNode[];
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
      {media && <div className="shrink-0">{media}</div>}
      <div className="flex min-w-0 flex-1 flex-col gap-2">
        <h2 className="text-subheading text-foreground">{title}</h2>
        {summary && <p className="text-sm text-muted">{summary}</p>}
        {meta && meta.length > 0 && (
          <MetaRow>
            {meta.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </MetaRow>
        )}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Tableau « Information » : libellé à gauche, valeur à droite, séparés par des filets. */
export function InfoTable({ title, rows }: { title?: ReactNode; rows: { label: ReactNode; value: ReactNode }[] }) {
  return (
    <div className="flex flex-col">
      {title && <Eyebrow className="mb-2">{title}</Eyebrow>}
      <dl className="flex flex-col divide-y divide-divider">
        {rows.map((row, i) => (
          <div key={i} className="flex items-baseline justify-between gap-4 py-2 text-sm">
            <dt className="text-muted">{row.label}</dt>
            <dd className="min-w-0 text-right text-foreground">{row.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/**
 * Fenêtre de commande (App Window) : cadre en relief, en-tête facultatif (recherche), contenu,
 * barre d'actions au pied.
 */
export function CommandWindow({
  head,
  children,
  context,
  primary,
  secondary,
  className,
}: {
  head?: ReactNode;
  children: ReactNode;
  context?: ReactNode;
  primary?: Action;
  secondary?: Action[];
  className?: string;
}) {
  return (
    <div className={cn("bezel w-full", className)}>
      <div className="bezel-inner flex flex-col">
        {head && (
          <>
            <div className="px-3 py-2">{head}</div>
            <Divider />
          </>
        )}
        <div className="min-h-0 flex-1">{children}</div>
        {(context || primary || secondary) && <ActionBar context={context} primary={primary} secondary={secondary} />}
      </div>
    </div>
  );
}

/** Cartes de synthèse (tarifs) : surtitre, titre, contenu ; relief « touche ». */
export function SummaryCards({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("grid gap-4 md:grid-cols-2 xl:grid-cols-3", className)}>{children}</div>;
}

export function SummaryCard({
  eyebrow,
  title,
  children,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("card flex flex-col gap-4 p-6", className)}>
      <div>
        {eyebrow && <Eyebrow className="mb-1">{eyebrow}</Eyebrow>}
        <h3 className="text-base text-foreground">{title}</h3>
      </div>
      {children}
    </div>
  );
}

/** État vide : une icône en cercle, une phrase, une action. */
export function EmptyState({
  icon,
  title,
  children,
  action,
  className,
}: {
  icon?: ReactNode;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col items-center gap-3 px-6 py-12 text-center", className)}>
      {icon && <IconCircle size={48}>{icon}</IconCircle>}
      <p className="text-base font-medium text-foreground">{title}</p>
      {children && <div className="max-w-md text-sm text-muted">{children}</div>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/**
 * Décor du héros (DESIGN.md « Hero Gradient Banner ») : lavis bleu radial et barres corail
 * diagonales, floutées. Le seul endroit où le système sort du gris. Décoratif, sans animation.
 */
export function ShardsBackdrop({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cn("shards pointer-events-none absolute inset-0 -z-10 overflow-hidden", className)} />;
}
