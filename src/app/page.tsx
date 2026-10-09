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
  TitleListSection,
} from "@/components/sections";
import { Button, MonoMeta } from "@/components/ui";
import { getDb } from "@/lib/db";
import { getHomeFeatures, type HomeFeatures } from "@/lib/homeFeatures";
import { getHomeShowcase, type HomeShowcase } from "@/lib/showcase";

// Accueil — spec: specs/design-system-v2-raycast.md (§ 7, HeroLayout). Le héros de DESIGN.md :
// décor en éclats, grand titre, action principale neutre, mentions techniques en Geist Mono.
// Puis la vitrine des fonctions clés (fiche composants/vitrine.md), une section chacune, en
// alternant les aperçus pleine largeur tirés de raycast.com (carrousel, mur, liste du Store) et
// les sections « texte et visuel » dont le visuel est une vraie commande : Ce soir, Notation,
// Recommandations et À découvrir, Duels, Bibliothèque, Sorties.

// Les compteurs et les aperçus sont lus à chaque visite (lecture seule, base locale).
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

/** Les aperçus ; rien plutôt qu'une erreur si la base ou TMDB ne répondent pas. */
async function showcase(): Promise<HomeShowcase | null> {
  try {
    return await getHomeShowcase(getDb());
  } catch {
    return null;
  }
}

async function features(): Promise<HomeFeatures | null> {
  try {
    return await getHomeFeatures(getDb());
  } catch {
    return null;
  }
}

export default async function Home() {
  const stats = counts();
  const [preview, keys] = await Promise.all([showcase(), features()]);
  const fr = (n: number) => n.toLocaleString("fr-FR");
  const plural = (n: number, one: string, many: string) => `${fr(n)} ${n > 1 ? many : one}`;

  return (
    <HeroLayout
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
      {preview && preview.moods.length > 0 && (
        <ShowcaseCarousel
          id="ce-soir"
          title="Il y a un titre pour ça."
          lead="Choisis une envie, ta pile répond."
          tabs={preview.moods}
          more={{ href: "/ce-soir", label: "Que regarder ce soir" }}
        />
      )}

      {keys && (
        <FeatureSection
          id="notation"
          eyebrow={<FeatureEyebrow icon={<Star size={16} />}>Notation</FeatureEyebrow>}
          title="Note d'une touche."
          lead="Tes titres vus arrivent un par un : 0 pour 💩, de 1 à 5 étoiles pour le reste. Même geste pour les personnes que tu aimes. Chaque note affine tes recommandations."
          meta={`${plural(keys.rating.unratedSeen, "titre vu", "titres vus")} | ${plural(
            keys.rating.unratedPeople,
            "personne aimée",
            "personnes aimées"
          )} sans note`}
          actions={
            <>
              <Button href="/tri?famille=seen">Noter mes titres vus</Button>
              <ArrowLink href="/tri?famille=person&mode=noter">Noter les personnes</ArrowLink>
            </>
          }
          visual={<RatingPreview cards={keys.rating.cards} remaining={keys.rating.unratedSeen} />}
        />
      )}

      {preview && preview.picks.length > 0 && (
        <FeatureWall
          id="recommandations"
          title="À la une."
          lead="Ta pile, dans l'ordre de tes goûts."
          footer={
            <>
              <ArrowLink href="/recommendations">Toutes tes recommandations</ArrowLink>
              <ArrowLink href="/tri?famille=unseen">Trier ce qui est à découvrir</ArrowLink>
            </>
          }
        >
          <RecommendationsWall picks={preview.picks} profile={preview.profile} pileGenres={preview.pileGenres} />
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

      {preview && preview.lists.length > 0 && (
        <TitleListSection
          id="bibliotheque"
          title="Ta bibliothèque"
          lead="Tes derniers ajouts, tes coups de cœur, les plus acclamés. Filtre par type ou par note, note sur place."
          tabs={preview.lists}
          stats={preview.stats}
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
          actions={
            <>
              <Button href="/playlists">Voir tes playlists</Button>
              <ArrowLink href="/playlists?nouvelle=1">Nouvelle playlist</ArrowLink>
            </>
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
