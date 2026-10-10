"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  CalendarX,
  Check,
  ChevronDown,
  ChevronUp,
  Clapperboard,
  CloudOff,
  LayoutGrid,
  ListPlus,
  Plus,
  Sparkles,
  Tv,
  type LucideIcon,
} from "lucide-react";
import { CompatibilityChip } from "@/components/CompatibilityChip";
import { openPlaylistDialog } from "@/components/playlists/PlaylistDialog";
import { TrailerButton } from "@/components/TrailerButton";
import { TimelineLayout } from "@/components/layouts";
import { EmptyState, PageHeader, TimelineSection, Toolbar } from "@/components/sections";
import { Badge, Button, Card, MetaRow, MonoMeta, Select, Skeleton, Tabs, Toast } from "@/components/ui";
import { genreLine } from "@/lib/genres";
import { calendarWindows, dayLabel, eventLabel, groupByWeek, kindLabel } from "@/lib/calendar";
import type { CalendarEntry, CalendarResult } from "@/lib/calendarService";

// Calendrier des sorties — spec: specs/sorties-v1.md (FR-3 à FR-6)
// Archétype TimelineLayout (Changelog de Raycast) — spec: specs/design-system-v2-raycast.md § 7 :
// une entrée par semaine, la semaine et ses dates dans la colonne collante, les sorties à droite.

type Scope = "for-you" | "all";
type Kind = "" | "Movie" | "TV Series";

const SCOPES: { value: Scope; label: string; icon: LucideIcon }[] = [
  { value: "for-you", label: "Pour toi", icon: Sparkles },
  { value: "all", label: "Toutes les sorties", icon: LayoutGrid },
];

const KINDS: { value: Kind; label: string; icon: LucideIcon }[] = [
  { value: "", label: "Tout", icon: LayoutGrid },
  { value: "Movie", label: "Films", icon: Clapperboard },
  { value: "TV Series", label: "Séries", icon: Tv },
];

/** Horizon de la frise (FR-6 bis) : jusqu'où regarder devant. */
const HORIZONS: { value: string; label: string; phrase: string }[] = [
  { value: "3", label: "3 mois", phrase: "3 prochains mois" },
  { value: "4", label: "4 mois", phrase: "4 prochains mois" },
  { value: "5", label: "5 mois", phrase: "5 prochains mois" },
  { value: "6", label: "6 mois", phrase: "6 prochains mois" },
  { value: "12", label: "1 an", phrase: "12 prochains mois" },
];

/** Colonne collante d'une entrée : badge puis dates ; en ligne sur téléphone, où elle passe au-dessus. */
const ASIDE = "flex flex-wrap items-center gap-x-3 gap-y-2 md:flex-col md:items-start";

const SCOPE_STORAGE_KEY = "watchlist:releasesScope";
const KIND_STORAGE_KEY = "watchlist:releasesKind";
const HORIZON_STORAGE_KEY = "watchlist:releasesHorizon";

function utcDate(iso: string): Date {
  return new Date(`${iso}T12:00:00Z`);
}

/** « 21 – 27 sept. », ou « 28 sept. – 4 oct. » quand la semaine change de mois. */
function weekRange(start: string): string {
  const from = utcDate(start);
  const to = utcDate(start);
  to.setUTCDate(to.getUTCDate() + 6);
  const dayMonth = (d: Date) => d.toLocaleDateString("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
  return from.getUTCMonth() === to.getUTCMonth()
    ? `${from.getUTCDate()} – ${dayMonth(to)}`
    : `${dayMonth(from)} – ${dayMonth(to)}`;
}

/** Les sorties d'une semaine, par jour (elles arrivent déjà triées par date). */
function byDay(entries: CalendarEntry[]): { date: string; entries: CalendarEntry[] }[] {
  const days: { date: string; entries: CalendarEntry[] }[] = [];
  for (const entry of entries) {
    const last = days.at(-1);
    if (last && last.date === entry.date) last.entries.push(entry);
    else days.push({ date: entry.date, entries: [entry] });
  }
  return days;
}

export default function SortiesPage() {
  /** Réponses reçues, tranche par tranche (FR-6 ter), dans l'ordre des tranches. */
  const [slices, setSlices] = useState<CalendarResult[]>([]);
  /** Tranches à charger : la première à l'ouverture, les suivantes à mesure qu'on descend. */
  const [wanted, setWanted] = useState(1);
  const [failed, setFailed] = useState(false);
  const [scope, setScope] = useState<Scope>("for-you");
  const [kind, setKind] = useState<Kind>("");
  const [horizon, setHorizon] = useState("6");
  const [ready, setReady] = useState(false);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement | null>(null);
  /** Ajouts et retraits faits depuis la frise, par clé TMDB : id local, ou null si retiré. */
  const [changes, setChanges] = useState<Map<string, number | null>>(new Map());
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  /** Les semaines passées, repliées à l'ouverture : la frise commence à la semaine en cours. */
  const [showPast, setShowPast] = useState(false);

  useEffect(() => {
    try {
      const storedScope = window.localStorage.getItem(SCOPE_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (storedScope === "for-you" || storedScope === "all") setScope(storedScope);
      const storedKind = window.localStorage.getItem(KIND_STORAGE_KEY);
      if (storedKind !== null && KINDS.some((k) => k.value === storedKind)) setKind(storedKind as Kind);
      const storedHorizon = window.localStorage.getItem(HORIZON_STORAGE_KEY);
      if (storedHorizon !== null && HORIZONS.some((h) => h.value === storedHorizon)) setHorizon(storedHorizon);
    } catch {
      // localStorage indisponible : valeurs par défaut.
    }
    setReady(true);
  }, []);

  const today = useMemo(() => new Date(), []);
  const todayIso = today.toISOString().slice(0, 10);
  // FR-6 ter : un mois à la fois, chacun avec ses propres têtes d'affiche. Les tranches déjà
  // chargées sont gardées quand l'horizon change : seule la fin de la frise bouge.
  const windows = useMemo(() => calendarWindows(today, Number(horizon)), [today, horizon]);
  const horizonEnd = windows.at(-1)?.to ?? todayIso;

  // Une tranche à la fois. Pas d'annulation au re-rendu : l'effet se relance quand `loading`
  // change, et annuler là jetterait la réponse attendue (la frise restait bloquée au squelette).
  const inFlight = useRef(false);
  useEffect(() => {
    if (!ready || failed || inFlight.current || slices.length >= Math.min(wanted, windows.length)) return;
    const window = windows[slices.length];
    inFlight.current = true;
    setLoading(true);
    fetch(`/api/calendar?from=${window.from}&to=${window.to}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((body: CalendarResult) => setSlices((prev) => [...prev, body]))
      .catch(() => setFailed(true))
      .finally(() => {
        inFlight.current = false;
        setLoading(false);
      });
  }, [ready, loading, failed, slices.length, wanted, windows]);

  // En approchant du bas de la frise, la tranche suivante se charge toute seule.
  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) setWanted((w) => Math.max(w, slices.length + 1));
      },
      { rootMargin: "800px 0px" }
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [slices.length]);

  const data = slices[0] ?? null;
  const allEntries = useMemo(() => slices.flatMap((slice) => slice.entries), [slices]);
  const moreToLoad = slices.length < windows.length;
  const nextMonthLabel = moreToLoad
    ? utcDate(windows[slices.length].from).toLocaleDateString("fr-FR", {
        month: "long",
        year: "numeric",
        timeZone: "UTC",
      })
    : null;

  function remember(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // pas grave, juste pas mémorisé.
    }
  }

  const weeks = useMemo(() => {
    if (!data) return [];
    const base = data.baseRate ?? 0;
    const entries = allEntries.filter((e) => {
      if (e.date > horizonEnd) return false;
      if (kind && e.mediaType !== kind) return false;
      // FR-4 : ta bibliothèque, et ce qui te promet plus que ta moyenne.
      if (scope === "for-you") return e.libraryId !== null || (e.compatibility ?? 0) > base;
      return true;
    });
    return groupByWeek(entries, today, (a, b) => {
      // À date égale : ta bibliothèque d'abord, puis le plus compatible.
      if ((a.libraryId !== null) !== (b.libraryId !== null)) return a.libraryId !== null ? -1 : 1;
      return (b.compatibility ?? 0) - (a.compatibility ?? 0);
    });
  }, [data, allEntries, scope, kind, today, horizonEnd]);

  const currentWeekStart = useMemo(() => {
    const date = utcDate(todayIso);
    date.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    return date.toISOString().slice(0, 10);
  }, [todayIso]);

  // La frise s'ouvre sur la semaine en cours, juste sous les filtres : les semaines passées se
  // replient derrière un bouton plutôt que de faire défiler la page (qui cachait les filtres).
  const pastWeeks = weeks.filter((w) => w.start < currentWeekStart);
  const pastCount = pastWeeks.reduce((sum, w) => sum + w.entries.length, 0);
  const shownWeeks = showPast ? weeks : weeks.filter((w) => w.start >= currentWeekStart);

  function libraryIdOf(entry: CalendarEntry): number | null {
    const key = `${entry.mediaType}:${entry.tmdbId}`;
    return changes.has(key) ? (changes.get(key) ?? null) : entry.libraryId;
  }

  /** FR-5 : ajouter depuis la frise (origine « calendar »), ou retirer ce qu'on vient d'ajouter. */
  async function toggle(entry: CalendarEntry) {
    const key = `${entry.mediaType}:${entry.tmdbId}`;
    const current = libraryIdOf(entry);
    setPending(key);
    setMessage(null);
    try {
      if (current === null) {
        const res = await fetch("/api/items", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tmdbId: entry.tmdbId, type: entry.mediaType, source: "calendar" }),
        });
        const body = await res.json();
        if (!res.ok) {
          setMessage(
            body.error === "notion_not_configured"
              ? "Notion n'est pas configuré, impossible d'ajouter."
              : "Échec de l'ajout, réessaie."
          );
          return;
        }
        setChanges((prev) => new Map(prev).set(key, body.item.id));
      } else {
        const res = await fetch(`/api/items/${current}`, { method: "DELETE" });
        if (!res.ok) {
          setMessage("Échec du retrait, réessaie.");
          return;
        }
        setChanges((prev) => new Map(prev).set(key, null));
      }
    } finally {
      setPending(null);
    }
  }

  const total = weeks.reduce((sum, w) => sum + w.entries.length, 0);
  const longerHorizons = HORIZONS.filter((h) => Number(h.value) > Number(horizon));

  return (
    <TimelineLayout>
      <PageHeader
        title="Sorties"
        lead="Au cinéma et en séries."
        description={
          <>
            En France, des 30 derniers jours aux {HORIZONS.find((h) => h.value === horizon)?.phrase}. « Pour
            toi » : ta bibliothèque, et ce qui te promet plus que ta moyenne.
          </>
        }
      />

      <Toolbar
        start={
          <>
            <Tabs
              label="Sélection"
              options={SCOPES}
              value={scope}
              onChange={(next) => {
                setScope(next);
                remember(SCOPE_STORAGE_KEY, next);
              }}
            />
            <Tabs
              label="Type"
              options={KINDS}
              value={kind}
              onChange={(next) => {
                setKind(next);
                remember(KIND_STORAGE_KEY, next);
              }}
              subtle
            />
          </>
        }
        end={
          <>
            {data && (
              <MonoMeta aria-live="polite">
                {total} sortie{total > 1 ? "s" : ""}
              </MonoMeta>
            )}
            {/* FR-6 bis : l'horizon, dans un menu (3, 4, 5, 6 mois, 1 an). */}
            <Select
              placeholder="Horizon"
              prefix="Jusqu'à"
              value={horizon}
              options={HORIZONS.map((h) => ({ value: h.value, label: h.label }))}
              onChange={(next) => {
                setHorizon(next);
                remember(HORIZON_STORAGE_KEY, next);
              }}
              clearable={false}
            />
          </>
        }
      />

      {data?.externalUnavailable && (
        <p className="mt-4 text-sm text-muted">TMDB ne répond pas : seules les sorties de ta bibliothèque sont affichées.</p>
      )}

      <div className="mt-12 flex flex-col gap-20">
        {!data && !failed && (
          <div aria-busy="true" className="flex flex-col gap-6">
            <p className="text-sm text-muted">On rassemble les sorties…</p>
            <TimelineSection
              aside={
                <div className={ASIDE}>
                  <Skeleton className="h-5 w-28" />
                  <Skeleton className="h-4 w-24" />
                </div>
              }
            >
              <Skeleton className="mb-3 h-4 w-20" />
              <ul className="flex flex-col gap-3">
                {Array.from({ length: 4 }, (_, i) => (
                  <Card as="li" key={i} className="flex items-center gap-4 p-3 sm:p-4">
                    <Skeleton className="h-24 w-16 shrink-0 rounded-frame sm:h-30 sm:w-20" />
                    <div className="flex flex-1 flex-col gap-2">
                      <Skeleton className="h-4 w-1/3" />
                      <Skeleton className="h-3 w-1/4" />
                    </div>
                  </Card>
                ))}
              </ul>
            </TimelineSection>
          </div>
        )}

        {failed && !data && (
          <EmptyState icon={<CloudOff size={20} aria-hidden="true" />} title="Impossible de charger les sorties.">
            Recharge la page.
          </EmptyState>
        )}

        {data && total === 0 && !moreToLoad && (
          <EmptyState
            icon={<CalendarX size={20} aria-hidden="true" />}
            title="Rien de prévu dans cette sélection."
            action={
              scope === "for-you" && (
                <Button size="sm" onClick={() => setScope("all")}>
                  Voir toutes les sorties
                </Button>
              )
            }
          />
        )}

        {/* Les semaines passées : repliées, ouvertes sur demande juste au-dessus de la semaine en cours. */}
        {pastCount > 0 && (
          <TimelineSection
            className="-mb-12"
            aside={
              <div className={ASIDE}>
                <Badge>Semaines passées</Badge>
                <MonoMeta>30 derniers jours</MonoMeta>
              </div>
            }
          >
            <Button size="sm" aria-expanded={showPast} onClick={() => setShowPast((v) => !v)}>
              {showPast ? <ChevronDown size={14} aria-hidden="true" /> : <ChevronUp size={14} aria-hidden="true" />}
              {showPast
                ? "Masquer les semaines passées"
                : `Voir les ${pastCount} sortie${pastCount > 1 ? "s" : ""} des semaines passées`}
            </Button>
          </TimelineSection>
        )}

        {shownWeeks.map((week) => {
          const isCurrent = week.start === currentWeekStart;
          return (
            <TimelineSection
              key={week.start}
              id={`semaine-${week.start}`}
              className="scroll-mt-24 lg:scroll-mt-28"
              aside={
                <div className={ASIDE}>
                  <h2>
                    {/* La semaine en cours : le repère « maintenant » de la frise (lavis, avec son libellé). */}
                    <Badge variant={isCurrent ? "success" : "neutral"}>{week.label}</Badge>
                  </h2>
                  <MonoMeta>{weekRange(week.start)}</MonoMeta>
                </div>
              }
            >
              <div className="flex flex-col gap-8">
                {byDay(week.entries).map((day) => (
                  <div key={day.date} className="flex flex-col gap-3">
                    <h3
                      className={`flex items-center gap-2 text-sm ${
                        day.date < todayIso ? "text-muted" : "text-foreground"
                      }`}
                    >
                      {dayLabel(day.date)}
                      {day.date === todayIso && <Badge>Aujourd&apos;hui</Badge>}
                    </h3>
                    <ol className="flex flex-col gap-3">
                      {day.entries.map((entry) => {
                        const libraryId = libraryIdOf(entry);
                        const key = `${entry.mediaType}:${entry.tmdbId}`;
                        const canToggle = entry.libraryId === null;
                        // Sur téléphone, les actions passent sous le titre : l'affiche couvre alors deux rangées.
                        // Toujours au moins « Ajouter à une playlist » (playlists-v2 FR-2).
                        const hasActions = true;
                        return (
                          <Card
                            as="li"
                            key={entry.key}
                            className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-x-4 gap-y-3 p-3 sm:grid-cols-[5rem_minmax(0,1fr)_auto] sm:p-4"
                          >
                            <div
                              className={`poster h-24 w-16 sm:h-30 sm:w-20 ${hasActions ? "row-span-2 sm:row-span-1" : ""}`}
                            >
                              {entry.posterUrl && (
                                // eslint-disable-next-line @next/next/no-img-element
                                <img src={entry.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
                              )}
                              {/* ▶ sur l'affiche : le geste attendu pour « voir à quoi ça ressemble ». */}
                              <div className="absolute inset-0 flex items-center justify-center">
                                <TrailerButton trailer={entry.trailer} title={entry.title} variant="icon" />
                              </div>
                            </div>

                            <div className={`flex min-w-0 flex-col gap-2 ${hasActions ? "self-end sm:self-center" : ""}`}>
                              <p className="line-clamp-2 text-base font-medium text-foreground sm:line-clamp-1">{entry.title}</p>
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                <Badge>{eventLabel(entry)}</Badge>
                                <MetaRow>
                                  <span>{kindLabel(entry)}</span>
                                  {entry.genres.length > 0 && <span>{genreLine(entry.genres)}</span>}
                                  {libraryId !== null && entry.libraryStatus && (
                                    <span>{entry.libraryStatus === "Watched" ? "Vu" : "Dans ta pile"}</span>
                                  )}
                                </MetaRow>
                              </div>
                              {entry.overview && (
                                <p className="hidden text-sm text-muted sm:line-clamp-2">{entry.overview}</p>
                              )}
                            </div>

                            {hasActions && (
                              <div className="flex items-center gap-2 self-start sm:self-center">
                                <CompatibilityChip value={entry.compatibility} />
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  icon
                                  onClick={() =>
                                    openPlaylistDialog(
                                      libraryId !== null
                                        ? { kind: "item", itemId: libraryId, name: entry.title }
                                        : { kind: "tmdb", tmdbId: entry.tmdbId, mediaType: entry.mediaType, name: entry.title },
                                      "sorties"
                                    )
                                  }
                                  aria-label={`Ajouter « ${entry.title} » à une playlist`}
                                  title="Ajouter à une playlist"
                                >
                                  <ListPlus size={14} aria-hidden="true" />
                                </Button>
                                {canToggle && (
                                  <Button
                                    size="sm"
                                    variant={libraryId === null ? "secondary" : "ghost"}
                                    loading={pending === key}
                                    onClick={() => toggle(entry)}
                                    aria-label={
                                      libraryId === null ? `Ajouter « ${entry.title} »` : `Retirer « ${entry.title} »`
                                    }
                                    title={libraryId === null ? "Ajouter à ma pile" : "Ajouté · cliquer pour retirer"}
                                  >
                                    {pending !== key &&
                                      (libraryId === null ? (
                                        <Plus size={14} aria-hidden="true" />
                                      ) : (
                                        <Check size={14} aria-hidden="true" />
                                      ))}
                                    {libraryId === null ? "Ajouter" : "Ajouté"}
                                  </Button>
                                )}
                              </div>
                            )}
                          </Card>
                        );
                      })}
                    </ol>
                  </div>
                ))}
              </div>
            </TimelineSection>
          );
        })}

        {/* Pied de la frise, dans la colonne des sorties : la tranche suivante (FR-6 ter), ou la fin
            de l'horizon et de quoi voir plus loin ; puis la source des dates. */}
        {data && (
          <TimelineSection
            aside={
              !moreToLoad && (
                <div className={ASIDE}>
                  <Badge>Fin de l&apos;horizon</Badge>
                  <MonoMeta>
                    {utcDate(horizonEnd).toLocaleDateString("fr-FR", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      timeZone: "UTC",
                    })}
                  </MonoMeta>
                </div>
              )
            }
          >
            <div className="flex flex-col items-start gap-8">
              {/* FR-6 ter : la tranche suivante se charge à l'approche du bas ; le bouton reste là au cas où. */}
              {moreToLoad && (
                <div ref={sentinel} className="flex flex-wrap items-center gap-3 text-sm text-muted">
                  {failed ? (
                    <Button size="lg" onClick={() => setFailed(false)}>
                      Réessayer de charger {nextMonthLabel}
                    </Button>
                  ) : loading ? (
                    <span aria-live="polite">Chargement de {nextMonthLabel}…</span>
                  ) : (
                    <Button size="lg" onClick={() => setWanted(slices.length + 1)}>
                      Voir {nextMonthLabel}
                    </Button>
                  )}
                </div>
              )}

              {!moreToLoad && longerHorizons.length > 0 && (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="mr-1 text-sm text-muted">Regarder plus loin :</span>
                  {longerHorizons.map((h) => (
                    <Button
                      key={h.value}
                      size="sm"
                      onClick={() => {
                        setHorizon(h.value);
                        remember(HORIZON_STORAGE_KEY, h.value);
                        setWanted((w) => w + 1);
                      }}
                    >
                      Voir sur {h.label}
                    </Button>
                  ))}
                </div>
              )}

              {total > 0 && (
                <p className="max-w-2xl text-xs text-muted">
                  Dates de sortie : TMDB. Les arrivées sur les plateformes ne sont pas publiées ; pour savoir
                  où voir un titre de ta pile, ouvre sa fiche dans la{" "}
                  <Link href="/library" className="link">
                    bibliothèque
                  </Link>
                  .
                </p>
              )}
            </div>
          </TimelineSection>
        )}
      </div>

      {message && (
        <Toast action="Fermer" onAction={() => setMessage(null)}>
          {message}
        </Toast>
      )}
    </TimelineLayout>
  );
}
