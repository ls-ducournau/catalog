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
import { Button, MonoMeta } from "@/components/ui";
import { DuelsVisite, PlaylistVisite, SortiesVisite, TriVisite } from "@/components/visite/chapitres";
import { VisiteProvider } from "@/components/visite/VisiteEtat";
import { chargerAccueil, chargerVitrine } from "@/lib/accueilDonnees";
import { composerAccueil, NOTES_POUR_RECOS } from "@/lib/amorce";

// Accueil — spec: specs/design-system-v2-raycast.md (§ 7, HeroLayout). Le héros de DESIGN.md :
// décor en éclats, grand titre, action principale neutre, mentions techniques en Geist Mono.
// Puis la vitrine des fonctions clés (fiche composants/vitrine.md), une section chacune, en
// alternant les aperçus pleine largeur tirés de raycast.com (carrousel, mur, liste du Store) et
// les sections « texte et visuel » dont le visuel est une vraie commande : Ce soir, Notation,
// Recommandations et À découvrir, Duels, Bibliothèque, Sorties.
//
// Trois états (specs/accueil-vitrine-connexion-v1.md, § 2 et § 3, règles dans src/lib/amorce.ts) :
// un visiteur voit les mêmes sections remplies de titres tendances ; une bibliothèque qui démarre
// voit ses titres complétés par des suggestions à ajouter ; une bibliothèque garnie, l'accueil du
// compte à l'identique.

// Les compteurs et les aperçus sont lus à chaque visite (lecture seule) : dans la base locale (v1)
// ou auprès du serveur de la v2 (src/lib/accueilDonnees.ts).
export const dynamic = "force-dynamic";

export default async function Home() {
  const [{ stats, showcase: preview, features: keys }, vitrine] = await Promise.all([chargerAccueil(), chargerVitrine()]);
  const { moods, picks, lists, visiteur, demarrage } = composerAccueil(preview, vitrine, stats?.total ?? null);
  const rated = stats?.rated ?? 0;
  // Notation : sans titre vu à noter, des titres très vus à reconnaître (bibliothèque qui démarre).
  const notationSuggeree = vitrine.rating.length > 0 && (visiteur || (demarrage && (keys?.rating.cards.length ?? 0) === 0));
  const fr = (n: number) => n.toLocaleString("fr-FR");
  const plural = (n: number, one: string, many: string) => `${fr(n)} ${n > 1 ? many : one}`;
  const manque = Math.max(0, NOTES_POUR_RECOS - rated);
  // Une section qui ne montre que des suggestions ne parle pas de « ta pile » ni de « ta bibliothèque ».
  const queSuggestions = (titles: { suggestion?: unknown }[]) => titles.length > 0 && titles.every((t) => t.suggestion);
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
            Note, classe, trouve quoi regarder ce soir : Catalog apprend de chacun de tes avis.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {visiteur ? (
              // Un visiteur commence par la visite (specs/visite-interactive-v1.md).
              <Button href="/visite" variant="primary" size="lg">
                Fais le tour
              </Button>
            ) : (
              <Button href="/ce-soir" variant="primary" size="lg">
                <Popcorn size={16} aria-hidden="true" />
                Que regarder ce soir
              </Button>
            )}
            {visiteur ? (
              <Button href="/connexion" size="lg">
                Se connecter
              </Button>
            ) : (
              <Button href="/recommendations" size="lg">
                Ma pile à voir
              </Button>
            )}
          </div>
          {stats && (
            <MonoMeta>
              {fr(stats.total)} titres | {fr(stats.rated)} notés | {fr(stats.toWatch)} à voir
            </MonoMeta>
          )}
        </div>
      }
    >
      {moods.length > 0 && (
        <ShowcaseCarousel
          id="ce-soir"
          title="Il y a un titre pour ça."
          lead={
            visiteur
              ? "Choisis une envie, les titres du moment répondent."
              : demarrage
                ? "Choisis une envie : ta pile d'abord, des suggestions pour la compléter."
                : "Choisis une envie, ta pile répond."
          }
          tabs={moods}
          more={visiteur ? { href: "/visite#ce-soir", label: "Essayer Ce soir" } : { href: "/ce-soir", label: "Que regarder ce soir" }}
        />
      )}

      {visiteur && vitrine.rating.length > 0 && (
        <FeatureSection
          id="notation"
          eyebrow={<FeatureEyebrow icon={<Star size={16} />}>Notation</FeatureEyebrow>}
          title="Commence par ce que tu as vu."
          lead="Des titres que presque tout le monde connaît. Vu, pas vu, ou ça te tente : c'est la première étape de la visite, et rien n'est enregistré avant que tu le gardes."
          actions={<ArrowLink href="/visite#notation">Continuer la visite</ArrowLink>}
          visual={
            <VisiteProvider>
              <TriVisite titres={vitrine.rating} />
            </VisiteProvider>
          }
        />
      )}

      {!visiteur && (keys || notationSuggeree) && (
        <FeatureSection
          id="notation"
          eyebrow={<FeatureEyebrow icon={<Star size={16} />}>Notation</FeatureEyebrow>}
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
                  "personnes aimées"
                )} sans note`
              : undefined
          }
          actions={
            keys && !notationSuggeree ? (
              <>
                <Button href="/tri?famille=seen">Noter mes titres vus</Button>
                <ArrowLink href="/tri?famille=person&mode=noter">Noter les personnes</ArrowLink>
              </>
            ) : undefined
          }
          visual={
            notationSuggeree ? (
              <SuggestionRating titles={vitrine.rating} rated={rated} goal={NOTES_POUR_RECOS} />
            ) : (
              keys && <RatingPreview cards={keys.rating.cards} remaining={keys.rating.unratedSeen} />
            )
          }
        />
      )}

      {picks.length > 0 && (
        <FeatureWall
          id="recommandations"
          title="À la une."
          lead={
            visiteur
              ? "Les titres dont on parle cette semaine."
              : demarrage && !preview?.profile && manque > 0
                ? `Note encore ${plural(manque, "titre", "titres")} pour des recommandations à ton goût.`
                : "Ta pile, dans l'ordre de tes goûts."
          }
          footer={
            visiteur ? (
              <ArrowLink href="/visite#recos">Tes recommandations, dans la visite</ArrowLink>
            ) : (
              <>
                <ArrowLink href="/recommendations">Toutes tes recommandations</ArrowLink>
                <ArrowLink href="/tri?famille=unseen">Trier ce qui est à découvrir</ArrowLink>
              </>
            )
          }
        >
          <RecommendationsWall
            picks={picks}
            profile={preview?.profile ?? null}
            pileGenres={preview?.pileGenres ?? {}}
            visitor={visiteur}
            heading={queSuggestions(picks) ? "Tendances de la semaine" : undefined}
          />
        </FeatureWall>
      )}

      {(keys || visiteur) && (
        <FeatureSection
          id="duels"
          reverse
          eyebrow={<FeatureEyebrow icon={<Swords size={16} />}>Duels</FeatureEyebrow>}
          title="Deux titres, un seul passe devant."
          lead="Tu choisis ton préféré, Catalog range. Duel après duel, ton classement se précise, jusque dans chaque palier d'étoiles."
          meta={
            keys && keys.duel.ranked > 0
              ? `${plural(keys.duel.ranked, "titre classé", "titres classés")} | ${plural(
                  keys.duel.tiers,
                  "palier",
                  "paliers"
                )} | ${Math.round((keys.duel.settled / keys.duel.ranked) * 100)} % départagés`
              : undefined
          }
          actions={
            keys ? (
              <>
                <Button href="/duels">Lancer les duels</Button>
                <ArrowLink href="/classement">Voir ton classement</ArrowLink>
              </>
            ) : (
              <ArrowLink href="/visite#duels">Départager tes titres, dans la visite</ArrowLink>
            )
          }
          visual={
            keys ? (
              <DuelPreview initial={keys.duel.pair} />
            ) : (
              // Un visiteur tranche entre des titres connus : rien n'est gardé.
              <VisiteProvider persistant={false}>
                <DuelsVisite titres={vitrine.rating.slice(0, 6)} libre />
              </VisiteProvider>
            )
          }
        />
      )}

      {lists.length > 0 && (
        <TitleListSection
          id="bibliotheque"
          title={visiteur ? "Les titres du moment" : "Ta bibliothèque"}
          lead={
            visiteur
              ? "Les tendances de la semaine, ce qui sort au cinéma, les mieux notés. Ajoute d'un clic ce qui te tente."
              : bibliothequeVide
                ? "Elle est vide pour l'instant : les tendances, ce qui sort au cinéma, les mieux notés. Ajoute d'un clic ce qui te tente."
                : "Tes derniers ajouts, tes coups de cœur, les plus acclamés. Filtre par type ou par note, note sur place."
          }
          tabs={lists}
          stats={visiteur || bibliothequeVide ? undefined : preview?.stats}
          library={!visiteur}
        />
      )}

      {/* playlists-v2 FR-10 : une fonction clé de la vitrine, après la bibliothèque (décision de
          l'utilisateur : pas juste sous le héros). Visuel à gauche, pour alterner avec Sorties. */}
      {(keys || visiteur) && (
        <FeatureSection
          id="playlists"
          reverse
          eyebrow={<FeatureEyebrow icon={<ListVideo size={16} />}>Playlists</FeatureEyebrow>}
          title="Tes listes, dans l'ordre."
          lead="Une saga à revoir, des films de Noël, une soirée à deux : range tes titres, Catalog te dit lequel vient ensuite et où le regarder."
          meta={keys && keys.playlist.count > 0 ? plural(keys.playlist.count, "playlist", "playlists") : undefined}
          // Sans playlist, l'invitation du visuel porte l'action : pas de second « Nouvelle playlist ».
          actions={
            keys && keys.playlist.count > 0 ? (
              <>
                <Button href="/playlists">Voir tes playlists</Button>
                <ArrowLink href="/playlists?nouvelle=1">Nouvelle playlist</ArrowLink>
              </>
            ) : visiteur ? (
              <ArrowLink href="/visite#playlists">Ta liste d&apos;envies, dans la visite</ArrowLink>
            ) : undefined
          }
          visual={
            keys ? (
              <PlaylistPreview initial={keys.playlist.current} />
            ) : (
              // Un exemple : cocher « Vu » fait avancer « Ensuite », rien n'est gardé.
              <VisiteProvider persistant={false}>
                <PlaylistVisite titres={[]} exemple={vitrine.picks.slice(0, 5)} />
              </VisiteProvider>
            )
          }
        />
      )}

      {visiteur ? (
        <FeatureSection
          id="sorties"
          eyebrow={<FeatureEyebrow icon={<CalendarDays size={16} />}>Sorties</FeatureEyebrow>}
          title="Ce qui sort, à ne pas rater."
          lead="À l'affiche et bientôt au cinéma. Ce qui te tente rejoint ta pile, et te suit dans la visite jusqu'à ce que tu le gardes."
          actions={<ArrowLink href="/visite#sorties">Les sorties, dans la visite</ArrowLink>}
          visual={
            <VisiteProvider>
              <SortiesVisite sorties={vitrine.lists.find((t) => t.value === "cinema")?.titles ?? []} />
            </VisiteProvider>
          }
        />
      ) : (
        <FeatureSection
          id="sorties"
          eyebrow={<FeatureEyebrow icon={<CalendarDays size={16} />}>Sorties</FeatureEyebrow>}
          title="Ce qui sort, pour toi."
          lead="Cinéma et séries, semaine par semaine, avec ta compatibilité pour chaque titre. Ajoute d'un clic ce qui te tente."
          actions={<Button href="/sorties">Voir les sorties</Button>}
          visual={<ReleasesPreview />}
        />
      )}
    </HeroLayout>
  );
}
