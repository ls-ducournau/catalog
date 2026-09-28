"use client";

import { useSyncExternalStore } from "react";

// Préférence de lecture des bandes-annonces — spec: specs/bandes-annonces-v1.md (FR-7)
//
// Mémorisée sur l'appareil (localStorage) ; tous les boutons se mettent à jour quand elle change.

export type TrailerMode = "embed" | "youtube" | "hidden";

const STORAGE_KEY = "watchlist:trailerMode";
const CHANGE_EVENT = "watchlist:trailer-mode";

export function readTrailerMode(): TrailerMode {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === "youtube" || value === "hidden" ? value : "embed";
  } catch {
    return "embed";
  }
}

export function writeTrailerMode(mode: TrailerMode): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // stockage indisponible : le choix vaut pour cette page seulement.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(CHANGE_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(CHANGE_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

export function useTrailerMode(): TrailerMode {
  return useSyncExternalStore(subscribe, readTrailerMode, () => "embed");
}
