"use client";

import { useEffect, useState, type FormEvent } from "react";
import { Button, TextField } from "@/components/ui";

// Ton compte, dans les réglages — spec: specs/catalog-v2-rust-supabase.md (FR-2). N'apparaît qu'en
// ligne (v2) : la route /session/etat n'existe pas en local, le bloc reste alors invisible.
// Un invité garde son compte par e-mail et mot de passe, sans code ; un compte durable se reconnecte
// depuis un autre appareil.

type Etat = { connecte: boolean; anonyme: boolean; email: string | null };

export function CompteV2() {
  const [etat, setEtat] = useState<Etat | null>(null);
  const [mode, setMode] = useState<"garder" | "connexion">("garder");
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);

  useEffect(() => {
    let vivant = true;
    fetch("/session/etat", { cache: "no-store" })
      .then((r) => (r.ok ? (r.json() as Promise<Etat>) : null))
      .then((e) => vivant && setEtat(e))
      .catch(() => {});
    return () => {
      vivant = false;
    };
  }, []);

  if (!etat) return null;

  async function envoyer(action: string, corps?: unknown) {
    setEnvoi(true);
    setErreur(null);
    const r = await fetch(`/session/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: corps === undefined ? undefined : JSON.stringify(corps),
    }).catch(() => null);
    const json = (await r?.json().catch(() => null)) as { error?: string } | null;
    if (!r?.ok) {
      setEnvoi(false);
      setErreur(json?.error ?? "Le compte ne répond pas.");
      return;
    }
    // Tout l'écran dépend du compte : on recharge.
    window.location.reload();
  }

  function soumettre(e: FormEvent) {
    e.preventDefault();
    void envoyer(mode, { email, motDePasse });
  }

  return (
    <fieldset className="mb-3 border-b border-divider pb-3">
      <legend className="px-1 text-sm font-semibold text-foreground">Ton compte</legend>
      {etat.anonyme ? (
        <form onSubmit={soumettre} className="mt-2 flex flex-col gap-2 px-1">
          <p className="text-xs text-muted">
            {mode === "garder"
              ? "Tu es en invité. Garde ton compte pour retrouver tes titres depuis un autre appareil."
              : "Retrouve ton compte. Ce que tu as fait en invité ici n'y sera pas repris."}
          </p>
          <TextField label="E-mail" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="E-mail" size="sm" required />
          <TextField
            label="Mot de passe"
            type="password"
            autoComplete={mode === "garder" ? "new-password" : "current-password"}
            value={motDePasse}
            onChange={(e) => setMotDePasse(e.target.value)}
            placeholder={mode === "garder" ? "Choisis un mot de passe" : "Mot de passe"}
            size="sm"
            minLength={6}
            required
          />
          {erreur && (
            <p role="alert" className="text-xs text-muted">
              {erreur}
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" variant="primary" loading={envoi}>
              {mode === "garder" ? "Garder mon compte" : "Se connecter"}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode(mode === "garder" ? "connexion" : "garder")}>
              {mode === "garder" ? "J'ai déjà un compte" : "Garder celui-ci"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="mt-2 flex flex-col gap-2 px-1">
          <p className="text-xs text-muted">
            Connecté : <span className="text-foreground">{etat.email}</span>
          </p>
          <Button type="button" size="sm" variant="ghost" className="self-start" onClick={() => void envoyer("deconnexion")} loading={envoi}>
            Se déconnecter
          </Button>
        </div>
      )}
    </fieldset>
  );
}
