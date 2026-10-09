"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Check, Plus } from "lucide-react";
import { MonoMeta } from "@/components/ui";
import { NAME_MAX } from "@/lib/playlistFormat";
import type { PlaylistSource, PlaylistSummary } from "@/lib/playlistService";

// Le sélecteur de playlists, partagé (spec playlists-v2 NFR-3) : dans la fiche, sur les cartes,
// pour une sélection. Une ligne par playlist et « Nouvelle playlist… ».
//   - un titre de la bibliothèque : chaque ligne se coche ou se décoche (v1 FR-4) ;
//   - plusieurs titres : une ligne les ajoute tous d'un coup (v2 FR-4) ;
//   - un titre hors bibliothèque : une ligne l'ajoute à ta pile, puis à la playlist (v2 FR-3).

const JSON_HEADERS = { "Content-Type": "application/json" };

export type PlaylistSubject =
  | { kind: "item"; itemId: number; name: string }
  | { kind: "items"; itemIds: number[] }
  | { kind: "tmdb"; tmdbId: number; mediaType: "Movie" | "TV Series"; name: string };

/** Ce qu'un geste a fait, et de quoi le défaire : la fenêtre l'annonce avec « Annuler ». */
export type PlaylistOutcome = { message: string; undo?: () => Promise<void> };

/** L'origine d'un ajout à la pile, pour le taux d'acceptation (tri-rapide-v1 FR-8). */
const LIBRARY_SOURCE: Partial<Record<PlaylistSource, string>> = {
  sorties: "calendar",
  "ce-soir": "tonight",
  tri: "triage",
  decouvrir: "discover",
};

async function post(url: string, body: unknown): Promise<Response | null> {
  return fetch(url, { method: "POST", headers: JSON_HEADERS, body: JSON.stringify(body) }).catch(() => null);
}

async function del(url: string, body?: unknown): Promise<Response | null> {
  return fetch(url, { method: "DELETE", headers: JSON_HEADERS, body: body ? JSON.stringify(body) : undefined }).catch(() => null);
}

/** v2 FR-3 : met le titre dans ta pile (comme « Ajouter ») ; rend son id et s'il y était déjà. */
async function addToLibrary(subject: Extract<PlaylistSubject, { kind: "tmdb" }>, source: PlaylistSource) {
  const res = await post("/api/items", { tmdbId: subject.tmdbId, type: subject.mediaType, source: LIBRARY_SOURCE[source] ?? "search" });
  const body: { item?: { id: number }; alreadyExists?: boolean; error?: string } | null = res ? await res.json().catch(() => null) : null;
  if (!res?.ok || !body?.item) {
    return { error: body?.error === "notion_not_configured" ? "Notion n'est pas configuré : le titre n'a pas pu être ajouté." : "Le titre n'a pas pu être ajouté à ta pile." };
  }
  return { id: body.item.id, alreadyExists: Boolean(body.alreadyExists) };
}

export function PlaylistChooser({
  subject,
  source,
  onOutcome,
  onChange,
  autoFocus = false,
}: {
  subject: PlaylistSubject;
  source: PlaylistSource;
  /** Un geste qui clôt le choix (plusieurs titres, titre hors bibliothèque) ; le reste se coche sur place. */
  onOutcome?: (outcome: PlaylistOutcome) => void;
  /** Les playlists, à chaque changement (coche, création). */
  onChange?: (playlists: PlaylistSummary[]) => void;
  autoFocus?: boolean;
}) {
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const single = subject.kind === "item" ? subject.itemId : null;

  const load = useCallback(async () => {
    const res = await fetch(single !== null ? `/api/playlists?item=${single}` : "/api/playlists").catch(() => null);
    const body: { playlists?: PlaylistSummary[] } | null = res?.ok ? await res.json().catch(() => null) : null;
    if (body?.playlists) setPlaylists(body.playlists);
    else setMessage("Tes playlists ne répondent pas.");
  }, [single]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  // La fiche affiche, sur sa puce, les playlists qui contiennent le titre. Le rappel est gardé
  // dans une ref : recréé à chaque rendu du parent, il relancerait l'effet sans fin.
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  });
  useEffect(() => {
    if (playlists) onChangeRef.current?.(playlists);
  }, [playlists]);

  /** Met le sujet dans la playlist ; rend le résultat à annoncer, ou une erreur. */
  async function addTo(playlist: { id: number; name: string }): Promise<PlaylistOutcome | { error: string }> {
    if (subject.kind === "items") {
      const res = await post(`/api/playlists/${playlist.id}/items`, { itemIds: subject.itemIds, source });
      const body: { added?: number[]; already?: number[] } | null = res?.ok ? await res.json().catch(() => null) : null;
      if (!body?.added) return { error: "Les titres n'ont pas été ajoutés." };
      const added = body.added;
      const already = body.already?.length ?? 0;
      const parts = [`${added.length} ajouté${added.length > 1 ? "s" : ""} à « ${playlist.name} »`];
      if (already > 0) parts.push(`${already} déjà dedans`);
      return {
        message: parts.join(", "),
        undo:
          added.length > 0
            ? async () => {
                for (const itemId of added) await del(`/api/playlists/${playlist.id}/items`, { itemId });
              }
            : undefined,
      };
    }
    if (subject.kind === "tmdb") {
      const library = await addToLibrary(subject, source);
      if ("error" in library) return { error: library.error ?? "Le titre n'a pas pu être ajouté." };
      const res = await post(`/api/playlists/${playlist.id}/items`, { itemId: library.id, source });
      if (!res?.ok) {
        // Rien à moitié : le titre ajouté à la pile pour l'occasion en repart (EC-2).
        if (!library.alreadyExists) await del(`/api/items/${library.id}`);
        return { error: "Le titre n'a pas été ajouté à la playlist." };
      }
      return {
        message: library.alreadyExists
          ? `« ${subject.name} » ajouté à « ${playlist.name} »`
          : `« ${subject.name} » ajouté à ta pile et à « ${playlist.name} »`,
        undo: async () => {
          await del(`/api/playlists/${playlist.id}/items`, { itemId: library.id });
          if (!library.alreadyExists) await del(`/api/items/${library.id}`);
        },
      };
    }
    const res = await post(`/api/playlists/${playlist.id}/items`, { itemId: subject.itemId, source });
    if (!res?.ok) return { error: "Le titre n'a pas été ajouté." };
    return { message: `Ajouté à « ${playlist.name} »` };
  }

  async function choose(playlist: PlaylistSummary) {
    if (pending) return;
    setMessage(null);
    // Un titre de la bibliothèque : la ligne se coche ou se décoche, sur place.
    if (subject.kind === "item") {
      const inside = Boolean(playlist.contains);
      setPlaylists((list) => list?.map((p) => (p.id === playlist.id ? { ...p, contains: !inside, count: p.count + (inside ? -1 : 1) } : p)) ?? list);
      const result = inside
        ? (await del(`/api/playlists/${playlist.id}/items`, { itemId: subject.itemId }))?.ok
          ? { message: `Retiré de « ${playlist.name} »` }
          : { error: "Le titre n'a pas été retiré." }
        : await addTo(playlist);
      if ("error" in result) {
        setMessage(result.error);
        void load();
      } else setMessage(result.message);
      return;
    }
    setPending(true);
    const result = await addTo(playlist);
    setPending(false);
    if ("error" in result) setMessage(result.error);
    else onOutcome?.(result);
  }

  async function create(e: FormEvent) {
    e.preventDefault();
    if (!name.trim() || pending) return;
    setPending(true);
    setMessage(null);
    const res = await post("/api/playlists", { name, source, itemId: subject.kind === "item" ? subject.itemId : undefined });
    const body: { playlist?: { id: number; name: string } } | null = res?.ok ? await res.json().catch(() => null) : null;
    if (!body?.playlist) {
      setPending(false);
      setMessage("La playlist n'a pas pu être créée.");
      return;
    }
    const playlist = body.playlist;
    if (subject.kind === "item") {
      setPending(false);
      setName("");
      setCreating(false);
      setMessage(`Ajouté à « ${playlist.name} »`);
      void load();
      return;
    }
    const result = await addTo(playlist);
    setPending(false);
    if ("error" in result) {
      setMessage(result.error);
      void load();
    } else onOutcome?.(result);
  }

  const empty = playlists !== null && playlists.length === 0;
  const showForm = creating || empty;

  return (
    <div className="flex flex-col">
      {playlists === null && !message && <p className="px-2 py-2 text-sm text-muted">Un instant…</p>}
      {playlists && playlists.length > 0 && (
        <div role="group" aria-label="Tes playlists" className="flex max-h-72 flex-col overflow-y-auto">
          {playlists.map((playlist, i) => (
            <button
              key={playlist.id}
              type="button"
              autoFocus={autoFocus && i === 0}
              aria-pressed={subject.kind === "item" ? Boolean(playlist.contains) : undefined}
              disabled={pending}
              onClick={() => choose(playlist)}
              className="menu-item"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
                  {subject.kind === "item" ? playlist.contains && <Check size={14} className="text-foreground" /> : <Plus size={14} />}
                </span>
                <span className={playlist.contains ? "truncate text-foreground" : "truncate"}>{playlist.name}</span>
              </span>
              <MonoMeta aria-hidden="true">{playlist.count}</MonoMeta>
            </button>
          ))}
        </div>
      )}
      {playlists && playlists.length > 0 && <div className="divider my-1" />}
      {showForm ? (
        <form onSubmit={create} className="flex flex-col gap-1.5 p-1">
          {empty && <p className="px-1 text-xs text-muted">Aucune playlist pour l&apos;instant : crée la première.</p>}
          <label className="field flex items-center gap-2">
            <span className="sr-only">Nom de la nouvelle playlist</span>
            <input
              autoFocus={autoFocus || creating}
              value={name}
              maxLength={NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && !empty) {
                  e.stopPropagation();
                  setCreating(false);
                }
              }}
              placeholder="Nom de la playlist, puis ↵"
              className="h-full min-w-0 flex-1 bg-transparent text-base text-foreground outline-none placeholder:text-muted sm:text-sm"
            />
          </label>
        </form>
      ) : (
        <button type="button" className="menu-item" onClick={() => setCreating(true)}>
          <span className="flex items-center gap-2">
            <Plus size={14} aria-hidden="true" />
            Nouvelle playlist…
          </span>
        </button>
      )}
      <p aria-live="polite" className="min-h-5 px-2 pt-1 text-xs text-muted">
        {message ?? ""}
      </p>
    </div>
  );
}
