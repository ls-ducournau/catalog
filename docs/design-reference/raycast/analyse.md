# Raycast : cartographie et extraction du design system

Relevé du 2026-09-27 sur raycast.com, en sombre (le site n'a pas de thème clair). Sources :
inspection des styles calculés dans Chrome (CDP) sur 15 gabarits, `designlang` v13.3.2
(`--dark --deep-interact --motion-runtime`, puis `site --max-pages 7`), captures 1440×900.

Il remplace la référence Eno (`../enobase/analyse-neutres-composants.md`) : décision de
l'utilisateur du 2026-09-27. Le plan d'intégration est dans `specs/design-system-v2-raycast.md`.

Fichiers bruts dans `mesures/` : `plan-du-site.txt` (98 URL du sitemap), `tokens-site.json`
(tokens DTCG de designlang, 7 pages), `motion-accueil.json` (mouvement observé en exécution),
`recettes-accueil.json` et `recettes-page-extension.json` (styles calculés des composants).

## 1. Cartographie

98 URL, 22 gabarits. Ceux qui comptent pour Catalog sont en gras.

| Gabarit | Exemple | Structure | Utilité pour Catalog |
|---|---|---|---|
| **Accueil** | `/` | Barre flottante, héros « éclats » rouge et bleu, titre 64 px, CTA, puis fenêtres de l'app en démonstration | Accueil, héros de Ce soir |
| **Store** | `/store` | Tuiles d'icônes, titre 80 px centré, recherche ⌘K, 3 cartes « Featured », barre d'outils (onglets, filtre, recherche), liste | Recommandations, Bibliothèque |
| **Page d'extension** | `/raycast/github` | Tuile 96 px, titre 20 px, résumé, ligne de métadonnées séparées, bouton scindé, onglets, carrousel de captures, colonne « Contributors », texte long | Fiche d'un titre |
| **Changelog** | `/changelog` | Onglets de plateforme ; 2 colonnes : version et date à gauche, visuel 16:9 et texte à droite | Sorties |
| **Tarifs** | `/pricing` | Colonnes de cartes en dégradé, listes cochées, badges « New » bleus | Profil de goûts (cartes de synthèse) |
| Fonctions (×12) | `/core-features/notes` | Héros, fenêtre de l'app, sections alternées | Pages d'aide, si un jour |
| Blog, article | `/blog/...` | Index en cartes, article 720 px | Hors périmètre |
| Pro, Teams, Enterprise, iOS, Windows | | Variantes de l'accueil | Hors périmètre |
| Développeurs, API | `/developers` | Documentation | Hors périmètre |

Le site est une vitrine, mais il montre l'app en fonctionnement : palette de commandes, liste et
détail, barre d'actions et touches, dock. **Pour une app comme Catalog, c'est ce registre
« produit » qu'on copie.** Les gabarits du site donnent la structure des pages.

Captures : `01-accueil-hero.jpg`, `02-accueil-sections.jpg` (fenêtre « Clipboard History » et
dock), `03-store-hero.jpg`, `04-store-liste.jpg`, `05-page-extension.jpg`, `06-changelog.jpg`,
`07-tarifs.jpg`. Les captures refero plus anciennes sont dans `../refero-raycast/`.

## 2. Couleur : 98 % achromatique

### Neutres (primitives mesurées)

| Rôle Raycast | Valeur | Emploi |
|---|---|---|
| grey-900 / `--color-bg` | `#07080a` | Fond de page |
| grey-800 | `#0c0d0f` | Fin du dégradé de la barre, fond des touches |
| grey-700 | `#111214` | Cartes (début du dégradé 137°) |
| grey-600 | `#1b1c1e` | Bordure du héros, surfaces actives |
| grey-500 | `#2f3031` | Bordure des cartes de tarifs, texte du bouton principal |
| grey-400 | `#434345` | Désactivé |
| grey-300 | `#6a6b6c` | Texte tertiaire (**échoue en contraste**, voir § 7) |
| grey-200 | `#9c9c9d` | Texte secondaire, liens de navigation |
| grey-100 | `#cdcece` | |
| grey-50 | `#e6e6e6` | Fond du bouton principal |
| `--color-border` | `#242728` | Filets |
| Texte | `#f4f4f6` titres, blanc à 85 % pour le corps, blanc à 60 % pour les résumés | |

Les filets et les reliefs sont presque tous en **blanc translucide** : 6 % (bordure de carte, de
barre), 10 % (séparateur), 5 % (reflet intérieur haut), 15 % (reflet de la barre), 25 %
(contour du bouton secondaire). C'est ce qui donne l'aspect « verre usiné » : la matière vient
des reflets, pas des gris.

### Accents

| Nom | Valeur | Emploi observé |
|---|---|---|
| Corail | `#ff6363` (texte `#ff6161`) | Logo, liens du changelog, badge de version sur fond corail à 15 % |
| Bleu | `#57c1ff` | Badge « New » des tarifs |
| Vert | `#59d499` | Statut positif |
| Jaune | `#ffc533` | Avertissement |

Chaque accent existe aussi à 15 % d'opacité, pour les fonds de badge. Aucun aplat de couleur :
l'accent est un texte ou un fond léger, jamais un bouton plein. La seule grande surface colorée
est le héros en « éclats » rouge et bleu, en image.

## 3. Typographie

Inter (texte) ; JetBrains Mono et Geist Mono (versions, touches, code). Interlettrage **positif**
sur le texte d'interface (+0,2 px à 14 px), négatif seulement sur les grands titres.

| Niveau | Taille / interligne | Graisse | Interlettrage | Couleur |
|---|---|---|---|---|
| Display (Store) | 80 | 600 | +1,2 px | `#fff` |
| Display (accueil) | 64 / 70,4 | 600 | 0 | `#fff` |
| Titre de section | 32 / 38,4 | 500 | −0,8 px | `#fff` |
| Titre (texte long) | 40 / 60 | 600 | 0 | `#fff` |
| Sous-section | 24 | 600 | 0 | |
| Titre de page d'extension | 20 / 30 | 600 | 0 | `#fff` |
| Corps | 16 / 25,6 | 400 | +0,32 px | blanc 85 % |
| Secondaire | 14 / 22,4 | 400 | 0 | `#9c9c9d` |
| Résumé | 14 / 21 | 400 | 0 | blanc 60 % |
| Bouton, lien de barre | 14 / 16 | 500 | +0,2 px | |
| Onglet | 13 / 20 | 600 | 0 | `#9c9c9d`, blanc si actif |
| Métadonnée, puce | 13 | 400 | 0 | blanc 60 % |
| Petit | 12 | 500 | 0 | blanc 70 % |
| Compteur, mention | 10 et 11 | 600 | | blanc 40 % (**sous le plancher de 12 px**) |

## 4. Forme, relief, matière

**Rayons** : 4 (puces), 6 (badges, champs), 8 (boutons, captures), 11 (touches), 12 (cartes),
16 (barre, cartes de tarifs, fenêtres), 25 % (tuiles d'icônes en squircle), 9999 (onglets,
pastilles).

**Recettes exactes** (styles calculés) :

- **Bouton principal** : fond `#e6e6e6`, texte `#2f3031`, r 8, h 36 (40 sur la page
  d'extension), 14/16 w500 +0,2 px, marges 8×12. Ombre :
  `0 0 0 2px rgb(0 0 0 / .5), 0 0 14px rgb(255 255 255 / .19), inset 0 -1px .4px rgb(0 0 0 / .2), inset 0 1px .4px #fff`.
  Transitions : fond et ombre 0,2 s, `transform` 0,1 s.
- **Bouton secondaire** : transparent,
  `inset 0 1px 0 rgb(255 255 255 / .05), 0 0 0 1px rgb(255 255 255 / .25), inset 0 -1px 0 rgb(0 0 0 / .2)`.
- **Touche (keycap)** : `radial-gradient(75% 75% at 50% 91.9%, #121212, #0d0d0d)`, r 11.
  Ombre :
  `0 1.5px .5px 2.5px rgb(0 0 0 / .4), 0 0 .5px 1px #000, inset 0 2px 1px 1px rgb(0 0 0 / .25), inset 0 1px 1px 1px rgb(255 255 255 / .2)`.
  Transitions 0,2 s `cubic-bezier(.23, 1, .32, 1)`, opacité 0,4 s. Petite version dans les
  barres d'action et les champs : 20×20, r 4, texte 12.
- **Barre flottante** : 1204×76, r 16,
  `linear-gradient(137deg, rgb(17 18 20 / .75) 4.87%, rgb(12 13 15 / .9) 75.88%)`, bordure
  blanc 6 %, reflet `inset 0 1px 1px rgb(255 255 255 / .15)`, `backdrop-filter: blur(5px)`,
  marges 16×32.
- **Carte du Store** : bordure blanc 6 %, r 12, reflet `inset 0 1px 0 rgb(255 255 255 / .05)`,
  marges 32, contenu centré (tuile, titre, résumé, auteur, bouton).
- **Carte de tarifs** : dégradé 137° depuis `#111214` (`#222326` pour la carte mise en avant),
  bordure `#2f3031`, r 16.
- **Onglets** : conteneur en pastille ; onglet 13/20 w600, marges 12×16, r 9999, `#9c9c9d`,
  couleur 0,3 s ; l'actif a un fond clair translucide.
- **Badge de version** : fond corail 15 %, texte `#ff6161`, r 6, h 26, en mono.
- **Compteur** : fond blanc 20 %, r 9999, marges 2×8.
- **Séparateur** : 1 px blanc 10 %.
- **Tuile d'icône** : squircle r 25 %, fond sombre et reflet ; en vedette, 96 px.
- **Halo de page** : `radial-gradient(49% 65% at 49% 0, rgb(255 255 255 / .03), transparent)`
  sous un voile `#07080a`, pour un léger éclairage en haut de page.

## 5. Sections et composants relevés

| Section ou composant | Où | Anatomie |
|---|---|---|
| Palette de commandes | Accueil | Champ de recherche, liste groupée (icône, titre, sous-titre, accessoires), panneau de détail « Information » (lignes libellé et valeur séparées par des filets), barre d'actions |
| Barre d'actions | Palette | À gauche l'icône et le nom de la commande ; à droite l'action principale, sa touche ↵, un séparateur, « Actions » et ⌘K |
| Dock | Accueil | Boutons-icônes en verre de 64 px, l'actif plus clair, infobulle au survol |
| Héros d'extension | Page d'extension | Tuile, titre, résumé, métadonnées (auteur, installations, type) séparées par des filets verticaux, bouton scindé à droite |
| Barre d'outils de liste | Store | Onglets à gauche ; filtre de plateforme et recherche ⌘K à droite |
| Cartes en vedette | Store | 3 cartes centrées, bouton secondaire, état désactivé estompé |
| Chronologie | Changelog | Colonne gauche collante (badge, date) ; colonne droite (visuel, texte, liens corail) |
| Liste de contributeurs | Page d'extension | Titre et compteur, avatars 20 px et noms à 60 % |
| Carrousel de captures | Page d'extension | Images r 8 et bordure 2 px transparente (hover), flèche à droite |
| Infobulle | Dock | Pastille sombre, bordure fine, texte 14 w500 |

## 6. Mouvement

Mesuré en exécution (designlang `--motion-runtime`, 71 animations observées) :

- **Courbes** : `cubic-bezier(.23, 1, .32, 1)` domine (199 emplois de la famille « ease-out »,
  avec `(.165, .84, .44, 1)` et `(.075, .82, .165, 1)`) ; `ease` pour les couleurs (86).
  **Aucun ressort, aucun dépassement.**
- **Durées** : 100 ms (appui), 180 à 200 ms (survol, fond, ombre), 300 ms (onglets, hauteur),
  400 à 500 ms (opacités longues), 700 ms en vitrine (révélations au défilement, décalage de
  80 ms), 5 s pour le décor en boucle.
- **Images clés** :
  - `contentShow` : `translateY(10px) scale(.96)` vers l'état final, avec fondu (fenêtres,
    bannière).
  - `fadeInScaleUp` : `translate(10px, 10px) scale(.9)` (fenêtre de démonstration).
  - `slideIn` : glissement vertical et fondu, sur 17 cartes décalées.
  - `overlayShow` : fondu du voile de dialogue.
  - `nightRider` : un reflet qui balaie la barre de recherche d'un bord à l'autre, en attente.
  - `blink` : curseur.
  - `shimmer` : chargement.
- **Micro-interactions** :
  - Touche enfoncée : l'ombre passe du relief au creux, 0,2 s.
  - Halo du bouton principal : 14 px de blanc à 19 %.
  - Couleur des onglets : 0,3 s.
  - Loupe du dock et son infobulle.
  - Bordure qui s'éclaire au survol des captures.

Le registre est **productif** au sens de Carbon : court, sans rebond, au service de l'état.
Le spectaculaire (éclats, révélations de 700 ms) reste réservé à la vitrine.

## 7. Ce qu'on ne copie pas

- **`#6a6b6c` en texte** : 3,75:1 sur le fond, 3,51:1 sur une carte, sous le 4,5:1 exigé.
  Catalog prend `#86868a` (5,52 / 5,17 / 4,70).
- **Textes de 10 et 11 px** (compteurs, mentions) : plancher de 12 px de l'utilisateur.
- **Révélations de 700 ms au défilement** : c'est un registre de vitrine. Dans l'app, on garde
  300 ms au plus.
- **Anglais et marques** : aucun texte ni logo repris. Seule la structure est reprise.
- **Héros en éclats sur chaque page** : un seul emploi, à l'accueil et dans Ce soir, en image
  statique.
