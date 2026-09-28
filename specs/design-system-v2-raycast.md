# Système de design Catalog v2 (Raycast) : plan

**Statut :** en cours (phases 0 à 2 faites le 2026-09-27, voir § 14)
**Date :** 2026-09-27
**Remplace :** `design-system-v1.md` (référence Eno), à la livraison de la phase 5.
**Référence normative :** `docs/design-reference/raycast/DESIGN.md` (« Raycast — Style
Reference »), à suivre **strictement** (décision de l'utilisateur du 2026-09-27). Le relevé
complémentaire `docs/design-reference/raycast/analyse.md` (cartographie, recettes mesurées,
mouvement, captures) ne sert que là où DESIGN.md se tait. On reprend le langage visuel et la
structure des pages, jamais les textes, logos ni images.
**Marque :** l'app s'appelle **Catalog** depuis le 2026-09-27 (combination mark fournie par
l'utilisateur, `src/components/brand/Logo.tsx`). Le symbole prend le corail de marque de
DESIGN.md (`--logo-mark-from` `#ff6363`), assombri vers le bas (`--logo-mark-to` `#9a151a`)
dans le rapport du dégradé fourni (`#ac3c3c` → `#680d10`, remis en une ligne si besoin).

## 0. Décisions (prises le 2026-09-27)

| # | Question | Décision |
|---|---|---|
| D1 | Couleur principale | **Aucune couleur fonctionnelle**, comme dans DESIGN.md : les actions sont des boutons Mist `#e6e6e6` au texte Iron `#454647`. Le corail `#ff6363` est une marque : logo, visuel du héros, badge IA, fonds teintés `#452324`. Jamais pour un lien, un texte, une icône, une bordure, ni un bouton. |
| D2 | Police | **Inter** 400, 500, 600, avec `calt`, `kern`, `liga`, `ss03` ; **Geist Mono** pour les mentions techniques. |
| D3 | Barre du haut | **La barre de DESIGN.md** : pilule flottante en verre (flou 48 px), bordure `#363739`, rayon 8, marges 8×16 ; liens 13 à 14 px `#9c9c9d`, blanc au survol ; action Mist à droite. |
| D4 | Palette ⌘K | **Plus tard**, dans une spec à part. |

## 1. Contexte

Trois constats :

1. **La référence Eno ne suffit plus.** L'interface reste « cheap » par endroits, et
   l'utilisateur choisit Raycast pour remplacer Eno.
2. **Les rebonds sont partout.** Le 2026-09-27, l'utilisateur écrit : « Enfaite il y a des
   rebonts un peu partout, c'est pas très smart » et demande une stratégie de mouvement propre
   à un système de design.
3. **Les vues se construisent au cas par cas.** L'objectif est de *systématiser la
   production des vues* (DesignOps).

État mesuré le 2026-09-27 :

- **Styles hors système** : 25 tailles de texte arbitraires (`text-[13px]` ×20, alors que
  `text-xs` vaut 13 px) et 13 utilitaires de durée ou de courbe codés en dur.
- **Mouvement** : 13 animations CSS, dont 3 sur une courbe à dépassement (`--ease-bounce`),
  plus `EASE.bounce` dans `RollText`, des ressorts par défaut dans les graphiques Bklit, et un
  flou dans chaque entrée.
- **Valeurs en double** : les jetons de mouvement existent deux fois, dans `globals.css` et dans
  `motion.ts`, sans source commune.
- **Pas de filet de sécurité** : aucune capture de référence, aucun contrôle automatique des
  écarts.

Ce que Raycast apporte, en résumé :

- **Couleur** : 98 % de gris, un corail rare.
- **Matière** : elle vient de reflets en blanc translucide (6, 10, 15, 25 %), pas de la couleur.
- **Boutons et touches** : des boutons clairs à halo, des touches de clavier en relief.
- **Mouvement** : court, sur `cubic-bezier(.23, 1, .32, 1)`, **sans aucun ressort**.
- **Registre produit** : une palette de commandes, avec liste, détail et barre d'actions.

## 2. Principes

1. **Achromatique.** Aucune couleur fonctionnelle ; le corail est la marque, pas un signal.
2. **La matière par la lumière.** Le relief « touche de clavier » (reflet haut, anneau blanc à
   25 %, ombre basse intérieure), jamais d'ombre portée sur une carte.
3. **Un geste, une animation.** Court, sans dépassement, jamais rejoué pour rien.
4. **Composer, pas styler.** Une page assemble un archétype, des sections et des primitives. Elle
   ne définit ni couleur, ni taille, ni durée.
5. **Tout est vérifié par une machine** : contraste, taille minimale, écarts, captures.

## 3. Jetons

### 3.1 Architecture

Une seule source, `design/tokens.json` (format DTCG). `npm run tokens` génère
`src/styles/tokens.css` (variables et `@theme` Tailwind) et `src/lib/tokens.ts` (mouvement pour
GSAP), puis vérifie les contrastes déclarés. Trois niveaux :

```
primitives   couleurs nommées de DESIGN.md (--p-void-black, --p-ash, --p-coral-pulse…)
   ↓
rôles        --background, --surface…, --foreground, --muted, --subtle, --accent, --brand…
   ↓
composants   --shadow-key, --shadow-keycap, --shadow-button, --shadow-window, --r-card…
```

Les pages et les composants n'emploient que des **rôles** ou des jetons de composant, jamais une
primitive. Les noms de rôles de la v1 sont gardés : la bascule des valeurs a migré l'essentiel de
l'app d'un coup.

### 3.2 Rôles (valeurs de DESIGN.md)

| Rôle | Valeur | Nom DESIGN.md | Emploi |
|---|---|---|---|
| `--background` | `#040506` | Void Black | Seul fond de page |
| `--surface`, `--panel`, `--surface-raised` | `#07080a` | Ink | Cartes, fenêtres, panneaux |
| `--surface-2`, `--surface-hover` | `#111214` | Obsidian | Champs, appui, survol |
| `--surface-3` | `#1b1c1e` | Graphite | Badges, tuiles |
| `--field`, `--card-hover` | blanc 5 % | | Champ en creux, survol de carte |
| `--border`, `--surface-border`, `--input` | `#363739` | | Arête de la barre, des cartes, des champs |
| `--line-strong`, `--focus-ring` | blanc 25 % | | Anneau de la touche, focus |
| `--foreground` | `#ffffff` | Pure White | Titres, texte fort |
| `--body`, `--muted` | `#9c9c9d` | Ash | Texte secondaire, corps (7,4:1) |
| `--subtle` | `#6a6b6c` | Smoke | Libellés discrets (**3,2 à 3,8:1, exception assumée**, NFR-3) |
| `--disabled-foreground` | `#454647` | Iron | Désactivé |
| `--accent` / `--accent-foreground` | `#e6e6e6` / `#454647` | Mist / Iron | Seul bouton plein (7,6:1) |
| `--brand` | `#ff6363` | Coral Pulse | Marque seulement |
| `--brand-tint` | `#452324` | Ember Hush | Fond teinté de marque |
| `--info`, `--success` | `#56c2ff`, `#59d499` | Info Blue, Success Green | Lavis de mise en valeur, pas des statuts |
| `--chart-1…5` | Mist, Ash, Smoke, Iron, Slate | | Graphiques : rampe de gris, un seul ton |

### 3.3 Typographie (Inter, plancher 12 px)

| Classe | Taille / interligne | Interlettrage | Emploi DESIGN.md |
|---|---|---|---|
| `text-2xs`, `text-eyebrow` | 12 / 16 | 0 ; 0,073 em en capitales | Surtitre (11 px dans DESIGN.md, relevé à 12) |
| `text-xs` | 13 / 20 | 0,008 em | Liens de barre, libellés de carte |
| `text-sm` | 14 / 20 | 0,014 em | Libellés, boutons (500) |
| `text-base`, `text-body` | 16 / 24 (1,6 en paragraphe) | 0 | Corps (400) |
| `text-lg` | 18 / 28 | 0 | Corps large |
| `text-xl`, `text-subheading` | 20 / 24 | 0,01 em | Sous-titres |
| `text-2xl`, `text-heading-sm` | 24 / 1,15 | 0 | Titre de section |
| `text-3xl`, `text-heading` | 32 / 1,15 | 0 | Titre de page |
| `text-heading-lg` | 56 / 1,17 | 0,004 em | Héros, en graisse 400 |
| `text-display` | 64 / 1,1 | 0 | Affichage, 600 |

Graisses 400, 500, 600. **Jamais d'interlettrage négatif**, même en grand (règle d'audit).
Geist Mono 12 px pour les mentions techniques, séparées par des barres verticales.

### 3.4 Forme, relief, espace

- **Rayons** : badge 6 ; bouton et champ 8 ; touche 11 ; carte 16 ; grande carte 20 ; pastille
  9999 ; conteneur d'icône en cercle. Les classes Tailwind s'y rangent : `rounded-xs` et `sm`
  valent 6, `md` et `lg` valent 8, `xl` et `2xl` valent 16, `3xl` et `4xl` valent 20.
- **Reliefs** (jetons de composant) :
  - `--shadow-key` : toutes les cartes et blocs en relief ;
  - `--shadow-keycap` : touches ;
  - `--shadow-button` : bouton d'action ;
  - `--shadow-highlight` et `--shadow-nav` : reflets intérieurs ;
  - `--shadow-window` : fenêtres flottantes, dialogues, menus.
  Aucune ombre portée sur une carte ou un panneau.
- **Espacement** : grille de 8 (8, 12, 16, 24, 40, puis 48, 56, 64, 80, 96, 120) ; marge
  intérieure de carte 24 ; écart entre éléments 8 à 16 ; entre sections 80 à 120.
- **Mise en page** : contenu de 1 200 px au plus, centré ; grilles de 3 colonnes pour les tuiles
  compactes, 2 pour les blocs larges.

## 4. Mouvement : la stratégie

La recherche s'appuie sur trois sources :

- **Carbon** : deux registres, *productif* et *expressif*.
- **Material 3** : des jetons de durée et de courbe par rôle.
- **Emil Kowalski** (skill design-taste) : pas d'animation sur une action répétée au clavier,
  moins de 300 ms, `transform` et `opacity` seulement.

Le relevé de Raycast (analyse § 6) confirme ce registre : aucun ressort, des courbes « out »,
100 à 400 ms.

### 4.1 Jetons

| Jeton | Valeur | Emploi |
|---|---|---|
| `--dur-instant` | 100 ms | Appui (`scale(.97)`), touche enfoncée |
| `--dur-fast` | 200 ms | Survol, couleur, ombre, focus |
| `--dur-base` | 300 ms | Menus, onglets, infobulles, notifications, pastille glissante |
| `--dur-slow` | 400 ms | Dialogues, feuilles, Flip de grille (plafond absolu) |
| `--ease-out` | `cubic-bezier(.23, 1, .32, 1)` | Entrées, déplacements |
| `--ease-standard` | `cubic-bezier(.25, .1, .25, 1)` | Couleurs, opacités d'état |
| `--stagger` | 30 ms, 8 éléments au plus | Cascade d'arrivée |
| `--enter-y` | 8 px | Entrée |
| `--enter-scale` | 0,96 (dialogue), 0,97 (menu, depuis son déclencheur) | Entrée |

La même source produit les variables CSS et les constantes GSAP (`src/lib/tokens.ts`). Il n'y a
plus de double saisie.

### 4.2 Règles

1. **Aucun dépassement.** Aucune courbe dont un point de contrôle dépasse 1, aucun ressort, pas
   de `back` ni d'`elastic`. Les graphiques Bklit reçoivent
   `enterTransition={{ type: "tween", duration: .4, ease: [.23, 1, .32, 1] }}`.
2. **Rien ne se rejoue.** Changer de vue, de filtre ou d'onglet, c'est un fondu du contenu de
   150 ms, sans cascade, sans retitrage. C'est la cause des « rebonds » : la cascade et la
   révélation du titre se relançaient à chaque changement.
3. **La cascade est réservée à la première arrivée** d'une liste : 8 éléments au plus, 30 ms
   d'écart, 400 ms au total. Les suivants apparaissent directement.
4. **Actions répétées au clavier** (duels 1, 2, 3 ; tri rapide) : le résultat ne s'anime pas.
   Seule la touche affichée s'enfonce, en 100 ms.
5. **Réagencements** (tri, filtre, statut) : Flip de 400 ms en `--ease-out`, jusqu'à 120
   éléments. Au-delà, pas d'animation.
6. **`transform` et `opacity` seulement.** On retire le flou des entrées : Raycast n'en met pas,
   et il coûte en peinture.
7. **Les nombres** défilent en 300 ms en `--ease-out`, sans ressort.
8. **Mouvement réduit** : opacité seule, 150 ms au plus, ni Flip ni cascade.
9. **Registre expressif**, deux endroits seulement : la première arrivée sur l'Accueil et la
   suggestion de Ce soir. Il reste sans dépassement.

### 4.3 Préréglages GSAP

Les composants appellent des effets enregistrés (`gsap.registerEffect`), jamais un tween
brut :

| Effet | Rôle |
|---|---|
| `enter` | Entrée, cascade |
| `swap` | Fondu de changement de vue |
| `flipTo` | Réagencement |
| `count` | Nombres |
| `press` | Appui (en CSS) |

Une règle ESLint interdit `gsap.to`, `gsap.from` et `gsap.fromTo` hors de `src/lib/motion.ts` et
de `src/components/motion/`.

### 4.4 Écarts actuels à corriger (phase 1)

- `--ease-bounce` (`globals.css`) : dans la transition des boutons, dans `toast-in` et dans
  `tab-pop`.
- `EASE.bounce` dans `RollText.tsx`, et `CustomEase.create("bounce")` dans `motion.ts`.
- Les animations `star-pop` et `worst-wobble`.
- Le flou de `ENTER_FROM`.
- La révélation mot à mot des titres (`PageHeader`) : on la garde pour l'Accueil seulement.
- Les ressorts par défaut des graphiques Bklit.
- Les 13 utilitaires Tailwind `duration-*` et `ease-*`.

### 4.5 Micro-interactions reprises de Raycast

| Micro-interaction | Chez Raycast | Dans Catalog |
|---|---|---|
| Touche enfoncée | Relief puis creux, 200 ms | Touches 1, 2, 3 des duels, ↵ et ⌘K, 100 ms |
| Halo du bouton principal | 14 px de blanc à 19 % | Bouton principal, s'intensifie au survol |
| Pastille d'onglet | Couleur en 300 ms | Contrôle segmenté (déjà glissant, courbe à aligner) |
| Balayage de recherche (`nightRider`) | Reflet d'un bord à l'autre | Recherche TMDB en cours, dans « Ajouter un titre » |
| Fenêtre qui apparaît (`contentShow`) | 10 px et 0,96 | Dialogues, palette, lecteur de bande-annonce |
| Infobulle du dock | Pastille sombre | Boutons-icônes (réglages, ajout, flèches de rangée) |
| Bordure qui s'éclaire | Captures au survol | Affiches au survol : filet blanc à 25 % |
| Scintillement | Chargement | Squelettes (existe, à aligner) |

## 5. Composants (primitives, `src/components/ui/`)

Chaque primitive a ses 8 états : repos, survol, focus, appui, désactivé, chargement, erreur,
succès. Colonne « Reprise » : **1:1** reprend la recette mesurée ; **inspiration** l'adapte.

| Primitive | Variantes | Modèle Raycast | Reprise |
|---|---|---|---|
| `Button` | primary (Mist, texte Iron, `--shadow-button`), secondary (relief touche), ghost, icon ; rayon 8 ; 32, 36, 40 (40, 44 au doigt) | Download ; DESIGN.md « Neutral Filled Button » | 1:1. Destructif : même bouton neutre, le libellé dit l'action (pas de bouton de couleur). |
| `SplitButton` | primaire et menu | Install Extension et chevron | 1:1 (fiche : « Je regarde ça » et statuts) |
| `Keycap` | sm 20 (barres), lg (démonstration) | Touches | 1:1 |
| `Badge` | Graphite `#1b1c1e`, texte blanc, rayon 6, marges 0×6 ; compteur ; badge de marque (corail) réservé à l'IA | DESIGN.md « Badge Tag » | 1:1, relevé à 12 px |
| `Chip` | filtre, sélectionnable | Puces 13 px | Inspiration (r 6, h 32) |
| `Tabs` | pastille, soulignée | Onglets d'extension et du changelog | 1:1 |
| `SearchField` | ⌘K, en cours (balayage) | Recherche du Store | 1:1 |
| `Menu`, `Select` | | Lignes de la palette | Inspiration |
| `Card` | défaut (filet), vedette (centrée), dégradé 137°, média (affiche) | Store, tarifs | 1:1 |
| `IconTile` | cercle, marge 20, fond sombre | DESIGN.md « Circular Icon Container » | 1:1 (plateformes, personnes) |
| `MetaRow` | séparateurs verticaux | Auteur, installations | 1:1 |
| `ListRow` | icône, titre, sous-titre, accessoires, sélection | Palette | 1:1 |
| `ActionBar` | action principale et touche, « Actions ⌘K » | Palette | 1:1 |
| `Tooltip` | | Dock | 1:1 |
| `Dialog`, `AlertDialog` | | `contentShow` | 1:1 pour le mouvement |
| `Toast` | avec « Annuler » | | Inspiration |
| `Avatar` | 20, 32, 48 | Contributeurs | 1:1 |
| `Divider` | horizontal, vertical | Blanc 10 % | 1:1 |
| `Skeleton` | | `shimmer` | 1:1 |
| `Switch` | | Interrupteurs | Inspiration |
| `NavBar`, `Dock` | pilule en verre (flou 48 px, bordure `#363739`, rayon 8, 8×16), onglets du bas | DESIGN.md « Glass Navigation Bar » | 1:1 (D3) |

Écriture : recettes CSS dans `@layer components` ; composants React aux variantes typées (`cva`,
déjà compatible avec shadcn et Bklit). Les pages n'emploient plus de classe `btn` à la main.

## 6. Sections (`src/components/sections/`)

| Section | Anatomie | Modèle |
|---|---|---|
| `PageHero` | Titre, accroche, actions, halo en option | Accueil, Store |
| `Toolbar` | Onglets à gauche ; filtres et recherche ⌘K à droite | Barre du Store |
| `FeaturedRow` | 3 cartes centrées | « Featured » |
| `MediaGrid` | Grille d'affiches (FlipGrid) | Liste du Store |
| `MediaRow` | Rangée défilante et flèches en verre | |
| `TimelineSection` | Colonne gauche collante (badge, date) ; contenu à droite | Changelog |
| `DetailHeader` | Tuile ou affiche, titre, résumé, `MetaRow`, `SplitButton` | Page d'extension |
| `InfoTable` | Lignes libellé et valeur, filets | Panneau « Information » |
| `CommandWindow` | Fenêtre r 16 : champ, liste, détail, `ActionBar` | Palette |
| `SummaryCards` | Cartes en dégradé, listes, badges | Tarifs |
| `EmptyState` | Tuile, phrase, action | |
| `ShardsBackdrop` | Éclats en image statique | Héros de l'accueil |

## 7. Archétypes de vues (`src/components/layouts/`)

| Archétype | Modèle Raycast | Vues de Catalog |
|---|---|---|
| `HeroLayout` | Accueil | Accueil (`/`), Ce soir |
| `CatalogLayout` | Store | Bibliothèque, Recommandations, Classement |
| `DetailLayout` | Page d'extension | Fiche d'un titre (`DetailPanel`), fiche d'une personne |
| `TimelineLayout` | Changelog | Sorties |
| `CommandLayout` | Palette de commandes | Duels, Tri rapide, Ajouter un titre, palette ⌘K (D4) |

Correspondance détaillée :

| Vue | Archétype | Sections |
|---|---|---|
| Accueil | Hero | `ShardsBackdrop`, `PageHero` (Catalog, « Ce soir », touches de raccourci), `MediaRow` « Ma pile » |
| Ce soir | Hero | `PageHero` compact, filtres en colonne, suggestion en `Card` dégradé, `MediaRow` « Ou plutôt » |
| Bibliothèque | Catalog | `PageHero`, `Toolbar` (statut, filtres, recherche ⌘K), `MediaGrid` |
| Recommandations | Catalog | `PageHero`, `FeaturedRow` (3 titres), `Toolbar` (sources), `MediaRow` ; profil de goûts en `SummaryCards` avec radar et anneau Bklit |
| Classement | Catalog | `Toolbar`, liste en `ListRow` numérotées ; vue Personnes avec `Avatar` et note |
| Sorties | Timeline | Onglets (type), horizon en `Select`, `TimelineSection` par semaine : date à gauche, cartes à droite |
| Duels | Command | `CommandWindow` avec deux cartes ; `ActionBar` : 1, 2 et 3 en touches |
| Tri rapide | Command | `CommandWindow`, pile de cartes, `ActionBar` avec touches |
| Fiche d'un titre | Detail | `DetailHeader`, onglets (Aperçu, Distribution, Où regarder), bande-annonce et images, `InfoTable` en colonne |
| Ajouter un titre | Command | `SearchField` (balayage), `ListRow` des résultats TMDB, aperçu, `ActionBar` « Ajouter ↵ » |

## 8. DesignOps

### 8.1 Chaîne des jetons

`design/tokens.json` → `scripts/build-tokens.mjs` → `src/styles/tokens.css` (variables et
`@theme` Tailwind, fichier généré, jamais édité à la main) et `src/lib/tokens.ts` (durées et
courbes pour GSAP). `npm run tokens`. `globals.css` garde les recettes de composants et importe
`tokens.css`.

### 8.2 Bibliothèque

Trois étages : `ui/` (primitives), `sections/`, `layouts/` (archétypes). Une page choisit un
archétype, compose des sections et n'ajoute que de la mise en page (`flex`, `grid`, écarts de
l'échelle).

### 8.3 Guide vivant `/design`

- Les jetons, avec contraste calculé en direct.
- L'échelle typographique.
- Chaque primitive dans ses 8 états.
- Les sections et les archétypes (vignettes).
- Les préréglages de mouvement, avec « Rejouer ».
- Un sélecteur des candidates de D1, qui repeint l'app à côté du symbole.

Le guide sert aussi de cible aux captures de référence.

### 8.4 Garde-fous

`npm run ds:audit` compte les écarts et échoue si un compte dépasse la ligne de base
(`design/audit-baseline.json`, qui ne peut que baisser). Il compte :

- les tailles arbitraires ;
- les couleurs `#…` ou `rgb(…)` dans le TSX ;
- les utilitaires `duration-*` et `ease-*` ;
- les courbes à dépassement ;
- les textes de moins de 12 px ;
- les classes `btn` hors de `ui/` ;
- les tweens GSAP hors des préréglages.

Côté ESLint, une règle `no-restricted-syntax` couvre GSAP. `npm run check` enchaîne `tsc`,
ESLint, Vitest et `ds:audit`.

### 8.5 Régression visuelle

Playwright (`tests/visual/`), selon le skill playwright-pro :

- **Couverture** : 10 écrans à 3 largeurs (390, 834, 1440), mouvement réduit, animations
  coupées.
- **Données fixes** : base de démonstration via une variable d'environnement (`db.ts` a
  aujourd'hui un chemin fixe, il faut ajouter la surcharge).
- **Affiches masquées**, puisqu'elles viennent du réseau.
- **Tolérance** : 1 % de pixels, pour la page `/design` seulement (phase 3). Les 10 écrans
  tournent sur les données réelles : leurs captures sont des références à relire d'une phase à
  l'autre, pas des assertions au pixel (précision de la phase 0).

### 8.6 Accessibilité

Skill a11y-audit :

- `contrast_checker.py` sur chaque couple de jetons texte et surface réellement employé ;
- `a11y_scanner.py` sur `src/` ;
- axe (`@axe-core/playwright`) sur chaque écran, avec zéro violation grave ou critique.

### 8.7 Skill projet `catalog-design-system`

Fichier `.claude/skills/catalog-design-system/SKILL.md`. Il contient :

- les principes, les jetons et leurs rôles ;
- les archétypes et sections ;
- les préréglages de mouvement et leurs règles ;
- la marche à suivre pour produire une vue (§ 8.8).

Toute session et tout agent qui construit une vue le charge. **C'est ce qui systématise la
production.**

### 8.8 Produire une vue

1. Choisir l'archétype (§ 7) ; un besoin qui n'y entre pas se discute avant le code.
2. Composer les sections, puis écrire les états vides, d'erreur et de chargement.
3. Mouvement : préréglages seulement.
4. Nouveau composant : il entre dans `ui/` et dans `/design`, avec ses 8 états.
5. Lancer `npm run check`, puis prendre les captures de référence et passer axe.
6. Pré-vol design-taste (`reference/pre-flight.md`).

## 9. Skills et agents par phase

Chemins sous `.claude/skills/claude-skills/` :

- `product-team/skills/ui-design-system`
- `product-team/skills/ux-researcher-designer`
- `engineering-team/skills/senior-frontend`
- `engineering-team/a11y-audit`
- `engineering-team/playwright-pro`
- `engineering-team/skills/adversarial-reviewer`
- agents : `agents/engineering/cs-frontend-engineer.md` et `agents/product/cs-ux-researcher.md`

| Phase | Skills | Agents |
|---|---|---|
| 0. Ligne de base | playwright-pro (`pw-init`, `generate`), a11y-audit (`a11y_scanner.py`), designlang (fait) | |
| 1. Mouvement | gsap-core, gsap-timeline, gsap-react, gsap-performance, design-taste (`motion.md`), bklit-ui (`animation.md`) | |
| 2. Jetons | ui-design-system (`design_token_generator.py`, contrôle de l'échelle), a11y-audit (`contrast_checker.py`), dataviz (`validate_palette.js` pour `--chart-*`) | |
| 3. Primitives et `/design` | senior-frontend (`component_generator.py`), design-taste (`interaction-states.md`) | cs-frontend-engineer, un lot de primitives par agent, en worktree |
| 4. Sections et archétypes | senior-frontend, design-taste | cs-ux-researcher : revue des correspondances vue et archétype, et des parcours |
| 5. Vues | bklit-ui et dataviz (profil de goûts), gsap-react | cs-frontend-engineer ×2 ou 3 en parallèle, une vue chacun, en worktree |
| 6. Garde-fous | playwright-pro (`pw-review`, `report`), a11y-audit, senior-frontend (`bundle_analyzer.py`) | adversarial-reviewer : revue finale |
| 7. Signatures (D4) | gsap-react | |

## 10. Phases et critères d'acceptation

Chaque phase se termine par `npm run check` au vert et par une revue des captures avec
l'utilisateur.

**Phase 0 : ligne de base.**

- **AC-0.1** : `npm run test:visual` crée les références des 10 écrans aux 3 largeurs.
- **AC-0.2** : `npm run ds:audit` écrit la ligne de base (25 tailles arbitraires, 13
  utilitaires, 3 courbes à dépassement, etc.).

**Phase 1 : mouvement.** C'est elle qui corrige les rebonds.

- **AC-1.1** : `src/` ne contient plus aucune courbe à dépassement ni aucun ressort, graphiques
  Bklit compris.
- **AC-1.2** : après un changement de vue (contrôle segmenté du Classement), rien ne cascade ni
  ne monte : des fondus de 150 ms au plus, et la pastille qui glisse. Un filtre qui réordonne une
  grille relève de la règle 5 (Flip), pas de ce critère.
- **AC-1.3** : après la touche 1 d'un duel, aucune animation de plus de 150 ms, et aucun
  déplacement.
- **AC-1.4** : en mouvement réduit, toutes les animations sont des opacités de 150 ms au plus.
- **AC-1.5** : la règle ESLint sur GSAP passe.

**Phase 2 : jetons et police.**

- **AC-2.1** : `npm run tokens` génère `tokens.css` et `tokens.ts`. Relancé, il ne change rien.
- **AC-2.2** : chaque couple texte et surface employé atteint 4,5:1 (3:1 pour 18 px et plus,
  les icônes et les contours de contrôle).
- **AC-2.3** : sur les 10 écrans, aucun texte rendu sous 12 px (relevé Playwright de tous les
  nœuds texte).
- **AC-2.4** : police servie par `next/font`, CLS inférieur à 0,05.
- **AC-2.5** : le corail ne sert qu'à la marque : la règle d'audit `corail-hors-marque` a sa ligne de base en phase 2 et tombe à 0 en phase 5.

**Phase 3 : primitives et `/design`.**

- **AC-3.1** : chaque primitive paraît dans `/design` dans ses 8 états, avec une capture de
  référence.
- **AC-3.2** : l'ombre calculée du bouton principal est celle de la recette mesurée.
- **AC-3.3** : le focus clavier est visible sur chaque primitive (contraste de 3:1 au moins).
- **AC-3.4** : plus aucun `text-[…]` ni `btn btn-…` hors de `ui/`.

**Phase 4 : sections et archétypes.**

- **AC-4.1** : les 5 archétypes et les 12 sections sont documentés sur `/design`, avec leur
  vignette.
- **AC-4.2** : chaque `page.tsx` importe exactement un archétype.

**Phase 5 : vues.**

- **AC-5.1** : chaque vue suit la correspondance du § 7.
- **AC-5.2** : axe ne relève aucune violation grave.
- **AC-5.3** : les captures sont validées par l'utilisateur.
- **AC-5.4** : le profil de goûts est dessiné en radar et en anneau, avec `--chart-*` validés par
  `validate_palette.js` sur `#111214`.
- **AC-5.5** : la fiche d'un titre suit l'anatomie de la page d'extension.

**Phase 6 : garde-fous.**

- **AC-6.1** : `ds:audit` est à zéro, hors exceptions listées dans la ligne de base.
- **AC-6.2** : la suite de régression passe.
- **AC-6.3** : une vue construite par un agent qui suit le skill projet passe `check` et axe
  sans retouche.
- **AC-6.4** : le JavaScript chargé au premier affichage de chaque route augmente de 10 % au plus
  par rapport à la phase 0.

**Phase 7 : signatures (si D4).** Palette ⌘K globale, panneau d'actions ⌘K sur une fiche, touches
affichées dans les duels et le tri rapide. Elle aura sa propre spec.

## 11. Exigences non fonctionnelles

- **NFR-1** : un changement de filtre dans la Bibliothèque (1 066 titres) répond en moins de
  200 ms, jusqu'au prochain affichage.
- **NFR-2** : aucune tâche de plus de 50 ms pendant un Flip de 120 cartes.
- **NFR-3** : WCAG 2.2 AA, texte de 12 px au moins, cibles de 44 px au doigt. Exception assumée : Smoke `#6a6b6c` (`--subtle`, 3,2 à 3,8:1), imposé par DESIGN.md pour les libellés discrets ; réservé aux mentions secondaires, jamais à une information seule.
- **NFR-4** : polices hébergées par l'app (`next/font`), aucune requête de police à l'usage.
- **NFR-5** : la chaîne du système de design ne touche jamais Notion.

## 12. Cas limites

- **EC-1** : `backdrop-filter` absent ou lent : fond opaque `--panel` à 95 %.
- **EC-2** : affiche claire sous la barre en verre : le dégradé de 75 à 90 % garde la barre
  lisible.
- **EC-3** : `prefers-reduced-transparency` : surfaces opaques.
- **EC-4** : `forced-colors` : les contours de Raycast sont des ombres et disparaissent ; chaque
  contrôle garde une bordure transparente, que le mode rend visible.
- **EC-5** : images TMDB absentes pendant les captures : masquées.
- **EC-6** : libellés français longs à 390 px (« Bibliothèque », « Recommandations ») : libellés
  courts existants.

## 13. Hors périmètre

- **Thème clair** : Raycast n'en a pas sur son site.
- **Textes et images de Raycast.**
- **Nouvelles fonctions**, hors D4.
- **Notion.**
- **Rust.** Plus tard : la fluidité perçue se joue dans le navigateur (mise en page, peinture,
  JavaScript chargé), là où Rust n'intervient pas. Il ne servirait que pour une coquille de
  bureau (Tauri) ou des calculs lourds en WebAssembly. On en reparle, mesures en main, après la
  phase 6.

## 14. Avancement

**Phase 0 : faite le 2026-09-27.**
- Playwright avec le Chrome installé (`playwright.config.ts`) ; téléphone 390, tablette 834,
  ordinateur 1440.
- `npm run test:visual` : 30 captures dans `tests/visual/captures/<série>/` (non versionnées,
  données personnelles), avec pour chaque écran un relevé axe et des textes sous 12 px.
- Filet `tests/securite.ts` : toute requête `/api` autre qu'une lecture est bloquée ; le résultat
  d'un duel reçoit une réponse simulée.
- `npm run ds:audit` et `design/audit-baseline.json` ; `npm run check` enchaîne `tsc`, ESLint,
  Vitest et l'audit.
- Ligne de base : 0 texte sous 12 px. axe, violations graves :
  - `nested-interactive` : cartes cliquables qui contiennent des boutons, dans la Bibliothèque,
    la fiche, l'ajout et les Recommandations ;
  - `target-size` : étoiles de notation trop petites ;
  - `color-contrast` : 28 nœuds dans Sorties ;
  - `aria-hidden-focus` : 1 dans le Tri rapide.
  À traiter en phases 3 et 5 (AC-5.2).

**Phase 1 : faite le 2026-09-27.**
- `src/lib/motion.ts` : jetons du § 4.1, courbes `out` et `standard`, préréglages `enter`,
  `swap` et `slide` (`gsap.registerEffect`), plus de `bounce` ni de SplitText.
- `globals.css` : variables `--dur-*` et `--ease-*` ; plus de flou ni de dépassement dans les
  animations (`content-show` reprend le 10 px et 0,96 de Raycast) ; appui en 100 ms ; étoiles
  posées sans rebond ni rotation.
- `MotionRoot` : cascade à la première arrivée d'une page seulement, fondu de 150 ms après un
  geste.
- `PageHeader` : entrée simple, fondu quand le titre change.
- Règle ESLint : pas de tween GSAP hors des préréglages.
- `npm run test:motion` : AC-1.2, AC-1.3 (duel simulé), règle 3 et AC-1.4 passent.
- Audit : courbes à dépassement 7 → 0, tweens hors préréglages 6 → 0.
- Graphiques Bklit : pas encore employés. Ils recevront `enterTransition` en phase 5.

