"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { useEtatCompte, type EtatCompte } from "@/components/CompteBouton";
import { CommandWindow } from "@/components/sections";
import { Button, Kbd, Skeleton, Tabs, TextField } from "@/components/ui";

// La connexion — spec: specs/accueil-vitrine-connexion-v1.md (§ 4). Une fenêtre de commande posée sur
// le héros (comme les Duels) : « Se connecter » ou « Créer un compte », e-mail et mot de passe, sans
// code de validation (décision de Louis, 2026-10-27). Créer un compte garde ce que l'invité a déjà
// fait (même identifiant) ; se connecter à un autre compte laisse l'essai en invité de côté.

type Mode = "connexion" | "garder";

export function ConnexionForm({ retour, demo }: { retour: string; /** Page /design : un état donné, sans lecture. */ demo?: EtatCompte }) {
  const router = useRouter();
  const lu = useEtatCompte();
  const etat = demo ?? lu;
  const [choix, setChoix] = useState<Mode | null>(null);
  const [email, setEmail] = useState("");
  const [motDePasse, setMotDePasse] = useState("");
  const [erreur, setErreur] = useState<string | null>(null);
  const [envoi, setEnvoi] = useState(false);
  const [charge, setCharge] = useState(false);

  // En local (v1), /session/etat répond 404 : pas de compte à gérer.
  if (etat === null) {
    return (
      <CommandWindow secondary={[{ label: "Retour", keys: ["Esc"], onClick: () => router.push(retour) }]}>
        <p className="p-5 text-sm text-muted">
          Ici, Catalog garde tes titres sur cet ordinateur : pas de compte à créer.
        </p>
      </CommandWindow>
    );
  }
  if (etat === undefined) {
    return (
      <CommandWindow>
        <div className="flex flex-col gap-3 p-5" aria-busy="true">
          <Skeleton className="h-8 w-1/2" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      </CommandWindow>
    );
  }

  const durable = etat.connecte && !etat.anonyme && etat.email;
  if (durable) {
    return (
      <CommandWindow
        context={<span className="text-sm text-muted">Sur tous tes appareils.</span>}
        secondary={[{ label: "Retour", keys: ["Esc"], onClick: () => router.push(retour) }]}
      >
        <div className="flex flex-col items-start gap-4 p-5">
          <p className="text-sm text-muted">
            Connecté : <span className="text-foreground">{etat.email}</span>
          </p>
          <Button
            variant="secondary"
            loading={envoi}
            onClick={async () => {
              setEnvoi(true);
              await fetch("/session/deconnexion", { method: "POST" }).catch(() => null);
              // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- rechargement complet voulu
              window.location.href = "/";
            }}
          >
            <LogOut size={14} aria-hidden="true" />
            Se déconnecter
          </Button>
        </div>
      </CommandWindow>
    );
  }

  // Un invité qui a commencé : on lui propose d'abord de garder son compte.
  const mode: Mode = choix ?? (etat.connecte ? "garder" : "connexion");

  async function soumettre(e: FormEvent) {
    e.preventDefault();
    setEnvoi(true);
    setErreur(null);
    const r = await fetch(`/session/${mode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, motDePasse }),
    }).catch(() => null);
    const corps = (await r?.json().catch(() => null)) as { error?: string } | null;
    if (!r?.ok) {
      setEnvoi(false);
      setErreur(corps?.error ?? "Le compte ne répond pas. Réessaie.");
      return;
    }
    setCharge(true);
    // Tout l'écran dépend du compte : un vrai rechargement de la page d'où l'on venait.
     
    window.location.href = retour;
  }

  return (
    <CommandWindow
      head={
        <Tabs
          label="Ton compte"
          options={[
            { value: "garder", label: "Créer un compte" },
            { value: "connexion", label: "Se connecter" },
          ]}
          value={mode}
          onChange={(v) => {
            setChoix(v as Mode);
            setErreur(null);
          }}
        />
      }
      context={<span className="text-sm text-muted">Sans code de confirmation.</span>}
      secondary={[{ label: "Plus tard", keys: ["Esc"], onClick: () => router.push(retour) }]}
    >
      <form
        onSubmit={soumettre}
        onKeyDown={(e) => {
          if (e.key === "Escape") router.push(retour);
        }}
        className="flex flex-col gap-3 p-5"
      >
        <p className="text-sm text-muted">
          {mode === "garder"
            ? "Garde ce que tu as fait ici et retrouve-le depuis n'importe quel appareil."
            : "Retrouve ton compte. Ce que tu as fait ici en invité n'y sera pas repris."}
        </p>
        <TextField
          label="E-mail"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="E-mail"
          aria-invalid={erreur ? true : undefined}
          required
          autoFocus
        />
        <TextField
          label="Mot de passe"
          type="password"
          autoComplete={mode === "garder" ? "new-password" : "current-password"}
          value={motDePasse}
          onChange={(e) => setMotDePasse(e.target.value)}
          placeholder={mode === "garder" ? "Mot de passe, 6 caractères ou plus" : "Mot de passe"}
          aria-invalid={erreur ? true : undefined}
          minLength={6}
          required
        />
        <p role="alert" aria-live="assertive" className="min-h-5 text-sm text-foreground">
          {erreur}
        </p>
        <Button type="submit" variant="primary" loading={envoi || charge} className="self-start">
          {mode === "garder" ? "Créer mon compte" : "Se connecter"}
          <Kbd className="hidden sm:inline-flex">↵</Kbd>
        </Button>
      </form>
    </CommandWindow>
  );
}
