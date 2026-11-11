"use client";

import { useEffect, useEffectEvent, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  CalendarDays,
  ListVideo,
  Loader2,
  Popcorn,
  Trophy,
} from "lucide-react";
import { RatingKeys, ratedAs } from "@/components/RatingKeys";
import { DuelPreview } from "@/components/sections/previews";
import { Button } from "@/components/ui/Button";
import { MetaRow } from "@/components/ui/primitives";
import type { DuelItem } from "@/lib/duelService";
import type { Category } from "@/lib/libraryItem";
import type { RecommendedItem } from "@/lib/recommendationService";

// Les étapes de la bienvenue après le balayage — spec: specs/bienvenue-v1.md (FR-14). De vraies données : les
// titres vus à noter (le tri rapide « Déjà vus »), les duels, les premières recommandations. Chacune tient
// dans la hauteur qui reste (FR-15) et dit, quand elle est vide, quel geste l'ouvre.

const JSON_HEADERS = { "Content-Type": "application/json" };
const CATEGORIE: Record<Category, string> = {
  Movie: "Film",
  "TV Series": "Série",
  Documentary: "Documentaire",
};

type CarteVue = {
  id: number;
  title: string;
  year: string | null;
  posterUrl: string | null;
  category: Category;
};

/** Une étape vide : ce qui manque, et le geste qui l'ouvre. */
function Vide({
  titre,
  texte,
  action,
}: {
  titre: string;
  texte: string;
  action: ReactNode;
}) {
  return (
    <div className="swipe-zone">
      <div className="flex max-w-sm flex-col items-center gap-3 text-center">
        <p className="text-subheading text-foreground">{titre}</p>
        <p className="text-sm text-muted">{texte}</p>
        {action}
      </div>
    </div>
  );
}

function Chargement() {
  return (
    <div className="swipe-zone">
      <Loader2
        size={20}
        aria-label="Chargement"
        className="animate-spin text-muted"
      />
    </div>
  );
}

/** Une ligne du bas : ce qui vient de se passer, et l'étape suivante. */
function Pied({ retour, pied }: { retour: string | null; pied: ReactNode }) {
  return (
    <div className="flex h-9 w-full max-w-xl shrink-0 items-center justify-between gap-3 text-sm text-muted">
      <span aria-live="polite" className="min-w-0 truncate">
        {retour ?? ""}
      </span>
      <div className="flex shrink-0 items-center gap-2">{pied}</div>
    </div>
  );
}

// ---------- 2. Note ----------

/** Les titres vus sans note, un par un : 0 pour 💩, de 1 à 5 étoiles, ou « Passer ». */
export function NoteEtape({
  onNote,
  versBalaie,
  pied,
}: {
  onNote: () => void;
  versBalaie: () => void;
  pied: ReactNode;
}) {
  const [cartes, setCartes] = useState<CarteVue[] | null>(null);
  const [retour, setRetour] = useState<string | null>(null);
  const [touche, setTouche] = useState<string | null>(null);

  useEffect(() => {
    let vivant = true;
    fetch("/api/triage/batch?family=seen&limit=40")
      .then((r) =>
        r.ok ? (r.json() as Promise<{ cards?: CarteVue[] }>) : null,
      )
      .catch(() => null)
      .then((corps) => vivant && setCartes(corps?.cards ?? []));
    return () => {
      vivant = false;
    };
  }, []);

  const courante = cartes?.[0] ?? null;

  function noter(n: number) {
    if (!courante) return;
    setTouche(String(n));
    setTimeout(() => setTouche(null), 150);
    setCartes((c) => (c ?? []).slice(1));
    setRetour(`« ${courante.title} » ${ratedAs(n)}.`);
    onNote();
    void fetch("/api/triage/answer", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        card: { family: "seen", id: courante.id },
        answer: "like",
        rating: n,
      }),
    }).catch(() => null);
  }

  function passer() {
    if (!courante) return;
    setCartes((c) => [...(c ?? []).slice(1)]);
    setRetour(`« ${courante.title} » : passé.`);
  }

  const surTouche = useEffectEvent((e: KeyboardEvent) => {
    if (
      document.querySelector("[aria-modal='true']") ||
      e.ctrlKey ||
      e.metaKey ||
      e.altKey ||
      e.repeat
    )
      return;
    if (
      (e.target as Element | null)?.closest?.(
        "input, textarea, select, [contenteditable='true']",
      )
    )
      return;
    if (/^[0-5]$/.test(e.key)) {
      e.preventDefault();
      noter(Number(e.key));
    } else if (e.key === " " && !(e.target instanceof HTMLButtonElement)) {
      e.preventDefault();
      passer();
    }
  });
  useEffect(() => {
    const ecoute = (e: KeyboardEvent) => surTouche(e);
    window.addEventListener("keydown", ecoute);
    return () => window.removeEventListener("keydown", ecoute);
  }, []);

  if (cartes === null) return <Chargement />;
  if (!courante)
    return (
      <>
        <Vide
          titre={
            retour
              ? "Tes titres vus sont notés."
              : "Rien à noter pour l'instant."
          }
          texte={
            retour
              ? "Départage-les maintenant, ou balaie encore pour en ajouter."
              : "Balaie « Déjà vu » sur les titres que tu connais : ils arrivent ici, à noter d'une touche."
          }
          action={
            <Button onClick={versBalaie}>
              Balayer des titres
            </Button>
          }
        />
        <Pied retour={retour} pied={pied} />
      </>
    );

  return (
    <>
      <div className="swipe-zone">
        <div className="swipe-deck is-page">
          <article
            aria-label={`${courante.title}${courante.year ? `, ${courante.year}` : ""}`}
            className="swipe-card cursor-default"
          >
            {courante.posterUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={courante.posterUrl}
                alt=""
                draggable={false}
                className="swipe-card-image"
              />
            )}
            <div className="swipe-card-scrim">
              <p className="line-clamp-2 text-subheading text-foreground">
                {courante.title}
              </p>
              <MetaRow>
                <span>{CATEGORIE[courante.category]}</span>
                {courante.year && <span>{courante.year}</span>}
              </MetaRow>
            </div>
          </article>
        </div>
      </div>
      <div className="flex w-full max-w-xl shrink-0 flex-col items-center gap-2">
        <RatingKeys
          onRate={noter}
          disabled={false}
          pressed={touche}
          className="w-full"
        />
      </div>
      <Pied
        retour={retour}
        pied={
          <>
            <Button variant="ghost" onClick={passer}>
              Passer
            </Button>
            {pied}
          </>
        }
      />
    </>
  );
}

// ---------- 3. Départage ----------

/** Les duels de l'application, sur tes titres notés. */
export function DepartageEtape({
  onDuel,
  versNote,
  pied,
}: {
  onDuel: () => void;
  versNote: () => void;
  pied: ReactNode;
}) {
  const [paire, setPaire] = useState<
    { a: DuelItem; b: DuelItem } | null | undefined
  >(undefined);
  useEffect(() => {
    let vivant = true;
    fetch("/api/duels/next")
      .then((r) =>
        r.ok
          ? (r.json() as Promise<{ itemA?: DuelItem; itemB?: DuelItem }>)
          : null,
      )
      .catch(() => null)
      .then(
        (d) =>
          vivant &&
          setPaire(d?.itemA && d.itemB ? { a: d.itemA, b: d.itemB } : null),
      );
    return () => {
      vivant = false;
    };
  }, []);

  if (paire === undefined) return <Chargement />;
  if (paire === null)
    return (
      <>
        <Vide
          titre="Il faut deux titres notés."
          texte="Un duel départage deux titres que tu as vus et notés : note-en au moins deux."
          action={
            <Button onClick={versNote}>
              Noter mes titres vus
            </Button>
          }
        />
        <Pied retour={null} pied={pied} />
      </>
    );
  return (
    <>
      <div className="etape-scene flex min-h-0 w-full max-w-2xl flex-1 flex-col justify-center overflow-y-auto">
        <DuelPreview initial={paire} onDuel={onDuel} />
      </div>
      <Pied retour={null} pied={pied} />
    </>
  );
}

// ---------- 4. Tes recos ----------

const PLUS: { href: string; icone: typeof Popcorn; nom: string }[] = [
  { href: "/ce-soir", icone: Popcorn, nom: "Ce soir" },
  { href: "/classement", icone: Trophy, nom: "Classement" },
  { href: "/playlists", icone: ListVideo, nom: "Playlists" },
  { href: "/sorties", icone: CalendarDays, nom: "Sorties" },
];

/** Les trois premières recommandations, puis l'application. */
export function RecosEtape({
  versNote,
  pied,
}: {
  versNote: () => void;
  pied: ReactNode;
}) {
  const [recos, setRecos] = useState<
    RecommendedItem[] | { manque: number } | null
  >(null);
  useEffect(() => {
    let vivant = true;
    fetch("/api/recommendations?limit=3")
      .then((r) =>
        r.ok
          ? (r.json() as Promise<{
              items?: RecommendedItem[];
              error?: string;
              ratedCount?: number;
            }>)
          : null,
      )
      .catch(() => null)
      .then((d) => {
        if (!vivant) return;
        if (d?.items) setRecos(d.items.slice(0, 3));
        else setRecos({ manque: Math.max(1, 10 - (d?.ratedCount ?? 0)) });
      });
    return () => {
      vivant = false;
    };
  }, []);

  if (recos === null) return <Chargement />;
  if (!Array.isArray(recos) || recos.length === 0)
    return (
      <>
        <Vide
          titre="Tes recommandations arrivent avec tes notes."
          texte={`Encore ${Array.isArray(recos) ? "quelques" : recos.manque} notes sur des titres vus, et Catalog range ta pile selon tes goûts.`}
          action={
            <Button onClick={versNote}>
              Noter mes titres vus
            </Button>
          }
        />
        <Pied retour={null} pied={pied} />
      </>
    );
  return (
    <>
      <div className="swipe-zone">
        <ul className="recos-trio">
          {recos.map((r) => (
            <li key={r.id} className="flex min-w-0 flex-col gap-2">
              <div className="poster aspect-[2/3] w-full">
                {r.posterUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={r.posterUrl}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                )}
              </div>
              <p className="truncate text-sm text-foreground">{r.name}</p>
              {r.compatibility !== null && (
                <p className="text-xs text-muted">{`${Math.round(r.compatibility * 100)} % pour toi`}</p>
              )}
            </li>
          ))}
        </ul>
      </div>
      <nav
        aria-label="Dans Catalog, ensuite"
        className="flex shrink-0 flex-wrap items-center justify-center gap-2"
      >
        {PLUS.map(({ href, icone: Icone, nom }) => (
          <Link key={href} href={href} className="chip">
            <Icone size={14} aria-hidden="true" />
            {nom}
          </Link>
        ))}
      </nav>
      <Pied retour={null} pied={pied} />
    </>
  );
}
