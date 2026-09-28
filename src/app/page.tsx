import Link from "next/link";
import type { ComponentType } from "react";
import { CalendarDays, Layers, Library, Popcorn, Sparkles, Swords, Trophy, type LucideProps } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { HeroLayout } from "@/components/layouts";
import { SectionHeading } from "@/components/sections";
import { Button, IconCircle, MonoMeta } from "@/components/ui";
import { getDb } from "@/lib/db";

// Accueil — spec: specs/design-system-v2-raycast.md (§ 7, HeroLayout). Le héros de DESIGN.md :
// décor en éclats, titre de 56 px en graisse 400, action principale neutre, mentions techniques
// en Geist Mono ; puis une grille d'accès en trois colonnes.

// Les compteurs sont lus à chaque visite (lecture seule, base locale).
export const dynamic = "force-dynamic";

function counts(): { total: number; rated: number; toWatch: number } | null {
  try {
    const row = getDb()
      .prepare(
        `SELECT COUNT(*) AS total,
                SUM(CASE WHEN rating IS NOT NULL AND rating <> '' THEN 1 ELSE 0 END) AS rated,
                SUM(CASE WHEN watch_status = 'Unwatched' THEN 1 ELSE 0 END) AS toWatch
         FROM items`
      )
      .get() as { total: number; rated: number | null; toWatch: number | null };
    return { total: row.total, rated: row.rated ?? 0, toWatch: row.toWatch ?? 0 };
  } catch {
    return null;
  }
}

const TILES: { href: string; label: string; hint: string; icon: ComponentType<LucideProps> }[] = [
  { href: "/library", label: "Bibliothèque", hint: "Ce que tu as vu, ce que tu veux voir", icon: Library },
  { href: "/recommendations", label: "Recommandations", hint: "Ta pile, dans le bon ordre", icon: Sparkles },
  { href: "/tri", label: "Tri rapide", hint: "Une carte, une réponse, on passe à la suivante", icon: Layers },
  { href: "/duels", label: "Duels", hint: "Deux titres, tu gardes ton préféré", icon: Swords },
  { href: "/classement", label: "Classement", hint: "Tes titres rangés, note par note", icon: Trophy },
  { href: "/sorties", label: "Sorties", hint: "Ce qui arrive au ciné et en séries", icon: CalendarDays },
];

export default function Home() {
  const stats = counts();
  const fr = (n: number) => n.toLocaleString("fr-FR");

  return (
    <HeroLayout
      hero={
        <div className="flex flex-col items-center gap-6">
          <Logo variant="mark" title={null} className="size-12" />
          <h1 className="max-w-3xl text-balance text-heading font-normal text-foreground sm:text-heading-lg">
            Tes films, séries et documentaires, à ton goût.
          </h1>
          <p className="max-w-md text-base text-muted">
            Note, classe, trouve quoi regarder ce soir : Catalog apprend de chacun de tes avis.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button href="/ce-soir" variant="primary" size="lg">
              <Popcorn size={16} aria-hidden="true" />
              Que regarder ce soir
            </Button>
            <Button href="/recommendations" size="lg">
              Ma pile à voir
            </Button>
          </div>
          {stats && (
            <MonoMeta>
              {fr(stats.total)} titres | {fr(stats.rated)} notés | {fr(stats.toWatch)} à voir
            </MonoMeta>
          )}
        </div>
      }
    >
      <section aria-labelledby="acces-titre" className="flex flex-col gap-6">
        <SectionHeading id="acces-titre" title="Tout Catalog" lead="Chaque vue, en un clic." />
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {TILES.map((tile) => {
            const Icon = tile.icon;
            return (
              <li key={tile.href}>
                <Link href={tile.href} className="tile group h-full outline-none focus-visible:ring-2 focus-visible:ring-focus">
                  <IconCircle size={40}>
                    <Icon size={18} aria-hidden="true" />
                  </IconCircle>
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-foreground">{tile.label}</span>
                    <span className="block text-xs text-muted">{tile.hint}</span>
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </HeroLayout>
  );
}
