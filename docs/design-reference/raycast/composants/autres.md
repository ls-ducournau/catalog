# Autres composants de DESIGN.md

Composants que DESIGN.md décrit et que les fiches précédentes ne couvrent pas. Là où un relevé
existe (`../mesures/recettes-accueil.json`), il est indiqué et prime sur DESIGN.md.

La barre de navigation a sa fiche : [barre-navigation.md](barre-navigation.md).

## Conteneur d'icône

- **DESIGN.md** : cercle, marge 20, fond sombre, glyphe de 24 à 32.
- **Catalog** : `IconCircle`, `.icon-circle` (Graphite, reflet haut, icône Mist). Non relevé.

## Héros

- **DESIGN.md** : lavis bleu radial à 50 % 26 %, barres corail en diagonale floutées à 40 px,
  fondu vers le fond ; le seul endroit en couleur.
- **Catalog** : `ShardsBackdrop`, `.shards`. Non relevé.

## Mentions techniques

- **DESIGN.md** : Geist Mono 12 px en Ash, séparées par des barres verticales.
- **Catalog** : `MonoMeta`, `.mono-meta`.

## Fenêtre de commande

- **DESIGN.md** : cadre de rayon 12, barre de commande de rayon 16, lignes de rayon 8 ; relief
  « touche » sur le cadre ; ligne choisie en blanc 8 % (DESIGN.md dit corail : Catalog reste
  achromatique).
- **Catalog** : `CommandWindow`, `.bezel`, `.bezel-inner`, `ListRow`, `ActionBar`. Non relevé ;
  la barre d'actions reprend les touches de [champ-recherche.md](champ-recherche.md). Le cadre
  `.bezel` prend le verre de la barre (`--glass-fill`, flou 5 px, arête blanc 6 %, demande de
  l'utilisateur du 2026-09-28) : posé sur le décor du héros (Duels, Tri rapide), on devine les
  éclats à travers.

## Grande touche (keycap)

- **Relevé (accueil)** : `radial-gradient(75% 75% at 50% 91.9%, #121212 0%, #0d0d0d 100%)`,
  rayon 11, ombre `--shadow-keycap`, 23,75 px en 500 ; transitions de 200 ms sur la courbe
  `out`.
- **Catalog** : `Keycap`, `.keycap` : reprise 1:1 ; s'enfonce de 1 px quand `pressed`.
