# Moteur de recommandation v2 — plan

**Statut :** proposition, à valider phase par phase
**Date :** 2026-09-25
**Portée :** onglets « Ma pile à voir » et « À découvrir », suggestions de la modale d'ajout, « Ce soir »

---

## 1. Point de départ : ce qu'on sait déjà, mesuré

Évaluation hors-ligne sur tes données (titres jamais vus par le modèle, validation croisée,
15 passages). Cible : ta note perso (corrélation de Spearman).

| Méthode | Corrélation avec tes notes |
|---|---|
| Mélange qualité TMDB + voisins de contenu + régression | **0,38** |
| Note TMDB seule | 0,35 |
| Moteur actuel (Elo moyen par genre/réalisateur) | 0,22 |

Trois enseignements structurent tout le plan :

1. **Les duels ne mesurent pas la qualité d'une recommandation.** L'écart Elo médian au moment
   d'un duel est de 17 points (~52 % pour le favori) : les paires sont volontairement serrées,
   aucun score ne les prédit mieux qu'à 53 %. La mesure de référence est ta note.
2. **Un gros modèle sur peu de données sur-apprend.** Un modèle à 1 167 dimensions (mots-clés,
   acteurs…) a produit une « cartographie » spectaculaire mais fait moins bien que TMDB seul sur
   des titres inconnus. ~500 titres notés ne suffisent pas à apprendre seul des milliers de
   paramètres.
3. **Le plafond vient des données, pas de l'algorithme.** Au-delà de TMDB, la personnalisation
   gagne peu (+0,03). Pour aller plus loin, il faut **plus de signal**, pas un modèle plus gros.

## 2. Ce que font les grandes plateformes, et ce qui se transpose

Le point commun des grands acteurs n'est pas un algorithme secret : c'est **la donnée de
millions d'utilisateurs**. Une bibliothèque personnelle n'en a qu'un. Le plan consiste donc à
**emprunter la foule là où elle est déjà résumée**, et à **apprendre de toi sans te demander
plus d'effort**.

| Pratique | Qui | Transposable ici ? |
|---|---|---|
| Filtrage collaboratif item-à-item (« les gens qui ont aimé X ont aimé Y ») | Amazon, depuis 1998 ([historique](https://www.amazon.science/the-history-of-amazons-recommendation-algorithm), [papier](https://assets.amazon.science/76/9e/7eac89c14a838746e91dde0a5e9f/two-decades-of-recommender-systems-at-amazon.pdf)) | **Oui, par procuration** : l'endpoint `/recommendations` de TMDB est déjà ce signal collectif, calculé sur ses utilisateurs. |
| Compréhension du contenu par le langage (thèmes, ton, émotions) | Disney+ ([analyse](https://medium.com/@donovanblake886/how-does-disney-handle-content-recommendations-and-personalization-2560000c77fb)) | **Oui** : plongements de synopsis par un modèle pré-entraîné. C'est la seule façon d'apporter à un seul utilisateur une connaissance acquise sur des millions de textes. |
| Mélange de plusieurs modèles plutôt qu'un seul | Netflix (leçon du Netflix Prize) | **Oui, déjà mesuré** : le mélange bat chacune de ses parties. |
| Recommandations calibrées : tes centres d'intérêt dans leurs vraies proportions | Netflix, Steck 2018 ([papier](https://dl.acm.org/doi/10.1145/3240323.3240372)) | **Oui** : si tu regardes 70 % de fiction et 30 % de documentaires, la liste doit le refléter au lieu d'être écrasée par ton intérêt dominant. |
| Rangées thématiques expliquées (« Parce que tu as regardé… ») | Netflix, Spotify ([Explore, Exploit, Explain](https://research.atspotify.com/publications/explore-exploit-explain-personalizing-explainable-recommendations-with-bandits)) | **Oui** : l'explication compte autant que le titre. |
| Exploration contre exploitation (bandits) | Spotify BaRT, Netflix ([visuels personnalisés](https://netflixtechblog.com/artwork-personalization-c589f074ad76)) | **Oui, en version simple** : réserver quelques places à des titres hors de ta zone de confort, et apprendre de ta réaction. |
| Signaux implicites (lectures, abandons, clics, heure) | Tous | **Oui** : journaliser ce que tu fais déjà dans l'app (ajouter, retirer, noter, choisir un titre dans Ce soir). |
| Ne recommander que ce qui est disponible | Toutes (chacune son catalogue) | **Oui** : disponibilité par pays via TMDB, alimentée par JustWatch ([films](https://developer.themoviedb.org/reference/movie-watch-providers), [séries](https://developer.themoviedb.org/reference/tv-series-watch-providers)). |
| Curation humaine | HBO Max ([source](https://www.streamingmedia.com/Articles/ReadArticle.aspx?ArticleID=145732)), Apple TV | **Oui, et c'est toi** : épingler, écarter, créer tes propres rangées. |
| Personnalisation des visuels par bandits | Netflix | **Non** : n'a de sens qu'avec des millions d'impressions. |
| Réseaux profonds à deux tours, autoencodeurs | YouTube, Prime Video | **Non** : exigent des volumes que tu n'auras jamais ; le constat 2 le montre déjà. |

Paramount+ et Apple TV publient peu sur leurs systèmes : rien de vérifiable n'est repris ici.

## 3. Le plan, en cinq phases

Règle commune : **chaque phase passe par le banc d'évaluation**. Une brique qui ne fait pas
mieux que la phase précédente sur tes notes n'est pas livrée, quelle que soit son élégance.

### Phase 1 — Fondations (déjà validée)

- **Magasin de caractéristiques** : mots-clés, casting, réalisateurs, durée, langue, pays,
  popularité TMDB, stockés en base pour chaque titre. Remplit aussi le trou actuel : le
  réalisateur n'est renseigné que pour 40 titres vus sur 559.
- **Modèle de préférence mesuré** : mélange qualité + voisins de contenu + régression, entraîné
  sur tes notes. Remplace le moteur actuel dans les deux onglets.
- **Explications par les voisins** : « Proche de *Whiplash* ⭐⭐⭐⭐⭐ ».
- **Recalcul silencieux** : modèle en cache, invalidé automatiquement dès qu'une note ou un
  statut change.
- **Banc d'évaluation reproductible** : `npm run eval:recos` rejoue la validation croisée sur tes
  données ; tests automatisés sur données synthétiques.

*Mesure de succès :* ≥ 0,38 sur le banc (contre 0,22 aujourd'hui).

### Phase 2 — Comprendre le contenu en profondeur

- **Plongements de synopsis** avec un modèle multilingue pré-entraîné **exécuté en local** (pas
  de clé d'API, pas de coût, rien qui sorte de ta machine). Chaque titre devient un vecteur de
  sens : deux films au ton proche se retrouvent voisins même sans mot-clé commun.
- **Disponibilité streaming en France** : « Disponible sur Netflix, Prime Video… », avec un
  filtre « sur mes abonnements ». Ce qui rend une recommandation actionnable ce soir.

  **Livré (2026-09-25)**, spec `disponibilite-streaming-v1.md` : disponibilité de 1 007 titres
  sur 1 008 (659 inclus dans au moins un abonnement ou gratuits), choix des abonnements, filtre
  serveur dans la bibliothèque et les deux onglets, section « Où le voir » dans la fiche, logo du
  service sur les cartes. Les formules avec publicité comptent comme leur service : sans cette
  règle, le filtre Netflix aurait manqué une large part des titres.

*Mesure de succès :* le mélange avec plongements doit dépasser la phase 1 sur le banc.

**Résultat (2026-09-25) : plongements écartés.** Deux modèles multilingues exécutés en local,
même protocole que le banc de la phase 1 (5 plis × 3, graines fixes, 512 titres notés avec
synopsis) :

| Méthode | Corrélation avec tes notes |
|---|---|
| Phase 1 seule | 0,401 ± 0,057 |
| Phase 1 + voisins de sens, `paraphrase-multilingual-MiniLM-L12-v2` | 0,399 ± 0,077 (meilleure sur 9 plis sur 15 : du bruit) |
| Phase 1 + voisins de sens, `multilingual-e5-small` | 0,377 ± 0,066 (pire sur 14 plis sur 15) |
| Voisins de sens seuls (MiniLM) | 0,201 |

Les mots-clés, genres et castings TMDB décrivent déjà les thèmes mieux qu'un synopsis marketing
de ~400 caractères, et le goût mesuré dépend davantage de la qualité et du style que de
l'intrigue. Brique non livrée, dépendance non ajoutée. À réessayer seulement avec un signal
nouveau (critiques, tonalité) ou un modèle nettement plus fort, et toujours via le banc.

### Phase 3 — Façonner la liste

- **Calibration** (Steck) : les proportions de genres de la liste reflètent les tiennes.
- **Créneaux d'exploration** : environ un titre sur six hors de ta zone de confort, clairement
  étiqueté « Pour sortir de tes habitudes ».
- **Rangées expliquées** façon Netflix : « Parce que tu as adoré X », « Tes documentaires du
  moment », « Disponible sur tes abonnements », « Pépites peu connues », « Pour ce soir en
  moins de 2 h ».
- La diversité (déjà en place) et la fraîcheur des sorties récentes complètent le tout.

*Mesure de succès :* couverture des genres et calibration mesurées, sans perte sur le banc.

**Livré (2026-09-25)**, spec recommendations-v1 §12 : calibration à λ = 0,8 (écart de calibration
des 20 premiers −79 % pour −0,04 étoile), exploration un rang sur six, huit rangées expliquées en
vue « Pour toi » (la grille reste en vue « Classement »). En chemin, les explications ont été
resserrées : elles doivent reposer sur un thème, un acteur ou un réalisateur partagé.

### Phase 4 — La boucle d'apprentissage silencieuse

C'est ici que se trouve le vrai « puissant », parce que c'est ce qui lève le plafond du
constat 3.

- **Journal d'événements implicites** : ajouté, retiré, noté, fiche ouverte, choisi dans Ce soir,
  écarté. Tout reste en local.
- **« Ne plus me proposer ça »**, persistant.
- **Taux d'acceptation** : quelle part des propositions finit ajoutée, puis bien notée. C'est
  l'équivalent personnel des tests A/B des plateformes.
- ~~**Duels actifs**~~ : **abandonné**, sur mesure. La phase 1 a montré que les duels
  n'améliorent pas la prédiction de tes notes sur des titres inconnus (le modèle ne les utilise
  donc pas) ; choisir les paires « pour apprendre au modèle » ne lui apprendrait rien. Les duels
  gardent leur rôle : classer finement ce que tu as vu.
- **Tri rapide, façon Tinder** : j'aime / je n'aime pas, une carte à la fois.
  - **Desktop** : deux grands boutons très accessibles de part et d'autre de la carte (« Je
    n'aime pas » à gauche, « J'aime » à droite) et trois raccourcis, comme dans les duels :
    **1** = je n'aime pas, **2** = j'aime, **3** = passer. Les flèches ← / → font la même chose
    que 1 / 2.
  - **Mobile** : balayage à gauche ou à droite. Les deux boutons restent affichés sous la carte :
    le geste accélère, mais ne doit jamais être le seul moyen d'agir.
  - **Passer** n'envoie aucun signal : « je ne connais pas » n'est ni un oui ni un non.

  Trois familles de cartes, avec le même filtre Tout / Films / Séries / Documentaires que les
  duels :
  - **titres pas encore vus**, tirés des candidats de « À découvrir » : j'aime = ajouté à ta pile
    à voir, je n'aime pas = « ne plus me proposer ». La découverte devient un tri en quelques
    secondes par titre ;
  - **titres déjà vus** mais pas encore notés : une première note grossière, à affiner ensuite ;
  - **personnes** : acteurs, réalisateurs, et producteurs (à ajouter au magasin de
    caractéristiques, les crédits TMDB les fournissent déjà).

  Le modèle choisit la carte suivante là où ta réponse lui apprend le plus, plutôt qu'au hasard.

  *Point de vigilance :* un « je n'aime pas » sur un titre pas vu veut dire « ça ne me tente
  pas », pas « je ne l'ai pas aimé ». Ces deux signaux restent séparés : un jugement sur une
  affiche et un résumé pèse moins qu'une note donnée après visionnage.

*Mesure de succès :* le taux d'acceptation progresse d'un mois sur l'autre.

**Livré (2026-09-25)**, spec `tri-rapide-v1.md` : journal local des gestes (ajout avec son
origine, retrait, note, écartement, réponse de tri), « Ne plus me proposer » sur la pile, « À
découvrir » et les suggestions de l'ajout (annulable, puis réversible depuis le profil), tri rapide
en trois familles à la page `/tri`, avis sur les personnes pris en compte dans le classement
(bonus borné), taux d'acceptation dans le profil de goûts. La production (films : « Producer » ;
séries : producteurs exécutifs) entre dans le magasin de caractéristiques, pour le tri des
personnes seulement. Banc inchangé (0,387) : sans avis sur des personnes, le bonus est nul.

Reporté : le choix de la carte suivante « là où la réponse apprend le plus ». Sans réponses
enregistrées, aucun moyen de mesurer qu'une heuristique d'incertitude fait mieux qu'un ordre de
reconnaissance. Les cartes suivent donc l'ordre le plus facile à juger : découvertes les mieux
classées d'abord, titres vus les plus récemment modifiés, personnes les plus présentes dans tes
titres vus. À reprendre quand le journal comptera quelques centaines de réponses.

### Phase 5 — Le contexte de « Ce soir » (option)

- Durée disponible, humeur, seul ou accompagné, disponibilité ce soir.
- Le tirage devient une recommandation contextuelle plutôt qu'un filtre.

**Livré (2026-09-26)**, spec `ce-soir-v2.md` : envie, format, durée, avec qui, où, parmi ma pile
ou tout le catalogue, sur un seul écran ; propositions classées par compatibilité.

### Au-delà du plan (2026-09-25 et 26)

- **Score de recommandation** (recommendations-v1 §13) : compatibilité calée, classement par
  compatibilité, calibration par groupes de 12, production et moyenne bayésienne de la note
  TMDB dans le modèle. Banc : 0,394 (0,379 sans la moyenne bayésienne).
- **Classement par étoiles et départage** (`classement-v1.md`), vue Personnes, annulation des
  duels.
- **Sorties** (`sorties-v1.md`) : badges « Au cinéma » / « À venir », calendrier, « À découvrir »
  en rangées.
- **Fraîcheur** (`recommandations-fraicheur-v1.md`, 2026-10-09) : les cartes vues à l'écran sont
  relevées ; un titre montré sans geste recule de 3 places par jour, au plus d'une rangée, et
  retrouve sa place à mesure que la mémoire s'efface. Banc : 19 titres différents en tête la
  première semaine au lieu de 12, sans perte de note.

## 4. Ce qu'on ne fera pas, et pourquoi

- **Réseaux profonds, autoencodeurs, modèles à deux tours** : sur-apprentissage garanti avec un
  seul utilisateur (constat 2).
- **Personnalisation des visuels** : nécessite des millions d'impressions.
- **Appel à un LLM distant pour recommander** : coûteux, non mesurable sur le banc, et fait
  sortir tes goûts de ta machine. Les plongements locaux de la phase 2 en apportent l'essentiel.

## 5. Principes transverses

- **Local d'abord** : aucune donnée de goût ne quitte la machine ; Notion reste synchronisé
  uniquement à la demande, comme aujourd'hui.
- **Mesurer avant de livrer** : chaque brique passe par le banc.
- **Expliquer chaque proposition** : aucune recommandation sans raison lisible.
- **Rester réversible** : chaque phase s'active sans casser la précédente.
