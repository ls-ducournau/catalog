# Notes et scores

Raycast n'a pas d'étoiles de notation : cette fiche est propre à Catalog (décision D6 de la spec,
2026-09-28). La couleur vient de la palette relevée sur raycast.com (`../mesures/tokens-site.json`) :
le jaune `#ffc531` et le vert `#59d499`, déjà présent comme lavis de mise en valeur.

## Principe

Les notes et les scores sont **les seules couleurs de l'interface** (hors marque). Deux règles :

1. **Une seule étoile** : le même dessin partout où une note s'affiche. Jamais de « ★ » en texte
   ni d'emoji « ⭐️ » dans l'interface. Les valeurs de données (`"⭐️⭐️⭐️"`, le format des notes
   Notion) ne s'affichent jamais telles quelles.
2. **La couleur double le chiffre** : un score montre toujours son nombre ; la couleur ne porte
   jamais seule l'information.

## Étoile

| Élément | Recette |
|---|---|
| Dessin | `Star` de Lucide, trait 1,5 |
| Pleine | fond et trait `--rating` (jaune `#ffc531`) |
| Vide | trait `--subtle` (Smoke), sans fond |
| Survol d'une notation | aperçu en étoiles pleines ; étincelles jaunes à la pose |

Composants (`StarRating.tsx`, exportés par `@/components/ui`) :

| Composant | Emploi |
|---|---|
| `StarIcon` | l'étoile seule, pleine ou vide, à la taille voulue : base de tous les autres |
| `StarRating` | notation (cartes, fiche), cibles de 24 px |
| `StarsReadOnly` | cinq étoiles en lecture seule (cartes étroites) |
| `StarRow` | n étoiles pleines (titre d'un palier du Classement) |
| `StarCount` | « 4 ★ » : paliers, raccourcis, moyennes, filtres, onglets |
| Palier 💩 | reste un emoji : ce n'est pas une note en étoiles |

Dans une phrase (titres, messages), le palier s'écrit en mots : « Départager les 4 étoiles ».
Un contrôle qui n'accepte qu'un texte (`Tabs`, `Select`) prend un `display` avec `StarCount`, et
garde un `label` en mots pour la recherche et les lecteurs d'écran.

## Score

| Score | Recette |
|---|---|
| Note TMDB (`ScoreBadge`) | anneau `--score-high` (vert) dès 70, `--score-mid` (jaune) de 40 à 69, `--score-low` (gris) dessous ; chiffre au centre |
| Compatibilité (`CompatibilityChip`) | badge en lavis vert (`success`) dès 60 % ; neutre en dessous ; texte gris sous 40 % |

Écart de seuil voulu : un 45 % de compatibilité est un titre ordinaire, pas une mauvaise note ;
la couleur ne s'allume que franchement au-dessus de ta moyenne.

## Autres signaux : l'interrupteur

`Switch` (`.switch`) : éteint, fond Graphite, arête `--field-edge`, pastille Ash ; allumé, fond
`--switch-on` (le vert `#59d499`, « activé » comme « bon signe ») et pastille sombre
`--switch-on-knob` (10,9:1). La position de la pastille dit aussi l'état. Écartés : Mist (trop
proche du bouton d'action), le corail (marque, jamais un contrôle), Ash (lu comme désactivé).

## Liste de contrôle

- [ ] Toute note affichée passe par `StarIcon` (ou un composant qui l'emploie) : jaune plein,
      contour gris vide.
- [ ] Aucun « ★ » ni « ⭐️ » dans le texte d'une vue ; en phrase, des mots.
- [ ] Un score montre toujours son chiffre ; la couleur ne fait que le souligner.
- [ ] Interrupteur allumé en vert, pastille sombre ; éteint en gris.
- [ ] Pas d'autre couleur que celles de cette fiche et la marque.
