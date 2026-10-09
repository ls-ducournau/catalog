# Badge

![Version du Changelog, compteur Contributors, badge New des tarifs](img/badge.png)

Captures : version d'une entrée du Changelog, compteur du bloc Contributors (page
d'extension), badge « New » des tarifs.

## Relevé raycast.com

| Badge | Propriété | Valeur |
|---|---|---|
| Version (Pill du Changelog) | Fond | la couleur du texte à 15 % : `rgba(255,97,97,.15)` |
| | Texte | `#ff6161`, 16/18,4, **400** |
| | Marges, hauteur | 4 × 16, 26 |
| | Rayon | 6 |
| Compteur (Contributors · 43) | Fond | blanc 20 % |
| | Texte | blanc, 10/12, 600 |
| | Marges, hauteur | 2 × 8, 16 |
| | Rayon | pastille |
| New (tarifs) | Aspect | pastille à arête bleue, lavis bleu, 11 px (non relevé en détail) |

DESIGN.md décrivait un badge Graphite plein au texte blanc : le site n'en montre pas.

## Recette Catalog

`Badge` (`src/components/ui/primitives.tsx`) pose `.badge` et une variante.

| Variante | Recette |
|---|---|
| `neutral` | texte blanc ; fond `color-mix(currentColor 15 %)` |
| `success` | texte `--success`, même lavis (mise en valeur, le libellé dit l'information) |
| `brand` | texte `--brand`, même lavis : la marque seulement (version, IA) |
| `count` | pastille blanche à 20 %, 12 px en 600, marges 0 × 8, 18 de haut |

Base : 24 de haut, marges 0 × 10, rayon 6, 13/16 en 400, +0,008em.

Écarts assumés :

- 13 px au lieu de 16 : le badge vit dans les lignes de métadonnées et les cartes, où 16 px
  écraserait le titre.
- Compteur à 12 px au lieu de 10 : plancher de 12 px.

## Liste de contrôle

- [ ] Lavis de la couleur du texte, jamais un fond plein opaque.
- [ ] Texte régulier (400), pas gras ; seul le compteur est en 600.
- [ ] Rayon 6 pour un badge, pastille pour un compteur.
- [ ] Corail réservé au badge `brand` (version, IA) ; vert pour une mise en valeur accompagnée
      d'un libellé ; sinon neutre.
- [ ] Aucun texte sous 12 px.
