# Fiches de QA : Raycast composant par composant

DESIGN.md, découpé en fiches courtes et corrigé par des **relevés de raycast.com** : les styles
calculés dans Chrome le 2026-09-28, sur le Store, la page d'extension GitHub et le Changelog.
DESIGN.md est une description générée ; ses valeurs de composants sont souvent approximatives.
L'exemple le plus visible : il met le relief « touche » (anneau blanc à 25 %) sur les cartes,
alors que raycast.com le réserve au bouton sombre.

**Ordre de priorité** (spec `specs/design-system-v2-raycast.md`, décision D5) :

1. la fiche du composant (relevé, capture) ;
2. `../DESIGN.md` pour les principes (achromatique, corail de marque, pas d'ombre portée,
   interlettrage positif) ;
3. `../analyse.md` et `../mesures/` en complément.

## Fiches

| Fiche | Primitive ou section Catalog | Recette |
|---|---|---|
| [fondations.md](fondations.md) | Jetons (`design/tokens.json`) | couleurs, texte, rayons, reliefs, espacement |
| [bouton.md](bouton.md) | `Button`, `buttonClass()` | `.btn`, `.btn-primary`, `.btn-secondary` |
| [badge.md](badge.md) | `Badge` | `.badge`, `.badge-brand`, `.badge-success`, `.badge-count` |
| [onglets.md](onglets.md) | `Tabs` (`SegmentedControl`) | `.segmented`, `.segmented-pill`, `.segmented-item` |
| [champ-recherche.md](champ-recherche.md) | `SearchField`, `Kbd` | `.field`, `.field-search`, `.kbd` |
| [puce.md](puce.md) | `Chip`, `Select`, `ServicesFilter`, `ServicesPicker` | `.chip`, arêtes `--field-edge` |
| [carte.md](carte.md) | `Card` (key, edge, tile) | `.card`, `.card-soft`, `.tile`, `.panel` |
| [titres.md](titres.md) | `PageHeader`, `SectionHeading`, `MediaRow` | classes de texte |
| [barre-navigation.md](barre-navigation.md) | `NavBar` | `.nav-glass` |
| [vitrine.md](vitrine.md) | `ShowcaseCarousel`, `ShowcaseCard`, `FeaturedTitleCard`, `TitleListSection` | `.reel`, `.showcase-card`, `.arrow-link`, `btn-rail` |
| [note-et-score.md](note-et-score.md) | `StarIcon`, `StarRating`, `StarCount`, `StarRow`, `ScoreBadge`, `CompatibilityChip` | jetons `--rating`, `--score-*` |
| [autres.md](autres.md) | conteneur d'icône, héros, fenêtre de commande, grande touche | non relevés en détail |

Chaque fiche donne : la capture de référence (`img/`), le relevé, la recette Catalog avec ses
jetons, les écarts assumés et leur raison, puis une liste de contrôle.

## Faire la QA d'un composant, d'une vue ou d'un refactor d'UI

1. Ouvrir la fiche de chaque composant touché, et regarder sa capture.
2. Construire avec les primitives : une valeur de la fiche ne s'écrit jamais dans une page, elle
   vit dans une recette de `globals.css` ou un jeton.
3. Capturer l'écran à 1 440 px et à 390 px (téléphone), dans l'état au repos et au survol.
4. Mettre la capture Catalog à côté de la capture de la fiche, à la même échelle, et passer la
   liste de contrôle ligne par ligne.
5. Vérifier : `npm run check`, `npm run test:motion`, `npm run test:visual`.

## Refaire un relevé

Les valeurs viennent de `getComputedStyle` (pseudo-éléments `::before` et `::after` compris), lu
dans Chrome par Playwright, et des règles CSS du site pour les états (`:hover`, `:active`,
`:focus`). Pour un composant absent des fiches, relever de la même façon avant de construire,
puis ajouter une fiche ici.
