"use client";

import { buttonClass } from "@/components/ui/Button";
import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  CircleAlert,
  Compass,
  LayoutGrid,
  Library,
  RefreshCw,
  Rows3,
  Sparkles,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { RecommendationRow } from "@/components/RecommendationRow";
import { DetailPanel } from "@/components/DetailPanel";
import { DiscoverCard, type DiscoverCardItem } from "@/components/DiscoverCard";
import { FilterSelect } from "@/components/FilterSelect";
import { ServicesFilter } from "@/components/ServicesFilter";
import { ServicesPicker } from "@/components/ServicesPicker";
import { useMyServices } from "@/components/useMyServices";
import { includedIn, type Availability } from "@/lib/availability";
import { CompatibilityChip } from "@/components/CompatibilityChip";
import { ItemCard } from "@/components/ItemCard";
import {
  type Category,
  type ItemPatch,
  type LibraryItem,
  type WatchStatus,
} from "@/lib/libraryItem";
import { PageHeader } from "@/components/PageHeader";
import { CatalogLayout } from "@/components/layouts";
import { EmptyState, Toolbar } from "@/components/sections";
import { Button, MonoMeta, Skeleton, Toast } from "@/components/ui";
import { TasteProfile } from "@/components/TasteProfile";
import { FlipGrid } from "@/components/motion/FlipGrid";
import { genreLabel } from "@/lib/genres";
import { ofTitle } from "@/lib/format";

type AffinityEntry = { name: string; affinity: number; count: number };

type RecommendedItem = LibraryItem & {
  recommendationScore: number;
  /** Titres notés au moins ⭐⭐⭐⭐ qui ressemblent à celui-ci (FR-25). */
  neighbours: { id: number; name: string; stars: number }[];
  /** Placé là pour sortir de tes habitudes (FR-31). */
  exploration: boolean;
  /** Score de recommandation : probabilité que tu le notes ⭐⭐⭐⭐ ou plus. */
  compatibility: number | null;
};

/** FR-15 : deux sources, deux onglets, jamais mélangées dans une même grille. */
type Source = "library" | "discover";

type DiscoveredItem = DiscoverCardItem & {
  seeds: string[];
  compatibility: number | null;
  /** Renseigné dès l'ajout : les découvertes arrivent forcément hors bibliothèque (FR-18). */
  libraryId: number | null;
  availability: Availability | null;
};

type DiscoveryResponse =
  | {
      items: Omit<DiscoveredItem, "libraryStatus">[];
      seedsUsed: string[];
      /** sorties-v1 FR-7 : rangées expliquées, par clé « type:tmdbId ». */
      rows?: { key: string; title: string; keys: string[]; anchor?: string }[];
    }
  | { error: "not_enough_signal" };

type RecommendationsResponse =
  | {
      items: RecommendedItem[];
      total: number;
      profile: {
        genres: AffinityEntry[];
        directors: AffinityEntry[];
        ratedCount: number;
        compatibilityBaseRate: number | null;
      };
    }
  | { error: "not_enough_signal"; ratedCount: number };

/** Mêmes paliers de densité que la bibliothèque : les deux grilles se règlent pareil. */
const CARD_SIZE_LEVELS = [
  { min: 104, label: "Très dense" },
  { min: 124, label: "Dense" },
  { min: 148, label: "Normale" },
  { min: 184, label: "Grande" },
  { min: 232, label: "Très grande" },
] as const;
const CARD_SIZE_STORAGE_KEY = "watchlist:cardSizeIndex";

/** Traduction des genres TMDB, qui arrivent en anglais dans la base. */
/** Tri-rapide FR-8 et FR-2 : ce que la boucle d'apprentissage a mesuré. */
type Feedback = {
  acceptance: { decided: number; keptRate: number | null; seen: number; lovedRate: number | null };
  dismissed: number;
};

/** Durée pendant laquelle un écartement peut être annulé depuis le toast. */
const DISMISS_UNDO_MS = 8000;

type RowsResponse =
  | { rows: { key: string; title: string; items: RecommendedItem[]; anchor?: string }[]; total: number }
  | { error: "not_enough_signal"; ratedCount: number };

/** FR-32 : deux lectures de la même liste — des rangées expliquées, ou le classement complet. */
type PileView = "rows" | "grid";
const PILE_VIEW_STORAGE_KEY = "watchlist:pileView";

export default function RecommendationsPage() {
  const [data, setData] = useState<RecommendationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [category, setCategory] = useState<"" | Category>("");
  const [genre, setGenre] = useState("");
  const [genres, setGenres] = useState<string[]>([]);
  const [selected, setSelected] = useState<LibraryItem | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [pileView, setPileView] = useState<PileView>("rows");
  const [rows, setRows] = useState<RowsResponse | null>(null);
  const [source, setSource] = useState<Source>("library");
  const [discovery, setDiscovery] = useState<DiscoveryResponse | null>(null);
  const [discovered, setDiscovered] = useState<DiscoveredItem[]>([]);
  const [loadingDiscovery, setLoadingDiscovery] = useState(false);
  const [addingId, setAddingId] = useState<number | null>(null);
  const [addError, setAddError] = useState<string | null>(null);
  // Disponibilité streaming (spec disponibilite-streaming-v1 FR-5), partagée par les deux onglets.
  const services = useMyServices();
  const [onMyServices, setOnMyServices] = useState(false);
  const [showServicesPicker, setShowServicesPicker] = useState(false);
  const [cardSizeIndex, setCardSizeIndex] = useState(2);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [undoable, setUndoable] = useState<{ label: string; undo: () => Promise<void> } | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Même réglage de densité que la bibliothèque, partagé via localStorage : régler d'un côté
  // règle de l'autre, l'app garde une seule idée de "ma taille de cartes".
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(CARD_SIZE_STORAGE_KEY);
      if (stored === null) return;
      const parsed = Number(stored);
      if (!Number.isNaN(parsed) && parsed >= 0 && parsed < CARD_SIZE_LEVELS.length) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setCardSizeIndex(parsed);
      }
    } catch {
      // localStorage indisponible : on garde la taille par défaut.
    }
  }, []);

  function updateCardSize(next: number) {
    setCardSizeIndex(next);
    try {
      window.localStorage.setItem(CARD_SIZE_STORAGE_KEY, String(next));
    } catch {
      // pas grave, juste pas persisté.
    }
  }

  useEffect(() => {
    fetch("/api/genres")
      .then((r) => r.json())
      .then((body: { genres: string[] }) => setGenres(body.genres));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (genre) params.set("genre", genre);
    if (onMyServices) params.set("onMyServices", "1");

    const res = await fetch(`/api/recommendations?${params}`);
    setData(await res.json());
    setLoading(false);
  }, [category, genre, onMyServices]);

  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(PILE_VIEW_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (stored === "rows" || stored === "grid") setPileView(stored);
    } catch {
      // localStorage indisponible : vue par défaut.
    }
  }, []);

  function choosePileView(next: PileView) {
    setPileView(next);
    try {
      window.localStorage.setItem(PILE_VIEW_STORAGE_KEY, next);
    } catch {
      // pas grave, juste pas mémorisé.
    }
  }

  const loadRows = useCallback(async () => {
    const params = new URLSearchParams();
    if (category) params.set("category", category);
    if (genre) params.set("genre", genre);
    if (onMyServices) params.set("onMyServices", "1");
    const res = await fetch(`/api/recommendations/rows?${params}`);
    setRows(await res.json());
  }, [category, genre, onMyServices]);

  // Même schéma que les autres chargements : l'écriture d'état a lieu après l'await.
  useEffect(() => {
    if (source !== "library" || pileView !== "rows") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadRows();
  }, [source, pileView, loadRows]);

  const loadDiscovery = useCallback(async () => {
    setLoadingDiscovery(true);
    setAddError(null);
    // Assez de titres pour des rangées (sorties-v1 FR-7) ; la grille les montre tous.
    const params = new URLSearchParams({ limit: "72", rows: "1" });
    if (category) params.set("category", category);
    if (onMyServices) params.set("onMyServices", "1");

    const res = await fetch(`/api/recommendations/discover?${params}`);
    const body: DiscoveryResponse = await res.json();
    setDiscovery(body);
    setDiscovered(
      "items" in body
        ? body.items.map((item) => ({ ...item, libraryStatus: null, libraryId: null }))
        : []
    );
    setLoadingDiscovery(false);
  }, [category, onMyServices]);

  // Rechargement à chaque changement de filtre (même schéma que la bibliothèque) : `load` passe
  // l'état en "chargement" avant son await, ce que la règle voit comme un setState d'effet.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // L'onglet découverte appelle TMDB : on ne le charge qu'une fois ouvert, puis à chaque
  // changement de catégorie.
  useEffect(() => {
    if (source !== "discover") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadDiscovery();
  }, [source, loadDiscovery]);

  /** FR-21 : seule action d'un titre découvert — l'ajouter (POST idempotent existant). */
  async function addDiscovered(item: DiscoveredItem) {
    setAddingId(item.tmdbId);
    setAddError(null);
    try {
      const res = await fetch("/api/items", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // tri-rapide FR-8 : un ajout depuis la découverte compte comme proposition gardée.
        body: JSON.stringify({ tmdbId: item.tmdbId, type: item.type, source: "discover" }),
      });
      const body = await res.json();

      if (!res.ok) {
        setAddError("Échec de l'ajout, réessaie.");
        return;
      }

      const status: WatchStatus = body.item.watchStatus ?? "Unwatched";
      setDiscovered((prev) =>
        prev.map((d) =>
          d.tmdbId === item.tmdbId ? { ...d, libraryStatus: status, libraryId: body.item.id } : d
        )
      );
    } finally {
      setAddingId(null);
    }
  }

  /**
   * Retrait depuis la découverte : même flux que le tirage et la bibliothèque (suppression du
   * titre). Utile juste après un ajout qu'on regrette, sans avoir
   * à passer par la bibliothèque. Le titre reste affiché, il repasse simplement à « + ».
   */
  async function removeDiscovered(item: DiscoveredItem) {
    if (item.libraryId === null) return;

    setAddingId(item.tmdbId);
    setAddError(null);
    try {
      const res = await fetch(`/api/items/${item.libraryId}`, { method: "DELETE" });
      if (!res.ok) {
        setAddError("Échec du retrait, réessaie.");
        return;
      }

      setDiscovered((prev) =>
        prev.map((d) =>
          d.tmdbId === item.tmdbId ? { ...d, libraryStatus: null, libraryId: null } : d
        )
      );
    } finally {
      setAddingId(null);
    }
  }

  /** Noter ou marquer vu depuis une carte : même endpoint et mêmes règles que la bibliothèque. */
  async function patchItem(id: number, patch: ItemPatch) {
    const res = await fetch(`/api/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const updated: LibraryItem = await res.json();
    applyUpdate(id, updated);
  }

  async function loadOverview(id: number) {
    const res = await fetch(`/api/items/${id}`);
    if (!res.ok) return;
    const updated: LibraryItem = await res.json();
    applyUpdate(id, updated);
  }

  async function refetchItem(id: number) {
    const res = await fetch(`/api/items/${id}?refresh=1`);
    if (!res.ok) return;
    const updated: LibraryItem = await res.json();
    applyUpdate(id, updated);
  }

  /**
   * Un item qui passe à "Vu" n'a plus rien à faire dans des recommandations (elles ne portent
   * que sur la pile à voir) : on le retire de la liste plutôt que d'attendre un rechargement.
   */
  function applyUpdate(id: number, updated: LibraryItem) {
    if (updated.watchStatus === "Watched") {
      dropCandidate(id);
      return;
    }
    const merge = (item: RecommendedItem) => (item.id === id ? { ...item, ...updated } : item);
    setData((prev) => (!prev || "error" in prev ? prev : { ...prev, items: prev.items.map(merge) }));
    setRows((prev) =>
      !prev || "error" in prev
        ? prev
        : { ...prev, rows: prev.rows.map((row) => ({ ...row, items: row.items.map(merge) })) }
    );
    setSelected((prev) => (prev && prev.id === id ? { ...prev, ...updated } : prev));
  }

  /** Retire un titre des deux lectures de la pile (grille et rangées), sans recharger. */
  function dropCandidate(id: number) {
    setData((prev) =>
      !prev || "error" in prev
        ? prev
        : { ...prev, items: prev.items.filter((item) => item.id !== id), total: prev.total - 1 }
    );
    setRows((prev) =>
      !prev || "error" in prev
        ? prev
        : {
            ...prev,
            total: prev.total - 1,
            rows: prev.rows.map((row) => ({ ...row, items: row.items.filter((item) => item.id !== id) })),
          }
    );
    setSelected((prev) => (prev && prev.id === id ? null : prev));
  }

  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
    };
  }, []);

  function offerUndo(label: string, undo: () => Promise<void>) {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoable({ label, undo });
    undoTimer.current = setTimeout(() => setUndoable(null), DISMISS_UNDO_MS);
  }

  async function runUndo() {
    if (!undoable) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoable(null);
    await undoable.undo();
  }

  /** Écrit un écartement (ou son annulation) ; tient le compteur du profil à jour. */
  async function sendDismissal(method: "POST" | "DELETE", subject: Record<string, unknown>) {
    const res = await fetch("/api/dismissals", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ subject }),
    }).catch(() => null);
    if (!res?.ok) return false;
    const body: { count: number } = await res.json();
    setFeedback((prev) => (prev ? { ...prev, dismissed: body.count } : prev));
    return true;
  }

  /** Tri-rapide FR-2 : le titre quitte les recommandations, pas ta bibliothèque. */
  async function dismissCandidate(item: RecommendedItem) {
    dropCandidate(item.id);
    const subject = { type: "item", id: item.id };
    if (!(await sendDismissal("POST", subject))) {
      load();
      if (pileView === "rows") loadRows();
      return;
    }
    offerUndo(item.name, async () => {
      await sendDismissal("DELETE", subject);
      // Le classement est déterministe : recharger le remet exactement à sa place.
      load();
      if (pileView === "rows") loadRows();
    });
  }

  /** Tri-rapide FR-2 : une découverte écartée ne revient plus, ni ici ni dans les suggestions. */
  async function dismissDiscovered(item: DiscoveredItem) {
    const index = discovered.findIndex((d) => d.tmdbId === item.tmdbId && d.type === item.type);
    const reinsert = () =>
      setDiscovered((prev) =>
        prev.some((d) => d.tmdbId === item.tmdbId && d.type === item.type)
          ? prev
          : [...prev.slice(0, index), item, ...prev.slice(index)]
      );
    setDiscovered((prev) => prev.filter((d) => !(d.tmdbId === item.tmdbId && d.type === item.type)));

    const subject = { type: "tmdb", mediaType: item.type, tmdbId: item.tmdbId };
    if (!(await sendDismissal("POST", subject))) {
      reinsert();
      return;
    }
    offerUndo(item.title, async () => {
      await sendDismissal("DELETE", subject);
      reinsert();
    });
  }

  // FR-8 : mesuré à l'ouverture du profil, pas avant (rien ne l'affiche tant qu'il est replié).
  useEffect(() => {
    if (!showProfile) return;
    let cancelled = false;
    fetch("/api/profile/feedback")
      .then((r) => r.json())
      .then((body: Feedback) => {
        if (!cancelled) setFeedback(body);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [showProfile]);

  async function restoreAllDismissals() {
    const res = await fetch("/api/dismissals", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ all: true }),
    }).catch(() => null);
    if (!res?.ok) return;
    setFeedback((prev) => (prev ? { ...prev, dismissed: 0 } : prev));
    load();
    if (pileView === "rows") loadRows();
  }

  /** `anchor` : le titre aimé qui explique la rangée ; la carte ne le répète pas. */
  function renderDiscoverCard(item: DiscoveredItem, anchor?: string) {
    return (
      <DiscoverCard
        item={item}
        pending={addingId === item.tmdbId}
        onAdd={() => addDiscovered(item)}
        onRemove={() => removeDiscovered(item)}
        onDismiss={() => dismissDiscovered(item)}
        footnote={<SeedTrail seeds={item.seeds} compatibility={item.compatibility} omit={anchor} />}
        hideScore={item.compatibility !== null}
        includedOn={includedIn(item.availability, services.covered)}
      />
    );
  }

  const profile = data && !("error" in data) ? data.profile : null;
  const items = data && !("error" in data) ? data.items : [];
  const total = data && !("error" in data) ? data.total : 0;
  const activeFilters = (category !== "" ? 1 : 0) + (genre !== "" ? 1 : 0) + (onMyServices ? 1 : 0);

  return (
    <CatalogLayout surface={source === "library" ? "pile" : "discover"}>
      <PageHeader
        title="Recommandations"
        lead={source === "library" ? "Ta pile, dans le bon ordre." : "Ce que tu ne connais pas encore."}
        description={
          source === "library"
            ? "Les titres de ta pile « à voir », classés d'après tes notes. Le classement se met à jour tout seul."
            : "Des titres hors de ta bibliothèque, à partir de ceux que tu as le mieux notés."
        }
        actions={
          <>
            {/* FR-15 : les deux sources sont explicites, pas devinées. */}
            <div role="tablist" aria-label="Source des recommandations" className="segmented">
              {(
                [
                  { value: "library", label: "Ma pile à voir", icon: Library },
                  { value: "discover", label: "À découvrir", icon: Compass },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.value}
                    role="tab"
                    aria-selected={source === tab.value}
                    onClick={() => setSource(tab.value)}
                    className="segmented-item"
                  >
                    <Icon size={14} aria-hidden="true" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
            {source === "discover" && (
              <Button onClick={loadDiscovery} loading={loadingDiscovery}>
                {!loadingDiscovery && <RefreshCw size={13} aria-hidden="true" />}
                Autres suggestions
              </Button>
            )}
          </>
        }
      />

      {source === "library" && data && "error" in data && (
        <div className="card mt-6">
          <EmptyState
            icon={<Sparkles size={20} aria-hidden="true" />}
            title="Encore quelques notes, et les recommandations arrivent"
            action={
              <Button href="/library" variant="primary">
                Noter des titres
              </Button>
            }
          >
            Le classement apprend de tes notes : il en faut au moins 10 sur des titres vus
            {data.ratedCount > 0 && ` (tu en as ${data.ratedCount})`}. En dessous, tout classement ne serait que
            du bruit.
          </EmptyState>
        </div>
      )}

      {source === "library" && profile && (
        <>
          <TasteProfile
            ratedCount={profile.ratedCount}
            genres={profile.genres}
            directors={profile.directors}
            compatibilityBaseRate={profile.compatibilityBaseRate}
            feedback={feedback}
            open={showProfile}
            onToggle={() => setShowProfile((v) => !v)}
            onRestoreAll={restoreAllDismissals}
            genreLabel={genreLabel}
          />

          <Toolbar
            className="mt-4"
            start={
              <>
            <FilterSelect
              placeholder="Tout type"
              value={category}
              onChange={(v) => setCategory(v as "" | Category)}
              options={[
                { value: "Movie", label: "Films" },
                { value: "TV Series", label: "Séries" },
                { value: "Documentary", label: "Documentaires" },
              ]}
            />
            <FilterSelect
              placeholder="Tout genre"
              value={genre}
              onChange={setGenre}
              options={genres.map((g) => ({ value: g, label: genreLabel(g) }))}
              searchable
            />
            <ServicesFilter
              active={onMyServices}
              subscriptionCount={services.subscriptionIds.length}
              onToggle={setOnMyServices}
              onOpenPicker={() => setShowServicesPicker(true)}
            />
              </>
            }
          />

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-3 text-xs text-muted">
            <ViewToggle value={pileView} onChange={choosePileView} />

            <MonoMeta>
              {pileView === "grid"
                ? `${items.length.toLocaleString("fr-FR")} proposition${items.length > 1 ? "s" : ""}${
                    total > items.length ? ` sur ${total.toLocaleString("fr-FR")} titres à voir` : ""
                  }`
                : `${total.toLocaleString("fr-FR")} titres à voir`}
            </MonoMeta>

            <div className={`ml-auto flex items-center gap-1.5 ${pileView === "rows" ? "hidden" : ""}`}>
              <button
                onClick={() => updateCardSize(Math.max(0, cardSizeIndex - 1))}
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
                  updateCardSize(Math.min(CARD_SIZE_LEVELS.length - 1, cardSizeIndex + 1))
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
        </>
      )}

      {source === "library" && loading && items.length === 0 && !data && (
        <div
          data-stagger
          className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(var(--card-min),1fr))] gap-3 sm:gap-4"
          style={{ "--card-min": `${CARD_SIZE_LEVELS[cardSizeIndex].min}px` } as CSSProperties}
        >
          {Array.from({ length: 12 }, (_, i) => (
            <div key={i}>
              <Skeleton className="aspect-[2/3] w-full rounded-frame" />
              <Skeleton className="mt-2 h-3 w-3/4" />
            </div>
          ))}
        </div>
      )}

      {source === "library" && data && !("error" in data) && items.length === 0 && !loading && (
        <EmptyState
          className="mt-6"
          icon={<Library size={20} aria-hidden="true" />}
          title={activeFilters > 0 ? "Aucune proposition avec ces filtres" : "Ta pile « à voir » est vide"}
          action={
            activeFilters > 0 ? (
              <Button
                size="sm"
                onClick={() => {
                  setCategory("");
                  setGenre("");
                  setOnMyServices(false);
                }}
              >
                Réinitialiser les filtres
              </Button>
            ) : (
              <Button size="sm" variant="primary" href="/library?ajouter=1">
                Ajouter des titres
              </Button>
            )
          }
        >
          {activeFilters > 0 ? "Élargis les filtres pour retrouver des propositions." : "Ajoute des titres à voir pour recevoir des propositions."}
        </EmptyState>
      )}

      {source === "library" && pileView === "grid" && items.length > 0 && (
        <FlipGrid
          stagger
          className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(var(--card-min),1fr))] gap-3 sm:gap-4"
          style={{ "--card-min": `${CARD_SIZE_LEVELS[cardSizeIndex].min}px` } as CSSProperties}
        >
          {items.map((item, index) => (
            <ItemCard
              key={item.id}
              item={item}
              onOpen={() => setSelected(item)}
              onQuickChange={patchItem}
              onDismiss={() => dismissCandidate(item)}
              onLoadOverview={loadOverview}
              footnote={
                item.exploration ? (
                  <ExplorationTag compatibility={item.compatibility} />
                ) : (
                  <NeighbourTrail
                    neighbours={item.neighbours}
                    rank={index + 1}
                    compatibility={item.compatibility}
                  />
                )
              }
              includedOn={includedIn(item.availability, services.covered)}
              showTrailer
              quietStatus
            />
          ))}
        </FlipGrid>
      )}

      {source === "library" && pileView === "rows" && profile && (
        <div className="mt-2">
          {rows === null &&
            Array.from({ length: 3 }, (_, r) => (
              <div key={r} className="mt-8" aria-busy="true">
                <Skeleton className="h-4 w-48" />
                <div className="mt-3 flex gap-3 overflow-hidden">
                  {Array.from({ length: 7 }, (_, i) => (
                    <Skeleton key={i} className="aspect-[2/3] w-[9.5rem] shrink-0 rounded-frame sm:w-[10.5rem]" />
                  ))}
                </div>
              </div>
            ))}

          {rows &&
            !("error" in rows) &&
            rows.rows
              .filter((row) => row.items.length > 0)
              .map((row) => (
                <RecommendationRow key={row.key} title={row.title}>
                  {row.items.map((item) => (
                    <div key={item.id} className="w-[9.5rem] shrink-0 snap-start sm:w-[10.5rem]">
                      <ItemCard
                        item={item}
                        onOpen={() => setSelected(item)}
                        onQuickChange={patchItem}
                        onDismiss={() => dismissCandidate(item)}
                        onLoadOverview={loadOverview}
                        footnote={
                          item.exploration ? (
                            <ExplorationTag compatibility={item.compatibility} />
                          ) : (
                            <NeighbourTrail
                              neighbours={item.neighbours}
                              compatibility={item.compatibility}
                              omit={row.anchor}
                            />
                          )
                        }
                        includedOn={includedIn(item.availability, services.covered)}
                        showTrailer
                        quietStatus
                      />
                    </div>
                  ))}
                </RecommendationRow>
              ))}
        </div>
      )}

      {source === "discover" && (
        <>
          {/* Même filtre de catégorie que l'autre source ; pas de filtre par genre ici :
              ce sont les semences, pas un genre, qui définissent le périmètre (FR-20). */}
          <Toolbar
            className="mt-5"
            start={
              <>
                <FilterSelect
                  placeholder="Tout type"
                  value={category}
                  onChange={(v) => setCategory(v as "" | Category)}
                  options={[
                    { value: "Movie", label: "Films" },
                    { value: "TV Series", label: "Séries" },
                    { value: "Documentary", label: "Documentaires" },
                  ]}
                />
                <ServicesFilter
                  active={onMyServices}
                  subscriptionCount={services.subscriptionIds.length}
                  onToggle={setOnMyServices}
                  onOpenPicker={() => setShowServicesPicker(true)}
                />
              </>
            }
          />

          {discovery && "error" in discovery && (
            <div className="card mt-6">
              <EmptyState
                icon={<Compass size={20} aria-hidden="true" />}
                title="Aucun titre ne peut encore servir de point de départ"
                action={
                  <Button href="/tri?famille=seen" variant="primary">
                    Noter des titres vus
                  </Button>
                }
              >
                La découverte part de tes titres vus notés 4 étoiles ou plus. Il en faut au moins un pour aller
                chercher des titres proches.
              </EmptyState>
            </div>
          )}

          {discovery && "items" in discovery && (
            <div className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-3 text-xs text-muted">
              <span className="min-w-0">
                À partir de {discovery.seedsUsed.slice(0, 3).join(", ")}
                {discovery.seedsUsed.length > 3 &&
                  ` et ${discovery.seedsUsed.length - 3} autre${
                    discovery.seedsUsed.length - 3 > 1 ? "s" : ""
                  }`}
              </span>
            </div>
          )}

          {discovery && "items" in discovery && discovered.length > 0 && (
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-3 text-xs text-muted">
              <ViewToggle value={pileView} onChange={choosePileView} />
              <MonoMeta>
                {discovered.length} titre{discovered.length > 1 ? "s" : ""} à découvrir
              </MonoMeta>
            </div>
          )}

          {addError && (
            <p role="alert" className="mt-3 flex items-center gap-2 text-sm text-foreground">
              <CircleAlert size={14} aria-hidden="true" className="shrink-0 text-muted" />
              {addError}
            </p>
          )}

          {/* Squelette à l'image de la vue choisie : des rangées, ou une grille. */}
          {loadingDiscovery && discovered.length === 0 && pileView === "rows" && (
            <div className="mt-2" aria-busy="true">
              {Array.from({ length: 2 }, (_, r) => (
                <div key={r} className="mt-8">
                  <Skeleton className="h-4 w-48" />
                  <div className="mt-3 flex gap-3 overflow-hidden">
                    {Array.from({ length: 7 }, (_, i) => (
                      <Skeleton key={i} className="aspect-[2/3] w-[9.5rem] shrink-0 rounded-frame sm:w-[10.5rem]" />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {loadingDiscovery && discovered.length === 0 && pileView === "grid" && (
            <div
              data-stagger
          className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(var(--card-min),1fr))] gap-3 sm:gap-4"
              style={{ "--card-min": `${CARD_SIZE_LEVELS[cardSizeIndex].min}px` } as CSSProperties}
            >
              {Array.from({ length: 10 }, (_, i) => (
                <div key={i}>
                  <Skeleton className="aspect-[2/3] w-full rounded-frame" />
                  <Skeleton className="mt-2 h-3 w-3/4" />
                </div>
              ))}
            </div>
          )}

          {!loadingDiscovery && discovery && "items" in discovery && discovered.length === 0 && (
            <EmptyState
              className="mt-6"
              icon={<Compass size={20} aria-hidden="true" />}
              title="Rien de neuf à proposer avec ce filtre"
            >
              Les titres proches sont déjà tous dans ta bibliothèque.
            </EmptyState>
          )}

          {/* sorties-v1 FR-7 : « Pour toi » en rangées, comme la pile. Les rangées pointent
              vers la liste : ajouter, retirer ou écarter y agit partout à la fois. */}
          {discovered.length > 0 && pileView === "rows" && discovery && "items" in discovery && (
            <div className="mt-2">
              {(discovery.rows ?? []).map((row) => {
                const byKey = new Map(discovered.map((d) => [`${d.type}:${d.tmdbId}`, d]));
                const rowItems = row.keys.map((key) => byKey.get(key)).filter((d): d is DiscoveredItem => !!d);
                if (rowItems.length === 0) return null;
                return (
                  <RecommendationRow key={row.key} title={row.title}>
                    {rowItems.map((item) => (
                      <div key={`${item.type}-${item.tmdbId}`} className="w-[9.5rem] shrink-0 snap-start sm:w-[10.5rem]">
                        {renderDiscoverCard(item, row.anchor)}
                      </div>
                    ))}
                  </RecommendationRow>
                );
              })}
            </div>
          )}

          {discovered.length > 0 && pileView === "grid" && (
            <FlipGrid
              stagger
          className="mt-6 grid grid-cols-[repeat(auto-fill,minmax(var(--card-min),1fr))] gap-3 sm:gap-4"
              style={{ "--card-min": `${CARD_SIZE_LEVELS[cardSizeIndex].min}px` } as CSSProperties}
            >
              {discovered.map((item) => (
                <div key={`${item.type}-${item.tmdbId}`} data-flip-id={`${item.type}-${item.tmdbId}`}>
                  {renderDiscoverCard(item)}
                </div>
              ))}
            </FlipGrid>
          )}
        </>
      )}

      {selected && (
        <DetailPanel
          key={selected.id}
          item={selected}
          onClose={() => setSelected(null)}
          onChange={patchItem}
          onLoadOverview={loadOverview}
          onRefetch={refetchItem}
          covered={services.covered}
        />
      )}

      {undoable && (
        <Toast action="Annuler" onAction={runUndo}>
          <span className="block max-w-[60vw] truncate">&laquo;&nbsp;{undoable.label}&nbsp;&raquo; ne sera plus proposé</span>
        </Toast>
      )}

      {showServicesPicker && (
        <ServicesPicker
          catalog={services.catalog}
          selected={services.subscriptionIds}
          onSave={async (ids) => {
            const firstChoice = services.subscriptionIds.length === 0;
            await services.save(ids);
            if (firstChoice && ids.length > 0) setOnMyServices(true);
          }}
          onClose={() => setShowServicesPicker(false)}
        />
      )}
    </CatalogLayout>
  );
}

/** FR-32 et sorties-v1 FR-7 : deux lectures d'une même liste, partagées par les deux onglets. */
function ViewToggle({ value, onChange }: { value: PileView; onChange: (next: PileView) => void }) {
  return (
    <div
      role="radiogroup"
      aria-label="Présentation"
      className="segmented"
    >
      {(
        [
          { value: "rows", label: "Pour toi", icon: Rows3 },
          { value: "grid", label: "Classement", icon: LayoutGrid },
        ] as const
      ).map((option) => {
        const Icon = option.icon;
        const active = value === option.value;
        return (
          <button
            key={option.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(option.value)}
            className="segmented-item"
          >
            <Icon size={13} aria-hidden="true" />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

/** FR-25 : pourquoi ce titre est proposé — les titres que tu as aimés et qui lui ressemblent. */
function NeighbourTrail({
  neighbours,
  rank,
  compatibility,
  omit,
}: {
  neighbours: { id: number; name: string; stars: number }[];
  /** Position dans le classement ; absent dans les rangées, où il ne veut rien dire. */
  rank?: number;
  /** Score de recommandation ; quand il est là, il remplace le rang (l'ordre le montre déjà). */
  compatibility: number | null;
  /** Le titre aimé que la rangée nomme déjà : la carte n'en parle pas. */
  omit?: string;
}) {
  const named = neighbours.filter((n) => n.name !== omit);
  const [first, ...others] = named;

  return (
    <div className="mt-1.5 flex min-w-0 flex-col items-start gap-1">
      <CompatibilityChip value={compatibility} />
      {compatibility === null && rank !== undefined && (
        <span
          className="badge"
          title={`${rank}e proposition`}
        >
          #{rank}
        </span>
      )}
      {first ? (
        <span className="min-w-0 line-clamp-2 text-xs text-muted" title={`Proche de ${named.map((n) => n.name).join(", ")}`}>
          Proche {ofTitle(first.name).article} <span className="text-foreground">{ofTitle(first.name).title}</span>
          {others.length > 0 && ` +${others.length}`}
        </span>
      ) : (
        !omit && <span className="text-xs text-muted">Très bien noté</span>
      )}
    </div>
  );
}

/** FR-17 : d'où vient ce titre — l'intérêt de cette source est de pouvoir le nommer. */
function SeedTrail({ seeds: all, compatibility, omit }: { seeds: string[]; compatibility: number | null; omit?: string }) {
  // La rangée qui nomme déjà la semence : la carte n'en parle pas.
  const seeds = all.filter((s) => s !== omit);
  if (seeds.length === 0 && compatibility === null) return null;

  return (
    <div className="mt-1.5 flex min-w-0 flex-col items-start gap-1">
      <CompatibilityChip value={compatibility} />
      {seeds.length > 0 && (
        <span className="min-w-0 line-clamp-2 text-xs text-muted" title={`Proche de ${seeds.join(", ")}`}>
          Proche {ofTitle(seeds[0]).article} <span className="text-foreground">{ofTitle(seeds[0]).title}</span>
          {seeds.length > 1 && ` +${seeds.length - 1}`}
        </span>
      )}
    </div>
  );
}

/** FR-31 : un titre placé exprès hors de tes habitudes le dit, pour que l'écart soit lisible. */
function ExplorationTag({ compatibility }: { compatibility: number | null }) {
  return (
    <div className="mt-1.5 flex min-w-0 flex-col items-start gap-1">
      <CompatibilityChip value={compatibility} />
      <p className="flex min-w-0 items-start gap-1 text-xs text-muted">
        <Compass size={11} className="mt-0.5 shrink-0" aria-hidden="true" />
        <span className="line-clamp-2">Pour sortir de tes habitudes</span>
      </p>
    </div>
  );
}
