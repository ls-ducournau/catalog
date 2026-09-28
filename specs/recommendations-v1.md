# Spec — Recommandations (v1)

**Auteur** : Claude (assisté) · **Date** : 2026-09-24 · **Statut** : Draft · **Relecteur** : Louis

## 1. Contexte

Le système de duels Elo (v1, livré) produit un score Elo par item, plus fiable à mesure que `duels_count` augmente. L'objectif de ce jet est de transformer ce signal de préférence en recommandations concrètes : **quoi regarder ensuite dans ta propre bibliothèque**.

**Décision de scope** : ce v1 recommande uniquement parmi les items déjà présents dans la base (`Watch Status = Unwatched`), pas de découverte de nouveaux titres hors catalogue via TMDB Discover — c'est le prolongement direct et le plus fiable des duels (on sait ce qui plaît, on cherche dans ce qu'on a déjà quoi lui ressemble), sans la complexité d'un moteur de découverte externe. Cette extension (recommander des titres inconnus via TMDB) est explicitement hors scope ici (OS-1).

**Approche retenue** : un score explicable par attributs partagés (genre, réalisateur), pas un modèle ML — cohérent avec la taille du jeu de données (~860 items) et le besoin de pouvoir justifier une recommandation ("parce que tu as aimé X, du même réalisateur").

## 2. Exigences fonctionnelles (FR)

- **FR-1** — Le système DOIT calculer, pour chaque genre présent dans la bibliothèque, un score d'affinité = Elo moyen des items `Watched` de ce genre ayant `duels_count >= 1` (les items jamais dupliqués restent à 1200 par défaut et n'apportent aucun signal réel — FR-2 les exclut).
- **FR-2** — Un genre DOIT être exclu du calcul d'affinité s'il compte moins de **2** items `Watched` avec `duels_count >= 1` (signal insuffisant pour être fiable).
- **FR-3** — Le système DOIT calculer, selon la même logique (FR-1/FR-2), un score d'affinité par réalisateur (`Director`).
- **FR-4** — Pour chaque item `Unwatched`, le système DOIT calculer un `recommendation_score` = moyenne pondérée des affinités de genre (poids 0.6) et d'affinité réalisateur si disponible (poids 0.4) ; si seule l'affinité de genre est disponible, le score repose à 100% dessus.
- **FR-5** — Un item `Unwatched` sans aucune affinité calculable (aucun genre/réalisateur avec signal suffisant) DOIT recevoir le score le plus bas (fin de classement), sans erreur.
- **FR-6** — Le système DOIT exposer un classement des items `Unwatched` par `recommendation_score` décroissant, filtrable par `Type` (`Movie` / `TV Series`).
- **FR-7** — Chaque recommandation DOIT afficher au moins une raison lisible (ex. "Genre : Science-fiction · Réalisateur : Denis Villeneuve").
- **FR-8** — Le calcul DOIT s'exécuter à la demande (à l'ouverture de l'écran recommandations), sans nécessiter de synchronisation Notion préalable au-delà des données déjà en SQLite.

## 3. Exigences non-fonctionnelles (NFR)

- **NFR-1** — Le calcul complet (toute la bibliothèque, ~860 items) DOIT s'exécuter en moins de 500 ms (opérations en mémoire sur SQLite local, pas d'appel réseau).
- **NFR-2** — L'écran DOIT suivre la même direction visuelle que l'écran de duel (dark UI, cf. NFR-5 de la spec duels).

## 4. Critères d'acceptation (AC)

- **AC-1** (FR-1, FR-2) — Given un genre avec seulement 1 item `Watched` dualisé, When le calcul d'affinité tourne, Then ce genre est exclu (traité comme "pas de signal"), pas utilisé tel quel.
- **AC-2** (FR-4) — Given deux items `Unwatched` de même genre mais l'un partageant aussi un réalisateur à forte affinité, When le classement est calculé, Then l'item partageant aussi le réalisateur est classé au-dessus.
- **AC-3** (FR-5) — Given un item `Unwatched` sans genre ni réalisateur en commun avec un signal fiable, When il apparaît dans le classement, Then il est positionné en fin de liste plutôt que de provoquer une erreur ou un score nul indéterminé.
- **AC-4** (FR-8, cold start) — Given une bibliothèque où aucun item `Watched` n'a encore `duels_count >= 1` (aucun vrai duel joué), When l'utilisateur ouvre l'écran recommandations, Then un message explicite "pas assez de duels pour des recommandations fiables" s'affiche plutôt qu'un classement basé sur du bruit.
- **AC-5** (FR-6) — Given le filtre `Type = TV Series` appliqué, When le classement est affiché, Then seuls des items `TV Series` apparaissent, classés par leur propre `recommendation_score`.
- **AC-6** (FR-7) — Given une recommandation affichée, When elle apparaît, Then au moins un attribut de correspondance (genre et/ou réalisateur) est affiché en toutes lettres.

## 5. Cas limites (EC)

- **EC-1** — Bibliothèque avec 0 item `Unwatched` : liste vide affichée explicitement, pas d'erreur.
- **EC-2** — Item `Unwatched` avec plusieurs genres dont certains ont un signal et d'autres non : seuls les genres avec signal suffisant (FR-2) contribuent à la moyenne (FR-1), les autres sont ignorés silencieusement.
- **EC-3** — Deux items ex-æquo en `recommendation_score` : ordre secondaire par `TMDB Rating` décroissant, puis par nom (tri stable et déterministe).

## 6. Contrats d'API

```typescript
// GET /api/recommendations?type=Movie|TV Series&limit=20
type RecommendationsResponse =
  | {
      items: RecommendedItem[];
    }
  | {
      error: "not_enough_signal";
      watchedWithSignal: number; // nb d'items Watched avec duels_count >= 1
    };

type RecommendedItem = {
  id: number;
  name: string;
  year: string | null;
  type: "Movie" | "TV Series";
  posterUrl: string | null;
  recommendationScore: number;
  reasons: string[]; // ex. ["Genre : Science-fiction", "Réalisateur : Denis Villeneuve"]
};
```

## 7. Modèles de données

Aucune nouvelle table ni colonne persistée : le score est calculé à la volée à partir des colonnes déjà existantes (`items.genre`, `items.rating`... en réalité `items.elo_score`, `items.duels_count`, `items.watch_status`, un champ `director` — **manquant actuellement dans le schéma SQLite v1**, à ajouter).

### Modification de la table `items` (migration additive)

| Champ | Type | Contraintes |
|---|---|---|
| director | TEXT | nullable — nouveau, synchronisé depuis la propriété Notion `Director` |

## 8. Hors périmètre (v1)

- **OS-1** — Découverte de nouveaux titres hors bibliothèque (TMDB Discover/Recommendations API) — extension naturelle mais nécessite une logique de dédoublonnage et d'import à la volée, différée.
- **OS-2** — Prise en compte du `Ressenti` (texte libre) dans le calcul — nécessiterait une analyse de texte, hors scope d'un scoring par attributs.
- **OS-3** — Persistance/historique des recommandations affichées (pas de "déjà vu cette suggestion, ne plus la montrer").
- **OS-4** — Pondération temporelle (favoriser les duels récents vs anciens dans le calcul d'affinité).
- **OS-5** — Écriture des recommandations dans Notion — reste un calcul local, éphémère, recalculé à chaque ouverture.

---

## 9. Amendements v1.1 — actionnabilité, filtres, diversité, explication

Le v1 livrait un classement juste mais inerte : une liste en lecture seule, sans action possible
sur un titre, sans autre filtre que `Type`, et dont le haut de liste pouvait être monopolisé par
un seul lot de titres à score identique. Ces amendements restent dans le périmètre "classement de
la pile à voir" (OS-1 tient toujours : aucune découverte hors bibliothèque).

- **FR-9** — L'écran DOIT proposer les mêmes gestes que la bibliothèque sur chaque proposition :
  basculer le statut, noter, lire le synopsis, ouvrir la fiche détaillée. Les composants de carte
  et de fiche sont partagés avec la bibliothèque (`ItemCard`, `DetailPanel`) plutôt que
  réimplémentés, pour garantir des comportements identiques.
- **FR-10** — Un titre noté ou marqué `Watched` depuis l'écran DOIT disparaître de la liste : les
  recommandations ne portent que sur la pile à voir, le garder afficherait une proposition morte.
- **FR-11** — Le filtre DOIT porter sur la **catégorie** (`Movie` / `TV Series` / `Documentary`)
  avec la même sémantique que la bibliothèque (spec bibliotheque-v1 FR-9 : un `Movie`/`TV Series`
  taggé `Documentary` appartient à Documentaire), et non sur le seul `Type` Notion. Un filtre par
  genre DOIT également être disponible.
- **FR-12** (diversité) — Deux titres qui touchent exactement les mêmes attributs obtiennent le
  même score : le haut de liste peut alors ne contenir qu'une seule idée (trois épisodes d'une
  même série documentaire). Au-delà de **2** titres partageant la même signature d'attributs, les
  suivants DOIVENT être différés plus bas dans le classement, sans jamais être retirés. La
  signature est normalisée (ordre des genres indifférent).
- **FR-13** — L'écran DOIT pouvoir expliquer le classement : les attributs qui pèsent (genres et
  réalisateurs retenus), leur affinité relative et le nombre de titres derrière chacun, plus le
  volume de signal disponible (duels joués, titres vus dualisés).
- **FR-14** — Le calcul DOIT pouvoir être relancé à la demande depuis l'écran, sans rechargement
  de page (un titre noté entre-temps change le profil).

### Critères d'acceptation ajoutés

- **AC-7** (FR-12) — Given trois candidats de même signature d'attributs et un quatrième d'une
  autre signature, When le classement est rendu, Then le quatrième apparaît avant le troisième de
  la première signature, et aucun candidat n'est perdu.
- **AC-8** (FR-12) — Given deux candidats dont les genres sont listés dans un ordre différent
  (`"Documentary, War & Politics"` vs `"War & Politics, Documentary"`), When la diversité est
  appliquée, Then ils comptent comme un même lot.
- **AC-9** (FR-11) — Given le filtre catégorie `Documentary`, When le classement est affiché,
  Then seuls des titres taggés `Documentary` apparaissent, quel que soit leur `Type` Notion.
- **AC-10** (FR-13) — Given un genre retenu dans le calcul, When le profil est déplié, Then son
  nombre de titres vus dualisés est affiché, et les genres sous le seuil de signal (FR-2) en sont
  absents.
- **AC-11** (FR-10) — Given une proposition notée depuis sa carte, When la note est enregistrée,
  Then le titre passe `Watched` et quitte la liste des propositions.

---

## 10. Amendements v1.2 — onglet « À découvrir » (lève OS-1)

Le v1.1 ne classe que la pile à voir : il ne peut jamais proposer un titre absent de la
bibliothèque. Cet amendement lève **OS-1** en ajoutant une seconde source, sans toucher au
classement existant.

- **FR-15** — L'écran DOIT proposer deux sources distinctes, présentées comme deux onglets :
  « Ma pile à voir » (FR-1 à FR-14, inchangé) et « À découvrir » (titres hors bibliothèque).
  Elles NE DOIVENT PAS être mélangées dans une même grille : les titres hors bibliothèque n'ont
  pas d'id local, donc pas de statut ni de note, et une grille mixte offrirait des cartes aux
  gestes silencieusement différents.
- **FR-16** (semences) — Les titres à découvrir DOIVENT être dérivés des titres `Watched` les
  mieux classés en duel (`duels_count >= 1`, `tmdb_id` connu), via l'endpoint TMDB
  `/{movie,tv}/{id}/recommendations`. Le choix des semences DOIT varier d'un calcul à l'autre
  (tirage parmi les meilleurs) pour que « Recalculer » propose autre chose.
- **FR-17** (explication) — Chaque titre découvert DOIT nommer la ou les semences dont il
  provient (« Proche de *Whiplash* »). C'est l'intérêt de cette source par rapport à un
  `/discover` par genre : l'explication est un titre que l'utilisateur a réellement adoré.
- **FR-18** (dédoublonnage) — Un titre déjà présent dans la bibliothèque, quel que soit son
  statut, DOIT être exclu de « À découvrir » (croisement par `tmdb_id`). Un titre remonté par
  plusieurs semences DOIT apparaître une seule fois, et son nombre de semences DOIT le faire
  remonter dans le classement.
- **FR-19** — Le classement DOIT être : nombre de semences décroissant, puis `vote_count`
  décroissant (signal de notoriété retenu ailleurs dans l'app), puis `vote_average`. Un plancher
  de `vote_count` DOIT écarter le bruit confidentiel.
- **FR-20** — Le filtre catégorie (FR-11) DOIT s'appliquer aussi à cette source, **et les
  semences DOIVENT être choisies dans la catégorie demandée**. Filtrer uniquement les résultats
  ne suffit pas : semer sur des fictions ne remonte jamais de documentaire, et l'onglet
  renvoyait alors une liste vide. Le filtre par genre NE s'applique PAS (les semences, pas un
  genre, définissent le périmètre).
- **FR-21** — L'action principale DOIT être « Ajouter à la bibliothèque » (POST idempotent
  existant). Une fois ajouté, le titre DOIT porter la mention « Déjà ajouté », et devient
  actionnable depuis la bibliothèque comme n'importe quel autre item.
- **FR-22** — Un titre ajouté DOIT pouvoir être retiré depuis la même carte, sans passer par la
  bibliothèque : c'est le geste attendu juste après un ajout qu'on regrette. Le retrait suit le
  flux existant (archivage de la page Notion puis suppression locale, cf. bibliotheque-v1 FR-9)
  et la carte repasse à « Ajouter » — le titre reste affiché dans le lot en cours.

### Critère d'acceptation ajouté

- **AC-16** (FR-22) — Given un titre découvert puis ajouté, When il est retiré depuis sa carte,
  Then sa page Notion est archivée, l'item local est supprimé, et la carte propose à nouveau
  « Ajouter ».

### Critères d'acceptation ajoutés

- **AC-12** (FR-18) — Given un titre remonté par trois semences et déjà dans la bibliothèque,
  When « À découvrir » est calculé, Then il n'apparaît pas.
- **AC-13** (FR-18, FR-19) — Given un titre remonté par deux semences et un autre par une seule,
  When le classement est rendu, Then le premier est au-dessus, quel que soit son `vote_count`.
- **AC-14** (FR-17) — Given un titre remonté par deux semences, When il s'affiche, Then les deux
  titres-semences sont nommés.
- **AC-15** (FR-16) — Given aucun titre `Watched` dualisé avec un `tmdb_id`, When l'onglet est
  ouvert, Then le même message de démarrage à froid que FR-8/AC-4 s'affiche, sans appel TMDB.

### Hors périmètre (v1.2)

- **OS-6** — Import automatique : un titre découvert n'entre en bibliothèque que sur action
  explicite.
- **OS-7** — Mémoire des titres écartés (« ne plus me proposer ça ») — nécessiterait une colonne
  persistée, cf. OS-3.

---

## 11. Amendements v1.3 — moteur de préférence (phase 1 du plan v2)

Référence : `specs/recommandations-v2-plan.md`, phase 1. Remplace **FR-1 à FR-5** (moyennes
d'Elo par genre et réalisateur), dont l'évaluation hors-ligne a montré qu'ils prédisent tes notes
moins bien que la seule note TMDB (0,22 contre 0,35).

- **FR-23** (magasin de caractéristiques) — Chaque titre ayant un `tmdb_id` DOIT porter ses
  caractéristiques TMDB en base (`items.tmdb_features`, JSON) : genres, mots-clés, casting
  principal et réalisateurs **avec identifiant et photo de la personne** (prérequis des futurs
  duels d'acteurs), année, durée, langue, pays, note, nombre de votes, popularité. Elles DOIVENT
  être collectées à la création d'un item, au refetch, et par un backfill pour l'existant.
- **FR-24** (modèle) — Le score de préférence DOIT être le mélange, normalisé sur le lot évalué,
  de trois composantes entraînées sur tes notes : qualité TMDB, voisins de contenu (similarité
  TF-IDF sur genres, mots-clés, casting, réalisateurs, langue, décennie, pondérée par tes notes et
  lissée vers ta moyenne), régression ridge sur les caractéristiques présentes dans au moins
  12 titres.
- **FR-25** (explication) — Chaque proposition DOIT être expliquée par ses titres voisins les
  plus proches parmi ceux que tu as notés au moins ⭐⭐⭐⭐ (« Proche de *Whiplash* »).
- **FR-26** (signal) — Le signal de goût DOIT reposer sur tes notes, et non plus sur l'Elo : le
  démarrage à froid (AC-4) se déclenche désormais en dessous de 10 titres vus notés. L'Elo reste
  la mesure des duels, sans entrer dans le score.
- **FR-27** (semences) — Les semences de « À découvrir » DOIVENT être tirées parmi tes titres
  les mieux notés (FR-16 amendé), et les candidats DOIVENT être reclassés par le modèle après
  récupération de leurs caractéristiques ; le nombre de semences reste un bonus de classement.
- **FR-28** (recalcul silencieux) — Le modèle DOIT être gardé en cache et reconstruit
  automatiquement dès qu'une note, un statut ou une caractéristique change. Aucune action
  manuelle n'est nécessaire pour « Ma pile à voir » ; « À découvrir » garde une action pour tirer
  d'autres semences.
- **FR-29** (évaluation) — Un banc reproductible (`npm run eval:recos`) DOIT rejouer la
  validation croisée par titre sur les données locales et comparer le modèle à la note TMDB
  seule. Des tests automatisés sur données synthétiques DOIVENT vérifier que le modèle retrouve
  un goût connu mieux que la note TMDB seule.

### Critères d'acceptation ajoutés

- **AC-17** (FR-24, FR-29) — Given un jeu synthétique où le goût dépend de mots-clés connus,
  When le modèle est entraîné sur 80 % des titres, Then sa corrélation avec les notes des 20 %
  restants dépasse celle de la note TMDB seule.
- **AC-18** (FR-25) — Given une proposition, When elle s'affiche, Then ses voisins cités sont des
  titres notés au moins ⭐⭐⭐⭐.
- **AC-19** (FR-28) — Given un modèle en cache, When une note change, Then le calcul suivant
  reconstruit le modèle ; sans changement, il réutilise le cache.
- **AC-20** (FR-26) — Given moins de 10 titres vus notés, When l'écran s'ouvre, Then le message
  de démarrage à froid s'affiche.

### Diversité (FR-12) sous le nouveau moteur

Le « lot » d'un titre n'est plus la signature de ses genres et réalisateur (la raison du v1 n'existe
plus) mais **ses deux voisins explicatifs principaux** dans « Ma pile à voir », et **sa semence
principale** dans « À découvrir ». Au-delà de deux titres par lot, les suivants sont différés.
**AC-8** (normalisation de l'ordre des genres) devient sans objet.

---

## 12. Amendements v1.4 — façonner la liste (phase 3 du plan v2)

Le modèle (v1.3) classe bien titre par titre, mais une liste triée par score seul a deux défauts
connus : l'intérêt dominant écrase les autres (ce que Steck appelle une liste mal calibrée), et
elle ne sort jamais de la zone de confort. Ces amendements réordonnent la sortie du modèle sans
toucher au modèle.

- **FR-30** (calibration) — La liste principale DOIT refléter les proportions de genres de ce
  que tu aimes (titres vus notés ⭐⭐⭐ ou plus), par ré-ordonnancement glouton (Steck, RecSys
  2018) : à chaque rang, le titre qui maximise `(1 − λ) · pertinence − λ · écart de calibration`,
  sur les 48 premiers rangs. **λ = 0,8, mesuré** (banc, 20 premiers titres de test) :

  | λ | Note réelle moyenne | Écart de calibration |
  |---|---|---|
  | 0 | 3,82 | 0,727 |
  | 0,5 | 3,81 | 0,346 |
  | 0,8 | 3,78 (−0,04) | 0,153 (−79 %) |
  | 0,9 | 3,74 (−0,08) | 0,106 |

  0,9 reste sous le plafond de FR-33 mais sans marge face à la variance entre plis.
- **FR-31** (exploration) — Un rang sur six DOIT être occupé, quand un candidat s'y prête, par un
  titre d'un genre peu présent dans ton historique, bien noté par ailleurs (note TMDB ≥ 7, au
  moins 500 votes) et que le modèle ne prédit pas mauvais (score au moins médian). Il DOIT être
  étiqueté « Pour sortir de tes habitudes ».
- **FR-32** (rangées) — « Ma pile à voir » DOIT proposer une vue en rangées expliquées, chaque
  rangée ayant un titre qui dit pourquoi : « Le meilleur pour toi », « Disponible sur tes
  abonnements », « Parce que tu as adoré X » (deux rangées au plus), « Pour ce soir, en moins de
  2 h », « Pépites peu connues », « Sorties récentes », « Pour sortir de tes habitudes ». Une
  rangée de moins de trois titres n'est pas affichée (elle aurait l'air cassée). Un titre de la première rangée n'est pas répété ailleurs ; les
  rangées thématiques ne se répètent pas entre elles. La vue en grille (classement complet) reste
  disponible.
- **FR-33** (mesure) — Le banc DOIT mesurer, sur les titres de test, l'écart de calibration des
  vingt premiers et la note moyenne réelle de ces vingt premiers, avant et après
  ré-ordonnancement : la calibration ne DOIT pas faire baisser cette note de plus de 0,1 étoile.

### Critères d'acceptation ajoutés

- **AC-21** (FR-30) — Given un historique à 70 % de drames et 30 % de documentaires et des
  candidats dont les mieux notés sont tous des drames, When la liste est calibrée, Then ses dix
  premiers contiennent des documentaires dans une proportion proche de 30 %.
- **AC-22** (FR-31) — Given une liste de vingt titres et un vivier d'exploration, When la liste
  est composée, Then les rangs 6, 12 et 18 sont des titres d'exploration étiquetés, sans doublon.
- **AC-23** (FR-32) — Given un titre de la première rangée, When les autres rangées sont
  composées, Then il n'y figure pas.

### Précision sur FR-25 (explications), apprise en construisant les rangées

Une explication ne cite un titre aimé que si la ressemblance **repose sur quelque chose de
nommable** : au moins la moitié de la similarité doit venir de thèmes, d'acteurs ou de
réalisateurs partagés, et la similarité doit atteindre **0,15**. Relu sur les données réelles :
sans cette règle, la langue et la décennie suffisaient à « expliquer » *Monsieur Aznavour* par
*L'Âge d'or des animaux* ; au-dessus de 0,15, les liens se défendent (*Call Me by Your Name* ←
*Billy Elliot*, *A Serious Man* ← *The Big Lebowski*). Environ trois propositions sur quatre
gardent une explication ; les autres n'en affichent pas plutôt que d'en inventer une. Cette
règle ne touche que l'explication : le score, et donc le banc, sont inchangés.


## 13. Amendements v1.5 — score de recommandation (demande du 2026-09-25)

### Contexte

L'utilisateur demande un score de recommandation visible. Le score du modèle ne s'y prête pas :
il est centré-réduit sur le lot évalué, donc un même titre n'a pas la même valeur dans la pile
et dans « À découvrir ». Il faut une mesure absolue, et qui veuille dire quelque chose.

### Exigences fonctionnelles

- **FR-34** (compatibilité) — Chaque proposition DOIT afficher sa compatibilité : la probabilité
  estimée que l'utilisateur la note ⭐⭐⭐⭐ ou plus. Elle est apprise sur ses notes par une
  régression logistique sur les trois composantes brutes du modèle (note TMDB, étoiles estimées
  par les voisins, étoiles estimées par la régression), elles-mêmes prédites en validation
  croisée (5 plis) : aucun titre n'est prédit par un modèle qui l'a vu. Pas de compatibilité sous
  30 titres notés, ni pour un titre hors bibliothèque dont TMDB n'a pas fourni les
  caractéristiques. Le profil de goûts DOIT rappeler le taux de base (la part des titres vus notés
  ⭐⭐⭐⭐ ou plus), repère sans lequel un pourcentage ne se lit pas.
- **FR-35** (classement par compatibilité) — La pile et la découverte DOIVENT être classées par
  compatibilité quand elle est calée, par le mélange de la v1.3 sinon. Les avis sur les personnes
  (tri-rapide FR-7) s'ajoutent au score et se reportent dans le pourcentage affiché, pour que
  l'ordre et le pourcentage disent la même chose.
- **FR-30, précision** — La calibration décide quels titres entrent dans chaque groupe de 12 (la
  taille d'une rangée) ; à l'intérieur d'un groupe, le plus compatible passe devant. Elle ne
  choisit, à chaque rang, que parmi les 48 titres les mieux classés qui restent.
- **Production** (tri-rapide FR-9) — Elle entre dans le modèle, ayant passé le banc.
- **Qualité en moyenne bayésienne** (ajout du 2026-09-26, révélé par le calendrier des sorties) —
  La note TMDB est rétrécie vers la moyenne de tes titres notés comme si elle comptait 150 votes
  de plus à cette moyenne : un 9/10 sur 3 votes ne vaut plus un 9/10 sur 20 000, et un titre à
  venir (0 vote) vaut la moyenne au lieu de 0. Sans ce garde-fou, des séries confidentielles
  sortaient à 85 % de compatibilité.
- **Avis sur les personnes** (tri-rapide FR-7) — Ils sont centrés : un « j'aime » pèse d'autant
  moins que l'utilisateur aime presque tout le monde (336 « j'aime » pour 72 « je n'aime pas » au
  moment de la mesure), un « je n'aime pas » d'autant plus qu'il est rare. Le centre est rétréci
  vers zéro tant qu'il y a peu d'avis (poids 10).

### Mesures (banc, 529 titres notés, 5 plis × 3 répétitions)

| Question | Résultat |
|---|---|
| Compatibilité fiable ? | Tranches 20-40 %, 40-60 %, 60-80 % : 31/31 %, 49/48 %, 66/68 % (prévu/réel) ; AUC 0,670 ; Brier −8 % face au taux de base (42 %) |
| Classer par compatibilité coûte-t-il ? | 0,367 contre 0,368 pour le mélange : −0,001 ± 0,007 en écart apparié |
| La production aide-t-elle ? | Sans elle : −0,010 ± 0,005, moins bonne sur 13 plis sur 15 |
| Avis sur les personnes ? | Aucun gain de prédiction (bruts −0,003, centrés −0,006, ± 0,005), mesure pourtant optimiste : l'avis s'est souvent formé sur les titres testés. Gardés pour FR-7, faibles |
| Groupes rangés par pertinence ? | Premier titre affiché noté 4,40 en moyenne, contre 3,27 en ordre glouton brut et 4,20 sans calibration ; 20 premiers : 3,81 contre 3,79 |
| Fenêtre de 48 ? | La calibration remonte au plus le 45e rang (79e sans limite), écart de calibration 0,236 contre 0,223 |
| Moyenne bayésienne de la note TMDB ? | À 150 votes : 0,394 contre 0,379 en note brute (+0,014 ± 0,003, 12 plis sur 15) ; 50 votes −0,002, 500 votes −0,000. Compatibilité : AUC 0,691 (0,670 avant), Brier −11 % (−8 % avant) |

La baisse du modèle entre la v1.4 (0,387) et la v1.5 (0,368) vient des données, pas du code :
14 titres notés de plus, dont 12 notés grossièrement par le tri rapide, et des plis redécoupés.

### Critères d'acceptation ajoutés

- **AC-24** (FR-34) — Given moins de 30 titres notés, When la compatibilité est demandée, Then il
  n'y en a pas.
- **AC-25** (FR-34) — Given un modèle calé, When un titre est évalué seul ou dans un lot, Then sa
  compatibilité est la même.
- **AC-26** (FR-35) — Given des titres classés par compatibilité, When on compare leur ordre et
  leur pourcentage, Then ils vont dans le même sens ; un avis favorable fait monter les deux.
- **AC-27** (FR-30) — Given une liste calibrée, When on lit un groupe de 12, Then il est rangé du
  plus compatible au moins compatible, et un titre ne passe pas en tête pour la seule raison qu'il
  coche beaucoup de genres.
