import { CalendarDays, Gift, ListVideo, Sparkles, Star, Swords } from "lucide-react";
import { Logo } from "@/components/brand/Logo";
import { HeroLayout } from "@/components/layouts";
import {
  CenteredSection,
  ClosingCall,
  FeatureEyebrow,
  FeatureSection,
  FeatureWall,
  HowItWorks,
  PosterFan,
  ReasonsSection,
  RecommendationsWall,
  ShowcaseCarousel,
  SiteFooter,
  TitleListSection,
  type StepVisual,
} from "@/components/sections";
import { SansAjout } from "@/components/sections/suggestion";
import { TeaserSwipe } from "@/components/swipe/Teaser";
import { Button } from "@/components/ui";
import { DuelsVisite, NotationVisite, PlaylistVisite, SortiesVisite } from "@/components/visite/chapitres";
import { ClavierLocal, VisiteProvider } from "@/components/visite/VisiteEtat";
import { composerAccueil } from "@/lib/amorce";
import { composerPaquet } from "@/lib/demarrage";
import type { ShowcaseTitle } from "@/lib/showcase";
import { cleTitre } from "@/lib/visite";
import type { Vitrine } from "@/lib/vitrine";

// La page d'arrivée d'un visiteur — docs/audit/parcours-visiteur-2026-11-09.md, specs/bienvenue-v1.md.
// Une idée, partout : **balayer remplit ta bibliothèque, et c'est elle qui rend tout le reste personnel.**
// Le héros la dit ; le paquet la fait vivre ; « Comment ça marche » en montre l'enchaînement ; chaque section
// dit ce que tes gestes y changent. Un seul bouton principal, « Tester » (le parcours de la bienvenue).
//
// Rien ne s'écrit sur le serveur ici. Seul le paquet garde tes choix (dans le navigateur ; ils te suivent à
// la bienvenue) ; les sections sont des démonstrations à part, qui ne changent rien ailleurs sur la page
// quand on balaie (FR-17). Cas limites : sans titres du moment (TMDB injoignable), le paquet cède la place à
// « Tester » et les sections qui n'ont rien à montrer disparaissent ; la page garde son récit.

const avecAffiche = (titres: ShowcaseTitle[]) => [...new Map(titres.filter((t) => t.posterUrl).map((t) => [cleTitre(t), t])).values()];

export function PageArrivee({ vitrine }: { vitrine: Vitrine }) {
  const tendances = avecAffiche([...vitrine.picks, ...vitrine.moods.flatMap((t) => t.titles)]);
  const eventail = tendances.slice(0, 7);
  // Le paquet à balayer : une dizaine de titres, sans ceux de l'éventail juste au-dessus.
  const paquet = composerPaquet(vitrine, new Set(eventail.map(cleTitre))).slice(0, 10);
  const connus = avecAffiche(vitrine.rating);
  const [vu, a, b] = connus;
  const conseil = tendances.find((t) => ![vu, a, b].includes(t));
  // Comment ça marche, en trois images : tu balaies un titre, tu en départages deux, on te conseille un titre
  // du moment parce que tu as aimé le premier.
  const images: (StepVisual | undefined)[] = [
    vu ? { kind: "balaie", affiche: vu } : undefined,
    a && b ? { kind: "duel", affiches: [a, b] } : undefined,
    vu && conseil ? { kind: "reco", affiche: conseil, parce: vu.name } : undefined,
  ];
  // Les sections de l'accueil d'un compte, en version pour tous.
  const { moods, picks, lists } = composerAccueil(null, vitrine, null);
  const tous = [...new Map([...vitrine.rating, ...vitrine.picks, ...moods.flatMap((t) => t.titles), ...lists.flatMap((t) => t.titles)].map((t) => [cleTitre(t), t])).values()];
  const cinema = vitrine.lists.find((t) => t.value === "cinema")?.titles ?? [];
  const tester = (
    <Button href="/bienvenue" variant="primary" size="lg">
      Tester
    </Button>
  );

  return (
    <HeroLayout
      hero={
        <div className="flex flex-col items-center gap-6">
          <Logo variant="mark" title={null} className="size-12" />
          <h1 className="max-w-3xl text-balance text-heading text-foreground sm:text-heading-lg">Balaie des titres. Catalog te dit quoi regarder.</h1>
          <p className="max-w-md text-base text-muted">
            Ça te tente, pas pour toi, déjà vu : un geste par titre remplit ta bibliothèque, et tout Catalog se règle sur tes goûts.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2">
            {tester}
            <Button href="#comment" size="lg">
              Comment ça marche
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
      <ClavierLocal>
        {paquet.length > 0 ? (
          <CenteredSection
            id="balaie"
            title="Ça te tente ?"
            lead="Balaie à droite si ça te tente, à gauche si ce n'est pas pour toi, ou « Déjà vu ». C'est tout : sans compte, tes choix te suivent quand tu continues."
          >
            {/* Le seul état gardé de la page : il suit le visiteur à la bienvenue (FR-13). */}
            <VisiteProvider>
              <TeaserSwipe cartes={paquet} />
            </VisiteProvider>
          </CenteredSection>
        ) : (
          <CenteredSection id="balaie" title="Ça te tente ?" lead="Des films et des séries, un par un : à droite s'ils te tentent, à gauche sinon. Ta bibliothèque se remplit en quelques gestes.">
            {tester}
          </CenteredSection>
        )}

        <HowItWorks
          id="comment"
          title="Comment ça marche"
          steps={[
            {
              title: "Tu balaies.",
              text: "Un geste par titre : ce qui te tente, ce que tu as vu. Ta bibliothèque se remplit, c'est le point de départ.",
              href: "/bienvenue",
              action: "Tester",
              visual: images[0],
            },
            {
              title: "Catalog apprend tes goûts.",
              text: "Tu notes ce que tu as vu, tu départages tes favoris : chaque réponse affine ton profil.",
              href: "#notation",
              action: "Voir la notation",
              visual: images[1],
            },
            {
              title: "Tout se règle sur toi.",
              text: "Tes recommandations, Ce soir, les sorties : chaque titre arrive avec la raison de sa place.",
              href: "#recommandations-titre",
              action: "Voir les recommandations",
              visual: images[2],
            },
          ]}
        />

        {/* Les fonctions de l'application, expliquées pour tous (demandes de Louis, 2026-11-09) : chacune dit ce
            qu'elle fait, comment, et ce que tes gestes y changent. Des aperçus : pas d'ajout d'un clic, et chaque
            démonstration a son propre état (rien ne bouge ailleurs quand on balaie). */}
        <SansAjout>
          {moods.length > 0 && (
            <ShowcaseCarousel
              id="ce-soir"
              title="Il y a un titre pour ça."
              lead="Choisis une envie (léger, intense, émouvant…) : les titres qui y répondent arrivent. Avec ta bibliothèque, Ce soir choisit parmi ce qui te tente, selon ton humeur, ta durée et tes abonnements."
              tabs={moods}
            />
          )}

          {vitrine.rating.length > 0 && (
            <FeatureSection
              id="notation"
              eyebrow={<FeatureEyebrow icon={<Star size={16} />}>Notation</FeatureEyebrow>}
              title="Note d'une touche."
              lead="Tu l'as vu ? Une note suffit, et Catalog comprend ce que tu aimes."
              points={[
                "0 pour 💩, de 1 à 5 étoiles : une touche du clavier ou un clic.",
                "Chaque note nourrit ton profil : genres, réalisateurs, acteurs.",
                "Dix notes, et tes recommandations arrivent.",
              ]}
              apres="Ce que tu balaies « Déjà vu » arrive ici, prêt à noter."
              visual={
                <VisiteProvider persistant={false}>
                  <NotationVisite titres={vitrine.rating} />
                </VisiteProvider>
              }
            />
          )}

          {picks.length > 0 && (
            <FeatureWall
              id="recommandations"
              title="À la une."
              lead="Ici, les titres dont on parle cette semaine. Avec ta bibliothèque, ce mur devient ta pile : tes titres à voir, rangés dans l'ordre de tes goûts, chacun avec la raison de sa place."
            >
              <RecommendationsWall picks={picks} profile={null} pileGenres={{}} visitor heading="Tendances de la semaine" />
            </FeatureWall>
          )}

          {vitrine.rating.length > 1 && (
            <FeatureSection
              id="duels"
              reverse
              eyebrow={<FeatureEyebrow icon={<Swords size={16} />}>Duels</FeatureEyebrow>}
              title="Deux titres, un seul passe devant."
              lead="Quand deux titres ont la même note, lequel préfères-tu ? Un clic, et ton classement se précise."
              points={[
                "Deux titres de même note s'affrontent : 1 ou 2 au clavier.",
                "Duel après duel, l'ordre se règle dans chaque palier d'étoiles.",
                "Ton classement se lit ensuite du 5 étoiles au 💩.",
              ]}
              apres="Tes titres notés entrent en duel : c'est ton classement, pas celui des autres."
              visual={
                <VisiteProvider persistant={false}>
                  <DuelsVisite titres={vitrine.rating} />
                </VisiteProvider>
              }
            />
          )}

          {lists.length > 0 && (
            <TitleListSection
              id="bibliotheque"
              title="Ta bibliothèque"
              lead="Tout ce que tu as vu et tout ce qui t'attend, films, séries et documentaires, au même endroit. Ici, ce qui sort au cinéma et les mieux notés ; chez toi, ce que tu as balayé, à filtrer et à noter sur place."
              tabs={lists}
              library={false}
            />
          )}

          <FeatureSection
            id="playlists"
            reverse
            eyebrow={<FeatureEyebrow icon={<ListVideo size={16} />}>Playlists</FeatureEyebrow>}
            title="Tes listes, dans l'ordre."
            lead="Une saga à revoir, des films de Noël, une soirée à deux : range tes titres, Catalog suit où tu en es."
            points={["Une liste dans l'ordre que tu choisis.", "Coche ce que tu as vu : le titre suivant s'affiche.", "Pour chaque titre, où le regarder."]}
            apres="Ce qui te tente devient ta première liste d'envies."
            visual={
              <VisiteProvider persistant={false}>
                <PlaylistVisite titres={tous} exemple={vitrine.picks.slice(0, 5)} />
              </VisiteProvider>
            }
          />

          {cinema.length > 0 && (
            <FeatureSection
              id="sorties"
              eyebrow={<FeatureEyebrow icon={<CalendarDays size={16} />}>Sorties</FeatureEyebrow>}
              title="Ce qui sort, à ne pas rater."
              lead="Le cinéma et les séries, semaine par semaine, sans chercher."
              points={["À l'affiche et bientôt en France.", "Ce qui te tente rejoint ta pile d'un clic.", "Chaque sortie dit si elle est pour toi."]}
              apres="Avec tes goûts, chaque sortie porte ta compatibilité."
              visual={
                <VisiteProvider persistant={false}>
                  <SortiesVisite sorties={cinema} />
                </VisiteProvider>
              }
            />
          )}
        </SansAjout>
      </ClavierLocal>

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
        title="Quelques gestes, et Catalog est à toi."
        lead="Sans e-mail ni mot de passe : tu balaies, ta bibliothèque se remplit, la suite se règle sur tes goûts."
        actions={tester}
      />

      <SiteFooter maker={{ name: "Yugen", href: "https://yugen-incubator.framer.website/" }} data={{ name: "TMDB", href: "https://www.themoviedb.org/" }} />
    </HeroLayout>
  );
}
