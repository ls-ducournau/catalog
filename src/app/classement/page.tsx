"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  Camera,
  ChevronDown,
  Clapperboard,
  Film,
  LayoutGrid,
  Layers,
  RotateCcw,
  Scale,
  Star,
  ThumbsDown,
  ThumbsUp,
  Tv,
  UsersRound,
  X,
  type LucideIcon,
} from "lucide-react";
import { CatalogLayout } from "@/components/layouts";
import { EmptyState, MediaGrid, PageHeader, SectionHeading, Toolbar } from "@/components/sections";
import {
  Avatar,
  Button,
  buttonClass,
  Card,
  Chip,
  ConfirmDialog,
  Eyebrow,
  MetaRow,
  Skeleton,
  StarCount,
  StarIcon,
  StarRow,
  Tabs,
  Toast,
} from "@/components/ui";
import { DetailPanel } from "@/components/DetailPanel";
import { ROLE_ICON, ROLE_ORDER, ROLE_PLURAL, RoleBadges } from "@/components/PersonRoles";
import type { PersonRole } from "@/lib/personCredits";
import { useMyServices } from "@/components/useMyServices";
import type { Category, ItemPatch, LibraryItem } from "@/lib/libraryItem";
import type { PersonView } from "@/lib/peopleService";
import type { OpinionRow } from "@/lib/personOpinionService";
import type { RankedItem, Ranking, Tier } from "@/lib/tierDuelService";

// Classement par étoiles et personnes — spec: specs/classement-v1.md (FR-2, FR-3, FR-6)
// Archétype Catalog (le Store de Raycast) — spec: specs/design-system-v2-raycast.md § 7.

type View = "titles" | "people";
type RankCategory = "" | Category;

const VIEWS: { value: View; label: string; icon: LucideIcon }[] = [
  { value: "titles", label: "Titres", icon: Film },
  { value: "people", label: "Personnes", icon: UsersRound },
];

const CATEGORIES: { value: RankCategory; label: string; icon: LucideIcon }[] = [
  { value: "", label: "Tout", icon: LayoutGrid },
  { value: "Movie", label: "Films", icon: Clapperboard },
  { value: "TV Series", label: "Séries", icon: Tv },
  { value: "Documentary", label: "Documentaires", icon: Camera },
];

const VIEW_STORAGE_KEY = "watchlist:rankingView";
const CATEGORY_STORAGE_KEY = "watchlist:rankingCategory";
/** Au-delà, un palier se replie : 251 affiches d'un coup noieraient la page. */
const TIER_PREVIEW = 18;
/** Grille d'affiches du Store : colonnes de 104 px au moins. */
const POSTER_GRID = "grid grid-cols-[repeat(auto-fill,minmax(104px,1fr))] gap-x-3 gap-y-6";

/** Nom lu par un lecteur d'écran, à la place des symboles. */
function tierName(stars: number): string {
  return stars === 0 ? "Palier 💩" : `${stars} étoile${stars > 1 ? "s" : ""}`;
}

/** Emplacements de la barre d'outils où chaque vue pose ses propres commandes. */
type ToolbarSlots = { start: HTMLElement | null; end: HTMLElement | null };

function Slot({ into, children }: { into: HTMLElement | null; children: ReactNode }) {
  return into ? createPortal(children, into) : null;
}

export default function ClassementPage() {
  const [view, setView] = useState<View>("titles");
  const [category, setCategory] = useState<RankCategory>("");
  const [ready, setReady] = useState(false);
  // La barre d'outils reste montée d'une vue à l'autre, pour que la pastille « Que classer »
  // glisse (AC-1.2) ; chaque vue y pose ses filtres et ses actions par un portail.
  const [startSlot, setStartSlot] = useState<HTMLDivElement | null>(null);
  const [endSlot, setEndSlot] = useState<HTMLDivElement | null>(null);
  const slots: ToolbarSlots = { start: startSlot, end: endSlot };

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const storedView = params.get("vue") === "personnes" ? "people" : window.localStorage.getItem(VIEW_STORAGE_KEY);
      // Un lien vers un palier (#palier-4) veut dire la vue Titres.
      const wantsTier = window.location.hash.startsWith("#palier-");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (!wantsTier && (storedView === "titles" || storedView === "people")) setView(storedView);
      const storedCategory = window.localStorage.getItem(CATEGORY_STORAGE_KEY);
      if (storedCategory !== null && CATEGORIES.some((c) => c.value === storedCategory)) {
        setCategory(storedCategory as RankCategory);
      }
    } catch {
      // localStorage indisponible : valeurs par défaut.
    }
    setReady(true);
  }, []);

  function remember(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      // pas grave, juste pas mémorisé.
    }
  }

  return (
    <CatalogLayout>
      <PageHeader
        title="Classement"
        lead={view === "titles" ? "Du meilleur au moins bon." : "Les personnes qui comptent."}
        description={
          view === "titles"
            ? "Tes titres vus, rangés par ta note. Dans chaque palier, les duels de départage ordonnent ceux qui ont la même note."
            : "Les personnes sur lesquelles tu as donné ton avis. Elles pèsent un peu sur tes recommandations."
        }
      />

      <Toolbar
        start={
          <>
            <Tabs
              label="Que classer"
              options={VIEWS}
              value={view}
              onChange={(next) => {
                setView(next);
                remember(VIEW_STORAGE_KEY, next);
              }}
            />
            <div ref={setStartSlot} className="flex min-w-0 flex-wrap items-center gap-2 sm:ml-2" />
          </>
        }
        end={<div ref={setEndSlot} className="flex min-w-0 flex-wrap items-center gap-1" />}
      />

      {ready && view === "titles" && (
        <TitlesRanking
          slots={slots}
          category={category}
          onCategory={(next) => {
            setCategory(next);
            remember(CATEGORY_STORAGE_KEY, next);
          }}
        />
      )}
      {ready && view === "people" && <PeopleView slots={slots} />}
    </CatalogLayout>
  );
}

// ---------- Titres par palier (FR-2, FR-3) ----------

function TitlesRanking({
  slots,
  category,
  onCategory,
}: {
  slots: ToolbarSlots;
  category: RankCategory;
  onCategory: (next: RankCategory) => void;
}) {
  const [ranking, setRanking] = useState<Ranking | null>(null);
  const [selected, setSelected] = useState<LibraryItem | null>(null);
  const services = useMyServices();
  const scrolledToHash = useRef(false);

  const load = useCallback(async () => {
    const params = category ? `?category=${encodeURIComponent(category)}` : "";
    const res = await fetch(`/api/classement${params}`);
    setRanking(await res.json());
  }, [category]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  // Arrivée depuis un duel de départage (#palier-4) : on descend au palier une fois chargé.
  useEffect(() => {
    if (!ranking || scrolledToHash.current) return;
    scrolledToHash.current = true;
    const hash = window.location.hash.slice(1);
    if (hash) document.getElementById(hash)?.scrollIntoView({ block: "start" });
  }, [ranking]);

  /** Le classement ne transporte que les affiches : la fiche complète se charge à l'ouverture. */
  async function openItem(id: number) {
    const res = await fetch(`/api/items/${id}`);
    if (res.ok) setSelected(await res.json());
  }

  async function patchItem(id: number, patch: ItemPatch) {
    const res = await fetch(`/api/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) return;
    const updated: LibraryItem = await res.json();
    setSelected((prev) => (prev && prev.id === id ? { ...prev, ...updated } : prev));
    // Une note qui change déplace le titre d'un palier à l'autre (FR-4) : on recalcule.
    load();
  }

  async function refreshItem(id: number, refresh: boolean) {
    const res = await fetch(`/api/items/${id}${refresh ? "?refresh=1" : ""}`);
    if (!res.ok) return;
    const updated: LibraryItem = await res.json();
    setSelected((prev) => (prev && prev.id === id ? { ...prev, ...updated } : prev));
  }

  const total = ranking?.tiers.reduce((sum, t) => sum + t.items.length, 0) ?? 0;

  return (
    <>
      <Slot into={slots.start}>
        <Tabs label="Catégorie" options={CATEGORIES} value={category} onChange={onCategory} subtle />
      </Slot>
      <Slot into={slots.end}>
        {ranking && ranking.tiers.length > 0 && (
          <nav aria-label="Aller au palier" className="flex flex-wrap items-center gap-1">
            {ranking.tiers.map((t) => (
              <a
                key={t.stars}
                href={`#palier-${t.stars}`}
                className={buttonClass({ variant: "ghost", size: "sm", className: "tabular-nums" })}
              >
                <span aria-hidden="true" className="text-foreground">
                  {t.stars === 0 ? "💩" : <StarCount value={t.stars} />}
                </span>
                <span className="sr-only">{tierName(t.stars)} :</span>
                {t.items.length}
              </a>
            ))}
          </nav>
        )}
      </Slot>

      <div className="mt-10 flex flex-col gap-14">
        {ranking === null &&
          Array.from({ length: 2 }, (_, i) => (
            <div key={i}>
              <Skeleton className="h-6 w-40" />
              <div data-stagger className={`mt-6 ${POSTER_GRID}`}>
                {Array.from({ length: 10 }, (_, j) => (
                  <div key={j} className="poster aspect-[2/3]">
                    <Skeleton className="h-full w-full" />
                  </div>
                ))}
              </div>
            </div>
          ))}

        {ranking && total === 0 && (
          <Card>
            <EmptyState
              icon={<Star size={20} aria-hidden="true" />}
              title="Rien à classer"
              action={
                category ? undefined : (
                  // Une bibliothèque qui démarre : « Déjà vu » et une note, sur les cartes de bienvenue.
                  <Button href="/bienvenue" variant="primary">
                    Noter des titres
                  </Button>
                )
              }
            >
              Aucun titre vu et noté {category ? "dans cette catégorie" : "pour l'instant"}.
            </EmptyState>
          </Card>
        )}

        {ranking?.tiers.map((tier) => (
          <TierSection
            key={tier.stars}
            tier={tier}
            category={category}
            onOpen={openItem}
            offset={ranking.tiers.slice(0, ranking.tiers.indexOf(tier)).reduce((sum, t) => sum + t.items.length, 0)}
          />
        ))}

        {ranking && ranking.unrated > 0 && (
          <Card variant="tile" className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 text-sm">
            <p className="min-w-0 text-muted">
              <span className="text-foreground">
                {ranking.unrated} titre{ranking.unrated > 1 ? "s" : ""} vu{ranking.unrated > 1 ? "s" : ""} sans note
              </span>{" "}
              n&apos;entre{ranking.unrated > 1 ? "nt" : ""} pas dans le classement.
            </p>
            <Button href="/tri?famille=seen" variant="primary" size="sm" className="ml-auto">
              Les noter en tri rapide
            </Button>
          </Card>
        )}
      </div>

      {selected && (
        <DetailPanel
          key={selected.id}
          item={selected}
          onClose={() => setSelected(null)}
          onChange={patchItem}
          onLoadOverview={(id) => refreshItem(id, false)}
          onRefetch={(id) => refreshItem(id, true)}
          covered={services.covered}
        />
      )}
    </>
  );
}

function TierSection({
  tier,
  category,
  onOpen,
  offset,
}: {
  tier: Tier;
  category: RankCategory;
  onOpen: (id: number) => void;
  /** Titres des paliers au-dessus : la numérotation continue d'un palier à l'autre. */
  offset: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const canDuel = tier.items.length >= 2;
  const duelHref = `/duels?mode=tier&stars=${tier.stars}${category ? `&category=${encodeURIComponent(category)}` : ""}`;

  // FR-7 : la progression compte les titres départagés, pas seulement comparés une fois ; un gros
  // palier (FR-9) montre aussi où en est sa répartition.
  const progress = tier.items.length > 0 ? tier.settled / tier.items.length : 0;
  const finished = tier.items.length >= 2 && tier.settled === tier.items.length;
  const placing = tier.banded && tier.placed < tier.items.length;

  // Groupes affichés : Haut, Milieu, Bas, puis non répartis (AC-15) ; sinon comparés, puis les autres.
  const groups: { key: string; title: string | null; items: RankedItem[] }[] = (
    tier.banded
      ? [
          { key: "2", title: "Haut du palier", items: tier.items.filter((i) => i.band === 2) },
          { key: "1", title: "Milieu", items: tier.items.filter((i) => i.band === 1) },
          { key: "0", title: "Bas du palier", items: tier.items.filter((i) => i.band === 0) },
          { key: "none", title: "Pas encore répartis", items: tier.items.filter((i) => i.band === null) },
        ]
      : [
          { key: "ranked", title: null, items: tier.items.filter((i) => i.tierScore !== null) },
          {
            key: "pending",
            title: tier.compared > 0 ? "Pas encore comparés" : null,
            items: tier.items.filter((i) => i.tierScore === null),
          },
        ]
  ).filter((g) => g.items.length > 0);

  // Rang = place dans tout le classement : il continue d'un palier à l'autre (5 étoiles en tête).
  const position = new Map(tier.items.map((item, index) => [item.id, offset + index + 1]));
  // Replié : les premiers titres du palier, groupes compris.
  const visible = new Set((expanded ? tier.items : tier.items.slice(0, TIER_PREVIEW)).map((i) => i.id));
  const hidden = tier.items.length - visible.size;
  const headingId = `palier-${tier.stars}-titre`;

  return (
    <section id={`palier-${tier.stars}`} aria-labelledby={headingId} className="scroll-mt-24 lg:scroll-mt-28">
      <SectionHeading
        id={headingId}
        title={
          <>
            <span aria-hidden="true" className="inline-flex align-[-2px]">
              {tier.stars === 0 ? "💩" : <StarRow count={tier.stars} size={18} />}
            </span>
            <span className="sr-only">{tierName(tier.stars)}</span>
          </>
        }
        lead={
          <span className="inline-flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
            <span>
              {tier.items.length} titre{tier.items.length > 1 ? "s" : ""}
            </span>
            {tier.items.length >= 2 && (
              // La jauge et son libellé passent à la ligne ensemble (téléphone).
              <span className="inline-flex items-center gap-2 whitespace-nowrap">
                <span
                  className="inline-block h-1 w-20 overflow-hidden rounded-full bg-divider"
                  role="img"
                  aria-label={
                    placing
                      ? `${tier.placed} titres répartis sur ${tier.items.length}`
                      : `${tier.settled} titres départagés sur ${tier.items.length}`
                  }
                >
                  <span
                    className="block h-full rounded-full bg-accent"
                    style={{ width: `${(placing ? tier.placed / tier.items.length : progress) * 100}%` }}
                  />
                </span>
                <span className={finished ? "text-foreground" : undefined}>
                  {finished
                    ? "Départagé"
                    : placing
                      ? `${tier.placed}/${tier.items.length} répartis`
                      : `${tier.settled}/${tier.items.length} départagés`}
                </span>
              </span>
            )}
          </span>
        }
        action={
          canDuel && (
            <Button href={duelHref} size="sm">
              <Scale size={14} aria-hidden="true" />
              {finished ? "Affiner" : placing ? "Répartir" : "Départager"}
            </Button>
          )
        }
      />

      {groups.map((group) => {
        const shown = group.items.filter((i) => visible.has(i.id));
        if (shown.length === 0) return null;
        return (
          <div key={group.key} className="mt-6">
            {group.title && (
              <Eyebrow className="mb-3">
                {group.title} · {group.items.length}
              </Eyebrow>
            )}
            <MediaGrid as="ol" stagger className={POSTER_GRID}>
              {shown.map((item) => (
                <li key={item.id} data-flip-id={item.id}>
                  <RankedPoster
                    item={item}
                    rank={position.get(item.id)!}
                    provisional={item.tierScore === null}
                    onOpen={() => onOpen(item.id)}
                  />
                </li>
              ))}
            </MediaGrid>
          </div>
        );
      })}

      {(hidden > 0 || expanded) && tier.items.length > TIER_PREVIEW && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setExpanded((v) => !v)}
          aria-expanded={expanded}
          className="-ml-2.5 mt-4"
        >
          <ChevronDown size={14} aria-hidden="true" className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
          {expanded ? "Replier" : `Tout afficher (${tier.items.length})`}
        </Button>
      )}
    </section>
  );
}

function RankedPoster({
  item,
  rank,
  provisional,
  onOpen,
}: {
  item: RankedItem;
  /** Place dans tout le classement. */
  rank: number;
  /** Pas encore comparé dans son palier : sa place est une estimation. */
  provisional: boolean;
  onOpen: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group block w-full text-left outline-none"
      title={
        provisional
          ? `${rank}e (provisoire, pas encore comparé) · ${item.name}`
          : `${rank}e du classement · ${item.name}`
      }
    >
      <div className="poster aspect-[2/3] w-full group-focus-visible:ring-2 group-focus-visible:ring-focus group-focus-visible:ring-offset-2 group-focus-visible:ring-offset-background">
        {item.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={item.posterUrl}
            alt=""
            loading="lazy"
            className={`h-full w-full object-cover ${provisional ? "opacity-70 group-hover:opacity-100" : ""}`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-subtle">
            <Film size={20} aria-hidden="true" />
          </div>
        )}
        {/* Rang provisoire en retrait : le titre n'a pas encore été comparé à ses voisins. */}
        <span className={`overlay-pill absolute left-2 top-2 tabular-nums ${provisional ? "text-muted" : ""}`}>
          #{rank}
        </span>
      </div>
      {/* Deux lignes réservées : le titre se lit en entier et les années restent alignées. */}
      <p className="mt-2 line-clamp-2 min-h-[2lh] text-xs font-medium text-foreground">{item.name}</p>
      {item.year && <p className="text-xs text-muted">{item.year}</p>}
    </button>
  );
}

// ---------- Personnes (FR-6) ----------

type RoleFilter = "all" | PersonRole;

function PeopleView({ slots }: { slots: ToolbarSlots }) {
  const [people, setPeople] = useState<PersonView[] | null>(null);
  const [side, setSide] = useState<"liked" | "disliked">("liked");
  const [role, setRole] = useState<RoleFilter>("all");
  const [removed, setRemoved] = useState<PersonView | null>(null);
  const removeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // FR-12 : réinitialisation confirmée, puis « Annuler » pendant 10 s.
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetUndo, setResetUndo] = useState<{ side: "liked" | "disliked"; rows: OpinionRow[] } | null>(null);
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/people/opinions");
    const body: { people: PersonView[] } = await res.json();
    setPeople(body.people);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
    return () => {
      if (removeTimer.current) clearTimeout(removeTimer.current);
      if (resetTimer.current) clearTimeout(resetTimer.current);
    };
  }, [load]);

  async function setOpinion(person: PersonView, opinion: 1 | -1) {
    // FR-13 : un « Je n'aime pas » efface la note.
    setPeople(
      (prev) => prev?.map((p) => (p.id === person.id ? { ...p, opinion, rating: opinion === -1 ? null : p.rating } : p)) ?? prev
    );
    await fetch("/api/people/opinions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: person.id, name: person.name, opinion }),
    });
  }

  /** FR-13 : note de 1 à 5 d'une personne aimée ; null la retire. */
  async function setRating(person: PersonView, rating: number | null) {
    setPeople((prev) => prev?.map((p) => (p.id === person.id ? { ...p, rating } : p)) ?? prev);
    await fetch("/api/people/opinions", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: person.id, name: person.name, opinion: 1, rating }),
    });
  }

  async function reset() {
    const target = side;
    setConfirmReset(false);
    setRemoved(null);
    setPeople((prev) => prev?.filter((p) => p.opinion !== (target === "liked" ? 1 : -1)) ?? prev);
    const res = await fetch("/api/people/opinions/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ side: target }),
    });
    const body: { removed?: OpinionRow[] } = await res.json().catch(() => ({}));
    if (!body.removed) {
      load();
      return;
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    setResetUndo({ side: target, rows: body.removed });
    resetTimer.current = setTimeout(() => setResetUndo(null), 10000);
  }

  async function undoReset() {
    if (!resetUndo) return;
    if (resetTimer.current) clearTimeout(resetTimer.current);
    const { rows } = resetUndo;
    setResetUndo(null);
    await fetch("/api/people/opinions/restore", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rows }),
    });
    load();
  }

  async function remove(person: PersonView) {
    setPeople((prev) => prev?.filter((p) => p.id !== person.id) ?? prev);
    if (removeTimer.current) clearTimeout(removeTimer.current);
    setRemoved(person);
    removeTimer.current = setTimeout(() => setRemoved(null), 8000);
    await fetch("/api/people/opinions", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: person.id }),
    });
  }

  async function undoRemove() {
    if (!removed) return;
    if (removeTimer.current) clearTimeout(removeTimer.current);
    const person = removed;
    setRemoved(null);
    await setOpinion(person, person.opinion);
    load();
  }

  const liked = (people ?? []).filter((p) => p.opinion === 1);
  const disliked = (people ?? []).filter((p) => p.opinion === -1);
  const sidePeople = side === "liked" ? liked : disliked;
  const roleCount = (r: PersonRole) => sidePeople.filter((p) => p.roles.includes(r)).length;
  // FR-13 : les mieux notées d'abord, puis le nombre de titres vus.
  const shown = sidePeople.filter((p) => role === "all" || p.roles.includes(role)).sort(
    (a, b) => (b.rating ?? 0) - (a.rating ?? 0) || b.seen.length - a.seen.length || a.name.localeCompare(b.name, "fr")
  );
  const sideLabel = side === "liked" ? "« J'aime »" : "« Je n'aime pas »";

  return (
    <>
      <Slot into={slots.start}>
        <Tabs
          label="Avis"
          options={[
            { value: "liked" as const, label: `J'aime · ${liked.length}`, icon: ThumbsUp },
            { value: "disliked" as const, label: `Je n'aime pas · ${disliked.length}`, icon: ThumbsDown },
          ]}
          value={side}
          onChange={setSide}
          subtle
        />
        <Tabs
          label="Rôle"
          options={[
            { value: "all" as const, label: "Tous" },
            ...ROLE_ORDER.map((r) => ({ value: r, label: `${ROLE_PLURAL[r]} · ${roleCount(r)}`, icon: ROLE_ICON[r] })),
          ]}
          value={role}
          onChange={setRole}
          subtle
        />
      </Slot>
      <Slot into={slots.end}>
        <Button variant="ghost" size="sm" onClick={() => setConfirmReset(true)} disabled={shown.length === 0}>
          <RotateCcw size={14} aria-hidden="true" />
          Réinitialiser
        </Button>
        <Button href="/tri?famille=person" size="sm">
          <Layers size={14} aria-hidden="true" />
          Donner d&apos;autres avis
        </Button>
      </Slot>

      <ConfirmDialog
        open={confirmReset}
        title={`Réinitialiser tes ${shown.length} ${sideLabel} ?`}
        description={
          side === "liked"
            ? "Ces personnes ne pèseront plus sur tes recommandations, et leurs notes seront effacées. Tu pourras annuler juste après."
            : "Ces personnes ne pèseront plus sur tes recommandations. Tu pourras annuler juste après."
        }
        confirmLabel="Réinitialiser"
        cancelLabel="Garder"
        destructive
        onConfirm={reset}
        onCancel={() => setConfirmReset(false)}
      />

      <div className="mt-10">
        {people === null && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-44 rounded-2xl" />
            ))}
          </div>
        )}

        {people !== null && shown.length === 0 && (
          <Card>
            <EmptyState
              icon={<UsersRound size={20} aria-hidden="true" />}
              title={side === "liked" ? "Aucune personne aimée pour l'instant" : "Aucune personne écartée"}
              action={
                <Button href="/tri?famille=person" variant="primary">
                  Trier des personnes
                </Button>
              }
            >
              Le tri rapide te présente les acteurs, réalisateurs et producteurs de tes titres vus, un par un.
            </EmptyState>
          </Card>
        )}

        {shown.length > 0 && (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {shown.map((person) => (
              <li key={person.id}>
                <PersonCard
                  person={person}
                  onOpinion={(o) => setOpinion(person, o)}
                  onRate={(r) => setRating(person, r)}
                  onRemove={() => remove(person)}
                />
              </li>
            ))}
          </ul>
        )}
      </div>

      {resetUndo && (
        <Toast action="Annuler" onAction={undoReset}>
          {resetUndo.rows.length} {resetUndo.side === "liked" ? "« J'aime »" : "« Je n'aime pas »"} réinitialisé
          {resetUndo.rows.length > 1 ? "s" : ""}
        </Toast>
      )}

      {removed && !resetUndo && (
        <Toast action="Annuler" onAction={undoRemove}>
          Avis sur {removed.name} retiré
        </Toast>
      )}
    </>
  );
}

function PersonCard({
  person,
  onOpinion,
  onRate,
  onRemove,
}: {
  person: PersonView;
  onOpinion: (opinion: 1 | -1) => void;
  onRate: (rating: number | null) => void;
  onRemove: () => void;
}) {
  const average = person.averageStars === null ? null : person.averageStars.toFixed(1).replace(".", ",");

  return (
    <Card as="article" className="flex h-full flex-col gap-3 p-4">
      <div className="flex items-center gap-3">
        <Avatar src={person.photoUrl} name={person.name} size={48} />
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base text-foreground">{person.name}</h3>
          <RoleBadges roles={person.roles} className="mt-1.5" />
        </div>
        <Button
          variant="ghost"
          size="sm"
          icon
          onClick={onRemove}
          title="Retirer mon avis"
          aria-label={`Retirer mon avis sur ${person.name}`}
          className="-mr-1 self-start"
        >
          <X size={14} aria-hidden="true" />
        </Button>
      </div>

      {person.opinion === 1 && <PersonStars name={person.name} rating={person.rating} onRate={onRate} />}

      <MetaRow>
        <span className="text-foreground">
          {person.seen.length} titre{person.seen.length > 1 ? "s" : ""} vu{person.seen.length > 1 ? "s" : ""}
        </span>
        {average && (
          <span>
            moyenne <StarCount value={average} size={12} />
          </span>
        )}
      </MetaRow>

      {person.toWatch.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted">À voir</span>
          <span className="flex -space-x-2">
            {person.toWatch.slice(0, 4).map((t) => (
              <span
                key={t.id}
                title={t.name}
                className="h-9 w-6 overflow-hidden rounded-badge bg-surface-3 ring-2 ring-surface"
              >
                {t.posterUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={t.posterUrl} alt={t.name} loading="lazy" className="h-full w-full object-cover" />
                )}
              </span>
            ))}
          </span>
          {person.toWatch.length > 4 && <span className="text-xs text-muted">+{person.toWatch.length - 4}</span>}
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-2 pt-1">
        <Chip pressed={person.opinion === 1} icon={<ThumbsUp size={14} aria-hidden="true" />} onClick={() => onOpinion(1)}>
          J&apos;aime
        </Chip>
        <Chip
          pressed={person.opinion === -1}
          icon={<ThumbsDown size={14} aria-hidden="true" />}
          onClick={() => onOpinion(-1)}
        >
          Je n&apos;aime pas
        </Chip>
      </div>
    </Card>
  );
}

/**
 * Note d'une personne aimée (FR-13) : les cinq étoiles de Catalog (StarIcon), recliquer sur la
 * note choisie la retire. Le survol prévisualise la note avant le clic. Cibles de 24 px (WCAG 2.5.8).
 */
function PersonStars({
  name,
  rating,
  onRate,
}: {
  name: string;
  rating: number | null;
  onRate: (rating: number | null) => void;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? rating ?? 0;
  return (
    <div role="radiogroup" aria-label={`Ta note pour ${name}`} className="-ml-1 flex items-center" onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          role="radio"
          aria-checked={rating === n}
          aria-label={`${n} étoile${n > 1 ? "s" : ""}${rating === n ? " (retirer la note)" : ""}`}
          onMouseEnter={() => setHover(n)}
          onClick={() => onRate(rating === n ? null : n)}
          className="flex h-6 w-6 items-center justify-center rounded-md outline-none transition-transform active:scale-90 focus-visible:ring-2 focus-visible:ring-focus"
        >
          <StarIcon filled={n <= shown} size={16} />
        </button>
      ))}
      {rating === null && hover === null && <span className="ml-1 text-xs text-muted">Noter</span>}
      {rating === 0 && hover === null && (
        <span className="ml-1 text-xs text-muted" title="Noté 💩">
          💩
        </span>
      )}
    </div>
  );
}
