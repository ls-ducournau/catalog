"use client";

import Link from "next/link";
import { Check } from "lucide-react";
import { avancement, CHAPITRES } from "@/lib/visite";
import { useVisite } from "./VisiteEtat";

/**
 * Le fil de la visite, collé sous la barre : les huit chapitres, cochés quand le geste est fait, et
 * « Garder » au bout. Défile sur une ligne au téléphone.
 */
export function ProgressionVisite() {
  const { etat } = useVisite();
  const fait = avancement(etat);
  return (
    <nav aria-label="Étapes de la visite" className="sticky top-16 z-30 -mx-4 overflow-x-auto px-4 py-2 sm:mx-0 sm:px-0 lg:top-24">
      <ol className="flex w-max items-center gap-2">
        {CHAPITRES.map((c, i) => (
          <li key={c.id}>
            <Link href={`#${c.id}`} className="chip">
              {fait[c.id] ? <Check size={12} aria-label="fait" /> : <span className="text-muted">{i + 1}</span>}
              {c.nom}
            </Link>
          </li>
        ))}
        <li>
          <Link href="#garder" className="chip">
            Garder
          </Link>
        </li>
      </ol>
    </nav>
  );
}
