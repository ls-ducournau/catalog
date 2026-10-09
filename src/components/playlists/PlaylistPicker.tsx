"use client";

import { useState } from "react";
import Link from "next/link";
import { ListPlus } from "lucide-react";
import { PlaylistChooser } from "@/components/playlists/PlaylistChooser";
import type { PlaylistSummary } from "@/lib/playlistService";

// « Ajouter à une playlist », dans la fiche d'un titre — spec: specs/playlists-v1.md (FR-4). Une
// puce qui déplie, sur place (jamais coupé par le panneau), le sélecteur partagé (v2 NFR-3).

export function PlaylistPicker({ itemId, name, className }: { itemId: number; name: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [inside, setInside] = useState<PlaylistSummary[]>([]);

  return (
    <div className={className}>
      <button type="button" className="chip" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <ListPlus size={14} aria-hidden="true" />
        {inside.length === 0
          ? "Ajouter à une playlist"
          : inside.length === 1
            ? `Dans « ${inside[0].name} »`
            : `Dans ${inside.length} playlists`}
      </button>

      {/* Toujours monté, pour que la puce dise déjà où est le titre ; déplié au clic. */}
      <div className={open ? "menu-panel mt-2 w-full max-w-80" : "hidden"}>
        <PlaylistChooser
          subject={{ kind: "item", itemId, name }}
          source="fiche"
          onChange={(playlists) => setInside(playlists.filter((p) => p.contains))}
        />
        <Link href="/playlists" className="menu-item">
          Toutes tes playlists
        </Link>
      </div>
    </div>
  );
}
