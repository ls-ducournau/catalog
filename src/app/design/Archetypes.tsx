import { Film, Inbox } from "lucide-react";
import { Badge, Button, MonoMeta } from "@/components/ui";
import {
  DetailHeader,
  EmptyState,
  FeaturedRow,
  InfoTable,
  SectionHeading,
  ShardsBackdrop,
  SummaryCard,
  SummaryCards,
  TimelineSection,
} from "@/components/sections";

// Sections et archétypes dans le guide /design (spec design-system-v2 § 6, § 7, AC-4.1).

export function SectionsDemo() {
  return (
    <div className="flex flex-col gap-12">
      <div className="relative isolate flex h-56 flex-col items-center justify-center overflow-hidden rounded-card-lg text-center shadow-[var(--shadow-key)]">
        <ShardsBackdrop />
        <p className="text-heading font-normal text-foreground">Ce soir, un film.</p>
        <p className="mt-2 text-sm text-muted">ShardsBackdrop : le seul décor en couleur, derrière le héros.</p>
      </div>

      <FeaturedRow title="FeaturedRow" lead="Trois cartes centrées, comme la rangée « Featured » du Store.">
        {["Better Call Saul", "Peaky Blinders", "The Last Kingdom"].map((name) => (
          <div key={name} className="card flex flex-col items-center gap-3 p-6 text-center">
            <span className="h-24 w-16 rounded-frame bg-surface-3" />
            <p className="text-base font-medium text-foreground">{name}</p>
            <p className="text-sm text-muted">Proche de ce que tu as aimé.</p>
            <Button size="sm">Voir la fiche</Button>
          </div>
        ))}
      </FeaturedRow>

      <div className="flex flex-col gap-6">
        <SectionHeading title="TimelineSection" lead="Entrées datées du Changelog : colonne collante à gauche." />
        <TimelineSection
          aside={
            <div className="flex flex-col items-start gap-2">
              <Badge>Cette semaine</Badge>
              <MonoMeta>29 sept. | 5 oct.</MonoMeta>
            </div>
          }
        >
          <div className="grid grid-cols-3 gap-3">
            <span className="aspect-[2/3] rounded-frame bg-surface-3" />
            <span className="aspect-[2/3] rounded-frame bg-surface-3" />
            <span className="aspect-[2/3] rounded-frame bg-surface-3" />
          </div>
        </TimelineSection>
      </div>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_16rem]">
        <div className="flex flex-col gap-4">
          <SectionHeading title="DetailHeader" lead="En-tête de la page d'extension." />
          <DetailHeader
            media={<span className="block h-24 w-16 rounded-frame bg-surface-3" />}
            title="Better Call Saul"
            summary="Six ans avant de croiser le chemin de Walter White, Saul Goodman…"
            meta={["2015", "Série", "6 saisons", "Sur Netflix"]}
            actions={<Button variant="primary">Je regarde ça</Button>}
          />
        </div>
        <InfoTable
          title="InfoTable"
          rows={[
            { label: "Création", value: "Vince Gilligan" },
            { label: "Genre", value: "Drame" },
            { label: "TMDB", value: "87 %" },
          ]}
        />
      </div>

      <div className="flex flex-col gap-4">
        <SectionHeading title="SummaryCards" lead="Cartes de synthèse (tarifs de Raycast) : le profil de goûts." />
        <SummaryCards>
          <SummaryCard eyebrow="Genres" title="Drame, thriller, histoire">
            <p className="text-sm text-muted">Radar des genres les mieux notés.</p>
          </SummaryCard>
          <SummaryCard eyebrow="Propositions" title="42 gardées sur 60">
            <p className="text-sm text-muted">Anneau des propositions retenues.</p>
          </SummaryCard>
          <SummaryCard eyebrow="Réalisateurs" title="Villeneuve, Nolan, Gilligan">
            <p className="text-sm text-muted">Les noms qui pèsent le plus.</p>
          </SummaryCard>
        </SummaryCards>
      </div>

      <div className="card">
        <EmptyState
          icon={<Inbox size={20} aria-hidden="true" />}
          title="EmptyState"
          action={
            <Button variant="primary" size="sm">
              <Film size={14} aria-hidden="true" />
              Ajouter un titre
            </Button>
          }
        >
          Une icône en cercle, une phrase, une action.
        </EmptyState>
      </div>
    </div>
  );
}

/** Vignettes schématiques : la structure de chaque archétype, en blocs. */
const ARCHETYPES: { name: string; model: string; views: string; blocks: string[][] }[] = [
  { name: "HeroLayout", model: "Accueil", views: "Accueil, Ce soir", blocks: [["hero"], ["row"]] },
  { name: "CatalogLayout", model: "Store", views: "Bibliothèque, Recommandations, Classement", blocks: [["head"], ["bar"], ["grid"]] },
  { name: "DetailLayout", model: "Page d'extension", views: "Fiche d'un titre", blocks: [["head"], ["tabs"], ["body", "aside"]] },
  { name: "TimelineLayout", model: "Changelog", views: "Sorties", blocks: [["head"], ["date", "body"], ["date", "body"]] },
  { name: "CommandLayout", model: "Palette", views: "Duels, Tri rapide, Ajouter", blocks: [["ask"], ["window"], ["bar"]] },
];

const BLOCK: Record<string, string> = {
  hero: "h-16 w-full rounded-md bg-[radial-gradient(60%_60%_at_50%_30%,var(--p-cobalt-edge),transparent)]",
  row: "h-6 w-full rounded-md bg-surface-3",
  head: "h-6 w-2/3 rounded-md bg-surface-3",
  bar: "h-4 w-full rounded-md bg-surface-2",
  grid: "h-16 w-full rounded-md bg-[repeating-linear-gradient(90deg,var(--surface-3)_0_18%,transparent_18%_22%)]",
  tabs: "h-4 w-1/2 rounded-full bg-surface-2",
  body: "h-14 flex-1 rounded-md bg-surface-3",
  aside: "h-14 w-1/4 rounded-md bg-surface-2",
  date: "h-6 w-1/5 rounded-md bg-surface-2",
  ask: "h-4 w-1/2 self-center rounded-md bg-surface-3",
  window: "h-16 w-4/5 self-center rounded-md bg-surface-3 shadow-[var(--shadow-key)]",
};

export function ArchetypesDemo() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {ARCHETYPES.map((a) => (
        <div key={a.name} className="card flex flex-col gap-3 p-4">
          <div className="flex h-36 flex-col gap-2 rounded-frame bg-background p-3">
            {a.blocks.map((row, i) => (
              <div key={i} className="flex w-full gap-2">
                {row.map((b, j) => (
                  <span key={j} className={BLOCK[b]} />
                ))}
              </div>
            ))}
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">{a.name}</p>
            <p className="text-xs text-muted">Modèle : {a.model}</p>
            <p className="text-xs text-subtle">{a.views}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
