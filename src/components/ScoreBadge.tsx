/**
 * Score TMDB façon "note d'audience" (cercle % coloré, docs/design-reference/raycast/composants/
 * note-et-score.md) — voteCount=0 → "NR" plutôt qu'un faux 0%.
 * Le tracé est vectoriel : seule la taille de la boîte et celle du chiffre changent selon `size`
 * ("md" pour les listes et les fiches où on lit le score, "sm" dans un coin d'affiche).
 */
export function ScoreBadge({
  voteAverage,
  voteCount,
  size = "sm",
}: {
  voteAverage: number | null;
  voteCount: number | null;
  size?: "sm" | "md";
}) {
  // "md" ne grandit qu'à partir de `sm:` : sur un écran étroit, la place va au titre.
  const boxClass = size === "md" ? "h-8 w-8 sm:h-10 sm:w-10" : "h-8 w-8";
  const textClass = "text-xs";

  if (!voteCount) {
    return (
      <div
        className={`flex ${boxClass} shrink-0 items-center justify-center rounded-full bg-black/40 font-semibold text-foreground ${textClass}`}
      >
        NR
      </div>
    );
  }

  const pct = Math.round((voteAverage ?? 0) * 10);
  // Couleur des scores (décision D6) : vert dès 70, jaune de 40 à 69, gris dessous. Le chiffre
  // reste au centre : la couleur ne porte jamais seule l'information.
  const colorClass = pct >= 70 ? "stroke-score-high" : pct >= 40 ? "stroke-score-mid" : "stroke-score-low";
  const radius = 13;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div
      className={`relative ${boxClass} shrink-0 rounded-full bg-black/40`}
      title={`${pct}% (${voteCount.toLocaleString("fr-FR")} votes)`}
    >
      <svg viewBox="0 0 30 30" className={`${boxClass} -rotate-90`}>
        <circle cx="15" cy="15" r={radius} strokeWidth="3" fill="none" className="stroke-white/15" />
        <circle
          cx="15"
          cy="15"
          r={radius}
          strokeWidth="3"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className={colorClass}
        />
      </svg>
      <span
        className={`absolute inset-0 flex items-center justify-center font-semibold text-foreground ${textClass}`}
      >
        {pct}
      </span>
    </div>
  );
}
