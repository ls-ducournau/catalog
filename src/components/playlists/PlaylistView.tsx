"use client";

import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, ChevronLeft, CloudOff, GripVertical, ListVideo, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import { RatingKeys, ratedAs } from "@/components/RatingKeys";
import { StarCount, starCount } from "@/components/StarRating";
import { TrailerButton } from "@/components/TrailerButton";
import { WhereToWatch } from "@/components/playlists/WhereToWatch";
import { useNow } from "@/components/useNow";
import { EmptyState } from "@/components/sections";
import { Badge, Button, Kbd, MetaRow, MonoMeta, SearchField, Skeleton } from "@/components/ui";
import { genreLine } from "@/lib/genres";
import type { LibraryItem } from "@/lib/libraryItem";
import {
  countLine,
  DELETED_PLAYLIST_KEY,
  DESCRIPTION_MAX,
  formatMinutes,
  NAME_MAX,
  timingLine,
  totalDuration,
  watchedLine,
} from "@/lib/playlistFormat";
import type { PlaylistDetail, PlaylistEntry, PlaylistSnapshot, PlaylistSuggestion } from "@/lib/playlistService";
import { cn } from "@/lib/utils";

// Une playlist — spec: specs/playlists-v1.md (FR-2 à FR-8, FR-11, FR-12). Le prochain titre à voir
// en grand (l'affiche domine) ; la liste dans l'ordre, qui se réordonne au glisser-déposer (souris
// ou doigt, par la poignée) ou au clavier (Alt+↑, Alt+↓) ; un champ pour ajouter un titre de la
// bibliothèque. Chaque geste s'applique tout de suite et s'annule (NFR-2).

const JSON_HEADERS = { "Content-Type": "application/json" };

type Undo = { label: string; run: () => Promise<void> };

function Poster({ url, className }: { url: string | null; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" loading="lazy" draggable={false} className={className} /> : null;
}

function kindOf(item: LibraryItem): string {
  if (item.category === "Documentary") return "Documentaire";
  return item.type === "Movie" ? "Film" : "Série";
}

// ---------- En-tête : nom et description modifiables sur place (FR-2) ----------

/**
 * Modifier sur place (FR-2) : le texte garde sa taille, sa police et sa place, dans un puits
 * discret. Il arrive sélectionné : on le remplace en tapant, ou on le corrige. ↵ enregistre,
 * Échap annule ; deux petits boutons font de même au doigt. Un texte inchangé n'écrit rien.
 */
function InlineEdit({
  value,
  label,
  max,
  multiline = false,
  onSave,
  onCancel,
}: {
  value: string;
  label: string;
  max: number;
  multiline?: boolean;
  onSave: (next: string) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const length = draft.trim().length;
  // Un nom ne peut pas être vide ; une description, si : elle s'efface.
  const valid = length <= max && (multiline || length > 0);

  useEffect(() => {
    input.current?.select();
  }, []);

  function submit(e?: FormEvent) {
    e?.preventDefault();
    if (!valid) return;
    if (draft.trim() === value.trim()) onCancel();
    else onSave(draft.trim());
  }

  return (
    <form onSubmit={submit} className={cn("flex w-full flex-col gap-3", multiline ? "max-w-2xl" : "max-w-4xl")}>
      <label className={cn("field inline-edit", !multiline && "inline-edit-title", !valid && "is-error")}>
        <span className="sr-only">{label}</span>
        <input
          ref={input}
          autoFocus
          value={draft}
          maxLength={max}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            onCancel();
          }}
          placeholder={multiline ? "Pour quoi, pour qui, dans quel ordre…" : "Nom de la playlist"}
          aria-invalid={!valid || undefined}
          className={cn(
            "w-full min-w-0 bg-transparent text-foreground outline-none placeholder:text-muted",
            multiline ? "text-base" : "text-heading sm:text-heading-lg"
          )}
        />
      </label>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span aria-hidden="true" className="hidden items-center gap-1.5 text-xs text-muted sm:flex">
          <Kbd>↵</Kbd> enregistrer
          <Kbd className="ml-2">Échap</Kbd> annuler
        </span>
        <MonoMeta className="sm:ml-auto">
          {length}/{max}
        </MonoMeta>
        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
            Annuler
          </Button>
          <Button type="submit" size="sm" variant="primary" disabled={!valid}>
            Enregistrer
          </Button>
        </div>
      </div>
    </form>
  );
}

// ---------- Ajouter un titre (FR-5) ----------

/** Champ qui cherche dans ta bibliothèque pendant la frappe ; ↑ ↓ choisissent, ↵ ajoute. */
function AddTitleField({ members, onAdd }: { members: Set<number>; onAdd: (item: LibraryItem) => void }) {
  const listId = useId();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<LibraryItem[]>([]);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const [searching, setSearching] = useState(false);
  const q = query.trim();

  useEffect(() => {
    if (q.length < 2) return;
    let alive = true;
    const timer = setTimeout(() => {
      setSearching(true);
      fetch(`/api/items?q=${encodeURIComponent(q)}&pageSize=8`)
        .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
        .then((body: { items: LibraryItem[] }) => {
          if (!alive) return;
          setResults(body.items);
          setHighlight(0);
          setOpen(true);
        })
        .catch(() => alive && setResults([]))
        .finally(() => alive && setSearching(false));
    }, 200);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [q]);

  const shown = q.length >= 2 ? results : [];

  function choose(item: LibraryItem) {
    onAdd(item);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(e: ReactKeyboardEvent<HTMLInputElement>) {
    if (!open || shown.length === 0) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => (h + (e.key === "ArrowDown" ? 1 : shown.length - 1)) % shown.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      choose(shown[highlight]);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div className="relative">
      <SearchField
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onClear={() => setQuery("")}
        onKeyDown={onKeyDown}
        onBlur={() => setOpen(false)}
        onFocus={() => shown.length > 0 && setOpen(true)}
        searching={searching}
        placeholder="Ajouter un titre de ta bibliothèque…"
        aria-label="Ajouter un titre de ta bibliothèque"
        role="combobox"
        aria-expanded={open && shown.length > 0}
        aria-controls={listId}
        aria-activedescendant={open && shown[highlight] ? `${listId}-${shown[highlight].id}` : undefined}
        autoComplete="off"
      />
      {open && q.length >= 2 && (
        <ul id={listId} role="listbox" aria-label="Titres de ta bibliothèque" className="menu-panel absolute inset-x-0 top-full z-20 mt-2 max-h-80 overflow-y-auto">
          {shown.length === 0 && !searching && <li className="px-2 py-2 text-sm text-muted">Rien pour « {q} » dans ta bibliothèque.</li>}
          {shown.map((item, i) => {
            const inside = members.has(item.id);
            return (
              <li
                key={item.id}
                id={`${listId}-${item.id}`}
                role="option"
                aria-selected={i === highlight}
                data-highlighted={i === highlight || undefined}
                onMouseEnter={() => setHighlight(i)}
                // Avant le blur du champ, sinon la liste se ferme sous le clic.
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(item);
                }}
                className="menu-item cursor-pointer py-1"
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <span aria-hidden="true" className="showcase-icon h-9 w-6 rounded-sm">
                    <Poster url={item.posterUrl} />
                  </span>
                  <span className="min-w-0 truncate text-foreground">{item.name}</span>
                  {item.year && <span className="shrink-0 text-xs text-muted">{item.year}</span>}
                </span>
                {inside ? (
                  <span className="shrink-0 text-xs text-muted">Déjà dedans</span>
                ) : (
                  <Plus size={14} aria-hidden="true" className="shrink-0" />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

// ---------- À suivre (FR-12) ----------

function NextUp({
  entry,
  pending,
  onWatch,
}: {
  entry: PlaylistEntry | null;
  pending: boolean;
  onWatch: (entry: PlaylistEntry) => void;
}) {
  const now = useNow();
  if (!entry) {
    return (
      <div className="feature-stage playlist-next items-start">
        <span className="flex size-10 items-center justify-center rounded-full bg-surface-3 text-success">
          <Check size={18} aria-hidden="true" />
        </span>
        <p className="text-lg text-foreground">Tu as tout vu.</p>
        <p className="text-sm text-muted">Ajoute d&apos;autres titres, ou garde-la telle quelle comme souvenir.</p>
      </div>
    );
  }
  // Sur téléphone et tablette, en ligne (l'affiche à gauche) : la liste reste à portée de pouce.
  return (
    <section aria-labelledby="a-suivre-titre" className="feature-stage playlist-next">
      <p className="text-xs font-medium text-muted">À suivre</p>
      <div className="flex gap-4 lg:flex-col">
        <Link
          href={`/library?fiche=${entry.id}`}
          className="poster block aspect-[2/3] w-28 shrink-0 self-start sm:w-32 lg:w-full lg:max-w-60 lg:self-center"
          aria-label={`${entry.name} : ouvrir la fiche`}
        >
          <Poster url={entry.posterUrl} className="h-full w-full object-cover" />
        </Link>
        <div className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <h2 id="a-suivre-titre" className="line-clamp-2 text-subheading text-foreground">
              {entry.name}
            </h2>
            <MetaRow>
              <span>{kindOf(entry)}</span>
              {entry.year && <span>{entry.year}</span>}
            </MetaRow>
          </div>
          {/* v2 FR-6 : combien de temps, jusqu'à quelle heure, et où. */}
          <div className="flex flex-col gap-1.5">
            {entry.runtime && <p className="text-sm text-foreground">{timingLine(entry.runtime, entry.type === "TV Series", now)}</p>}
            <WhereToWatch availability={entry.availability} />
          </div>
          {entry.overview && <p className="line-clamp-2 text-sm leading-relaxed text-muted lg:line-clamp-3">{entry.overview}</p>}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="primary" size="sm" onClick={() => onWatch(entry)} loading={pending}>
              {!pending && <Check size={14} aria-hidden="true" />}
              Je regarde ça
            </Button>
            <TrailerButton trailer={entry.trailer} title={entry.name} />
          </div>
        </div>
      </div>
    </section>
  );
}

// ---------- À noter (v2 FR-7) ----------

/**
 * Les titres de la playlist vus sans note, le plus récemment vu d'abord : la grille des six notes
 * de Notation, au clavier quand elle a le focus (0 à 5), « Plus tard » pour passer.
 */
function RateWatched({
  entries,
  onRate,
}: {
  entries: PlaylistEntry[];
  onRate: (entry: PlaylistEntry, stars: number) => void;
}) {
  const [later, setLater] = useState<Set<number>>(new Set());
  const queue = entries
    .filter((e) => e.watchStatus === "Watched" && !e.rating && !later.has(e.id))
    .sort((a, b) => (b.touchedAt ?? "").localeCompare(a.touchedAt ?? ""));
  const current = queue[0];
  if (!current) return null;

  function onKeyDown(e: ReactKeyboardEvent<HTMLElement>) {
    if (e.ctrlKey || e.metaKey || e.altKey || e.repeat || !/^[0-5]$/.test(e.key)) return;
    e.preventDefault();
    onRate(current, Number(e.key));
  }

  return (
    <section aria-labelledby="a-noter-titre" onKeyDown={onKeyDown} className="feature-stage playlist-rate">
      <div className="flex items-center gap-4">
        <span className="poster aspect-[2/3] w-14 shrink-0 rounded-control">
          <Poster url={current.posterUrl} className="h-full w-full object-cover" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <p className="text-xs font-medium text-muted">À noter{queue.length > 1 ? `, ${queue.length} titres` : ""}</p>
          <h2 id="a-noter-titre" className="line-clamp-2 text-lg text-foreground">
            Tu as vu « {current.name} » : ta note ?
          </h2>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setLater((s) => new Set(s).add(current.id))}>
          Plus tard
        </Button>
      </div>
      <RatingKeys onRate={(n) => onRate(current, n)} disabled={false} pressed={null} fitContainer className="max-w-none" />
    </section>
  );
}

// ---------- Pour compléter (v2 FR-5) ----------

/**
 * Jusqu'à 8 titres de ta bibliothèque proches de ceux de la playlist, en affiches : « + » l'ajoute,
 * « Pas celui-là » l'écarte des suggestions de cette playlist. Rien n'entre sans ton clic.
 */
function Suggestions({
  playlistId,
  version,
  onAdd,
}: {
  playlistId: number;
  /** Change à chaque ajout ou retrait : les suggestions se recalculent. */
  version: string;
  onAdd: (item: LibraryItem) => void;
}) {
  const [suggestions, setSuggestions] = useState<PlaylistSuggestion[] | null>(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/playlists/${playlistId}/suggestions`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((body: { suggestions: PlaylistSuggestion[] }) => alive && setSuggestions(body.suggestions))
      .catch(() => alive && setSuggestions([]));
    return () => {
      alive = false;
    };
  }, [playlistId, version]);

  async function dismiss(item: PlaylistSuggestion) {
    setSuggestions((list) => list?.filter((s) => s.id !== item.id) ?? list);
    await fetch(`/api/playlists/${playlistId}/suggestions`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ dismiss: item.id }) }).catch(
      () => null
    );
  }

  if (!suggestions || suggestions.length === 0) return null;
  return (
    <section aria-labelledby="completer-titre" className="flex flex-col gap-4 pt-4">
      <div>
        <h2 id="completer-titre" className="text-subheading text-foreground">
          Pour compléter
        </h2>
        <p className="text-sm text-muted">Des titres de ta bibliothèque proches de ceux-ci. Tu choisis.</p>
      </div>
      <ul className="grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-x-4 gap-y-6">
        {suggestions.map((item) => (
          <li key={item.id} className="group relative flex min-w-0 flex-col gap-2">
            <span className="poster relative aspect-[2/3] w-full">
              <Poster url={item.posterUrl} className="h-full w-full object-cover" />
              <span className="absolute inset-x-2 bottom-2 flex items-center justify-between">
                <Button
                  size="sm"
                  variant="overlay"
                  icon
                  onClick={() => dismiss(item)}
                  aria-label={`Pas « ${item.name} »`}
                  title="Pas celui-là"
                  className="focus-visible:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100"
                >
                  <X size={14} aria-hidden="true" />
                </Button>
                <Button size="sm" variant="overlay" icon onClick={() => onAdd(item)} aria-label={`Ajouter « ${item.name} » à la playlist`} title="Ajouter">
                  <Plus size={14} aria-hidden="true" />
                </Button>
              </span>
            </span>
            <div className="min-w-0 px-0.5">
              <p className="truncate text-sm text-foreground">{item.name}</p>
              {item.reason && <p className="truncate text-xs text-muted">{item.reason}</p>}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ---------- La page ----------

export function PlaylistView({ id }: { id: number }) {
  const router = useRouter();
  const [data, setData] = useState<PlaylistDetail | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing" | "failed">("loading");
  const [order, setOrder] = useState<number[]>([]);
  const [editing, setEditing] = useState<"name" | "description" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [undo, setUndo] = useState<Undo | null>(null);
  const [pending, setPending] = useState<number | null>(null);
  const [dragging, setDragging] = useState<number | null>(null);
  const listRef = useRef<HTMLOListElement | null>(null);
  const orderRef = useRef<number[]>([]);
  const drag = useRef<{ id: number; original: number[] } | null>(null);
  const refocus = useRef<number | null>(null);

  useEffect(() => {
    orderRef.current = order;
  }, [order]);

  const load = useCallback(async () => {
    const res = await fetch(`/api/playlists/${id}`).catch(() => null);
    if (res?.status === 404) {
      setState("missing");
      return;
    }
    const body: { playlist?: PlaylistDetail } | null = res?.ok ? await res.json().catch(() => null) : null;
    if (!body?.playlist) {
      setState("failed");
      return;
    }
    setData(body.playlist);
    setOrder(body.playlist.items.map((item) => item.id));
    setState("ready");
  }, [id]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // Après un déplacement au clavier, la poignée du titre déplacé garde le focus (AC-5).
  useEffect(() => {
    if (refocus.current === null) return;
    listRef.current?.querySelector<HTMLButtonElement>(`[data-handle="${refocus.current}"]`)?.focus();
    refocus.current = null;
  }, [order]);

  const offerUndo = useCallback((next: Undo | null, text: string | null = null) => {
    setUndo(next);
    setMessage(text);
  }, []);

  // EC-4 : Échap pendant un glissement remet l'ordre d'avant (la poignée n'a pas le focus).
  useEffect(() => {
    if (dragging === null) return;
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || !drag.current) return;
      const original = drag.current.original;
      drag.current = null;
      setDragging(null);
      orderRef.current = original;
      setOrder(original);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dragging]);

  // Ctrl+Z annule le dernier geste (hors des champs de saisie).
  useEffect(() => {
    if (!undo) return;
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        const current = undo;
        setUndo(null);
        setMessage(null);
        void current?.run();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [undo]);

  if (state === "loading") {
    return (
      <div aria-busy="true" className="flex flex-col gap-6 pt-6">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-10 w-1/2" />
        <div className="grid gap-8 lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
          <Skeleton className="aspect-[2/3] w-full max-w-60 rounded-card" />
          <div className="flex flex-col gap-3">
            {Array.from({ length: 4 }, (_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-frame" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (state === "missing" || state === "failed" || !data) {
    return (
      <EmptyState
        className="pt-16"
        icon={state === "missing" ? <ListVideo size={20} aria-hidden="true" /> : <CloudOff size={20} aria-hidden="true" />}
        title={state === "missing" ? "Cette playlist n'existe plus." : "Impossible de charger la playlist."}
        action={
          <Button href="/playlists" size="sm">
            Toutes tes playlists
          </Button>
        }
      />
    );
  }

  const byId = new Map(data.items.map((item) => [item.id, item]));
  const items = order.map((itemId) => byId.get(itemId)).filter((item): item is PlaylistEntry => Boolean(item));
  const members = new Set(order);
  const next = items.find((item) => item.watchStatus !== "Watched") ?? null;
  const watched = items.filter((item) => item.watchStatus === "Watched").length;
  const duration = totalDuration(data.runtime, data.count);

  async function save(patch: { name?: string; description?: string }) {
    if (!data) return;
    setEditing(null);
    const res = await fetch(`/api/playlists/${id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify(patch) }).catch(() => null);
    const body: { playlist?: { name: string; description: string | null } } | null = res?.ok ? await res.json().catch(() => null) : null;
    if (!body?.playlist) {
      offerUndo(null, patch.name !== undefined ? "Le nom n'a pas été enregistré (1 à 60 caractères)." : "La description n'a pas été enregistrée.");
      return;
    }
    setData({ ...data, name: body.playlist.name, description: body.playlist.description });
  }

  async function removePlaylist() {
    const res = await fetch(`/api/playlists/${id}`, { method: "DELETE" }).catch(() => null);
    const body: { snapshot?: PlaylistSnapshot } | null = res?.ok ? await res.json().catch(() => null) : null;
    if (!body?.snapshot) {
      offerUndo(null, "La playlist n'a pas pu être supprimée.");
      return;
    }
    try {
      window.sessionStorage.setItem(DELETED_PLAYLIST_KEY, JSON.stringify(body.snapshot));
    } catch {
      // sans stockage, la liste ne pourra pas proposer l'annulation.
    }
    router.push("/playlists");
  }

  /** v2 FR-7 : la note d'un titre vu, depuis la playlist ; annulable. */
  async function rate(entry: PlaylistEntry, stars: number) {
    const res = await fetch(`/api/playlists/${id}/rate`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ itemId: entry.id, rating: stars }) }).catch(
      () => null
    );
    const body: { previous?: string | null; rating?: string } | null = res?.ok ? await res.json().catch(() => null) : null;
    if (!body?.rating) {
      offerUndo(null, "La note n'a pas été enregistrée.");
      return;
    }
    const setRating = (rating: string | null) =>
      setData((d) => (d ? { ...d, items: d.items.map((item) => (item.id === entry.id ? { ...item, rating } : item)) } : d));
    setRating(body.rating);
    const previous = body.previous ?? null;
    offerUndo(
      {
        label: `« ${entry.name} » ${ratedAs(stars)}`,
        run: async () => {
          setRating(previous);
          await fetch(`/api/items/${entry.id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ rating: previous }) }).catch(() => null);
        },
      },
      `« ${entry.name} » ${ratedAs(stars)}`
    );
  }

  async function add(item: LibraryItem, source: "recherche" | "suggestion" = "recherche") {
    if (members.has(item.id)) {
      offerUndo(null, `« ${item.name} » est déjà dans la playlist.`);
      return;
    }
    const res = await fetch(`/api/playlists/${id}/items`, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ itemId: item.id, source }) }).catch(
      () => null
    );
    if (!res?.ok) {
      offerUndo(null, "Le titre n'a pas été ajouté.");
      return;
    }
    await load();
    offerUndo(
      {
        label: `« ${item.name} » ajouté`,
        run: async () => {
          await fetch(`/api/playlists/${id}/items`, { method: "DELETE", headers: JSON_HEADERS, body: JSON.stringify({ itemId: item.id }) }).catch(() => null);
          await load();
        },
      },
      `« ${item.name} » ajouté`
    );
  }

  async function remove(entry: PlaylistEntry) {
    const before = orderRef.current;
    setOrder(before.filter((itemId) => itemId !== entry.id));
    const res = await fetch(`/api/playlists/${id}/items`, { method: "DELETE", headers: JSON_HEADERS, body: JSON.stringify({ itemId: entry.id }) }).catch(
      () => null
    );
    const body: { position?: number | null } | null = res?.ok ? await res.json().catch(() => null) : null;
    if (!body) {
      setOrder(before);
      offerUndo(null, "Le titre n'a pas été retiré.");
      return;
    }
    const position = body.position ?? before.indexOf(entry.id);
    offerUndo(
      {
        label: `« ${entry.name} » retiré`,
        run: async () => {
          setOrder((current) => {
            const nextOrder = current.filter((itemId) => itemId !== entry.id);
            nextOrder.splice(Math.min(position, nextOrder.length), 0, entry.id);
            return nextOrder;
          });
          const ok = await fetch(`/api/playlists/${id}/items`, {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ itemId: entry.id, position }),
          }).catch(() => null);
          if (!ok?.ok) await load();
        },
      },
      `« ${entry.name} » retiré`
    );
  }

  /** FR-7 : enregistre l'ordre affiché ; en cas d'échec, l'ordre d'avant revient (NFR-2). */
  async function commitOrder(previous: number[]) {
    const current = orderRef.current;
    if (current.join(",") === previous.join(",")) return;
    const res = await fetch(`/api/playlists/${id}/items`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ itemIds: current }) }).catch(
      () => null
    );
    if (!res?.ok) {
      setOrder(previous);
      offerUndo(null, "Le nouvel ordre n'a pas été enregistré.");
      return;
    }
    offerUndo(
      {
        label: "Ordre changé",
        run: async () => {
          setOrder(previous);
          await fetch(`/api/playlists/${id}/items`, { method: "PUT", headers: JSON_HEADERS, body: JSON.stringify({ itemIds: previous }) }).catch(() => null);
        },
      },
      null
    );
  }

  function moveBy(itemId: number, delta: number) {
    const previous = orderRef.current;
    const from = previous.indexOf(itemId);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= previous.length) return;
    const nextOrder = [...previous];
    nextOrder.splice(from, 1);
    nextOrder.splice(to, 0, itemId);
    refocus.current = itemId;
    orderRef.current = nextOrder;
    setOrder(nextOrder);
    void commitOrder(previous);
  }

  function onRowKeyDown(e: ReactKeyboardEvent<HTMLLIElement>, itemId: number) {
    if (!e.altKey || (e.key !== "ArrowUp" && e.key !== "ArrowDown")) return;
    e.preventDefault();
    moveBy(itemId, e.key === "ArrowUp" ? -1 : 1);
  }

  // Glisser-déposer par la poignée, à la souris ou au doigt (FR-7) : l'ordre suit le pointeur.
  function onHandleDown(e: ReactPointerEvent<HTMLButtonElement>, itemId: number) {
    if (e.button !== 0) return;
    e.preventDefault();
    drag.current = { id: itemId, original: orderRef.current };
    setDragging(itemId);
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onHandleMove(e: ReactPointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    const list = listRef.current;
    if (!d || !list) return;
    let target = 0;
    for (const row of list.querySelectorAll<HTMLElement>("[data-row]")) {
      if (Number(row.dataset.row) === d.id) continue;
      const box = row.getBoundingClientRect();
      if (e.clientY > box.top + box.height / 2) target += 1;
    }
    const current = orderRef.current;
    const nextOrder = current.filter((itemId) => itemId !== d.id);
    nextOrder.splice(target, 0, d.id);
    if (nextOrder.join(",") !== current.join(",")) {
      orderRef.current = nextOrder;
      setOrder(nextOrder);
    }
  }

  function onHandleUp(e: ReactPointerEvent<HTMLButtonElement>) {
    const d = drag.current;
    drag.current = null;
    setDragging(null);
    if (!d) return;
    // EC-4 : relâché hors de la liste, l'ordre ne change pas.
    const box = listRef.current?.getBoundingClientRect();
    const outside = !box || e.clientX < box.left || e.clientX > box.right || e.clientY < box.top - 24 || e.clientY > box.bottom + 24;
    if (outside) {
      orderRef.current = d.original;
      setOrder(d.original);
      return;
    }
    void commitOrder(d.original);
  }

  async function watch(entry: PlaylistEntry) {
    if (!data) return;
    setPending(entry.id);
    const previous = entry.watchStatus ?? "Unwatched";
    const res = await fetch(`/api/playlists/${id}/watch`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ itemId: entry.id, source: "playlist" }),
    }).catch(() => null);
    setPending(null);
    if (!res?.ok) {
      offerUndo(null, "Le titre n'a pas pu être marqué vu.");
      return;
    }
    const setStatus = (status: "Watched" | "Unwatched") =>
      setData((d) => (d ? { ...d, items: d.items.map((item) => (item.id === entry.id ? { ...item, watchStatus: status } : item)) } : d));
    setStatus("Watched");
    offerUndo(
      {
        label: `« ${entry.name} » marqué vu`,
        run: async () => {
          setStatus(previous === "Watched" ? "Watched" : "Unwatched");
          await fetch(`/api/items/${entry.id}`, { method: "PATCH", headers: JSON_HEADERS, body: JSON.stringify({ watchStatus: previous }) }).catch(() => null);
        },
      },
      `Bonne séance : « ${entry.name} » marqué vu`
    );
  }

  return (
    <div className="flex flex-col gap-8 pt-6 sm:pt-8">
      <header className="flex flex-col gap-4">
        <Link href="/playlists" className="arrow-link self-start text-sm">
          <ChevronLeft size={16} aria-hidden="true" />
          Playlists
        </Link>
        {editing === "name" ? (
          <InlineEdit value={data.name} label="Nom de la playlist" max={NAME_MAX} onSave={(name) => save({ name })} onCancel={() => setEditing(null)} />
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-balance text-heading text-foreground sm:text-heading-lg">{data.name}</h1>
            <Button variant="ghost" size="sm" icon onClick={() => setEditing("name")} aria-label="Renommer la playlist" title="Renommer">
              <Pencil size={14} aria-hidden="true" />
            </Button>
          </div>
        )}
        {editing === "description" ? (
          <InlineEdit
            value={data.description ?? ""}
            label="Description"
            max={DESCRIPTION_MAX}
            multiline
            onSave={(description) => save({ description })}
            onCancel={() => setEditing(null)}
          />
        ) : data.description ? (
          <button type="button" onClick={() => setEditing("description")} className="max-w-2xl text-left text-base text-muted hover:text-foreground">
            {data.description}
          </button>
        ) : (
          <Button variant="ghost" size="sm" className="self-start" onClick={() => setEditing("description")}>
            <Plus size={14} aria-hidden="true" />
            Ajouter une description
          </Button>
        )}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <MonoMeta>
            {[countLine(items.length), duration, items.length > 0 ? watchedLine(watched, items.length) : null].filter(Boolean).join(" | ")}
            {duration && data.runtime.hasSeries ? " (les séries comptent pour un épisode)" : ""}
          </MonoMeta>
          <Button variant="ghost" size="sm" onClick={removePlaylist}>
            <Trash2 size={14} aria-hidden="true" />
            Supprimer la playlist
          </Button>
        </div>
      </header>

      <div className={cn("grid gap-8 lg:gap-10", items.length > 0 && "lg:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]")}>
        {items.length > 0 && (
          <div className="lg:sticky lg:top-28 lg:self-start">
            <NextUp entry={next} pending={next !== null && pending === next.id} onWatch={watch} />
          </div>
        )}

        <div className="flex min-w-0 flex-col gap-4">
          <AddTitleField members={members} onAdd={add} />

          <div className="flex min-h-8 flex-wrap items-center gap-3 text-sm text-muted">
            <span aria-live="polite">
              {message ??
                (items.length > 1 ? (
                  <>
                    Glisse la poignée pour changer l&apos;ordre<span className="hidden pointer-fine:inline">, ou Alt+↑ et Alt+↓</span>.
                  </>
                ) : (
                  ""
                ))}
            </span>
            {undo && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  const current = undo;
                  offerUndo(null);
                  void current.run();
                }}
                aria-keyshortcuts="Control+Z"
              >
                <Undo2 size={14} aria-hidden="true" />
                Annuler
              </Button>
            )}
          </div>

          <RateWatched entries={items} onRate={rate} />

          {items.length === 0 ? (
            <EmptyState icon={<ListVideo size={20} aria-hidden="true" />} title="Ta playlist est vide.">
              Cherche un titre dans le champ ci-dessus, ou ajoute-le depuis sa fiche.
            </EmptyState>
          ) : (
            <ol ref={listRef} aria-label={`Titres de « ${data.name} », dans l'ordre`} className="flex flex-col gap-1">
              {items.map((item, index) => {
                const stars = starCount(item.rating);
                const isNext = next?.id === item.id;
                return (
                  <li
                    key={item.id}
                    data-row={item.id}
                    onKeyDown={(e) => onRowKeyDown(e, item.id)}
                    className={cn("playlist-row", isNext && "is-next", dragging === item.id && "is-dragging")}
                  >
                    <button
                      type="button"
                      data-handle={item.id}
                      className="playlist-handle"
                      aria-label={`Déplacer « ${item.name} », position ${index + 1} sur ${items.length}`}
                      aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown"
                      onPointerDown={(e) => onHandleDown(e, item.id)}
                      onPointerMove={onHandleMove}
                      onPointerUp={onHandleUp}
                      onPointerCancel={onHandleUp}
                    >
                      <GripVertical size={16} aria-hidden="true" />
                    </button>
                    <MonoMeta aria-hidden="true" className="w-5 shrink-0 text-right">
                      {index + 1}
                    </MonoMeta>
                    <span className="poster aspect-[2/3] w-12 shrink-0 rounded-control">
                      <Poster url={item.posterUrl} className="h-full w-full object-cover" />
                    </span>
                    <div className="flex min-w-0 flex-1 flex-col gap-1">
                      <Link href={`/library?fiche=${item.id}`} className="row-title line-clamp-2 text-base text-foreground sm:line-clamp-1">
                        {item.name}
                      </Link>
                      <MetaRow className="flex-nowrap">
                        <span className="shrink-0">{kindOf(item)}</span>
                        {item.year && <span className="shrink-0">{item.year}</span>}
                        {item.runtime && <span className="shrink-0">{formatMinutes(item.runtime)}</span>}
                        {item.genres.length > 0 && (
                          <span className="hidden min-w-0 sm:inline-flex">
                            <span className="min-w-0"><span className="min-w-0 truncate">{genreLine(item.genres)}</span></span>
                          </span>
                        )}
                      </MetaRow>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      {/* Téléphone : pas de pastille de statut, qui mange le titre ; la ligne à suivre est
                          éclairée et un titre vu porte une coche. */}
                      {isNext && (
                        <>
                          <Badge className="hidden sm:inline-flex">À suivre</Badge>
                          <span className="sr-only sm:hidden">À suivre</span>
                        </>
                      )}
                      {item.watchStatus === "Watched" ? (
                        <>
                          <Badge variant="success" className="hidden sm:inline-flex">
                            Vu
                          </Badge>
                          <span className="inline-flex text-muted sm:hidden" title="Vu">
                            <Check size={14} aria-hidden="true" />
                            <span className="sr-only">Vu</span>
                          </span>
                        </>
                      ) : (
                        !isNext && <Badge className="hidden sm:inline-flex">À voir</Badge>
                      )}
                      {item.rating === "💩" ? (
                        <span className="hidden text-sm sm:inline">💩</span>
                      ) : (
                        stars > 0 && (
                          <span className="hidden sm:inline-flex">
                            <StarCount value={stars} size={12} />
                          </span>
                        )
                      )}
                      <span className="hidden sm:inline-flex">
                        <TrailerButton trailer={item.trailer} title={item.name} variant="icon" />
                      </span>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon
                        onClick={() => remove(item)}
                        aria-label={`Retirer « ${item.name} » de la playlist`}
                        title="Retirer de la playlist"
                      >
                        <X size={14} aria-hidden="true" />
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}

          {items.length >= 2 && <Suggestions playlistId={id} version={order.join(",")} onAdd={(item) => add(item, "suggestion")} />}

          {items.length > 0 && (
            <Link href="/library" className="arrow-link self-start text-sm">
              Parcourir la bibliothèque
              <ArrowRight size={16} aria-hidden="true" />
            </Link>
          )}
        </div>
      </div>
    </div>
  );
}
