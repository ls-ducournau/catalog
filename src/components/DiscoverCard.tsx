"use client";

import { buttonClass } from "@/components/ui/Button";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { EyeOff, Info, ListPlus, Plus, Trash2 } from "lucide-react";
import { ScoreBadge } from "@/components/ScoreBadge";
import {
  SynopsisTooltip,
  markTooltipShown,
  tooltipDelayMs,
} from "@/components/SynopsisTooltip";
import { STATUS_META, type WatchStatus } from "@/lib/libraryItem";
import type { Provider } from "@/lib/availability";
import { ProviderLogo } from "@/components/ProviderLogo";
import { ReleaseBadge } from "@/components/ReleaseBadge";
import type { ReleaseInfo } from "@/lib/release";
import type { Trailer } from "@/lib/trailer";
import { TrailerButton } from "@/components/TrailerButton";
import { openPlaylistDialog } from "@/components/playlists/PlaylistDialog";

/** Titre venant de TMDB, pas encore (ou juste) entré en bibliothèque. */
export type DiscoverCardItem = {
  tmdbId: number;
  type: "Movie" | "TV Series";
  title: string;
  year: string | null;
  posterUrl: string | null;
  voteAverage: number | null;
  voteCount: number | null;
  isDocumentary: boolean;
  overview: string;
  libraryStatus: WatchStatus | null;
  /** Dates de sortie, quand elles sont connues (sorties-v1 FR-2). */
  release?: ReleaseInfo | null;
  /** Bande-annonce, quand elle est connue (bandes-annonces-v1 FR-3). */
  trailer?: Trailer | null;
};


/**
 * Carte de tirage. La pastille « i » en haut à gauche de l'affiche ouvre le synopsis au survol
 * (et au tap, faute de survol sur tactile) : on juge un titre sans ouvrir sa fiche.
 */
export function DiscoverCard({
  item,
  pending = false,
  onOpen,
  onAdd,
  onRemove,
  onDismiss,
  footnote,
  includedOn,
}: {
  item: DiscoverCardItem;
  pending?: boolean;
  /** Absent = la carte n'est pas cliquable (pas de fiche à ouvrir). */
  onOpen?: () => void;
  onAdd: () => void;
  /** Absent = pas de retrait depuis la carte. */
  onRemove?: () => void;
  /** « Ne plus me proposer » (tri-rapide FR-2) : seulement tant que le titre n'est pas ajouté. */
  onDismiss?: () => void;
  /** Ligne libre sous le titre (ex. les semences d'une découverte). */
  footnote?: ReactNode;
  /** Services de tes abonnements où le titre est inclus. */
  includedOn?: Provider[];
}) {
  const [infoEl, setInfoEl] = useState<HTMLButtonElement | null>(null);
  const [showSynopsis, setShowSynopsis] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function openSynopsis() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => setShowSynopsis(true), tooltipDelayMs());
  }

  function closeSynopsis() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    if (showSynopsis) markTooltipShown();
    setShowSynopsis(false);
  }

  useEffect(() => {
    return () => {
      if (hoverTimer.current) clearTimeout(hoverTimer.current);
    };
  }, []);

  return (
    <div className="group relative">
      {showSynopsis && infoEl && item.overview && (
        <SynopsisTooltip anchor={infoEl} text={item.overview} onDismiss={closeSynopsis} />
      )}

      {/* Motif du « lien étiré » : le titre ouvre la fiche, son ::after couvre toute la carte ; les
          autres contrôles sont posés au-dessus (z-10), jamais un bouton dans un bouton. */}
      <div>
        <div className="poster aspect-[2/3] w-full">
          {item.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.posterUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-2xl text-muted">🎬</div>
          )}
          {/* En bas à gauche de l'affiche, empilés : la sortie (sorties-v1 FR-2), puis la
              disponibilité (disponibilite-streaming-v1 FR-6), seulement quand le titre est inclus
              dans l'un de tes abonnements. Rien s'il n'y a rien à dire. */}
          <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-5.5rem)] flex-col items-start gap-1">
            <ReleaseBadge release={item.release ?? null} />
            {includedOn && includedOn.length > 0 && (
              <span
                title={`Inclus dans ${includedOn.map((p) => p.name).join(", ")}`}
                className={`pointer-events-auto relative z-10 flex items-center gap-1 rounded-lg bg-black/75 p-0.5 ring-1 ring-white/15 ${
                  includedOn.length > 1 ? "pr-1.5" : ""
                }`}
              >
                <ProviderLogo provider={includedOn[0]} size={18} />
                {includedOn.length > 1 && (
                  <span className="text-xs font-medium text-foreground">+{includedOn.length - 1}</span>
                )}
              </span>
            )}
          </div>

          {/* Pastille synopsis et mention « déjà ajouté » sur la même ligne : elles se partagent
              le coin haut gauche au lieu de se superposer. */}
          <div className="absolute left-2 top-2 z-10 flex items-center gap-1.5">
            {item.overview && (
              <button
                ref={setInfoEl}
                type="button"
                aria-label={`Synopsis de « ${item.title} »`}
                aria-expanded={showSynopsis}
                onMouseEnter={openSynopsis}
                onMouseLeave={closeSynopsis}
                onFocus={openSynopsis}
                onBlur={closeSynopsis}
                onClick={() => {
                  if (showSynopsis) closeSynopsis();
                  else openSynopsis();
                }}
                // Lisible sur n'importe quelle affiche (fond opaque + anneau + flou), il s'éclaire
                // quand on survole la carte, et reste allumé en accent pendant que la bulle est
                // ouverte : on voit à quelle carte elle appartient.
                className={`relative rounded-full p-1.5 leading-none ring-1 backdrop-blur-[2px] transition-colors duration-200 active:scale-90 outline-none focus-visible:ring-2 focus-visible:ring-focus ${
                  showSynopsis
                    ? "bg-black text-foreground ring-line-strong"
                    : "bg-black/75 text-foreground ring-white/20 hover:bg-black [@media(hover:hover)]:group-hover:ring-white/40"
                }`}
              >
                <Info size={15} aria-hidden="true" />

                {/* Indice au survol de la carte : glisse sous la pastille (transform + opacité
                    seulement), et disparaît dès que la bulle est ouverte. */}
                {!showSynopsis && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-0 top-full mt-1 -translate-y-1 rounded-full bg-black/80 px-2 py-0.5 text-xs font-medium text-foreground opacity-0 ring-1 ring-white/15 transition duration-200 [@media(hover:hover)]:group-hover:translate-y-0 [@media(hover:hover)]:group-hover:opacity-100"
                  >
                    Synopsis
                  </span>
                )}
              </button>
            )}
            {item.libraryStatus && (
              <span className="overlay-pill">
                Déjà ajouté · {STATUS_META[item.libraryStatus].label}
              </span>
            )}
          </div>

          <div className="pointer-events-none absolute right-2 top-2">
            <ScoreBadge voteAverage={item.voteAverage} voteCount={item.voteCount} />
          </div>

          {pending && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/70 text-xs text-foreground">
              …
            </div>
          )}
        </div>
        <div className="px-0.5 pt-2.5">
          {onOpen ? (
            <button
              type="button"
              onClick={onOpen}
              className="block w-full truncate rounded-sm text-left text-sm font-medium text-foreground outline-none after:absolute after:inset-0 after:rounded-frame after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-focus focus-visible:after:ring-offset-4 focus-visible:after:ring-offset-background"
            >
              {item.title}
            </button>
          ) : (
            <p className="truncate text-sm font-medium text-foreground">{item.title}</p>
          )}
          <p className="text-xs text-muted">
            {[item.year, item.isDocumentary ? "Documentaire" : item.type === "Movie" ? "Film" : "Série"].filter(Boolean).join(" · ")}
          </p>
          {footnote && <div className="relative z-10">{footnote}</div>}
        </div>
      </div>

      {/* ▶ au centre de l'affiche, comme dans Sorties et la pile (bandes-annonces FR-3). Hors de la
          zone cliquable de la carte : seul le ▶ capte le clic. */}
      {!pending && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex aspect-[2/3] items-center justify-center">
          <TrailerButton trailer={item.trailer ?? null} title={item.title} variant="icon" className="pointer-events-auto" />
        </div>
      )}

      {/* Actions de la carte, en bas à droite de l'affiche : écarter à gauche, ajouter (ou
          retirer) à droite, là où le pouce et la souris les attendent. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-10 aspect-[2/3]">
        <div className="pointer-events-auto absolute bottom-2 right-2 flex items-center gap-1">
        {/* playlists-v2 FR-2 et FR-3 : dans une playlist, et dans ta pile s'il n'y est pas encore. */}
        <button
          type="button"
          onClick={() => openPlaylistDialog({ kind: "tmdb", tmdbId: item.tmdbId, mediaType: item.type, name: item.title }, "decouvrir")}
          disabled={pending}
          title="Ajouter à une playlist"
          aria-label={`Ajouter « ${item.title} » à une playlist`}
          className={buttonClass({ variant: "overlay", size: "sm", icon: true, className: "opacity-0 focus-visible:opacity-100 disabled:hidden [@media(hover:none)]:opacity-100 [@media(hover:hover)]:group-hover:opacity-100" })}
        >
          <ListPlus size={16} aria-hidden="true" />
        </button>
        {onDismiss && item.libraryStatus === null && (
          <button
            type="button"
            onClick={onDismiss}
            disabled={pending}
            title="Ne plus me proposer"
            aria-label={`Ne plus me proposer « ${item.title} »`}
            className={buttonClass({ variant: "overlay", size: "sm", icon: true, className: "opacity-0 focus-visible:opacity-100 disabled:hidden [@media(hover:none)]:opacity-100 [@media(hover:hover)]:group-hover:opacity-100" })}
          >
            <EyeOff size={16} aria-hidden="true" />
          </button>
        )}
        {(item.libraryStatus === null || onRemove) && (
          <button
            type="button"
            onClick={item.libraryStatus === null ? onAdd : onRemove}
            disabled={pending}
            title={item.libraryStatus === null ? "Ajouter à la bibliothèque" : "Retirer de la bibliothèque"}
            aria-label={
              item.libraryStatus === null ? "Ajouter à la bibliothèque" : "Retirer de la bibliothèque"
            }
            className={buttonClass({ variant: "overlay", size: "sm", icon: true, className: "opacity-0 focus-visible:opacity-100 disabled:text-muted [@media(hover:none)]:opacity-100 [@media(hover:hover)]:group-hover:opacity-100" })}
          >
            {item.libraryStatus === null ? (
              <Plus size={16} aria-hidden="true" />
            ) : (
              <Trash2 size={16} aria-hidden="true" />
            )}
          </button>
        )}
        </div>
      </div>
    </div>
  );
}
