"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { ETAT_VIDE, type EtatVisite } from "@/lib/visite";

// L'état de la visite (specs/visite-interactive-v1.md) : dans le navigateur du visiteur seulement.
// `persistant` : gardé d'une page à l'autre (localStorage), sinon oublié au rechargement (les
// démonstrations de l'accueil). Le stockage peut être refusé (navigation privée) : la visite marche alors
// sans mémoire.

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

export function useVisite(): Visite {
  const visite = useContext(Contexte);
  if (!visite) throw new Error("useVisite hors de VisiteProvider");
  return visite;
}
