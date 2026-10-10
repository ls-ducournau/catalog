"use client";

import { buttonClass } from "@/components/ui/Button";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  Film,
  Popcorn,

  CircleAlert,
  Camera,
  Check,
  Clapperboard,
  Heart,
  Home,
  LayoutGrid,
  Library,
  Lightbulb,
  Laugh,
  Play,
  Plus,
  Rocket,
  Shuffle,
  Tv,
  Undo2,
  User,
  Users,
  Globe,
  MonitorPlay,
  X,
  Zap,
  type LucideIcon,
  ListPlus,
  ListVideo,
} from "lucide-react";
import { CompatibilityChip } from "@/components/CompatibilityChip";
import { ProviderLogo } from "@/components/ProviderLogo";
import { ReleaseBadge } from "@/components/ReleaseBadge";
import { TrailerButton } from "@/components/TrailerButton";
import { openPlaylistDialog } from "@/components/playlists/PlaylistDialog";
import { useMyServices } from "@/components/useMyServices";
import { includedIn } from "@/lib/availability";
import {
  DEFAULT_CONTEXT,
  parseContext,
  type Company,
  type Format,
  type Mood,
  type Source,
  type TonightContext,
  type Where,
} from "@/lib/tonight";
import type { PlaylistSummary } from "@/lib/playlistService";
import type { TonightPick, TonightResult } from "@/lib/tonightService";
import { itemExposureKey, tmdbExposureKey } from "@/lib/impressionKeys";
import { genreLabel } from "@/lib/genres";
import { HeroLayout } from "@/components/layouts";
import { EmptyState as EmptyBlock } from "@/components/sections";
import { Button, Eyebrow, IconCircle, Select, Skeleton, Toast } from "@/components/ui";

// Ce soir v2 — spec: specs/ce-soir-v2.md

type Option<T> = { value: T; label: string; icon?: LucideIcon };

const MOODS: Option<Mood>[] = [
  { value: "any", label: "Surprends-moi", icon: Shuffle },
  { value: "light", label: "Léger", icon: Laugh },
  { value: "intense", label: "Intense", icon: Zap },
  { value: "moving", label: "Émouvant", icon: Heart },
  { value: "escape", label: "Évasion", icon: Rocket },
  { value: "think", label: "Réfléchir", icon: Lightbulb },
];
const FORMATS: Option<Format>[] = [
  { value: "any", label: "Peu importe", icon: LayoutGrid },
  { value: "Movie", label: "Film", icon: Clapperboard },
  { value: "TV Series", label: "Série", icon: Tv },
  { value: "Documentary", label: "Documentaire", icon: Camera },
];
const DURATIONS: Option<string>[] = [
  { value: "", label: "Sans limite" },
  { value: "125", label: "2 h" },
  { value: "95", label: "1 h 30" },
];
const COMPANIES: Option<Company>[] = [
  { value: "alone", label: "Seul", icon: User },
  { value: "duo", label: "À deux", icon: Users },
  { value: "family", label: "En famille", icon: Home },
];
const WHERES: Option<Where>[] = [
  { value: "services", label: "Mes abonnements", icon: MonitorPlay },
  { value: "anywhere", label: "Partout", icon: Globe },
];
const SOURCES: Option<Source>[] = [
  { value: "pile", label: "Ma pile", icon: Library },
  { value: "playlist", label: "Une playlist", icon: ListVideo },
  { value: "catalog", label: "Tout le catalogue", icon: Globe },
];

const RELAX_LABEL: Record<NonNullable<TonightResult["relax"]>, string> = {
  mood: "Changer d'envie",
  genre: "Tous les genres",
  format: "Accepter tous les formats",
  maxMinutes: "Retirer la limite de durée",
  company: "Regarder seul",
};

const CONTEXT_STORAGE_KEY = "watchlist:tonightContext";
const TRIO = 3;
/** Durée du bandeau « Annuler » : le temps de se raviser. */
const UNDO_MS = 6000;

/** Le dernier geste réversible (hors « Je regarde ça », qui a son propre écran d'annulation). */
type UndoAction =
  | { kind: "skip"; pick: TonightPick; wasHero: boolean }
  | { kind: "later"; pick: TonightPick; id: number; added: boolean }
  | { kind: "ideas"; start: number; heroKey: string | null };

function formatRuntime(minutes: number | null, type: "Movie" | "TV Series"): string | null {
  if (!minutes) return null;
  const text = minutes >= 60 ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, "0")}` : `${minutes} min`;
  return type === "TV Series" ? `${text} par épisode` : text;
}

function kindOf(pick: TonightPick): string {
  if (pick.isDocumentary) return "Documentaire";
  return pick.type === "Movie" ? "Film" : "Série";
}

export default function CeSoirPage() {
  const [context, setContext] = useState<TonightContext>(DEFAULT_CONTEXT);
  const [ready, setReady] = useState(false);
  const [result, setResult] = useState<TonightResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  /** Titres écartés pour la soirée (« Pas ce soir ») : rien n'est enregistré. */
  const [skipped, setSkipped] = useState<Set<string>>(new Set());
  const [start, setStart] = useState(0);
  const [heroKey, setHeroKey] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [watching, setWatching] = useState<{
    pick: TonightPick;
    id: number;
    added: boolean;
    previous: "Watched" | "Unwatched";
  } | null>(null);
  const services = useMyServices();
  const requestSeq = useRef(0);
  /** Mobile : réglages repliés en une ligne de résumé, pour voir les propositions d'emblée. */
  const [panelOpen, setPanelOpen] = useState(false);
  const [undo, setUndo] = useState<UndoAction | null>(null);
  /** Genres de ta bibliothèque, pour le choix du genre. */
  const [genres, setGenres] = useState<string[]>([]);
  /** Tes playlists, pour la source « Une playlist » (playlists-v2 FR-8). */
  const [playlists, setPlaylists] = useState<PlaylistSummary[]>([]);

  useEffect(() => {
    fetch("/api/playlists")
      .then((res) => (res.ok ? (res.json() as Promise<{ playlists: PlaylistSummary[] }>) : { playlists: [] }))
      .then((body) => setPlaylists(body.playlists))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    fetch("/api/genres")
      .then((res) => (res.ok ? (res.json() as Promise<{ genres: string[] }>) : { genres: [] }))
      .then((body) => setGenres(body.genres))
      .catch(() => undefined);
  }, []);

  // FR-1 : le contexte est mémorisé d'une soirée à l'autre.
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CONTEXT_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored) setContext(parseContext(JSON.parse(stored)));
    } catch {
      // stockage indisponible ou illisible : valeurs par défaut.
    }
    setReady(true);
  }, []);

  function update(patch: Partial<TonightContext>) {
    setContext((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(CONTEXT_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // pas grave, juste pas mémorisé.
      }
      return next;
    });
  }

  // FR-8 : chaque réglage met à jour les propositions, sans bouton.
  const load = useCallback(async (ctx: TonightContext) => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setFailed(false);
    const params = new URLSearchParams({
      mood: ctx.mood,
      format: ctx.format,
      company: ctx.company,
      where: ctx.where,
      source: ctx.source,
    });
    if (ctx.playlistId !== null) params.set("playlistId", String(ctx.playlistId));
    if (ctx.maxMinutes !== null) params.set("maxMinutes", String(ctx.maxMinutes));
    if (ctx.genre !== null) params.set("genre", ctx.genre);
    try {
      const res = await fetch(`/api/tonight?${params}`);
      const body: TonightResult = await res.json();
      if (seq !== requestSeq.current) return;
      setResult(body);
      setStart(0);
      setHeroKey(null);
      // D'autres propositions : le dernier geste ne s'annule plus.
      setUndo(null);
    } catch {
      if (seq === requestSeq.current) setFailed(true);
    } finally {
      if (seq === requestSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!ready) return;
    // Petite attente : plusieurs réglages changés d'affilée ne partent qu'en une requête.
    const timer = setTimeout(() => load(context), 180);
    return () => clearTimeout(timer);
  }, [context, ready, load]);

  const queue = useMemo(
    () => (result?.picks ?? []).filter((p) => !skipped.has(p.key)),
    [result, skipped]
  );
  const trio = queue.slice(start, start + TRIO);
  const hero = trio.find((p) => p.key === heroKey) ?? trio[0] ?? null;
  const alternatives = trio.filter((p) => p !== hero);

  /** FR-6 : trois nouvelles idées ; au bout de la liste, on repart du début. */
  function nextIdeas() {
    setUndo({ kind: "ideas", start, heroKey });
    setHeroKey(null);
    setStart((s) => (s + TRIO < queue.length ? s + TRIO : 0));
  }

  function skip(pick: TonightPick) {
    setUndo({ kind: "skip", pick, wasHero: pick === hero });
    setSkipped((prev) => new Set(prev).add(pick.key));
    if (heroKey === pick.key) setHeroKey(null);
  }

  async function addToLibrary(pick: TonightPick): Promise<{ id: number; alreadyExists: boolean } | null> {
    const res = await fetch("/api/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ tmdbId: pick.tmdbId, type: pick.type, source: "tonight" }),
    });
    const body = await res.json();
    if (!res.ok) {
      setMessage(
        body.error === "notion_not_configured"
          ? "Notion n'est pas configuré, impossible d'ajouter."
          : "Échec de l'ajout, réessaie."
      );
      return null;
    }
    return { id: body.item.id, alreadyExists: body.alreadyExists };
  }

  function markInLibrary(pick: TonightPick, id: number, status: "Watched" | "Unwatched") {
    setResult((prev) =>
      prev
        ? {
            ...prev,
            picks: prev.picks.map((p) => (p.key === pick.key ? { ...p, libraryId: id, libraryStatus: status } : p)),
          }
        : prev
    );
  }

  async function addLater(pick: TonightPick) {
    setPending(pick.key);
    setMessage(null);
    try {
      const added = await addToLibrary(pick);
      if (added) {
        markInLibrary(pick, added.id, "Unwatched");
        setUndo({ kind: "later", pick, id: added.id, added: !added.alreadyExists });
      }
    } finally {
      setPending(null);
    }
  }

  /** FR-7 : ajoute si besoin, marque vu, et garde de quoi tout défaire. */
  async function watch(pick: TonightPick) {
    setPending(pick.key);
    setMessage(null);
    try {
      let id = pick.libraryId;
      let added = false;
      if (id === null) {
        const result = await addToLibrary(pick);
        if (!result) return;
        id = result.id;
        added = !result.alreadyExists;
      }
      const res = await fetch(`/api/items/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ watchStatus: "Watched" }),
      });
      if (!res.ok) {
        setMessage("Le titre n'a pas pu être marqué vu.");
        return;
      }
      setWatching({ pick, id, added, previous: pick.libraryStatus === "Watched" ? "Watched" : "Unwatched" });
    } finally {
      setPending(null);
    }
  }

  async function undoWatch() {
    if (!watching) return;
    const { pick, id, added, previous } = watching;
    setPending(pick.key);
    try {
      const res = added
        ? await fetch(`/api/items/${id}`, { method: "DELETE" })
        : await fetch(`/api/items/${id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ watchStatus: previous }),
          });
      if (!res.ok) {
        setMessage("L'annulation n'a pas pu être appliquée.");
        return;
      }
      if (added) {
        setResult((prev) =>
          prev
            ? { ...prev, picks: prev.picks.map((p) => (p.key === pick.key ? { ...p, libraryId: null, libraryStatus: null } : p)) }
            : prev
        );
      }
      setWatching(null);
    } finally {
      setPending(null);
    }
  }

  /** Défait le dernier geste : le titre écarté revient, l'ajout est retiré, les idées d'avant reviennent. */
  const undoLast = useCallback(async () => {
    const action = undo;
    if (!action) return;
    setUndo(null);
    if (action.kind === "skip") {
      setSkipped((prev) => {
        const next = new Set(prev);
        next.delete(action.pick.key);
        return next;
      });
      if (action.wasHero) setHeroKey(action.pick.key);
    } else if (action.kind === "ideas") {
      setStart(action.start);
      setHeroKey(action.heroKey);
    } else if (action.added) {
      setPending(action.pick.key);
      try {
        const res = await fetch(`/api/items/${action.id}`, { method: "DELETE" });
        if (!res.ok) {
          setMessage("L'annulation n'a pas pu être appliquée.");
          return;
        }
        setResult((prev) =>
          prev
            ? {
                ...prev,
                picks: prev.picks.map((p) => (p.key === action.pick.key ? { ...p, libraryId: null, libraryStatus: null } : p)),
              }
            : prev
        );
      } finally {
        setPending(null);
      }
    }
  }, [undo]);

  // Le bandeau s'efface de lui-même ; Ctrl+Z (⌘Z) annule, comme dans le Tri rapide.
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== "z" || e.shiftKey) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest("input, textarea, [contenteditable='true']")) return;
      if (undo) {
        e.preventDefault();
        void undoLast();
      } else if (watching) {
        e.preventDefault();
        void undoWatch();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const undoLabel =
    undo?.kind === "skip"
      ? `« ${undo.pick.title} » écarté pour ce soir`
      : undo?.kind === "later"
        ? undo.added
          ? `« ${undo.pick.title} » ajouté à ta pile`
          : `« ${undo.pick.title} » est déjà dans ta pile`
        : undo?.kind === "ideas"
          ? "Trois nouvelles idées"
          : null;

  const noServices = services.loaded && services.subscriptionIds.length === 0;
  const summary = [
    MOODS.find((o) => o.value === context.mood)?.label,
    context.genre !== null ? genreLabel(context.genre) : null,
    FORMATS.find((o) => o.value === context.format)?.label,
    context.format !== "TV Series" && context.maxMinutes !== null
      ? DURATIONS.find((o) => o.value === String(context.maxMinutes))?.label
      : null,
    COMPANIES.find((o) => o.value === context.company)?.label,
    WHERES.find((o) => o.value === context.where)?.label,
    context.source === "playlist"
      ? `« ${playlists.find((p) => p.id === context.playlistId)?.name ?? "Une playlist"} »`
      : SOURCES.find((o) => o.value === context.source)?.label,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <HeroLayout
      surface="tonight"
      compact
      hero={
        <div className="flex max-w-2xl flex-col items-center gap-3">
          <h1 className="text-balance text-heading text-foreground sm:text-heading-lg">
            Ce soir.<span className="text-muted"> Qu&apos;est-ce qui te ferait envie ?</span>
          </h1>
          <p className="max-w-md text-base text-muted">
            Dis ton envie, ta durée et avec qui tu regardes : Catalog choisit parmi ce qui te plaira le plus.
          </p>
        </div>
      }
    >

      {/* minmax(0, 1fr) : une ligne longue (le résumé) ne doit jamais élargir la colonne. */}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[18rem_minmax(0,1fr)] lg:gap-8">
        {/* FR-1 : tout le contexte, sur un écran, modifiable à tout moment. */}
        <aside aria-label="Ta soirée" className="lg:sticky lg:top-28 lg:self-start">
          <button
            onClick={() => setPanelOpen((v) => !v)}
            aria-expanded={panelOpen}
            aria-controls="reglages-soiree"
            className="card flex min-h-11 w-full items-center gap-3 px-4 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus lg:hidden"
          >
            <span className="min-w-0 flex-1">
              <span className="eyebrow block">Ta soirée</span>
              <span className="block truncate text-sm text-foreground">{summary}</span>
            </span>
            <span className="shrink-0 text-sm font-medium text-foreground">{panelOpen ? "Fermer" : "Modifier"}</span>
          </button>
          <div
            id="reglages-soiree"
            className={`${panelOpen ? "mt-4 flex" : "hidden"} flex-col gap-5 lg:mt-0 lg:flex`}
          >
          <ChipGroup label="Envie" options={MOODS} value={context.mood} onChange={(mood) => update({ mood })} />
          <div>
            <p className="eyebrow">Genre</p>
            <div className="mt-2">
              <Select
                placeholder="Tous les genres"
                value={context.genre ?? ""}
                onChange={(genre) => update({ genre: genre || null })}
                options={genres.map((g) => ({ value: g, label: genreLabel(g) }))}
                searchable
              />
            </div>
          </div>
          <ChipGroup label="Format" options={FORMATS} value={context.format} onChange={(format) => update({ format })} />
          {context.format !== "TV Series" && (
            <ChipGroup
              label="Durée"
              hint={context.format === "any" ? "films" : undefined}
              options={DURATIONS}
              value={context.maxMinutes === null ? "" : String(context.maxMinutes)}
              onChange={(v) => update({ maxMinutes: v ? Number(v) : null })}
            />
          )}
          <ChipGroup label="Avec qui" options={COMPANIES} value={context.company} onChange={(company) => update({ company })} />
          <div>
            <ChipGroup label="Où" options={WHERES} value={context.where} onChange={(where) => update({ where })} />
            {noServices && context.where === "services" && (
              <p className="mt-1.5 text-xs text-muted">
                Aucun abonnement déclaré : choisis-les depuis{" "}
                <Link href="/recommendations" className="link">
                  Recommandations
                </Link>
                .
              </p>
            )}
          </div>
          <ChipGroup
            label="Parmi"
            options={SOURCES}
            value={context.source}
            onChange={(source) =>
              // « Une playlist » : la dernière choisie, sinon la première qui a un titre à voir.
              update(
                source === "playlist"
                  ? { source, playlistId: context.playlistId ?? (playlists.find((p) => p.next !== null) ?? playlists[0])?.id ?? null }
                  : { source, playlistId: null }
              )
            }
          />
          {context.source === "playlist" &&
            (playlists.length > 0 ? (
              <Select
                placeholder="Choisis une playlist"
                value={context.playlistId !== null ? String(context.playlistId) : ""}
                onChange={(value) => update({ playlistId: value ? Number(value) : null })}
                options={playlists.map((p) => ({ value: String(p.id), label: p.name }))}
                clearable={false}
              />
            ) : (
              <p className="text-sm text-muted">
                Aucune playlist pour l&apos;instant :{" "}
                <Link href="/playlists?nouvelle=1" className="link">
                  crée-en une
                </Link>
                .
              </p>
            ))}
          </div>
        </aside>

        <section aria-label="Propositions" aria-busy={loading} className="min-w-0">
          {watching ? (
            <WatchingCard watching={watching} pending={pending === watching.pick.key} onUndo={undoWatch} onClose={() => setWatching(null)} />
          ) : (
            <>
              <div className="mb-4 flex min-h-9 flex-wrap items-center gap-3 text-sm text-muted">
                {result && !loading && queue.length > 0 && (
                  <span>
                    {result.matched} titre{result.matched > 1 ? "s" : ""} pour ta soirée · les plus compatibles d&apos;abord
                  </span>
                )}
                {queue.length > TRIO && (
                  <button
                    onClick={nextIdeas}
                    className={buttonClass({ variant: "secondary", className: "ml-auto" })}
                  >
                    <Shuffle size={14} aria-hidden="true" />
                    Autres idées
                  </button>
                )}
              </div>

              {message && (
                <p role="status" className="mt-3 flex items-center gap-2 text-sm text-foreground">
                  <CircleAlert size={14} aria-hidden="true" className="shrink-0 text-muted" />
                  {message}
                </p>
              )}

              {(loading && !result) || (loading && queue.length === 0) ? (
                <HeroSkeleton />
              ) : failed ? (
                <EmptyBlock
                  className="mt-4"
                  icon={<CircleAlert size={20} aria-hidden="true" />}
                  title="Impossible de charger les propositions"
                >
                  Réessaie dans un instant.
                </EmptyBlock>
              ) : result && queue.length === 0 ? (
                <EmptyState result={result} context={context} onRelax={update} />
              ) : (
                hero && (
                  <div className={`transition-opacity duration-200 ${loading ? "opacity-50" : ""}`}>
                    <HeroCard
                      key={hero.key}
                      pick={hero}
                      covered={services.covered}
                      pending={pending === hero.key}
                      onWatch={() => watch(hero)}
                      onSkip={() => skip(hero)}
                      onAdd={() => addLater(hero)}
                    />
                    {alternatives.length > 0 && (
                      <div className="mt-6">
                        <Eyebrow>Ou plutôt</Eyebrow>
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          {alternatives.map((pick) => (
                            <AlternativeCard key={pick.key} pick={pick} onChoose={() => setHeroKey(pick.key)} onSkip={() => skip(pick)} />
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              )}
            </>
          )}
        </section>
      </div>

      {undo && undoLabel && !watching && (
        <Toast action="Annuler" onAction={() => void undoLast()}>
          {undoLabel}
        </Toast>
      )}
    </HeroLayout>
  );
}

function ChipGroup<T extends string>({
  label,
  hint,
  options,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div>
      <p className="eyebrow">
        {label}
        {hint && <span className="normal-case tracking-normal"> · {hint}</span>}
      </p>
      <div role="radiogroup" aria-label={label} className="mt-2 flex flex-wrap gap-1.5">
        {options.map((option) => {
          const Icon = option.icon;
          return (
            <button
              key={option.value}
              role="radio"
              aria-checked={option.value === value}
              onClick={() => onChange(option.value)}
              className="chip"
            >
              {Icon && <Icon size={14} aria-hidden="true" />}
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HeroCard({
  pick,
  covered,
  pending,
  onWatch,
  onSkip,
  onAdd,
}: {
  pick: TonightPick;
  covered: Set<number>;
  pending: boolean;
  onWatch: () => void;
  onSkip: () => void;
  onAdd: () => void;
}) {
  const where = includedIn(pick.availability, covered);
  const runtime = formatRuntime(pick.runtime, pick.type);

  return (
    <article data-impression={exposureKey(pick)} className="hero-in bezel">
      <div className="bezel-inner sm:flex">
        {/* Lumière de l'affiche : floutée derrière la proposition, comme la lumière d'un écran dans
            une salle ; un voile garde le texte lisible. */}
        {pick.posterUrl && (
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={pick.posterUrl} alt="" className="h-full w-full scale-125 object-cover opacity-35 blur-3xl saturate-150" />
            <div className="absolute inset-0 bg-gradient-to-r from-panel/10 via-panel/70 to-panel/90" />
          </div>
        )}
      {/* Grande affiche à gauche sur ordinateur ; sur mobile, elle se range à côté du titre. */}
      <div className="relative hidden w-[15rem] shrink-0 bg-background sm:block">
        <Poster pick={pick} />
        <div className="absolute left-3 top-3">
          <ReleaseBadge release={pick.release} />
        </div>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 sm:p-6">
        <div className="flex gap-4">
          <div className="poster h-40 w-[6.75rem] shrink-0 sm:hidden">
            <Poster pick={pick} />
          </div>
          <div className="flex min-w-0 flex-col gap-2">
            <h2 className="text-balance text-xl leading-tight text-foreground sm:text-2xl">{pick.title}</h2>
            <p className="text-sm text-muted">{[pick.year, kindOf(pick), runtime].filter(Boolean).join(" · ")}</p>
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <CompatibilityChip value={pick.compatibility} size="md" countUp />
              {pick.reason && <span className="text-muted">{pick.reason}</span>}
              {pick.libraryStatus === "Unwatched" && (
                <span className="badge">Dans ta pile</span>
              )}
            </div>
            <div className="sm:hidden">
              <ReleaseBadge release={pick.release} />
            </div>
          </div>
        </div>

        {where.length > 0 ? (
          <p className="flex items-center gap-2 text-sm text-foreground">
            <span className="flex -space-x-1">
              {where.slice(0, 3).map((p) => (
                <ProviderLogo key={p.id} provider={p} size={22} />
              ))}
            </span>
            Sur {where.map((p) => p.name).join(", ")}
          </p>
        ) : (
          <p className="text-sm text-muted">Pas inclus dans tes abonnements.</p>
        )}

        {pick.overview && <p className="line-clamp-4 text-sm leading-relaxed text-muted">{pick.overview}</p>}

        <div className="mt-auto flex flex-wrap gap-2 pt-2">
          <button
            onClick={onWatch}
            disabled={pending}
            className={buttonClass({ variant: "primary", size: "lg" })}
          >
            <Play size={16} aria-hidden="true" />
            {pending ? "Un instant…" : "Je regarde ça"}
          </button>
          <TrailerButton trailer={pick.trailer} title={pick.title} className="min-h-11 px-4" />
          {pick.libraryId === null && (
            <button
              onClick={onAdd}
              disabled={pending}
              className={buttonClass({ variant: "secondary", size: "lg" })}
            >
              <Plus size={16} aria-hidden="true" />
              Ajouter à ma pile
            </button>
          )}
          {/* playlists-v2 FR-2 : garder l'idée pour plus tard, dans une playlist. */}
          <button
            onClick={() =>
              openPlaylistDialog(
                pick.libraryId !== null
                  ? { kind: "item", itemId: pick.libraryId, name: pick.title }
                  : { kind: "tmdb", tmdbId: pick.tmdbId!, mediaType: pick.type, name: pick.title },
                "ce-soir"
              )
            }
            disabled={pending || (pick.libraryId === null && pick.tmdbId === null)}
            aria-label={`Ajouter « ${pick.title} » à une playlist`}
            title="Ajouter à une playlist"
            className={buttonClass({ variant: "ghost", size: "lg", icon: true })}
          >
            <ListPlus size={16} aria-hidden="true" />
          </button>
          <button
            onClick={onSkip}
            disabled={pending}
            className={buttonClass({ variant: "ghost", size: "lg" })}
          >
            <X size={16} aria-hidden="true" />
            Pas ce soir
          </button>
        </div>
      </div>
      </div>
    </article>
  );
}

function Poster({ pick }: { pick: TonightPick }) {
  return pick.posterUrl ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={pick.posterUrl} alt="" className="h-full w-full object-cover" />
  ) : (
    <div className="flex h-full min-h-40 w-full items-center justify-center text-muted">
      <Film size={28} aria-hidden="true" />
    </div>
  );
}

/** Clé d'impression d'une proposition (fraîcheur FR-1) : celle de ta pile si le titre y est. */
function exposureKey(pick: TonightPick): string | undefined {
  if (pick.libraryId) return itemExposureKey(pick.libraryId);
  return pick.tmdbId ? tmdbExposureKey(pick.type, pick.tmdbId) : undefined;
}

function AlternativeCard({ pick, onChoose, onSkip }: { pick: TonightPick; onChoose: () => void; onSkip: () => void }) {
  const runtime = formatRuntime(pick.runtime, pick.type);
  return (
    <div data-impression={exposureKey(pick)} className="tile group items-start">
      <button onClick={onChoose} className="flex min-w-0 flex-1 gap-3 rounded-lg text-left outline-none focus-visible:ring-2 focus-visible:ring-focus" aria-label={`Plutôt ${pick.title}`}>
        <div className="poster h-24 w-16 shrink-0">
          {pick.posterUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={pick.posterUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <p className="truncate text-sm font-medium text-foreground">{pick.title}</p>
          <p className="text-xs text-muted">{[pick.year, kindOf(pick), runtime].filter(Boolean).join(" · ")}</p>
          <div className="flex items-center gap-2">
            <CompatibilityChip value={pick.compatibility} />
            <span className="text-xs text-muted transition-colors duration-200 group-hover:text-foreground">Plutôt celui-ci</span>
          </div>
        </div>
      </button>
      <button
        onClick={onSkip}
        aria-label={`Pas ce soir : ${pick.title}`}
        title="Pas ce soir"
        className="-m-1 flex h-8 w-8 shrink-0 items-center justify-center self-start rounded-full text-muted outline-none transition-colors duration-200 hover:bg-selection hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

function WatchingCard({
  watching,
  pending,
  onUndo,
  onClose,
}: {
  watching: { pick: TonightPick };
  pending: boolean;
  onUndo: () => void;
  onClose: () => void;
}) {
  const { pick } = watching;
  return (
    <div className="hero-in flex flex-col items-center gap-4 card px-6 py-10 text-center">
      <div className="poster h-40 w-[6.75rem]">
        {pick.posterUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={pick.posterUrl} alt="" className="h-full w-full object-cover" />
        )}
      </div>
      <div>
        <p className="flex items-center justify-center gap-3 text-heading-sm font-semibold text-foreground">
          <IconCircle size={32}>
            <Check size={16} aria-hidden="true" />
          </IconCircle>
          Bonne séance
        </p>
        <p className="mt-1 text-sm text-muted">
          « {pick.title} » est marqué vu. Tu pourras le noter depuis la bibliothèque.
        </p>
      </div>
      <div className="flex flex-wrap justify-center gap-2">
        <button
          onClick={onUndo}
          disabled={pending}
          className={buttonClass({ variant: "secondary", size: "lg" })}
        >
          <Undo2 size={16} aria-hidden="true" />
          Annuler
        </button>
        <button
          onClick={onClose}
          className={buttonClass({ variant: "ghost", size: "lg" })}
        >
          Choisir autre chose
        </button>
      </div>
    </div>
  );
}

function EmptyState({
  result,
  context,
  onRelax,
}: {
  result: TonightResult;
  context: TonightContext;
  onRelax: (patch: Partial<TonightContext>) => void;
}) {
  // EC-1 : dire quel réglage relâcher, et le faire d'un clic.
  const relaxPatch: Record<NonNullable<TonightResult["relax"]>, Partial<TonightContext>> = {
    mood: { mood: "any" },
    genre: { genre: null },
    format: { format: "any" },
    maxMinutes: { maxMinutes: null },
    company: { company: "alone" },
  };
  return (
    <div className="card mt-4">
      <EmptyBlock
        icon={<Popcorn size={20} aria-hidden="true" />}
        title={
          result.catalogUnavailable
            ? "TMDB ne répond pas pour le moment"
            : context.source === "playlist"
              ? "Rien à voir dans cette playlist pour ta soirée"
              : "Rien ne correspond à toute ta soirée"
        }
        action={
          <div className="flex flex-wrap justify-center gap-2">
            {result.relax && (
              <Button variant="primary" onClick={() => onRelax(relaxPatch[result.relax!])}>
                {RELAX_LABEL[result.relax]}
              </Button>
            )}
            {context.where === "services" && <Button onClick={() => onRelax({ where: "anywhere" })}>Chercher partout</Button>}
            {context.source === "pile" ? (
              <Button onClick={() => onRelax({ source: "catalog" })}>Chercher dans tout le catalogue</Button>
            ) : (
              <Button onClick={() => onRelax({ source: "pile", playlistId: null })}>Revenir à ma pile</Button>
            )}
          </div>
        }
      >
        Relâche un réglage : la proposition arrive d&apos;un clic.
      </EmptyBlock>
    </div>
  );
}

function HeroSkeleton() {
  return (
    <div className="card mt-3 overflow-hidden sm:flex" aria-busy="true">
      <Skeleton className="aspect-[2/3] w-full rounded-none sm:aspect-auto sm:h-[22rem] sm:w-[15rem]" />
      <div className="flex flex-1 flex-col gap-3 p-6">
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="mt-2 h-4 w-1/2" />
        <Skeleton className="mt-4 h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
      </div>
    </div>
  );
}
