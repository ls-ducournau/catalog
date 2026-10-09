import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { ShardsBackdrop } from "@/components/sections";

// Archétypes de vues — spec: specs/design-system-v2-raycast.md § 7. Chaque page en importe un
// seul (AC-4.2) : il pose la largeur (1 200 px, DESIGN.md), les marges, le rythme vertical et le
// haut de page ; la page ne style plus son <main>.

const MAIN = "frame flex-1 px-4 pb-16 sm:px-6";

/** Store : en-tête, barre d'outils, grilles et rangées. Bibliothèque, Recommandations, Classement. */
export function CatalogLayout({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={cn(MAIN, className)}>{children}</main>;
}

/** Changelog : en-tête, puis entrées datées (colonne collante à gauche). Sorties. */
export function TimelineLayout({ children, className }: { children: ReactNode; className?: string }) {
  return <main className={cn(MAIN, className)}>{children}</main>;
}

/**
 * Accueil : héros en éclats (le seul décor en couleur), puis le contenu. Accueil, Ce soir, Duels,
 * Tri rapide. `hero` reçoit le titre et l'action ; `shards` pose le décor derrière lui.
 */
export function HeroLayout({
  hero,
  children,
  shards = true,
  compact = false,
  stage = false,
  className,
}: {
  hero: ReactNode;
  children?: ReactNode;
  shards?: boolean;
  /** Outil plutôt que vitrine (Ce soir) : le héros laisse vite la place au contenu. */
  compact?: boolean;
  /**
   * Scène (Duels, Tri rapide ; la fenêtre de Raycast sur son héros) : la question, puis la fenêtre
   * de commande posée sur le décor, dans le héros ; `children` reçoit la fenêtre et ses à-côtés.
   */
  stage?: boolean;
  className?: string;
}) {
  if (stage) {
    return (
      <main className={cn("flex flex-1 flex-col", className)}>
        <section className="relative isolate flex flex-1 flex-col items-center gap-6 overflow-x-clip px-4 pb-16 pt-8 sm:px-6 sm:pt-10">
          {shards && <ShardsBackdrop />}
          <div className="flex flex-col items-center gap-2 text-center">{hero}</div>
          {children && <div className="frame flex w-full flex-col items-center gap-6">{children}</div>}
        </section>
      </main>
    );
  }
  return (
    <main className={cn("flex flex-1 flex-col", className)}>
      <section
        className={cn(
          "relative isolate flex flex-col items-center justify-center px-4 text-center sm:px-6",
          compact ? "pb-10 pt-10 sm:pb-14 sm:pt-16" : "min-h-[min(40rem,78svh)] pb-16 pt-12"
        )}
      >
        {shards && <ShardsBackdrop />}
        {hero}
      </section>
      {children && <div className={cn("frame flex flex-col px-4 pb-16 sm:px-6", compact ? "gap-8" : "gap-20")}>{children}</div>}
    </main>
  );
}

/** Page d'extension : en-tête de fiche, onglets, contenu et colonne d'informations. Fiche d'un titre. */
export function DetailLayout({
  header,
  tabs,
  children,
  aside,
  className,
}: {
  header: ReactNode;
  tabs?: ReactNode;
  children: ReactNode;
  aside?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-6", className)}>
      {header}
      {tabs && <div className="self-start">{tabs}</div>}
      <div className={cn("grid gap-8", aside && "lg:grid-cols-[minmax(0,1fr)_16rem]")}>
        <div className="min-w-0">{children}</div>
        {aside && <aside className="min-w-0">{aside}</aside>}
      </div>
    </div>
  );
}
