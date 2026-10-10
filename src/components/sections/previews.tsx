"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { ArrowRight, Check, Film, Plus, Undo2 } from "lucide-react";
import { CompatibilityChip } from "@/components/CompatibilityChip";
import { RatingKeys, ratedAs } from "@/components/RatingKeys";
import { TrailerButton } from "@/components/TrailerButton";
import { Button } from "@/components/ui/Button";
import { Badge, Card, Kbd, Keycap, MetaRow, MonoMeta, Skeleton } from "@/components/ui/primitives";
import { dayLabel, eventLabel, kindLabel } from "@/lib/calendar";
import type { CalendarEntry, CalendarResult } from "@/lib/calendarService";
import type { DuelItem } from "@/lib/duelService";
import { genreLine } from "@/lib/genres";
import type { RatingCard } from "@/lib/homeFeatures";
import type { Category } from "@/lib/libraryItem";
import type { TriageUndo } from "@/lib/triageService";

// Aperçus vivants des sections de fonctionnalité de l'accueil — fiche
// docs/design-reference/raycast/composants/vitrine.md. Chacun est une vraie commande : noter ou
// trancher ici enregistre, comme dans le Tri rapide ou les Duels, et s'annule de la même façon.
// Le clavier ne répond que dans l'aperçu (focus dedans) : la page d'accueil garde ses touches.

const CATEGORY_LABEL: Record<Category, string> = { Movie: "Film", "TV Series": "Série", Documentary: "Documentaire" };

const JSON_HEADERS = { "Content-Type": "application/json" };

function Poster({ url, className }: { url: string | null; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" loading="lazy" draggable={false} className={className} /> : null;
}

/** Touche affichée enfoncée un instant, comme dans le Tri rapide et les Duels. */
function usePressed(): [string | null, (key: string) => void] {
  const [pressed, setPressed] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const press = useCallback((key: string) => {
    setPressed(key);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setPressed(null), 150);
  }, []);
  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);
  return [pressed, press];
}

function isUndo(e: KeyboardEvent) {
  return (e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z";
}

// ---------- Notation ----------

type RatingEntry = { card: RatingCard; rating: number; undo: Promise<TriageUndo | null> };

/**
 * Un titre vu sans note, ses six notes (0 pour 💩, 1 à 5 étoiles) ; la carte suivante arrive
 * aussitôt. La scène prend la teinte de l'affiche.
 */
export function RatingPreview({ cards, remaining }: { cards: RatingCard[]; remaining: number }) {
  const [queue, setQueue] = useState(cards);
  const [left, setLeft] = useState(remaining);
  const [last, setLast] = useState<RatingEntry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pressed, press] = usePressed();
  const current = queue[0] ?? null;

  const rate = useCallback(
    (n: number) => {
      if (!current) return;
      press(String(n));
      setError(null);
      const undo = fetch("/api/triage/answer", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ card: { family: "seen", id: current.id }, answer: "like", rating: n }),
      })
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((body: { undo: TriageUndo }) => body.undo)
        .catch(() => {
          setError("La note n'a pas été enregistrée.");
          return null;
        });
      setLast({ card: current, rating: n, undo });
      setQueue((q) => q.slice(1));
      setLeft((l) => Math.max(0, l - 1));
    },
    [current, press]
  );

  const undoLast = useCallback(async () => {
    const entry = last;
    if (!entry) return;
    setLast(null);
    setError(null);
    setQueue((q) => [entry.card, ...q]);
    setLeft((l) => l + 1);
    const undo = await entry.undo;
    if (!undo || undo.kind === "none") return;
    const res = await fetch("/api/triage/undo", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ undo }),
    }).catch(() => null);
    if (!res?.ok) setError("L'annulation n'a pas pu être appliquée.");
  }, [last]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.altKey || e.repeat) return;
    if (isUndo(e)) {
      e.preventDefault();
      void undoLast();
    } else if (!e.ctrlKey && !e.metaKey && /^[0-5]$/.test(e.key)) {
      e.preventDefault();
      rate(Number(e.key));
    }
  }

  return (
    <div
      className="feature-stage"
      style={current?.tint ? ({ "--tint": current.tint } as CSSProperties) : undefined}
      onKeyDown={onKeyDown}
    >
      {current ? (
        <>
          <div className="flex items-center gap-5 sm:gap-6">
            <div className="poster aspect-[2/3] w-24 shrink-0 sm:w-32">
              <Poster url={current.posterUrl} className="h-full w-full object-cover" />
            </div>
            <div className="flex min-w-0 flex-col items-start gap-3">
              <Badge>Vu, pas encore noté</Badge>
              <div className="flex min-w-0 flex-col gap-1">
                <h3 className="line-clamp-2 text-subheading text-foreground">{current.title}</h3>
                <MetaRow>
                  <span>{CATEGORY_LABEL[current.category]}</span>
                  {current.year && <span>{current.year}</span>}
                </MetaRow>
              </div>
              <TrailerButton trailer={current.trailer} title={current.title} />
            </div>
          </div>
          <RatingKeys onRate={rate} disabled={false} pressed={pressed} fitContainer className="max-w-none" />
        </>
      ) : (
        <div className="flex flex-col items-start gap-4 py-8">
          <h3 className="text-subheading text-foreground">
            {left > 0 ? "La suite t'attend dans le Tri rapide." : "Tous tes titres vus sont notés."}
          </h3>
          <Button href={left > 0 ? "/tri?famille=seen" : "/classement"} size="sm">
            {left > 0 ? "Continuer à noter" : "Voir ton classement"}
            <ArrowRight size={14} aria-hidden="true" />
          </Button>
        </div>
      )}

      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm text-muted">
        <span aria-live="polite" className="min-w-0">
          {error ?? (last ? `« ${last.card.title} » ${ratedAs(last.rating)}` : current ? "Une note par clic, ou au clavier de 0 à 5." : "")}
        </span>
        {last && (
          <Button size="sm" variant="ghost" onClick={undoLast} aria-keyshortcuts="Control+Z">
            <Undo2 size={14} aria-hidden="true" />
            Annuler
            <span className="hidden items-center gap-1 sm:inline-flex">
              <Kbd>Ctrl</Kbd>
              <Kbd>Z</Kbd>
            </span>
          </Button>
        )}
      </div>
    </div>
  );
}

// ---------- Duels ----------

type Pair = { a: DuelItem; b: DuelItem };
type DuelChoice = "A" | "B" | "skip";

function DuelOption({
  item,
  shortcut,
  pressed,
  disabled,
  onClick,
}: {
  item: DuelItem;
  shortcut: string;
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const meta = [item.year, genreLine(item.genres, 1)];
  return (
    <Card
      as="button"
      type="button"
      variant="tile"
      onClick={onClick}
      disabled={disabled}
      aria-keyshortcuts={shortcut}
      className="mx-auto flex w-full min-w-0 max-w-52 flex-col gap-3 p-2 text-left"
    >
      <div className="poster aspect-[2/3] w-full rounded-control">
        {item.posterUrl ? (
          <Poster url={item.posterUrl} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-muted">
            <Film size={24} aria-hidden="true" />
          </div>
        )}
      </div>
      <div className="flex min-w-0 items-center gap-3 px-1 pb-1">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-2 min-h-[2lh] text-sm font-medium text-foreground">{item.name}</p>
          {meta.some(Boolean) && <MetaRow as="span" className="flex-nowrap text-xs" items={meta} />}
        </div>
        <Keycap pressed={pressed} aria-hidden="true" className="hidden sm:inline-flex">
          {shortcut}
        </Keycap>
      </div>
    </Card>
  );
}

/** Une vraie paire de tes titres vus : choisis ton préféré (1, 2), passe (3), annule (Ctrl+Z). */
export function DuelPreview({ initial }: { initial: Pair | null }) {
  const [pair, setPair] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState<{ duelId: number; pair: Pair; choice: DuelChoice } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pressed, press] = usePressed();

  const loadNext = useCallback(async () => {
    const res = await fetch("/api/duels/next").catch(() => null);
    const data: { itemA?: DuelItem; itemB?: DuelItem } | null = res?.ok ? await res.json().catch(() => null) : null;
    setPair(data?.itemA && data.itemB ? { a: data.itemA, b: data.itemB } : null);
  }, []);

  const choose = useCallback(
    async (choice: DuelChoice) => {
      if (!pair || busy) return;
      press(choice === "A" ? "1" : choice === "B" ? "2" : "3");
      setBusy(true);
      setNotice(null);
      const res = await fetch("/api/duels/result", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({ itemAId: pair.a.id, itemBId: pair.b.id, result: choice }),
      }).catch(() => null);
      const body: { duelId?: number } | null = res?.ok ? await res.json().catch(() => null) : null;
      if (typeof body?.duelId === "number") setLast({ duelId: body.duelId, pair, choice });
      else setNotice("Le duel n'a pas été enregistré.");
      await loadNext();
      setBusy(false);
    },
    [pair, busy, press, loadNext]
  );

  const undoLast = useCallback(async () => {
    if (!last || busy) return;
    setBusy(true);
    const res = await fetch("/api/duels/undo", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ mode: "titles", duelId: last.duelId }),
    }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setPair(last.pair);
      setNotice("Duel annulé.");
    } else {
      setNotice("Ce duel ne peut plus être annulé : ses titres ont bougé depuis.");
    }
    setLast(null);
  }, [last, busy]);

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.altKey || e.repeat) return;
    if (isUndo(e)) {
      e.preventDefault();
      void undoLast();
      return;
    }
    if (e.ctrlKey || e.metaKey) return;
    const choice: DuelChoice | null = e.key === "1" ? "A" : e.key === "2" ? "B" : e.key === "3" ? "skip" : null;
    if (choice) {
      e.preventDefault();
      void choose(choice);
    }
  }

  const outcome =
    last &&
    (last.choice === "skip"
      ? "Duel passé"
      : last.choice === "A"
        ? `« ${last.pair.a.name} » passe devant`
        : `« ${last.pair.b.name} » passe devant`);

  return (
    <div className="feature-stage" onKeyDown={onKeyDown}>
      {pair ? (
        <>
          <p className="text-center text-sm text-muted">Lequel préfères-tu ?</p>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3 sm:gap-5">
            <DuelOption item={pair.a} shortcut="1" pressed={pressed === "1"} disabled={busy} onClick={() => choose("A")} />
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-full bg-surface-3 text-xs font-medium text-muted"
            >
              ou
            </span>
            <DuelOption item={pair.b} shortcut="2" pressed={pressed === "2"} disabled={busy} onClick={() => choose("B")} />
          </div>
        </>
      ) : (
        <div className="flex flex-col items-start gap-4 py-8">
          <h3 className="text-subheading text-foreground">Note au moins deux titres vus pour lancer un duel.</h3>
          <Button href="/tri?famille=seen" size="sm">
            Noter mes titres vus
            <ArrowRight size={14} aria-hidden="true" />
          </Button>
        </div>
      )}

      <div className="flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2 text-sm text-muted">
        <span aria-live="polite" className="min-w-0">
          {notice ?? outcome ?? (pair ? "Clique ton préféré, ou tape 1 ou 2." : "")}
        </span>
        <div className="flex items-center gap-2">
          {last && (
            <Button size="sm" variant="ghost" onClick={undoLast} disabled={busy} aria-keyshortcuts="Control+Z">
              <Undo2 size={14} aria-hidden="true" />
              Annuler
            </Button>
          )}
          {pair && (
            <Button size="sm" onClick={() => choose("skip")} disabled={busy} aria-keyshortcuts="3">
              Passer
              <Kbd className="hidden sm:inline-flex">3</Kbd>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------- Sorties ----------

const DAY_MS = 24 * 60 * 60 * 1000;
const RELEASE_DAYS = 14;

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Les sorties des deux prochaines semaines qui te promettent le plus (ta bibliothèque d'abord),
 * jour par jour ; « Ajouter » les met dans ta pile, comme dans Sorties.
 */
export function ReleasesPreview({ limit = 4 }: { limit?: number }) {
  const [data, setData] = useState<CalendarResult | null>(null);
  const [failed, setFailed] = useState(false);
  /** Ajouts et retraits faits ici, par clé TMDB : id local, ou null si retiré. */
  const [changes, setChanges] = useState<Map<string, number | null>>(new Map());
  const [pending, setPending] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const today = new Date();
    const from = isoDay(today);
    const to = isoDay(new Date(today.getTime() + (RELEASE_DAYS - 1) * DAY_MS));
    let alive = true;
    fetch(`/api/calendar?from=${from}&to=${to}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: CalendarResult) => alive && setData(body))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  const days = useMemo(() => {
    if (!data) return [];
    const base = data.baseRate ?? 0;
    const picked = data.entries
      .filter((e) => e.libraryId !== null || (e.compatibility ?? 0) > base)
      .sort((a, b) => {
        if ((a.libraryId !== null) !== (b.libraryId !== null)) return a.libraryId !== null ? -1 : 1;
        return (b.compatibility ?? 0) - (a.compatibility ?? 0);
      })
      .slice(0, limit)
      .sort((a, b) => a.date.localeCompare(b.date));
    const grouped: { date: string; entries: CalendarEntry[] }[] = [];
    for (const entry of picked) {
      const lastDay = grouped.at(-1);
      if (lastDay && lastDay.date === entry.date) lastDay.entries.push(entry);
      else grouped.push({ date: entry.date, entries: [entry] });
    }
    return grouped;
  }, [data, limit]);

  function libraryIdOf(entry: CalendarEntry): number | null {
    const key = `${entry.mediaType}:${entry.tmdbId}`;
    return changes.has(key) ? (changes.get(key) ?? null) : entry.libraryId;
  }

  async function toggle(entry: CalendarEntry) {
    const key = `${entry.mediaType}:${entry.tmdbId}`;
    const current = libraryIdOf(entry);
    setPending(key);
    setMessage(null);
    try {
      if (current === null) {
        const res = await fetch("/api/items", {
          method: "POST",
          headers: JSON_HEADERS,
          body: JSON.stringify({ tmdbId: entry.tmdbId, type: entry.mediaType, source: "calendar" }),
        });
        const body = await res.json().catch(() => null);
        if (!res.ok) {
          setMessage(
            body?.error === "notion_not_configured" ? "Notion n'est pas configuré, impossible d'ajouter." : "Échec de l'ajout, réessaie."
          );
          return;
        }
        setChanges((prev) => new Map(prev).set(key, body.item.id));
        setMessage(`« ${entry.title} » ajouté à ta pile`);
      } else {
        const res = await fetch(`/api/items/${current}`, { method: "DELETE" });
        if (!res.ok) {
          setMessage("Échec du retrait, réessaie.");
          return;
        }
        setChanges((prev) => new Map(prev).set(key, null));
        setMessage(`« ${entry.title} » retiré de ta pile`);
      }
    } catch {
      setMessage("Échec, réessaie.");
    } finally {
      setPending(null);
    }
  }

  const todayIso = data ? isoDay(new Date()) : null;

  return (
    <div className="feature-stage justify-start">
      <div className="flex flex-wrap items-center gap-3">
        <Badge variant="success">À venir</Badge>
        <MonoMeta>Les {RELEASE_DAYS} prochains jours, pour toi</MonoMeta>
      </div>

      {!data && !failed && (
        <ul aria-busy="true" className="flex flex-col gap-2">
          {Array.from({ length: limit }, (_, i) => (
            <Card as="li" key={i} className="flex items-center gap-3 p-2">
              <Skeleton className="h-18 w-12 shrink-0 rounded-control" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-1/3" />
              </div>
            </Card>
          ))}
        </ul>
      )}

      {failed && <p className="py-8 text-sm text-muted">Les sorties ne répondent pas pour l&apos;instant.</p>}

      {data && days.length === 0 && (
        <p className="py-8 text-sm text-muted">Rien de prévu pour toi ces deux prochaines semaines.</p>
      )}

      {days.length > 0 && (
        <ol className="flex flex-col gap-4">
          {days.map((day) => (
            <li key={day.date} className="flex flex-col gap-2">
              <h3 className="text-sm text-foreground">{day.date === todayIso ? "Aujourd'hui" : dayLabel(day.date)}</h3>
              <ul className="flex flex-col gap-2">
                {day.entries.map((entry) => {
                  const key = `${entry.mediaType}:${entry.tmdbId}`;
                  const libraryId = libraryIdOf(entry);
                  const canToggle = entry.libraryId === null;
                  const genre = genreLine(entry.genres, 1);
                  return (
                    <Card as="li" key={entry.key} className="grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-3 p-2 pr-3">
                      <div className="poster aspect-[2/3] w-12 rounded-control">
                        <Poster url={entry.posterUrl} className="h-full w-full object-cover" />
                      </div>
                      <div className="flex min-w-0 flex-col gap-1">
                        <p className="truncate text-sm font-medium text-foreground">{entry.title}</p>
                        <MetaRow className="flex-nowrap">
                          <span className="shrink-0">{eventLabel(entry)}</span>
                          {/* Sur téléphone, l'événement seul : le genre n'y tiendrait que tronqué. */}
                          <span className="hidden min-w-0 sm:inline-flex">
                            <span className="min-w-0"><span className="min-w-0 truncate">{genre || kindLabel(entry)}</span></span>
                          </span>
                        </MetaRow>
                      </div>
                      <div className="flex items-center gap-2">
                        <CompatibilityChip value={entry.compatibility} />
                        {canToggle && (
                          <Button
                            size="sm"
                            icon
                            variant={libraryId === null ? "secondary" : "ghost"}
                            loading={pending === key}
                            onClick={() => toggle(entry)}
                            aria-label={libraryId === null ? `Ajouter « ${entry.title} »` : `Retirer « ${entry.title} »`}
                            title={libraryId === null ? "Ajouter à ma pile" : "Ajouté · cliquer pour retirer"}
                          >
                            {pending !== key &&
                              (libraryId === null ? <Plus size={14} aria-hidden="true" /> : <Check size={14} aria-hidden="true" />)}
                          </Button>
                        )}
                      </div>
                    </Card>
                  );
                })}
              </ul>
            </li>
          ))}
        </ol>
      )}

      <p aria-live="polite" className="mt-auto min-h-5 text-sm text-muted">
        {message ?? (data ? `${data.entries.length.toLocaleString("fr-FR")} sorties en tout sur la période` : "")}
      </p>
    </div>
  );
}
