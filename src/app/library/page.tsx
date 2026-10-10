"use client";

import { buttonClass } from "@/components/ui/Button";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { ArrowDown, ArrowUp, CircleAlert, Info, ListPlus, RotateCcw, Search, X, ZoomIn, ZoomOut, Plus } from "lucide-react";
import { openPlaylistDialog } from "@/components/playlists/PlaylistDialog";
import { DetailPanel } from "@/components/DetailPanel";
import { DiscoverCard } from "@/components/DiscoverCard";
import { FilterSelect } from "@/components/FilterSelect";
import { ServicesFilter } from "@/components/ServicesFilter";
import { ServicesPicker } from "@/components/ServicesPicker";
import { useMyServices } from "@/components/useMyServices";
import { includedIn } from "@/lib/availability";
import { ItemCard } from "@/components/ItemCard";
import { ScoreBadge } from "@/components/ScoreBadge";
import { StarCount, StarRating } from "@/components/StarRating";
import { YearInput } from "@/components/YearInput";
import {
  SynopsisTooltip,
  markTooltipShown,
  tooltipDelayMs,
} from "@/components/SynopsisTooltip";
import {
  STATUS_META,
  ratingPatch,
  type Category,
  type ItemPatch,
  type LibraryItem,
  type WatchStatus,
} from "@/lib/libraryItem";
import { PageHeader } from "@/components/PageHeader";
import { CatalogLayout } from "@/components/layouts";
import { EmptyState, Toolbar } from "@/components/sections";
import { Button, Chip, Kbd, MetaRow, MonoMeta, SearchField, Skeleton, Toast } from "@/components/ui";
import { Logo } from "@/components/brand/Logo";
import { ADD_TITLE_EVENT } from "@/app/NavBar";
import { FlipGrid } from "@/components/motion/FlipGrid";
import { closeTo } from "@/lib/format";

type ItemsResponse = {
  items: LibraryItem[];
  page: number;
  pageSize: number;
  total: number;
};

type SortBy =
  | "name"
  | "year"
  | "elo"
  | "tmdbRating"
  | "added"
  | "rating"
  | "status"
  | "category"
  | "genre";
type SortDir = "asc" | "desc";

const WATCH_STATUS_OPTIONS: WatchStatus[] = ["Unwatched", "Watched"];
/** `dir` = sens de lecture naturel du critère, repris à chaque changement de tri. */
const SORT_OPTIONS: { value: SortBy; label: string; dir: SortDir }[] = [
  { value: "added", label: "Date d'ajout", dir: "desc" },
  { value: "name", label: "Nom", dir: "asc" },
  { value: "rating", label: "Ma note", dir: "desc" },
  { value: "status", label: "Vu / À voir", dir: "asc" },
  { value: "category", label: "Type", dir: "asc" },
  { value: "genre", label: "Genre", dir: "asc" },
  { value: "year", label: "Année", dir: "desc" },
  { value: "tmdbRating", label: "Note TMDB", dir: "desc" },
  { value: "elo", label: "Elo", dir: "desc" },
];
const PAGE_SIZE = 24;
const DELETE_UNDO_MS = 5000;

/**
 * Taille des cartes : chaque niveau fixe une largeur *minimale*, et la grille place autant de
 * colonnes que la place le permet (`auto-fill`). C'est ce qui rend le réglage stable à toutes les
 * largeurs : avec des nombres de colonnes imposés, le niveau le plus dense donnait des cartes de
 * 77px sur un téléphone, où le titre et les étoiles ne tenaient plus.
 */
const CARD_SIZE_LEVELS = [
  { min: 104, label: "Très dense" },
  { min: 124, label: "Dense" },
  { min: 148, label: "Normale" },
  { min: 184, label: "Grande" },
  { min: 232, label: "Très grande" },
] as const;
const DEFAULT_CARD_SIZE_INDEX = 2;
const CARD_SIZE_STORAGE_KEY = "watchlist:cardSizeIndex";

function useCardSizeIndex() {
  const [index, setIndex] = useState(DEFAULT_CARD_SIZE_INDEX);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CARD_SIZE_STORAGE_KEY);
      if (stored !== null) {
        const parsed = Number(stored);
        if (!Number.isNaN(parsed) && parsed >= 0 && parsed < CARD_SIZE_LEVELS.length) {
          // Lecture ponctuelle d'un système externe (localStorage) au montage — cas
          // d'usage légitime d'un effet, pas un état dérivable autrement côté SSR.
          // eslint-disable-next-line react-hooks/set-state-in-effect
          setIndex(parsed);
        }
      }
    } catch {
      // localStorage indisponible (navigation privée, etc.) — on garde la valeur par défaut.
    }
  }, []);

  function update(newIndex: number) {
    setIndex(newIndex);
    try {
      window.localStorage.setItem(CARD_SIZE_STORAGE_KEY, String(newIndex));
    } catch {
      // pas grave, juste pas persisté pour la prochaine visite.
    }
  }

  return [index, update] as const;
}

export default function LibraryPage() {
  const [items, setItems] = useState<LibraryItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  // Vrai d'emblée : la première page part au montage, et le rendu serveur ne doit pas annoncer
  // « Aucun résultat » / « 0 titre » le temps qu'elle arrive.
  const [loadingMore, setLoadingMore] = useState(true);
  const [type, setType] = useState<"" | Category>("");
  const [watchStatus, setWatchStatus] = useState<"" | WatchStatus>("");
  const [q, setQ] = useState("");
  /** Valeur réellement envoyée à l'API : `q` débattu, pour ne pas requêter à chaque frappe. */
  const [appliedQ, setAppliedQ] = useState("");
  const [genre, setGenre] = useState("");
  const [minRating, setMinRating] = useState(0);
  const [sortBy, setSortBy] = useState<SortBy>("name");
  const [sortDir, setSortDir] = useState<SortDir>("asc");
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [genres, setGenres] = useState<string[]>([]);
  const [selected, setSelected] = useState<LibraryItem | null>(null);
  const [cardSizeIndex, setCardSizeIndex] = useCardSizeIndex();
  const [pendingDelete, setPendingDelete] = useState<{
    items: { item: LibraryItem; index: number }[];
  } | null>(null);
  const [deleteErrorItem, setDeleteErrorItem] = useState<string | null>(null);
  const pendingDeleteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showAddModal, setShowAddModal] = useState(false);

  // « Ajouter un titre » de la barre du haut : à l'arrivée (?ajouter=1) ou sur place (événement).
  // Depuis l'accueil : ?fiche=<id> ouvre la fiche d'un titre, ?q= préremplit la recherche.
  useEffect(() => {
    function open() {
      setShowAddModal(true);
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("ajouter") === "1") open();
    const query = params.get("q");
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (query) setQ(query);
    const fiche = Number(params.get("fiche"));
    if (Number.isInteger(fiche) && fiche > 0) {
      fetch(`/api/items/${fiche}`)
        .then((res) => (res.ok ? (res.json() as Promise<LibraryItem>) : null))
        .then((item) => item && setSelected(item))
        .catch(() => undefined);
    }
    if (params.size > 0) window.history.replaceState(null, "", window.location.pathname);
    window.addEventListener(ADD_TITLE_EVENT, open);
    return () => window.removeEventListener(ADD_TITLE_EVENT, open);
  }, []);
  const [selectionMode, setSelectionMode] = useState(false);
  // Disponibilité streaming (spec disponibilite-streaming-v1 FR-3, FR-5).
  const services = useMyServices();
  const [onMyServices, setOnMyServices] = useState(false);
  const [showServicesPicker, setShowServicesPicker] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    fetch("/api/genres")
      .then((r) => r.json())
      .then((data: { genres: string[] }) => setGenres(data.genres));
  }, []);

  // Recherche débattue : une requête quand la frappe se calme, pas une par caractère.
  useEffect(() => {
    const t = setTimeout(() => setAppliedQ(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  // "/" met le focus dans la recherche, comme partout ailleurs — sauf si on est déjà en train
  // de saisir quelque chose, où la touche doit rester un caractère normal.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== "/" || e.metaKey || e.ctrlKey || e.altKey) return;
      const el = document.activeElement;
      if (
        el instanceof HTMLInputElement ||
        el instanceof HTMLTextAreaElement ||
        el instanceof HTMLSelectElement
      ) {
        return;
      }
      e.preventDefault();
      searchRef.current?.focus();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  const activeFilterCount =
    (type !== "" ? 1 : 0) +
    (watchStatus !== "" ? 1 : 0) +
    (genre !== "" ? 1 : 0) +
    (minRating > 0 ? 1 : 0) +
    (onMyServices ? 1 : 0) +
    (q !== "" ? 1 : 0);

  function resetFilters() {
    setType("");
    setWatchStatus("");
    setGenre("");
    setMinRating(0);
    setOnMyServices(false);
    setQ("");
  }

  /** Chaque critère a un sens de lecture naturel : A→Z pour un nom, meilleur d'abord sinon. */
  function changeSortBy(next: SortBy) {
    setSortBy(next);
    setSortDir(SORT_OPTIONS.find((o) => o.value === next)?.dir ?? "asc");
  }

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const loadingRef = useRef(false);
  /** Numéro de la requête en cours : une réponse d'un numéro dépassé est ignorée. */
  const querySeq = useRef(0);
  /** Dernière page atteinte : le serveur n'a plus rien à envoyer pour cette requête. */
  const [exhausted, setExhausted] = useState(false);

  const fetchPage = useCallback(
    async (targetPage: number, replace: boolean) => {
      // Une nouvelle requête (filtre, tri, recherche) rend périmées toutes celles encore en vol :
      // sans ça, la page 2 de l'ancien filtre pouvait arriver après la page 1 du nouveau et
      // s'y ajouter, doublons compris.
      if (replace) querySeq.current += 1;
      const seq = querySeq.current;

      loadingRef.current = true;
      setLoadingMore(true);

      const params = new URLSearchParams();
      if (type) params.set("type", type);
      if (watchStatus) params.set("watchStatus", watchStatus);
      if (appliedQ) params.set("q", appliedQ);
      if (genre) params.set("genre", genre);
      if (minRating > 0) params.set("minRating", String(minRating));
      if (onMyServices) params.set("onMyServices", "1");
      params.set("sortBy", sortBy);
      params.set("sortDir", sortDir);
      params.set("page", String(targetPage));
      params.set("pageSize", String(PAGE_SIZE));

      const res = await fetch(`/api/items?${params}`);
      const data: ItemsResponse = await res.json();

      // Réponse d'une requête remplacée entre-temps : on la jette. La requête en cours remettra
      // elle-même les indicateurs de chargement à zéro.
      if (seq !== querySeq.current) return;

      setItems((prev) => {
        if (replace) return data.items;
        // La pagination par décalage peut reprendre un titre déjà affiché, s'il a changé de place
        // entre deux pages (noté, basculé, supprimé alors que la liste est triée dessus) : un
        // titre n'apparaît jamais deux fois.
        const shown = new Set(prev.map((i) => i.id));
        return [...prev, ...data.items.filter((i) => !shown.has(i.id))];
      });
      setTotal(data.total);
      setPage(targetPage);
      setExhausted(data.items.length < PAGE_SIZE);
      setLoadingMore(false);
      loadingRef.current = false;
    },
    [type, watchStatus, appliedQ, genre, minRating, onMyServices, sortBy, sortDir]
  );

  // Reset + rechargement à chaque changement de filtre (scroll infini: FR — cf. remplacement de la pagination).
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchPage(1, true);
  }, [fetchPage]);

  // `exhausted` évite une boucle de requêtes vides : une fois des doublons écartés, le nombre de
  // titres affichés peut rester sous le total alors qu'il n'y a plus rien à charger.
  const hasMore = !exhausted && items.length < total;

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loadingRef.current && hasMore) {
          fetchPage(page + 1, false);
        }
      },
      { rootMargin: "400px" }
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchPage, page, hasMore]);

  async function patchItem(
    id: number,
    patch: ItemPatch
  ) {
    const res = await fetch(`/api/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const updated: LibraryItem = await res.json();

    setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
    setSelected((prev) => (prev && prev.id === id ? updated : prev));
  }

  /**
   * Récupère (et met en cache côté serveur) le synopsis d'un item à la première ouverture de
   * son détail — jamais pré-chargé en masse pour les ~850 items existants.
   */
  async function loadOverview(id: number) {
    const res = await fetch(`/api/items/${id}`);
    if (!res.ok) return;
    const updated: LibraryItem = await res.json();

    const fresh = { overview: updated.overview, availability: updated.availability };
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...fresh } : i)));
    setSelected((prev) => (prev && prev.id === id ? { ...prev, ...fresh } : prev));
  }

  /** Refetch TMDB explicite (titre, synopsis, note, affiche…) — local, rien n'est poussé vers Notion. */
  async function refetchItem(id: number) {
    const res = await fetch(`/api/items/${id}?refresh=1`);
    if (!res.ok) return;
    const updated: LibraryItem = await res.json();

    setItems((prev) => prev.map((i) => (i.id === id ? updated : i)));
    setSelected((prev) => (prev && prev.id === id ? updated : prev));
  }

  /** Appel réel : archive côté Notion puis supprime localement. Restaure l'item en cas d'échec. */
  const finalizeDelete = useCallback(async (item: LibraryItem) => {
    const res = await fetch(`/api/items/${item.id}`, { method: "DELETE" });
    if (!res.ok) {
      setItems((prev) => (prev.some((i) => i.id === item.id) ? prev : [...prev, item]));
      setTotal((prev) => prev + 1);
      setDeleteErrorItem(item.name);
    }
  }, []);

  /**
   * FR-9 (bibliothèque) + sélection par lot : suppression en un clic (un item ou plusieurs)
   * — retrait immédiat de la liste (optimiste) + toast "Annuler" pendant DELETE_UNDO_MS,
   * plutôt qu'une confirmation bloquante. L'appel réel à l'API n'a lieu qu'à l'expiration du
   * délai (ou immédiatement si l'utilisateur en supprime d'autres entre-temps, pour ne garder
   * qu'un seul toast à la fois).
   */
  const requestDelete = useCallback(
    (targets: LibraryItem[]) => {
      if (targets.length === 0) return;

      if (pendingDelete) {
        if (pendingDeleteTimer.current) clearTimeout(pendingDeleteTimer.current);
        pendingDelete.items.forEach(({ item }) => finalizeDelete(item));
      }

      const targetIds = new Set(targets.map((t) => t.id));
      const entries = targets.map((item) => ({
        item,
        index: items.findIndex((i) => i.id === item.id),
      }));
      const batch = { items: entries };

      setItems((prev) => prev.filter((i) => !targetIds.has(i.id)));
      setTotal((prev) => prev - targets.length);
      setSelected((prev) => (prev && targetIds.has(prev.id) ? null : prev));
      setSelectedIds((prev) => {
        if (prev.size === 0) return prev;
        const next = new Set(prev);
        targetIds.forEach((id) => next.delete(id));
        return next;
      });
      setPendingDelete(batch);

      pendingDeleteTimer.current = setTimeout(() => {
        entries.forEach(({ item }) => finalizeDelete(item));
        setPendingDelete((prev) => (prev === batch ? null : prev));
      }, DELETE_UNDO_MS);
    },
    [items, finalizeDelete, pendingDelete]
  );

  function undoDelete() {
    if (!pendingDelete) return;
    if (pendingDeleteTimer.current) clearTimeout(pendingDeleteTimer.current);
    // La suppression n'a lieu qu'après le délai d'annulation : entre-temps, une page chargée
    // (défilement, changement de filtre) a pu ramener un titre, déjà affiché et déjà compté par
    // le serveur. On ne réinsère, et on ne recompte, que les autres.
    const shown = new Set(items.map((i) => i.id));
    const entries = [...pendingDelete.items]
      .filter(({ item }) => !shown.has(item.id))
      .sort((a, b) => a.index - b.index);
    setItems((prev) => {
      const next = [...prev];
      entries.forEach(({ item, index }) => next.splice(Math.min(index, next.length), 0, item));
      return next;
    });
    setTotal((prev) => prev + entries.length);
    setPendingDelete(null);
  }

  // Filet de sécurité : si la page se démonte pendant qu'un "annuler" est encore affiché,
  // on finalise plutôt que de perdre silencieusement la demande de suppression.
  useEffect(() => {
    return () => {
      if (pendingDeleteTimer.current) clearTimeout(pendingDeleteTimer.current);
    };
  }, []);

  useEffect(() => {
    if (!deleteErrorItem) return;
    const t = setTimeout(() => setDeleteErrorItem(null), 5000);
    return () => clearTimeout(t);
  }, [deleteErrorItem]);

  /** Dernière carte cochée, point de départ d'une plage (Maj+clic). */
  const lastToggled = useRef<number | null>(null);

  /** Coche ou décoche une carte ; avec Maj, coche toute la plage depuis la dernière (playlists-v2 FR-4). */
  function toggleSelect(id: number, range: boolean) {
    const from = lastToggled.current === null ? -1 : items.findIndex((i) => i.id === lastToggled.current);
    const to = items.findIndex((i) => i.id === id);
    lastToggled.current = id;
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (range && from >= 0 && to >= 0) {
        const [start, end] = from < to ? [from, to] : [to, from];
        for (const item of items.slice(start, end + 1)) next.add(item.id);
        return next;
      }
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** Sélection par lot : applique un statut à tous les items sélectionnés en parallèle. */
  async function bulkSetStatus(status: WatchStatus) {
    const ids = Array.from(selectedIds);
    await Promise.all(ids.map((id) => patchItem(id, { watchStatus: status })));
    setSelectedIds(new Set());
  }

  return (
    <CatalogLayout>
      <PageHeader
        title="Bibliothèque"
        lead="Ce que tu as vu, ce que tu veux voir."
        description="Note d'un clic sur les étoiles, change le statut depuis l'affiche, ouvre une fiche pour tout le reste."
        actions={
          <>
            <button onClick={() => setShowAddModal(true)} className={buttonClass({ variant: "primary" })}>
              <Plus size={15} aria-hidden="true" />
              Ajouter un titre
            </button>
            <button
              onClick={() => {
                setSelectionMode((v) => !v);
                setSelectedIds(new Set());
              }}
              aria-pressed={selectionMode}
              className={buttonClass({ variant: "secondary" })}
            >
              {selectionMode ? "Terminé" : "Sélectionner"}
            </button>
          </>
        }
      />

      {/* Recherche mise en avant (le geste le plus fréquent), filtres en second rang. */}
      <div>
        <SearchField
          ref={searchRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            setQ("");
            e.currentTarget.blur();
          }}
          onClear={() => setQ("")}
          shortcut={["/"]}
          placeholder="Rechercher un titre…"
          aria-label="Rechercher un titre"
        />

        <Toolbar
          className="mt-3"
          start={
            <>
          <FilterSelect
            placeholder="Tout type"
            value={type}
            onChange={(v) => setType(v as typeof type)}
            options={[
              { value: "Movie", label: "Films" },
              { value: "TV Series", label: "Séries" },
              { value: "Documentary", label: "Documentaires" },
            ]}
          />
          <FilterSelect
            placeholder="Tout statut"
            value={watchStatus}
            onChange={(v) => setWatchStatus(v as typeof watchStatus)}
            options={[
              { value: "Watched", label: "Vu" },
              { value: "Unwatched", label: "À voir" },
            ]}
          />
          <FilterSelect
            placeholder="Tout genre"
            value={genre}
            onChange={setGenre}
            options={genres.map((g) => ({ value: g, label: g }))}
            searchable
          />
          <FilterSelect
            placeholder="Toute note"
            value={minRating > 0 ? String(minRating) : ""}
            onChange={(v) => setMinRating(v === "" ? 0 : Number(v))}
            options={[1, 2, 3, 4, 5].map((n) => ({
              value: String(n),
              label: `${n} étoile${n > 1 ? "s" : ""} et plus`,
              display: (
                <>
                  <StarCount value={n} /> et plus
                </>
              ),
            }))}
          />
          <ServicesFilter
            active={onMyServices}
            subscriptionCount={services.subscriptionIds.length}
            onToggle={setOnMyServices}
            onOpenPicker={() => setShowServicesPicker(true)}
          />
            </>
          }
          end={
          /* Tri : le champ et son sens restent collés, ils se lisent comme un seul réglage. */
          <div className="flex items-center gap-1">
            <FilterSelect
              prefix="Trier par"
              placeholder="Nom"
              value={sortBy}
              onChange={(v) => changeSortBy(v as SortBy)}
              options={SORT_OPTIONS.map((opt) => ({ value: opt.value, label: opt.label }))}
              clearable={false}
            />
            <button
              onClick={() => setSortDir((d) => (d === "asc" ? "desc" : "asc"))}
              title={sortDir === "asc" ? "Ordre croissant" : "Ordre décroissant"}
              aria-label={sortDir === "asc" ? "Ordre croissant" : "Ordre décroissant"}
              className={buttonClass({ variant: "secondary", icon: true })}
            >
              {sortDir === "asc" ? <ArrowUp size={14} /> : <ArrowDown size={14} />}
            </button>
          </div>
          }
        />

        {/* Ligne d'état : ce que les filtres donnent à gauche, le réglage de densité à droite.
            Les deux se replient l'un sous l'autre quand la largeur manque. */}
        <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-3 text-xs text-muted">
          <MonoMeta>
            {loadingMore && items.length === 0
              ? "Chargement…"
              : `${total.toLocaleString("fr-FR")} titre${total > 1 ? "s" : ""}`}
          </MonoMeta>
          {activeFilterCount > 0 && (
            <>
              <span aria-hidden="true">·</span>
              <button
                onClick={resetFilters}
                className="link inline-flex items-center gap-1"
              >
                <RotateCcw size={11} aria-hidden="true" />
                Réinitialiser {activeFilterCount} filtre{activeFilterCount > 1 ? "s" : ""}
              </button>
            </>
          )}

          {/* Taille des cartes : un pas à la fois, avec la position visible. Le `input[range]`
              natif était dessiné par l'OS, seul élément non stylé de la barre. */}
          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={() => setCardSizeIndex(Math.max(0, cardSizeIndex - 1))}
              disabled={cardSizeIndex === 0}
              aria-label="Cartes plus petites"
              title="Cartes plus petites"
              className={buttonClass({ variant: "secondary", size: "sm", icon: true, className: "disabled:hover:text-muted" })}
            >
              <ZoomOut size={14} />
            </button>

            <div
              className="flex items-center gap-0.5"
              role="img"
              aria-label={`Taille : ${CARD_SIZE_LEVELS[cardSizeIndex].label}`}
              title={CARD_SIZE_LEVELS[cardSizeIndex].label}
            >
              {CARD_SIZE_LEVELS.map((level, i) => (
                <span
                  key={level.min}
                  className={`h-1.5 w-1.5 rounded-full transition-colors duration-200 ${
                    i <= cardSizeIndex ? "bg-foreground" : "bg-line-strong"
                  }`}
                />
              ))}
            </div>

            <button
              onClick={() =>
                setCardSizeIndex(Math.min(CARD_SIZE_LEVELS.length - 1, cardSizeIndex + 1))
              }
              disabled={cardSizeIndex === CARD_SIZE_LEVELS.length - 1}
              aria-label="Cartes plus grandes"
              title="Cartes plus grandes"
              className={buttonClass({ variant: "secondary", size: "sm", icon: true, className: "disabled:hover:text-muted" })}
            >
              <ZoomIn size={14} />
            </button>
          </div>
        </div>
      </div>

      {items.length === 0 && !loadingMore && (
        <EmptyState
          className="mt-6"
          icon={<Search size={20} aria-hidden="true" />}
          title={q ? `Aucun titre pour « ${q} »` : "Aucun titre avec ces filtres"}
          action={
            activeFilterCount > 0 ? (
              <Button onClick={resetFilters} size="sm">
                <RotateCcw size={13} aria-hidden="true" />
                Réinitialiser {activeFilterCount} filtre{activeFilterCount > 1 ? "s" : ""}
              </Button>
            ) : (
              <Button onClick={() => setShowAddModal(true)} variant="primary" size="sm">
                <Plus size={14} aria-hidden="true" />
                Ajouter un titre
              </Button>
            )
          }
        >
          {q ? "Il n'est peut-être pas encore dans ta bibliothèque : ajoute-le depuis TMDB." : "Élargis les filtres pour retrouver tes titres."}
        </EmptyState>
      )}

      <FlipGrid
        stagger
          className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(var(--card-min),1fr))] gap-3 sm:gap-4"
        style={{ "--card-min": `${CARD_SIZE_LEVELS[cardSizeIndex].min}px` } as CSSProperties}
      >
        {items.map((item) => (
          <ItemCard
            key={item.id}
            item={item}
            selectionMode={selectionMode}
            selected={selectedIds.has(item.id)}
            onToggleSelect={(range) => toggleSelect(item.id, range)}
            onOpen={() => setSelected(item)}
            onQuickChange={patchItem}
            onDelete={(i) => requestDelete([i])}
            onLoadOverview={loadOverview}
            includedOn={includedIn(item.availability, services.covered)}
          />
        ))}
      </FlipGrid>

      <div ref={sentinelRef} className="h-10" />
      {loadingMore && items.length > 0 && <p className="text-center text-sm text-muted">Chargement…</p>}
      {!hasMore && items.length > 0 && (
        <p className="text-center">
          <MonoMeta>Fin de la bibliothèque | {total.toLocaleString("fr-FR")} titres</MonoMeta>
        </p>
      )}

      {selected && (
        <DetailPanel
          key={selected.id}
          item={selected}
          onClose={() => setSelected(null)}
          onChange={patchItem}
          onDelete={(i) => requestDelete([i])}
          onLoadOverview={loadOverview}
          onRefetch={refetchItem}
          covered={services.covered}
        />
      )}

      {selectionMode && selectedIds.size > 0 && (
        <Toast
          actions={
            <>
              {WATCH_STATUS_OPTIONS.map((status) => (
                <Button key={status} onClick={() => bulkSetStatus(status)} size="sm">
                  Marquer « {STATUS_META[status].label} »
                </Button>
              ))}
              {/* playlists-v2 FR-4 : la sélection entière, dans l'ordre où elle a été faite. */}
              <Button
                onClick={() =>
                  openPlaylistDialog({ kind: "items", itemIds: Array.from(selectedIds) }, "selection", () => setSelectedIds(new Set()))
                }
                size="sm"
              >
                <ListPlus size={14} aria-hidden="true" />
                Ajouter à une playlist
              </Button>
              <Button onClick={() => requestDelete(items.filter((i) => selectedIds.has(i.id)))} size="sm">
                Supprimer
              </Button>
              <Button onClick={() => setSelectedIds(new Set())} variant="ghost" size="sm">
                Désélectionner
              </Button>
            </>
          }
        >
          {selectedIds.size} sélectionné{selectedIds.size > 1 ? "s" : ""}
        </Toast>
      )}

      {pendingDelete && (
        <Toast action="Annuler" onAction={undoDelete}>
          {pendingDelete.items.length === 1 ? (
            <>&laquo;&nbsp;{pendingDelete.items[0].item.name}&nbsp;&raquo; supprimé</>
          ) : (
            `${pendingDelete.items.length} titres supprimés`
          )}
        </Toast>
      )}

      {deleteErrorItem && (
        <Toast>
          <span className="flex items-center gap-2">
            <CircleAlert size={14} aria-hidden="true" className="shrink-0 text-muted" />
            Échec de la suppression de &laquo;&nbsp;{deleteErrorItem}&nbsp;&raquo;, réessaie.
          </span>
        </Toast>
      )}

      {showAddModal && (
        <AddItemModal onClose={() => setShowAddModal(false)} onAdded={() => fetchPage(1, true)} />
      )}

      {showServicesPicker && (
        <ServicesPicker
          catalog={services.catalog}
          selected={services.subscriptionIds}
          onSave={async (ids) => {
            const firstChoice = services.subscriptionIds.length === 0;
            await services.save(ids);
            // Premier choix (on arrive de la pastille, sans abonnement) : on active le filtre
            // dans la foulée. Une simple modification de la liste ne le touche pas.
            if (firstChoice && ids.length > 0) setOnMyServices(true);
          }}
          onClose={() => setShowServicesPicker(false)}
        />
      )}
    </CatalogLayout>
  );
}

type PersonRoleKey = "director" | "producer" | "actor";

type TmdbSearchItem = {
  tmdbId: number;
  type: "Movie" | "TV Series";
  isDocumentary: boolean;
  genres: string[];
  title: string;
  year: string | null;
  posterUrl: string | null;
  voteAverage: number | null;
  voteCount: number | null;
  overview: string;
  /** null = absent de la bibliothèque. */
  libraryStatus: WatchStatus | null;
  personCredit: { name: string; roles: PersonRoleKey[] } | null;
};

// spec: specs/recherche-personne-v1.md — ordre d'affichage des groupes de rôle (FR-2) et
// priorité pour le "rôle principal" d'un résultat multi-rôle (FR-5).
const ROLE_ORDER: PersonRoleKey[] = ["director", "producer", "actor"];

const ROLE_GROUP_LABEL: Record<PersonRoleKey, string> = {
  director: "Réalisateur",
  producer: "Producteur",
  actor: "Acteur",
};

const PERSON_ROLE_PHRASE: Record<PersonRoleKey, string> = {
  director: "Réalisé par",
  producer: "Produit par",
  actor: "Avec",
};

const OTHER_RESULTS_PREVIEW = 3;

function primaryRole(roles: PersonRoleKey[]): PersonRoleKey {
  return ROLE_ORDER.find((r) => roles.includes(r)) ?? roles[0];
}

/** FR-5 : un même titre peut avoir plusieurs rôles pour la personne recherchée — les deux sont affichés. */
function personCreditLine(credit: { name: string; roles: PersonRoleKey[] }): string {
  const activeRoles = ROLE_ORDER.filter((r) => credit.roles.includes(r));
  if (activeRoles.length <= 1) {
    const role = activeRoles[0] ?? credit.roles[0];
    return `${PERSON_ROLE_PHRASE[role]} ${credit.name}`;
  }
  return `${activeRoles.map((r) => ROLE_GROUP_LABEL[r]).join(" & ")} : ${credit.name}`;
}

function isLowQualityResult(r: TmdbSearchItem): boolean {
  return !r.year && r.genres.length === 0;
}

/**
 * FR-4/FR-6 (amendé) : notoriété d'abord — nombre de votes TMDB décroissant (`voteCount`),
 * pas la note moyenne. Un titre culte mais clivant (ex. un DiCaprio "aimé de tous ou pas")
 * doit ressortir devant un petit film bien noté par une poignée de votants ; la note moyenne
 * ne sert qu'en second critère de départage, l'année en troisième. Les entrées sans année ni
 * genre (contenu TMDB de mauvaise qualité) sont reléguées en dernier.
 */
function compareByFame(a: TmdbSearchItem, b: TmdbSearchItem): number {
  const aLow = isLowQualityResult(a);
  const bLow = isLowQualityResult(b);
  if (aLow !== bLow) return aLow ? 1 : -1;

  const ca = a.voteCount ?? 0;
  const cb = b.voteCount ?? 0;
  if (ca !== cb) return cb - ca;

  const va = a.voteAverage ?? -1;
  const vb = b.voteAverage ?? -1;
  if (va !== vb) return vb - va;

  const ya = a.year ? Number(a.year) : -Infinity;
  const yb = b.year ? Number(b.year) : -Infinity;
  return yb - ya;
}

/**
 * FR-1 : correspondances de titre exact d'abord, puis le reste — les deux groupes triés par
 * notoriété (cf. `compareByFame`) plutôt que le "popularity" TMDB brut, qui favorise des pics
 * d'intérêt récents sur du contenu obscur (ex. un épisode peu connu) au détriment des titres
 * réellement massifs (cf. specs/recherche-personne-v1.md, amendement notoriété).
 */
function sortTitleMatches(results: TmdbSearchItem[], query: string): TmdbSearchItem[] {
  const q = query.trim().toLowerCase();
  const exact = results.filter((r) => r.title.toLowerCase() === q).sort(compareByFame);
  const rest = results.filter((r) => r.title.toLowerCase() !== q).sort(compareByFame);
  return [...exact, ...rest];
}

/** spec: specs/ajout-item-v1.md — recherche TMDB puis création Notion + insertion locale. */
function AddItemModal({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const [query, setQuery] = useState("");
  /**
   * Grille affichée tant qu'aucune recherche n'est tapée : des titres proches de tes favoris
   * (même moteur que l'onglet « À découvrir »), pour ajouter sans même savoir quoi chercher.
   */
  const [suggestions, setSuggestions] = useState<SuggestedTitle[] | null>(null);
  const [dismissedSuggestion, setDismissedSuggestion] = useState<{
    sug: SuggestedTitle;
    index: number;
  } | null>(null);
  const [results, setResults] = useState<TmdbSearchItem[]>([]);
  const [searching, setSearching] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  // Item tout juste ajouté, en attente de qualification rapide (vu/pas vu + note) avant de
  // revenir à la recherche pour enchaîner sur un autre titre sans fermer la modale.
  const [qualifying, setQualifying] = useState<LibraryItem | null>(null);
  const [filterType, setFilterType] = useState<"" | "Movie" | "TV Series" | "Documentary">("");
  const [filterGenre, setFilterGenre] = useState("");
  const [yearFrom, setYearFrom] = useState("");
  const [yearTo, setYearTo] = useState("");
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loadingMore, setLoadingMore] = useState(false);
  const [roleFilter, setRoleFilter] = useState<"" | PersonRoleKey>("");
  const [showAllOtherResults, setShowAllOtherResults] = useState(false);

  // Compteur de requête : évite qu'une réponse TMDB en retard (frappe rapide) n'écrase des
  // résultats plus récents déjà affichés.
  const searchSeq = useRef(0);
  const loadingMoreRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // La vue "qualification" remplace entièrement la vue recherche (branche conditionnelle) —
  // son conteneur scrollable est donc démonté puis remonté au retour, ce qui réinitialise
  // nativement son scrollTop. On le restaure manuellement.
  const savedScrollTop = useRef(0);

  useEffect(() => {
    if (!qualifying && scrollRef.current) {
      scrollRef.current.scrollTop = savedScrollTop.current;
    }
  }, [qualifying]);

  useEffect(() => {
    const trimmed = query.trim();
    if (!trimmed) return;

    const seq = ++searchSeq.current;

    // Debounce d'une recherche externe (TMDB) déclenchée par la frappe — pas d'alternative
    // sans effet pour synchroniser un appel réseau différé avec l'état local.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSearching(true);
    const t = setTimeout(() => {
      fetch(`/api/tmdb/search?q=${encodeURIComponent(trimmed)}&page=1`)
        .then((r) => r.json())
        .then((data: { results: TmdbSearchItem[]; totalPages: number }) => {
          if (seq !== searchSeq.current) return; // réponse obsolète, une recherche plus récente est en cours
          setResults(data.results);
          setPage(1);
          setTotalPages(data.totalPages);
          setRoleFilter("");
          setShowAllOtherResults(false);
        })
        .catch(() => {
          if (seq === searchSeq.current) {
            setResults([]);
            setTotalPages(1);
          }
        })
        .finally(() => {
          if (seq === searchSeq.current) setSearching(false);
        });
    }, 400);

    return () => clearTimeout(t);
  }, [query]);

  // Scroll infini : au-delà de la première page TMDB (~20 titres), on charge la suite en
  // scrollant dans la liste. La filmographie d'une personne (non paginée par TMDB) n'est
  // récupérée qu'une fois, en page 1 — cf. searchMulti côté serveur.
  const fetchMorePage = useCallback(async () => {
    const trimmed = query.trim();
    if (!trimmed || loadingMoreRef.current || page >= totalPages) return;

    loadingMoreRef.current = true;
    setLoadingMore(true);
    const nextPage = page + 1;

    try {
      const res = await fetch(`/api/tmdb/search?q=${encodeURIComponent(trimmed)}&page=${nextPage}`);
      const data: { results: TmdbSearchItem[]; totalPages: number } = await res.json();

      setResults((prev) => {
        const seen = new Set(prev.map((r) => `${r.type}-${r.tmdbId}`));
        const additions = data.results.filter((r) => !seen.has(`${r.type}-${r.tmdbId}`));
        return [...prev, ...additions];
      });
      setPage(nextPage);
      setTotalPages(data.totalPages);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [query, page, totalPages]);

  // Échap ferme la modale depuis n'importe où (l'étape de qualification, par exemple). Dans le
  // champ de recherche, son propre gestionnaire vide d'abord la saisie et arrête l'événement.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  useEffect(() => {
    const root = scrollRef.current;
    const sentinel = sentinelRef.current;
    if (!root || !sentinel) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting) fetchMorePage();
      },
      { root, rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [fetchMorePage]);

  const availableGenres = Array.from(new Set(results.flatMap((r) => r.genres))).sort((a, b) =>
    a.localeCompare(b)
  );

  const filteredResults = results.filter((r) => {
    const category = r.isDocumentary ? "Documentary" : r.type;
    if (filterType && category !== filterType) return false;
    if (filterGenre && !r.genres.includes(filterGenre)) return false;
    const year = r.year ? Number(r.year) : null;
    if (yearFrom && (year === null || year < Number(yearFrom))) return false;
    if (yearTo && (year === null || year > Number(yearTo))) return false;
    return true;
  });

  // spec: specs/recherche-personne-v1.md FR-1/FR-2/FR-3 — la filmographie d'une personne
  // (personCredit) est regroupée par rôle et priorisée ; les correspondances de titre pur
  // (aucun personCredit) passent en section secondaire repliable (FR-7).
  const personResults = filteredResults.filter((r) => r.personCredit);
  const titleOnlyResults = filteredResults.filter((r) => !r.personCredit);

  const roleGroups = ROLE_ORDER.map((role) => ({
    role,
    items: personResults
      .filter((r) => primaryRole(r.personCredit!.roles) === role)
      .sort(compareByFame),
  })).filter((g) => g.items.length > 0);

  const visibleRoleGroups = roleFilter ? roleGroups.filter((g) => g.role === roleFilter) : roleGroups;

  const sortedTitleOnly = sortTitleMatches(titleOnlyResults, query);
  const visibleTitleOnly = showAllOtherResults
    ? sortedTitleOnly
    : sortedTitleOnly.slice(0, OTHER_RESULTS_PREVIEW);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/recommendations/discover?limit=18")
      .then((r) => r.json())
      .then((body: { items?: SuggestedTitle[] }) => {
        if (!cancelled) setSuggestions(body.items ?? []);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /** Une suggestion suit exactement le parcours d'un résultat de recherche : ajout puis qualification. */
  function pickSuggestion(sug: SuggestedTitle) {
    handlePick(
      {
      tmdbId: sug.tmdbId,
      type: sug.type,
      isDocumentary: sug.isDocumentary,
      genres: [],
      title: sug.title,
      year: sug.year,
      posterUrl: sug.posterUrl,
      voteAverage: sug.voteAverage,
      voteCount: sug.voteCount,
      overview: sug.overview,
      libraryStatus: null,
      personCredit: null,
      },
      "suggestions"
    );
  }

  /**
   * Tri-rapide FR-2 : écarter une suggestion. Elle ne revient plus, ni ici ni dans « À découvrir » ;
   * une ligne d'annulation reste le temps de se raviser (la modale n'a pas de toast).
   */
  async function dismissSuggestion(sug: SuggestedTitle) {
    const index = suggestions?.findIndex((s) => s.tmdbId === sug.tmdbId && s.type === sug.type) ?? -1;
    setSuggestions((prev) => prev?.filter((s) => !(s.tmdbId === sug.tmdbId && s.type === sug.type)) ?? prev);
    setDismissedSuggestion({ sug, index });

    const res = await fetch("/api/dismissals", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: { type: "tmdb", mediaType: sug.type, tmdbId: sug.tmdbId } }),
    }).catch(() => null);
    if (!res?.ok) undoDismissSuggestion({ sug, index }, false);
  }

  function undoDismissSuggestion(entry: { sug: SuggestedTitle; index: number }, persisted = true) {
    setDismissedSuggestion(null);
    setSuggestions((prev) =>
      prev && !prev.some((s) => s.tmdbId === entry.sug.tmdbId && s.type === entry.sug.type)
        ? [...prev.slice(0, entry.index), entry.sug, ...prev.slice(entry.index)]
        : prev
    );
    if (!persisted) return;
    fetch("/api/dismissals", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject: { type: "tmdb", mediaType: entry.sug.type, tmdbId: entry.sug.tmdbId } }),
    }).catch(() => {});
  }

  /** `source` : d'où vient l'ajout (tri-rapide FR-1/FR-8) — une suggestion acceptée compte. */
  async function handlePick(result: TmdbSearchItem, source: "search" | "suggestions" = "search") {
    setAddingId(result.tmdbId);
    setMessage(null);
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tmdbId: result.tmdbId, type: result.type, source }),
      });
      const body = await res.json();

      if (!res.ok) {
        setMessage(
          body.error === "notion_not_configured"
            ? "Notion n'est pas configuré : impossible d'ajouter."
            : "Échec de l'ajout, réessaie."
        );
        return;
      }

      setSuggestions((prev) => prev?.filter((sug) => sug.tmdbId !== result.tmdbId) ?? prev);

      if (body.alreadyExists) {
        if (scrollRef.current) savedScrollTop.current = scrollRef.current.scrollTop;
        setQualifying(body.item as LibraryItem);
        return;
      }

      onAdded();
      if (scrollRef.current) savedScrollTop.current = scrollRef.current.scrollTop;
      // Qualification rapide (vu/pas vu + note) directement dans la modale, plutôt que
      // d'ouvrir le panneau de détail complet. On garde la recherche et ses résultats intacts
      // (juste l'item ajouté retiré) pour retrouver le même contexte en revenant — utile en
      // plein milieu d'une filmographie, pour enchaîner sur un autre titre du même lot.
      setQualifying(body.item as LibraryItem);
      setResults((prev) => prev.filter((r) => !(r.type === result.type && r.tmdbId === result.tmdbId)));
    } finally {
      setAddingId(null);
    }
  }

  async function handleQualifyChange(patch: ItemPatch) {
    if (!qualifying) return;
    const res = await fetch(`/api/items/${qualifying.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const updated: LibraryItem = await res.json();
    setQualifying(updated);
  }

  function finishQualifying() {
    setQualifying(null);
    onAdded();
  }

  function renderResult(r: TmdbSearchItem) {
    return (
      <SearchResultRow
        key={`${r.type}-${r.tmdbId}`}
        result={r}
        adding={addingId === r.tmdbId}
        disabled={addingId !== null}
        onPick={() => handlePick(r)}
      />
    );
  }

  return (
    <div
      onClick={onClose}
      className="fade-in fixed inset-0 z-50 flex items-start justify-center bg-overlay px-3 py-6 sm:px-6 sm:py-16"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ajouter un titre"
        onClick={(e) => e.stopPropagation()}
        className="dialog-in bezel flex max-h-[calc(100dvh-3rem)] w-full max-w-2xl flex-col sm:max-h-[calc(100dvh-5rem)]"
      >
        {/* Fenêtre de commande (DESIGN.md « App Window ») : en-tête, contenu qui défile, barre
            d'actions au pied. */}
        <div className="bezel-inner flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between gap-4 px-4 pt-4 sm:px-5">
          <h2 className="text-base text-foreground">
            {qualifying ? "Qualifier l’ajout" : "Ajouter un titre"}
          </h2>
          <Button onClick={onClose} aria-label="Fermer" variant="ghost" size="sm" icon>
            <X size={15} aria-hidden="true" />
          </Button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4 sm:px-5">

        {qualifying ? (
          <div className="mt-4">
            <div className="flex items-center gap-3">
              <div className="poster h-24 w-16 shrink-0 sm:h-[7.5rem] sm:w-20">
                {qualifying.posterUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={qualifying.posterUrl}
                    alt={qualifying.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-2xl text-muted">
                    🎬
                  </div>
                )}
              </div>
              <div className="min-w-0">
                <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground sm:text-base">
                  {qualifying.name}
                </p>
                {qualifying.year && <p className="mt-0.5 text-xs text-muted">{qualifying.year}</p>}
              </div>
            </div>

            {/* Mêmes contrôles que la fiche : badge de statut qui bascule, notation en étoiles,
                et noter vaut "je l'ai vu" (le statut suit tout seul). */}
            <div className="mt-5 flex flex-wrap items-start gap-x-6 gap-y-4">
              <div>
                <p className="text-xs text-muted">Statut</p>
                <button
                  type="button"
                  onClick={() =>
                    handleQualifyChange({
                      watchStatus: qualifying.watchStatus === "Watched" ? "Unwatched" : "Watched",
                    })
                  }
                  aria-pressed={qualifying.watchStatus === "Watched"}
                  className="chip mt-2"
                >
                  <span
                    aria-hidden="true"
                    className={`h-1.5 w-1.5 rounded-full ${
                      qualifying.watchStatus === "Watched" ? "bg-success" : "bg-subtle"
                    }`}
                  />
                  {qualifying.watchStatus === "Watched" ? "Vu" : "À voir"}
                </button>
              </div>

              <div>
                <p className="text-xs text-muted">Note</p>
                <StarRating
                  className="mt-2"
                  rating={qualifying.rating}
                  onRate={(next) => handleQualifyChange(ratingPatch(qualifying, next))}
                  showWorstTier
                  showLabel
                />
              </div>
            </div>

            <button
              onClick={finishQualifying}
              className={buttonClass({ variant: "primary", className: "mt-6 w-full" })}
            >
              Terminé, chercher un autre titre
            </button>
          </div>
        ) : (
          <>
            <SearchField
              className="mt-4"
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Escape") return;
                // Échap vide la recherche avant de fermer la modale, pour repartir d'une
                // page blanche sans tout refermer.
                e.stopPropagation();
                if (query !== "") setQuery("");
                else onClose();
              }}
              onClear={() => setQuery("")}
              searching={searching}
              placeholder="Rechercher un film, une série ou une personne…"
              aria-label="Rechercher un film, une série ou une personne"
            />

            {message && (
              <p role="status" className="mt-3 flex items-center gap-2 text-xs text-foreground">
                <CircleAlert size={14} aria-hidden="true" className="shrink-0 text-muted" />
                {message}
              </p>
            )}

            {query.trim() && results.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2">
                <FilterSelect
                  placeholder="Tout type"
                  value={filterType}
                  onChange={(v) => setFilterType(v as typeof filterType)}
                  options={[
                    { value: "Movie", label: "Films" },
                    { value: "TV Series", label: "Séries" },
                    { value: "Documentary", label: "Documentaires" },
                  ]}
                />
                <FilterSelect
                  placeholder="Tout genre"
                  value={filterGenre}
                  onChange={setFilterGenre}
                  options={availableGenres.map((g) => ({ value: g, label: g }))}
                  searchable
                />
                <div className="field flex h-8 items-center gap-1.5 pl-3 pr-2">
                  <YearInput
                    value={yearFrom}
                    onChange={setYearFrom}
                    placeholder="1950"
                    fallback={1990}
                    label="Année minimum"
                  />
                  <span aria-hidden="true" className="text-sm text-muted">
                    à
                  </span>
                  <YearInput
                    value={yearTo}
                    onChange={setYearTo}
                    placeholder={String(new Date().getFullYear())}
                    fallback={new Date().getFullYear()}
                    label="Année maximum"
                  />
                </div>
              </div>
            )}

            {/* FR-3 : filtre par rôle, uniquement quand une filmographie de personne est présente. */}
            {roleGroups.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Chip onClick={() => setRoleFilter("")} pressed={roleFilter === ""}>
                  Tous
                </Chip>
                {roleGroups.map((g) => (
                  <Chip key={g.role} onClick={() => setRoleFilter(g.role)} pressed={roleFilter === g.role}>
                    {ROLE_GROUP_LABEL[g.role]} ({g.items.length})
                  </Chip>
                ))}
              </div>
            )}

            <div ref={scrollRef} className="mt-4 max-h-[min(34rem,58vh)] space-y-1 overflow-y-auto">
              {!query.trim() && (
                <SuggestionsGrid
                  suggestions={suggestions}
                  addingId={addingId}
                  onPick={pickSuggestion}
                  onDismiss={dismissSuggestion}
                  dismissed={dismissedSuggestion?.sug.title ?? null}
                  onUndoDismiss={() => dismissedSuggestion && undoDismissSuggestion(dismissedSuggestion)}
                />
              )}
              {searching && results.length === 0 && <p className="px-2 text-sm text-muted">Recherche…</p>}
              {!searching && query.trim() && results.length === 0 && (
                <p className="text-sm text-muted">
                  Aucun résultat : vérifie l&apos;orthographe (TMDB ne tolère pas les fautes de frappe).
                </p>
              )}
              {!searching && query.trim() && results.length > 0 && filteredResults.length === 0 && (
                <p className="text-sm text-muted">Aucun résultat avec ces filtres.</p>
              )}

              {query.trim() && roleGroups.length === 0 && sortTitleMatches(filteredResults, query).map(renderResult)}

              {query.trim() &&
                roleGroups.length > 0 &&
                visibleRoleGroups.map((g) => (
                  <div key={g.role} className="mb-3">
                    <p className="mb-1.5 text-xs text-muted">
                      {ROLE_GROUP_LABEL[g.role]} ({g.items.length})
                    </p>
                    {g.items.map(renderResult)}
                  </div>
                ))}

              {query.trim() && roleGroups.length > 0 && sortedTitleOnly.length > 0 && (
                <div className="mt-3">
                  <p className="mb-1.5 text-xs text-muted">
                    Autres résultats pour « {query.trim()} »
                  </p>
                  {visibleTitleOnly.map(renderResult)}
                  {!showAllOtherResults && sortedTitleOnly.length > OTHER_RESULTS_PREVIEW && (
                    <button
                      onClick={() => setShowAllOtherResults(true)}
                      className="link mt-1 text-xs text-muted"
                    >
                      Voir {sortedTitleOnly.length - OTHER_RESULTS_PREVIEW} de plus
                    </button>
                  )}
                </div>
              )}

              {query.trim() && page < totalPages && <div ref={sentinelRef} className="h-1" />}
              {loadingMore && <p className="text-center text-xs text-muted">Chargement…</p>}
            </div>
          </>
        )}
        </div>
        <div className="action-bar">
          <span className="flex min-w-0 items-center gap-2 truncate">
            <Logo variant="mark" title={null} className="size-4 shrink-0" />
            {qualifying ? "Qualifier l’ajout" : "Ajouter depuis TMDB"}
          </span>
          <span className="ml-auto flex items-center gap-1.5 text-muted">
            Fermer <Kbd>Échap</Kbd>
          </span>
        </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Ligne de résultat de recherche. La pastille « i » montre le synopsis au survol : c'est ce qui
 * permet de trancher entre deux titres homonymes sans rien ajouter à l'aveugle.
 */
function SearchResultRow({
  result: r,
  adding,
  disabled,
  onPick,
}: {
  result: TmdbSearchItem;
  adding: boolean;
  disabled: boolean;
  onPick: () => void;
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
    <div className="flex items-center gap-2 rounded-lg transition-colors duration-100 hover:bg-selection">
      {showSynopsis && infoEl && r.overview && (
        <SynopsisTooltip anchor={infoEl} text={r.overview} onDismiss={closeSynopsis} />
      )}

      <button
        onClick={onPick}
        disabled={disabled}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg p-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-50 sm:gap-4 sm:p-3"
      >
        {/* Affiche assez grande pour être reconnue d'un coup d'œil : c'est elle qui sert à
            identifier un titre, un timbre de 44px ne le permettait pas. Elle rétrécit sous
            `sm:` pour laisser la largeur au titre sur un téléphone. */}
        <div className="poster h-[5.5rem] w-[3.67rem] shrink-0 sm:h-32 sm:w-[5.35rem]">
          {r.posterUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={r.posterUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-2xl text-muted">🎬</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          {/* Deux lignes plutôt qu'une troncature : un titre long reste lisible. */}
          <p className="line-clamp-2 text-sm font-medium leading-snug text-foreground sm:text-base">
            {r.title}
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <MetaRow items={[r.year, r.isDocumentary ? "Documentaire" : r.type === "Movie" ? "Film" : "Série"]} />
            {r.libraryStatus && (
              <span className="badge gap-1.5 text-foreground">
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    r.libraryStatus === "Watched" ? "bg-success" : "bg-subtle"
                  }`}
                />
                Déjà ajouté · {STATUS_META[r.libraryStatus].label}
              </span>
            )}
          </div>
          {r.personCredit && (
            <p className="mt-0.5 truncate text-xs text-muted">
              {personCreditLine(r.personCredit)}
            </p>
          )}
        </div>
        <div className="shrink-0 max-[360px]:hidden">
          <ScoreBadge voteAverage={r.voteAverage} voteCount={r.voteCount} size="md" />
        </div>
      </button>

      {adding ? (
        <span className="pr-2 text-xs text-muted">Ajout…</span>
      ) : (
        r.overview !== "" && (
          <button
            ref={setInfoEl}
            type="button"
            aria-label={`Synopsis de « ${r.title} »`}
            aria-expanded={showSynopsis}
            onMouseEnter={openSynopsis}
            onMouseLeave={closeSynopsis}
            onFocus={openSynopsis}
            onBlur={closeSynopsis}
            onClick={() => (showSynopsis ? closeSynopsis() : openSynopsis())}
            className={`mr-0.5 shrink-0 rounded-full p-1.5 outline-none transition-colors duration-200 active:scale-90 focus-visible:ring-2 focus-visible:ring-focus sm:mr-1.5 sm:p-2 ${
              showSynopsis ? "bg-selection text-foreground" : "text-muted hover:text-foreground"
            }`}
          >
            <Info size={17} aria-hidden="true" />
          </button>
        )
      )}
    </div>
  );
}

type SuggestedTitle = {
  tmdbId: number;
  type: "Movie" | "TV Series";
  title: string;
  year: string | null;
  posterUrl: string | null;
  voteAverage: number | null;
  voteCount: number | null;
  isDocumentary: boolean;
  overview: string;
  seeds: string[];
};

/** Suggestions de la modale d'ajout : squelette pendant le calcul, puis grille d'affiches. */
function SuggestionsGrid({
  suggestions,
  addingId,
  onPick,
  onDismiss,
  dismissed,
  onUndoDismiss,
}: {
  suggestions: SuggestedTitle[] | null;
  addingId: number | null;
  onPick: (sug: SuggestedTitle) => void;
  onDismiss: (sug: SuggestedTitle) => void;
  /** Titre de la dernière suggestion écartée, tant qu'on peut l'annuler. */
  dismissed: string | null;
  onUndoDismiss: () => void;
}) {
  if (suggestions !== null && suggestions.length === 0 && !dismissed) return null;

  return (
    <div className="pb-2">
      <p className="eyebrow">Suggestions pour toi</p>
      <p className="mt-1 text-xs text-muted">
        Proches des titres que tu notes le mieux. Tape un titre pour chercher autre chose.
      </p>

      {dismissed && (
        <p role="status" className="mt-2 flex flex-wrap items-center gap-x-2 text-xs text-muted">
          <span className="min-w-0 truncate">
            &laquo;&nbsp;{dismissed}&nbsp;&raquo; ne sera plus proposé
          </span>
          <button
            onClick={onUndoDismiss}
            className="link font-medium text-foreground"
          >
            Annuler
          </button>
        </p>
      )}

      <div className="mt-3 grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-3">
        {suggestions === null
          ? Array.from({ length: 8 }, (_, i) => (
              <div key={i}>
                <Skeleton className="aspect-[2/3] w-full rounded-frame" />
                <Skeleton className="mt-2 h-3 w-3/4" />
              </div>
            ))
          : suggestions.map((sug) => (
              <DiscoverCard
                key={`${sug.type}-${sug.tmdbId}`}
                item={{ ...sug, libraryStatus: null }}
                pending={addingId === sug.tmdbId}
                onOpen={() => onPick(sug)}
                onAdd={() => onPick(sug)}
                onDismiss={() => onDismiss(sug)}
                footnote={
                  sug.seeds.length > 0 && (
                    <p className="mt-1 line-clamp-2 text-xs text-muted" title={`Proche de ${sug.seeds.join(", ")}`}>
                      {closeTo(sug.seeds[0])}
                    </p>
                  )
                }
              />
            ))}
      </div>
    </div>
  );
}
