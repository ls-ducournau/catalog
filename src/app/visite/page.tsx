import type { Metadata } from "next";
import { ParcoursVisite } from "@/components/visite/Parcours";
import { VisiteProvider } from "@/components/visite/VisiteEtat";
import { chargerVitrine } from "@/lib/accueilDonnees";
import type { ShowcaseTitle } from "@/lib/showcase";
import { cleTitre } from "@/lib/visite";

// La visite interactive — spec: specs/visite-interactive-v1.md. Huit étapes, une à l'écran, sur de vrais
// titres (la vitrine) : on trie, on note, on tranche, le classement se forme, les recommandations arrivent,
// puis Ce soir, une liste et les sorties. « Garder ce que j'ai fait » verse tout dans un compte, à tout
// moment ; rien n'est écrit avant.

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

  return (
    <VisiteProvider>
      <ParcoursVisite
        connus={connus}
        pool={pool}
        titres={unique([...connus, ...pool])}
        sorties={vitrine.lists.find((t) => t.value === "cinema")?.titles ?? []}
        exemple={vitrine.picks.slice(0, 5)}
      />
    </VisiteProvider>
  );
}
