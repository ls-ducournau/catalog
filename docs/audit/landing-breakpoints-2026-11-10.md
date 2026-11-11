# Audit UX et UI de la page d'arrivée : téléphones et tablettes (2026-11-10)

Demande de Louis (2026-11-09) : « fait un audit UX et UI de toutes les vues de landing page des breakpoint
pour les tablettes et téléphone », puis « Améliore sans mon approbation ».

## Méthode

Six formats, en visiteur, lecture seule (aucune écriture : les requêtes `/api` autres que GET sont
coupées) : téléphone 360 × 640, 390 × 844, 430 × 932 ; tablette 768 × 1024, 820 × 1180, 1180 × 820
(paysage). Six vues : la page d'arrivée (entière), la bienvenue à ses quatre étapes, la connexion.
Contrôles automatiques à chaque vue : défilement horizontal, éléments hors de l'écran, textes sous 12 px,
cibles tactiles sous 40 px, et, pour la bienvenue, défilement vertical (FR-15 : elle doit tenir dans
l'écran). Captures section par section au téléphone (390) et sur tablette (820).

## Constats

| # | Constat | Gravité | Où |
|---|---|---|---|
| 1 | « Comment ça marche » en trois colonnes dès 768 px : sur tablette portrait, les images débordent des panneaux 2 et 3 | Haute | tablette 768, 820 |
| 2 | Le tampon « Ça me tente » de l'image de l'étape 1 passe sur deux lignes | Moyenne | téléphone |
| 3 | Au 360 × 640, la carte de la bienvenue est petite et son tampon trop grand pour elle | Moyenne | téléphone 360 |
| 4 | Au 360 × 640, la consigne de la bienvenue prend une ligne utile à la carte | Basse | téléphone 360 |
| 5 | Cibles au doigt sous 40 px : logo (28 px de haut), liens fléchés (22 px), petits boutons du parcours (28 à 32 px) | Moyenne | tous |
| 6 | Héros au téléphone : « Tester » (le bouton principal) plus étroit que « Comment ça marche » | Basse | téléphone |
| 7 | Le radar « Tes goûts » et la bibliothèque en chiffres avaient disparu de la page (signalé par Louis) | Haute | toutes |

Aucun défilement horizontal, aucun texte sous 12 px ; la bienvenue ne défile jamais.

## Corrections

1. « Comment ça marche » : trois colonnes (et les flèches) dès 1024 px seulement ; sur tablette, chaque
   temps couché, l'image à gauche (18 rem) et le texte à droite ; au téléphone, empilés. Le lien de chaque
   temps passe sous son texte.
2. Tampon de l'image : sur une ligne.
3. Tampon des cartes : sa taille suit la largeur de la carte (`container-type: inline-size`, 12 à 18 px).
4. Consigne de la bienvenue masquée sous 704 px de haut.
5. Liens fléchés : 40 px de haut au doigt sans changer la mise en page (marge négative) ; logo à 40 px ;
   boutons du parcours (étape suivante, « Ouvrir Catalog », « Annuler », « Retour à l'affiche », étapes) en
   taille normale.
6. Héros au téléphone : les deux boutons se partagent la ligne à parts égales.
7. Exemples signalés (FR-19 de `specs/bienvenue-v1.md`) : dans « À la une », un radar « Tes goûts »
   d'exemple, bâti sur les genres des tendances (ses puces filtrent les tendances sur place) et « Lire le
   radar » à côté ; dans « Ta bibliothèque », le panneau en chiffres d'une bibliothèque d'exemple faite des
   titres des onglets (les types filtrent sur place). Toujours marqués « Exemple » : aucune note n'appartient
   à quelqu'un.

## Reste à décider ou à faire

- Le bouton « Revenir en haut » recouvre un peu le contenu en bas à droite au téléphone (mineur).
- Les petits boutons de l'application (hors page d'arrivée et bienvenue) restent à 28 px : conformes au
  minimum WCAG 2.5.8 (24 px), en deçà du confort au doigt (40 à 44 px). À traiter avec la refonte de
  l'accueil d'un compte.
