"use client";

import { useCallback, useState } from "react";
import { Check, Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/primitives";
import type { ShowcaseTitle } from "@/lib/showcase";

// Suggestions de l'accueil — spec: specs/accueil-vitrine-connexion-v1.md (§ 3). Un titre tendance,
// hors de ta bibliothèque, s'ajoute d'un clic (même geste que les Sorties) ; ajouté, il devient un
// titre de ta pile (sa fiche s'ouvre) et un second clic le retire.

const JSON_HEADERS = { "Content-Type": "application/json" };

export type Suggestions = {
  /** L'identifiant dans ta bibliothèque d'une suggestion ajoutée ; null sinon. */
  libraryIdOf: (title: ShowcaseTitle) => number | null;
  pending: number | null;
  message: string | null;
  toggle: (title: ShowcaseTitle) => Promise<void>;
};

export function useSuggestions(): Suggestions {
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
  const inPile = suggestions.libraryIdOf(title) !== null;
  const pending = suggestions.pending === title.id;
  const label = inPile ? "Dans ta pile" : "Ajouter à ma pile";
  return (
    <Button
      size="sm"
      icon={compact}
      variant={onImage ? "overlay" : inPile ? "ghost" : "secondary"}
      loading={pending}
      onClick={() => void suggestions.toggle(title)}
      aria-label={inPile ? `Retirer « ${title.name} » de ta pile` : `Ajouter « ${title.name} » à ta pile`}
      title={inPile ? "Ajouté, cliquer pour retirer" : "Ajouter à ma pile"}
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
