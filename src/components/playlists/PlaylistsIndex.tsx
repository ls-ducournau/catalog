"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CloudOff, ListVideo, Plus } from "lucide-react";
import { PlaylistCover } from "@/components/playlists/PlaylistCover";
import { EmptyState, PageHeader } from "@/components/sections";
import { Button, MetaRow, Skeleton, TextField, Toast } from "@/components/ui";
import { countLine, DELETED_PLAYLIST_KEY, NAME_MAX, totalDuration, watchedLine } from "@/lib/playlistFormat";
import type { PlaylistSnapshot, PlaylistSummary } from "@/lib/playlistService";

// Tes playlists — spec: specs/playlists-v1.md (FR-1, FR-3, FR-10), specs/playlists-v2.md (FR-11).
// Archétype CatalogLayout (le Store) : des cartes dont la couverture est faite des affiches
// (l'affiche domine la carte). En tête, les playlists en cours et leur prochain titre ; à part,
// celles qui sont entièrement vues.

const JSON_HEADERS = { "Content-Type": "application/json" };
const UNDO_MS = 8000;

function PlaylistCard({ playlist }: { playlist: PlaylistSummary }) {
  const duration = totalDuration(playlist.runtime, playlist.count);
  return (
    <Link href={`/playlists/${playlist.id}`} className="playlist-card flex flex-col gap-3">
      <PlaylistCover covers={playlist.covers} />
      <div className="flex min-w-0 flex-col gap-1 px-0.5">
        <h2 className="line-clamp-1 text-base text-foreground">{playlist.name}</h2>
        <MetaRow>
          <span>{countLine(playlist.count)}</span>
          {duration && <span>{duration}</span>}
        </MetaRow>
        {playlist.next ? (
          <p className="truncate text-xs text-muted">
            À suivre : <span className="text-foreground">{playlist.next.name}</span>
          </p>
        ) : (
          playlist.count > 0 && <p className="text-xs text-muted">{watchedLine(playlist.watched, playlist.count)}</p>
        )}
      </div>
    </Link>
  );
}

/** Formulaire en ligne de FR-1 : un nom, ↵ crée et ouvre la playlist. */
function NewPlaylistForm({ onCancel }: { onCancel: () => void }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Donne-lui un nom.");
      return;
    }
    setPending(true);
    setError(null);
    const res = await fetch("/api/playlists", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ name }) }).catch(() => null);
    const body: { playlist?: { id: number } } | null = res?.ok ? await res.json().catch(() => null) : null;
    if (!body?.playlist) {
      setPending(false);
      setError("La playlist n'a pas pu être créée.");
      return;
    }
    router.push(`/playlists/${body.playlist.id}`);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <TextField
          label="Nom de la playlist"
          autoFocus
          value={name}
          maxLength={NAME_MAX}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Escape" && onCancel()}
          placeholder="Saga Alien, films de Noël…"
          aria-invalid={Boolean(error) || undefined}
          aria-describedby={error ? "nouvelle-playlist-erreur" : undefined}
          className="w-full sm:w-80"
        />
        <Button type="submit" variant="primary" loading={pending}>
          Créer
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Annuler
        </Button>
      </div>
      {error && (
        <p id="nouvelle-playlist-erreur" className="text-sm text-muted">
          {error}
        </p>
      )}
    </form>
  );
}

export function PlaylistsIndex() {
  const [playlists, setPlaylists] = useState<PlaylistSummary[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [deleted, setDeleted] = useState<PlaylistSnapshot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch("/api/playlists").catch(() => null);
    const body: { playlists?: PlaylistSummary[] } | null = res?.ok ? await res.json().catch(() => null) : null;
    if (!body?.playlists) {
      setFailed(true);
      return;
    }
    setFailed(false);
    setPlaylists(body.playlists);
  }, []);

  // Une playlist supprimée depuis sa page : la liste propose de la rétablir (FR-3). Avec
  // `?nouvelle=1` (section Playlists de l'accueil), le formulaire de création s'ouvre.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (new URLSearchParams(window.location.search).get("nouvelle") === "1") setCreating(true);
    void load();
    try {
      const raw = window.sessionStorage.getItem(DELETED_PLAYLIST_KEY);
      if (raw) {
        window.sessionStorage.removeItem(DELETED_PLAYLIST_KEY);
        setDeleted(JSON.parse(raw) as PlaylistSnapshot);
      }
    } catch {
      // stockage indisponible : pas d'annulation proposée.
    }
  }, [load]);

  const restore = useCallback(async () => {
    const snapshot = deleted;
    if (!snapshot) return;
    setDeleted(null);
    const res = await fetch("/api/playlists/restore", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ snapshot }) }).catch(
      () => null
    );
    setNotice(res?.ok ? `« ${snapshot.name} » est revenue.` : "La playlist n'a pas pu être rétablie.");
    void load();
  }, [deleted, load]);

  // L'annulation reste offerte quelques secondes, au bouton ou avec Ctrl+Z.
  useEffect(() => {
    if (!deleted) return;
    const timer = setTimeout(() => setDeleted(null), UNDO_MS);
    function onKey(e: KeyboardEvent) {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
        void restore();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("keydown", onKey);
    };
  }, [deleted, restore]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  return (
    <>
      <PageHeader
        title="Playlists"
        lead="Tes listes, faites à la main."
        description="Une saga à revoir, des films de Noël, une soirée à deux : range tes titres dans l'ordre où tu veux les regarder."
        actions={
          !creating && (
            <Button variant="primary" onClick={() => setCreating(true)}>
              <Plus size={16} aria-hidden="true" />
              Nouvelle playlist
            </Button>
          )
        }
      />

      {creating && (
        <div className="mt-6">
          <NewPlaylistForm onCancel={() => setCreating(false)} />
        </div>
      )}

      <div className="mt-10">
        {!playlists && !failed && (
          <ul aria-busy="true" className="playlist-grid">
            {Array.from({ length: 5 }, (_, i) => (
              <li key={i} className="flex flex-col gap-3">
                <Skeleton className="aspect-[2/3] w-full rounded-card" />
                <Skeleton className="h-4 w-2/3" />
              </li>
            ))}
          </ul>
        )}

        {failed && (
          <EmptyState icon={<CloudOff size={20} aria-hidden="true" />} title="Impossible de charger tes playlists.">
            Recharge la page.
          </EmptyState>
        )}

        {playlists && playlists.length === 0 && (
          <EmptyState
            icon={<ListVideo size={20} aria-hidden="true" />}
            title="Aucune playlist pour l'instant."
            action={
              !creating && (
                <Button onClick={() => setCreating(true)}>
                  <Plus size={14} aria-hidden="true" />
                  Créer ta première playlist
                </Button>
              )
            }
          >
            Crée-en une, puis ajoute des titres depuis leur fiche ou depuis la playlist.
          </EmptyState>
        )}

        {playlists && playlists.length > 0 && (
          <div className="flex flex-col gap-12">
            {[
              { key: "en-cours", title: "En cours", list: playlists.filter((p) => p.next !== null || p.count === 0) },
              { key: "terminees", title: "Entièrement vues", list: playlists.filter((p) => p.next === null && p.count > 0) },
            ]
              .filter((group) => group.list.length > 0)
              .map((group, _i, groups) => (
                <section key={group.key} aria-labelledby={`${group.key}-titre`} className="flex flex-col gap-5">
                  {/* Un seul groupe : pas de titre, la page en a déjà un. */}
                  <h2 id={`${group.key}-titre`} className={groups.length > 1 ? "text-subheading text-foreground" : "sr-only"}>
                    {group.title}
                  </h2>
                  <ul className="playlist-grid">
                    {group.list.map((playlist) => (
                      <li key={playlist.id}>
                        <PlaylistCard playlist={playlist} />
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
          </div>
        )}
      </div>

      {deleted && (
        <Toast action="Annuler" onAction={restore}>
          « {deleted.name} » supprimée.
        </Toast>
      )}
      {!deleted && notice && <Toast>{notice}</Toast>}
    </>
  );
}
