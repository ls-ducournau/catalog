"use client";

import { useCallback, useEffect, useEffectEvent, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, ArrowRight, CalendarDays, Layers, ListVideo, Popcorn, Save, Sparkles, Star, Swords, Trophy, type LucideIcon } from "lucide-react";
import { HeroLayout } from "@/components/layouts";
import { CommandWindow } from "@/components/sections";
import { Button, MonoMeta } from "@/components/ui";
import type { ShowcaseTitle } from "@/lib/showcase";
import { cn } from "@/lib/utils";
import { adresseEtape, CHAPITRES, ETAPES, etapeDe, type Etape } from "@/lib/visite";
import {
  BarreVisite,
  CeSoirVisite,
  ClassementVisite,
  DuelsVisite,
  GarderVisite,
  NotationVisite,
  PlaylistVisite,
  RecosVisite,
  SortiesVisite,
  TriVisite,
} from "./chapitres";
import { AllerProvider } from "./VisiteEtat";

// La visite pas à pas — specs/visite-interactive-v1.md, docs/audit/landing-visite-app-2026-11-07.md (§ 3).
// Une étape à l'écran, dans la fenêtre de commande de l'application : « Étape n sur 8 », le pourquoi, le
// geste, puis ce que l'application ajoute. Précédent et Suivant dans la barre fixée en bas (et les flèches
// du clavier) ; l'adresse suit l'étape (`?etape=`), le retour du navigateur revient à la précédente.
// « Garder » rejoint la barre dès le premier titre trié.

type Texte = {
  icone: LucideIcon;
  nom: string;
  titre: string;
  pourquoi: string;
  /** Ce que l'application ajoute à ce chapitre. */
  plus?: string;
};

const TEXTES: Record<Etape, Texte> = {
  tri: {
    icone: Layers,
    nom: "Tri rapide",
    titre: "D'abord, ce que tu as vu.",
    pourquoi:
      "Des titres que presque tout le monde connaît, un par un. Vu, pas vu, ou ça te tente : rien n'est enregistré tant que tu ne le gardes pas.",
    plus: "trier aussi ce qui est à découvrir, et noter les personnes que tu aimes.",
  },
  notation: {
    icone: Star,
    nom: "Notation",
    titre: "Une note, d'une touche.",
    pourquoi: "0 pour 💩, de 1 à 5 étoiles. Chaque note apprend à Catalog ce que tu aimes : dix suffisent pour tes premières recommandations.",
    plus: "noter d'un clic depuis chaque affiche, et noter les actrices, acteurs et cinéastes que tu aimes.",
  },
  duels: {
    icone: Swords,
    nom: "Duels",
    titre: "Deux titres, un seul passe devant.",
    pourquoi: "Deux titres de même note s'affrontent, tu gardes ton préféré. Duel après duel, l'ordre se précise dans chaque palier.",
    plus: "le Départage, qui range entre eux les titres d'une même note, et des duels entre personnes.",
  },
  classement: {
    icone: Trophy,
    nom: "Classement",
    titre: "Ton classement, en direct.",
    pourquoi: "Tes notes forment les paliers, tes duels les départagent. Il bouge avec toi.",
    plus: "le classement des personnes que tu aimes, à côté de celui de tes titres.",
  },
  recos: {
    icone: Sparkles,
    nom: "Recommandations",
    titre: "Ce qui devrait te plaire.",
    pourquoi: "Ici, Catalog part des titres que tu as le mieux notés.",
    plus: "un modèle apprend de toutes tes notes et dit pourquoi chaque titre est là.",
  },
  "ce-soir": {
    icone: Popcorn,
    nom: "Ce soir",
    titre: "Une envie, trois idées.",
    pourquoi: "Léger, intense, émouvant : choisis l'humeur, Catalog sort trois titres. Ce qui te tente passe en premier.",
    plus: "la durée, avec qui tu regardes, et ce que proposent tes abonnements.",
  },
  playlists: {
    icone: ListVideo,
    nom: "Playlists",
    titre: "Tes listes, dans l'ordre.",
    pourquoi: "Une saga à revoir, une soirée à deux : Catalog te dit lequel vient ensuite. Ici, ta liste d'envies : coche ce que tu as vu, la suite avance.",
    plus: "autant de listes que tu veux, et où regarder chaque titre.",
  },
  sorties: {
    icone: CalendarDays,
    nom: "Sorties",
    titre: "Ce qui sort, à ne pas rater.",
    pourquoi: "À l'affiche et bientôt au cinéma : ce qui te tente rejoint ta pile.",
    plus: "les séries aussi, semaine par semaine, avec ta compatibilité pour chaque titre.",
  },
  garder: {
    icone: Save,
    nom: "Garder",
    titre: "Garde ce que tu as fait.",
    pourquoi:
      "Tes titres, tes notes et tes duels deviennent ta bibliothèque. Ensuite, un e-mail et un mot de passe pour la retrouver partout, sans code de confirmation.",
  },
};

/** Le fil : huit traits, celui de l'étape en blanc, les étapes passées en gris ; chacun y mène. */
function FilEtapes({ etape, aller }: { etape: Etape; aller: (etape: Etape) => void }) {
  const rang = ETAPES.indexOf(etape);
  return (
    <nav aria-label="Étapes de la visite" className="mb-4 flex flex-col items-center gap-2">
      <ol className="flex items-center">
        {CHAPITRES.map((c, i) => (
          <li key={c.id}>
            <button
              type="button"
              onClick={() => aller(c.id)}
              aria-current={c.id === etape ? "step" : undefined}
              aria-label={`Étape ${i + 1} : ${c.nom}`}
              className="group flex h-6 items-center rounded-full px-0.5 outline-none focus-visible:ring-2 focus-visible:ring-focus"
            >
              <span
                className={cn(
                  "block h-1 w-6 rounded-full transition-colors sm:w-8",
                  c.id === etape ? "bg-foreground" : i < rang ? "bg-muted" : "bg-surface-3 group-hover:bg-subtle"
                )}
              />
            </button>
          </li>
        ))}
      </ol>
      <MonoMeta aria-live="polite">
        {etape === "garder" ? "Dernière étape" : `Étape ${rang + 1} sur ${CHAPITRES.length} · ${TEXTES[etape].nom}`}
      </MonoMeta>
    </nav>
  );
}

export function ParcoursVisite({
  connus,
  pool,
  titres,
  sorties,
  exemple,
}: {
  /** Des titres que presque tout le monde a vus (tri, notation, duels). */
  connus: ShowcaseTitle[];
  /** Les titres du moment (recommandations, Ce soir). */
  pool: ShowcaseTitle[];
  titres: ShowcaseTitle[];
  sorties: ShowcaseTitle[];
  /** La liste d'exemple, tant que le visiteur n'a pas deux envies. */
  exemple: ShowcaseTitle[];
}) {
  const params = useSearchParams();
  const etape = etapeDe(params.get("etape"));
  const rang = ETAPES.indexOf(etape);
  const precedente = rang > 0 ? ETAPES[rang - 1] : null;
  const suivante = rang < ETAPES.length - 1 ? ETAPES[rang + 1] : null;
  const texte = TEXTES[etape];
  const Icone = texte.icone;

  const aller = useCallback((vers: Etape) => {
    window.history.pushState(null, "", adresseEtape(vers));
    window.scrollTo(0, 0);
  }, []);

  // Les anciens liens visaient une ancre (« /visite#duels ») : l'adresse passe à « ?etape= ».
  useEffect(() => {
    if (params.get("etape") || !window.location.hash) return;
    window.history.replaceState(null, "", adresseEtape(etapeDe(window.location.hash)));
  }, [params]);

  // ← et → changent d'étape, sauf dans un champ ou un choix qui se pilote aux flèches.
  const surFleche = useEffectEvent((e: KeyboardEvent) => {
    const vers = e.key === "ArrowRight" ? suivante : e.key === "ArrowLeft" ? precedente : null;
    if (!vers) return;
    e.preventDefault();
    aller(vers);
  });
  useEffect(() => {
    const surClavier = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      if ((e.target as Element | null)?.closest?.("input, textarea, select, [contenteditable='true'], [role='radiogroup'], [role='tablist'], [role='slider']")) return;
      surFleche(e);
    };
    window.addEventListener("keydown", surClavier);
    return () => window.removeEventListener("keydown", surClavier);
  }, []);

  const visuels: Record<Etape, ReactNode> = {
    tri: <TriVisite titres={connus} />,
    notation: <NotationVisite titres={connus} />,
    duels: <DuelsVisite titres={connus} />,
    classement: <ClassementVisite titres={connus} />,
    recos: <RecosVisite titres={connus} pool={pool} />,
    "ce-soir": <CeSoirVisite pool={pool} />,
    playlists: <PlaylistVisite titres={titres} exemple={exemple} />,
    sorties: <SortiesVisite sorties={sorties} />,
    garder: <GarderVisite />,
  };

  return (
    <AllerProvider value={aller}>
      <HeroLayout
        stage
        hero={
          <>
            <FilEtapes etape={etape} aller={aller} />
            <h1 className="text-balance text-heading text-foreground">{texte.titre}</h1>
            <p className="max-w-xl text-balance text-base text-muted">{texte.pourquoi}</p>
          </>
        }
      >
        <CommandWindow
          className="max-w-3xl"
          context={
            <>
              <Icone size={14} aria-hidden="true" className="shrink-0" />
              <span className="truncate">{texte.nom}</span>
            </>
          }
        >
          <div key={etape}>{visuels[etape]}</div>
        </CommandWindow>
        {texte.plus && (
          <p className="flex w-full max-w-3xl items-start gap-2 text-sm text-muted">
            <Sparkles size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
            <span>
              <span className="text-foreground">Dans l&apos;application, en plus :</span> {texte.plus}
            </span>
          </p>
        )}
        <BarreVisite
          garder={etape !== "garder"}
          avant={
            <Button
              variant="ghost"
              icon
              onClick={() => precedente && aller(precedente)}
              disabled={!precedente}
              aria-label="Étape précédente"
              title="Étape précédente (←)"
            >
              <ArrowLeft size={16} aria-hidden="true" />
            </Button>
          }
          apres={
            suivante && (
              <Button variant="primary" onClick={() => aller(suivante)} title={`${suivante === "garder" ? "Terminer" : "Étape suivante"} (→)`}>
                {suivante === "garder" ? "Terminer" : "Suivant"}
                <ArrowRight size={16} aria-hidden="true" />
              </Button>
            )
          }
        />
      </HeroLayout>
    </AllerProvider>
  );
}
