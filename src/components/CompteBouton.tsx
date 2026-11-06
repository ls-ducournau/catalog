"use client";

import { useEffect, useRef, useState } from "react";
import { LogOut } from "lucide-react";
import { Button, buttonClass } from "@/components/ui/Button";

// Le compte dans la barre du haut — spec: specs/accueil-vitrine-connexion-v1.md (§ 4). En ligne (v2)
// seulement : la route /session/etat n'existe pas en local, le bouton reste alors invisible.
// Visiteur ou invité : « Se connecter » ouvre /connexion. Compte durable : son initiale, qui ouvre un
// menu (l'adresse, « Se déconnecter »).

export type EtatCompte = { connecte: boolean; anonyme: boolean; email: string | null };

/** L'état du compte : undefined pendant la lecture, null là où il n'y a pas de comptes (local). */
export function useEtatCompte(): EtatCompte | null | undefined {
  const [etat, setEtat] = useState<EtatCompte | null | undefined>(undefined);
  useEffect(() => {
    let vivant = true;
    fetch("/session/etat", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<EtatCompte>) : null))
      .then((e) => vivant && setEtat(e))
      .catch(() => vivant && setEtat(null));
    return () => {
      vivant = false;
    };
  }, []);
  return etat;
}

/** Le bouton selon l'état du compte (sans appel réseau : la page /design montre chaque état). */
export function CompteBoutonVue({ etat, onDeconnexion }: { etat: EtatCompte; onDeconnexion?: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement | null>(null);
  const toggle = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        toggle.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!etat.connecte || etat.anonyme || !etat.email) {
    return <Button href="/connexion">Se connecter</Button>;
  }

  const initiale = etat.email.trim().charAt(0).toUpperCase() || "?";
  return (
    <div ref={root} className="relative shrink-0">
      <button
        ref={toggle}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls="app-compte"
        aria-label={`Ton compte : ${etat.email}`}
        title={etat.email}
        className={buttonClass({ variant: "secondary", icon: true })}
      >
        <span aria-hidden="true" className="text-sm font-semibold text-foreground">
          {initiale}
        </span>
      </button>
      {open && (
        <div
          id="app-compte"
          role="dialog"
          aria-label="Ton compte"
          className="menu-pop menu-panel absolute right-0 top-full z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] p-2"
        >
          <p className="px-1 text-xs text-muted">Connecté</p>
          <p className="truncate px-1 text-sm text-foreground">{etat.email}</p>
          <div className="mt-2 border-t border-divider pt-2">
            <Button size="sm" variant="ghost" className="w-full justify-start" onClick={onDeconnexion}>
              <LogOut size={14} aria-hidden="true" />
              Se déconnecter
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

export function CompteBouton() {
  const etat = useEtatCompte();
  if (!etat) return null;
  return (
    <CompteBoutonVue
      etat={etat}
      onDeconnexion={async () => {
        await fetch("/session/deconnexion", { method: "POST" }).catch(() => null);
        // Tout l'écran dépend du compte : un vrai rechargement, depuis l'accueil.
        // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- rechargement complet voulu
        window.location.href = "/";
      }}
    />
  );
}
