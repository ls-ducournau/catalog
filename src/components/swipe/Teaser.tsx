"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { useBilan } from "@/components/visite/chapitres";
import { useVisite } from "@/components/visite/VisiteEtat";
import type { CarteSwipe, ReponseSwipe } from "@/lib/demarrage";
import { SwipeDeck, useFiches } from "./SwipeDeck";

// Le paquet de la page d'arrivée — spec: specs/bienvenue-v1.md (FR-8, FR-13). Le même geste que la
// bienvenue, sur une dizaine de titres, sans compte : les réponses restent dans le navigateur (l'état de la
// visite, partagé avec les sections de la page). « Continuer » mène à la bienvenue, qui les verse dans le
// compte. Au doigt, la page défile à la verticale : « Déjà vu » passe par son bouton ; au clavier, les
// flèches n'agissent que dans le paquet.

export function TeaserSwipe({ cartes }: { cartes: CarteSwipe[] }) {
  const { etat, maj } = useVisite();
  const bilan = useBilan();
  const [historique, setHistorique] = useState<CarteSwipe[]>([]);
  const [retour, setRetour] = useState<string | null>(null);
  const file = cartes.filter((c) => !etat.tri[c.cle]);
  const fiches = useFiches(file);

  function repondre(carte: CarteSwipe, r: ReponseSwipe) {
    maj((e) => ({ ...e, tri: { ...e.tri, [carte.cle]: r.kind === "envie" ? "envie" : r.kind === "non" ? "pasvu" : "vu" } }));
    setHistorique((h) => [...h, carte]);
    setRetour(
      r.kind === "envie" ? `« ${carte.name} » te tente.` : r.kind === "non" ? `« ${carte.name} » : pas pour toi.` : `« ${carte.name} » : déjà vu.`
    );
  }

  function annuler() {
    const carte = historique.at(-1);
    if (!carte) return;
    setHistorique((h) => h.slice(0, -1));
    maj((e) => {
      const tri = { ...e.tri };
      const notes = { ...e.notes };
      delete tri[carte.cle];
      delete notes[carte.cle];
      return { ...e, tri, notes };
    });
    setRetour(`« ${carte.name} » : annulé.`);
  }

  const gardes = bilan.titres.length;
  const continuer = (
    <Button href="/bienvenue" variant="primary">
      {gardes > 0 ? `Continuer avec mes ${gardes} titre${gardes > 1 ? "s" : ""}` : "Tester"}
    </Button>
  );

  const fin = (
    <>
      <p className="text-subheading text-foreground">{gardes > 0 ? "À toi de continuer." : "Rien ne t'a tenté ?"}</p>
      <p className="text-sm text-muted">
        {gardes > 0
          ? "La suite du paquet t'attend : tes titres te suivent, et Catalog apprend tes goûts à chaque geste."
          : "La suite du paquet continue avec d'autres titres."}
      </p>
      {continuer}
    </>
  );

  return (
    <div className="flex w-full flex-col items-center gap-4">
      <SwipeDeck
        cartes={file}
        fiches={fiches}
        onRepondre={repondre}
        onAnnuler={annuler}
        peutAnnuler={historique.length > 0}
        retour={retour}
        fin={fin}
        clavier="focus"
        balayageVertical={false}
      />
      {file.length > 0 && gardes > 0 && continuer}
    </div>
  );
}
