import { Fragment, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, ChevronDown, Heart } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { StarCount } from "@/components/StarRating";
import { IconCircle, MonoMeta } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";
import { ArrowLink } from "./feature";

// Sections de la page d'arrivée — docs/audit/landing-visite-app-2026-11-07.md (§ 3). Elle convainc, elle
// n'enregistre rien : des affiches, des explications et des liens vers la visite, aucune commande qui
// écrit. Cinq blocs : le héros (et l'éventail d'affiches), comment ça marche, tout ce que tu y trouves,
// pourquoi Catalog, le dernier appel et le pied de page.

export type Affiche = { name: string; posterUrl: string | null; /** Variable CSS `--tint` tirée de l'affiche. */ tint?: string };

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
  /** Le paquet : la carte du dessus penchée (« Ça me tente »), deux autres dessous. */
  | { kind: "balaie"; affiches: Affiche[] }
  /** Un titre noté face à un autre : la note, puis le duel. */
  | { kind: "duel"; affiches: [Affiche, Affiche] }
  /** Trois recommandations « Pour toi », et la raison de la première. */
  | { kind: "reco"; affiches: Affiche[]; parce: string };

/**
 * L'image d'un temps, dans sa scène teintée par l'affiche principale : le paquet qu'on balaie, un titre noté
 * contre un autre, des recommandations avec leur raison. Décorative : le texte dit tout.
 */
function StepPicture({ visual }: { visual: StepVisual }) {
  return (
    <div aria-hidden="true" className="relative flex h-56 items-center justify-center">
      {visual.kind === "balaie" && (
        <div className="relative h-48 w-32">
          {visual.affiches.slice(1, 3).map((a, i) => (
            <div key={a.name} className="absolute inset-0" style={{ transform: `rotate(${i === 0 ? -7 : -2}deg) translateX(${i === 0 ? -18 : -8}px)`, opacity: i === 0 ? 0.45 : 0.7 }}>
              <AfficheImage affiche={a} className="w-32" />
            </div>
          ))}
          {visual.affiches[0] && (
            <div className="absolute inset-0 translate-x-4 rotate-6">
              <AfficheImage affiche={visual.affiches[0]} className="w-32" />
              <span className="swipe-stamp is-envie text-xs">Ça me tente</span>
            </div>
          )}
        </div>
      )}
      {visual.kind === "duel" && (
        <div className="flex items-center gap-3">
          <div className="relative">
            <AfficheImage affiche={visual.affiches[0]} className="w-28" />
            <span className="overlay-pill absolute bottom-2 left-1/2 -translate-x-1/2">
              <StarCount value={4} size={12} />
            </span>
          </div>
          <span className="flex size-8 items-center justify-center rounded-full bg-surface-3 text-xs text-muted">ou</span>
          <AfficheImage affiche={visual.affiches[1]} className="w-28" />
        </div>
      )}
      {visual.kind === "reco" && (
        <div className="flex flex-col items-center gap-3">
          <div className="flex items-end gap-2">
            {visual.affiches.slice(0, 3).map((a, i) => (
              <div key={a.name} className="relative">
                <AfficheImage affiche={a} className={i === 0 ? "w-24" : "w-20 opacity-80"} />
                {i === 0 && <span className="overlay-pill absolute left-1.5 top-1.5 text-xs">Pour toi</span>}
              </div>
            ))}
          </div>
          <p className="flex max-w-56 items-start gap-1.5 text-xs text-muted">
            <Heart size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span className="line-clamp-2">Parce que tu as aimé {visual.parce}</span>
          </p>
        </div>
      )}
    </div>
  );
}

/** La teinte de la scène d'un temps : celle de son affiche principale. */
function teinte(visual: StepVisual | undefined): CSSProperties | undefined {
  const tint = visual?.affiches[0]?.tint;
  return tint ? ({ "--tint": tint } as CSSProperties) : undefined;
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

/** Une section centrée : titre, précision, puis son contenu (le paquet à balayer de la page d'arrivée). */
export function CenteredSection({ id, title, lead, children }: { id: string; title: ReactNode; lead?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="flex flex-col items-center gap-8">
      <Titre id={`${id}-titre`} lead={lead}>
        {title}
      </Titre>
      {children}
    </section>
  );
}

/**
 * « Comment ça marche » : trois temps qui s'enchaînent (le balayage ouvre la suite). Chacun dans sa scène
 * teintée, comme les sections du dessous : l'image, « Étape n », le titre, l'explication et son lien. Entre
 * deux temps, une flèche (sur ordinateur) dit que l'un mène à l'autre.
 */
export function HowItWorks({
  id,
  title,
  lead,
  steps,
}: {
  id: string;
  title: ReactNode;
  lead?: ReactNode;
  steps: { title: string; text: string; href: string; action: string; visual?: StepVisual }[];
}) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="flex flex-col gap-10">
      <Titre id={`${id}-titre`} lead={lead}>
        {title}
      </Titre>
      <ol className="grid items-stretch gap-4 md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-3">
        {steps.map((step, i) => (
          <Fragment key={step.title}>
            {i > 0 && (
              <li aria-hidden="true" className="hidden items-center text-subtle md:flex">
                <ArrowRight size={18} />
              </li>
            )}
            <li className="chaine-etape" style={teinte(step.visual)}>
              {step.visual && <StepPicture visual={step.visual} />}
              <div className="flex flex-1 flex-col items-start gap-2">
                <MonoMeta>{`Étape ${i + 1}`}</MonoMeta>
                <h3 className="text-subheading text-foreground">{step.title}</h3>
                <p className="text-sm text-muted">{step.text}</p>
              </div>
              <ArrowLink href={step.href}>{step.action}</ArrowLink>
            </li>
          </Fragment>
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

/**
 * Les questions qu'on se pose avant d'essayer (audit 2026-11-09 : objections). Des réponses courtes et
 * vérifiables ; chaque question s'ouvre sur place.
 */
export function FaqSection({ id, title, items }: { id: string; title: ReactNode; items: { q: string; r: string }[] }) {
  return (
    <section id={id} aria-labelledby={`${id}-titre`} className="flex flex-col gap-8">
      <Titre id={`${id}-titre`}>{title}</Titre>
      <div className="mx-auto flex w-full max-w-2xl flex-col divide-y divide-divider border-y border-divider">
        {items.map((item) => (
          <details key={item.q} className="faq group">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-4 text-base text-foreground">
              {item.q}
              <ChevronDown size={16} aria-hidden="true" className="shrink-0 text-subtle transition-transform group-open:rotate-180" />
            </summary>
            <p className="pb-4 text-sm text-muted">{item.r}</p>
          </details>
        ))}
      </div>
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

// Soulignés au repos : un lien dans un texte ne se reconnaît pas qu'à sa couleur (WCAG 1.4.1, audit axe).
const lienExterne = "text-foreground underline decoration-divider underline-offset-4 hover:decoration-current";

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
