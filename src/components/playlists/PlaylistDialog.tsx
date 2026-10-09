"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { PlaylistChooser, type PlaylistOutcome, type PlaylistSubject } from "@/components/playlists/PlaylistChooser";
import { Button, Toast } from "@/components/ui";
import type { PlaylistSource } from "@/lib/playlistService";

// « Ajouter à une playlist » depuis une carte ou une sélection (spec playlists-v2 FR-1 à FR-4) :
// une fenêtre unique, montée une fois dans la mise en page, qu'une carte ouvre par un événement
// (comme « Ajouter un titre »). Le geste fait, la fenêtre se ferme et une notification propose
// « Annuler ».

const EVENT = "catalog:ajouter-a-une-playlist";
const UNDO_MS = 8000;

type Request = { subject: PlaylistSubject; source: PlaylistSource; onDone?: () => void };

/** Ouvre la fenêtre pour un titre, plusieurs titres ou un titre hors bibliothèque. */
export function openPlaylistDialog(subject: PlaylistSubject, source: PlaylistSource, onDone?: () => void) {
  window.dispatchEvent(new CustomEvent<Request>(EVENT, { detail: { subject, source, onDone } }));
}

function subtitle(subject: PlaylistSubject): string {
  if (subject.kind === "items") return `${subject.itemIds.length} titre${subject.itemIds.length > 1 ? "s" : ""} sélectionné${subject.itemIds.length > 1 ? "s" : ""}`;
  return subject.name;
}

export function PlaylistDialogHost() {
  const [request, setRequest] = useState<Request | null>(null);
  const [outcome, setOutcome] = useState<PlaylistOutcome | null>(null);
  const trigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    function onOpen(e: Event) {
      trigger.current = document.activeElement as HTMLElement | null;
      setOutcome(null);
      setRequest((e as CustomEvent<Request>).detail);
    }
    window.addEventListener(EVENT, onOpen);
    return () => window.removeEventListener(EVENT, onOpen);
  }, []);

  const close = useCallback(() => {
    setRequest(null);
    trigger.current?.focus();
  }, []);

  // Échap ferme ; les raccourcis des pages n'agissent pas tant que la fenêtre est ouverte.
  useEffect(() => {
    if (!request) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.preventDefault();
        close();
      }
      if (e.key !== "Tab") e.stopImmediatePropagation();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [request, close]);

  useEffect(() => {
    if (!outcome) return;
    const timer = setTimeout(() => setOutcome(null), UNDO_MS);
    return () => clearTimeout(timer);
  }, [outcome]);

  function done(result: PlaylistOutcome) {
    request?.onDone?.();
    close();
    setOutcome(result);
  }

  async function undo() {
    const current = outcome;
    if (!current?.undo) return;
    setOutcome({ message: "Annulé." });
    await current.undo();
  }

  return (
    <>
      {request &&
        createPortal(
          <div className="fade-in fixed inset-0 z-[70] flex items-center justify-center bg-overlay px-4" onClick={close}>
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="playlist-dialog-title"
              onClick={(e) => e.stopPropagation()}
              className="dialog-in card w-full max-w-sm p-2 shadow-[var(--shadow-raised)]"
            >
              <div className="flex items-start gap-3 px-2 pb-2 pt-2">
                <div className="min-w-0 flex-1">
                  <h2 id="playlist-dialog-title" className="text-base text-foreground">
                    Ajouter à une playlist
                  </h2>
                  <p className="truncate text-sm text-muted">{subtitle(request.subject)}</p>
                </div>
                <Button variant="ghost" size="sm" icon onClick={close} aria-label="Fermer">
                  <X size={14} aria-hidden="true" />
                </Button>
              </div>
              <PlaylistChooser subject={request.subject} source={request.source} onOutcome={done} autoFocus />
              {request.subject.kind === "item" && (
                <div className="flex justify-end px-1 pb-1">
                  <Button size="sm" variant="primary" onClick={close}>
                    Terminé
                  </Button>
                </div>
              )}
            </div>
          </div>,
          document.body
        )}
      {outcome && (
        <Toast action={outcome.undo ? "Annuler" : undefined} onAction={undo}>
          {outcome.message}
        </Toast>
      )}
    </>
  );
}
