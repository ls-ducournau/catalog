"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRight, Check, ListVideo, Plus, Undo2 } from "lucide-react";
import { PlaylistCover } from "@/components/playlists/PlaylistCover";
import { WhereToWatch } from "@/components/playlists/WhereToWatch";
import { TrailerButton } from "@/components/TrailerButton";
import { useNow } from "@/components/useNow";
import { Button } from "@/components/ui/Button";
import { MetaRow, MonoMeta } from "@/components/ui/primitives";
import { timingLine, watchedLine } from "@/lib/playlistFormat";
import type { PlaylistDetail, PlaylistEntry } from "@/lib/playlistService";

// Section Playlists de l'accueil (spec playlists-v2 FR-10, décision de l'utilisateur : une
// fonction clé de la vitrine, pas un bandeau sous le héros). Le visuel est vivant : la playlist en
// cours, sa couverture et sa progression, son prochain titre (combien de temps, jusqu'à quelle
// heure, où) et « Je regarde ça », annulable. Sans playlist en cours : une invitation.

const JSON_HEADERS = { "Content-Type": "application/json" };

function Poster({ url, className }: { url: string | null; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return url ? <img src={url} alt="" loading="lazy" draggable={false} className={className} /> : null;
}

export function PlaylistPreview({ initial }: { initial: PlaylistDetail | null }) {
  const now = useNow();
  const [playlist, setPlaylist] = useState(initial);
  const [pending, setPending] = useState(false);
  const [last, setLast] = useState<{ entry: PlaylistEntry; previous: string } | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  if (!playlist) {
    return (
      <div className="feature-stage items-start">
        <span className="flex size-12 items-center justify-center rounded-full bg-surface-3 text-muted">
          <ListVideo size={20} aria-hidden="true" />
        </span>
        <h3 className="text-subheading text-foreground">Aucune playlist en cours.</h3>
        <p className="max-w-sm text-sm text-muted">
          Rassemble une saga, une envie, une soirée à deux : Catalog te dira lequel vient ensuite.
        </p>
        <Button href="/playlists?nouvelle=1" size="sm" variant="primary">
          <Plus size={14} aria-hidden="true" />
          Nouvelle playlist
        </Button>
      </div>
    );
  }

  const next = playlist.items.find((item) => item.watchStatus !== "Watched") ?? null;
  const watched = playlist.items.filter((item) => item.watchStatus === "Watched").length;

  function setStatus(itemId: number, status: "Watched" | "Unwatched") {
    setPlaylist((p) => (p ? { ...p, items: p.items.map((item) => (item.id === itemId ? { ...item, watchStatus: status } : item)) } : p));
  }

  async function watch(entry: PlaylistEntry) {
    if (!playlist || pending) return;
    setPending(true);
    setMessage(null);
    const res = await fetch(`/api/playlists/${playlist.id}/watch`, {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({ itemId: entry.id, source: "accueil" }),
    }).catch(() => null);
    setPending(false);
    if (!res?.ok) {
      setMessage("Le titre n'a pas pu être marqué vu.");
      return;
    }
    setStatus(entry.id, "Watched");
    setLast({ entry, previous: entry.watchStatus ?? "Unwatched" });
  }

  async function undo() {
    const entry = last;
    if (!entry) return;
    setLast(null);
    setStatus(entry.entry.id, entry.previous === "Watched" ? "Watched" : "Unwatched");
    const res = await fetch(`/api/items/${entry.entry.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify({ watchStatus: entry.previous }),
    }).catch(() => null);
    if (!res?.ok) setMessage("L'annulation n'a pas pu être appliquée.");
  }

  return (
    <div className="feature-stage justify-start">
      <Link href={`/playlists/${playlist.id}`} className="playlist-card flex items-center gap-4">
        <PlaylistCover covers={playlist.covers} className="w-16 shrink-0" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="text-xs font-medium text-muted">Ta playlist en cours</p>
          <h3 className="truncate text-lg text-foreground">{playlist.name}</h3>
          <MonoMeta>{watchedLine(watched, playlist.items.length)}</MonoMeta>
        </div>
      </Link>

      <div className="h-px bg-contrast-subtle" />

      {next ? (
        <div className="flex gap-4">
          <span className="poster aspect-[2/3] w-28 shrink-0 self-start sm:w-32">
            <Poster url={next.posterUrl} className="h-full w-full object-cover" />
          </span>
          <div className="flex min-w-0 flex-col gap-2.5">
            <p className="text-xs font-medium text-muted">À suivre</p>
            <h4 className="line-clamp-2 text-subheading text-foreground">{next.name}</h4>
            <MetaRow>
              {next.year && <span>{next.year}</span>}
              {next.runtime && <span>{timingLine(next.runtime, next.type === "TV Series", now)}</span>}
            </MetaRow>
            <WhereToWatch availability={next.availability} />
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button size="sm" variant="primary" onClick={() => watch(next)} loading={pending}>
                {!pending && <Check size={14} aria-hidden="true" />}
                Je regarde ça
              </Button>
              <TrailerButton trailer={next.trailer} title={next.name} />
            </div>
          </div>
        </div>
      ) : (
        <p className="text-base text-foreground">Tout est vu dans « {playlist.name} ».</p>
      )}

      <div className="mt-auto flex min-h-8 flex-wrap items-center justify-between gap-3 text-sm text-muted">
        <span aria-live="polite">{message ?? (last ? `« ${last.entry.name} » marqué vu. Bonne séance !` : "")}</span>
        {last ? (
          <Button size="sm" variant="ghost" onClick={undo}>
            <Undo2 size={14} aria-hidden="true" />
            Annuler
          </Button>
        ) : (
          <Link href={`/playlists/${playlist.id}`} className="arrow-link text-sm">
            Ouvrir la playlist
            <ArrowRight size={16} aria-hidden="true" />
          </Link>
        )}
      </div>
    </div>
  );
}
