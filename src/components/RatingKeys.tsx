"use client";

import { STAR_LABELS, StarRow } from "@/components/StarRating";
import { Card, Keycap } from "@/components/ui";
import { cn } from "@/lib/utils";

// Les six notes d'une carte à la fois (Tri rapide : titres déjà vus, personnes aimées) : de 💩 (0)
// à cinq étoiles, chacune avec sa touche, 0 à 5. La même grille partout où l'on note au clavier.

export const RATING_LEVELS = [0, 1, 2, 3, 4, 5] as const;

/** Nom lu d'une note : « 💩, Nul », « 4 étoiles, Très bien ». */
export function ratingName(n: number): string {
  return n === 0 ? `💩, ${STAR_LABELS[0]}` : `${n} étoile${n > 1 ? "s" : ""}, ${STAR_LABELS[n]}`;
}

/** Retour après une note : « noté 💩 », « noté 4 sur 5 ». */
export function ratedAs(n: number): string {
  return n === 0 ? "noté 💩" : `noté ${n} sur 5`;
}

export function RatingKeys({
  onRate,
  disabled,
  pressed,
  fitContainer = false,
  className,
}: {
  onRate: (n: number) => void;
  disabled: boolean;
  /** Touche affichée enfoncée (« 0 » à « 5 »). */
  pressed: string | null;
  /** Colonnes selon la largeur du conteneur (`@container`) plutôt que de l'écran : aperçus de l'accueil. */
  fitContainer?: boolean;
  className?: string;
}) {
  return (
    <div
      role="group"
      aria-label="Ta note"
      className={cn(
        "grid w-full max-w-3xl grid-cols-3 gap-2",
        fitContainer ? "@lg:grid-cols-6 @lg:gap-3" : "sm:grid-cols-6 sm:gap-3",
        className
      )}
    >
      {RATING_LEVELS.map((n) => (
        <Card
          as="button"
          type="button"
          variant="tile"
          key={n}
          onClick={() => onRate(n)}
          disabled={disabled}
          aria-keyshortcuts={String(n)}
          aria-label={ratingName(n)}
          className="flex min-h-20 flex-col items-center justify-start gap-1.5 px-2 py-2.5 disabled:opacity-40"
        >
          <Keycap pressed={pressed === String(n)} aria-hidden="true" className="hidden sm:inline-flex">
            {n}
          </Keycap>
          <span aria-hidden="true" className="flex h-4 items-center">
            {n === 0 ? "💩" : <StarRow count={n} size={12} />}
          </span>
          {/* Sur une ligne : « Chef-d'œuvre » ne se coupe pas au trait d'union (audit UX W3-7). */}
          <span aria-hidden="true" className="whitespace-nowrap text-center text-xs text-muted">
            {STAR_LABELS[n]}
          </span>
        </Card>
      ))}
    </div>
  );
}
