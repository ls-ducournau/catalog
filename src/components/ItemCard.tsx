"use client";

import { buttonClass } from "@/components/ui/Button";
import { useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { EyeOff, Info, ListPlus } from "lucide-react";
import { openPlaylistDialog } from "@/components/playlists/PlaylistDialog";
import { StarRating, StarsReadOnly } from "@/components/StarRating";
import {
  SynopsisTooltip,
  markTooltipShown,
  tooltipDelayMs,
} from "@/components/SynopsisTooltip";
import { STATUS_META, ratingPatch, type ItemPatch, type LibraryItem } from "@/lib/libraryItem";
import type { Provider } from "@/lib/availability";
import { itemExposureKey } from "@/lib/impressionKeys";
import { ProviderLogo } from "@/components/ProviderLogo";
import { ReleaseBadge } from "@/components/ReleaseBadge";
import { TrailerButton } from "@/components/TrailerButton";
import { RollText } from "@/components/motion/RollText";

/**
 * Carte d'affiche : statut qui bascule au clic, notation directe, synopsis au survol de la
 * pastille « i ». Partagée entre la bibliothèque et les recommandations — `footnote` permet à
 * un écran d'ajouter sa propre ligne (les raisons d'une recommandation, par exemple) sans
 * dupliquer la carte.
 */
export function ItemCard({
  item,
  selectionMode = false,
  selected = false,
  onToggleSelect,
  onOpen,
  onQuickChange,
  onDelete,
  onDismiss,
  onLoadOverview,
  footnote,
  includedOn,
  showTrailer = false,
  quietStatus = false,
}: {
  item: LibraryItem;
  /** Sélection par lot — bibliothèque uniquement. `range` : Maj+clic, toute la plage depuis le dernier clic. */
  selectionMode?: boolean;
  selected?: boolean;
  onToggleSelect?: (range: boolean) => void;
  onOpen: () => void;
  onQuickChange: (id: number, patch: ItemPatch) => void;
  /** Absent = pas de bouton de suppression sur la carte. */
  onDelete?: (item: LibraryItem) => void;
  /** « Ne plus me proposer » (tri-rapide FR-2) — recommandations uniquement. */
  onDismiss?: () => void;
  onLoadOverview: (id: number) => void;
  /** Contenu additionnel sous la notation (ex. raisons d'une recommandation). */
  footnote?: ReactNode;
  /** Services de tes abonnements où le titre est inclus. */
  includedOn?: Provider[];
  /** ▶ au centre de l'affiche, comme dans Sorties (bandes-annonces FR-3) : là où l'on décide. */
  showTrailer?: boolean;
  /**
   * Statut discret (Ma pile, où tout est « à voir ») : à la souris, la pastille n'apparaît qu'au
   * survol ou au focus, pour marquer vu d'un clic sans répéter « À voir » sur chaque carte (audit
   * UX W2-6). Au doigt, elle reste visible : invisible, elle resterait cliquable.
   */
  quietStatus?: boolean;
}) {
  const status = item.watchStatus ?? "Unwatched";
  // L'ancre vit dans l'état (pas dans une ref) : elle est lue au rendu pour positionner l'infobulle.
  const [infoEl, setInfoEl] = useState<HTMLButtonElement | null>(null);
  const [showSynopsis, setShowSynopsis] = useState(false);
  const hoverTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function openSynopsis() {
    if (hoverTimer.current) clearTimeout(hoverTimer.current);
    hoverTimer.current = setTimeout(() => {
      setShowSynopsis(true);
      // Fetch paresseux : seulement quand l'infobulle s'ouvre vraiment, jamais au survol fugace.
      if (item.overview === null) onLoadOverview(item.id);
    }, tooltipDelayMs());
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

  const open = (e: MouseEvent<HTMLButtonElement>) => (selectionMode ? onToggleSelect?.(e.shiftKey) : onOpen());

  // Motif du « lien étiré » : le titre est le seul bouton qui ouvre la fiche, et son ::after couvre
  // toute la carte (affiche comprise). Les autres contrôles (statut, synopsis, étoiles,
  // suppression, bande-annonce) sont posés au-dessus (z-10) : jamais un bouton dans un bouton.
  return (
    <div data-flip-id={item.id} data-impression={itemExposureKey(item.id)} className="group relative @container">
      {/* Synopsis : rien si on ne l'a pas (encore), jamais une bulle vide. */}
      {showSynopsis && infoEl && item.overview && (
        <SynopsisTooltip anchor={infoEl} text={item.overview} onDismiss={closeSynopsis} />
      )}
      <div className={`poster aspect-[2/3] w-full ${selected ? "ring-2 ring-accent ring-offset-2 ring-offset-background" : ""}`}>
        {item.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={item.posterUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-2xl text-muted">🎬</div>
        )}
        {/* En bas à gauche de l'affiche, empilés : la sortie (sorties-v1 FR-2), puis la
            disponibilité (disponibilite-streaming-v1 FR-6), seulement quand le titre est inclus
            dans l'un de tes abonnements. Rien s'il n'y a rien à dire. */}
        <div className="pointer-events-none absolute bottom-2 left-2 flex max-w-[calc(100%-1rem)] flex-col items-start gap-1">
          <ReleaseBadge release={item.release} />
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
      </div>

      <div className="px-0.5 pt-2.5">
        <div className="flex items-start gap-1">
          <button
            type="button"
            onClick={open}
            aria-pressed={selectionMode ? selected : undefined}
            // Deux lignes réservées : titre lisible, étoiles alignées d'une carte à l'autre, et une
            // cible d'au moins 24 px de haut (WCAG 2.5.8).
            className="flex min-h-[2lh] min-w-0 flex-1 items-start rounded-sm text-left text-sm font-medium text-foreground outline-none after:absolute after:inset-0 after:rounded-frame after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-focus focus-visible:after:ring-offset-4 focus-visible:after:ring-offset-background"
          >
            {/* Un bouton centre son contenu : le titre, tronqué à part, reste calé en haut. */}
            <span className="line-clamp-2">{item.name}</span>
          </button>

          {/* Cible volontaire du synopsis : on n'ouvre pas d'infobulle en balayant la grille.
              `overview === ""` = déjà cherché, rien à montrer — on n'affiche alors pas la pastille. */}
          {item.overview !== "" && (
            <button
              ref={setInfoEl}
              type="button"
              aria-label={`Synopsis de « ${item.name} »`}
              aria-expanded={showSynopsis}
              onMouseEnter={openSynopsis}
              onMouseLeave={closeSynopsis}
              onFocus={openSynopsis}
              onBlur={closeSynopsis}
              onClick={() => {
                // Sur tactile il n'y a pas de survol : le tap sert d'interrupteur.
                if (showSynopsis) closeSynopsis();
                else openSynopsis();
              }}
              // Cible de 24 px sans décaler la mise en page.
              className="relative z-10 -my-1 -mr-1 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-muted outline-none transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
            >
              <Info size={13} aria-hidden="true" />
            </button>
          )}
        </div>

        {/* Notation rapide, toujours active : noter un item non-vu le marque Vu du même geste.
            Carte trop étroite pour cinq cibles de 24 px : note en lecture seule. */}
        <div className={`relative z-10 mt-1 w-max @max-[119px]:hidden ${selectionMode ? "pointer-events-none opacity-40" : ""}`}>
          <StarRating rating={item.rating} onRate={(next) => onQuickChange(item.id, ratingPatch(item, next))} size="sm" />
        </div>
        <StarsReadOnly rating={item.rating} className="mt-1.5 hidden @max-[119px]:flex" />

        {footnote && <div className="relative z-10">{footnote}</div>}
      </div>

      {/* Hors de la zone cliquable de la carte (pas de bouton dans un bouton), posé sur l'affiche :
          même zone que l'affiche, seul le ▶ capte le clic. */}
      {showTrailer && !selectionMode && item.trailer && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex aspect-[2/3] items-center justify-center">
          <TrailerButton trailer={item.trailer} title={item.name} variant="icon" className="pointer-events-auto" />
        </div>
      )}

      {/* playlists-v2 FR-1 : « Ajouter à une playlist », en bas à droite de l'affiche. Révélé au
          survol sur ordinateur, toujours visible au doigt, comme les autres gestes de la carte. */}
      {!selectionMode && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex aspect-[2/3] items-end justify-end p-2">
          <button
            type="button"
            onClick={() => openPlaylistDialog({ kind: "item", itemId: item.id, name: item.name }, "carte")}
            title="Ajouter à une playlist"
            aria-label={`Ajouter « ${item.name} » à une playlist`}
            className={buttonClass({
              variant: "overlay",
              size: "sm",
              icon: true,
              className: "pointer-events-auto focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100",
            })}
          >
            <ListPlus size={14} aria-hidden="true" />
          </button>
        </div>
      )}

      {/* Statut binaire : le badge bascule directement Vu ⇄ À voir au clic, pas de menu. */}
      <button
        type="button"
        onClick={() =>
          onQuickChange(item.id, { watchStatus: status === "Watched" ? "Unwatched" : "Watched" })
        }
        title={status === "Watched" ? "Marquer « à voir »" : "Marquer « vu »"}
        className={`overlay-pill absolute right-2 top-2 z-10 gap-1.5 transition active:scale-[0.97] hover:bg-black/70 ${
          selectionMode ? "pointer-events-none opacity-40" : ""
        } ${quietStatus ? "pointer-fine:opacity-0 pointer-fine:focus-visible:opacity-100 pointer-fine:group-hover:opacity-100" : ""}`}
      >
        <span className={`h-1.5 w-1.5 rounded-full ${STATUS_META[status].dot}`} />
        <RollText text={STATUS_META[status].label} />
      </button>

      {selectionMode ? (
        /* Sélection par lot : case à cocher toujours visible, remplace le bouton de suppression. */
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute left-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-full border-2 text-xs transition-colors duration-200 ${
            selected ? "border-accent bg-accent text-accent-foreground" : "border-white/40 bg-black/50 text-transparent"
          }`}
        >
          ✓
        </div>
      ) : onDismiss ? (
        /* Écarter une recommandation : le titre reste dans la bibliothèque. Révélé au survol sur
           ordinateur, toujours visible au doigt (pas de survol pour le découvrir). */
        <button
          type="button"
          onClick={onDismiss}
          title="Ne plus me proposer"
          aria-label={`Ne plus me proposer « ${item.name} »`}
          className={buttonClass({ variant: "overlay", size: "sm", icon: true, className: "absolute left-2 top-2 z-10 focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100" })}
        >
          <EyeOff size={14} aria-hidden="true" />
        </button>
      ) : (
        /* Suppression directe depuis la card — pas de confirmation bloquante, le toast "Annuler" fait office de filet. */
        onDelete && (
        <button
          type="button"
          onClick={() => onDelete(item)}
          title="Supprimer de la bibliothèque"
          aria-label="Supprimer de la bibliothèque"
          className={buttonClass({ variant: "overlay", size: "sm", icon: true, className: "absolute left-2 top-2 z-10 opacity-0 focus-visible:opacity-100 [@media(hover:none)]:hidden [@media(hover:hover)]:group-hover:opacity-100" })}
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 6h18" />
            <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
            <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
            <line x1="10" x2="10" y1="11" y2="17" />
            <line x1="14" x2="14" y1="11" y2="17" />
          </svg>
        </button>
        )
      )}
    </div>
  );
}
