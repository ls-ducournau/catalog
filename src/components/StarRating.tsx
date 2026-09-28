"use client";

import { useRef, useState, type CSSProperties } from "react";
import { Star } from "lucide-react";

/** Échelle de notation Notion : "💩" (palier le plus bas), puis 1 à 5 "⭐️". */
const WORST = "💩";
const STAR_LABELS = ["Nul", "Bof", "Correct", "Bien", "Très bien", "Chef-d'œuvre"] as const;

/** Nombre d'étoiles d'une note ; 0 pour "💩" comme pour une note absente. */
export function starCount(rating: string | null): number {
  if (!rating) return 0;
  return rating.split("⭐️").length - 1;
}

/** Directions de la gerbe d'étincelles, en px depuis le centre de l'étoile. */
const SPARKLES = ["-10px -9px", "9px -10px", "11px 5px", "-9px 7px", "0px -13px"].map((v) => {
  const [sx, sy] = v.split(" ");
  return { sx, sy };
});

/**
 * Notation en manipulation directe : survol = aperçu, clic = pose la note, re-clic sur la même
 * valeur = efface. Le clic déclenche une cascade d'étoiles qui « popent » une à une.
 * Les clics sont isolés (stopPropagation) pour rester utilisable posé sur une card cliquable.
 */
export function StarRating({
  rating,
  onRate,
  size = "md",
  showWorstTier = false,
  showLabel = false,
  className = "",
}: {
  rating: string | null;
  onRate: (next: string | null) => void;
  size?: "sm" | "md";
  /** Palier "💩" — demande de la place, réservé aux contextes larges. */
  showWorstTier?: boolean;
  showLabel?: boolean;
  className?: string;
}) {
  const [hover, setHover] = useState(0);
  // Une sélection incrémente la clé : les nœuds animés se remontent, donc l'animation rejoue
  // même quand on repose la même note deux fois de suite.
  const [burst, setBurst] = useState<{ key: number; upTo: number } | null>(null);
  const burstCount = useRef(0);

  const selected = starCount(rating);
  const shown = hover || selected;
  // Cibles de 24 px au moins (WCAG 2.5.8, AC-5.2) : 5 × 24 = 120 px en « sm ». Les cartes plus
  // étroites montrent la note en lecture seule (StarsReadOnly) ; on note alors depuis la fiche.
  const iconSize = size === "sm" ? 14 : 19;
  const stagger = size === "sm" ? 32 : 45;
  const hitClass = size === "sm" ? "h-6 w-6" : "h-7 w-7";

  function commit(next: string | null, upTo: number) {
    onRate(next);

    if (next === null) {
      setBurst(null);
    } else {
      burstCount.current += 1;
      setBurst({ key: burstCount.current, upTo });
    }

    // Retour haptique là où il existe (Android) : renforce le geste sans un pixel de plus.
    if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
      navigator.vibrate(next === null ? 6 : 12);
    }
  }

  const label = hover > 0 ? STAR_LABELS[hover] : rating === WORST ? STAR_LABELS[0] : selected > 0 ? STAR_LABELS[selected] : "";

  return (
    <div className={`flex items-center gap-1.5 ${className}`}>
      {showWorstTier && (
        <button
          type="button"
          aria-label={STAR_LABELS[0]}
          aria-pressed={rating === WORST}
          title={STAR_LABELS[0]}
          onClick={(e) => {
            e.stopPropagation();
            commit(rating === WORST ? null : WORST, 0);
          }}
          className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border text-sm transition duration-150 active:scale-95 ${
            rating === WORST
              ? "star-set border-accent bg-accent/10"
              : "border-surface-border opacity-40 hover:scale-110 hover:opacity-100"
          }`}
        >
          {WORST}
        </button>
      )}

      <div
        role="radiogroup"
        aria-label="Note en étoiles"
        className={`flex items-center ${size === "sm" ? "-ml-[5px]" : "-ml-1"}`}
        onMouseLeave={() => setHover(0)}
      >
        {[1, 2, 3, 4, 5].map((n) => {
          const filled = n <= shown;
          const popping = burst !== null && n <= burst.upTo;

          return (
            <button
              key={n}
              type="button"
              role="radio"
              aria-label={`${n} étoile${n > 1 ? "s" : ""}`}
              aria-checked={n === selected}
              // Re-cliquer la note posée l'efface : sans l'indiquer, personne ne le devine.
              title={
                n === selected ? "Retirer la note" : `${n} étoile${n > 1 ? "s" : ""}, ${STAR_LABELS[n]}`
              }
              onMouseEnter={() => setHover(n)}
              onClick={(e) => {
                e.stopPropagation();
                commit(n === selected ? null : "⭐️".repeat(n), n);
              }}
              className={`relative flex shrink-0 items-center justify-center rounded-md outline-none transition-transform duration-100 active:scale-90 focus-visible:ring-2 focus-visible:ring-focus ${hitClass}`}
            >
              {/* Le pop vit sur un nœud interne : il ne se bagarre pas avec le scale de survol. */}
              <span
                key={popping ? `burst-${burst.key}-${n}` : `idle-${n}`}
                className={`block ${popping ? "star-set" : ""}`}
                style={popping ? { animationDelay: `${(n - 1) * stagger}ms` } : undefined}
              >
                <Star
                  size={iconSize}
                  strokeWidth={1.5}
                  className={`transition-colors duration-150 ${
                    filled ? "fill-foreground text-foreground" : "fill-transparent text-subtle"
                  }`}
                />
              </span>

              {/* Étincelles sur la dernière étoile de la cascade : le moment de récompense. */}
              {popping && n === burst.upTo && (
                <span aria-hidden="true" className="pointer-events-none absolute inset-0">
                  {SPARKLES.map((s, i) => (
                    <span
                      key={`${burst.key}-${i}`}
                      className="star-sparkle absolute left-1/2 top-1/2 h-1 w-1 rounded-full bg-foreground"
                      style={
                        {
                          "--sx": s.sx,
                          "--sy": s.sy,
                          animationDelay: `${(n - 1) * stagger + 40}ms`,
                        } as CSSProperties
                      }
                    />
                  ))}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {showLabel && (
        // Hauteur fixe : le libellé change au survol sans faire sauter la mise en page.
        <span className="ml-0.5 h-4 min-w-[74px] text-xs leading-4 text-muted">{label}</span>
      )}
    </div>
  );
}

/** Note en lecture seule, pour les cartes trop étroites pour cinq cibles de 24 px. */
export function StarsReadOnly({ rating, className = "" }: { rating: string | null; className?: string }) {
  const count = starCount(rating);
  return (
    <span role="img" aria-label={count ? `Note : ${count} sur 5` : "Pas encore noté"} className={`flex items-center gap-px ${className}`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star
          key={n}
          size={12}
          strokeWidth={1.5}
          aria-hidden="true"
          className={n <= count ? "fill-foreground text-foreground" : "fill-transparent text-subtle"}
        />
      ))}
    </span>
  );
}
