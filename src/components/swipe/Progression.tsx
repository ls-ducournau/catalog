import { Check, Lock, type LucideIcon } from "lucide-react";
import { MonoMeta } from "@/components/ui/primitives";
import { cn } from "@/lib/utils";

// La progression de la bienvenue — spec: specs/bienvenue-v1.md (FR-14). Quatre étapes, de gauche à droite
// comme on les déverrouille : balayer remplit la bibliothèque, et c'est elle qui ouvre la suite (noter ses
// titres vus, départager, ses recommandations). Chaque étape : son icône (cochée quand c'est fait, un
// cadenas tant qu'elle est fermée), son nom, sa barre ; la raison d'une étape fermée est dite au lecteur
// d'écran et au survol. Achromatique ; la barre avance en transform.

export type EtapeProgres = {
  id: string;
  nom: string;
  icone: LucideIcon;
  /** Où en est l'étape, et son objectif. */
  n: number;
  max: number;
  /** L'unité du compte (« titres », « notes », « duels »). */
  unite: string;
  /** Pourquoi elle est encore fermée ; null quand on peut la faire. */
  verrou: string | null;
};

export function ProgressionBienvenue({
  etapes,
  courante,
  onAller,
}: {
  etapes: EtapeProgres[];
  courante: string;
  onAller: (id: string) => void;
}) {
  const active = etapes.find((e) => e.id === courante) ?? etapes[0];
  const rang = etapes.indexOf(active);
  return (
    <nav
      aria-label="Étapes de la bienvenue"
      className="flex w-full max-w-2xl flex-col items-center gap-2"
    >
      <ol className="grid w-full grid-cols-4 gap-1 sm:gap-2">
        {etapes.map((e, i) => {
          const Icone = e.icone;
          const fait = e.n >= e.max;
          const ferme = e.verrou !== null;
          const etat = ferme
            ? e.verrou
            : `${Math.min(e.n, e.max)} ${e.unite} sur ${e.max}`;
          return (
            <li key={e.id} className="min-w-0">
              <button
                type="button"
                onClick={() => onAller(e.id)}
                aria-current={e.id === active.id ? "step" : undefined}
                aria-label={`Étape ${i + 1} : ${e.nom}, ${etat}`}
                title={etat ?? undefined}
                className={cn(
                  "etape-progres outline-none focus-visible:ring-2 focus-visible:ring-focus",
                  e.id === active.id && "is-active",
                  fait && "is-done",
                  ferme && "is-locked",
                )}
              >
                <span className="etape-progres-tete">
                  <span className="etape-progres-icone" aria-hidden="true">
                    {fait ? (
                      <Check size={13} />
                    ) : ferme ? (
                      <Lock size={12} />
                    ) : (
                      <Icone size={13} />
                    )}
                  </span>
                  <span className="hidden truncate sm:inline">{e.nom}</span>
                </span>
                <span className="etape-progres-barre" aria-hidden="true">
                  <span
                    style={{ transform: `scaleX(${Math.min(1, e.n / e.max)})` }}
                  />
                </span>
              </button>
            </li>
          );
        })}
      </ol>
      <MonoMeta aria-live="polite">
        {`Étape ${rang + 1} sur ${etapes.length} · ${active.nom} · ${active.verrou ?? `${Math.min(active.n, active.max)} / ${active.max} ${active.unite}`}`}
      </MonoMeta>
    </nav>
  );
}
