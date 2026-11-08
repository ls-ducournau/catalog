import type { Metadata } from "next";
import { Bienvenue } from "@/components/swipe/Bienvenue";
import { chargerAccueil, chargerVitrine } from "@/lib/accueilDonnees";
import { estVisiteur } from "@/lib/visiteur";

// Bienvenue — spec: specs/bienvenue-v1.md. Le « Tinder du titre » : le premier écran d'un compte, et ce
// qu'ouvre « Tester ». Des cartes à balayer et la jauge de démarrage. Un visiteur n'a pas encore de compte :
// son premier geste l'ouvre (session invitée, src/proxy.ts).

export const metadata: Metadata = {
  title: "Bienvenue · Catalog",
  description: "Balaie des films et des séries : ta bibliothèque se remplit, Catalog apprend tes goûts.",
};
export const dynamic = "force-dynamic";

export default async function Page() {
  const visiteur = await estVisiteur();
  const [donnees, vitrine] = await Promise.all([visiteur ? null : chargerAccueil(), chargerVitrine()]);
  const depart = { titres: donnees?.stats?.total ?? 0, notes: donnees?.stats?.rated ?? 0 };
  return <Bienvenue vitrine={vitrine} depart={depart} />;
}
