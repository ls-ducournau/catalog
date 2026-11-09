"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ETAT_VIDE, type EtatVisite, type Etape } from "@/lib/visite";

// L'état de la visite (specs/visite-interactive-v1.md) : dans le navigateur du visiteur seulement, gardé
// d'une page à l'autre (localStorage). Le stockage peut être refusé (navigation privée) : la visite marche
// alors sans mémoire.

const CLE = "catalog-visite-v1";

type Visite = {
  etat: EtatVisite;
  maj: (f: (etat: EtatVisite) => EtatVisite) => void;
  oublier: () => void;
};

const Contexte = createContext<Visite | null>(null);

function lire(): EtatVisite {
  try {
    const brut = window.localStorage.getItem(CLE);
    return brut ? { ...ETAT_VIDE, ...(JSON.parse(brut) as Partial<EtatVisite>) } : ETAT_VIDE;
  } catch {
    return ETAT_VIDE;
  }
}

function ecrire(etat: EtatVisite | null) {
  try {
    if (etat) window.localStorage.setItem(CLE, JSON.stringify(etat));
    else window.localStorage.removeItem(CLE);
  } catch {
    // Stockage refusé : la visite continue sans mémoire.
  }
}

/**
 * `persistant` (le paquet de la page d'arrivée) : gardé dans le navigateur, il suit le visiteur à la
 * bienvenue. Sans (les démonstrations des sections) : un état à part, oublié au rechargement, qui ne change
 * rien ailleurs sur la page (demande de Louis, 2026-11-09).
 */
export function VisiteProvider({ persistant = true, children }: { persistant?: boolean; children: ReactNode }) {
  const [etat, setEtat] = useState<EtatVisite>(ETAT_VIDE);

  useEffect(() => {
    if (!persistant) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- l'état gardé ne se lit qu'au navigateur
    setEtat(lire());
    const surStockage = (e: StorageEvent) => e.key === CLE && setEtat(lire());
    window.addEventListener("storage", surStockage);
    return () => window.removeEventListener("storage", surStockage);
  }, [persistant]);

  const maj = useCallback(
    (f: (etat: EtatVisite) => EtatVisite) =>
      setEtat((avant) => {
        const apres = f(avant);
        if (persistant) ecrire(apres);
        return apres;
      }),
    [persistant]
  );

  const oublier = useCallback(() => {
    if (persistant) ecrire(null);
    setEtat(ETAT_VIDE);
  }, [persistant]);

  const valeur = useMemo(() => ({ etat, maj, oublier }), [etat, maj, oublier]);
  return <Contexte.Provider value={valeur}>{children}</Contexte.Provider>;
}

/** L'état gardé, lu hors d'un fournisseur (la bienvenue, qui le verse dans le compte). */
export const lireEtatVisite = lire;
export const oublierEtatVisite = () => ecrire(null);

export function useVisite(): Visite {
  const visite = useContext(Contexte);
  if (!visite) throw new Error("useVisite hors de VisiteProvider");
  return visite;
}

/**
 * Plusieurs chapitres à l'écran (la page d'arrivée) : leurs touches n'agissent que dans le chapitre qui a
 * le focus. Une étape à l'écran (la visite) : partout.
 */
const ClavierLocalContexte = createContext(false);
export function ClavierLocal({ children }: { children: ReactNode }) {
  return <ClavierLocalContexte.Provider value={true}>{children}</ClavierLocalContexte.Provider>;
}
export const useClavierLocal = () => useContext(ClavierLocalContexte);

/** Passer à une étape de la visite (fourni par le parcours, une étape à l'écran). */
const AllerContexte = createContext<((etape: Etape) => void) | null>(null);
export const AllerProvider = AllerContexte.Provider;

export function useAller(): ((etape: Etape) => void) | null {
  return useContext(AllerContexte);
}
