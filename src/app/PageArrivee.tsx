import { CalendarDays, Gift, ListVideo, Sparkles, Star, Swords } from "lucide-react";
import { HeroLayout } from "@/components/layouts";
import {
  ClosingCall,
  FaqSection,
  FeatureEyebrow,
  FeatureSection,
  FeatureWall,
  HowItWorks,
  ReasonsSection,
  RecommendationsWall,
  ShowcaseCarousel,
  SiteFooter,
  TitleListSection,
  type StepVisual,
} from "@/components/sections";
import { SansAjout } from "@/components/sections/suggestion";
import { TeaserSwipe } from "@/components/swipe/Teaser";
import { Button, MonoMeta } from "@/components/ui";
import { DuelsVisite, NotationVisite, PlaylistVisite, SortiesVisite } from "@/components/visite/chapitres";
import { ClavierLocal, VisiteProvider } from "@/components/visite/VisiteEtat";
import { composerAccueil } from "@/lib/amorce";
import { composerPaquet, vitrineChoisie } from "@/lib/demarrage";
import type { ShowcaseTitle } from "@/lib/showcase";
import { cleTitre } from "@/lib/visite";
import type { Vitrine } from "@/lib/vitrine";

// La page d'arrivée d'un visiteur — docs/audit/parcours-visiteur-2026-11-09.md, specs/bienvenue-v1.md.
// Une idée, partout : **balayer remplit ta bibliothèque, et c'est elle qui rend tout le reste personnel.**
// Le héros la dit et la fait essayer (le paquet y est, visible sans défiler) ; « Comment ça marche » en montre
// l'enchaînement ; chaque section dit ce que tes gestes y changent ; les questions fréquentes lèvent les
// doutes. Un seul bouton principal, « Tester » (le parcours de la bienvenue). Audit :
// docs/audit/landing-ux-marketing-2026-11-09.md.
//
// Rien ne s'écrit sur le serveur ici. Seul le paquet garde tes choix (dans le navigateur ; ils te suivent à
// la bienvenue) ; les sections sont des démonstrations à part, qui ne changent rien ailleurs sur la page
// quand on balaie (FR-17). Cas limites : sans titres du moment (TMDB injoignable), le héros reste sur une
// colonne avec « Tester » et les sections qui n'ont rien à montrer disparaissent ; la page garde son récit.

const avecAffiche = (titres: ShowcaseTitle[]) => [...new Map(titres.filter((t) => t.posterUrl).map((t) => [cleTitre(t), t])).values()];

export function PageArrivee({ vitrine: brute, titres = 0 }: { vitrine: Vitrine; /** Un invité en cours de découverte : ses titres. */ titres?: number }) {
  // Ni talk-shows, ni actualités, ni téléréalité : une vitrine de films et de séries qui donne envie.
  const vitrine = vitrineChoisie(brute);
  const tendances = avecAffiche([...vitrine.picks, ...vitrine.moods.flatMap((t) => t.titles)]);
  // Le paquet à balayer, dans le héros : la fonction d'appel, visible sans défiler (audit 2026-11-09).
  const paquet = composerPaquet(vitrine).slice(0, 10);
  const connus = avecAffiche(vitrine.rating);
  const [vu, a, b] = connus;
  const conseils = tendances.filter((t) => ![vu, a, b].includes(t));
  // Comment ça marche, en trois images : tu balaies un titre, tu en départages deux, on te conseille un titre
  // du moment parce que tu as aimé le premier.
  const images: (StepVisual | undefined)[] = [
    vu ? { kind: "balaie", affiches: [vu, ...conseils.slice(3, 5)] } : undefined,
    a && b ? { kind: "duel", affiches: [a, b] } : undefined,
    vu && conseils.length > 0 ? { kind: "reco", affiches: conseils.slice(0, 3), parce: vu.name } : undefined,
  ];
  // Les sections de l'accueil d'un compte, en version pour tous.
  const { moods, picks, lists } = composerAccueil(null, vitrine, null);
  const tous = [...new Map([...vitrine.rating, ...vitrine.picks, ...moods.flatMap((t) => t.titles), ...lists.flatMap((t) => t.titles)].map((t) => [cleTitre(t), t])).values()];
  const cinema = vitrine.lists.find((t) => t.value === "cinema")?.titles ?? [];
  // Un invité qui a commencé : « Continuer » le ramène à son parcours, là où il l'a laissé (FR-18).
  const action = titres > 0 ? "Continuer" : "Tester";
  const tester = (
    <Button href="/bienvenue" variant="primary" size="lg">
      {action}
    </Button>
  );

  return (
    <HeroLayout
      hero={
        // Le héros fait deux choses à la fois : il dit la promesse, et il la fait essayer. Centré (demande de
        // Louis, 2026-11-09), le paquet juste sous le bouton : son haut se voit dès l'arrivée.
        <div className="flex w-full max-w-6xl flex-col items-center gap-8">
          <div className="flex flex-col items-center gap-6">
            <h1 className="max-w-3xl text-balance text-heading text-foreground sm:text-heading-lg">Balaie des titres. Catalog te dit quoi regarder.</h1>
            <p className="max-w-md text-balance text-base text-muted">
              À droite si ça te tente, à gauche si ce n&apos;est pas pour toi : ta bibliothèque se remplit, et Catalog te recommande ce qui va te plaire.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {tester}
              <Button href="#comment" size="lg">
                Comment ça marche
              </Button>
            </div>
            <MonoMeta>{titres > 0 ? `${titres} titre${titres > 1 ? "s" : ""} dans ta bibliothèque | Gratuit pendant la bêta` : "Gratuit pendant la bêta | Sans inscription"}</MonoMeta>
          </div>
          {paquet.length > 0 && (
            // Le héros centre son texte : la carte, elle, s'aligne à gauche, comme partout.
            <div id="balaie" className="w-full text-left">
              {/* Le seul état gardé de la page : il suit le visiteur à la bienvenue (FR-13). */}
              <VisiteProvider>
                <TeaserSwipe cartes={paquet} />
              </VisiteProvider>
            </div>
          )}
        </div>
      }
    >
      <ClavierLocal>

        <HowItWorks
          id="comment"
          title="Comment ça marche"
          steps={[
            {
              title: "Tu balaies.",
              text: "Un geste par titre : ce qui te tente, ce que tu as vu. Ta bibliothèque se remplit, c'est le point de départ.",
              href: "/bienvenue",
              action,
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

      <FaqSection
        id="questions"
        title="Questions fréquentes"
        items={[
          { q: "C'est gratuit ?", r: "Oui, pendant la bêta : toutes les fonctions sont gratuites." },
          {
            q: "Faut-il créer un compte ?",
            r: "Non. Tu balaies tout de suite : Catalog t'ouvre un compte invité, sans e-mail. Pour retrouver ta bibliothèque sur un autre appareil, ajoute un e-mail et un mot de passe quand tu veux, sans code de confirmation.",
          },
          {
            q: "Comment Catalog connaît-il mes goûts ?",
            r: "Il apprend de tes notes : genres, réalisateurs, acteurs. Ce qui te tente remplit ta pile, ce qui n'est pas pour toi ne revient plus. Dix notes suffisent pour tes premières recommandations.",
          },
          {
            q: "D'où viennent les films et les séries ?",
            r: "De TMDB, une base ouverte de films et de séries : affiches, résumés, bandes-annonces, et les plateformes où les regarder en France.",
          },
          { q: "Sur quels appareils ?", r: "Dans ton navigateur, sur ordinateur, tablette et téléphone, sans rien installer." },
          { q: "Où sont mes données ?", r: "Tes titres et tes notes sont stockés en Europe, en Irlande (Supabase)." },
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
