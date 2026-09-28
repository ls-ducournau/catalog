"use client";

import { useState, useSyncExternalStore } from "react";
import { ChevronDown, Layers, Sparkles } from "lucide-react";
import type { Transition } from "motion/react";
import { RadarChart } from "@/components/charts/radar-chart";
import { RadarArea } from "@/components/charts/radar-area";
import { RadarGrid } from "@/components/charts/radar-grid";
import { RadarLabels } from "@/components/charts/radar-labels";
import { RingChart } from "@/components/charts/ring-chart";
import { Ring } from "@/components/charts/ring";
import { SummaryCard } from "@/components/sections";
import { Button, MonoMeta, Skeleton } from "@/components/ui";
import { CompatibilityChip } from "@/components/CompatibilityChip";
import { EASING_TOKENS } from "@/lib/tokens";

// Profil de goûts — spec: specs/design-system-v2-raycast.md (§ 6 SummaryCards, AC-5.4).
//
// Trois cartes de synthèse (les cartes de tarifs de Raycast) : un radar des genres, les
// réalisateurs en barres, et l'anneau de ce que deviennent les propositions. Graphiques Bklit en
// rampe de gris (--chart-1…5), entrée en tween sans ressort, mouvement réduit respecté.

export type AffinityEntry = { name: string; affinity: number; count: number };

export type TasteFeedback = {
  acceptance: { decided: number; keptRate: number | null; seen: number; lovedRate: number | null };
  dismissed: number;
};

const ENTER: Transition = {
  type: "tween",
  duration: 0.4,
  ease: EASING_TOKENS.out.split(",").map(Number) as [number, number, number, number],
};

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia("(prefers-reduced-motion: reduce)");
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
    () => true
  );
}

/** Échelle relative au lot affiché : on compare des attributs entre eux, pas à un absolu. */
function relative(entries: AffinityEntry[]): (e: AffinityEntry) => number {
  const best = Math.max(...entries.map((e) => e.affinity));
  const floor = Math.min(...entries.map((e) => e.affinity));
  const span = best - floor || 1;
  return (e) => 30 + (70 * (e.affinity - floor)) / span;
}

/** Libellés courts pour le radar : les noms longs débordaient de la carte. */
function radarLabel(label: string): string {
  const short: Record<string, string> = {
    "Science-fiction et fantastique": "SF, fantastique",
    "Action et aventure": "Action, aventure",
    "Guerre et politique": "Guerre, politique",
    "Science-fiction": "SF",
    Documentaire: "Documentaire",
  };
  return short[label] ?? label;
}

export function TasteProfile({
  ratedCount,
  genres,
  directors,
  compatibilityBaseRate,
  feedback,
  open,
  onToggle,
  onRestoreAll,
  genreLabel,
}: {
  ratedCount: number;
  genres: AffinityEntry[];
  directors: AffinityEntry[];
  compatibilityBaseRate: number | null;
  feedback: TasteFeedback | null;
  open: boolean;
  onToggle: () => void;
  onRestoreAll: () => void;
  genreLabel: (name: string) => string;
}) {
  const reduced = useReducedMotion();

  return (
    <section aria-labelledby="profil-titre" className="card mt-6">
      {/* Le « pourquoi » du classement, replié par défaut : disponible sans occuper l'écran. */}
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="profil-contenu"
        className="flex w-full items-center gap-3 rounded-card px-4 py-3 text-left outline-none focus-visible:ring-2 focus-visible:ring-focus sm:px-5"
      >
        <span className="icon-circle h-8 w-8">
          <Sparkles size={15} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span id="profil-titre" className="block text-sm font-medium text-foreground">
            Ton profil de goûts
          </span>
          <MonoMeta>appris sur {ratedCount.toLocaleString("fr-FR")} titres notés</MonoMeta>
        </span>
        <ChevronDown
          size={16}
          aria-hidden="true"
          className={`shrink-0 text-muted transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open && (
        <div id="profil-contenu" className="fade-in border-t border-divider px-4 pb-5 pt-5 sm:px-5">
          <div className="grid gap-4 lg:grid-cols-3">
            <GenresCard genres={genres} genreLabel={genreLabel} reduced={reduced} />
            <DirectorsCard directors={directors} />
            <ProposalsCard feedback={feedback} onRestoreAll={onRestoreAll} reduced={reduced} />
          </div>

          {compatibilityBaseRate !== null && (
            <p className="mt-5 max-w-3xl text-sm leading-6 text-foreground">
              Le pourcentage de chaque proposition (<CompatibilityChip value={0.68} /> par exemple) est la
              probabilité que tu la notes 4 étoiles ou plus, calée sur tes notes.{" "}
              <span className="text-muted">
                En moyenne, {Math.round(compatibilityBaseRate * 100)} % de tes titres vus le sont : au-dessus,
                c&apos;est une vraie promesse.
              </span>
            </p>
          )}

          <details className="group mt-3 max-w-3xl">
            <summary className="flex w-max cursor-pointer list-none items-center gap-1.5 rounded-sm text-xs font-medium text-muted outline-none transition-colors duration-200 hover:text-foreground focus-visible:ring-2 focus-visible:ring-focus">
              <ChevronDown size={13} aria-hidden="true" className="transition-transform duration-200 group-open:rotate-180" />
              Comment le classement est calculé
            </summary>
            <p className="mt-2 text-xs leading-5 text-muted">
              Il mêle trois avis : la qualité reconnue du titre, sa ressemblance avec ce que tu as aimé (thèmes,
              casting, réalisation, ton), et les tendances de tes notes. Tes avis du tri rapide sur des
              personnes y ajoutent un léger coup de pouce, ou un léger frein. Un genre ou un réalisateur
              n&apos;apparaît ici qu&apos;à partir de deux titres notés.
            </p>
          </details>
        </div>
      )}
    </section>
  );
}

function GenresCard({
  genres,
  genreLabel,
  reduced,
}: {
  genres: AffinityEntry[];
  genreLabel: (name: string) => string;
  reduced: boolean;
}) {
  const top = genres.slice(0, 6);
  if (top.length < 3) {
    return (
      <SummaryCard eyebrow="Genres" title="Ce que tu notes le mieux">
        {top.length === 0 ? (
          <p className="text-sm text-muted">Pas encore assez de titres notés pour en dégager.</p>
        ) : (
          <AffinityBars entries={top} format={genreLabel} />
        )}
      </SummaryCard>
    );
  }
  const score = relative(top);
  const metrics = top.map((g) => ({ key: g.name, label: radarLabel(genreLabel(g.name)) }));
  const data = [
    {
      label: "Affinité",
      color: "var(--chart-1)",
      values: Object.fromEntries(top.map((g) => [g.name, score(g)])),
    },
  ];
  return (
    <SummaryCard eyebrow="Genres" title="Ce que tu notes le mieux">
      <div
        className="mx-auto w-full max-w-[17rem]"
        role="img"
        aria-label={`Genres les mieux notés : ${top.map((g) => `${genreLabel(g.name)} (${g.count} titres)`).join(", ")}`}
      >
        <RadarChart data={data} metrics={metrics} margin={48} levels={4} animate={!reduced} enterTransition={ENTER}>
          <RadarGrid showLabels={false} />
          <RadarArea index={0} showGlow={false} />
          <RadarLabels fontSize={12} offset={16} />
        </RadarChart>
      </div>
      <p className="text-xs text-muted">Six genres, à l&apos;échelle du mieux noté.</p>
    </SummaryCard>
  );
}

function DirectorsCard({ directors }: { directors: AffinityEntry[] }) {
  const top = directors.slice(0, 5);
  return (
    <SummaryCard eyebrow="Réalisateurs" title="Les noms qui pèsent le plus">
      {top.length === 0 ? (
        <p className="text-sm text-muted">Il faut au moins deux titres notés d&apos;un même réalisateur.</p>
      ) : (
        <AffinityBars entries={top} format={(n) => n} />
      )}
    </SummaryCard>
  );
}

/** Barres relatives au meilleur score, en une seule teinte : un score brut ne parle pas. */
function AffinityBars({ entries, format }: { entries: AffinityEntry[]; format: (name: string) => string }) {
  const score = relative(entries);
  return (
    <ul className="flex flex-col gap-3">
      {entries.map((entry) => (
        <li key={entry.name} className="flex flex-col gap-1.5">
          <span className="flex items-baseline justify-between gap-3 text-sm">
            <span className="min-w-0 truncate text-foreground">{format(entry.name)}</span>
            <span className="shrink-0 text-xs text-muted">
              {entry.count} titre{entry.count > 1 ? "s" : ""}
            </span>
          </span>
          <span className="h-1 overflow-hidden rounded-full bg-surface-3">
            <span className="block h-full rounded-full bg-accent" style={{ width: `${score(entry)}%` }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

function ProposalsCard({
  feedback,
  onRestoreAll,
  reduced,
}: {
  feedback: TasteFeedback | null;
  onRestoreAll: () => void;
  reduced: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const percent = (rate: number) => `${Math.round(rate * 100)} %`;

  return (
    <SummaryCard eyebrow="Propositions" title="Ce qu'elles deviennent">
      {!feedback ? (
        <div className="flex items-center gap-5">
          <Skeleton className="h-32 w-32 rounded-full" />
          <div className="flex flex-1 flex-col gap-2">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>
      ) : feedback.acceptance.keptRate === null ? (
        <p className="text-sm text-muted">
          Ajoute ou écarte des titres proposés (onglet « À découvrir », suggestions de l&apos;ajout, tri rapide) :
          leur taux de réussite s&apos;affichera ici.
        </p>
      ) : (
        <ProposalsRings feedback={feedback} percent={percent} reduced={reduced} />
      )}

      <div className="mt-auto flex flex-wrap items-center gap-2 pt-1">
        <Button href="/tri" size="sm">
          <Layers size={13} aria-hidden="true" />
          Affiner avec le tri rapide
        </Button>
        {feedback && feedback.dismissed > 0 &&
          (confirming ? (
            <span className="flex flex-wrap items-center gap-2 text-xs text-foreground">
              Réafficher les {feedback.dismissed} titre{feedback.dismissed > 1 ? "s" : ""} écarté
              {feedback.dismissed > 1 ? "s" : ""} ?
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setConfirming(false);
                  onRestoreAll();
                }}
              >
                Tout réafficher
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                Garder
              </Button>
            </span>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
              {feedback.dismissed} écarté{feedback.dismissed > 1 ? "s" : ""} · tout réafficher
            </Button>
          ))}
      </div>
    </SummaryCard>
  );
}

function ProposalsRings({
  feedback,
  percent,
  reduced,
}: {
  feedback: TasteFeedback;
  percent: (rate: number) => string;
  reduced: boolean;
}) {
  const { decided, keptRate, seen, lovedRate } = feedback.acceptance;
  const kept = keptRate ?? 0;
  const rings = [
    { label: "Gardées", value: Math.round(kept * 100), maxValue: 100, color: "var(--chart-1)" },
    ...(lovedRate !== null
      ? [{ label: "Réussies", value: Math.round(lovedRate * 100), maxValue: 100, color: "var(--chart-3)" }]
      : []),
  ];
  return (
    <div className="flex items-center gap-5">
      <div
        className="relative shrink-0"
        role="img"
        aria-label={`${percent(kept)} gardées${lovedRate !== null ? `, ${percent(lovedRate)} réussies` : ""}`}
      >
        {/* Centre en texte fixe : le compteur animé de Bklit (NumberFlow) dépasse sa valeur. */}
        <span aria-hidden="true" className="pointer-events-none absolute inset-0 z-10 flex flex-col items-center justify-center leading-none">
          <span className="text-lg font-semibold text-foreground">{percent(kept)}</span>
          <span className="mt-1 text-2xs text-muted">gardées</span>
        </span>
        <RingChart data={rings} size={132} strokeWidth={10} ringGap={4} baseInnerRadius={36} enterTransition={reduced ? { duration: 0 } : ENTER}>
          {rings.map((r, i) => (
            <Ring key={r.label} index={i} showGlow={false} animate={!reduced} />
          ))}
        </RingChart>
      </div>
      <ul className="flex min-w-0 flex-col gap-3 text-sm">
        <li className="flex items-start gap-2">
          <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-accent" />
          <span className="min-w-0">
            <span className="text-foreground">{percent(kept)} gardées</span>
            <span className="block text-xs text-muted">
              {Math.round(kept * decided)} sur {decided} ajoutées plutôt qu&apos;écartées
            </span>
          </span>
        </li>
        {lovedRate !== null && (
          <li className="flex items-start gap-2">
            <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-subtle" />
            <span className="min-w-0">
              <span className="text-foreground">{percent(lovedRate)} réussies</span>
              <span className="block text-xs text-muted">
                {Math.round(lovedRate * seen)} sur {seen} vues depuis, notées 4 étoiles ou plus
              </span>
            </span>
          </li>
        )}
      </ul>
    </div>
  );
}
