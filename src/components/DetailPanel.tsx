"use client";

import { useEffect, useState } from "react";
import { RefreshCw, Trash2, X } from "lucide-react";
import { ScoreBadge } from "@/components/ScoreBadge";
import { TrailerButton } from "@/components/TrailerButton";
import { PlaylistPicker } from "@/components/playlists/PlaylistPicker";
import { StarRating } from "@/components/StarRating";
import { ratingPatch, type ItemPatch, type LibraryItem } from "@/lib/libraryItem";
import { includedIn, isStale } from "@/lib/availability";
import { AvailabilitySection } from "@/components/AvailabilitySection";
import { DetailLayout } from "@/components/layouts";
import { DetailHeader, InfoTable } from "@/components/sections";
import { Button, Kbd, Tabs } from "@/components/ui";
import { ProviderLogo } from "@/components/ProviderLogo";
import { genreLine } from "@/lib/genres";

type Tab = "apercu" | "ou-voir";

/**
 * Fiche d'un titre — spec: specs/design-system-v2-raycast.md (§ 7, DetailLayout ; AC-5.5).
 *
 * L'anatomie de la page d'extension de Raycast, en fenêtre : en-tête (affiche, titre,
 * métadonnées), onglets (Aperçu, Où regarder), colonne d'informations, et une barre d'actions
 * au pied. Synopsis et disponibilité chargés à la demande. Partagée entre la bibliothèque, les
 * recommandations et le classement.
 */
export function DetailPanel({
  item,
  onClose,
  onChange,
  onDelete,
  onLoadOverview,
  onRefetch,
  covered = new Set<number>(),
}: {
  item: LibraryItem;
  onClose: () => void;
  onChange: (id: number, patch: ItemPatch) => void;
  /** Absent = la fiche ne propose pas la suppression. */
  onDelete?: (item: LibraryItem) => void;
  onLoadOverview: (id: number) => void;
  onRefetch: (id: number) => Promise<void>;
  /** Services couverts par tes abonnements, pour mettre en avant ce qui y est inclus. */
  covered?: Set<number>;
}) {
  const [refetching, setRefetching] = useState(false);
  const [tab, setTab] = useState<Tab>("apercu");
  // Synopsis et disponibilité récupérés à la demande, une seule fois par ouverture (cf.
  // onLoadOverview) : le serveur complète ce qui manque et rafraîchit une disponibilité de plus
  // de 7 jours. Ne se redéclenche pas quand `item` change de référence, seulement quand on ouvre
  // effectivement un item différent.
  useEffect(() => {
    if (item.overview === null || isStale(item.availability)) onLoadOverview(item.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item.id]);

  // Échap referme la fiche : c'est le réflexe attendu d'une modale, et elle s'ouvre des dizaines
  // de fois par session.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const categoryLabel =
    item.category === "Documentary" ? "Documentaire" : item.category === "Movie" ? "Film" : "Série";
  const mine = item.availability ? includedIn(item.availability, covered) : [];
  const watched = item.watchStatus === "Watched";
  const tmdb = item.voteCount ? `${Math.round((item.voteAverage ?? 0) * 10)} %` : null;

  async function refetch() {
    setRefetching(true);
    try {
      await onRefetch(item.id);
    } finally {
      setRefetching(false);
    }
  }

  type Row = { label: string; value: string | number };
  const info = ([
    item.year ? { label: "Année", value: item.year } : null,
    { label: "Type", value: categoryLabel },
    item.genres.length > 0 ? { label: "Genres", value: genreLine(item.genres, 4) } : null,
    tmdb
      ? { label: "TMDB", value: `${tmdb} · ${(item.voteCount ?? 0).toLocaleString("fr-FR")} votes` }
      : { label: "TMDB", value: "Pas encore noté" },
    item.eloScore !== null ? { label: "Elo", value: Math.round(item.eloScore) } : null,
    item.duelsCount > 0 ? { label: "Duels", value: item.duelsCount } : null,
  ] as (Row | null)[]).filter((row): row is Row => row !== null);

  return (
    <div className="fade-in fixed inset-0 z-50 flex items-center justify-center bg-overlay px-3 sm:px-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={item.name}
        onClick={(e) => e.stopPropagation()}
        className="dialog-in bezel w-full max-w-3xl"
      >
        <div className="bezel-inner flex max-h-[calc(100svh-2rem)] flex-col sm:max-h-[calc(100svh-5rem)]">
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
            <DetailLayout
              header={
                <DetailHeader
                  media={
                    <div className="poster h-36 w-24 sm:h-44 sm:w-[7.4rem]">
                      {item.posterUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={item.posterUrl} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-2xl text-muted">🎬</div>
                      )}
                    </div>
                  }
                  title={item.name}
                  meta={[
                    ...(item.year ? [item.year] : []),
                    categoryLabel,
                    ...(item.genres.length > 0 ? [genreLine(item.genres)] : []),
                    ...(tmdb ? [`TMDB ${tmdb}`] : []),
                    ...(mine.length > 0
                      ? [
                          <span key="mine" className="inline-flex items-center gap-1.5 text-foreground">
                            <ProviderLogo provider={mine[0]} size={16} />
                            Sur {mine[0].name}
                          </span>,
                        ]
                      : []),
                  ]}
                  actions={
                    <Button onClick={onClose} aria-label="Fermer" variant="ghost" icon size="sm" className="absolute right-3 top-3 sm:static">
                      <X size={16} aria-hidden="true" />
                    </Button>
                  }
                />
              }
              tabs={
                <Tabs
                  label="Sections de la fiche"
                  options={[
                    { value: "apercu", label: "Aperçu" },
                    { value: "ou-voir", label: "Où regarder" },
                  ]}
                  value={tab}
                  onChange={setTab}
                />
              }
              aside={<InfoTable title="Informations" rows={info} />}
            >
              {tab === "apercu" ? (
                <div className="flex flex-col gap-6">
                  {item.overview !== "" && (
                    <div>
                      <p className="eyebrow">Synopsis</p>
                      {item.overview === null ? (
                        <p className="mt-2 text-sm text-muted">Chargement…</p>
                      ) : (
                        <p className="mt-2 text-base leading-7 text-foreground">{item.overview}</p>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap items-start gap-x-8 gap-y-5">
                    <div>
                      <p className="eyebrow">Statut</p>
                      <button
                        type="button"
                        onClick={() => onChange(item.id, { watchStatus: watched ? "Unwatched" : "Watched" })}
                        aria-pressed={watched}
                        className="chip mt-2"
                      >
                        <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${watched ? "bg-success" : "bg-subtle"}`} />
                        {watched ? "Vu" : "À voir"}
                      </button>
                    </div>

                    <div>
                      <p className="eyebrow">Ta note</p>
                      {/* Toujours notable : noter vaut "je l'ai vu", donc le statut bascule du même geste. */}
                      <StarRating
                        className="mt-2"
                        rating={item.rating}
                        onRate={(next) => onChange(item.id, ratingPatch(item, next))}
                        showWorstTier
                        showLabel
                      />
                    </div>

                    {/* playlists-v1 FR-4 : ajouter à une playlist, ou retirer, sans quitter la fiche. */}
                    <div className="w-full">
                      <p className="eyebrow">Playlists</p>
                      <PlaylistPicker key={item.id} itemId={item.id} name={item.name} className="mt-2" />
                    </div>

                    {(item.trailer || item.voteCount) && (
                      <div>
                        <p className="eyebrow">Bande-annonce et note TMDB</p>
                        <div className="mt-2 flex items-center gap-2">
                          <ScoreBadge voteAverage={item.voteAverage} voteCount={item.voteCount} size="md" />
                          <TrailerButton trailer={item.trailer} title={item.name} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : item.availability ? (
                <AvailabilitySection availability={item.availability} covered={covered} />
              ) : (
                <p className="text-sm text-muted">Chargement de la disponibilité…</p>
              )}
            </DetailLayout>
          </div>

          <div className="action-bar">
            {onDelete ? (
              <button type="button" onClick={() => onDelete(item)} className="action-bar-action text-muted">
                <Trash2 size={14} aria-hidden="true" />
                Supprimer
              </button>
            ) : (
              <span />
            )}
            <span className="ml-auto flex items-center gap-1">
              {/* Recharger depuis TMDB : titre, synopsis, note et affiche. Local, jamais vers Notion. */}
              <button
                type="button"
                onClick={refetch}
                disabled={refetching}
                title="Recharger les données depuis TMDB"
                className="action-bar-action disabled:opacity-50"
              >
                <RefreshCw size={14} aria-hidden="true" className={refetching ? "animate-spin" : ""} />
                <span className="hidden sm:inline">Recharger depuis TMDB</span>
                <span className="sm:hidden">Recharger</span>
              </button>
              <span aria-hidden="true" className="divider-vertical mx-1 h-4" />
              <button type="button" onClick={onClose} className="action-bar-action">
                Fermer <Kbd>Échap</Kbd>
              </button>
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
