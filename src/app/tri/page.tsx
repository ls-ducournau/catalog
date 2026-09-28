"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  Camera,
  Clapperboard,
  Eye,
  Layers,
  LayoutGrid,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Tv,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { CommandLayout } from "@/components/layouts";
import { CommandWindow, EmptyState } from "@/components/sections";
import { Badge, Button, Card, Keycap, Skeleton, Tabs, Toast, buttonClass } from "@/components/ui";
import { CompatibilityChip } from "@/components/CompatibilityChip";
import { ProviderLogo } from "@/components/ProviderLogo";
import { ReleaseBadge } from "@/components/ReleaseBadge";
import { TrailerButton } from "@/components/TrailerButton";
import { useMyServices } from "@/components/useMyServices";
import { cn } from "@/lib/utils";
import { includedIn } from "@/lib/availability";
import type { Category } from "@/lib/libraryItem";
import type {
  PersonRole,
  TriageAnswer,
  TriageCard,
  TriageFamily,
  TriageUndo,
} from "@/lib/triageService";

// Tri rapide — spec: specs/tri-rapide-v1.md (FR-3 à FR-6)

type TriageCategory = "" | Category;

type HistoryEntry = {
  card: TriageCard;
  answer: TriageAnswer;
  /** Résolue quand le serveur a appliqué la réponse ; null si elle a échoué. */
  undo: Promise<TriageUndo | null>;
};

/** Carte qui part après une réponse à la souris ou au doigt (jamais au clavier). */
type Leaving = { card: TriageCard; answer: TriageAnswer; fromX: number };

const FAMILIES: { value: TriageFamily; label: string; icon: LucideIcon }[] = [
  { value: "unseen", label: "À découvrir", icon: Sparkles },
  { value: "seen", label: "Déjà vus", icon: Eye },
  { value: "person", label: "Personnes", icon: UsersRound },
];
const FAMILIES_COMPACT = FAMILIES.map(({ value, label }) => ({ value, label }));

const CATEGORIES: { value: TriageCategory; label: string; icon: LucideIcon }[] = [
  { value: "", label: "Tout", icon: LayoutGrid },
  { value: "Movie", label: "Films", icon: Clapperboard },
  { value: "TV Series", label: "Séries", icon: Tv },
  { value: "Documentary", label: "Documentaires", icon: Camera },
];

/**
 * Le piège central de la spec : sur un titre pas vu, « non » veut dire « ça ne me tente pas »,
 * pas « je ne l'ai pas aimé ». Les libellés le disent, et chaque bouton annonce son effet.
 */
const COPY: Record<
  TriageFamily,
  {
    question: string;
    like: string;
    dislike: string;
    likeEffect: string;
    dislikeEffect: string;
    likedAs: string;
    dislikedAs: string;
    empty: string;
  }
> = {
  unseen: {
    question: "Ça te tente ?",
    like: "Ça me tente",
    dislike: "Pas pour moi",
    likeEffect: "Ajouter à ma pile",
    dislikeEffect: "Ne plus le proposer",
    likedAs: "ajouté à ta pile",
    dislikedAs: "écarté",
    empty: "Plus de découvertes à trier pour l'instant.",
  },
  seen: {
    question: "Tu as aimé ?",
    like: "Aimé",
    dislike: "Pas aimé",
    likeEffect: "Noter 4 étoiles",
    dislikeEffect: "Noter 2 étoiles",
    likedAs: "noté 4 étoiles",
    dislikedAs: "noté 2 étoiles",
    empty: "Tous tes titres vus ont une note.",
  },
  person: {
    question: "Tu aimes son travail ?",
    like: "J'aime",
    dislike: "Je n'aime pas",
    likeEffect: "Plus de ses titres",
    dislikeEffect: "Moins de ses titres",
    likedAs: "aimé",
    dislikedAs: "pas aimé",
    empty: "Tu as donné ton avis sur toutes les personnes de tes titres vus.",
  },
};

const ROLE_LABEL: Record<PersonRole, string> = {
  cast: "Interprète",
  director: "Réalisation",
  producer: "Production",
};

const ERROR_MESSAGE: Record<string, string> = {
  notion_unreachable: "Notion est injoignable : le titre n'a pas été ajouté.",
  notion_not_configured: "Notion n'est pas configuré : ajout impossible.",
  tmdb_not_found: "Titre introuvable chez TMDB.",
};

const FAMILY_STORAGE_KEY = "watchlist:triageFamily";
const CATEGORY_STORAGE_KEY = "watchlist:triageCategory";
const BATCH_SIZE = 20;
/** On recharge avant d'arriver au bout, pour ne jamais attendre entre deux cartes. */
const REFILL_BELOW = 4;
const HISTORY_MAX = 20;
/** Touche de chaque réponse (FR-5) : 1 / ← non, 2 / → oui, 3 passer. */
const KEY_OF: Record<TriageAnswer, string> = { dislike: "1", like: "2", skip: "3" };
/** Durée pendant laquelle une touche affichée reste enfoncée (spec design-system-v2 § 4.1). */
const PRESS_MS = 100;

/**
 * Touche affichée enfoncée pendant 100 ms, quand on presse la touche ou qu'on clique son bouton
 * (spec design-system-v2 § 4.2, règle 4 : seule la touche bouge au clavier).
 */
function usePressedKey(): [string | null, (key: string) => void] {
  const [pressed, setPressed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const press = useCallback((key: string) => {
    if (timer.current) clearTimeout(timer.current);
    setPressed(key);
    timer.current = setTimeout(() => setPressed(null), PRESS_MS);
  }, []);
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);
  return [pressed, press];
}

function cardTitle(card: TriageCard): string {
  return card.family === "person" ? card.name : card.title;
}

export default function TriPage() {
  const [family, setFamily] = useState<TriageFamily>("unseen");
  const [category, setCategory] = useState<TriageCategory>("");
  const [queue, setQueue] = useState<TriageCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [exhausted, setExhausted] = useState(false);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [counts, setCounts] = useState({ answered: 0, skipped: 0 });
  const [error, setError] = useState<string | null>(null);
  const [dragX, setDragX] = useState<number | null>(null);
  const [leaving, setLeaving] = useState<Leaving | null>(null);
  /** Préférences lues : sans ça, le premier rendu chargeait « À découvrir » (TMDB) pour rien. */
  const [ready, setReady] = useState(false);
  /** Dernière réponse au clavier : la pile avance alors sans transition (règle 4). */
  const [instant, setInstant] = useState(false);
  const [pressed, press] = usePressedKey();
  const services = useMyServices();

  /** Clés déjà montrées dans la session, par famille : une carte passée ne revient pas. */
  const shown = useRef(new Set<string>());
  const requestSeq = useRef(0);
  const familyRef = useRef(family);
  const drag = useRef<{ pointerId: number; startX: number; width: number; lastX: number; lastT: number; velocity: number } | null>(null);
  const errorTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    familyRef.current = family;
  }, [family]);

  // Famille et catégorie sont mémorisées, comme dans les duels ; `?famille=` dans l'adresse
  // l'emporte (lien direct depuis une autre page).
  useEffect(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get("famille");
      const storedFamily = fromUrl ?? window.localStorage.getItem(FAMILY_STORAGE_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (FAMILIES.some((f) => f.value === storedFamily)) setFamily(storedFamily as TriageFamily);
      const storedCategory = window.localStorage.getItem(CATEGORY_STORAGE_KEY);
      if (storedCategory !== null && CATEGORIES.some((c) => c.value === storedCategory)) {
        setCategory(storedCategory as TriageCategory);
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

  const showError = useCallback((message: string) => {
    if (errorTimer.current) clearTimeout(errorTimer.current);
    setError(message);
    errorTimer.current = setTimeout(() => setError(null), 6000);
  }, []);

  useEffect(() => {
    return () => {
      if (errorTimer.current) clearTimeout(errorTimer.current);
    };
  }, []);

  const loadBatch = useCallback(
    async (reset: boolean) => {
      const seq = reset ? ++requestSeq.current : requestSeq.current;
      if (reset) shown.current = new Set();
      setLoading(true);

      const params = new URLSearchParams({ family, limit: String(BATCH_SIZE) });
      if (category && family !== "person") params.set("category", category);
      if (shown.current.size > 0) params.set("exclude", [...shown.current].join(","));

      try {
        const res = await fetch(`/api/triage/batch?${params}`);
        const body: { cards?: TriageCard[] } = await res.json();
        if (seq !== requestSeq.current) return;
        const fresh = (body.cards ?? []).filter((c) => !shown.current.has(c.key));
        for (const card of fresh) shown.current.add(card.key);
        setQueue((prev) => (reset ? fresh : [...prev, ...fresh]));
        setExhausted(fresh.length === 0);
      } catch {
        if (seq === requestSeq.current) {
          setExhausted(true);
          showError("Impossible de charger les cartes.");
        }
      } finally {
        if (seq === requestSeq.current) setLoading(false);
      }
    },
    [family, category, showError]
  );

  // Nouveau paquet à chaque changement de famille ou de catégorie.
  useEffect(() => {
    if (!ready) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQueue([]);
    setExhausted(false);
    setDragX(null);
    setLeaving(null);
    loadBatch(true);
  }, [loadBatch, ready]);

  // Réassort : on recharge avant d'arriver au bout du paquet.
  useEffect(() => {
    if (ready && !loading && !exhausted && queue.length < REFILL_BELOW) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      loadBatch(false);
    }
  }, [ready, queue.length, loading, exhausted, loadBatch]);

  /** FR-4 : applique la réponse sans attendre le serveur ; FR-6 : garde de quoi l'annuler. */
  const answer = useCallback(
    (value: TriageAnswer, fromX: number | null) => {
      const card = queue[0];
      if (!card) return;

      press(KEY_OF[value]);
      setQueue((prev) => prev.slice(1));
      setDragX(null);
      // Au clavier, pas d'animation : le geste se répète trop vite pour qu'elle serve. Ni la carte
      // qui part, ni la suivante qui monte : seule la touche affichée s'enfonce.
      setInstant(fromX === null);
      setLeaving(fromX === null ? null : { card, answer: value, fromX });
      setCounts((c) =>
        value === "skip" ? { ...c, skipped: c.skipped + 1 } : { ...c, answered: c.answered + 1 }
      );

      const request = fetch("/api/triage/answer", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ card, answer: value }),
      }).then(async (res) => {
        const body = await res.json();
        if (!res.ok || "error" in body) throw new Error(body.error ?? "unknown");
        return body.undo as TriageUndo;
      });

      const entry: HistoryEntry = { card, answer: value, undo: request.catch(() => null) };
      setHistory((h) => [...h.slice(-(HISTORY_MAX - 1)), entry]);

      request.catch((err: Error) => {
        // Réponse refusée (Notion injoignable…) : la carte revient, rien n'est compté.
        setHistory((h) => h.filter((e) => e !== entry));
        setCounts((c) =>
          value === "skip" ? { ...c, skipped: c.skipped - 1 } : { ...c, answered: c.answered - 1 }
        );
        if (card.family === familyRef.current) {
          setQueue((prev) => (prev.some((c) => c.key === card.key) ? prev : [card, ...prev]));
        }
        showError(ERROR_MESSAGE[err.message] ?? "La réponse n'a pas été enregistrée.");
      });
    },
    [queue, showError, press]
  );

  const undoLast = useCallback(async () => {
    const entry = history[history.length - 1];
    if (!entry) return;

    setHistory((h) => h.slice(0, -1));
    setCounts((c) =>
      entry.answer === "skip" ? { ...c, skipped: c.skipped - 1 } : { ...c, answered: c.answered - 1 }
    );
    if (entry.card.family === familyRef.current) {
      setQueue((prev) => [entry.card, ...prev.filter((c) => c.key !== entry.card.key)]);
    }

    const undo = await entry.undo;
    if (!undo || undo.kind === "none") return;
    const res = await fetch("/api/triage/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ undo }),
    }).catch(() => null);
    if (!res?.ok) showError("L'annulation n'a pas pu être appliquée.");
  }, [history, showError]);

  // FR-5 : 1 / ← je n'aime pas, 2 / → j'aime, 3 passer ; Ctrl+Z annule.
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
      if (e.key === "1" || e.key === "ArrowLeft") {
        e.preventDefault();
        answer("dislike", null);
      } else if (e.key === "2" || e.key === "ArrowRight") {
        e.preventDefault();
        answer("like", null);
      } else if (e.key === "3") {
        e.preventDefault();
        answer("skip", null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [answer, undoLast]);

  // ---------- balayage (FR-5, mobile ; marche aussi à la souris) ----------

  function onPointerDown(e: ReactPointerEvent<HTMLDivElement>) {
    if (e.button !== 0 || !queue[0]) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setInstant(false);
    drag.current = {
      pointerId: e.pointerId,
      startX: e.clientX,
      width: e.currentTarget.getBoundingClientRect().width,
      lastX: e.clientX,
      lastT: e.timeStamp,
      velocity: 0,
    };
    setDragX(0);
  }

  function onPointerMove(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.velocity = (e.clientX - d.lastX) / dt;
    d.lastX = e.clientX;
    d.lastT = e.timeStamp;
    setDragX(e.clientX - d.startX);
  }

  function onPointerEnd(e: ReactPointerEvent<HTMLDivElement>) {
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    const dx = e.clientX - d.startX;
    // Assez loin, ou lancé franchement : la réponse part. Sinon la carte revient.
    const far = Math.abs(dx) > Math.min(120, d.width * 0.3);
    const flung = Math.abs(dx) > 40 && Math.abs(d.velocity) > 0.6 && Math.sign(d.velocity) === Math.sign(dx);
    if (e.type !== "pointercancel" && (far || flung)) {
      answer(dx > 0 ? "like" : "dislike", dx);
    } else {
      setDragX(null);
    }
  }

  const copy = COPY[family];
  const current = queue[0] ?? null;
  const last = history[history.length - 1] ?? null;
  const threshold = 110;
  const stampOpacity = dragX === null ? 0 : Math.min(1, Math.abs(dragX) / threshold);

  const chooseFamily = (next: TriageFamily) => {
    setFamily(next);
    remember(FAMILY_STORAGE_KEY, next);
  };

  // En-tête de la fenêtre (la « recherche » de la palette) : ce qu'on trie, et sa catégorie. Sur
  // téléphone, le choix de la famille perd ses icônes pour tenir sur une ligne dans la fenêtre.
  const head = (
    <div className="flex flex-wrap items-center justify-center gap-2 sm:justify-between">
      <div className="sm:hidden">
        <Tabs label="Que trier" options={FAMILIES_COMPACT} value={family} onChange={chooseFamily} />
      </div>
      <div className="hidden sm:block">
        <Tabs label="Que trier" options={FAMILIES} value={family} onChange={chooseFamily} />
      </div>
      {/* FR-3 : les deux familles de titres acceptent le filtre de catégorie. */}
      {family !== "person" && (
        <Tabs
          label="Catégorie"
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
  );

  return (
    <CommandLayout>
      <header className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-heading-sm font-medium text-foreground">{copy.question}</h1>
        <p className="text-sm text-muted sm:hidden">Balaie la carte, ou utilise les boutons</p>
      </header>

      <CommandWindow
        head={head}
        className="max-w-3xl"
        context={
          <>
            <Layers size={14} aria-hidden="true" className="shrink-0" />
            <span className="truncate" aria-live="polite">
              {counts.answered > 0 || counts.skipped > 0 ? (
                <>
                  <span className="font-medium text-foreground">{counts.answered}</span> trié
                  {counts.answered > 1 ? "s" : ""}
                  {counts.skipped > 0 && ` · ${counts.skipped} passé${counts.skipped > 1 ? "s" : ""}`}
                </>
              ) : (
                "Une carte à la fois"
              )}
            </span>
          </>
        }
        primary={{ label: "Annuler", keys: ["Ctrl", "Z"], onClick: undoLast, disabled: !last }}
      >
        {/* La pile : carte du dessus, la suivante qui dépasse derrière, et celle qui s'en va. */}
        <div className="p-3 pb-7 sm:p-4 sm:pb-8">
          <div className="relative h-[calc(min(40dvh,440px)+128px)] w-full sm:h-[330px]">
            {queue.slice(0, 2).map((card, index) => {
              const top = index === 0;
              const style: CSSProperties = top
                ? {
                    transform:
                      dragX === null ? "none" : `translateX(${dragX}px) rotate(${dragX / 22}deg)`,
                    transition: dragX === null ? undefined : "none",
                    touchAction: "pan-y",
                  }
                : { transform: "translateY(14px) scale(0.95)", opacity: 0.45 };
              return (
                <div
                  key={card.key}
                  // La carte du dessous est un décor : hors de l'arbre d'accessibilité et du focus.
                  aria-hidden={!top}
                  inert={!top}
                  className={cn(
                    "absolute inset-0 select-none",
                    !instant && "transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none",
                    top ? "z-10 cursor-grab active:cursor-grabbing" : "pointer-events-none z-0"
                  )}
                  style={style}
                  {...(top
                    ? {
                        onPointerDown,
                        onPointerMove,
                        onPointerUp: onPointerEnd,
                        onPointerCancel: onPointerEnd,
                      }
                    : {})}
                >
                  <CardFace card={card} covered={services.covered} interactive={top} />
                  {top && dragX !== null && dragX !== 0 && (
                    <Stamp kind={dragX > 0 ? "like" : "dislike"} opacity={stampOpacity} />
                  )}
                </div>
              );
            })}

            {leaving && (
              <div
                key={`leaving-${leaving.card.key}`}
                aria-hidden="true"
                inert
                className="triage-leave pointer-events-none absolute inset-0 z-20"
                style={
                  {
                    "--from-x": `${leaving.fromX}px`,
                    "--from-rot": `${leaving.fromX / 22}deg`,
                    "--to-x": leaving.answer === "skip" ? "0px" : leaving.answer === "like" ? "130%" : "-130%",
                    "--to-y": leaving.answer === "skip" ? "-28px" : "0px",
                    "--to-rot": leaving.answer === "skip" ? "0deg" : leaving.answer === "like" ? "14deg" : "-14deg",
                  } as CSSProperties
                }
                onAnimationEnd={() => setLeaving(null)}
              >
                <CardFace card={leaving.card} covered={services.covered} interactive={false} />
                {leaving.answer !== "skip" && <Stamp kind={leaving.answer} opacity={1} />}
              </div>
            )}

            {!current && loading && <SkeletonCard />}

            {!current && !loading && exhausted && (
              <div className="absolute inset-0 flex items-center justify-center">
                <EmptyState
                  icon={<Layers size={20} aria-hidden="true" />}
                  title={copy.empty}
                  action={
                    <div className="flex flex-wrap justify-center gap-2">
                      {FAMILIES.filter((f) => f.value !== family).map((f) => (
                        <Button
                          key={f.value}
                          variant="secondary"
                          size="sm"
                          onClick={() => chooseFamily(f.value)}
                        >
                          <f.icon size={14} aria-hidden="true" />
                          {f.label}
                        </Button>
                      ))}
                    </div>
                  }
                />
              </div>
            )}
          </div>
        </div>
      </CommandWindow>

      {/* FR-5 : deux grands boutons, « non » à gauche et « oui » à droite, « passer » entre eux,
          chacun avec sa touche. Sur mobile ils restent collés en bas de l'écran, même quand la
          carte dépasse. */}
      <div className="sticky bottom-[var(--bottom-nav-h)] z-30 -mb-4 flex w-full justify-center bg-gradient-to-t from-background from-70% to-transparent pb-4 pt-5 sm:static sm:mb-0 sm:bg-none sm:p-0">
        <div className="grid w-full max-w-3xl grid-cols-[1fr_auto_1fr] items-stretch gap-2 sm:gap-3">
          <AnswerButton
            onClick={() => answer("dislike", 0)}
            disabled={!current}
            icon={ThumbsDown}
            label={copy.dislike}
            effect={copy.dislikeEffect}
            shortcut={KEY_OF.dislike}
            pressed={pressed === KEY_OF.dislike}
          />
          <Card
            as="button"
            type="button"
            variant="tile"
            onClick={() => answer("skip", 0)}
            disabled={!current}
            aria-keyshortcuts={KEY_OF.skip}
            className="flex min-h-16 items-center justify-center gap-3 px-3 text-sm font-medium text-muted hover:text-foreground disabled:opacity-40 max-sm:bg-surface sm:px-4"
          >
            <Keycap pressed={pressed === KEY_OF.skip} aria-hidden="true" className="hidden sm:inline-flex">
              {KEY_OF.skip}
            </Keycap>
            Passer
          </Card>
          <AnswerButton
            onClick={() => answer("like", 0)}
            disabled={!current}
            icon={ThumbsUp}
            label={copy.like}
            effect={copy.likeEffect}
            shortcut={KEY_OF.like}
            pressed={pressed === KEY_OF.like}
            end
          />
        </div>
      </div>

      {/* Retour de la dernière réponse : au clavier, c'est le seul signe visible. */}
      <p className="-mt-2 min-h-5 text-center text-xs text-muted" aria-live="polite">
        {last &&
          (last.answer === "skip"
            ? `« ${cardTitle(last.card)} » passé`
            : `« ${cardTitle(last.card)} » ${
                last.answer === "like" ? COPY[last.card.family].likedAs : COPY[last.card.family].dislikedAs
              }`)}
      </p>

      {error && <Toast>{error}</Toast>}
    </CommandLayout>
  );
}

/** Une réponse : sa touche, son libellé et son effet. `end` : la réponse de droite, en miroir. */
function AnswerButton({
  onClick,
  disabled,
  icon: Icon,
  label,
  effect,
  shortcut,
  pressed,
  end = false,
}: {
  onClick: () => void;
  disabled: boolean;
  icon: LucideIcon;
  label: string;
  effect: string;
  shortcut: string;
  pressed: boolean;
  end?: boolean;
}) {
  return (
    <Card
      as="button"
      type="button"
      variant="tile"
      onClick={onClick}
      disabled={disabled}
      aria-keyshortcuts={shortcut}
      // Fond opaque sur mobile : les boutons flottent au-dessus de la carte.
      className={cn(
        "flex min-h-16 min-w-0 items-center justify-center gap-3 px-2 py-2.5 disabled:opacity-40 max-sm:bg-surface sm:px-3",
        end ? "sm:flex-row-reverse sm:justify-start sm:text-right" : "sm:justify-start"
      )}
    >
      <Keycap pressed={pressed} aria-hidden="true" className="hidden sm:inline-flex">
        {shortcut}
      </Keycap>
      <span className={cn("flex min-w-0 flex-col items-center gap-0.5", end ? "sm:items-end" : "sm:items-start")}>
        <span className="flex items-center gap-2 whitespace-nowrap text-sm font-medium text-foreground sm:text-base">
          <Icon size={16} aria-hidden="true" />
          {label}
        </span>
        <span className="whitespace-nowrap text-xs text-muted">{effect}</span>
      </span>
    </Card>
  );
}

/** Tampon « Oui » ou « Non » pendant le balayage : neutre, le libellé et le côté disent la réponse. */
function Stamp({ kind, opacity }: { kind: "like" | "dislike"; opacity: number }) {
  return (
    <span
      aria-hidden="true"
      style={{ opacity }}
      className={cn(
        "pointer-events-none absolute top-5 z-10 rounded-control border-2 border-foreground bg-overlay px-3 py-1 text-lg font-semibold uppercase tracking-wider text-foreground",
        kind === "like" ? "left-5 -rotate-12" : "right-5 rotate-12"
      )}
    >
      {kind === "like" ? "Oui" : "Non"}
    </span>
  );
}

function CardImage({ src, alt, fallback }: { src: string | null; alt: string; fallback: string }) {
  return src ? (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} draggable={false} className="h-full w-full object-cover" />
  ) : (
    <div className="flex h-full w-full items-center justify-center text-heading font-medium text-muted">
      {fallback}
    </div>
  );
}

/** `interactive` : faux pour les cartes de décor (dessous de la pile, carte qui part). */
function CardFace({ card, covered, interactive }: { card: TriageCard; covered: Set<number>; interactive: boolean }) {
  const title = cardTitle(card);
  const image = card.family === "person" ? card.photoUrl : card.posterUrl;
  const fallback =
    card.family === "person"
      ? title
          .split(" ")
          .map((w) => w[0])
          .slice(0, 2)
          .join("")
      : "🎬";

  let meta: string;
  if (card.family === "person") {
    meta = card.roles.map((r) => ROLE_LABEL[r]).join(" · ");
  } else if (card.family === "seen") {
    const kind = card.category === "Movie" ? "Film" : card.category === "TV Series" ? "Série" : "Documentaire";
    meta = [card.year, kind].filter(Boolean).join(" · ");
  } else {
    const kind = card.mediaType === "Movie" ? "Film" : "Série";
    const vote = card.voteAverage ? `${card.voteAverage.toFixed(1).replace(".", ",")} TMDB` : null;
    meta = [card.year, kind, vote].filter(Boolean).join(" · ");
  }

  const services = card.family === "unseen" ? includedIn(card.availability, covered) : [];

  return (
    <Card as="article" className="flex h-full flex-col overflow-hidden sm:flex-row">
      <div className="relative h-[min(40dvh,440px)] w-full shrink-0 bg-surface-2 sm:h-full sm:w-[220px]">
        <CardImage src={image} alt={title} fallback={fallback} />
        {/* La bande-annonce sert à trancher « ça me tente ? » : en évidence, sur l'affiche. */}
        {interactive && card.family !== "person" && (
          <div className="absolute right-3 top-3 z-10">
            <TrailerButton trailer={card.trailer} title={card.title} className={buttonClass({ variant: "overlay" })} />
          </div>
        )}
        {/* Sur mobile, le titre vit sur l'affiche pour laisser la place au texte dessous. */}
        <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-background/90 via-background/60 to-transparent p-4 pt-12 sm:hidden">
          <h2 className="line-clamp-2 text-lg font-medium leading-tight text-foreground">{title}</h2>
          {meta && <p className="mt-1 text-xs text-contrast-foreground">{meta}</p>}
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-4 sm:p-5">
        <div className="hidden sm:block">
          <h2 className="line-clamp-2 text-subheading font-medium text-foreground">{title}</h2>
          {meta && <p className="mt-1 text-sm text-muted">{meta}</p>}
        </div>

        {card.family === "unseen" && (card.seeds.length > 0 || card.compatibility !== null || card.release) && (
          <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
            <CompatibilityChip value={card.compatibility} size="md" />
            <ReleaseBadge release={card.release} />
            {card.seeds.length > 0 && (
              <span className="flex min-w-0 items-center gap-1.5">
                <Sparkles size={13} className="shrink-0" aria-hidden="true" />
                <span className="line-clamp-1">
                  Parce que tu as aimé {card.seeds.slice(0, 2).join(" et ")}
                </span>
              </span>
            )}
          </div>
        )}

        {card.family === "person" ? (
          <div className="flex min-h-0 flex-col gap-2">
            <p className="text-sm text-foreground">
              Dans <span className="font-semibold">{card.seenIn.length}</span> de tes titres vus
            </p>
            <ul className="flex flex-wrap items-center gap-1.5 overflow-hidden">
              {card.seenIn.slice(0, 6).map((t) => (
                <li key={t} className="max-w-full">
                  <Badge className="max-w-full truncate">{t}</Badge>
                </li>
              ))}
              {card.seenIn.length > 6 && <li className="px-1 text-xs text-muted">+{card.seenIn.length - 6}</li>}
            </ul>
          </div>
        ) : (
          card.overview && (
            <p className="line-clamp-3 text-sm leading-relaxed text-muted sm:line-clamp-6">{card.overview}</p>
          )
        )}

        {services.length > 0 && (
          <div className="mt-auto flex items-center gap-2 pt-1 text-xs text-muted">
            <span className="flex -space-x-1">
              {services.slice(0, 3).map((p) => (
                <ProviderLogo key={p.id} provider={p} size={20} />
              ))}
            </span>
            Sur {services.map((p) => p.name).join(", ")}
          </div>
        )}
      </div>
    </Card>
  );
}

function SkeletonCard() {
  return (
    <Card aria-hidden="true" className="absolute inset-0 flex flex-col overflow-hidden sm:flex-row">
      <Skeleton className="h-[min(40dvh,440px)] w-full shrink-0 rounded-none sm:h-full sm:w-[220px]" />
      <div className="flex flex-1 flex-col gap-3 p-5">
        <Skeleton className="h-5 w-2/3" />
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="mt-2 h-3 w-full" />
        <Skeleton className="h-3 w-5/6" />
      </div>
    </Card>
  );
}

