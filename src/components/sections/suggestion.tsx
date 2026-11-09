"use client";

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/primitives";
import { useVisite } from "@/components/visite/VisiteEtat";
import type { ShowcaseTitle } from "@/lib/showcase";

// Suggestions de l'accueil — spec: specs/accueil-vitrine-connexion-v1.md (§ 3). Un titre tendance,
// hors de ta bibliothèque, s'ajoute d'un clic (même geste que les Sorties) ; ajouté, il devient un
// titre de ta pile (sa fiche s'ouvre) et un second clic le retire.

const JSON_HEADERS = { "Content-Type": "application/json" };

export type Suggestions = {
  /** L'identifiant dans ta bibliothèque d'une suggestion ajoutée ; null sinon. */
  libraryIdOf: (title: ShowcaseTitle) => number | null;
  /** Sans compte (page d'arrivée) : « Ça me tente » reste dans le navigateur, sans fiche à ouvrir. */
  bac?: boolean;
  inPile?: (title: ShowcaseTitle) => boolean;
  pending: number | null;
  message: string | null;
  toggle: (title: ShowcaseTitle) => Promise<void>;
};

const BacContexte = createContext<Suggestions | null>(null);

/**
 * La page d'arrivée (specs/bienvenue-v1.md, FR-13) : rien ne s'écrit sans compte. « Ça me tente » range le
 * titre dans l'état de la visite, dans le navigateur ; il suit le visiteur quand il continue.
 */
export function BacSuggestions({ children }: { children: ReactNode }) {
  const { etat, maj } = useVisite();
  const [message, setMessage] = useState<string | null>(null);
  const valeur = useMemo<Suggestions>(() => {
    const cle = (t: ShowcaseTitle) => `${t.type}:${t.suggestion?.tmdbId ?? t.id}`;
    return {
      bac: true,
      libraryIdOf: () => null,
      inPile: (t) => etat.tri[cle(t)] === "envie",
      pending: null,
      message,
      toggle: async (t) => {
        const k = cle(t);
        const deja = etat.tri[k] === "envie";
        maj((e) => {
          const tri = { ...e.tri };
          if (deja) delete tri[k];
          else tri[k] = "envie";
          return { ...e, tri };
        });
        setMessage(deja ? `« ${t.name} » retiré` : `« ${t.name} » te tente : il te suivra quand tu commenceras`);
      },
    };
  }, [etat, maj, message]);
  return <BacContexte.Provider value={valeur}>{children}</BacContexte.Provider>;
}

export function useSuggestions(): Suggestions {
  const bac = useContext(BacContexte);
  const reelles = useSuggestionsReelles();
  return bac ?? reelles;
}

function useSuggestionsReelles(): Suggestions {
  const [added, setAdded] = useState<Map<number, number>>(new Map());
  const [pending, setPending] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const libraryIdOf = useCallback((title: ShowcaseTitle) => added.get(title.id) ?? null, [added]);

  const toggle = useCallback(
    async (title: ShowcaseTitle) => {
      if (!title.suggestion) return;
      const current = added.get(title.id) ?? null;
      setPending(title.id);
      setMessage(null);
      try {
        if (current === null) {
          const res = await fetch("/api/items", {
            method: "POST",
            headers: JSON_HEADERS,
            body: JSON.stringify({ tmdbId: title.suggestion.tmdbId, type: title.type, source: "home" }),
          });
          const body = (await res.json().catch(() => null)) as { item?: { id: number } } | null;
          if (!res.ok || typeof body?.item?.id !== "number") {
            setMessage("L'ajout n'a pas abouti, réessaie.");
            return;
          }
          const id = body.item.id;
          setAdded((prev) => new Map(prev).set(title.id, id));
          setMessage(`« ${title.name} » ajouté à ta pile`);
        } else {
          const res = await fetch(`/api/items/${current}`, { method: "DELETE" });
          if (!res.ok) {
            setMessage("Le retrait n'a pas abouti, réessaie.");
            return;
          }
          setAdded((prev) => {
            const next = new Map(prev);
            next.delete(title.id);
            return next;
          });
          setMessage(`« ${title.name} » retiré de ta pile`);
        }
      } catch {
        setMessage("Pas de réponse, réessaie.");
      } finally {
        setPending(null);
      }
    },
    [added]
  );

  return { libraryIdOf, pending, message, toggle };
}

/**
 * « Ajouter à ma pile », puis « Dans ta pile » (un clic retire). `onImage` : sur une affiche (bouton
 * de superposition), sinon bouton secondaire.
 */
export function SuggestionButton({
  title,
  suggestions,
  onImage = false,
  compact = false,
}: {
  title: ShowcaseTitle;
  suggestions: Suggestions;
  onImage?: boolean;
  compact?: boolean;
}) {
  const inPile = suggestions.inPile ? suggestions.inPile(title) : suggestions.libraryIdOf(title) !== null;
  const pending = suggestions.pending === title.id;
  const ajouter = suggestions.bac ? "Ça me tente" : "Ajouter à ma pile";
  const label = inPile ? "Dans ta pile" : ajouter;
  return (
    <Button
      size="sm"
      icon={compact}
      variant={onImage ? "overlay" : inPile ? "ghost" : "secondary"}
      loading={pending}
      onClick={() => void suggestions.toggle(title)}
      aria-label={inPile ? `Retirer « ${title.name} » de ta pile` : suggestions.bac ? `« ${title.name} » me tente` : `Ajouter « ${title.name} » à ta pile`}
      title={inPile ? "Ajouté, cliquer pour retirer" : ajouter}
    >
      {!pending && (inPile ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />)}
      {!compact && label}
    </Button>
  );
}

/** La marque d'une suggestion : jamais confondue avec un titre de ta bibliothèque. */
export function SuggestionBadge() {
  return <Badge>Suggestion</Badge>;
}
