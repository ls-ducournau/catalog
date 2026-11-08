import { redirect } from "next/navigation";
import { CalendarDays, Gift, Layers, ListVideo, Popcorn, Sparkles, Star, Swords, Trophy, type LucideIcon } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { HeroLayout } from "@/components/layouts";
import {
  ArrowLink,
  CenteredSection,
  ClosingCall,
  DuelPreview,
  FeatureEyebrow,
  FeatureGrid,
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
import { JaugeDemarrage } from "@/components/swipe/Jauge";
import { TeaserSwipe } from "@/components/swipe/Teaser";
import { Button, MonoMeta } from "@/components/ui";
import { VisiteProvider } from "@/components/visite/VisiteEtat";
import { chargerAccueil, chargerVitrine } from "@/lib/accueilDonnees";
import { composerAccueil, NOTES_POUR_RECOS } from "@/lib/amorce";
import { composerPaquet, estPrete } from "@/lib/demarrage";
import type { ShowcaseTitle } from "@/lib/showcase";
import { adresseEtape, CHAPITRES, cleTitre, type Chapitre } from "@/lib/visite";
import type { Vitrine } from "@/lib/vitrine";
import { estVisiteur } from "@/lib/visiteur";

// Accueil — spec: specs/design-system-v2-raycast.md (§ 7, HeroLayout). Deux pages distinctes
// (docs/audit/landing-visite-app-2026-11-07.md) :
// - la page d'arrivée d'un visiteur (pas de compte, ou un invité sans titre) : elle convainc et n'enregistre
//   rien sur le serveur. Le héros et l'éventail des titres du moment, le paquet à balayer (bienvenue-v1,
//   FR-8 : les réponses restent dans le navigateur jusqu'à « Garder »), comment ça marche, les huit
//   parties, pourquoi Catalog, le dernier appel et le pied de page ; « Tester » ouvre la bienvenue ;
// - l'accueil d'un compte : le héros (avec la jauge de démarrage tant que la bibliothèque se remplit,
//   bienvenue-v1 FR-6 ; un compte sans aucun titre commence par la bienvenue), puis les fonctions clés (fiche composants/vitrine.md), chacune avec
//   une vraie commande. Une bibliothèque qui démarre voit ses titres complétés par des suggestions
//   (specs/accueil-vitrine-connexion-v1.md, § 3, règles dans src/lib/amorce.ts).

// Les compteurs et les aperçus sont lus à chaque visite (lecture seule) : dans la base locale (v1)
// ou auprès du serveur de la v2 (src/lib/accueilDonnees.ts).
export const dynamic = "force-dynamic";

/** Chaque partie de l'application, telle que la grille de la page d'arrivée la présente. */
const PARTIES: Record<Chapitre, { icon: LucideIcon; line: string }> = {
  tri: { icon: Layers, line: "Une carte à la fois : vu, pas vu, ou ça te tente." },
  notation: { icon: Star, line: "0 pour 💩, de 1 à 5 étoiles, d'une touche." },
  duels: { icon: Swords, line: "Deux titres, tu gardes ton préféré." },
  classement: { icon: Trophy, line: "Tes titres rangés, note par note." },
  recos: { icon: Sparkles, line: "Ta pile, dans l'ordre de tes goûts." },
  "ce-soir": { icon: Popcorn, line: "Une envie, trois idées pour ce soir." },
  playlists: { icon: ListVideo, line: "Tes listes, et le titre qui vient ensuite." },
  sorties: { icon: CalendarDays, line: "Ce qui arrive au cinéma et en séries." },
};

const avecAffiche = (titres: ShowcaseTitle[]) => [...new Map(titres.filter((t) => t.posterUrl).map((t) => [cleTitre(t), t])).values()];

/** La page d'arrivée : convaincre, puis envoyer à la visite. Aucune commande n'y écrit. */
function PageArrivee({ vitrine }: { vitrine: Vitrine }) {
  const tendances = avecAffiche([...vitrine.picks, ...vitrine.moods.flatMap((t) => t.titles)]);
  const eventail = tendances.slice(0, 7);
  // Le paquet à balayer : une dizaine de titres, sans ceux de l'éventail juste au-dessus.
  const paquet = composerPaquet(vitrine, new Set(eventail.map(cleTitre))).slice(0, 10);
  const connus = avecAffiche(vitrine.rating);
  const [vu, a, b] = connus;
  const conseil = tendances.find((t) => ![vu, a, b].includes(t));
  // Une petite histoire en trois images : tu notes un titre, tu en départages deux, on te conseille un
  // titre du moment parce que tu as aimé le premier.
  const images: (StepVisual | undefined)[] = [
    vu ? { kind: "note", affiche: vu, etoiles: 4 } : undefined,
    a && b ? { kind: "duel", affiches: [a, b] } : undefined,
    vu && conseil ? { kind: "reco", affiche: conseil, parce: vu.name } : undefined,
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
            Ça te tente, pas pour toi, déjà vu : un geste par titre, et Catalog apprend tes goûts.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            <Button href="/visite" variant="primary" size="lg">
              Fais le tour
            </Button>
            <Button href="/bienvenue" size="lg">
              Tester
            </Button>
          </div>
          <ArrowLink href="/connexion">J&apos;ai déjà un compte</ArrowLink>
          {eventail.length >= 5 && (
            <div className="mt-6 w-full">
              <PosterFan posters={eventail} label="Les titres du moment" />
            </div>
          )}
        </div>
      }
    >
      {paquet.length > 0 && (
        <CenteredSection
          id="balaie"
          title="Ça te tente ?"
          lead="À droite ça te tente, à gauche pas pour toi, « Déjà vu » pour le noter. Rien n'est enregistré tant que tu ne le gardes pas."
        >
          <VisiteProvider>
            <TeaserSwipe cartes={paquet} />
          </VisiteProvider>
        </CenteredSection>
      )}

      <HowItWorks
        id="comment"
        title="Comment ça marche"
        steps={[
          {
            title: "Tu balaies.",
            text: "Ça te tente, pas pour toi, déjà vu : un geste par titre, puis une note d'une touche.",
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

      <FeatureGrid
        id="parties"
        title="Tout ce que tu y trouves"
        lead="Huit parties, chacune à essayer dans la visite, sans compte."
        items={CHAPITRES.map((c) => {
          const { icon: Icon, line } = PARTIES[c.id];
          return { href: adresseEtape(c.id), icon: <Icon size={18} aria-hidden="true" />, name: c.nom, line };
        })}
      />

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
        lead="Rien n'est enregistré tant que tu ne le gardes pas."
        actions={
          <>
            <Button href="/visite" variant="primary" size="lg">
              Fais le tour
            </Button>
            <Button href="/bienvenue" size="lg">
              Tester
            </Button>
          </>
        }
      />

      <SiteFooter maker={{ name: "Yugen", href: "https://yugen-incubator.framer.website/" }} data={{ name: "TMDB", href: "https://www.themoviedb.org/" }} />
    </HeroLayout>
  );
}

export default async function Home() {
  // Un visiteur (ou un invité qui n'a encore rien gardé) voit la page d'arrivée : les données d'un compte ne
  // sont même pas demandées.
  if (await estVisiteur()) return <PageArrivee vitrine={await chargerVitrine()} />;

  const [donnees, vitrine] = await Promise.all([chargerAccueil(), chargerVitrine()]);
  const { stats, showcase: preview, features: keys } = donnees;
  const { moods, picks, lists, visiteur, demarrage } = composerAccueil(preview, vitrine, stats?.total ?? null);
  // Les données du compte illisibles (serveur injoignable) : la page d'arrivée plutôt qu'un accueil vide.
  if (visiteur) return <PageArrivee vitrine={vitrine} />;
  // Un compte sans aucun titre commence par la bienvenue (specs/bienvenue-v1.md, FR-7).
  if (stats?.total === 0) redirect("/bienvenue");
  const progression = stats ? { titres: stats.total, notes: stats.rated } : null;
  const enDemarrage = progression !== null && !estPrete(progression);

  const rated = stats?.rated ?? 0;
  // Notation : sans titre vu à noter, des titres très vus à reconnaître (bibliothèque qui démarre).
  const notationSuggeree = vitrine.rating.length > 0 && demarrage && (keys?.rating.cards.length ?? 0) === 0;
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
                  {fr(stats.total)} titres | {fr(stats.rated)} notés | {fr(stats.toWatch)} à voir
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
          lead={demarrage ? "Choisis une envie : ta pile d'abord, des suggestions pour la compléter." : "Choisis une envie, ta pile répond."}
          tabs={moods}
          more={{ href: "/ce-soir", label: "Que regarder ce soir" }}
        />
      )}

      {(keys || notationSuggeree) && (
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
            demarrage && !preview?.profile && manque > 0
              ? `Note encore ${plural(manque, "titre", "titres")} pour des recommandations à ton goût.`
              : "Ta pile, dans l'ordre de tes goûts."
          }
          footer={
            <>
              <ArrowLink href="/recommendations">Toutes tes recommandations</ArrowLink>
              <ArrowLink href="/tri?famille=unseen">Trier ce qui est à découvrir</ArrowLink>
            </>
          }
        >
          <RecommendationsWall
            picks={picks}
            profile={preview?.profile ?? null}
            pileGenres={preview?.pileGenres ?? {}}
            heading={queSuggestions(picks) ? "Tendances de la semaine" : undefined}
          />
        </FeatureWall>
      )}

      {keys && (
        <FeatureSection
          id="duels"
          reverse
          eyebrow={<FeatureEyebrow icon={<Swords size={16} />}>Duels</FeatureEyebrow>}
          title="Deux titres, un seul passe devant."
          lead="Tu choisis ton préféré, Catalog range. Duel après duel, ton classement se précise, jusque dans chaque palier d'étoiles."
          meta={
            keys.duel.ranked > 0
              ? `${plural(keys.duel.ranked, "titre classé", "titres classés")} | ${plural(
                  keys.duel.tiers,
                  "palier",
                  "paliers"
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
          eyebrow={<FeatureEyebrow icon={<ListVideo size={16} />}>Playlists</FeatureEyebrow>}
          title="Tes listes, dans l'ordre."
          lead="Une saga à revoir, des films de Noël, une soirée à deux : range tes titres, Catalog te dit lequel vient ensuite et où le regarder."
          meta={keys.playlist.count > 0 ? plural(keys.playlist.count, "playlist", "playlists") : undefined}
          // Sans playlist, l'invitation du visuel porte l'action : pas de second « Nouvelle playlist ».
          actions={
            keys.playlist.count > 0 ? (
              <>
                <Button href="/playlists">Voir tes playlists</Button>
                <ArrowLink href="/playlists?nouvelle=1">Nouvelle playlist</ArrowLink>
              </>
            ) : undefined
          }
          visual={<PlaylistPreview initial={keys.playlist.current} />}
        />
      )}

      <FeatureSection
        id="sorties"
        eyebrow={<FeatureEyebrow icon={<CalendarDays size={16} />}>Sorties</FeatureEyebrow>}
        title="Ce qui sort, pour toi."
        lead="Cinéma et séries, semaine par semaine, avec ta compatibilité pour chaque titre. Ajoute d'un clic ce qui te tente."
        actions={<Button href="/sorties">Voir les sorties</Button>}
        visual={<ReleasesPreview />}
      />
    </HeroLayout>
  );
}
