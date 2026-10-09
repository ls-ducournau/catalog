# Fondations

Source : `../DESIGN.md` (Tokens, Surfaces, Elevation, Do's and Don'ts), corrigée par les
relevés de raycast.com du 2026-09-28. Les jetons Catalog vivent dans `design/tokens.json` ;
`npm run tokens` génère `src/styles/tokens.css` et `src/lib/tokens.ts`.

## Couleurs

Gamme de gris relevée sur raycast.com (variables `--grey-*` du site), et son emploi dans Catalog :

| raycast.com | Valeur | Nom DESIGN.md | Jeton Catalog | Emploi |
|---|---|---|---|---|
| fond de page | `#07080a` | Ink | `--panel`, `--surface-raised` | Fenêtres, panneaux |
| grey-800 | `#0c0d0f` | (absent) | `--surface` (Onyx) | Cartes, tuiles, rails d'onglets, recherche |
| grey-700 | `#111214` | Obsidian | `--surface-2` | Haut des dégradés, champs, appui |
| grey-600 | `#1b1c1e` | Graphite | `--surface-3` | Bas des dégradés, pastilles |
| grey-500 | `#2f3031` | Slate | `--accent-foreground` | Texte du bouton plein (arête de la recherche sur le site) |
| grey-300 | `#6a6b6c` | Smoke | `--subtle` | Icônes, séparateurs, décor seulement |
| grey-200 | `#9c9c9d` | Ash | `--muted`, `--body` | Texte secondaire, indications |
| | `#e6e6e6` | Mist | `--accent` | Fond du seul bouton plein |
| | `#ffffff` | Pure White | `--foreground` | Titres, texte fort |
| | blanc 6 % | | `--card-edge` | Arête des cartes, tuiles, touches |
| | blanc 8 %, 14 %, 24 % | | `--field-edge`, `-hover`, `-focus` | Arête de la recherche : repos, survol, saisie |
| | blanc 40 % | | `--focus` | Anneau de focus clavier (2 px, décalé de 2 px) |
| | blanc 10 % | | `--divider`, arête de la pastille d'onglet | Séparateurs |
| | `#ff6363` | Coral Pulse | `--brand` | Marque seulement |
| palette du site | `#ffc531` | (Sunbeam) | `--rating`, `--score-mid` | Étoile pleine, score moyen ([note-et-score.md](note-et-score.md)) |
| palette du site | `#59d499` | Success Green | `--success`, `--score-high` | Lavis de mise en valeur, bon score |

Écarts assumés :

- **Fond de page** : raycast.com pose `#07080a` ; Catalog garde `#040506` (Void Black de
  DESIGN.md). Les surfaces restent un cran au-dessus du fond, comme sur le site.
- **Arêtes et focus plus discrets que le site** (demande de l'utilisateur, 2026-09-28) :
  recherche en blanc 8 % au lieu de Slate, anneau du bouton sombre à 12 % au lieu de 25 %,
  focus en anneau blanc à 40 % sans halo, champs sans filet à la saisie.
- **Pas de lueurs** (même demande) : pastille d'onglet en voile blanc de 7 à 4 % au lieu du
  dégradé radial à point lumineux ; halo du bouton plein à 8 % sur 10 px (19 % sur 14 px) ;
  reflets du rail et de la barre à 6 et 8 % (10 et 15 %).
- **Texte lisible en Ash, jamais en Smoke** : le Store écrit ses indications et descriptions en
  Smoke (3,6:1) ; Catalog les passe en Ash pour tenir 4,5:1 (axe, AC-5.2).

Principes (DESIGN.md) : page achromatique à 98 % ; aucun bouton de couleur ; le corail est une
marque (logo, décor du héros, badge `brand`), jamais un lien, un texte courant, une icône, une
bordure ou un statut ; vert et bleu en lavis de mise en valeur. **Exception (D6)** : les notes et
les scores portent de la couleur (étoile jaune, anneau vert, jaune ou gris), toujours avec leur
chiffre.

## Texte

Titres (`h1` à `h4`) en **Bricolage Grotesque 600** (`--font-heading`, choix de l'utilisateur,
2026-09-28 ; Raycast emploie Inter partout) : police variable dont l'axe de taille optique donne
le dessin d'affichage aux grands titres. Texte en **Work Sans** (choix de l'utilisateur,
2026-09-28 ; Raycast emploie Inter), réglages `calt`, `kern`, `liga` ; Geist Mono pour les
mentions techniques.
Interlettrage **toujours positif**, même en grand. Plancher de 12 px (DESIGN.md descend à 10 et
11 px : Catalog remonte à 12).

| Jeton | Taille | Interligne | Interlettrage | Relevé raycast.com |
|---|---|---|---|---|
| `text-2xs` | 12 | 16 | 0 | titres de bloc latéral (12/18, 500) |
| `text-xs` | 13 | 20 | 0,008em | onglets de la page d'extension (13/20, 600) |
| `text-sm` | 14 | 20 | 0,014em | boutons (14/16, 500, +0,2 px), liens de la barre |
| `text-base` | 16 | 24 | 0 | corps |
| `text-lg` | 18 | 28 | 0 | précision sous un titre de page |
| `text-subheading` | 20 | 1,2 | 0,01em | titre de section « Featured » (20/23, 500) |
| `text-heading` | 32 | 1,15 | 0 | titre de page sur téléphone |
| `text-heading-lg` | 56 | 1,17 | 0,004em | titre de page (Changelog : 52/55, 600, +0,01em) |
| `text-display` | 64 | 1,1 | 0 | héros |

## Rayons

| Jeton | Valeur | Emploi (relevé) |
|---|---|---|
| `--r-badge` | 6 | badge (Pill du Changelog) |
| `--r-control` | 8 | bouton, champ de formulaire |
| `--r-key` | 11 | grande touche (keycap) |
| `--r-frame` | 12 | recherche, affiche, cadre de fenêtre |
| `--r-card` | 12 | carte (ExtensionCard ; DESIGN.md disait 16) |
| `--r-card-lg` | 20 | carte à arête, fenêtre |
| pastille | 9999 | onglets, puces, compteur |
| clavier | 4 | petite touche (⌘, K) |

## Reliefs

Aucune ombre portée sur une carte ou un panneau.

| Jeton | Valeur | Emploi |
|---|---|---|
| `--shadow-card` | reflet haut blanc 5 % | cartes, tuiles, touches, sous l'arête `--card-edge` |
| `--shadow-key` | reflet haut 5 %, anneau blanc 12 % (site : 25 %), ombre basse 20 % | bouton secondaire |
| `--shadow-key-hover` / `-active` | anneau à 20 % / 8 % (site : 50 % / 15 %) | bouton secondaire survolé, enfoncé |
| `--shadow-button` | cerne noir 2 px, halo blanc 8 % sur 10 px (site : 19 % sur 14), reflets | bouton plein |
| `--shadow-highlight` | reflet haut blanc 10 % | rail d'onglets, carte à arête |
| `--shadow-nav` | reflet haut blanc 8 % (site : 15 %) | barre de navigation, verre |
| `--shadow-keycap` | recette « keycap » | grandes touches (duels, tri) |
| `--shadow-window` | ombre large, arête, reflet | fenêtres flottantes, menus |

Remplissages (variables de `globals.css`, couche `base`) : `--card-fill-hover` (lueur venue du
haut, Obsidian vers Graphite), `--pill-fill` (pastille d'onglet), `--rail-fill` (rail d'onglets,
137°), `--key-fill` (voile du bouton sombre).

## Espacement et mise en page

Grille de 8 : 8, 12, 16, 24, 32, 40, puis 48, 56, 64, 80, 96, 120. Contenu de 1 200 px au plus,
centré. Marge intérieure de carte : 32 sur le Store (24 dans DESIGN.md), fixée à l'appel.
Écart entre cartes vedettes : 32. Entre sections : 80 à 128.
