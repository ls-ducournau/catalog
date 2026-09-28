import { NumberRoll } from "@/components/motion/NumberRoll";
import { Badge } from "@/components/ui/primitives";

/**
 * Score de recommandation : probabilité estimée que tu notes le titre ⭐⭐⭐⭐ ou plus, calée sur
 * tes notes (voir le banc, « Compatibilité »). La couleur ne s'allume que franchement au-dessus
 * de ta moyenne : un 45 % est un titre ordinaire, pas une mauvaise note.
 */
export function CompatibilityChip({
  value,
  size = "sm",
  countUp = false,
}: {
  value: number | null;
  size?: "sm" | "md";
  /** Le chiffre monte depuis 0 à l'apparition (proposition principale de Ce soir). */
  countUp?: boolean;
}) {
  if (value === null) return null;
  const percent = Math.round(value * 100);
  return (
    <Badge
      variant={value >= 0.6 ? "success" : "neutral"}
      title={`${percent} % de chances que tu le notes 4 étoiles ou plus, d'après tes notes`}
      className={`tabular-nums ${value < 0.4 ? "text-muted" : ""} ${size === "md" ? "h-6 px-2 text-sm" : ""}`}
    >
      <NumberRoll value={percent} from={countUp ? 0 : undefined} suffix=" %" />
    </Badge>
  );
}
