# Vitrine de l'accueil

Trois aperçus repris de raycast.com pour l'accueil de Catalog (demande de l'utilisateur,
2026-09-28) : le carrousel d'extensions de l'accueil (« There's an extension for that »), le mur
de fonctionnalités de la page Windows (FeatureWall, préféré aux cartes « Featured » du Store) et la
liste d'extensions à onglets du Store. Chaque carte ouvre la fiche du
titre (`/library?fiche=<id>`) ; la recherche ouvre la bibliothèque (`/library?q=…`).

## Relevé raycast.com (accueil, 2026-09-28)

| Élément | Valeur |
|---|---|
| Section | marges verticales 104, écart 40 entre haut, rangée et bas |
| Titre et précision | 20 px en 500, +0,2 px ; précision même taille en Smoke, 480 de large au plus |
| Onglets | rail : dégradé 137°, arête blanc 6 %, reflet haut, rayon 31 ; options de 46, 14 px en 500 |
| Rangée | pleine largeur (100vw, 2 000 au plus), défilement aimanté, fondu des bords (64 à gauche, 104 à droite), écart 56 |
| Carte | 360 × 536, rayon 20, dégradé propre à l'extension (`linear-gradient(138deg, rgba(32,35,91,.7) 22%, rgba(7,9,33,.7) 82%)` pour Linear), arête blanc 6 %, reflet haut ; halo coloré de 20 à 40 px |
| En-tête | marges 24, écart 24 ; icône 56, rayon 12, ombre légère ; titre 18 px en 400 ; flèche 36 (bouton sombre) |
| Description | 16 px en 500, interligne 160 %, blanc ; filet blanc 5 % |
| Visuel | 360 × 360 en bas |
| Survol | vignette en lumière douce ; anneau de la flèche à 50 % |
| Pied | lien « Browse thousands more → » 16 px en 500, Ash, flèche qui avance de 2 px ; flèches rondes de 56 (fond du rail, arête 6 %) |

Mur de fonctionnalités (raycast.com/windows) : carte au fond du rail (dégradé 137°), arête blanc
6 % (12 % au survol), reflet haut, rayon 12 ; visuel de 280 (460 pour la carte principale, sur deux
colonnes) ; texte 20 px en 500, titre blanc et suite en Ash dans la même phrase ; badge Graphite
de 24, icône 16 ; marges 16 × 32 × 32, écart 24 ; grille de deux colonnes, écart 40.

Store : carte de liste, voir [carte.md](carte.md) (marge 32, arête 6 %,
rayon 12, icône 96 ou 32, titre 20 px, description 15 px, bouton sombre).

## Recette Catalog

L'accueil est la vitrine des six fonctions clés (demande de l'utilisateur, 2026-09-28), une
section chacune, en alternant aperçus pleine largeur et sections « texte et visuel » :

| Ordre | Fonction | Section | Aperçu |
|---|---|---|---|
| 1 | Ce soir | `ShowcaseCarousel` | cartes de ta pile par envie ; « Je regarde ça », « Pas ce soir » |
| 2 | Notation | `FeatureSection` | `RatingPreview` : un titre vu sans note, touches 0 à 5 |
| 3 | Recommandations et À découvrir | `FeatureWall` + `RecommendationsWall` | fenêtre de ta pile, tri à découvrir, tes goûts |
| 4 | Duels | `FeatureSection reverse` | `DuelPreview` : une vraie paire, 1, 2, 3 |
| 5 | Bibliothèque | `TitleListSection` | recherche pendant la frappe, étoiles, « Marquer vu » |
| 6 | Playlists | `FeatureSection reverse` | `PlaylistPreview` : la playlist en cours, son prochain titre (durée, heure de fin, où), « Je regarde ça » ; sinon une invitation |
| 7 | Sorties | `FeatureSection` | `ReleasesPreview` : les 14 prochains jours, pour toi, « Ajouter » |

Données : `src/lib/showcase.ts` et `src/lib/homeFeatures.ts` (lecture seule) ; teinte :
`src/lib/posterTint.ts` (les pixels les plus saturés de l'affiche en miniature, lue avec `sharp`,
gardée en mémoire). Composants : `@/components/sections` (`showcase.tsx`, `feature.tsx`,
`previews.tsx`, `recommendations-wall.tsx`).

Règles communes des aperçus vivants :

- Une vraie commande, pas une capture : noter, trancher, ajouter, écarter écrivent comme dans la
  vue d'origine (mêmes routes), et seulement sur un geste de l'utilisateur.
- Chaque geste s'annule (bouton « Annuler », Ctrl+Z quand l'aperçu a le focus) ; un échec le dit
  dans la ligne d'état (`aria-live`), jamais en silence.
- Le clavier ne répond que dans l'aperçu qui a le focus : la page garde ses touches.
- Touches affichées (`Keycap`, `Kbd`) seulement à partir de 640 px.

| Composant | Recette |
|---|---|
| `FeatureSection` | côte à côte dès 768 px : grille 5/6 (5/7 dès 1 024 px ; inversée en `reverse`), écart 40 puis 64 ; le visuel plafonné à 38 rem (le texte reste à côté plus longtemps, demande de l'utilisateur) ; surtitre `FeatureEyebrow` (badge Graphite, icône 16), seulement sur ces sections explicatives ; titre `text-heading-sm`, 32 dès 1 024 px ; explication en Ash ; chiffres en Geist Mono ; actions : `Button` et `ArrowLink` ; texte au-dessus sur téléphone |
| `.feature-stage` | scène du visuel : fond du rail, arête 6 %, reflet haut, rayon 20, marge 20 (32 dès 640 px), 384 de haut au moins ; teintée par l'affiche en cours (`--tint`), sans halo ; conteneur de requêtes (`container-type: inline-size`) : les aperçus s'adaptent à sa largeur |
| `RatingPreview` | affiche, badge « Vu, pas encore noté », titre, type et année, bande-annonce ; `RatingKeys fitContainer` (trois colonnes, six dès 32 rem de scène ; touches alignées en haut) ; ligne d'état et « Annuler » |
| `DuelPreview` | « Lequel préfères-tu ? » ; deux cartes `tile` (affiche, titre, année et genre, touche) séparées par « ou » ; « Passer 3 », « Annuler » |
| `ReleasesPreview` | badge « À venir » ; jours en titres de 14 px ; lignes : affiche de 48, titre, événement (et genre dès 640 px), compatibilité, « Ajouter » en bouton rond |
| `ShowcaseCarousel` | titre et précision (`text-subheading`, précision en Ash), `Tabs` à droite, sans surtitre ; rangée `.reel` (← → d'une carte à l'autre) ; pied : lien `.arrow-link`, ligne d'état et « Annuler », flèches `Button variant="rail" size="xl" icon` |
| `ShowcaseCard` | `.showcase-card.showcase-card-poster` : l'affiche fait la carte (format 2:3, 360 de large, 300 sur téléphone ; demande de l'utilisateur : 80 à 90 % d'affiche), rayon 20, arête blanc 8 % ; en bas, sur un dégradé sombre, le titre (lien étiré) et une ligne : compatibilité, durée et heure de fin si tu lances maintenant (ou par épisode), logo de l'abonnement. Au survol ou au focus, le bloc monte de 76 (transform et opacité, 300 ms) : un bandeau défile lentement (`.ticker`, ≈ 30 px/s, arrêté sans survol et en mouvement réduit : pourquoi, réalisation, distribution, genres, abonnement) et les gestes apparaissent (« Je regarde ça », « Pas ce soir », bande-annonce, en `overlay`) ; l'image s'agrandit de 3 %. Sur écran tactile, tout reste ouvert. Marqué vu : « Bonne séance, fin vers … » et « Annuler » |
| `FeatureWall` | titre et précision centrés en deux tons, sans surtitre ; grille de deux colonnes ; `footer` : liens centrés |
| `RecommendationsWall` | fenêtre de ta pile en pleine largeur (`.feature-card.pick-window`, 416 de haut dès 1 024 px) : champ « Filtrer ta pile… » (combobox), puce du genre choisi, liste (`listbox`, ↑ ↓, seule la liste défile, sélection `bg-selection`, compatibilité en Geist Mono), détail teinté (`.pick-detail`) : affiche, type, année, genres, compatibilité, abonnement, « Parce que tu as aimé », synopsis, « Voir la fiche ↵ », bande-annonce, « Ne plus me proposer ». Dessous, côte à côte dès 768 px : le paquet « À découvrir » (`.discover-deck` : trois affiches en éventail, celle du dessus se glisse à droite pour ajouter, à gauche pour écarter, avec un tampon ; les suivantes avancent d'un cran ; 1, 2, 3 au clavier, sans animation) et « Tes goûts » (`.taste-radar` : radar Bklit à deux polygones, jaune pour tes notes par genre, gris pour la part de ta pile ; légende ; puces de genre qui filtrent la fenêtre, le genre choisi allumé sur le radar) |
| `TitleListSection` | `SectionHeading`, sans surtitre ; à gauche (4/12, collant dès 1 024 px) le panneau « ta collection en chiffres » : total, part des vus (barre), types en puces et histogramme de tes notes (💩 en gris, 1 à 5 en jaune, sans piste), qui filtrent la grille ; à droite, onglets et recherche (pendant la frappe, 250 ms ; ↵ ouvre la bibliothèque), ligne de résultat et « Effacer les filtres », grille de `TitleRowCard` ; ligne d'état et « Annuler » |
| `TitleRowCard` | `.card.card-live.row-card` (teintée par l'affiche, s'éclaire au survol), marge 16 à 20 : l'affiche à gauche (96 de large) avec la bande-annonce ; titre (lien étiré), année et genres, « De … » ; anneau du score TMDB (`ScoreBadge`) ; synopsis ; vu : badge « Vu » et `StarRating` (💩 à 5) ; à voir : badge « À voir » et « Marquer vu », puis la note |

Écarts assumés :

- **Pas de halo coloré** autour des cartes (préférence de l'utilisateur : pas de lueurs) ; la
  teinte reste dans la carte, plus douce (26 % à 5 %, plus une lueur interne sous l'affiche).
- Teinte tirée de l'affiche, pas choisie à la main ; une affiche grise laisse la carte neutre.
- Le bouton d'une carte est un aspect (`buttonClass` sur un `span`) quand toute la carte est le
  lien ; dès qu'elle porte des actions, le lien est étiré sous elles, jamais un bouton dans un lien.
- Précision du titre de section en Ash (lisible), pas en Smoke.
- Écart de 20 entre les cartes du carrousel (56 sur le site ; jugé trop large par l'utilisateur).
- Des aperçus qui agissent (demande de l'utilisateur) : sur raycast.com, ces sections sont des
  images ; dans Catalog, ce sont des commandes, au même niveau que Notation, Duels et Sorties.

## Liste de contrôle

- [ ] La première carte s'aligne sur le contenu ; la rangée va jusqu'aux bords de l'écran.
- [ ] Un titre long se tronque ; l'affiche du bas reste centrée.
- [ ] Changer d'onglet remplace les cartes et ramène la rangée au début, sans animation.
- [ ] Les flèches avancent d'une carte ; elles se grisent aux extrémités.
- [ ] Aucune carte sans affiche ; le titre reste lisible sur une affiche claire ou chargée de texte.
- [ ] Tout le texte est lisible (Ash au moins), aucun texte sous 12 px.
- [ ] Chaque geste d'un aperçu s'annule, et son échec s'affiche dans la ligne d'état.
- [ ] Les touches d'un aperçu ne répondent que quand il a le focus.
- [ ] Les captures et les tests ne déclenchent aucune écriture (requêtes non GET coupées).
- [ ] Le bandeau ne défile qu'au survol, et jamais en mouvement réduit.
- [ ] Entre 768 et 1 024 px, le texte des sections explicatives et les deux cartes d'« À la une » restent côte à côte.
