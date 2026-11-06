import type { Metadata } from "next";
import { CalendarDays, Layers, ListVideo, Popcorn, Save, Sparkles, Star, Swords, Trophy } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { HeroLayout } from "@/components/layouts";
import { ArrowLink, FeatureEyebrow, FeatureSection } from "@/components/sections";
import { Button } from "@/components/ui";
import {
  CeSoirVisite,
  ClassementVisite,
  DuelsVisite,
  GarderVisite,
  NotationVisite,
  PlaylistVisite,
  RecosVisite,
  SortiesVisite,
  TriVisite,
} from "@/components/visite/chapitres";
import { ProgressionVisite } from "@/components/visite/Progression";
import { VisiteProvider } from "@/components/visite/VisiteEtat";
import { chargerVitrine } from "@/lib/accueilDonnees";
import type { ShowcaseTitle } from "@/lib/showcase";
import { cleTitre } from "@/lib/visite";

// La visite interactive — spec: specs/visite-interactive-v1.md. Huit chapitres qui s'enchaînent, sur de
// vrais titres (la vitrine) : on trie, on note, on tranche, le classement se forme, les recommandations
// arrivent, puis Ce soir, une liste et les sorties. Chaque chapitre explique le geste (onboarding) et mène
// au suivant ; « Garder ce que j'ai fait » verse tout dans un compte. Rien n'est écrit avant.

export const metadata: Metadata = {
  title: "Fais le tour · Catalog",
  description: "Essaie Catalog sans compte : trie, note, départage, et reçois tes premières recommandations.",
};
export const dynamic = "force-dynamic";

const unique = (titres: ShowcaseTitle[]) => [...new Map(titres.map((t) => [cleTitre(t), t])).values()];

export default async function Visite() {
  const vitrine = await chargerVitrine();
  const connus = vitrine.rating;
  const pool = unique([...vitrine.picks, ...vitrine.moods.flatMap((t) => t.titles), ...vitrine.lists.flatMap((t) => t.titles)]);
  const titres = unique([...connus, ...pool]);
  const sorties = vitrine.lists.find((t) => t.value === "cinema")?.titles ?? [];

  return (
    <HeroLayout
      hero={
        <div className="flex flex-col items-center gap-6">
          <Logo variant="mark" title={null} className="size-12" />
          <h1 className="max-w-3xl text-balance text-heading text-foreground sm:text-heading-lg">Fais le tour de Catalog.</h1>
          <p className="max-w-md text-base text-muted">
            Huit étapes, trois minutes, sur de vrais titres. Rien n&apos;est enregistré tant que tu ne le gardes pas.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button href="#tri" variant="primary" size="lg">
              Commencer
            </Button>
            <Button href="/connexion" size="lg">
              J&apos;ai déjà un compte
            </Button>
          </div>
        </div>
      }
    >
      <VisiteProvider>
        <ProgressionVisite />

        <FeatureSection
          id="tri"
          eyebrow={<FeatureEyebrow icon={<Layers size={16} />}>1 · Tri rapide</FeatureEyebrow>}
          title="D'abord, ce que tu as vu."
          lead="Des titres que presque tout le monde connaît, un par un. Vu, pas vu, ou ça te tente : ta bibliothèque se remplit sans rien chercher."
          actions={<ArrowLink href="#notation">Ensuite : noter</ArrowLink>}
          visual={<TriVisite titres={connus} />}
        />

        <FeatureSection
          id="notation"
          reverse
          eyebrow={<FeatureEyebrow icon={<Star size={16} />}>2 · Notation</FeatureEyebrow>}
          title="Une note, d'une touche."
          lead="0 pour 💩, de 1 à 5 étoiles pour le reste. Chaque note apprend à Catalog ce que tu aimes : dix suffisent pour tes premières recommandations."
          actions={<ArrowLink href="#duels">Ensuite : départager</ArrowLink>}
          visual={<NotationVisite titres={connus} />}
        />

        <FeatureSection
          id="duels"
          eyebrow={<FeatureEyebrow icon={<Swords size={16} />}>3 · Duels</FeatureEyebrow>}
          title="Deux titres, un seul passe devant."
          lead="Deux titres de même note s'affrontent : tu gardes ton préféré. Duel après duel, l'ordre se précise à l'intérieur de chaque palier."
          actions={<ArrowLink href="#classement">Ensuite : ton classement</ArrowLink>}
          visual={<DuelsVisite titres={connus} />}
        />

        <FeatureSection
          id="classement"
          reverse
          eyebrow={<FeatureEyebrow icon={<Trophy size={16} />}>4 · Classement</FeatureEyebrow>}
          title="Ton classement, en direct."
          lead="Tes notes forment les paliers, tes duels les départagent. Reviens-y quand tu veux : il bouge avec toi."
          actions={<ArrowLink href="#recos">Ensuite : tes recommandations</ArrowLink>}
          visual={<ClassementVisite titres={connus} />}
        />

        <FeatureSection
          id="recos"
          eyebrow={<FeatureEyebrow icon={<Sparkles size={16} />}>5 · Recommandations</FeatureEyebrow>}
          title="Ce qui devrait te plaire."
          lead="Catalog part de ce que tu as le mieux noté. Dans l'application, un modèle apprend de toutes tes notes et dit pourquoi chaque titre est là."
          actions={<ArrowLink href="#ce-soir">Ensuite : ce soir</ArrowLink>}
          visual={<RecosVisite titres={connus} pool={pool} />}
        />

        <FeatureSection
          id="ce-soir"
          reverse
          eyebrow={<FeatureEyebrow icon={<Popcorn size={16} />}>6 · Ce soir</FeatureEyebrow>}
          title="Une envie, trois idées."
          lead="Léger, intense, émouvant : choisis l'humeur, Catalog sort trois titres. Ce qui te tente passe en premier ; dans l'application, ceux de tes abonnements aussi."
          actions={<ArrowLink href="#playlists">Ensuite : tes listes</ArrowLink>}
          visual={<CeSoirVisite pool={pool} />}
        />

        <FeatureSection
          id="playlists"
          eyebrow={<FeatureEyebrow icon={<ListVideo size={16} />}>7 · Playlists</FeatureEyebrow>}
          title="Tes listes, dans l'ordre."
          lead="Une saga à revoir, une soirée à deux : Catalog te dit lequel vient ensuite. Ici, ta liste d'envies : coche ce que tu as vu, la suite avance."
          actions={<ArrowLink href="#sorties">Ensuite : les sorties</ArrowLink>}
          visual={<PlaylistVisite titres={titres} exemple={vitrine.picks.slice(0, 5)} />}
        />

        <FeatureSection
          id="sorties"
          reverse
          eyebrow={<FeatureEyebrow icon={<CalendarDays size={16} />}>8 · Sorties</FeatureEyebrow>}
          title="Ce qui sort, à ne pas rater."
          lead="Cinéma et séries, semaine par semaine. Dans l'application, chaque sortie porte ta compatibilité : tu sais d'un coup d'œil ce qui est pour toi."
          actions={<ArrowLink href="#garder">Dernière étape : garder</ArrowLink>}
          visual={<SortiesVisite sorties={sorties} />}
        />

        <FeatureSection
          id="garder"
          eyebrow={<FeatureEyebrow icon={<Save size={16} />}>Garder</FeatureEyebrow>}
          title="Garde ce que tu as fait."
          lead="Tes titres, tes notes et tes duels deviennent ta bibliothèque. Ensuite, un e-mail et un mot de passe pour la retrouver partout, sans code de confirmation."
          visual={<GarderVisite />}
        />
      </VisiteProvider>
    </HeroLayout>
  );
}
