"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowLeft, ArrowRight, CheckCircle2, Film, Scale } from "lucide-react";
import { Badge, Button, Card, Keycap, MetaRow, Skeleton, type Action } from "@/components/ui";
import { CommandWindow, EmptyState } from "@/components/sections";
import { cn } from "@/lib/utils";
import type { Band, TierItem, TierStep } from "@/lib/tierDuelService";
import { genreLine } from "@/lib/genres";

// Départage d'un palier — spec: specs/classement-v1.md (FR-1, FR-7 à FR-11)
// Présentation : fenêtre de commande (design-system-v2 § 7, HeroLayout en scène), touches affichées.

type StepResponse = TierStep;
type PlayableStep = Extract<TierStep, { step: "band" } | { step: "quad" }>;

/** Ce qu'il faut pour annuler un tour et remettre son écran. */
type Round = { roundId: number; step: PlayableStep };

/** Pause entre deux étapes ou deux groupes (FR-11 : chaque groupe fini s'annonce). */
type Pause = { title: string; detail: string; next: string };

const BAND_LABEL: Record<Band, string> = { 0: "Bas", 1: "Milieu", 2: "Haut" };
const GROUP_NAME: Record<Band, string> = { 0: "le bas", 1: "le milieu", 2: "le haut" };
/** Touche de chaque groupe (FR-9) : 1 / ← le bas, 2 / ↓ le milieu, 3 / → le haut. */
const BAND_KEY: Record<Band, string> = { 0: "1", 1: "2", 2: "3" };
const HISTORY_MAX = 30;
/** FR-7 : nombre de comparaisons qui départage un titre (TIER_SETTLED_DUELS). */
const SETTLED = 5;
/** Durée pendant laquelle une touche affichée reste enfoncée (spec § 4.1, `--dur-instant`). */
const PRESS_MS = 100;

/**
 * Touche affichée enfoncée pendant 100 ms, quand on presse la touche ou qu'on clique son bouton
 * (spec design-system-v2 § 4.2, règle 4 : seule la touche bouge, jamais le résultat).
 */
export function usePressedKey(): [string | null, (key: string) => void] {
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

export function TierFlow({
  head,
  stars,
  starsLabel,
  category,
  categoryPlural,
  onChooseTier,
  tierLabelOf,
}: {
  /** En-tête de la fenêtre : le choix du mode, du palier et de la catégorie. */
  head: ReactNode;
  stars: string;
  /** « ★★★★ » ou « 💩 ». */
  starsLabel: string;
  category: string;
  categoryPlural: string | null;
  onChooseTier: (next: string) => void;
  tierLabelOf: (stars: string) => string;
}) {
  const [step, setStep] = useState<StepResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [refine, setRefine] = useState(false);
  const [bestId, setBestId] = useState<number | null>(null);
  const [history, setHistory] = useState<Round[]>([]);
  const [pause, setPause] = useState<Pause | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pressed, press] = usePressedKey();
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Dernière étape jouée : sert à annoncer la fin de la répartition ou d'un groupe. */
  const lastPlayed = useRef<{ kind: "band" | "quad"; group: Band | null } | null>(null);

  const showNotice = useCallback((message: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = setTimeout(() => setNotice(null), 4000);
  }, []);

  useEffect(() => {
    return () => {
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    };
  }, []);

  const loadNext = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams({ stars });
    if (category) params.set("category", category);
    if (refine) params.set("refine", "1");
    const res = await fetch(`/api/duels/tier/next?${params}`);
    const next: StepResponse = await res.json();
    setBestId(null);

    // FR-11 : une étape ou un groupe vient de se terminer ? On le dit avant d'enchaîner.
    const previous = lastPlayed.current;
    if (previous && "step" in next) {
      if (previous.kind === "band" && next.step === "quad") {
        setPause({
          title: "Tout est réparti",
          detail: `Les titres ${starsLabel} sont rangés en Haut, Milieu et Bas. On affine maintenant le haut du palier, là où l'ordre compte le plus.`,
          next: "Affiner le haut",
        });
      } else if (
        previous.kind === "quad" &&
        previous.group !== null &&
        next.step === "quad" &&
        next.group !== null &&
        next.group !== previous.group
      ) {
        setPause({
          title: `${GROUP_NAME[previous.group].replace(/^le /, "Le ")} du palier est départagé`,
          detail: "Tu peux t'arrêter là : le classement est déjà ordonné pour ce groupe.",
          next: `Continuer avec ${GROUP_NAME[next.group]}`,
        });
      }
    }
    setStep(next);
    setLoading(false);
  }, [stars, category, refine, starsLabel]);

  useEffect(() => {
    // Nouveau palier ou nouvelle catégorie : on repart de l'étape en cours côté serveur.
    lastPlayed.current = null;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadNext();
  }, [loadNext]);

  const send = useCallback(async (url: string, body: Record<string, unknown>, played: PlayableStep) => {
    setSubmitting(true);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).catch(() => null);
    const result: { roundId?: number } | null = res ? await res.json().catch(() => null) : null;
    setSubmitting(false);

    if (res?.ok && typeof result?.roundId === "number") {
      setHistory((h) => [...h.slice(-(HISTORY_MAX - 1)), { roundId: result.roundId!, step: played }]);
      lastPlayed.current = { kind: played.step, group: played.step === "quad" ? played.group : null };
    } else if (res?.status === 409) {
      showNotice("Une note a changé entre-temps : on passe à la suite.");
    } else {
      showNotice("La réponse n'a pas été enregistrée.");
    }
    loadNext();
  }, [loadNext, showNotice]);

  const placeBand = useCallback(
    (band: Band) => {
      if (!step || !("step" in step) || step.step !== "band" || submitting) return;
      press(BAND_KEY[band]);
      send("/api/duels/tier/band", { itemId: step.item.id, stars: Number(stars), band }, step);
    },
    [step, submitting, stars, send, press]
  );

  /** FR-10 : premier choix = le meilleur ; second = le moins bon (null : « Passer »). */
  const pickInQuad = useCallback(
    (id: number | null) => {
      if (!step || !("step" in step) || step.step !== "quad" || submitting) return;
      const index = step.items.findIndex((i) => i.id === id);
      if (index >= 0) press(String(index + 1));
      if (bestId === null) {
        if (id === null) return;
        // Deux titres seulement : désigner le meilleur suffit.
        if (step.items.length === 2) {
          send(
            "/api/duels/tier/quad",
            { itemIds: step.items.map((i) => i.id), stars: Number(stars), bestId: id, worstId: null },
            step
          );
          return;
        }
        setBestId(id);
        return;
      }
      if (id === bestId) {
        setBestId(null);
        return;
      }
      send(
        "/api/duels/tier/quad",
        { itemIds: step.items.map((i) => i.id), stars: Number(stars), bestId, worstId: id },
        step
      );
    },
    [step, submitting, bestId, stars, send, press]
  );

  /** FR-10 : « Je ne sais pas départager le reste » : le meilleur seul est retenu. */
  const passRest = useCallback(() => {
    if (!step || !("step" in step) || step.step !== "quad" || bestId === null || submitting) return;
    send(
      "/api/duels/tier/quad",
      { itemIds: step.items.map((i) => i.id), stars: Number(stars), bestId, worstId: null },
      step
    );
  }, [step, bestId, stars, submitting, send]);

  /** Duel du départage : « Passer » tire une autre paire, sans rien enregistrer. */
  const skipPair = useCallback(() => {
    if (!step || !("step" in step) || step.step !== "quad" || bestId !== null || submitting) return;
    press("Espace");
    void loadNext();
  }, [step, bestId, submitting, press, loadNext]);

  /** FR-1 : défait le dernier tour (répartition ou quatuor) et remet son écran. */
  const undoLast = useCallback(async () => {
    if (bestId !== null) {
      setBestId(null);
      return;
    }
    const last = history[history.length - 1];
    if (!last || submitting) return;
    setSubmitting(true);
    const res = await fetch("/api/duels/undo", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "round", duelId: last.roundId }),
    }).catch(() => null);
    setSubmitting(false);
    setHistory((h) => h.slice(0, -1));
    if (!res?.ok) {
      showNotice("Ce choix ne peut plus être annulé : ses titres ont bougé depuis.");
      return;
    }
    const before = history[history.length - 2];
    lastPlayed.current = before
      ? { kind: before.step.step, group: before.step.step === "quad" ? before.step.group : null }
      : null;
    setPause(null);
    setStep(last.step);
    showNotice("Choix annulé.");
  }, [bestId, history, submitting, showNotice]);

  // Clavier : répartir 1 / 2 / 3 (ou ← ↓ →) ; quatuors 1 à 4, Espace pour passer ; Ctrl+Z.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea, select, [contenteditable]")) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undoLast();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
      if (pause) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          setPause(null);
        }
        return;
      }
      if (!step || !("step" in step)) return;
      if (step.step === "band") {
        const band = ({ "1": 0, "2": 1, "3": 2, ArrowLeft: 0, ArrowDown: 1, ArrowRight: 2 } as Record<string, Band>)[e.key];
        if (band !== undefined) {
          e.preventDefault();
          placeBand(band);
        }
      } else if (step.step === "quad") {
        const index = Number(e.key) - 1;
        if (Number.isInteger(index) && index >= 0 && index < step.items.length) {
          e.preventDefault();
          pickInQuad(step.items[index].id);
        } else if (e.key === " " && bestId !== null) {
          e.preventDefault();
          passRest();
        } else if (e.key === " " && step.items.length === 2) {
          e.preventDefault();
          skipPair();
        } else if (e.key === "Escape") {
          setBestId(null);
        }
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step, pause, bestId, placeBand, pickInQuad, passRest, skipPair, undoLast]);

  const last = history[history.length - 1] ?? null;

  // Barre d'actions : à gauche le retour du dernier choix (au clavier, c'est le seul signe
  // visible), à droite l'action du moment et l'annulation, avec leurs touches.
  const context = (
    <>
      <Scale size={14} aria-hidden="true" className="shrink-0" />
      <span className="truncate" aria-live="polite" title={notice ?? undefined}>
        {notice ?? `Départager les ${starsLabel}`}
      </span>
    </>
  );
  const undo: Action = {
    label: "Annuler",
    keys: ["Ctrl", "Z"],
    onClick: undoLast,
    disabled: submitting || (!last && bestId === null),
  };
  let primary: Action | undefined;
  let secondary: Action[] = [];
  if (pause) {
    primary = { label: pause.next, keys: ["↵"], onClick: () => setPause(null) };
  } else if (step && "step" in step && step.step === "quad" && bestId !== null) {
    primary = { label: "Passer le reste", keys: ["Espace"], onClick: passRest, disabled: submitting };
    secondary = [undo];
  } else if (step && "step" in step && step.step === "quad" && step.items.length === 2) {
    primary = { label: "Passer", keys: ["Espace"], onClick: skipPair, disabled: submitting };
    secondary = [undo];
  } else {
    primary = undo;
  }

  function renderBody() {
    if (!step) return <TierSkeleton />;

    if ("error" in step) {
      return (
        <EmptyState icon={<Film size={20} aria-hidden="true" />} title={`Rien à départager parmi les titres notés ${starsLabel}`}>
          Il faut au moins deux titres vus avec cette note{categoryPlural ? ` parmi ${categoryPlural}` : ""}.
          Actuellement : {step.eligibleCount}.
        </EmptyState>
      );
    }

    const scope = step.scope;
    const progress =
      step.step === "band"
        ? { label: "Étape 1 sur 2 · Répartir", done: scope.placed, total: scope.titles, unit: "répartis" }
        : step.step === "quad" && step.group !== null
          ? {
              label: `Étape 2 sur 2 · Affiner ${GROUP_NAME[step.group]}`,
              done: step.groupScope.settled,
              total: step.groupScope.titles,
              unit: "départagés",
            }
          : { label: refine ? "Affiner encore" : "Départager", done: scope.settled, total: scope.titles, unit: "départagés" };

    return (
      <>
        {/* Avancement : étape à gauche, barre et compte à droite (sur téléphone, la barre passe
            dessous, pleine largeur). */}
        {step.step !== "done" && (
          <div className="flex flex-col gap-2 text-xs text-muted sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <span className="flex items-center justify-between gap-3">
              <span className="font-medium text-foreground">{progress.label}</span>
              <span className="tabular-nums sm:hidden">
                {progress.done} sur {progress.total}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <span
                className="h-1 flex-1 overflow-hidden rounded-full bg-divider sm:w-32 sm:flex-none"
                role="img"
                aria-label={`${progress.done} sur ${progress.total} ${progress.unit}`}
              >
                {/* Pas de transition : la barre avance au clavier (règle 4, rien ne s'anime). */}
                <span
                  className="block h-full rounded-full bg-muted"
                  style={{ width: `${(progress.done / Math.max(1, progress.total)) * 100}%` }}
                />
              </span>
              <span className="hidden tabular-nums sm:inline">
                {progress.done} sur {progress.total} {progress.unit}
              </span>
              <Button variant="ghost" size="sm" href={`/classement#palier-${stars}`}>
                Voir le classement
              </Button>
            </span>
          </div>
        )}

        {pause ? (
          <EmptyState
            icon={<CheckCircle2 size={20} aria-hidden="true" />}
            title={pause.title}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" size="lg" onClick={() => setPause(null)}>
                  {pause.next}
                </Button>
                <Button variant="secondary" size="lg" href={`/classement#palier-${stars}`}>
                  Voir le classement
                </Button>
              </div>
            }
          >
            {pause.detail}
          </EmptyState>
        ) : step.step === "done" ? (
          <EmptyState
            icon={<CheckCircle2 size={20} aria-hidden="true" />}
            title={`Les titres notés ${starsLabel} sont départagés`}
            action={
              <div className="flex flex-wrap justify-center gap-2">
                <Button variant="primary" size="lg" href={`/classement#palier-${stars}`}>
                  Voir le classement
                </Button>
                {step.nextTier !== null && (
                  <Button variant="secondary" size="lg" onClick={() => onChooseTier(String(step.nextTier))}>
                    Départager les {tierLabelOf(String(step.nextTier))}
                  </Button>
                )}
                <Button variant="ghost" size="lg" onClick={() => setRefine(true)}>
                  Affiner encore
                </Button>
              </div>
            }
          >
            {scope.titles} titre{scope.titles > 1 ? "s" : ""}
            {categoryPlural ? ` (${categoryPlural})` : ""}, chacun comparé au moins {SETTLED} fois à des titres de
            même note. Leur ordre est dans le classement.
          </EmptyState>
        ) : step.step === "band" ? (
          <BandCard
            item={step.item}
            starsLabel={starsLabel}
            disabled={submitting || loading}
            pressed={pressed}
            onPlace={placeBand}
          />
        ) : (
          <QuadBoard
            items={step.items}
            bestId={bestId}
            disabled={submitting || loading}
            pressed={pressed}
            onPick={pickInQuad}
          />
        )}
      </>
    );
  }

  return (
    <CommandWindow head={head} context={context} primary={primary} secondary={secondary} className="max-w-3xl">
      <div className="flex flex-col gap-6 p-4 sm:p-6">{renderBody()}</div>
    </CommandWindow>
  );
}

function TierSkeleton() {
  return (
    <div className="flex items-center gap-4 sm:items-stretch sm:gap-8">
      <Skeleton className="aspect-[2/3] w-24 shrink-0 rounded-frame sm:w-40" />
      <div className="flex flex-1 flex-col gap-3 sm:justify-center">
        <Skeleton className="h-6 w-1/2" />
        <Skeleton className="h-4 w-1/4" />
        <Skeleton className="mt-2 hidden h-12 w-full rounded-frame sm:block" />
        <Skeleton className="hidden h-12 w-full rounded-frame sm:block" />
        <Skeleton className="hidden h-12 w-full rounded-frame sm:block" />
      </div>
    </div>
  );
}

function Poster({ item, className }: { item: TierItem; className: string }) {
  return (
    <div className={cn("poster", className)}>
      {item.posterUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={item.posterUrl} alt={item.name} draggable={false} className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center text-muted">
          <Film size={24} aria-hidden="true" />
        </div>
      )}
    </div>
  );
}

/**
 * FR-9 : une carte, trois places. Sur ordinateur, une échelle à droite de l'affiche (Haut en haut),
 * chaque place avec sa touche ; sur mobile, trois boutons en ligne sous l'affiche (Bas à gauche,
 * Haut à droite).
 */
function BandCard({
  item,
  starsLabel,
  disabled,
  pressed,
  onPlace,
}: {
  item: TierItem;
  starsLabel: string;
  disabled: boolean;
  pressed: string | null;
  onPlace: (band: Band) => void;
}) {
  const buttons: { band: Band; icon: typeof ArrowLeft }[] = [
    { band: 0, icon: ArrowLeft },
    { band: 1, icon: ArrowDown },
    { band: 2, icon: ArrowRight },
  ];

  // Pas d'animation d'entrée : la carte suivante arrive au clavier (règle 4).
  return (
    <div className="flex w-full flex-col gap-4">
      <div className="flex items-center gap-4 sm:items-stretch sm:gap-8">
        <Poster item={item} className="aspect-[2/3] w-24 shrink-0 sm:w-40" />

        <div className="flex min-w-0 flex-1 flex-col gap-4 sm:justify-center">
          <div>
            <h2 className="text-lg text-foreground">{item.name}</h2>
            {(item.year || item.genres.length > 0) && (
              <MetaRow className="text-sm" items={[item.year, genreLine(item.genres)]} />
            )}
            <p className="mt-2 text-sm text-muted">Où le places-tu parmi tes {starsLabel} ?</p>
          </div>

          {/* Ordinateur : une échelle, Haut en haut, chaque place avec sa touche. */}
          <BandLadder buttons={buttons} disabled={disabled} pressed={pressed} onPlace={onPlace} />
        </div>
      </div>

      {/* Mobile : Bas, Milieu, Haut, de gauche à droite, sous l'affiche. */}
      <div className="grid w-full grid-cols-3 gap-2 sm:hidden">
        {buttons.map(({ band }) => (
          <Card
            key={band}
            as="button"
            type="button"
            variant="tile"
            onClick={() => onPlace(band)}
            disabled={disabled}
            className="flex min-h-14 items-center justify-center px-2 text-sm font-medium text-foreground"
          >
            {BAND_LABEL[band]}
          </Card>
        ))}
      </div>
    </div>
  );
}

function BandLadder({
  buttons,
  disabled,
  pressed,
  onPlace,
}: {
  buttons: { band: Band; icon: typeof ArrowLeft }[];
  disabled: boolean;
  pressed: string | null;
  onPlace: (band: Band) => void;
}) {
  return (
    <div className="hidden flex-col gap-2 sm:flex">
      {[...buttons].reverse().map(({ band, icon: Icon }) => (
        <Card
          key={band}
          as="button"
          type="button"
          variant="tile"
          onClick={() => onPlace(band)}
          disabled={disabled}
          aria-keyshortcuts={BAND_KEY[band]}
          className="flex min-h-14 items-center justify-between gap-3 py-2 pl-4 pr-2"
        >
          <span className="text-base font-medium text-foreground">
            {band === 1 ? "Milieu" : `${BAND_LABEL[band]} du palier`}
          </span>
          <span className="flex items-center gap-3 text-muted">
            <Icon size={14} aria-hidden="true" />
            <Keycap pressed={pressed === BAND_KEY[band]} aria-hidden="true">
              {BAND_KEY[band]}
            </Keycap>
          </span>
        </Card>
      ))}
    </div>
  );
}

/** FR-10 : le meilleur des quatre, puis le moins bon. */
function QuadBoard({
  items,
  bestId,
  disabled,
  pressed,
  onPick,
}: {
  items: TierItem[];
  bestId: number | null;
  disabled: boolean;
  pressed: string | null;
  onPick: (id: number) => void;
}) {
  const choosingWorst = bestId !== null;
  return (
    <div className="flex w-full flex-col items-center gap-4">
      <h2 className="text-base text-foreground" aria-live="polite">
        {choosingWorst ? "Et le moins bon ?" : items.length === 2 ? "Lequel est au-dessus ?" : "Le meilleur des " + items.length + " ?"}
      </h2>
      {/* Mobile : cases compactes (petite affiche, titre à côté) pour voir les quatre d'un coup.
          Ordinateur : grandes affiches côte à côte, chacune avec sa touche. */}
      <div
        className={cn(
          "grid w-full grid-cols-2 gap-2 sm:gap-3",
          items.length >= 4
            ? "sm:grid-cols-4"
            : items.length === 3
              ? "sm:grid-cols-3"
              : "sm:w-auto sm:grid-cols-[repeat(2,minmax(0,12rem))] sm:gap-6"
        )}
      >
        {items.map((item, index) => {
          const isBest = item.id === bestId;
          const key = String(index + 1);
          return (
            <Card
              key={item.id}
              as="button"
              type="button"
              variant="tile"
              onClick={() => onPick(item.id)}
              disabled={disabled}
              aria-pressed={isBest}
              aria-keyshortcuts={key}
              className={cn(
                "group flex min-w-0 items-center gap-2 p-1.5 text-left sm:flex-col sm:items-stretch sm:gap-0 sm:p-2",
                isBest && "bg-selection ring-1 ring-foreground"
              )}
            >
              <Poster item={item} className="aspect-[2/3] w-14 shrink-0 rounded-control sm:w-full" />
              <span className="flex min-w-0 flex-1 items-center gap-2 sm:pt-2">
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="line-clamp-2 text-sm font-medium text-foreground sm:line-clamp-1">{item.name}</span>
                  <MetaRow as="span" className="text-xs" items={[item.year, genreLine(item.genres, 1), isBest && <Badge>Meilleur</Badge>]} />
                </span>
                <Keycap pressed={pressed === key} aria-hidden="true" className="hidden sm:inline-flex">
                  {key}
                </Keycap>
              </span>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
