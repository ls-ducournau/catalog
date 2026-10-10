"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  Camera,
  Clapperboard,
  Film,
  LayoutGrid,
  RotateCcw,
  Scale,
  Tv,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { HeroLayout } from "@/components/layouts";
import { CommandWindow, EmptyState } from "@/components/sections";
import { Button, Card, Divider, Keycap, MetaRow, Skeleton, StarCount, Tabs, Toast } from "@/components/ui";
import { TierFlow, usePressedKey } from "@/components/TierFlow";
import type { Category } from "@/lib/libraryItem";
import { genreLine } from "@/lib/genres";

type TitleDuelItem = {
  id: number;
  name: string;
  year: string | null;
  genres: string[];
  posterUrl: string | null;
  eloScore: number;
  duelsCount: number;
};

type PersonDuelItem = {
  id: number;
  name: string;
  photoUrl: string | null;
  eloScore: number;
  duelsCount: number;
  seenIn: string[];
};

type TitleDuelResponse =
  | { itemA: TitleDuelItem; itemB: TitleDuelItem }
  | { error: "not_enough_watched_items"; eligibleCount: number };

type PersonDuelResponse =
  | { personA: PersonDuelItem; personB: PersonDuelItem }
  | { error: "not_enough_people"; eligibleCount: number };

type Scope = { watched: number; scored: number };

/** FR-18 et classement-v1 FR-3 : ce qu'on met en duel. */
type Mode = "titles" | "tier" | "people";

/** FR-16 : périmètre d'un duel de titres ; "" = tout confondu. */
type DuelCategory = "" | Category;

/** Palier de départage : nombre d'étoiles, "0" pour 💩. */
type TierValue = "5" | "4" | "3" | "2" | "1" | "0";

/** Ce qu'une carte de duel affiche, en duel de titres comme d'acteurs. */
type DuelCardData = {
  id: number;
  name: string;
  imageUrl: string | null;
  scoreLabel: string;
  /** Court, sur la ligne du score (l'année d'un titre). */
  /** Année, genre… : une ligne de métadonnées ; null pour une personne. */
  meta: (string | null)[] | null;
  /** Plus long, sur sa propre ligne (les titres où l'on a croisé un acteur). */
  note: string | null;
};

type Pair = { a: DuelCardData; b: DuelCardData };

/** classement-v1 FR-1 : de quoi annuler un duel, et remettre sa paire à l'écran. */
type HistoryEntry = {
  mode: "titles" | "people";
  duelId: number;
  pair: Pair;
  context: string;
  choice: "A" | "B" | "skip";
};

const MODES: { value: Mode; label: string; icon: LucideIcon }[] = [
  { value: "titles", label: "Titres", icon: Film },
  { value: "tier", label: "Départage", icon: Scale },
  { value: "people", label: "Acteurs", icon: UsersRound },
];

const CATEGORIES: { value: DuelCategory; label: string; plural: string; icon: LucideIcon }[] = [
  { value: "", label: "Tout", plural: "tous les titres", icon: LayoutGrid },
  { value: "Movie", label: "Films", plural: "les films", icon: Clapperboard },
  { value: "TV Series", label: "Séries", plural: "les séries", icon: Tv },
  { value: "Documentary", label: "Documentaires", plural: "les documentaires", icon: Camera },
];

/** Nom d'un palier dans une phrase : « 4 étoiles », « 1 étoile », « 💩 ». */
function starsOf(value: string): string {
  return value === "0" ? "💩" : `${value} étoile${value === "1" ? "" : "s"}`;
}

const TIERS: { value: TierValue; label: string; title: string; display?: ReactNode }[] = (
  ["5", "4", "3", "2", "1", "0"] as TierValue[]
).map((value) => ({
  value,
  label: starsOf(value),
  title: value === "0" ? "Titres notés 💩" : `Titres notés ${starsOf(value)}`,
  display: value === "0" ? undefined : <StarCount value={value} />,
}));

const MODE_STORAGE_KEY = "watchlist:duelMode";
const CATEGORY_STORAGE_KEY = "watchlist:duelCategory";
const TIER_STORAGE_KEY = "watchlist:duelTier";
/** Durée pendant laquelle une réinitialisation peut être annulée depuis l'écran. */
const UNDO_MS = 8000;
const HISTORY_MAX = 20;
/** Largeur de la fenêtre : les deux cartes côte à côte, et les choix de l'en-tête sur une ligne. */
const WINDOW = "max-w-3xl";

function seenInLine(titles: string[]): string | null {
  if (titles.length === 0) return null;
  const [first, second, ...rest] = titles;
  return `Vu dans ${[first, second].filter(Boolean).join(", ")}${rest.length > 0 ? ` +${rest.length}` : ""}`;
}

/** Ce que la carte dit de son passé de duels, sans l'Elo (du jargon) : audit UX 2026-10-09, W2-5. */
function duelsLine(count: number): string {
  return count === 0 ? "Premier duel" : `${count} duel${count > 1 ? "s" : ""}`;
}

export default function DuelsPage() {
  const [mode, setMode] = useState<Mode>("titles");
  const [category, setCategory] = useState<DuelCategory>("");
  const [tier, setTier] = useState<TierValue>("4");
  const [ready, setReady] = useState(false);

  // Mode, catégorie et palier sont mémorisés ; l'adresse l'emporte (« Départager » depuis le
  // classement arrive avec ?mode=tier&stars=4&category=Movie).
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const storedMode = params.get("mode") ?? window.localStorage.getItem(MODE_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (MODES.some((m) => m.value === storedMode)) setMode(storedMode as Mode);
      const storedCategory = params.get("category") ?? window.localStorage.getItem(CATEGORY_STORAGE_KEY);
      if (storedCategory !== null && CATEGORIES.some((c) => c.value === storedCategory)) {
        setCategory(storedCategory as DuelCategory);
      }
      const storedTier = params.get("stars") ?? window.localStorage.getItem(TIER_STORAGE_KEY);
      if (TIERS.some((t) => t.value === storedTier)) setTier(storedTier as TierValue);
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

  const currentCategory = CATEGORIES.find((c) => c.value === category) ?? CATEGORIES[0];

  // En-tête de la fenêtre (la « recherche » de la palette) : ce qu'on met en duel, la catégorie,
  // et en départage le palier, sur sa propre ligne.
  const head = (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-between">
        <Tabs
          label="Type de duel"
          options={MODES}
          value={mode}
          onChange={(next) => {
            setMode(next);
            remember(MODE_STORAGE_KEY, next);
          }}
        />
        {/* FR-16 : on choisit ce qu'on compare ; un film face à une série n'a pas toujours de sens. */}
        {mode !== "people" && (
          <Tabs
            label="Catégorie des duels"
            options={CATEGORIES}
            value={category}
            onChange={(next) => {
              setCategory(next);
              remember(CATEGORY_STORAGE_KEY, next);
            }}
            subtle
          />
        )}
      </div>
      {/* classement-v1 FR-3 : on ne compare que des titres de même note. */}
      {mode === "tier" && (
        <div className="flex justify-center sm:justify-start">
          <Tabs
            label="Palier à départager"
            options={TIERS}
            value={tier}
            onChange={(next) => {
              setTier(next);
              remember(TIER_STORAGE_KEY, next);
            }}
            subtle
          />
        </div>
      )}
    </div>
  );

  return (
    <HeroLayout
      stage
      hero={
        <>
          <h1 className="text-balance text-heading text-foreground">
            {mode === "people"
              ? "Quel acteur préfères-tu ?"
              : mode === "tier"
                ? `Départager les ${starsOf(tier)}`
                : "Lequel préfères-tu ?"}
          </h1>
          <p className="text-base text-muted">
            {mode === "people"
              ? "Deux acteurs de tes titres vus, tu gardes ton préféré."
              : mode === "tier"
                ? "Des titres de même note, rangés entre eux."
                : "Deux titres vus, tu gardes ton préféré : ton classement s'affine."}
          </p>
        </>
      }
    >

      {!ready && (
        <CommandWindow head={head} className={WINDOW}>
          <PairSkeleton />
        </CommandWindow>
      )}
      {ready && mode === "tier" && (
        <TierFlow
          key={`${tier}|${category}`}
          head={head}
          stars={tier}
          starsLabel={starsOf(tier)}
          category={category}
          categoryPlural={category ? currentCategory.plural : null}
          onChooseTier={(next) => {
            setTier(next as TierValue);
            remember(TIER_STORAGE_KEY, next);
          }}
          tierLabelOf={(value) => TIERS.find((t) => t.value === value)?.label ?? value}
        />
      )}
      {ready && mode !== "tier" && (
        <PairDuels key={mode} head={head} mode={mode} category={category} categoryLabel={currentCategory} />
      )}
    </HeroLayout>
  );
}

/** Duels de titres (FR-3 à FR-17) et d'acteurs (FR-18 à FR-22), annulables (classement-v1 FR-1). */
function PairDuels({
  head,
  mode,
  category,
  categoryLabel,
}: {
  head: ReactNode;
  mode: "titles" | "people";
  category: DuelCategory;
  categoryLabel: { label: string; plural: string };
}) {
  const [pair, setPair] = useState<Pair | null>(null);
  const [notEnough, setNotEnough] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // Réinitialisation : null = repos, sinon le périmètre annoncé avant de confirmer.
  const [confirming, setConfirming] = useState<Scope | null>(null);
  const [resetting, setResetting] = useState(false);
  const [undoable, setUndoable] = useState<{ count: number; label: string } | null>(null);
  const [pressed, press] = usePressedKey();
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const scopeLabel = mode === "people" ? "les acteurs" : categoryLabel.plural;
  const scopeShort = mode === "people" ? "acteurs" : categoryLabel.label.toLowerCase();
  /** Contexte d'une paire : une annulation ne la remet à l'écran que dans le même contexte. */
  const context = `${mode}|${mode === "people" ? "" : category}`;

  const showNotice = useCallback((message: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = setTimeout(() => setNotice(null), 5000);
  }, []);

  const loadNext = useCallback(async () => {
    setLoading(true);
    if (mode === "people") {
      const res = await fetch("/api/duels/people/next");
      const data: PersonDuelResponse = await res.json();
      if ("error" in data) {
        setNotEnough(data.eligibleCount);
        setPair(null);
      } else {
        const toCard = (p: PersonDuelItem): DuelCardData => ({
          id: p.id,
          name: p.name,
          imageUrl: p.photoUrl,
          scoreLabel: duelsLine(p.duelsCount),
          meta: null,
          note: seenInLine(p.seenIn),
        });
        setNotEnough(null);
        setPair({ a: toCard(data.personA), b: toCard(data.personB) });
      }
    } else {
      const params = category ? `?category=${encodeURIComponent(category)}` : "";
      const res = await fetch(`/api/duels/next${params}`);
      const data: TitleDuelResponse = await res.json();
      if ("error" in data) {
        setNotEnough(data.eligibleCount);
        setPair(null);
      } else {
        const toCard = (t: TitleDuelItem): DuelCardData => ({
          id: t.id,
          name: t.name,
          imageUrl: t.posterUrl,
          scoreLabel: duelsLine(t.duelsCount),
          // Un seul genre : la ligne tient sous l'affiche.
          meta: [t.year, genreLine(t.genres, 1)],
          note: null,
        });
        setNotEnough(null);
        setPair({ a: toCard(data.itemA), b: toCard(data.itemB) });
      }
    }
    setLoading(false);
  }, [mode, category]);

  useEffect(() => {
    // Nouvelle paire au montage et à chaque changement de catégorie.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadNext();
  }, [loadNext]);

  const choose = useCallback(
    async (choice: "A" | "B" | "skip") => {
      if (!pair || submitting) return;
      // Seule la touche affichée s'enfonce ; la paire suivante arrive sans animation (règle 4).
      press(choice === "A" ? "1" : choice === "B" ? "2" : "3");
      setSubmitting(true);

      const [url, body] =
        mode === "people"
          ? ["/api/duels/people/result", { personAId: pair.a.id, personBId: pair.b.id, result: choice }]
          : ["/api/duels/result", { itemAId: pair.a.id, itemBId: pair.b.id, result: choice }];

      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => null);
      const result: { duelId?: number } | null = res ? await res.json().catch(() => null) : null;
      setSubmitting(false);

      if (res?.ok && typeof result?.duelId === "number") {
        const entry: HistoryEntry = { mode, duelId: result.duelId, pair, context, choice };
        setHistory((h) => [...h.slice(-(HISTORY_MAX - 1)), entry]);
      } else {
        showNotice("Le duel n'a pas été enregistré.");
      }
      loadNext();
    },
    [pair, submitting, mode, context, loadNext, showNotice, press]
  );

  /** classement-v1 FR-1 : défait le dernier duel et remet sa paire à l'écran. */
  const undoLast = useCallback(async () => {
    const entry = history[history.length - 1];
    if (!entry || submitting) return;
    setSubmitting(true);
    const res = await fetch("/api/duels/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: entry.mode, duelId: entry.duelId }),
    }).catch(() => null);
    setSubmitting(false);
    setHistory((h) => h.slice(0, -1));

    if (!res?.ok) {
      showNotice("Ce duel ne peut plus être annulé : ses titres ont bougé depuis.");
      return;
    }
    if (entry.context === context) {
      setPair(entry.pair);
      setNotEnough(null);
    }
    showNotice("Duel annulé.");
  }, [history, submitting, context, showNotice]);

  // 1 / ← pour la carte de gauche, 2 / → pour celle de droite, 3 pour passer, Ctrl+Z pour annuler.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]")) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undoLast();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (e.key === "1" || e.key === "ArrowLeft") choose("A");
      if (e.key === "2" || e.key === "ArrowRight") choose("B");
      if (e.key === "3") choose("skip");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [choose, undoLast]);

  useEffect(() => {
    return () => {
      if (undoTimer.current) clearTimeout(undoTimer.current);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  /** Première étape : annoncer ce qui va être touché, avant toute écriture. */
  async function askReset() {
    const url =
      mode === "people"
        ? "/api/duels/people/scope"
        : `/api/duels/scope${category ? `?category=${encodeURIComponent(category)}` : ""}`;
    const res = await fetch(url);
    setConfirming(await res.json());
  }

  async function confirmReset() {
    setResetting(true);
    const res =
      mode === "people"
        ? await fetch("/api/duels/people/reset", { method: "POST" })
        : await fetch("/api/duels/reset", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ category: category || null }),
          });
    const { reset }: { reset: number } = await res.json();
    setResetting(false);
    setConfirming(null);
    // Les duels d'avant la réinitialisation ne s'annulent plus (EC-3) : on les oublie.
    setHistory([]);

    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoable({ count: reset, label: scopeLabel });
    undoTimer.current = setTimeout(() => setUndoable(null), UNDO_MS);
    loadNext();
  }

  async function undoReset() {
    if (!undoable) return;
    if (undoTimer.current) clearTimeout(undoTimer.current);
    const url = mode === "people" ? "/api/duels/people/restore" : "/api/duels/restore";
    setUndoable(null);
    await fetch(url, { method: "POST" });
    loadNext();
  }

  const unit = mode === "people" ? "acteur" : "titre";
  const last = history[history.length - 1] ?? null;
  const ModeIcon = mode === "people" ? UsersRound : Film;

  // Retour du dernier duel, à gauche de la barre d'actions : au clavier, c'est le seul signe visible.
  const feedback =
    notice ??
    (last
      ? last.choice === "skip"
        ? `Passé : « ${last.pair.a.name} » / « ${last.pair.b.name} »`
        : `« ${(last.choice === "A" ? last.pair.a : last.pair.b).name} » devant « ${
            (last.choice === "A" ? last.pair.b : last.pair.a).name
          } »`
      : null);

  return (
    <>
      <CommandWindow
        head={head}
        className={WINDOW}
        context={
          <>
            <ModeIcon size={14} aria-hidden="true" className="shrink-0" />
            <span className="truncate" aria-live="polite" title={feedback ?? undefined}>
              {feedback ?? (mode === "people" ? "Duel d'acteurs" : `Duel de titres · ${categoryLabel.label}`)}
            </span>
          </>
        }
        primary={{ label: "Annuler", keys: ["Ctrl", "Z"], onClick: undoLast, disabled: !last || submitting }}
      >
        {loading && !pair && <PairSkeleton />}

        {!loading && notEnough !== null && (
          <EmptyState
            icon={<ModeIcon size={20} aria-hidden="true" />}
            title={
              mode === "people"
                ? "Pas encore assez d'acteurs pour un duel"
                : `Pas assez de titres vus pour ${category ? `un duel sur ${categoryLabel.plural}` : "un duel"}`
            }
          >
            {mode === "people"
              ? `Un acteur entre en duel dès qu'il apparaît dans au moins 3 de tes titres vus. Éligibles : ${notEnough}.`
              : `Il en faut au moins 2 marqués « Vu ». Actuellement : ${notEnough}.`}
          </EmptyState>
        )}

        {pair && (
          <div
            aria-busy={loading || submitting}
            className="flex flex-col items-stretch gap-3 p-3 sm:flex-row sm:justify-center sm:gap-4 sm:p-6"
          >
            <DuelCard card={pair.a} shortcut="1" pressed={pressed === "1"} onClick={() => choose("A")} disabled={submitting} />

            {/* Entre les deux : passer, avec sa touche. En colonne, les traits verticaux sont centrés
                (`self-center`) : sinon l'étirement du trait le colle au bord gauche. */}
            <div className="flex items-center gap-3 sm:flex-col">
              <Divider className="flex-1 sm:hidden" />
              <Divider vertical className="hidden flex-1 self-center sm:block" />
              <Button
                variant="ghost"
                onClick={() => choose("skip")}
                disabled={submitting}
                aria-keyshortcuts="3"
                className="sm:h-auto sm:flex-col sm:py-2"
              >
                <Keycap pressed={pressed === "3"} aria-hidden="true" className="hidden sm:inline-flex">
                  3
                </Keycap>
                Passer
              </Button>
              <Divider className="flex-1 sm:hidden" />
              <Divider vertical className="hidden flex-1 self-center sm:block" />
            </div>

            <DuelCard card={pair.b} shortcut="2" pressed={pressed === "2"} onClick={() => choose("B")} disabled={submitting} />
          </div>
        )}
      </CommandWindow>

      {/* Réinitialisation : sous la fenêtre, loin des cartes du duel, et toujours en deux temps. */}
      <div className="flex min-h-9 flex-wrap items-center justify-center gap-2 text-xs text-muted">
        {confirming === null ? (
          <Button variant="ghost" size="sm" onClick={askReset}>
            <RotateCcw size={12} aria-hidden="true" />
            Réinitialiser l&apos;Elo · {scopeShort}
          </Button>
        ) : confirming.scored === 0 ? (
          <>
            <span>Rien à réinitialiser : aucun Elo n&apos;a encore bougé pour {scopeLabel}.</span>
            <Button variant="ghost" size="sm" onClick={() => setConfirming(null)}>
              Fermer
            </Button>
          </>
        ) : (
          <>
            <span className="text-foreground">
              Remettre à 1200 l&apos;Elo de {confirming.scored} {unit}
              {confirming.scored > 1 ? "s" : ""} ?
            </span>
            <span>L&apos;historique des duels est conservé.</span>
            <Button variant="primary" size="sm" onClick={confirmReset} loading={resetting}>
              {resetting ? "Réinitialisation…" : "Réinitialiser"}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirming(null)} disabled={resetting}>
              Garder
            </Button>
          </>
        )}
      </div>

      {undoable && (
        <Toast action="Annuler" onAction={undoReset}>
          Elo réinitialisé pour {undoable.count} {unit}
          {undoable.count > 1 ? "s" : ""} ({undoable.label})
        </Toast>
      )}
    </>
  );
}

/** Chargement : deux affiches en attente, à la place des cartes. */
function PairSkeleton() {
  return (
    <div className="flex flex-col items-stretch gap-3 p-3 sm:flex-row sm:justify-center sm:gap-16 sm:p-6">
      {[0, 1].map((i) => (
        <div key={i} className="flex items-center gap-3 p-2 sm:w-60 sm:flex-col sm:items-stretch">
          <Skeleton className="aspect-[2/3] w-20 shrink-0 rounded-control sm:w-full" />
          <div className="flex flex-1 flex-col gap-2 sm:pt-1">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/3" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Une carte du duel : l'affiche, le nom, l'Elo et la touche qui la choisit. Sur téléphone, une
 * ligne compacte (petite affiche, texte à côté) pour voir les deux sans défiler.
 */
function DuelCard({
  card,
  shortcut,
  pressed,
  onClick,
  disabled,
}: {
  card: DuelCardData;
  shortcut: string;
  pressed: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <Card
      as="button"
      type="button"
      variant="tile"
      onClick={onClick}
      disabled={disabled}
      aria-keyshortcuts={shortcut}
      className="group flex min-w-0 items-center gap-3 p-2 text-left sm:w-60 sm:flex-col sm:items-stretch sm:gap-0"
    >
      <div className="poster aspect-[2/3] w-20 shrink-0 rounded-control sm:w-full">
        {card.imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={card.imageUrl} alt={card.name} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted">
            <Film size={24} aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 items-center gap-3 sm:px-1 sm:pb-1 sm:pt-3">
        <div className="min-w-0 flex-1">
          {/* Deux lignes réservées : le titre est tout le choix, les deux cartes restent alignées. */}
          <p className="line-clamp-2 text-sm font-medium text-foreground sm:min-h-[2lh]">{card.name}</p>
          {/* Année et genre sur une ligne, l'Elo sur la suivante : rien ne se coupe au milieu. */}
          {card.meta && <MetaRow as="span" className="flex-nowrap text-xs" items={card.meta} />}
          <p className="text-xs text-muted">{card.scoreLabel}</p>
          {card.note && <p className="mt-1 line-clamp-2 text-xs text-muted">{card.note}</p>}
        </div>
        <Keycap pressed={pressed} aria-hidden="true" className="hidden sm:inline-flex">
          {shortcut}
        </Keycap>
      </div>
    </Card>
  );
}
