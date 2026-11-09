import { redirect } from "next/navigation";
import { CalendarDays, ListVideo, Popcorn, Star, Swords } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { HeroLayout } from "@/components/layouts";
import {
  ArrowLink,
  DuelPreview,
  FeatureEyebrow,
  FeatureSection,
  FeatureWall,
  PlaylistPreview,
  RatingPreview,
  RecommendationsWall,
  ReleasesPreview,
  ShowcaseCarousel,
  SuggestionRating,
  TitleListSection,
} from "@/components/sections";
import { JaugeDemarrage } from "@/components/swipe/Jauge";
import { Button, MonoMeta } from "@/components/ui";
import { chargerAccueil, chargerVitrine } from "@/lib/accueilDonnees";
import { composerAccueil, NOTES_POUR_RECOS } from "@/lib/amorce";
import { estPrete } from "@/lib/demarrage";
import { estVisiteur } from "@/lib/visiteur";
import { PageArrivee } from "./PageArrivee";

// Accueil — spec: specs/design-system-v2-raycast.md (§ 7, HeroLayout). Deux pages distinctes
// (docs/audit/landing-visite-app-2026-11-07.md) :
// - la page d'arrivée d'un visiteur (pas de compte, ou un invité sans titre) : ./PageArrivee.tsx ;
// - l'accueil d'un compte : le héros (avec la jauge de démarrage tant que la bibliothèque se remplit,
//   bienvenue-v1 FR-6 ; un compte sans aucun titre commence par la bienvenue), puis les fonctions clés (fiche composants/vitrine.md), chacune avec
//   une vraie commande. Une bibliothèque qui démarre voit ses titres complétés par des suggestions
//   (specs/accueil-vitrine-connexion-v1.md, § 3, règles dans src/lib/amorce.ts).

// Les compteurs et les aperçus sont lus à chaque visite (lecture seule) : dans la base locale (v1)
// ou auprès du serveur de la v2 (src/lib/accueilDonnees.ts).
export const dynamic = "force-dynamic";

export default async function Home() {
  // Un visiteur (ou un invité qui n'a encore rien gardé) voit la page d'arrivée : les données d'un compte ne
  // sont même pas demandées.
  if (await estVisiteur())
    return <PageArrivee vitrine={await chargerVitrine()} />;

  const [donnees, vitrine] = await Promise.all([
    chargerAccueil(),
    chargerVitrine(),
  ]);
  const { stats, showcase: preview, features: keys } = donnees;
  const { moods, picks, lists, visiteur, demarrage } = composerAccueil(
    preview,
    vitrine,
    stats?.total ?? null,
  );
  // Les données du compte illisibles (serveur injoignable) : la page d'arrivée plutôt qu'un accueil vide.
  if (visiteur) return <PageArrivee vitrine={vitrine} />;
  // Un compte sans aucun titre commence par la bienvenue (specs/bienvenue-v1.md, FR-7).
  if (stats?.total === 0) redirect("/bienvenue");
  const progression = stats
    ? {
        titres: stats.total,
        notes: stats.rated,
        vusSansNote: Math.max(0, stats.total - stats.toWatch - stats.rated),
      }
    : null;
  const enDemarrage = progression !== null && !estPrete(progression);

  const rated = stats?.rated ?? 0;
  // Notation : sans titre vu à noter, des titres très vus à reconnaître (bibliothèque qui démarre).
  const notationSuggeree =
    vitrine.rating.length > 0 &&
    demarrage &&
    (keys?.rating.cards.length ?? 0) === 0;
  const fr = (n: number) => n.toLocaleString("fr-FR");
  const plural = (n: number, one: string, many: string) =>
    `${fr(n)} ${n > 1 ? many : one}`;
  const manque = Math.max(0, NOTES_POUR_RECOS - rated);
  // Une section qui ne montre que des suggestions ne parle pas de « ta pile » ni de « ta bibliothèque ».
  const queSuggestions = (titles: { suggestion?: unknown }[]) =>
    titles.length > 0 && titles.every((t) => t.suggestion);
  const bibliothequeVide = (stats?.total ?? 0) === 0;

  return (
    <HeroLayout
      surface="home"
      hero={
        <div className="flex flex-col items-center gap-6">
          <Logo variant="mark" title={null} className="size-12" />
          <h1 className="max-w-3xl text-balance text-heading text-foreground sm:text-heading-lg">
            Tes films, séries et documentaires, à ton goût.
          </h1>
          <p className="max-w-md text-base text-muted">
            Note, classe, trouve quoi regarder ce soir : Catalog apprend de
            chacun de tes avis.
          </p>
          {enDemarrage && progression ? (
            // La bibliothèque se remplit : la jauge, et la bienvenue pour la compléter d'un geste.
            <>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <Button href="/bienvenue" variant="primary" size="lg">
                  Remplir ma bibliothèque
                </Button>
                <Button href="/ce-soir" size="lg">
                  <Popcorn size={16} aria-hidden="true" />
                  Que regarder ce soir
                </Button>
              </div>
              <JaugeDemarrage progression={progression} />
            </>
          ) : (
            <>
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
                  {fr(stats.total)} titres | {fr(stats.rated)} notés |{" "}
                  {fr(stats.toWatch)} à voir
                </MonoMeta>
              )}
            </>
          )}
        </div>
      }
    >
      {moods.length > 0 && (
        <ShowcaseCarousel
          id="ce-soir"
          title="Il y a un titre pour ça."
          lead={
            demarrage
              ? "Choisis une envie : ta pile d'abord, des suggestions pour la compléter."
              : "Choisis une envie, ta pile répond."
          }
          tabs={moods}
          more={{ href: "/ce-soir", label: "Que regarder ce soir" }}
        />
      )}

      {(keys || notationSuggeree) && (
        <FeatureSection
          id="notation"
          eyebrow={
            <FeatureEyebrow icon={<Star size={16} />}>Notation</FeatureEyebrow>
          }
          title="Note d'une touche."
          lead={
            notationSuggeree
              ? `Des titres que presque tout le monde a vus : note ceux que tu connais, 0 pour 💩, de 1 à 5 étoiles. ${NOTES_POUR_RECOS} notes, et Catalog sait quoi te proposer.`
              : "Tes titres vus arrivent un par un : 0 pour 💩, de 1 à 5 étoiles pour le reste. Même geste pour les personnes que tu aimes. Chaque note affine tes recommandations."
          }
          meta={
            keys && !notationSuggeree
              ? `${plural(keys.rating.unratedSeen, "titre vu", "titres vus")} | ${plural(
                  keys.rating.unratedPeople,
                  "personne aimée",
                  "personnes aimées",
                )} sans note`
              : undefined
          }
          actions={
            keys && !notationSuggeree ? (
              <>
                <Button href="/tri?famille=seen">Noter mes titres vus</Button>
                <ArrowLink href="/tri?famille=person&mode=noter">
                  Noter les personnes
                </ArrowLink>
              </>
            ) : undefined
          }
          visual={
            notationSuggeree ? (
              <SuggestionRating
                titles={vitrine.rating}
                rated={rated}
                goal={NOTES_POUR_RECOS}
              />
            ) : (
              keys && (
                <RatingPreview
                  cards={keys.rating.cards}
                  remaining={keys.rating.unratedSeen}
                />
              )
            )
          }
        />
      )}

      {picks.length > 0 && (
        <FeatureWall
          id="recommandations"
          title="À la une."
          lead={
            demarrage && !preview?.profile && manque > 0
              ? `Note encore ${plural(manque, "titre", "titres")} pour des recommandations à ton goût.`
              : "Ta pile, dans l'ordre de tes goûts."
          }
          footer={
            <>
              <ArrowLink href="/recommendations">
                Toutes tes recommandations
              </ArrowLink>
              <ArrowLink href="/tri?famille=unseen">
                Trier ce qui est à découvrir
              </ArrowLink>
            </>
          }
        >
          <RecommendationsWall
            picks={picks}
            profile={preview?.profile ?? null}
            pileGenres={preview?.pileGenres ?? {}}
            heading={
              queSuggestions(picks) ? "Tendances de la semaine" : undefined
            }
          />
        </FeatureWall>
      )}

      {keys && (
        <FeatureSection
          id="duels"
          reverse
          eyebrow={
            <FeatureEyebrow icon={<Swords size={16} />}>Duels</FeatureEyebrow>
          }
          title="Deux titres, un seul passe devant."
          lead="Tu choisis ton préféré, Catalog range. Duel après duel, ton classement se précise, jusque dans chaque palier d'étoiles."
          meta={
            keys.duel.ranked > 0
              ? `${plural(keys.duel.ranked, "titre classé", "titres classés")} | ${plural(
                  keys.duel.tiers,
                  "palier",
                  "paliers",
                )} | ${Math.round((keys.duel.settled / keys.duel.ranked) * 100)} % départagés`
              : undefined
          }
          actions={
            <>
              <Button href="/duels">Lancer les duels</Button>
              <ArrowLink href="/classement">Voir ton classement</ArrowLink>
            </>
          }
          visual={<DuelPreview initial={keys.duel.pair} />}
        />
      )}

      {lists.length > 0 && (
        <TitleListSection
          id="bibliotheque"
          title="Ta bibliothèque"
          lead={
            bibliothequeVide
              ? "Elle est vide pour l'instant : les tendances, ce qui sort au cinéma, les mieux notés. Ajoute d'un clic ce qui te tente."
              : "Tes derniers ajouts, tes coups de cœur, les plus acclamés. Filtre par type ou par note, note sur place."
          }
          tabs={lists}
          stats={bibliothequeVide ? undefined : preview?.stats}
        />
      )}

      {/* playlists-v2 FR-10 : une fonction clé de la vitrine, après la bibliothèque (décision de
          l'utilisateur : pas juste sous le héros). Visuel à gauche, pour alterner avec Sorties. */}
      {keys && (
        <FeatureSection
          id="playlists"
          reverse
          eyebrow={
            <FeatureEyebrow icon={<ListVideo size={16} />}>
              Playlists
            </FeatureEyebrow>
          }
          title="Tes listes, dans l'ordre."
          lead="Une saga à revoir, des films de Noël, une soirée à deux : range tes titres, Catalog te dit lequel vient ensuite et où le regarder."
          meta={
            keys.playlist.count > 0
              ? plural(keys.playlist.count, "playlist", "playlists")
              : undefined
          }
          // Sans playlist, l'invitation du visuel porte l'action : pas de second « Nouvelle playlist ».
          actions={
            keys.playlist.count > 0 ? (
              <>
                <Button href="/playlists">Voir tes playlists</Button>
                <ArrowLink href="/playlists?nouvelle=1">
                  Nouvelle playlist
                </ArrowLink>
              </>
            ) : undefined
          }
          visual={<PlaylistPreview initial={keys.playlist.current} />}
        />
      )}

      <FeatureSection
        id="sorties"
        eyebrow={
          <FeatureEyebrow icon={<CalendarDays size={16} />}>
            Sorties
          </FeatureEyebrow>
        }
        title="Ce qui sort, pour toi."
        lead="Cinéma et séries, semaine par semaine, avec ta compatibilité pour chaque titre. Ajoute d'un clic ce qui te tente."
        actions={<Button href="/sorties">Voir les sorties</Button>}
        visual={<ReleasesPreview />}
      />
    </HeroLayout>
  );
}
