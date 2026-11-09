"use client";

import {
  useCallback,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { Eye, Heart, Info, Undo2, X, type LucideIcon } from "lucide-react";
import { TrailerButton } from "@/components/TrailerButton";
import { Button } from "@/components/ui/Button";
import { Card, Kbd, MetaRow } from "@/components/ui/primitives";
import type { CarteSwipe, ReponseSwipe } from "@/lib/demarrage";
import type { FicheCarte } from "@/lib/ficheCarte";
import { genreLine } from "@/lib/genres";
import { gesteAppris, noterGesteAppris, prochainIndice } from "@/lib/indice";
import type { Category } from "@/lib/libraryItem";
import { prefersReducedMotion, preset, useGSAP } from "@/lib/motion";
import { timingLine } from "@/lib/playlistFormat";
import { cn } from "@/lib/utils";

// Le paquet de cartes de Bienvenue — spec: specs/bienvenue-v1.md (FR-1 à FR-5, FR-12). Une affiche en grand,
// à balayer : → ça me tente, ← pas pour moi, ↑ déjà vu (sans note : décision de Louis, 2026-11-09). Les
// trois boutons et le clavier font la même chose. Un tap (ou « i ») retourne la carte : synopsis, durée,
// réalisation, où le voir, bande-annonce. Mouvement : transform et opacité, 220 ms, sans ressort ; réduit,
// la carte change sans voler. Tant qu'on n'a pas touché au paquet, la carte du dessus se balance à droite puis
// à gauche, avec son tampon, pour montrer le geste : à l'arrivée à l'écran, puis à intervalles qui s'espacent
// (FR-12, le rythme dans src/lib/indice.ts).

const CATEGORIE: Record<Category, string> = {
  Movie: "Film",
  "TV Series": "Série",
  Documentary: "Documentaire",
};
const SORTIE_MS = 220;

/** Où la carte s'en va, selon le geste. */
type Sortie = { x: number; y: number; rot: number };

function versSortie(
  r: ReponseSwipe,
  largeur: number,
  hauteur: number,
  depuis: { x: number; y: number } | null,
): Sortie {
  if (r.kind === "envie")
    return { x: largeur * 1.3, y: depuis?.y ?? 0, rot: 18 };
  if (r.kind === "non")
    return { x: -largeur * 1.3, y: depuis?.y ?? 0, rot: -18 };
  return { x: depuis?.x ?? 0, y: -hauteur * 1.2, rot: 0 };
}

/** Un des trois gestes en bouton : l'icône, le libellé et sa touche (sur ordinateur). */
function Geste({
  icon: Icon,
  label,
  touche,
  onClick,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  touche: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Card
      as="button"
      type="button"
      variant="tile"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-14 flex-col items-center justify-center gap-1 px-1 py-2 text-xs font-medium text-foreground disabled:opacity-40 sm:min-h-16 sm:flex-row sm:gap-2 sm:px-3 sm:text-sm"
    >
      <Icon size={16} aria-hidden="true" className="shrink-0" />
      <span className="whitespace-nowrap">{label}</span>
      <Kbd aria-hidden="true" className="hidden md:inline-flex">
        {touche}
      </Kbd>
    </Card>
  );
}

function Recto({
  carte,
  fiche,
  onInfos,
}: {
  carte: CarteSwipe;
  fiche: FicheCarte | null | undefined;
  onInfos: () => void;
}) {
  const trailer = fiche?.trailer ?? carte.trailer ?? null;
  return (
    <>
      {carte.posterUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={carte.posterUrl}
          alt=""
          draggable={false}
          className="swipe-card-image"
        />
      )}
      <div className="swipe-card-top">
        <TrailerButton trailer={trailer} title={carte.name} variant="icon" />
        <Button
          variant="overlay"
          icon
          onClick={onInfos}
          aria-label={`Plus d'infos sur « ${carte.name} »`}
          title="Plus d'infos (i)"
        >
          <Info size={16} aria-hidden="true" />
        </Button>
      </div>
      <div className="swipe-card-scrim">
        {carte.raison && (
          <p className="flex items-center gap-1.5 text-xs text-muted">
            <Heart size={12} aria-hidden="true" className="shrink-0" />
            <span className="truncate">{carte.raison}</span>
          </p>
        )}
        <p className="line-clamp-2 text-subheading text-foreground">
          {carte.name}
        </p>
        <MetaRow>
          <span>{CATEGORIE[carte.category]}</span>
          {carte.year && <span>{carte.year}</span>}
          {carte.genres.length > 0 && <span>{genreLine(carte.genres, 2)}</span>}
        </MetaRow>
        {carte.overview && (
          <p className="line-clamp-2 text-sm text-muted">{carte.overview}</p>
        )}
      </div>
    </>
  );
}

function Verso({
  carte,
  fiche,
  onRetour,
}: {
  carte: CarteSwipe;
  fiche: FicheCarte | null | undefined;
  onRetour: () => void;
}) {
  const runtime = fiche?.runtime ?? carte.runtime ?? null;
  const duree = timingLine(runtime, carte.type === "TV Series", null);
  const services =
    (fiche?.availability ?? carte.availability)?.flatrate.map((p) => p.name) ??
    [];
  const trailer = fiche?.trailer ?? carte.trailer ?? null;
  const lignes: [string, string][] = [
    ["Genres", genreLine(carte.genres, 4)],
    ["Réalisation", fiche?.directors.join(", ") ?? ""],
    ["Avec", fiche?.cast.join(", ") ?? ""],
    ["En abonnement", services.slice(0, 4).join(", ")],
  ].filter((l): l is [string, string] => Boolean(l[1]));
  return (
    <div className="swipe-card-verso">
      <div className="flex items-start gap-4">
        <div className="poster aspect-[2/3] w-16 shrink-0">
          {carte.posterUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={carte.posterUrl}
              alt=""
              draggable={false}
              className="h-full w-full object-cover"
            />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="text-subheading text-foreground">{carte.name}</p>
          <MetaRow>
            <span>{CATEGORIE[carte.category]}</span>
            {carte.year && <span>{carte.year}</span>}
            {duree && <span>{duree}</span>}
          </MetaRow>
          {carte.voteAverage !== null && carte.voteAverage > 0 && (
            <p className="text-xs text-muted">{`${carte.voteAverage.toLocaleString("fr-FR", { maximumFractionDigits: 1 })} sur 10 sur TMDB`}</p>
          )}
        </div>
      </div>
      {carte.overview && <p className="text-sm text-muted">{carte.overview}</p>}
      {lignes.length > 0 && (
        <dl className="flex flex-col divide-y divide-divider text-sm">
          {lignes.map(([label, valeur]) => (
            <div
              key={label}
              className="flex items-baseline justify-between gap-4 py-2"
            >
              <dt className="shrink-0 text-muted">{label}</dt>
              <dd className="min-w-0 text-right text-foreground">{valeur}</dd>
            </div>
          ))}
        </dl>
      )}
      {fiche === undefined && (
        <p className="text-xs text-muted">Chargement des détails…</p>
      )}
      <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
        <TrailerButton trailer={trailer} title={carte.name} />
        <Button size="sm" variant="ghost" onClick={onRetour}>
          Retour à l&apos;affiche
        </Button>
      </div>
    </div>
  );
}

export function SwipeDeck({
  cartes,
  fiches,
  onRepondre,
  onAnnuler,
  peutAnnuler = false,
  retour,
  fin,
  clavier = "page",
  balayageVertical = true,
  pied,
  className,
}: {
  /** La file : la première carte est sur le dessus. */
  cartes: CarteSwipe[];
  /** Fiches chargées, par clé : undefined pendant le chargement, null si TMDB n'a rien donné. */
  fiches: Record<string, FicheCarte | null | undefined>;
  onRepondre: (carte: CarteSwipe, reponse: ReponseSwipe) => void;
  onAnnuler?: () => void;
  peutAnnuler?: boolean;
  /** La phrase sous les gestes (« Dune » dans ta pile). */
  retour?: ReactNode;
  /** Ce qui remplace la carte quand la file est vide. */
  fin: ReactNode;
  /** `page` : les touches marchent partout (page dédiée) ; `focus` : seulement dans le paquet (page d'arrivée). */
  clavier?: "page" | "focus";
  /** Balayer vers le haut au doigt ; sinon la page défile (page d'arrivée), « Déjà vu » reste un bouton. */
  balayageVertical?: boolean;
  /** À droite de la ligne du bas (la bienvenue : l'étape suivante). */
  pied?: ReactNode;
  className?: string;
}) {
  const carte = cartes[0] ?? null;
  const dessous = cartes[1] ?? null;
  const paquet = useRef<HTMLDivElement | null>(null);
  const [glisse, setGlisse] = useState<{
    x: number;
    y: number;
    w: number;
  } | null>(null);
  const [sortie, setSortie] = useState<Sortie | null>(null);
  // Le verso ne vaut que pour la carte du dessus : une autre carte repart de l'affiche.
  const [mode, setMode] = useState<{ cle: string; verso: boolean } | null>(
    null,
  );
  const verso = mode?.cle === carte?.cle && mode?.verso === true;
  const minuterie = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [indice, setIndice] = useState(false);
  const carteDessus = useRef<HTMLElement | null>(null);
  const tamponOui = useRef<HTMLSpanElement | null>(null);
  const tamponNon = useRef<HTMLSpanElement | null>(null);
  // L'indice : passages joués depuis l'arrivée à l'écran ; le paquet est-il à l'écran ; un geste l'a-t-il arrêté.
  const joues = useRef(0);
  const aLEcran = useRef(false);
  const indiceFini = useRef(false);
  const relance = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appui = useRef<{
    id: number;
    x0: number;
    y0: number;
    t0: number;
    w: number;
    h: number;
    lx: number;
    ly: number;
    lt: number;
    vx: number;
    vy: number;
  } | null>(null);

  useEffect(
    () => () => {
      if (minuterie.current) clearTimeout(minuterie.current);
      if (relance.current) clearTimeout(relance.current);
    },
    [],
  );

  // ---------- l'indice du geste (FR-12) ----------
  /** Le prochain passage, selon le rythme (src/lib/indice.ts) ; rien si un geste l'a arrêté ou hors de l'écran. */
  const planifierIndice = useCallback(() => {
    if (relance.current) clearTimeout(relance.current);
    relance.current = null;
    const delai = prochainIndice(joues.current);
    if (
      delai === null ||
      indiceFini.current ||
      !aLEcran.current ||
      gesteAppris() ||
      prefersReducedMotion()
    )
      return;
    relance.current = setTimeout(() => {
      if (indiceFini.current || !aLEcran.current || document.hidden) return;
      joues.current += 1;
      setIndice(true);
    }, delai);
  }, []);
  /** Un contact avec le paquet : plus d'indice ici ; un vrai balayage : plus d'indice de la séance. */
  const arreterIndice = useCallback((appris = false) => {
    indiceFini.current = true;
    if (appris) noterGesteAppris();
    if (relance.current) clearTimeout(relance.current);
    setIndice(false);
  }, []);
  const finIndice = useCallback(() => {
    setIndice(false);
    planifierIndice();
  }, [planifierIndice]);
  // Le balancement lui-même : un préréglage de mouvement ; arrêté (et la carte remise en place) dès que
  // l'indice cesse, par un geste ou un retournement.
  useGSAP(
    () => {
      if (!indice || !carteDessus.current) return;
      preset.indice(
        carteDessus.current,
        { droite: tamponOui.current, gauche: tamponNon.current },
        finIndice,
      );
    },
    { dependencies: [indice], revertOnUpdate: true },
  );
  // À l'écran (60 % du paquet visible) : le compte repart de zéro, premier passage 1 s plus tard. Hors de
  // l'écran (moins de 20 %) ou onglet caché : tout s'arrête ; au retour, ça recommence.
  useEffect(() => {
    const element = paquet.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    const suspendre = () => {
      if (relance.current) clearTimeout(relance.current);
      relance.current = null;
      setIndice(false);
    };
    const observateur = new IntersectionObserver(
      (entrees) => {
        const ratio = entrees[entrees.length - 1]?.intersectionRatio ?? 0;
        if (ratio >= 0.6 && !aLEcran.current) {
          aLEcran.current = true;
          joues.current = 0;
          planifierIndice();
        } else if (ratio < 0.2 && aLEcran.current) {
          aLEcran.current = false;
          suspendre();
        }
      },
      { threshold: [0, 0.2, 0.6] },
    );
    observateur.observe(element);
    const surVisibilite = () => {
      if (!aLEcran.current) return;
      if (document.hidden) suspendre();
      else {
        joues.current = 0;
        planifierIndice();
      }
    };
    document.addEventListener("visibilitychange", surVisibilite);
    return () => {
      observateur.disconnect();
      document.removeEventListener("visibilitychange", surVisibilite);
    };
  }, [planifierIndice]);

  // Les affiches des cartes suivantes, chargées d'avance : la suivante apparaît sans attendre.
  const aPrecharger = cartes
    .slice(2, 6)
    .map((c) => c.posterUrl)
    .filter((u): u is string => Boolean(u))
    .join("|");
  useEffect(() => {
    for (const url of aPrecharger.split("|")) {
      if (!url) continue;
      const image = new Image();
      image.src = url;
    }
  }, [aPrecharger]);

  const partir = useCallback(
    (reponse: ReponseSwipe) => {
      if (!carte || sortie) return;
      arreterIndice();
      const boite = paquet.current?.getBoundingClientRect();
      if (prefersReducedMotion() || !boite) {
        setGlisse(null);
        setMode(null);
        onRepondre(carte, reponse);
        return;
      }
      setSortie(versSortie(reponse, boite.width, boite.height, glisse));
      minuterie.current = setTimeout(() => {
        setSortie(null);
        setGlisse(null);
        setMode(null);
        onRepondre(carte, reponse);
      }, SORTIE_MS);
    },
    [carte, sortie, glisse, onRepondre, arreterIndice],
  );

  const retourner = useCallback(
    (v: boolean) => {
      if (!carte) return;
      arreterIndice();
      setMode({ cle: carte.cle, verso: v });
      if (clavier === "focus") paquet.current?.focus({ preventScroll: true });
    },
    [carte, clavier, arreterIndice],
  );

  // ---------- clavier ----------
  const surTouche = useEffectEvent((e: KeyboardEvent) => {
    if (document.querySelector("[aria-modal='true']")) return; // le lecteur de bande-annonce est ouvert
    if (
      (e.target as Element | null)?.closest?.(
        "input, textarea, select, [contenteditable='true']",
      )
    )
      return;
    if (
      clavier === "focus" &&
      !paquet.current?.parentElement?.contains(document.activeElement)
    )
      return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      if (peutAnnuler && onAnnuler) {
        e.preventDefault();
        onAnnuler();
      }
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || !carte) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      partir({ kind: "envie" });
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      partir({ kind: "non" });
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      partir({ kind: "vu" });
    } else if (e.key.toLowerCase() === "i") {
      retourner(!verso);
    } else if (e.key === "Escape" && verso) {
      retourner(false);
    }
  });
  useEffect(() => {
    const ecoute = (e: KeyboardEvent) => surTouche(e);
    window.addEventListener("keydown", ecoute);
    return () => window.removeEventListener("keydown", ecoute);
  }, []);

  // ---------- balayage (doigt ou souris) ----------
  function surAppui(e: ReactPointerEvent<HTMLElement>) {
    if (e.button !== 0 || !carte || sortie || verso) return;
    if ((e.target as Element).closest("button, a")) return;
    const boite = e.currentTarget.getBoundingClientRect();
    e.currentTarget.setPointerCapture(e.pointerId);
    const t = performance.now();
    appui.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      t0: t,
      w: boite.width,
      h: boite.height,
      lx: e.clientX,
      ly: e.clientY,
      lt: t,
      vx: 0,
      vy: 0,
    };
    if (clavier === "focus") paquet.current?.focus({ preventScroll: true });
  }
  function surDeplacement(e: ReactPointerEvent<HTMLElement>) {
    const a = appui.current;
    if (!a || a.id !== e.pointerId) return;
    const t = performance.now();
    const dt = Math.max(1, t - a.lt);
    a.vx = (e.clientX - a.lx) / dt;
    a.vy = (e.clientY - a.ly) / dt;
    a.lx = e.clientX;
    a.ly = e.clientY;
    a.lt = t;
    // La carte bouge vraiment sous le doigt (pas un défilement de la page qui part d'elle) : plus d'indice.
    if (
      !indiceFini.current &&
      Math.abs(e.clientX - a.x0) + Math.abs(e.clientY - a.y0) > 8
    )
      arreterIndice();
    setGlisse({
      x: e.clientX - a.x0,
      y: Math.min(e.clientY - a.y0, 40),
      w: a.w,
    });
  }
  function surLacher(e: ReactPointerEvent<HTMLElement>) {
    const a = appui.current;
    if (!a || a.id !== e.pointerId) return;
    appui.current = null;
    if (e.type === "pointercancel") {
      setGlisse(null);
      return;
    }
    const dx = e.clientX - a.x0;
    const dy = e.clientY - a.y0;
    // Un tap retourne la carte.
    if (
      Math.abs(dx) < 6 &&
      Math.abs(dy) < 6 &&
      performance.now() - a.t0 < 350
    ) {
      setGlisse(null);
      retourner(true);
      return;
    }
    const versLeHaut =
      Math.abs(dy) > Math.abs(dx) &&
      (dy < -a.h * 0.18 || (a.vy < -0.5 && dy < -30));
    const surLeCote =
      Math.abs(dx) > a.w * 0.28 || (Math.abs(a.vx) > 0.5 && Math.abs(dx) > 30);
    // Un vrai balayage : le geste est appris, plus d'indice de la séance.
    if (versLeHaut || surLeCote) arreterIndice(true);
    if (versLeHaut) partir({ kind: "vu" });
    else if (surLeCote) partir({ kind: dx > 0 ? "envie" : "non" });
    else setGlisse(null);
  }

  // Le tampon qui apparaît en glissant : son geste et sa netteté.
  const tampon: { cls: string; label: string; opacite: number } | null = glisse
    ? Math.abs(glisse.y) > Math.abs(glisse.x) && glisse.y < 0
      ? {
          cls: "is-vu",
          label: "Déjà vu",
          opacite: Math.min(1, -glisse.y / (glisse.w * 0.35)),
        }
      : {
          cls: glisse.x > 0 ? "is-envie" : "is-non",
          label: glisse.x > 0 ? "Ça me tente" : "Pas pour moi",
          opacite: Math.min(1, Math.abs(glisse.x) / (glisse.w * 0.3)),
        }
    : sortie
      ? sortie.y < 0 && sortie.x === 0
        ? { cls: "is-vu", label: "Déjà vu", opacite: 1 }
        : {
            cls: sortie.x > 0 ? "is-envie" : "is-non",
            label: sortie.x > 0 ? "Ça me tente" : "Pas pour moi",
            opacite: 1,
          }
      : null;

  const style: CSSProperties = sortie
    ? {
        transform: `translate(${sortie.x}px, ${sortie.y}px) rotate(${sortie.rot}deg)`,
        opacity: 0,
        transition: `transform ${SORTIE_MS}ms var(--ease-out), opacity ${SORTIE_MS}ms var(--ease-out)`,
      }
    : glisse
      ? {
          transform: `translate(${glisse.x}px, ${glisse.y}px) rotate(${glisse.x / 24}deg)`,
          transition: "none",
        }
      : {};
  const tint = carte?.tint
    ? ({ "--tint": carte.tint } as CSSProperties)
    : undefined;

  // La bienvenue : la carte prend la hauteur qui reste dans l'écran (FR-15). La page d'arrivée : sa taille.
  const plein = clavier === "page";
  const enveloppe = (contenu: ReactNode) =>
    plein ? <div className="swipe-zone">{contenu}</div> : contenu;
  return (
    <div
      className={cn(
        "flex w-full flex-col items-center",
        plein ? "h-full min-h-0 gap-3" : "gap-4",
        className,
      )}
    >
      {enveloppe(
        <div
          ref={paquet}
          tabIndex={clavier === "focus" ? 0 : -1}
          aria-label={
            clavier === "focus"
              ? "Cartes de titres : flèches gauche, droite et haut pour répondre"
              : undefined
          }
          className={cn("swipe-deck", plein && "is-page")}
          style={tint}
        >
          {[dessous, carte].map((c, i) =>
            c ? (
              i === 0 ? (
                <div
                  key={c.cle}
                  aria-hidden="true"
                  className="swipe-card is-under"
                >
                  {c.posterUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={c.posterUrl}
                      alt=""
                      draggable={false}
                      className="swipe-card-image"
                    />
                  )}
                </div>
              ) : (
                <article
                  key={c.cle}
                  aria-label={`${c.name}${c.year ? `, ${c.year}` : ""}`}
                  ref={carteDessus}
                  className={cn("swipe-card", !balayageVertical && "is-pan-y")}
                  style={style}
                  onPointerDown={surAppui}
                  onPointerMove={surDeplacement}
                  onPointerUp={surLacher}
                  onPointerCancel={surLacher}
                >
                  {verso ? (
                    <Verso
                      carte={c}
                      fiche={fiches[c.cle]}
                      onRetour={() => retourner(false)}
                    />
                  ) : (
                    <Recto
                      carte={c}
                      fiche={fiches[c.cle]}
                      onInfos={() => retourner(true)}
                    />
                  )}
                  {tampon && !verso && (
                    <span
                      aria-hidden="true"
                      className={cn("swipe-stamp", tampon.cls)}
                      style={{ opacity: tampon.opacite }}
                    >
                      {tampon.label}
                    </span>
                  )}
                  {indice && !verso && !tampon && (
                    <>
                      <span
                        ref={tamponOui}
                        aria-hidden="true"
                        className="swipe-stamp is-envie"
                        style={{ opacity: 0 }}
                      >
                        Ça me tente
                      </span>
                      <span
                        ref={tamponNon}
                        aria-hidden="true"
                        className="swipe-stamp is-non"
                        style={{ opacity: 0 }}
                      >
                        Pas pour moi
                      </span>
                    </>
                  )}
                </article>
              )
            ) : null,
          )}
          {!carte && <div className="swipe-card is-end">{fin}</div>}
        </div>,
      )}

      <div className="grid w-full max-w-xl shrink-0 grid-cols-3 gap-2">
        <Geste
          icon={X}
          label="Pas pour moi"
          touche="←"
          onClick={() => partir({ kind: "non" })}
          disabled={!carte}
        />
        <Geste
          icon={Eye}
          label="Déjà vu"
          touche="↑"
          onClick={() => partir({ kind: "vu" })}
          disabled={!carte}
        />
        <Geste
          icon={Heart}
          label="Ça me tente"
          touche="→"
          onClick={() => partir({ kind: "envie" })}
          disabled={!carte}
        />
      </div>

      <div className="flex h-9 w-full max-w-xl shrink-0 items-center justify-between gap-3 text-sm text-muted">
        <span aria-live="polite" className="min-w-0 truncate">
          {retour ?? ""}
        </span>
        <div className="flex shrink-0 items-center gap-2">
          {peutAnnuler && onAnnuler && (
            <Button
              size="sm"
              variant="ghost"
              onClick={onAnnuler}
              aria-keyshortcuts="Control+Z"
              aria-label="Annuler le dernier geste"
            >
              <Undo2 size={14} aria-hidden="true" />
              <span className="hidden sm:inline">Annuler</span>
              <span className="hidden items-center gap-1 md:inline-flex">
                <Kbd>Ctrl</Kbd>
                <Kbd>Z</Kbd>
              </span>
            </Button>
          )}
          {pied}
        </div>
      </div>
    </div>
  );
}

/** Les fiches des prochaines cartes, demandées d'avance (trois à la fois) et gardées pour la séance. */
export function useFiches(
  cartes: CarteSwipe[],
  avance = 3,
): Record<string, FicheCarte | null | undefined> {
  const [fiches, setFiches] = useState<Record<string, FicheCarte | null>>({});
  const demandees = useRef(new Set<string>());
  const cles = cartes
    .slice(0, avance)
    .map((c) => c.cle)
    .join(",");
  const demander = useEffectEvent(() => {
    for (const c of cartes.slice(0, avance)) {
      if (demandees.current.has(c.cle)) continue;
      demandees.current.add(c.cle);
      fetch(
        `/api/tmdb/title?tmdbId=${c.tmdbId}&type=${encodeURIComponent(c.type)}`,
      )
        .then((r) => (r.ok ? (r.json() as Promise<FicheCarte>) : null))
        .catch(() => null)
        .then((f) => setFiches((avant) => ({ ...avant, [c.cle]: f })));
    }
  });
  // Les cartes du dessus changent : on demande celles qui manquent.
  useEffect(() => demander(), [cles]);
  return fiches;
}
