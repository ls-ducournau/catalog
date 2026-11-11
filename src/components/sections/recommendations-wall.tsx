"use client";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useRouter } from "next/navigation";
import { gsap } from "gsap";
import { ArrowRight, Check, Plus, Search, Undo2, X } from "lucide-react";
import type { Transition } from "motion/react";
import Link from "next/link";
import { CompatibilityChip } from "@/components/CompatibilityChip";
import { RadarArea } from "@/components/charts/radar-area";
import { RadarChart } from "@/components/charts/radar-chart";
import { useRadarStable } from "@/components/charts/radar-context";
import { RadarGrid } from "@/components/charts/radar-grid";
import { RadarLabels } from "@/components/charts/radar-labels";
import { ProviderLogo } from "@/components/ProviderLogo";
import { StarIcon } from "@/components/StarRating";
import { TrailerButton } from "@/components/TrailerButton";
import { useMyServices } from "@/components/useMyServices";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/form";
import { Kbd, MetaRow, MonoMeta, Skeleton } from "@/components/ui/primitives";
import { includedIn } from "@/lib/availability";
import { genreLabel, genreLine } from "@/lib/genres";
import { itemExposureKey, tmdbExposureKey } from "@/lib/impressionKeys";
import { prefersReducedMotion } from "@/lib/motion";
import type { Category } from "@/lib/libraryItem";
import type { RecommendationProfile, RecommendedItem } from "@/lib/recommendationService";
import type { ShowcaseTitle } from "@/lib/showcase";
import { EASING_TOKENS } from "@/lib/tokens";
import { SuggestionBadge, SuggestionButton, useSuggestions, type Suggestions } from "./suggestion";
import type { TriageUndo, UnseenCard } from "@/lib/triageService";
import { cn } from "@/lib/utils";
import { closeTo } from "@/lib/format";

// « À la une » de l'accueil (Recommandations et À découvrir) — fiche
// docs/design-reference/raycast/composants/vitrine.md. La fenêtre de commande de ta pile (filtre,
// liste, détail, ↵) ; dessous, le paquet « À découvrir » (glisser, ou 1, 2, 3) et le radar Bklit de
// tes goûts, dont les genres filtrent la fenêtre. Le clavier ne répond que dans ce qui a le focus.

const CATEGORY_LABEL: Record<Category, string> = { Movie: "Film", "TV Series": "Série", Documentary: "Documentaire" };
const JSON_HEADERS = { "Content-Type": "application/json" };

function Poster({ url, className }: { url: string | null; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" loading="lazy" draggable={false} className={className} /> : null;
}

/** Sans accents ni casse : « emouvant » trouve « Émouvant ». */
function fold(text: string): string {
  return text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Un titre de /api/recommendations, au format des aperçus (les voisins sans affiche). */
function fromRecommended(item: RecommendedItem): ShowcaseTitle {
  return {
    id: item.id,
    name: item.name,
    year: item.year,
    type: item.type,
    category: item.category,
    genres: item.genres,
    overview: item.overview ?? "",
    posterUrl: item.posterUrl,
    compatibility: item.compatibility,
    reason: item.neighbours[0] ? closeTo(item.neighbours[0].name) : null,
    watchStatus: item.watchStatus,
    rating: item.rating,
    voteAverage: item.voteAverage,
    voteCount: item.voteCount,
    trailer: item.trailer,
    availability: item.availability,
    neighbours: item.neighbours.slice(0, 3).map((n) => ({ id: n.id, name: n.name, posterUrl: null })),
    runtime: null,
    directors: [],
    cast: [],
  };
}

// ---------- La fenêtre de ta pile ----------

function PickDetail({ title, onDismiss, suggestions }: { title: ShowcaseTitle; onDismiss: () => void; suggestions: Suggestions }) {
  const addedId = title.suggestion ? suggestions.libraryIdOf(title) : null;
  const { covered } = useMyServices();
  const mine = includedIn(title.availability, covered);
  const near = title.neighbours.slice(0, 3);
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div className="flex min-w-0 gap-5">
        <div className="poster aspect-[2/3] w-24 shrink-0 sm:w-28">
          <Poster url={title.posterUrl} className="h-full w-full object-cover" />
        </div>
        <div className="flex min-w-0 flex-col items-start gap-2.5">
          <h3 className="line-clamp-2 text-subheading text-foreground">{title.name}</h3>
          <MetaRow>
            {title.suggestion && <SuggestionBadge />}
            <span>{CATEGORY_LABEL[title.category]}</span>
            {title.year && <span>{title.year}</span>}
            {title.genres.length > 0 && <span>{genreLine(title.genres)}</span>}
          </MetaRow>
          <div className="flex flex-wrap items-center gap-2">
            <CompatibilityChip value={title.compatibility} />
            {mine.length > 0 && (
              <span className="flex items-center gap-1.5 text-sm text-foreground">
                <ProviderLogo provider={mine[0]} size={16} />
                Sur {mine[0].name}
              </span>
            )}
          </div>
          {near.length > 0 && (
            <p className="line-clamp-2 text-sm text-muted">
              Parce que tu as aimé <span className="text-foreground">{near.map((n) => n.name).join(", ")}</span>
            </p>
          )}
        </div>
      </div>
      {title.overview && <p className="line-clamp-3 text-sm leading-relaxed text-muted">{title.overview}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {title.suggestion && addedId === null ? (
          <SuggestionButton title={title} suggestions={suggestions} />
        ) : (
          <Button href={`/library?fiche=${addedId ?? title.id}`} size="sm">
            Voir la fiche
            <Kbd className="hidden sm:inline-flex">↵</Kbd>
          </Button>
        )}
        {title.suggestion && addedId !== null && <SuggestionButton title={title} suggestions={suggestions} />}
        <TrailerButton trailer={title.trailer} title={title.name} />
        {/* Une suggestion n'est pas dans ta pile : rien à écarter durablement. */}
        {!title.suggestion && (
          <Button size="sm" variant="ghost" onClick={onDismiss}>
            <X size={14} aria-hidden="true" />
            Ne plus me proposer
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Fenêtre de commande (la palette de Raycast) sur ta pile classée : un champ qui filtre, la liste
 * (↑ ↓), le détail du titre choisi, ↵ pour sa fiche ; « Ne plus me proposer » l'écarte (annulable).
 * Un genre choisi dans « Tes goûts » recharge la liste sur ce genre ; pour un visiteur (`local`), il filtre
 * les tendances déjà là, sans requête.
 */
function PileWindow({
  picks,
  genre,
  onClearGenre,
  heading,
  local = false,
}: {
  picks: ShowcaseTitle[];
  genre: string | null;
  onClearGenre: () => void;
  /** Visiteur : ce ne sont pas « ta pile » mais les tendances. */
  heading?: string;
  /** Visiteur : le genre choisi filtre `picks` sur place (pas de pile classée à demander). */
  local?: boolean;
}) {
  const router = useRouter();
  const suggestions = useSuggestions();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const [byGenre, setByGenre] = useState<{ genre: string; titles: ShowcaseTitle[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState<ShowcaseTitle[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  // Un genre choisi : la pile classée, sur ce genre (lecture seule).
  useEffect(() => {
    if (!genre || local) return;
    let alive = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/recommendations?genre=${encodeURIComponent(genre)}&limit=10`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { items?: RecommendedItem[] }) => {
        if (alive) setByGenre({ genre, titles: (body.items ?? []).filter((i) => i.posterUrl).map(fromRecommended) });
      })
      .catch(() => alive && setByGenre({ genre, titles: [] }))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [genre, local]);

  const rows = useMemo(() => {
    const source = genre
      ? local
        ? picks.filter((t) => t.genres.includes(genre))
        : byGenre?.genre === genre
          ? byGenre.titles
          : []
      : picks;
    const q = fold(query.trim());
    return source
      .filter((t) => !dismissed.some((d) => d.id === t.id))
      .filter((t) => !q || fold(t.name).includes(q) || t.genres.some((g) => fold(genreLabel(g)).includes(q)));
  }, [genre, local, byGenre, picks, dismissed, query]);

  // La sélection reste dans la liste quand elle change.
  const selectedIndex = Math.min(index, Math.max(0, rows.length - 1));
  const selected = rows[selectedIndex] ?? null;

  // La ligne choisie reste visible : seule la liste défile, jamais la page.
  useEffect(() => {
    const list = listRef.current;
    const row = list?.querySelector<HTMLElement>('[aria-selected="true"]');
    if (!list || !row) return;
    if (row.offsetTop < list.scrollTop) list.scrollTop = row.offsetTop - 8;
    else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight + 8;
    }
  }, [selectedIndex]);

  const open = useCallback(() => {
    if (!selected) return;
    const addedId = selected.suggestion ? suggestions.libraryIdOf(selected) : selected.id;
    // ↵ sur une suggestion : l'ajouter à ta pile ; ajoutée, sa fiche s'ouvre.
    if (addedId === null) void suggestions.toggle(selected);
    else router.push(`/library?fiche=${addedId}`);
  }, [router, selected, suggestions]);

  async function dismiss(title: ShowcaseTitle) {
    setDismissed((prev) => [title, ...prev]);
    setMessage(null);
    const res = await fetch("/api/dismissals", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ subject: { type: "item", id: title.id } }),
    }).catch(() => null);
    if (!res?.ok) {
      setDismissed((prev) => prev.filter((d) => d.id !== title.id));
      setMessage("L'écartement n'a pas été enregistré.");
    }
  }

  async function undoDismiss() {
    const last = dismissed[0];
    if (!last) return;
    setDismissed((prev) => prev.slice(1));
    const res = await fetch("/api/dismissals", {
      method: "DELETE",
      headers: JSON_HEADERS,
      body: JSON.stringify({ subject: { type: "item", id: last.id } }),
    }).catch(() => null);
    if (!res?.ok) setMessage("L'annulation n'a pas pu être appliquée.");
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (rows.length > 0) setIndex(gsap.utils.clamp(0, rows.length - 1, selectedIndex + (e.key === "ArrowDown" ? 1 : -1)));
    } else if (e.key === "Enter" && !(e.target instanceof HTMLButtonElement || e.target instanceof HTMLAnchorElement)) {
      e.preventDefault();
      open();
    } else if (e.key === "Escape" && (query || genre)) {
      e.preventDefault();
      if (query) setQuery("");
      else onClearGenre();
    }
  }

  const lastDismissed = dismissed[0];
  const status = message ?? suggestions.message ?? (lastDismissed ? `« ${lastDismissed.name} » ne te sera plus proposé` : null);

  return (
    <article
      aria-label="Ta pile, à la une"
      onKeyDown={onKeyDown}
      className="feature-card pick-window min-w-0"
      style={selected?.tint ? ({ "--tint": selected.tint } as CSSProperties) : undefined}
    >
      <div className="grid lg:h-104 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className="flex min-h-0 min-w-0 flex-col border-b border-contrast-subtle lg:border-b-0 lg:border-r">
          <div className="flex items-center gap-3 px-4 py-3">
            <Search size={16} aria-hidden="true" className="shrink-0 text-muted" />
            <input
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setIndex(0);
              }}
              placeholder={heading ? "Filtrer…" : "Filtrer ta pile…"}
              aria-label={heading ? "Filtrer la liste" : "Filtrer ta pile"}
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-activedescendant={selected ? `${listId}-${selected.id}` : undefined}
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted"
            />
            {genre && (
              <button type="button" onClick={onClearGenre} className="chip shrink-0" aria-label={`Retirer le filtre ${genreLabel(genre)}`}>
                {genreLabel(genre)}
                <X size={12} aria-hidden="true" />
              </button>
            )}
          </div>
          <div className="h-px bg-contrast-subtle" />
          <p className="flex items-center justify-between px-4 pb-1 pt-3 text-2xs font-medium text-muted">
            <span>
              {genre
                ? `${local ? (heading ?? "Tendances") : "Ta pile"}, en ${genreLabel(genre).toLowerCase()}`
                : (heading ?? "Ta pile, dans l'ordre")}
            </span>
            <span aria-hidden="true" className="hidden items-center gap-1 sm:flex">
              <Kbd>↑</Kbd>
              <Kbd>↓</Kbd>
            </span>
          </p>
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-label="Titres de ta pile"
            aria-busy={loading || undefined}
            className="relative flex max-h-64 min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-2 lg:max-h-none"
          >
            {loading &&
              Array.from({ length: 6 }, (_, i) => (
                <li key={i} className="flex items-center gap-3 px-2 py-1.5">
                  <Skeleton className="h-8 w-6 rounded-sm" />
                  <Skeleton className="h-3 flex-1" />
                </li>
              ))}
            {!loading &&
              rows.map((t, i) => (
                <li
                  key={t.id}
                  id={`${listId}-${t.id}`}
                  data-impression={t.suggestion ? undefined : itemExposureKey(t.id)}
                  role="option"
                  aria-selected={i === selectedIndex}
                  onClick={() => setIndex(i)}
                  onDoubleClick={() => {
                    const id = t.suggestion ? suggestions.libraryIdOf(t) : t.id;
                    if (id !== null) router.push(`/library?fiche=${id}`);
                  }}
                  className={cn(
                    "pick-row flex cursor-pointer items-center gap-3 rounded-control px-2 py-1.5 text-sm",
                    i === selectedIndex ? "bg-selection text-foreground" : "text-muted"
                  )}
                >
                  <span aria-hidden="true" className="showcase-icon h-8 w-6 rounded-sm">
                    <Poster url={t.posterUrl} />
                  </span>
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                  {t.compatibility !== null && <MonoMeta>{Math.round(t.compatibility * 100)} %</MonoMeta>}
                </li>
              ))}
            {!loading && rows.length === 0 && <li className="px-2 py-6 text-sm text-muted">Aucun titre de ta pile ne correspond.</li>}
          </ul>
        </div>
        <div className="pick-detail flex min-w-0 flex-col justify-between gap-4 overflow-hidden p-5 sm:p-6">
          {selected ? (
            <PickDetail title={selected} onDismiss={() => dismiss(selected)} suggestions={suggestions} />
          ) : (
            <p className="text-sm text-muted">Choisis un titre dans la liste.</p>
          )}
          {status && (
            <div className="flex min-h-8 flex-wrap items-center gap-3 text-sm text-muted">
              <span aria-live="polite">{status}</span>
              {lastDismissed && !message && !suggestions.message && (
                <Button size="sm" variant="ghost" onClick={undoDismiss}>
                  <Undo2 size={14} aria-hidden="true" />
                  Annuler
                </Button>
              )}
            </div>
          )}
        </div>
      </div>
    </article>
  );
}

// ---------- À découvrir ----------

type DiscoverAnswer = "like" | "dislike" | "skip";
type Exit = "left" | "right" | "down";

/** Au-delà de ce glissement (px), l'affiche part : à droite dans ta pile, à gauche écartée. */
const SWIPE = 90;

/**
 * Le Tri rapide « à découvrir », en paquet : trois affiches en éventail, celle du dessus se glisse
 * (à droite : ajouter ; à gauche : pas pour moi) ou se tranche avec 1, 2, 3 ; annulable. Au
 * clavier, rien ne s'anime (règle de mouvement 4).
 */
function DiscoverDeck() {
  const [queue, setQueue] = useState<UnseenCard[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [last, setLast] = useState<{ card: UnseenCard; answer: DiscoverAnswer; undo: Promise<TriageUndo | null> } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exit, setExit] = useState<Exit | null>(null);
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false);
  const [instant, setInstant] = useState(false);
  const dragStart = useRef<number | null>(null);
  const seen = useRef<Set<string>>(new Set());

  const load = useCallback(async () => {
    const exclude = [...seen.current].slice(-200).join(",");
    const res = await fetch(`/api/triage/batch?family=unseen&limit=6${exclude ? `&exclude=${encodeURIComponent(exclude)}` : ""}`).catch(
      () => null
    );
    const body: { cards?: UnseenCard[] } | null = res?.ok ? await res.json().catch(() => null) : null;
    if (!body?.cards) {
      setFailed(true);
      return;
    }
    setQueue((prev) => [...(prev ?? []), ...body.cards!.filter((c) => !seen.current.has(c.key))]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const current = queue?.[0] ?? null;

  // Plus que deux cartes : on recharge d'avance.
  useEffect(() => {
    if (queue && queue.length === 2) void load();
  }, [queue, load]);

  function commit(card: UnseenCard, value: DiscoverAnswer) {
    seen.current.add(card.key);
    setError(null);
    const undo = fetch("/api/triage/answer", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ card, answer: value }),
    })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { undo: TriageUndo }) => body.undo)
      .catch(() => {
        setError(value === "like" ? "L'ajout n'a pas été enregistré." : "La réponse n'a pas été enregistrée.");
        return null;
      });
    setLast({ card, answer: value, undo });
    setQueue((q) => (q ?? []).slice(1));
  }

  /** À la souris ou au doigt, l'affiche part d'abord ; au clavier, la réponse est immédiate. */
  function answer(value: DiscoverAnswer, animated: boolean) {
    if (!current || exit) return;
    setInstant(!animated);
    if (!animated || prefersReducedMotion()) {
      setDrag(0);
      commit(current, value);
      return;
    }
    const card = current;
    setExit(value === "like" ? "right" : value === "dislike" ? "left" : "down");
    setTimeout(() => {
      commit(card, value);
      setExit(null);
      setDrag(0);
    }, 260);
  }

  async function undoLast() {
    const entry = last;
    if (!entry) return;
    setLast(null);
    setError(null);
    setQueue((q) => [entry.card, ...(q ?? [])]);
    const undo = await entry.undo;
    if (!undo || undo.kind === "none") return;
    const res = await fetch("/api/triage/undo", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ undo }) }).catch(() => null);
    if (!res?.ok) setError("L'annulation n'a pas pu être appliquée.");
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    if (e.altKey || e.repeat) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      setInstant(true);
      void undoLast();
      return;
    }
    if (e.ctrlKey || e.metaKey) return;
    const value: DiscoverAnswer | null = e.key === "1" ? "dislike" : e.key === "2" ? "like" : e.key === "3" ? "skip" : null;
    if (value) {
      e.preventDefault();
      answer(value, false);
    }
  }

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || exit) return;
    dragStart.current = e.clientX;
    setDragging(true);
    setInstant(false);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    if (dragStart.current !== null) setDrag(e.clientX - dragStart.current);
  }

  function onPointerUp() {
    if (dragStart.current === null) return;
    dragStart.current = null;
    setDragging(false);
    if (drag > SWIPE) answer("like", true);
    else if (drag < -SWIPE) answer("dislike", true);
    else setDrag(0);
  }

  const outcome =
    last &&
    (last.answer === "like"
      ? `« ${last.card.title} » ajouté à ta pile`
      : last.answer === "dislike"
        ? `« ${last.card.title} » ne te sera plus proposé`
        : `« ${last.card.title} » passé`);

  // Le paquet : l'affiche du dessus, puis les deux suivantes en éventail derrière.
  const deck = (queue ?? []).slice(0, 3);
  const frontTransform =
    exit === "right"
      ? "translateX(140%) rotate(14deg)"
      : exit === "left"
        ? "translateX(-140%) rotate(-14deg)"
        : exit === "down"
          ? "translateY(1.5rem) scale(0.94)"
          : drag !== 0
            ? `translateX(${drag}px) rotate(${drag / 18}deg)`
            : undefined;
  const lean = gsap.utils.clamp(-1, 1, drag / SWIPE);

  return (
    <article aria-label="À découvrir" className="feature-card discover-deck" onKeyDown={onKeyDown}>
      <div className="flex items-baseline justify-between gap-3 px-5 pt-5 sm:px-6 sm:pt-6">
        <h3 className="text-lg text-foreground">À découvrir</h3>
        <MonoMeta>hors de ta bibliothèque</MonoMeta>
      </div>

      <div className={cn("deck", instant && "is-instant")}>
        {deck.length === 0 && !failed && <Skeleton className="deck-card" />}
        {deck
          .map((card, i) => (
            <div
              key={card.key}
              // Seule la carte de devant est vue ; les autres dépassent à peine derrière elle.
              data-impression={i === 0 ? tmdbExposureKey(card.mediaType, card.tmdbId) : undefined}
              className={cn("deck-card", i === 0 ? "is-front" : `is-back-${i}`, i === 0 && dragging && "is-dragging")}
              style={
                i === 0
                  ? { transform: frontTransform, opacity: exit && exit !== "down" ? 0 : undefined, touchAction: "pan-y" }
                  : undefined
              }
              onPointerDown={i === 0 ? onPointerDown : undefined}
              onPointerMove={i === 0 ? onPointerMove : undefined}
              onPointerUp={i === 0 ? onPointerUp : undefined}
              onPointerCancel={i === 0 ? onPointerUp : undefined}
            >
              <Poster url={card.posterUrl} className="h-full w-full object-cover" />
              {i === 0 && (
                <>
                  <span aria-hidden="true" className="deck-stamp is-like" style={{ opacity: Math.max(0, lean) }}>
                    Ajouter
                  </span>
                  <span aria-hidden="true" className="deck-stamp is-dislike" style={{ opacity: Math.max(0, -lean) }}>
                    Pas pour moi
                  </span>
                </>
              )}
            </div>
          ))
          .reverse()}
      </div>

      <div className="flex flex-1 flex-col gap-3 px-5 pb-5 sm:px-6 sm:pb-6">
        {current ? (
          <>
            <div className="line-clamp-2 text-base">
              <span className="font-medium text-foreground">{current.title}.</span>{" "}
              <span className="text-muted">{current.overview}</span>
            </div>
            <MetaRow>
              <span>{[current.mediaType === "Movie" ? "Film" : "Série", current.year].filter(Boolean).join(", ")}</span>
              {current.compatibility !== null && (
                <span>
                  <CompatibilityChip value={current.compatibility} />
                </span>
              )}
              {current.seeds[0] && <span className="min-w-0"><span className="min-w-0 truncate">{closeTo(current.seeds[0])}</span></span>}
            </MetaRow>
            <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
              <Button size="sm" onClick={() => answer("dislike", true)} aria-keyshortcuts="1" disabled={Boolean(exit)}>
                <X size={14} aria-hidden="true" />
                Pas pour moi
                <Kbd className="hidden sm:inline-flex">1</Kbd>
              </Button>
              <Button size="sm" variant="ghost" onClick={() => answer("skip", true)} aria-keyshortcuts="3" disabled={Boolean(exit)}>
                Passer
                <Kbd className="hidden sm:inline-flex">3</Kbd>
              </Button>
              <Button size="sm" onClick={() => answer("like", true)} aria-keyshortcuts="2" disabled={Boolean(exit)}>
                <Plus size={14} aria-hidden="true" />
                Ajouter
                <Kbd className="hidden sm:inline-flex">2</Kbd>
              </Button>
              <span className="ml-auto">
                <TrailerButton trailer={current.trailer} title={current.title} variant="icon" />
              </span>
            </div>
          </>
        ) : failed ? (
          <p className="text-sm text-muted">Les suggestions ne répondent pas pour l&apos;instant.</p>
        ) : queue && queue.length === 0 ? (
          <p className="text-sm text-muted">Tu as tout trié. Reviens plus tard pour de nouvelles idées.</p>
        ) : (
          <div aria-busy="true" className="flex flex-col gap-2">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
          </div>
        )}
        <div className="flex min-h-8 flex-wrap items-center gap-3 text-sm text-muted">
          <span aria-live="polite">{error ?? outcome ?? (current ? "Glisse l'affiche : à droite pour l'ajouter, à gauche pour l'écarter." : "")}</span>
          {last && (
            <Button size="sm" variant="ghost" onClick={undoLast} aria-keyshortcuts="Control+Z">
              <Undo2 size={14} aria-hidden="true" />
              Annuler
            </Button>
          )}
        </div>
      </div>
    </article>
  );
}

// ---------- Tes goûts ----------

const ENTER: Transition = {
  type: "tween",
  duration: 0.4,
  ease: EASING_TOKENS.out.split(",").map(Number) as [number, number, number, number],
};

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true
  );
}

/** Libellés courts pour le radar : les noms longs débordaient de la carte. */
function radarLabel(label: string): string {
  const short: Record<string, string> = {
    "Science-fiction et fantastique": "SF, fantastique",
    "Action et aventure": "Action, aventure",
    "Guerre et politique": "Guerre, politique",
  };
  return short[label] ?? label;
}

/** Le genre choisi, allumé sur le radar : un point jaune sur le sommet de tes notes. */
function RadarFocus({ index, value }: { index: number; value: number }) {
  const { getPointPosition } = useRadarStable();
  const { x, y } = getPointPosition(index, value);
  return (
    <g pointerEvents="none">
      <circle cx={x} cy={y} r={11} fill="none" stroke="var(--rating)" strokeOpacity={0.35} strokeWidth={1.5} />
      <circle cx={x} cy={y} r={5} fill="var(--rating)" stroke="var(--background)" strokeWidth={2} />
    </g>
  );
}

/**
 * Tes goûts en radar Bklit : en jaune (la couleur des notes), les genres que tu notes le mieux ; en
 * gris, ce que ta pile en contient. Là où le gris déborde du jaune, ta pile attend des genres que
 * tu aimes moins. Les genres, en puces, filtrent la fenêtre ; le genre choisi s'allume sur le radar.
 * `exemple` (page d'arrivée) : des goûts d'illustration, signalés « Exemple », sans lien vers un profil.
 */
function TasteRadar({
  profile,
  pileGenres,
  genre,
  onGenre,
  exemple = false,
}: {
  profile: RecommendationProfile;
  pileGenres: Record<string, number>;
  genre: string | null;
  onGenre: (next: string | null) => void;
  exemple?: boolean;
}) {
  const reduced = useReducedMotion();
  const top = profile.genres.slice(0, 6);
  const best = Math.max(...top.map((g) => g.affinity));
  const floor = Math.min(...top.map((g) => g.affinity));
  // Tes notes, à l'échelle du genre le mieux noté (30 à 100) ; ta pile, à celle du genre le plus présent.
  const noteScore = best > floor ? gsap.utils.mapRange(floor, best, 30, 100) : () => 100;
  const most = Math.max(...top.map((g) => pileGenres[g.name] ?? 0), 1);
  const pileScore = gsap.utils.mapRange(0, most, 12, 100);
  const metrics = top.map((g) => ({ key: g.name, label: radarLabel(genreLabel(g.name)) }));
  const data = [
    { label: "Tes notes", color: "var(--rating)", values: Object.fromEntries(top.map((g) => [g.name, noteScore(g.affinity)])) },
    { label: "Ta pile", color: "var(--chart-2)", values: Object.fromEntries(top.map((g) => [g.name, pileScore(pileGenres[g.name] ?? 0)])) },
  ];
  const focus = top.findIndex((g) => g.name === genre);
  const fr1 = (n: number) => n.toLocaleString("fr-FR", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

  return (
    <article aria-labelledby="gouts-titre" className="feature-card taste-radar">
      <div className="flex items-baseline justify-between gap-3">
        <h3 id="gouts-titre" className="text-lg text-foreground">
          Tes goûts
        </h3>
        <MonoMeta>{exemple ? "Exemple" : `${profile.ratedCount.toLocaleString("fr-FR")} notes`}</MonoMeta>
      </div>
      <div
        className="mx-auto w-full max-w-72"
        role="img"
        aria-label={`${exemple ? "Exemple. " : ""}Genres les mieux notés, et leur part dans ta pile : ${top
          .map((g) => `${genreLabel(g.name)}, ${fr1(g.affinity)} étoiles, ${pileGenres[g.name] ?? 0} titres à voir`)
          .join(" ; ")}`}
      >
        <RadarChart data={data} metrics={metrics} margin={46} levels={4} animate={!reduced} enterTransition={ENTER}>
          <RadarGrid showLabels={false} />
          <RadarArea index={1} showGlow={false} showPoints={false} />
          <RadarArea index={0} showGlow={false} />
          <RadarLabels fontSize={12} offset={16} />
          {focus >= 0 && <RadarFocus index={focus} value={data[0].values[top[focus].name]} />}
        </RadarChart>
      </div>
      <div aria-hidden="true" className="flex items-center justify-center gap-5 text-xs text-muted">
        <span className="flex items-center gap-2">
          <span className="taste-swatch is-notes" />
          Tes notes
        </span>
        <span className="flex items-center gap-2">
          <span className="taste-swatch is-pile" />
          Ta pile
        </span>
      </div>
      <div role="group" aria-label={exemple ? "Filtrer les tendances par genre" : "Filtrer ta pile par genre"} className="flex flex-wrap justify-center gap-2">
        {top.map((g) => (
          <Chip key={g.name} pressed={genre === g.name} onClick={() => onGenre(genre === g.name ? null : g.name)}>
            {radarLabel(genreLabel(g.name))}
            <span className="flex items-center gap-0.5 text-muted">
              {fr1(g.affinity)}
              <StarIcon filled size={11} />
            </span>
          </Chip>
        ))}
      </div>
      {!exemple && (
        <Link href="/recommendations" className="arrow-link mt-auto self-center text-sm">
          Tout ton profil de goûts
          <ArrowRight size={16} aria-hidden="true" />
        </Link>
      )}
    </article>
  );
}

/** Lire le radar (page d'arrivée) : à côté de l'exemple, ce que dit chaque forme, et comment avoir le sien. */
const LECTURE_RADAR = [
  "En jaune, tes notes : plus un genre s'éloigne du centre, plus tu l'aimes.",
  "En gris, ta pile : la place de chaque genre dans ce qui t'attend.",
  "Là où le gris dépasse le jaune, ta pile garde des genres que tu notes moins bien.",
  "Touche un genre : la liste du dessus ne garde que lui.",
];

function LectureRadar() {
  return (
    <article aria-labelledby="lecture-radar-titre" className="feature-card taste-radar">
      <h3 id="lecture-radar-titre" className="text-lg text-foreground">
        Lire le radar
      </h3>
      <ul className="flex flex-col gap-3 text-sm text-muted">
        {LECTURE_RADAR.map((point) => (
          <li key={point} className="flex items-start gap-2">
            <Check size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-subtle" />
            <span>{point}</span>
          </li>
        ))}
      </ul>
      <p className="border-l border-divider pl-3 text-sm text-foreground">
        Le tien se dessine avec tes notes : ce que tu balaies « Déjà vu », tu le notes, et le radar suit.
      </p>
      <Link href="/bienvenue" className="arrow-link mt-auto self-start text-sm">
        Commencer le tien
        <ArrowRight size={16} aria-hidden="true" />
      </Link>
    </article>
  );
}

/**
 * Le mur « À la une » : la fenêtre de ta pile en pleine largeur ; dessous, le paquet « À
 * découvrir » et le radar de tes goûts, dont les genres filtrent la fenêtre.
 */
export function RecommendationsWall({
  picks,
  profile,
  pileGenres,
  visitor = false,
  heading,
}: {
  picks: ShowcaseTitle[];
  profile: RecommendationProfile | null;
  pileGenres: Record<string, number>;
  /** Visiteur (spec accueil-vitrine-connexion-v1 § 3) : les tendances, sans pile à trier. */
  visitor?: boolean;
  /** Le titre de la liste quand elle ne montre que des suggestions (« Tendances de la semaine »). */
  heading?: string;
}) {
  const [genre, setGenre] = useState<string | null>(null);
  return (
    // Les deux cartes restent côte à côte dès 768 px (demande de l'utilisateur).
    <div className="grid min-w-0 gap-6 md:grid-cols-2 lg:col-span-2 lg:gap-8">
      <div className="min-w-0 md:col-span-2">
        <PileWindow
          picks={picks}
          genre={genre}
          onClearGenre={() => setGenre(null)}
          heading={heading ?? (visitor ? "Tendances de la semaine" : undefined)}
          local={visitor}
        />
      </div>
      {!visitor && <DiscoverDeck />}
      {/* Un visiteur voit un radar d'exemple (sur les genres des tendances) et comment le lire. */}
      {visitor ? (
        profile &&
        profile.genres.length >= 3 && (
          <>
            <TasteRadar profile={profile} pileGenres={pileGenres} genre={genre} onGenre={setGenre} exemple />
            <LectureRadar />
          </>
        )
      ) : profile && profile.genres.length >= 3 ? (
        <TasteRadar profile={profile} pileGenres={pileGenres} genre={genre} onGenre={setGenre} />
      ) : (
        <article className="feature-card taste-radar">
          <h3 className="text-lg text-foreground">Tes goûts</h3>
          <p className="text-base text-muted">
            <span className="text-foreground">Note quelques titres</span> et Catalog apprendra ce que tu aimes.
          </p>
          <Button href="/tri?famille=seen" size="sm" className="self-start">
            Noter mes titres vus
          </Button>
        </article>
      )}
    </div>
  );
}
