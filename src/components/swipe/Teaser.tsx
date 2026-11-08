"use client";

import { useState } from "react";
import { ratedAs } from "@/components/RatingKeys";
import { Button } from "@/components/ui/Button";
import { useGarder } from "@/components/visite/chapitres";
import { useVisite } from "@/components/visite/VisiteEtat";
import type { CarteSwipe, ReponseSwipe } from "@/lib/demarrage";
import { SwipeDeck, useFiches } from "./SwipeDeck";

// Le paquet de la page d'arrivée — spec: specs/bienvenue-v1.md (FR-8). Le même geste que la bienvenue, sur
// une dizaine de titres, sans compte : les réponses restent dans le navigateur (l'état de la visite) jusqu'à
// « Continuer » qui les garde et ouvre la bienvenue. Au doigt, la page défile à la verticale : « Déjà vu »
// passe par son bouton ; au clavier, les flèches n'agissent que dans le paquet.

export function TeaserSwipe({ cartes }: { cartes: CarteSwipe[] }) {
  const { etat, maj } = useVisite();
  const { bilan, garder, envoi, erreur } = useGarder();
  const [historique, setHistorique] = useState<CarteSwipe[]>([]);
  const [retour, setRetour] = useState<string | null>(null);
  const file = cartes.filter((c) => !etat.tri[c.cle]);
  const fiches = useFiches(file);

  function repondre(carte: CarteSwipe, r: ReponseSwipe) {
    maj((e) => {
      const tri = { ...e.tri };
      const notes = { ...e.notes };
      if (r.kind === "envie") tri[carte.cle] = "envie";
      else if (r.kind === "non") tri[carte.cle] = "pasvu";
      else {
        tri[carte.cle] = "vu";
        if (r.note !== null) notes[carte.cle] = r.note;
      }
      return { ...e, tri, notes };
    });
    setHistorique((h) => [...h, carte]);
    setRetour(
      r.kind === "envie"
        ? `« ${carte.name} » te tente.`
        : r.kind === "non"
          ? `« ${carte.name} » : pas pour toi.`
          : r.note === null
            ? `« ${carte.name} » : vu.`
            : `« ${carte.name} » ${ratedAs(r.note)}.`
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
    <Button variant="primary" onClick={() => void garder()} loading={envoi !== null} disabled={gardes === 0}>
      {gardes > 0 ? `Garder mes ${gardes} titre${gardes > 1 ? "s" : ""} et continuer` : "Garder et continuer"}
    </Button>
  );

  const fin =
    gardes > 0 ? (
      <>
        <p className="text-subheading text-foreground">À toi de continuer.</p>
        <p className="text-sm text-muted">Garde ces titres : la suite de la pile t&apos;attend, et Catalog apprend tes goûts à chaque geste.</p>
        {continuer}
      </>
    ) : (
      <>
        <p className="text-subheading text-foreground">Rien ne t&apos;a tenté ?</p>
        <p className="text-sm text-muted">La pile continue avec d&apos;autres titres, plus près de tes goûts.</p>
        <Button href="/bienvenue" variant="primary">
          Tester
        </Button>
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
      {file.length > 0 && gardes > 0 && <div className="flex flex-col items-center gap-2">{continuer}</div>}
      {erreur && (
        <p role="alert" className="text-sm text-muted">
          {erreur}
        </p>
      )}
    </div>
  );
}
