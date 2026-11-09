import { redirect } from "next/navigation";
import {
  CalendarDays,
  Gift,
  ListVideo,
  Popcorn,
  Sparkles,
  Star,
  Swords,
} from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { HeroLayout } from "@/components/layouts";
import {
  ArrowLink,
  CenteredSection,
  ClosingCall,
  DuelPreview,
  FeatureEyebrow,
  FeatureSection,
  FeatureWall,
  HowItWorks,
  PlaylistPreview,
  PosterFan,
  RatingPreview,
  ReasonsSection,
  RecommendationsWall,
  ReleasesPreview,
  ShowcaseCarousel,
  SiteFooter,
  SuggestionRating,
  TitleListSection,
  type StepVisual,
} from "@/components/sections";
import { BacSuggestions } from "@/components/sections/suggestion";
import { JaugeDemarrage } from "@/components/swipe/Jauge";
import { TeaserSwipe } from "@/components/swipe/Teaser";
import { Button, MonoMeta } from "@/components/ui";
import {
  DuelsVisite,
  NotationVisite,
  PlaylistVisite,
  SortiesVisite,
} from "@/components/visite/chapitres";
import { ClavierLocal, VisiteProvider } from "@/components/visite/VisiteEtat";
import { chargerAccueil, chargerVitrine } from "@/lib/accueilDonnees";
import { composerAccueil, NOTES_POUR_RECOS } from "@/lib/amorce";
import { composerPaquet, estPrete } from "@/lib/demarrage";
import type { ShowcaseTitle } from "@/lib/showcase";
import { adresseEtape, cleTitre } from "@/lib/visite";
import type { Vitrine } from "@/lib/vitrine";
import { estVisiteur } from "@/lib/visiteur";

// Accueil — spec: specs/design-system-v2-raycast.md (§ 7, HeroLayout). Deux pages distinctes
// (docs/audit/landing-visite-app-2026-11-07.md) :
// - la page d'arrivée d'un visiteur (pas de compte, ou un invité sans titre) : elle convainc et n'enregistre
//   rien sur le serveur (docs/audit/parcours-visiteur-2026-11-09.md). Le héros et l'éventail des titres du
//   moment, le paquet à balayer, comment ça marche, puis les fonctions de l'accueil d'un compte en version
//   pour tous, jouables (même état que la visite, dans le navigateur ; il suit le visiteur à la bienvenue,
//   bienvenue-v1 FR-13), pourquoi Catalog, le dernier appel et le pied de page. Un seul bouton principal :
//   « Tester » ; « Fais le tour » en second ;
// - l'accueil d'un compte : le héros (avec la jauge de démarrage tant que la bibliothèque se remplit,
//   bienvenue-v1 FR-6 ; un compte sans aucun titre commence par la bienvenue), puis les fonctions clés (fiche composants/vitrine.md), chacune avec
//   une vraie commande. Une bibliothèque qui démarre voit ses titres complétés par des suggestions
//   (specs/accueil-vitrine-connexion-v1.md, § 3, règles dans src/lib/amorce.ts).

// Les compteurs et les aperçus sont lus à chaque visite (lecture seule) : dans la base locale (v1)
// ou auprès du serveur de la v2 (src/lib/accueilDonnees.ts).
export const dynamic = "force-dynamic";

const avecAffiche = (titres: ShowcaseTitle[]) => [
  ...new Map(
    titres.filter((t) => t.posterUrl).map((t) => [cleTitre(t), t]),
  ).values(),
];

/** La page d'arrivée : convaincre, faire essayer, puis « Tester ». Aucune commande n'y écrit sur le serveur. */
function PageArrivee({ vitrine }: { vitrine: Vitrine }) {
  // Les sections de l'accueil, en version pour tous : la vitrine composée comme pour un visiteur.
  const { moods, picks, lists } = composerAccueil(null, vitrine, null);
  const tous = [
    ...new Map(
      [
        ...vitrine.rating,
        ...vitrine.picks,
        ...moods.flatMap((t) => t.titles),
        ...lists.flatMap((t) => t.titles),
      ].map((t) => [cleTitre(t), t]),
    ).values(),
  ];
  const cinema = vitrine.lists.find((t) => t.value === "cinema")?.titles ?? [];
  const tendances = avecAffiche([
    ...vitrine.picks,
    ...vitrine.moods.flatMap((t) => t.titles),
  ]);
  const eventail = tendances.slice(0, 7);
  // Le paquet à balayer : une dizaine de titres, sans ceux de l'éventail juste au-dessus.
  const paquet = composerPaquet(vitrine, new Set(eventail.map(cleTitre))).slice(
    0,
    10,
  );
  const connus = avecAffiche(vitrine.rating);
  const [vu, a, b] = connus;
  const conseil = tendances.find((t) => ![vu, a, b].includes(t));
  // Une petite histoire en trois images : tu balaies un titre, tu en départages deux, on te conseille un
  // titre du moment parce que tu as aimé le premier.
  const images: (StepVisual | undefined)[] = [
    vu ? { kind: "balaie", affiche: vu } : undefined,
    a && b ? { kind: "duel", affiches: [a, b] } : undefined,
    vu && conseil
      ? { kind: "reco", affiche: conseil, parce: vu.name }
      : undefined,
  ];

  return (
    <HeroLayout
      hero={
        <div className="flex flex-col items-center gap-6">
          <Logo variant="mark" title={null} className="size-12" />
          <h1 className="max-w-3xl text-balance text-heading text-foreground sm:text-heading-lg">
            Balaie des titres. Catalog te dit quoi regarder.
          </h1>
          <p className="max-w-md text-base text-muted">
            Ça te tente, pas pour toi, déjà vu : un geste par titre, et Catalog
            apprend tes goûts.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button href="/bienvenue" variant="primary" size="lg">
              Tester
            </Button>
            <Button href="/visite" size="lg">
              Fais le tour
            </Button>
          </div>
          {eventail.length >= 5 && (
            <div className="mt-6 w-full">
              <PosterFan posters={eventail} label="Les titres du moment" />
            </div>
          )}
        </div>
      }
    >
      {/* Un seul état pour toute la page (le paquet, les sections), dans le navigateur ; « Ça me tente »
          n'écrit pas sur le serveur ; les touches n'agissent que dans le bloc qui a le focus. */}
      <VisiteProvider>
        <BacSuggestions>
          <ClavierLocal>
            {paquet.length > 0 && (
              <CenteredSection
                id="balaie"
                title="Ça te tente ?"
                lead="Balaie à droite si ça te tente, à gauche si ce n'est pas pour toi, ou « Déjà vu ». Sans compte : tes choix te suivent quand tu continues."
              >
                <TeaserSwipe cartes={paquet} />
              </CenteredSection>
            )}

            <HowItWorks
              id="comment"
              title="Comment ça marche"
              steps={[
                {
                  title: "Tu balaies.",
                  text: "Ça te tente, pas pour toi, déjà vu : un geste par titre, et ta bibliothèque se remplit.",
                  href: "/bienvenue",
                  action: "Tester",
                  visual: images[0],
                },
                {
                  title: "Tu départages.",
                  text: "Deux titres de même note, un seul passe devant : ton classement se précise.",
                  href: adresseEtape("duels"),
                  action: "Essayer les duels",
                  visual: images[1],
                },
                {
                  title: "Catalog te dit quoi regarder.",
                  text: "Des recommandations à ton goût, et trois idées pour ce soir selon ton envie.",
                  href: adresseEtape("recos"),
                  action: "Voir des recommandations",
                  visual: images[2],
                },
              ]}
            />

            {/* Les fonctions de l'accueil d'un compte, en version pour tous (demande de Louis, 2026-11-09) : de
          quoi voir l'application de plus près après avoir balayé. Chacune mène à son étape de la visite. */}
            {moods.length > 0 && (
              <ShowcaseCarousel
                id="ce-soir"
                title="Il y a un titre pour ça."
                lead="Choisis une envie, les titres du moment répondent. Ce qui te tente se garde d'un clic."
                tabs={moods}
                more={{
                  href: adresseEtape("ce-soir"),
                  label: "Essayer Ce soir",
                }}
              />
            )}

            {vitrine.rating.length > 0 && (
              <FeatureSection
                id="notation"
                eyebrow={
                  <FeatureEyebrow icon={<Star size={16} />}>
                    Notation
                  </FeatureEyebrow>
                }
                title="Note d'une touche."
                lead="0 pour 💩, de 1 à 5 étoiles, sur des titres que presque tout le monde a vus. Chaque note apprend tes goûts : dix suffisent pour tes premières recommandations."
                actions={
                  <ArrowLink href={adresseEtape("notation")}>
                    Noter dans la visite
                  </ArrowLink>
                }
                visual={<NotationVisite titres={vitrine.rating} />}
              />
            )}

            {picks.length > 0 && (
              <FeatureWall
                id="recommandations"
                title="À la une."
                lead="Les titres dont on parle cette semaine. Dans Catalog, ta pile se range dans l'ordre de tes goûts."
                footer={
                  <ArrowLink href={adresseEtape("recos")}>
                    Les recommandations, dans la visite
                  </ArrowLink>
                }
              >
                <RecommendationsWall
                  picks={picks}
                  profile={null}
                  pileGenres={{}}
                  visitor
                  heading="Tendances de la semaine"
                />
              </FeatureWall>
            )}

            {vitrine.rating.length > 1 && (
              <FeatureSection
                id="duels"
                reverse
                eyebrow={
                  <FeatureEyebrow icon={<Swords size={16} />}>
                    Duels
                  </FeatureEyebrow>
                }
                title="Deux titres, un seul passe devant."
                lead="Tu choisis ton préféré, Catalog range. Duel après duel, ton classement se précise, jusque dans chaque palier d'étoiles."
                actions={
                  <ArrowLink href={adresseEtape("duels")}>
                    Départager dans la visite
                  </ArrowLink>
                }
                visual={<DuelsVisite titres={vitrine.rating} />}
              />
            )}

            {lists.length > 0 && (
              <TitleListSection
                id="bibliotheque"
                title="Ta bibliothèque"
                lead="Ce qui sort au cinéma, les mieux notés : garde d'un clic ce qui te tente, il t'attendra dans ta bibliothèque."
                tabs={lists}
                library={false}
              />
            )}

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
              actions={
                <ArrowLink href={adresseEtape("playlists")}>
                  Ta liste d&apos;envies, dans la visite
                </ArrowLink>
              }
              visual={
                <PlaylistVisite
                  titres={tous}
                  exemple={vitrine.picks.slice(0, 5)}
                />
              }
            />

            {cinema.length > 0 && (
              <FeatureSection
                id="sorties"
                eyebrow={
                  <FeatureEyebrow icon={<CalendarDays size={16} />}>
                    Sorties
                  </FeatureEyebrow>
                }
                title="Ce qui sort, à ne pas rater."
                lead="À l'affiche et bientôt au cinéma, semaine par semaine. Dans Catalog, chaque sortie porte ta compatibilité."
                actions={
                  <ArrowLink href={adresseEtape("sorties")}>
                    Les sorties, dans la visite
                  </ArrowLink>
                }
                visual={<SortiesVisite sorties={cinema} />}
              />
            )}
          </ClavierLocal>
        </BacSuggestions>
      </VisiteProvider>

      <ReasonsSection
        id="pourquoi"
        title="Pourquoi Catalog"
        items={[
          {
            icon: <Sparkles size={18} aria-hidden="true" />,
            title: "Il apprend de tes notes.",
            text: "Chaque note affine tes recommandations : plus tu notes, mieux il connaît tes goûts.",
          },
          {
            icon: <Gift size={18} aria-hidden="true" />,
            title: "Gratuit pendant la bêta.",
            text: "Catalog est en phase de test : toutes ses fonctions sont gratuites.",
          },
        ]}
      />

      <ClosingCall
        title="Trois minutes pour voir si c'est pour toi."
        lead="Sans e-mail ni mot de passe : tu balaies, ta bibliothèque se remplit. Tu la gardes quand tu veux."
        actions={
          <>
            <Button href="/bienvenue" variant="primary" size="lg">
              Tester
            </Button>
            <Button href="/visite" size="lg">
              Fais le tour
            </Button>
          </>
        }
      />

      <SiteFooter
        maker={{
          name: "Yugen",
          href: "https://yugen-incubator.framer.website/",
        }}
        data={{ name: "TMDB", href: "https://www.themoviedb.org/" }}
      />
    </HeroLayout>
  );
}

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
