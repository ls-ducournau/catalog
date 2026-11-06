import type { Metadata } from "next";
import { Logo } from "@/components/brand/Logo";
import { ConnexionForm } from "@/components/ConnexionForm";
import { HeroLayout } from "@/components/layouts";

// Connexion — spec: specs/accueil-vitrine-connexion-v1.md (§ 4). Archétype des Duels : la question
// sur le héros, la fenêtre de commande posée sur le décor. `?retour=` : la page où revenir ensuite.

export const metadata: Metadata = { title: "Ton compte · Catalog" };

export default async function Connexion({ searchParams }: { searchParams: Promise<{ retour?: string }> }) {
  const { retour } = await searchParams;
  // Seulement un chemin de l'application, jamais une autre adresse.
  const cible = typeof retour === "string" && retour.startsWith("/") && !retour.startsWith("//") ? retour : "/";
  return (
    <HeroLayout
      stage
      hero={
        <>
          <Logo variant="mark" title={null} className="mb-2 size-10" />
          <h1 className="text-heading text-foreground">Ton compte</h1>
          <p className="max-w-md text-base text-muted">Retrouve tes titres, tes notes et tes listes sur tous tes appareils.</p>
        </>
      }
    >
      <div className="w-full max-w-md">
        <ConnexionForm retour={cible} />
      </div>
    </HeroLayout>
  );
}
