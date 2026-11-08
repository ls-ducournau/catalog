import { MonoMeta } from "@/components/ui/primitives";
import { OBJECTIF_NOTES, OBJECTIF_TITRES, prochainPalier, type Progression } from "@/lib/demarrage";
import { cn } from "@/lib/utils";

// La jauge de démarrage — spec: specs/bienvenue-v1.md (FR-6). Deux barres : les titres de la bibliothèque
// (assez pour que l'application ait de quoi choisir) et les notes (assez pour les recommandations), puis le
// prochain palier en une phrase. Achromatique : blanc sur gris, le libellé porte le sens.

export function JaugeDemarrage({ progression, className }: { progression: Progression; className?: string }) {
  const barres = [
    { label: "Titres", n: progression.titres, max: OBJECTIF_TITRES },
    { label: "Notes", n: progression.notes, max: OBJECTIF_NOTES },
  ];
  return (
    <div className={cn("flex w-full max-w-md flex-col gap-2 text-left", className)}>
      <div className="grid grid-cols-2 gap-4">
        {barres.map((b) => {
          const n = Math.min(b.n, b.max);
          return (
            <div key={b.label} className="flex flex-col gap-1.5">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="text-muted">{b.label}</span>
                <MonoMeta className="text-foreground">{`${n} / ${b.max}`}</MonoMeta>
              </div>
              <div
                role="progressbar"
                aria-label={b.label}
                aria-valuemin={0}
                aria-valuemax={b.max}
                aria-valuenow={n}
                className="h-1.5 overflow-hidden rounded-full bg-surface-3"
              >
                <div
                  className="h-full w-full origin-left rounded-full bg-foreground"
                  style={{ transform: `scaleX(${n / b.max})`, transition: "transform var(--dur-base) var(--ease-out)" }}
                />
              </div>
            </div>
          );
        })}
      </div>
      <p aria-live="polite" className="text-sm text-muted">
        {prochainPalier(progression) ?? "Ta bibliothèque est prête : toutes les fonctions ont de quoi choisir."}
      </p>
    </div>
  );
}
