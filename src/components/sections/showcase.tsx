"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { gsap } from "gsap";
import { ArrowRight, Check, ChevronLeft, ChevronRight, Clapperboard, Drama, Heart, Tag, Tv, Undo2, X } from "lucide-react";
import { CompatibilityChip } from "@/components/CompatibilityChip";
import { ProviderLogo } from "@/components/ProviderLogo";
import { ratingName } from "@/components/RatingKeys";
import { ScoreBadge } from "@/components/ScoreBadge";
import { StarCount, StarRating, starCount } from "@/components/StarRating";
import { TrailerButton } from "@/components/TrailerButton";
import { useMyServices } from "@/components/useMyServices";
import { Button } from "@/components/ui/Button";
import { Chip, SearchField } from "@/components/ui/form";
import { Badge, MetaRow, MonoMeta } from "@/components/ui/primitives";
import { SegmentedControl as Tabs } from "@/components/SegmentedControl";
import { includedIn } from "@/lib/availability";
import { clock, formatMinutes } from "@/lib/format";
import { genreLine } from "@/lib/genres";
import { itemExposureKey } from "@/lib/impressionKeys";
import type { Category, LibraryItem, WatchStatus } from "@/lib/libraryItem";
import { prefersReducedMotion } from "@/lib/motion";
import type { LibraryStats, ShowcaseTab, ShowcaseTitle } from "@/lib/showcase";
import { cn } from "@/lib/utils";
import { SuggestionBadge, SuggestionButton, useSuggestions, type Suggestions } from "./suggestion";

// Vitrine de l'accueil — fiche docs/design-reference/raycast/composants/vitrine.md. Trois aperçus
// repris de raycast.com : le carrousel d'extensions de l'accueil (ShowcaseCarousel), le mur de
// fonctionnalités de la page Windows (FeatureWall, cartes dans recommendations-wall.tsx) et la liste à onglets du Store
// (TitleListSection). Chaque carte ouvre la fiche du titre dans la bibliothèque ; les cartes à
// actions portent un lien étiré sur toute la carte, les boutons passent au-dessus (jamais un bouton
// dans un lien).

const ficheHref = (title: ShowcaseTitle) => `/library?fiche=${title.id}`;

function Poster({ url, className }: { url: string | null; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" loading="lazy" draggable={false} className={className} /> : null;
}

/** Tes abonnements qui l'incluent (formules avec publicité comprises). */
function useOnMyServices(title: ShowcaseTitle) {
  const { covered } = useMyServices();
  return includedIn(title.availability, covered);
}

/** Lien étiré : il couvre toute la carte (`position: relative`) ; les boutons sont au-dessus. */
function StretchedLink({ title, className, href }: { title: ShowcaseTitle; className: string; href?: string }) {
  return (
    <Link href={href ?? ficheHref(title)} className={cn("outline-none after:absolute after:inset-0", className)}>
      {title.name}
    </Link>
  );
}

/**
 * Titre de section de l'accueil : la même hiérarchie que les sections de fonctionnalité
 * (`FeatureSection`), calée à gauche, pour que l'accueil n'ait qu'une voix (audit UX 2026-10-09,
 * W2-1). Au-dessus, le surtitre éventuel de la fonction (`FeatureEyebrow`).
 */
function ShowcaseHeading({
  id,
  title,
  lead,
  eyebrow,
}: {
  id: string;
  title: string;
  lead?: string;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="flex max-w-xl flex-col items-start gap-6">
      {eyebrow}
      <div className="flex flex-col gap-3">
        <h2 id={id} className="text-balance text-heading-sm text-foreground lg:text-heading">
          {title}
        </h2>
        {lead && <p className="text-base text-muted">{lead}</p>}
      </div>
    </div>
  );
}

/** « 1 h 52 », « 2 h », « 45 min ». */

/** « 22 h 47 ». */

/**
 * L'heure qu'il est, côté navigateur seulement (rien au rendu serveur, donc pas d'écart
 * d'hydratation), remise à jour chaque minute.
 */
function useNow(): Date | null {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 60_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  return now;
}

/** Ce que la carte sait faire : le geste de Ce soir, sur ta pile. */
export type ShowcaseCardActions = {
  /** « Je regarde ça » : marqué vu (Ce soir FR-7). */
  watching: boolean;
  pending: boolean;
  onWatch: () => void;
  onUndoWatch: () => void;
  /** « Pas ce soir » : la carte s'écarte, rien n'est enregistré. */
  onSkip: () => void;
};

type TickerItem = { key: string; icon: ReactNode; text: string };

/**
 * Bandeau qui défile lentement, au survol de la carte seulement (arrêté en mouvement réduit) :
 * ce qui ne tient pas sur la carte. Le texte est doublé pour boucler sans à-coup ; les lecteurs
 * d'écran lisent la version fixe.
 */
function Ticker({ items }: { items: TickerItem[] }) {
  if (items.length === 0) return null;
  const length = items.reduce((sum, item) => sum + item.text.length, 0);
  // Vitesse à peu près constante (≈ 30 px/s), quelle que soit la longueur.
  const seconds = Math.max(14, Math.round(length * 0.24));
  return (
    <>
      <p className="sr-only">{items.map((item) => item.text).join(". ")}</p>
      <div aria-hidden="true" className="ticker">
        <div className="ticker-track" style={{ "--ticker-duration": `${seconds}s` } as CSSProperties}>
          {[0, 1].map((copy) => (
            <span key={copy} className="ticker-group">
              {items.map((item) => (
                <span key={item.key} className="flex shrink-0 items-center gap-1.5">
                  {item.icon}
                  {item.text}
                </span>
              ))}
            </span>
          ))}
        </div>
      </div>
    </>
  );
}

/**
 * Carte du carrousel : l'affiche occupe toute la carte (au format 2:3). En bas, sur un dégradé,
 * le titre et une ligne pour décider (compatibilité, durée et heure de fin si tu lances
 * maintenant). Au survol ou au focus, le bloc monte : un bandeau défile (pourquoi, générique,
 * genres, abonnement) et les gestes de Ce soir apparaissent. Sur écran tactile, tout reste visible.
 */
export function ShowcaseCard({
  title,
  actions,
  suggestions,
  now = null,
}: {
  title: ShowcaseTitle;
  actions?: ShowcaseCardActions;
  /** Une suggestion (hors bibliothèque) s'ajoute d'un clic au lieu des gestes de Ce soir. */
  suggestions?: Suggestions;
  now?: Date | null;
}) {
  const mine = useOnMyServices(title);
  // Une suggestion ajoutée devient un titre de ta pile : sa fiche s'ouvre.
  const addedId = title.suggestion ? (suggestions?.libraryIdOf(title) ?? null) : null;
  const series = title.type === "TV Series";
  const end = title.runtime && !series && now ? clock(new Date(now.getTime() + title.runtime * 60_000)) : null;
  const timing = title.runtime
    ? series
      ? `${formatMinutes(title.runtime)} par épisode`
      : end
        ? `${formatMinutes(title.runtime)}, fin vers ${end}`
        : formatMinutes(title.runtime)
    : null;
  const cast = title.cast.slice(0, 2);
  const ticker: TickerItem[] = [
    ...(title.neighbours.length > 0
      ? [{ key: "because", icon: <Heart size={12} />, text: `Parce que tu as aimé ${title.neighbours.slice(0, 2).map((n) => n.name).join(", ")}` }]
      : []),
    ...(title.directors[0] ? [{ key: "director", icon: <Clapperboard size={12} />, text: `De ${title.directors[0]}` }] : []),
    ...(cast.length > 0 ? [{ key: "cast", icon: <Drama size={12} />, text: `Avec ${cast.join(" et ")}` }] : []),
    ...(title.genres.length > 0 ? [{ key: "genres", icon: <Tag size={12} />, text: genreLine(title.genres, 3) }] : []),
    ...(mine.length > 0 ? [{ key: "service", icon: <Tv size={12} />, text: `Sur ${mine[0].name}` }] : []),
  ];
  return (
    <article
      data-impression={title.suggestion ? undefined : itemExposureKey(title.id)}
      className={cn("showcase-card showcase-card-poster", actions?.watching && "is-open")}
      style={title.tint ? ({ "--tint": title.tint } as CSSProperties) : undefined}
    >
      <Poster url={title.posterUrl} className="showcase-card-image" />
      <div aria-hidden="true" className="showcase-shade" />
      <div className="showcase-overlay">
        <h3 className="line-clamp-2 text-lg text-foreground">
          {title.suggestion && addedId === null ? (
            title.name
          ) : (
            <StretchedLink title={title} href={addedId !== null ? `/library?fiche=${addedId}` : undefined} className="showcase-link" />
          )}
        </h3>
        <MetaRow className="mt-1.5 flex-nowrap">
          {title.suggestion && (
            <span className="shrink-0">
              <SuggestionBadge />
            </span>
          )}
          {title.compatibility !== null && (
            <span className="shrink-0">
              <CompatibilityChip value={title.compatibility} />
            </span>
          )}
          <span className="min-w-0 text-foreground">
            <span className="min-w-0"><span className="min-w-0 truncate">{timing ?? genreLine(title.genres)}</span></span>
          </span>
          {mine.length > 0 && (
            <span className="shrink-0" title={`Sur ${mine[0].name}`}>
              <ProviderLogo provider={mine[0]} size={16} />
            </span>
          )}
        </MetaRow>
        <div className="showcase-extra">
          <Ticker items={ticker} />
          {actions?.watching ? (
            <div role="status" className="relative z-10 flex items-center gap-2 text-sm">
              <Check size={16} aria-hidden="true" className="shrink-0 text-success" />
              <span className="min-w-0 truncate text-foreground">{end ? `Bonne séance, fin vers ${end}.` : "Bonne séance."}</span>
              <Button size="sm" variant="overlay" className="ml-auto" onClick={actions.onUndoWatch} disabled={actions.pending}>
                <Undo2 size={14} aria-hidden="true" />
                Annuler
              </Button>
            </div>
          ) : (
            <div className="relative z-10 flex items-center gap-2">
              {title.suggestion && suggestions && <SuggestionButton title={title} suggestions={suggestions} onImage />}
              {actions && !title.suggestion && (
                <>
                  <Button size="sm" variant="overlay" onClick={actions.onWatch} loading={actions.pending} aria-label={`Je regarde « ${title.name} »`}>
                    {!actions.pending && <Check size={14} aria-hidden="true" />}
                    Je regarde ça
                  </Button>
                  <Button size="sm" variant="overlay" icon onClick={actions.onSkip} aria-label={`Pas ce soir : « ${title.name} »`} title="Pas ce soir">
                    <X size={14} aria-hidden="true" />
                  </Button>
                </>
              )}
              <span className="ml-auto">
                <TrailerButton trailer={title.trailer} title={title.name} variant="icon" onImage />
              </span>
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * Carrousel « il y a un titre pour ça » : titre et précision à gauche, onglets à droite ; une
 * rangée pleine largeur de cartes aimantées ; un lien « voir plus » et deux flèches rondes.
 * Changer d'onglet remplace les cartes sans rien rejouer (règle de mouvement 2). Chaque carte
 * porte le geste de Ce soir : « Je regarde ça » (marqué vu) et « Pas ce soir » (écartée pour la
 * visite), l'un et l'autre annulables.
 */
export function ShowcaseCarousel({
  id,
  title,
  lead,
  eyebrow,
  tabs,
  more,
}: {
  id: string;
  title: string;
  lead?: string;
  eyebrow?: ReactNode;
  tabs: ShowcaseTab[];
  more?: { href: string; label: string };
}) {
  const [active, setActive] = useState(tabs[0]?.value ?? "");
  const reel = useRef<HTMLDivElement | null>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  /** Écartés pour ce soir (rien n'est enregistré), le dernier d'abord pour l'annulation. */
  const [skipped, setSkipped] = useState<ShowcaseTitle[]>([]);
  /** Marqués vus depuis la carte : id → statut d'avant, pour défaire. */
  const [watching, setWatching] = useState<Map<number, string>>(new Map());
  const [pending, setPending] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const current = tabs.find((tab) => tab.value === active) ?? tabs[0];
  const shown = current ? current.titles.filter((t) => !skipped.some((s) => s.id === t.id)) : [];
  const now = useNow();
  const suggestions = useSuggestions();

  const measure = useCallback(() => {
    const el = reel.current;
    if (!el) return;
    setEdges({ start: el.scrollLeft > 4, end: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  }, []);

  // L'aimantation s'aligne sur le contenu : sa marge vaut la marge intérieure de la rangée, en px
  // (en CSS, un pourcentage se rapporterait à la rangée elle-même, pas au contenu).
  const align = useCallback(() => {
    const el = reel.current;
    if (!el) return;
    el.style.scrollPaddingInline = getComputedStyle(el).paddingLeft;
    measure();
  }, [measure]);

  // Nouvel onglet : la rangée repart du début.
  useEffect(() => {
    align();
    reel.current?.scrollTo({ left: 0 });
    measure();
  }, [active, align, measure]);

  useEffect(() => {
    window.addEventListener("resize", align);
    return () => window.removeEventListener("resize", align);
  }, [align]);

  // Une carte écartée ou revenue change la longueur de la rangée.
  useEffect(() => measure(), [skipped, measure]);

  /** Une carte à la fois : sa largeur et l'écart qui la suit. */
  function page(direction: 1 | -1) {
    const el = reel.current;
    const card = el?.firstElementChild as HTMLElement | null;
    if (!el || !card) return;
    const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
    el.scrollBy({ left: direction * (card.offsetWidth + gap), behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  /** ← → d'une carte à l'autre quand le titre d'une carte a le focus ; la rangée suit. */
  function onReelKey(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
    const links = [...(reel.current?.querySelectorAll<HTMLAnchorElement>(".showcase-link") ?? [])];
    const i = links.indexOf(document.activeElement as HTMLAnchorElement);
    if (i < 0) return;
    e.preventDefault();
    const next = links[gsap.utils.clamp(0, links.length - 1, i + (e.key === "ArrowRight" ? 1 : -1))];
    next.focus({ preventScroll: true });
    next.closest("article")?.scrollIntoView({ inline: "start", block: "nearest", behavior: prefersReducedMotion() ? "auto" : "smooth" });
  }

  async function setStatus(t: ShowcaseTitle, watchStatus: string): Promise<boolean> {
    const res = await fetch(`/api/items/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ watchStatus }),
    }).catch(() => null);
    return Boolean(res?.ok);
  }

  async function watch(t: ShowcaseTitle) {
    setPending(t.id);
    setMessage(null);
    const ok = await setStatus(t, "Watched");
    setPending(null);
    if (ok) setWatching((prev) => new Map(prev).set(t.id, t.watchStatus ?? "Unwatched"));
    else setMessage("Le titre n'a pas pu être marqué vu.");
  }

  async function undoWatch(t: ShowcaseTitle) {
    const previous = watching.get(t.id);
    if (!previous) return;
    setPending(t.id);
    const ok = await setStatus(t, previous);
    setPending(null);
    if (!ok) {
      setMessage("L'annulation n'a pas pu être appliquée.");
      return;
    }
    setWatching((prev) => {
      const next = new Map(prev);
      next.delete(t.id);
      return next;
    });
  }

  if (!current) return null;
  const headingId = `${id}-titre`;
  const lastSkipped = skipped[0];

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <ShowcaseHeading id={headingId} title={title} lead={lead} eyebrow={eyebrow} />
        {tabs.length > 1 && (
          // Au téléphone, les envies défilent sur une ligne au lieu d'en laisser une seule à la
          // ligne suivante (audit UX 2026-10-09, W3-3).
          <div className="scroll-row -mx-4 -my-1 w-[calc(100%+2rem)] overflow-x-auto px-4 py-1 sm:mx-0 sm:my-0 sm:w-auto sm:overflow-visible sm:p-0 [&_.segmented]:flex-nowrap">
            <Tabs
              label={`${title} : envie`}
              options={tabs.map((tab) => ({ value: tab.value, label: tab.label }))}
              value={current.value}
              onChange={setActive}
            />
          </div>
        )}
      </div>

      {/* Défilable au clavier (WCAG 2.1.1, audit axe 2026-11-09). */}
      <div ref={reel} onScroll={measure} onKeyDown={onReelKey} tabIndex={0} role="region" aria-label="Titres, à faire défiler" className="reel">
        {shown.map((t) => (
          <ShowcaseCard
            key={t.id}
            title={t}
            now={now}
            suggestions={suggestions}
            actions={{
              watching: watching.has(t.id),
              pending: pending === t.id,
              onWatch: () => watch(t),
              onUndoWatch: () => undoWatch(t),
              onSkip: () => {
                setSkipped((prev) => [t, ...prev]);
                setMessage(null);
              },
            }}
          />
        ))}
        {shown.length === 0 && (
          <div className="flex h-40 items-center text-base text-muted">Plus rien dans cette envie ce soir. Essaie une autre.</div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4">
        {more ? (
          <Link href={more.href} className="arrow-link">
            {more.label}
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        ) : (
          <span />
        )}
        <div className="flex min-w-0 items-center gap-3">
          <span aria-live="polite" className="min-w-0 truncate text-sm text-muted">
            {message ?? suggestions.message ?? (lastSkipped ? `« ${lastSkipped.name} » écarté pour ce soir` : "")}
          </span>
          {lastSkipped && !message && !suggestions.message && (
            <Button size="sm" variant="ghost" onClick={() => setSkipped((prev) => prev.slice(1))}>
              <Undo2 size={14} aria-hidden="true" />
              Annuler
            </Button>
          )}
        </div>
        <div className="hidden items-center gap-3 sm:flex">
          <Button variant="rail" size="xl" icon onClick={() => page(-1)} disabled={!edges.start} aria-label={`${title} : précédents`}>
            <ChevronLeft size={16} aria-hidden="true" />
          </Button>
          <Button variant="rail" size="xl" icon onClick={() => page(1)} disabled={!edges.end} aria-label={`${title} : suivants`}>
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
        </div>
      </div>
    </section>
  );
}

/**
 * Mur de fonctionnalités (FeatureWall de raycast.com/windows) : surtitre, titre et précision
 * centrés en deux tons, puis une grille de deux colonnes ; une carte `hero` occupe toute la
 * largeur ; `footer` : les liens de la fonction, centrés sous la grille.
 */
export function FeatureWall({
  id,
  title,
  lead,
  eyebrow,
  footer,
  children,
}: {
  id: string;
  title: string;
  lead?: string;
  eyebrow?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  const headingId = `${id}-titre`;
  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-10 lg:gap-16">
      <ShowcaseHeading id={headingId} title={title} lead={lead} eyebrow={eyebrow} />
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2 lg:gap-8">{children}</div>
      {footer && <div className="-mt-2 flex flex-wrap items-center gap-x-8 gap-y-3 lg:-mt-8">{footer}</div>}
    </section>
  );
}

/** Un titre de /api/items, au format des aperçus. */
function fromLibraryItem(item: LibraryItem): ShowcaseTitle {
  return {
    id: item.id,
    name: item.name,
    year: item.year,
    type: item.type,
    category: item.category,
    genres: item.genres,
    overview: item.overview ?? "",
    posterUrl: item.posterUrl,
    compatibility: null,
    reason: null,
    watchStatus: item.watchStatus,
    rating: item.rating,
    voteAverage: item.voteAverage,
    voteCount: item.voteCount,
    trailer: item.trailer,
    availability: item.availability,
    neighbours: [],
    runtime: null,
    directors: [],
    cast: [],
  };
}

/** Ce qu'une carte de liste sait faire : noter un titre vu, marquer vu un titre à voir. */
export type TitleRowActions = {
  pending: boolean;
  onRate: (next: string | null) => void;
  onWatched: () => void;
};

/**
 * Carte de liste (extension du Store) : l'affiche à gauche, avec sa bande-annonce ; titre, année,
 * genre et réalisation, l'anneau du score TMDB ; synopsis ; puis l'état et l'action du moment :
 * « Vu » et les étoiles (on note sur place), ou « À voir » et « Marquer vu ». Teintée par
 * l'affiche ; le titre est un lien étiré vers la fiche.
 */
export function TitleRowCard({
  title,
  actions,
  suggestions,
}: {
  title: ShowcaseTitle;
  actions?: TitleRowActions;
  /** Une suggestion (hors bibliothèque) s'ajoute d'un clic au lieu d'être notée. */
  suggestions?: Suggestions;
}) {
  const addedId = title.suggestion ? (suggestions?.libraryIdOf(title) ?? null) : null;
  const stars = starCount(title.rating);
  const watched = title.watchStatus === "Watched";
  const director = title.directors[0];
  return (
    <article
      className="card card-live row-card relative flex h-full gap-4 p-3 sm:gap-5 sm:p-4"
      style={title.tint ? ({ "--tint": title.tint } as CSSProperties) : undefined}
    >
      <span className="poster relative aspect-[2/3] w-20 shrink-0 self-start sm:w-24">
        <Poster url={title.posterUrl} className="h-full w-full object-cover" />
        <span className="absolute inset-0 z-10 flex items-center justify-center">
          <TrailerButton trailer={title.trailer} title={title.name} variant="icon" />
        </span>
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 py-0.5">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="line-clamp-2 text-lg text-foreground">
              {title.suggestion && addedId === null ? (
                title.name
              ) : (
                <StretchedLink title={title} href={addedId !== null ? `/library?fiche=${addedId}` : undefined} className="row-link" />
              )}
            </h3>
            <MetaRow className="mt-1">
              {title.suggestion && <SuggestionBadge />}
              {title.year && <span>{title.year}</span>}
              {title.genres.length > 0 && <span>{genreLine(title.genres)}</span>}
            </MetaRow>
            {director && <p className="mt-1 truncate text-sm text-muted">De {director}</p>}
          </div>
          <ScoreBadge voteAverage={title.voteAverage} voteCount={title.voteCount} />
        </div>
        {title.overview && <p className="line-clamp-2 text-sm text-muted">{title.overview}</p>}
        {title.suggestion ? (
          <div className="relative z-10 mt-auto flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2 pt-1">
            {suggestions && <SuggestionButton title={title} suggestions={suggestions} />}
          </div>
        ) : actions ? (
          <div className="relative z-10 mt-auto flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2 pt-1">
            {watched ? (
              <>
                <Badge variant="success">Vu</Badge>
                <StarRating rating={title.rating} onRate={actions.onRate} size="sm" showWorstTier />
                {!title.rating && <span className="text-xs text-muted">Ta note ?</span>}
              </>
            ) : (
              <>
                <Badge>À voir</Badge>
                <Button size="sm" onClick={actions.onWatched} loading={actions.pending} aria-label={`Marquer « ${title.name} » comme vu`}>
                  {!actions.pending && <Check size={14} aria-hidden="true" />}
                  Marquer vu
                </Button>
              </>
            )}
          </div>
        ) : (
          <MetaRow className="mt-auto">
            {title.rating === "💩" ? <span>💩</span> : stars > 0 && <StarCount value={stars} size={12} />}
          </MetaRow>
        )}
      </div>
    </article>
  );
}

const CATEGORY_PLURAL: Record<Category, string> = { Movie: "Films", "TV Series": "Séries", Documentary: "Documentaires" };

/**
 * Ta collection en chiffres (la colonne de catégories du Store, en vivant) : le total, la part
 * des vus, les types et l'histogramme de tes notes ; un type ou une barre filtre la grille.
 */
function LibraryStatsPanel({
  stats,
  category,
  rating,
  onCategory,
  onRating,
  exemple = false,
}: {
  stats: LibraryStats;
  category: Category | null;
  rating: number | null;
  onCategory: (next: Category | null) => void;
  onRating: (next: number | null) => void;
  /** Page d'arrivée : une bibliothèque d'exemple, signalée ; ses notes se lisent sans filtrer. */
  exemple?: boolean;
}) {
  const fr = (n: number) => n.toLocaleString("fr-FR");
  const watchedShare = stats.total > 0 ? (stats.watched / stats.total) * 100 : 0;
  const most = Math.max(...stats.ratings, 1);
  // La plus petite barre non vide reste visible (8 %) ; la plus haute remplit la piste.
  const barHeight = gsap.utils.mapRange(0, most, 8, 100);
  const barre = (count: number, n: number) => (
    <>
      <MonoMeta aria-hidden="true">{fr(count)}</MonoMeta>
      <span aria-hidden="true" className="rating-bar-track">
        <span className="rating-bar-fill" data-zero={n === 0 || undefined} style={{ height: `${count > 0 ? barHeight(count) : 0}%` }} />
      </span>
      <span aria-hidden="true" className="flex h-4 items-center text-xs">
        {n === 0 ? "💩" : <StarCount value={n} size={12} />}
      </span>
    </>
  );
  return (
    <aside aria-label="Ta collection en chiffres" className="feature-stage library-stats lg:sticky lg:top-28 lg:self-start">
      <div className="flex flex-col gap-1">
        {/* Espace insécable ordinaire : Bricolage n'a pas l'espace fine de « 1 068 ». */}
        <div className="flex items-baseline justify-between gap-3">
          <p className="font-heading text-heading font-semibold text-foreground">{fr(stats.total).replace(/ /g, " ")}</p>
          {exemple && <MonoMeta>Exemple</MonoMeta>}
        </div>
        <p className="text-sm text-muted">titres dans ta bibliothèque</p>
      </div>
      <div className="flex flex-col gap-2">
        <div aria-hidden="true" className="library-split">
          <span style={{ width: `${watchedShare}%` }} />
        </div>
        <div className="flex justify-between gap-3 text-sm">
          <span>
            <span className="text-foreground">{fr(stats.watched)}</span> <span className="text-muted">vus</span>
          </span>
          <span>
            <span className="text-foreground">{fr(stats.toWatch)}</span> <span className="text-muted">à voir</span>
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted">Par type</p>
        <div role="group" aria-label="Filtrer par type" className="flex flex-wrap gap-2">
          {stats.categories.map((c) => (
            <Chip key={c.value} pressed={category === c.value} onClick={() => onCategory(category === c.value ? null : c.value)}>
              {CATEGORY_PLURAL[c.value]}
              <span className="text-muted">{fr(c.count)}</span>
            </Chip>
          ))}
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium text-muted">Tes notes</p>
        {exemple ? (
          <div
            role="img"
            aria-label={`Exemple de notes : ${stats.ratings.map((count, n) => `${ratingName(n)}, ${fr(count)}`).join(" ; ")}`}
            className="rating-bars"
          >
            {stats.ratings.map((count, n) => (
              <div key={n} className="rating-bar">
                {barre(count, n)}
              </div>
            ))}
          </div>
        ) : (
          <div role="group" aria-label="Filtrer par note" className="rating-bars">
            {stats.ratings.map((count, n) => (
              <button
                key={n}
                type="button"
                aria-pressed={rating === n}
                disabled={count === 0}
                onClick={() => onRating(rating === n ? null : n)}
                aria-label={`${ratingName(n)} : ${fr(count)} titre${count > 1 ? "s" : ""}`}
                className="rating-bar"
              >
                {barre(count, n)}
              </button>
            ))}
          </div>
        )}
        {exemple && <p className="text-xs text-muted">Chez toi, chaque type et chaque note filtre la liste.</p>}
      </div>
      <Link href={exemple ? "/bienvenue" : "/library"} className="arrow-link mt-auto text-sm">
        {exemple ? "Commencer la tienne" : "Ouvrir la bibliothèque"}
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </aside>
  );
}

type RowPatch = { rating?: string | null; watchStatus?: WatchStatus };
type RowChange = { title: ShowcaseTitle; previous: RowPatch; label: string };

function ratingPhrase(rating: string | null): string {
  if (rating === null) return "sans note";
  if (rating === "💩") return "noté 💩";
  return `noté ${starCount(rating)} sur 5`;
}

/** Ce que chaque onglet demande à /api/items, comme les listes de l'accueil (showcase.ts). */
const TAB_QUERY: Record<string, Record<string, string>> = {
  recent: { sortBy: "added", sortDir: "desc" },
  favorites: { watchStatus: "Watched", minRating: "5", sortBy: "elo" },
  acclaimed: { watchStatus: "Unwatched", sortBy: "tmdbRating" },
};
const ACCLAIMED_MIN_VOTES = 300;
const PER_LIST = 6;

/**
 * Liste à onglets (Extensions du Store) : surtitre et titre ; à gauche, ta collection en chiffres
 * (types et notes qui filtrent) ; à droite, onglets et recherche (pendant la frappe, ↵ ouvre la
 * bibliothèque), puis la grille. Chaque carte se note ou se marque vue sur place ; la dernière
 * action s'annule.
 */
export function TitleListSection({
  id,
  title,
  lead,
  eyebrow,
  tabs,
  stats,
  library = true,
  exemple = false,
}: {
  id: string;
  title: string;
  lead?: string;
  eyebrow?: ReactNode;
  tabs: ShowcaseTab[];
  stats?: LibraryStats;
  /** Faux pour un visiteur : pas de bibliothèque où chercher, seulement des suggestions. */
  library?: boolean;
  /**
   * Page d'arrivée : `stats` décrit une bibliothèque d'exemple faite des titres des onglets ; un type
   * choisi les filtre sur place (sans requête), tous onglets confondus.
   */
  exemple?: boolean;
}) {
  const router = useRouter();
  const suggestions = useSuggestions();
  const [active, setActive] = useState(tabs[0]?.value ?? "");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category | null>(null);
  const [rating, setRating] = useState<number | null>(null);
  const [fetched, setFetched] = useState<{ key: string; titles: ShowcaseTitle[]; total: number } | null>(null);
  const [loading, setLoading] = useState(false);
  /** Changements faits depuis les cartes, par id : ils l'emportent sur les données reçues. */
  const [patches, setPatches] = useState<Map<number, RowPatch>>(new Map());
  const [pending, setPending] = useState<number | null>(null);
  const [last, setLast] = useState<RowChange | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const current = tabs.find((tab) => tab.value === active) ?? tabs[0];
  const q = query.trim();
  const searchMode = q.length >= 2;
  const filtered = category !== null || rating !== null;
  // Ce que la grille montre : la liste reçue du serveur, ou une requête (recherche, filtres).
  const fetchKey = !exemple && (searchMode || filtered) ? JSON.stringify({ q: searchMode ? q : null, tab: searchMode ? null : active, category, rating }) : null;

  // Recherche et filtres, dans ta bibliothèque (lecture seule), 250 ms après le dernier changement.
  useEffect(() => {
    if (!fetchKey) return;
    const { q: text, tab } = JSON.parse(fetchKey) as { q: string | null; tab: string | null };
    const params = new URLSearchParams({ pageSize: "30" });
    if (text) params.set("q", text);
    else for (const [k, v] of Object.entries(TAB_QUERY[tab ?? "recent"] ?? TAB_QUERY.recent)) params.set(k, v);
    if (category) params.set("type", category);
    if (rating !== null) params.set("rating", String(rating));
    let alive = true;
    const timer = setTimeout(() => {
      setLoading(true);
      fetch(`/api/items?${params}`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((body: { items: LibraryItem[]; total: number }) => {
          if (!alive) return;
          const keep = (item: LibraryItem) =>
            Boolean(item.posterUrl) && (text || tab !== "acclaimed" || (item.voteCount ?? 0) >= ACCLAIMED_MIN_VOTES);
          setFetched({ key: fetchKey, titles: body.items.filter(keep).slice(0, PER_LIST).map(fromLibraryItem), total: body.total });
        })
        .catch(() => alive && setFetched({ key: fetchKey, titles: [], total: 0 }))
        .finally(() => alive && setLoading(false));
    }, 250);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [fetchKey, category, rating]);

  // La bibliothèque d'exemple : les titres des onglets, sans doublon ; un type choisi les filtre ici.
  const tousExemple = useMemo(() => (exemple ? [...new Map(tabs.flatMap((tab) => tab.titles).map((t) => [t.id, t])).values()] : []), [exemple, tabs]);
  const filtreExemple = exemple && category !== null ? tousExemple.filter((t) => t.category === category) : null;

  if (!current) return null;
  const headingId = `${id}-titre`;
  const ready = !fetchKey || fetched?.key === fetchKey;
  const base = filtreExemple ? filtreExemple.slice(0, PER_LIST) : fetchKey ? (fetched?.key === fetchKey ? fetched.titles : []) : current.titles;
  const shown = base.map((t) => {
    const patch = patches.get(t.id);
    return patch ? { ...t, ...patch } : t;
  });

  function search(e: FormEvent) {
    e.preventDefault();
    router.push(q ? `/library?q=${encodeURIComponent(q)}` : "/library");
  }

  // Une note ne vit que sur un titre vu : « À voir, bien notés » (et les coups de cœur, hors 5
  // étoiles) resteraient vides ; la grille repasse sur les derniers ajouts.
  function chooseRating(next: number | null) {
    setRating(next);
    if (next !== null && (active === "acclaimed" || (active === "favorites" && next !== 5))) setActive("recent");
  }

  async function apply(t: ShowcaseTitle, patch: RowPatch, label: string, previous: RowPatch) {
    setPending(t.id);
    setMessage(null);
    const res = await fetch(`/api/items/${t.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    }).catch(() => null);
    setPending(null);
    if (!res?.ok) {
      setMessage("La modification n'a pas été enregistrée.");
      return;
    }
    setPatches((prev) => new Map(prev).set(t.id, { ...prev.get(t.id), ...patch }));
    setLast({ title: t, previous, label });
  }

  async function undo() {
    const change = last;
    if (!change) return;
    setLast(null);
    setPending(change.title.id);
    const res = await fetch(`/api/items/${change.title.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(change.previous),
    }).catch(() => null);
    setPending(null);
    if (!res?.ok) {
      setMessage("L'annulation n'a pas pu être appliquée.");
      return;
    }
    // Repasser « à voir » efface la note, comme sur le serveur.
    const restored: RowPatch = change.previous.watchStatus === "Unwatched" ? { ...change.previous, rating: null } : change.previous;
    setPatches((prev) => new Map(prev).set(change.title.id, { ...prev.get(change.title.id), ...restored }));
  }

  const status = message ?? suggestions.message ?? (last ? `« ${last.title.name} » ${last.label}` : null);
  const filterLabel = [category && CATEGORY_PLURAL[category], rating !== null && (rating === 0 ? "💩" : `${rating} étoile${rating > 1 ? "s" : ""}`)]
    .filter(Boolean)
    .join(", ");
  const total = filtreExemple ? filtreExemple.length : fetched?.key === fetchKey ? fetched.total : null;

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-8">
      <ShowcaseHeading id={headingId} title={title} lead={lead} eyebrow={eyebrow} />

      <div className={cn("grid gap-6 lg:gap-8", stats && "lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]")}>
        {stats && (
          <LibraryStatsPanel
            stats={stats}
            category={category}
            rating={rating}
            onCategory={setCategory}
            onRating={chooseRating}
            exemple={exemple}
          />
        )}

        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-wrap items-center gap-3">
            <Tabs
              label={`${title} : liste`}
              options={tabs.map((tab) => ({ value: tab.value, label: tab.label }))}
              value={current.value}
              onChange={(next) => {
                setActive(next);
                setQuery("");
                // Dans l'exemple, le type filtre tous les onglets : changer d'onglet le retire.
                if (exemple) setCategory(null);
              }}
            />
            {library && (
              <form role="search" onSubmit={search} className="w-full sm:ml-auto sm:w-64">
                <SearchField
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onClear={() => setQuery("")}
                  searching={loading}
                  shortcut={["↵"]}
                  placeholder="Rechercher un titre…"
                  aria-label="Rechercher dans ta bibliothèque"
                />
              </form>
            )}
          </div>

          {(fetchKey || filtreExemple) && (
            <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2">
              <p aria-live="polite" className="text-sm text-muted">
                {!ready
                  ? "Un instant…"
                  : total === 0
                    ? "Aucun titre ne correspond."
                    : `${(total ?? 0).toLocaleString("fr-FR")} titre${(total ?? 0) > 1 ? "s" : ""}${searchMode ? ` pour « ${q} »` : ""}${filterLabel ? ` · ${filterLabel}` : ""}`}
              </p>
              <div className="flex items-center gap-3">
                {filtered && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setCategory(null);
                      setRating(null);
                    }}
                  >
                    <X size={14} aria-hidden="true" />
                    Effacer les filtres
                  </Button>
                )}
                {searchMode && total !== null && total > shown.length && (
                  <Link href={`/library?q=${encodeURIComponent(q)}`} className="arrow-link text-sm">
                    Tout voir
                    <ArrowRight size={16} aria-hidden="true" />
                  </Link>
                )}
              </div>
            </div>
          )}

          <ul aria-busy={!ready || undefined} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
            {shown.map((t) => (
              <li key={t.id}>
                <TitleRowCard
                  title={t}
                  suggestions={suggestions}
                  actions={{
                    pending: pending === t.id,
                    onRate: (next) => void apply(t, { rating: next }, ratingPhrase(next), { rating: t.rating }),
                    onWatched: () =>
                      void apply(t, { watchStatus: "Watched" }, "marqué vu. Ta note ?", { watchStatus: t.watchStatus ?? "Unwatched" }),
                  }}
                />
              </li>
            ))}
          </ul>

          <div className="flex min-h-8 flex-wrap items-center gap-3 text-sm text-muted">
            <span aria-live="polite">{status ?? ""}</span>
            {last && !message && !suggestions.message && (
              <Button size="sm" variant="ghost" onClick={undo}>
                <Undo2 size={14} aria-hidden="true" />
                Annuler
              </Button>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
