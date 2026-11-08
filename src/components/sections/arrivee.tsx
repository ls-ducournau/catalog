import type { CSSProperties, ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Heart } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { StarCount } from "@/components/StarRating";
import { IconCircle, Keycap } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { ArrowLink } from "./feature";

// Sections de la page d'arrivée — docs/audit/landing-visite-app-2026-11-07.md (§ 3). Elle convainc, elle
// n'enregistre rien : des affiches, des explications et des liens vers la visite, aucune commande qui
// écrit. Cinq blocs : le héros (et l'éventail d'affiches), comment ça marche, tout ce que tu y trouves,
// pourquoi Catalog, le dernier appel et le pied de page.

export type Affiche = { name: string; posterUrl: string | null };

function AfficheImage({ affiche, className }: { affiche: Affiche; className?: string }) {
  return (
    <div className={cn("poster aspect-[2/3]", className)}>
      {affiche.posterUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={affiche.posterUrl} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" />
      )}
    </div>
  );
}

/** Les titres du moment en éventail, sous le héros : des affiches, rien à cliquer. Cinq au téléphone, sept ensuite. */
export function PosterFan({ posters, label }: { posters: Affiche[]; label: string }) {
  const milieu = (posters.length - 1) / 2;
  return (
    <ul aria-label={label} className="poster-fan">
      {posters.map((affiche, i) => {
        const ecart = i - milieu;
        return (
          <li
            key={`${affiche.name}-${i}`}
            style={{ "--i": ecart, "--d": Math.abs(ecart) } as CSSProperties}
            className={cn(Math.abs(ecart) > 2 && "max-sm:hidden")}
          >
            <AfficheImage affiche={affiche} />
            <span className="sr-only">{affiche.name}</span>
          </li>
        );
      })}
    </ul>
  );
}

export type StepVisual =
  | { kind: "note"; affiche: Affiche; etoiles: number }
  | { kind: "duel"; affiches: [Affiche, Affiche] }
  | { kind: "reco"; affiche: Affiche; parce: string };

/** L'image d'un temps : une affiche notée, deux affiches face à face, une recommandation et sa raison. */
function StepPicture({ visual }: { visual: StepVisual }) {
  return (
    <div aria-hidden="true" className="flex h-60 items-end justify-center gap-3">
      {visual.kind === "note" && (
        <div className="flex flex-col items-center gap-3">
          <AfficheImage affiche={visual.affiche} className="w-28" />
          <StarCount value={visual.etoiles} size={16} />
        </div>
      )}
      {visual.kind === "duel" && (
        <div className="flex items-center gap-3 pb-7">
          <AfficheImage affiche={visual.affiches[0]} className="w-24" />
          <span className="text-xs text-muted">ou</span>
          <AfficheImage affiche={visual.affiches[1]} className="w-24" />
        </div>
      )}
      {visual.kind === "reco" && (
        <div className="flex w-40 flex-col items-center gap-3">
          <AfficheImage affiche={visual.affiche} className="w-28" />
          <p className="flex max-w-full items-center gap-1.5 text-xs text-muted">
            <Heart size={12} aria-hidden="true" className="shrink-0" />
            <span className="truncate">Parce que tu as aimé {visual.parce}</span>
          </p>
        </div>
      )}
    </div>
  );
}

function Titre({ id, children, lead }: { id: string; children: ReactNode; lead?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 text-center">
      <h2 id={id} className="text-balance text-heading-sm text-foreground lg:text-heading">
        {children}
      </h2>
      {lead && <p className="max-w-md text-base text-muted">{lead}</p>}
    </div>
  );
}

/** « Comment ça marche » : trois temps numérotés, chacun avec ses affiches et son étape de la visite. */
export function HowItWorks({
  id,
  title,
  steps,
}: {
  id: string;
  title: ReactNode;
  steps: { title: string; text: string; href: string; action: string; visual?: StepVisual }[];
}) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="flex flex-col gap-10">
      <Titre id={`${id}-titre`}>{title}</Titre>
      <ol className="grid gap-12 md:grid-cols-3 md:gap-8">
        {steps.map((step, i) => (
          <li key={step.title} className="flex flex-col items-center gap-5 text-center">
            {step.visual && <StepPicture visual={step.visual} />}
            <div className="flex flex-col items-center gap-3">
              <Keycap aria-hidden="true">{i + 1}</Keycap>
              <h3 className="text-subheading text-foreground">{step.title}</h3>
              <p className="max-w-xs text-sm text-muted">{step.text}</p>
            </div>
            <ArrowLink href={step.href}>{step.action}</ArrowLink>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** « Tout ce que tu y trouves » : une tuile par partie de l'application, chacune mène à son étape de la visite. */
export function FeatureGrid({
  id,
  title,
  lead,
  items,
}: {
  id: string;
  title: ReactNode;
  lead?: ReactNode;
  items: { href: string; icon: ReactNode; name: string; line: string }[];
}) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="flex flex-col gap-10">
      <Titre id={`${id}-titre`} lead={lead}>
        {title}
      </Titre>
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <li key={item.href} className="flex">
            <Link href={item.href} className="tile group flex-1">
              <IconCircle size={40} className="shrink-0">
                {item.icon}
              </IconCircle>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="text-sm font-medium text-foreground">{item.name}</span>
                <span className="text-xs text-muted">{item.line}</span>
              </span>
              <ArrowRight size={14} aria-hidden="true" className="shrink-0 text-subtle transition-transform group-hover:translate-x-0.5" />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** « Pourquoi Catalog » : ses raisons, côte à côte. */
export function ReasonsSection({
  id,
  title,
  items,
}: {
  id: string;
  title: ReactNode;
  items: { icon: ReactNode; title: string; text: string }[];
}) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="flex flex-col gap-10">
      <Titre id={`${id}-titre`}>{title}</Titre>
      <ul className="mx-auto grid w-full max-w-3xl gap-10 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.title} className="flex flex-col items-center gap-3 text-center">
            <IconCircle size={40}>{item.icon}</IconCircle>
            <h3 className="text-subheading text-foreground">{item.title}</h3>
            <p className="max-w-xs text-sm text-muted">{item.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Le dernier appel, au bas de la page d'arrivée. */
export function ClosingCall({ title, lead, actions }: { title: ReactNode; lead?: ReactNode; actions: ReactNode }) {
  return (
    <section aria-label="Pour commencer" className="flex flex-col items-center gap-6 text-center">
      <h2 className="max-w-2xl text-balance text-heading-sm text-foreground lg:text-heading">{title}</h2>
      {lead && <p className="max-w-md text-base text-muted">{lead}</p>}
      <div className="flex flex-wrap items-center justify-center gap-2">{actions}</div>
    </section>
  );
}

const lienExterne = "text-foreground underline-offset-4 hover:underline";

/** Pied de page : qui fait Catalog, d'où viennent les fiches (attribution exigée par TMDB). */
export function SiteFooter({ maker, data }: { maker: { name: string; href: string }; data: { name: string; href: string } }) {
  return (
    <footer className="flex flex-col items-center gap-4 border-t border-divider pt-8 text-center text-sm text-muted sm:flex-row sm:justify-between sm:text-left">
      <p className="flex items-center gap-2">
        <Logo variant="mark" title={null} className="size-5 shrink-0" />
        <span>
          Catalog, un projet{" "}
          <a href={maker.href} target="_blank" rel="noopener noreferrer" className={lienExterne}>
            {maker.name}
          </a>
        </span>
      </p>
      <p className="max-w-sm text-xs">
        Fiches des films et des séries :{" "}
        <a href={data.href} target="_blank" rel="noopener noreferrer" className={lienExterne}>
          {data.name}
        </a>
        . Catalog n&apos;est ni approuvé ni certifié par {data.name}.
      </p>
    </footer>
  );
}
