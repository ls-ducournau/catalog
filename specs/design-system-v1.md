# Système de design Fauteuil — v1

**Statut :** livré le 2026-09-26 (demandes de l'utilisateur du 2026-09-26 : « encore un peu cheap »,
puis « il faut vraiment copier enobase.com, ui kit, layout, composant, design language »)
**Date :** 2026-09-26
**Référence :** enobase.com/fr, /company, /design-partners, /industry-cofounders : le langage visuel
(kit, mise en page, composants), jamais les contenus, le logo ni les images.

## 1. Contexte

Après le passage à une palette neutre (étape 1), l'utilisateur trouve l'interface « encore un peu
cheap comparée à un outil comme Eno : les boutons, les interactions, les arrondis, les bordures,
les menus de sélection, les variantes de composants à harmoniser comme les cartes de titre ». Il
souhaite aussi des micro-animations avec GSAP.

L'inventaire du 2026-09-26 le confirme : 54 styles distincts pour 63 boutons à classe fixe (112
boutons au total), six hauteurs de bouton, cinq arrondis de carte, une dizaine de bordures, une
dizaine de façons de dessiner une affiche, 23 textes sous 12 px.

Ce qui fait la qualité d'Eno : une seule famille (Geist), des gris neutres, des lignes fines et
translucides, des surfaces qui s'étagent, des pilules à reflet intérieur, beaucoup d'air, et des
contrôles qui ont tous la même hauteur.

## 2. Exigences fonctionnelles

- **FR-1** (jetons, relevés sur Eno en thème sombre, 2026-09-27) — Toute l'interface DOIT tirer ses
  valeurs des rôles de gris d'Eno (table complète : `docs/design-reference/enobase/
  analyse-neutres-composants.md`) : page `#0a0a0a`, panneau `#0f0f0f`, carte et menu `#171717`,
  puce `#262626`, appui `#404040`, survol `#262626` à 50 %, carte survolée blanc 10 %, champ blanc
  4 % ; texte `#fafafa` / `#d4d4d4` / `#a1a1a1` / `#737373` ; bordures `#282828` (trame, cartes),
  `#2e2e2e` (menus), `#343434` (champs), `#404040` (forte) ; focus blanc et halo blanc 10 % ; voile
  noir 72 %. Échelles d'Eno : arrondis 5, 6, 8, 10, 14, 18, 22, 26 ; texte `text-2xs` 12,
  `text-xs` 13, `text-md` 15 ; graisses 450 (`medium`) et 510 (`semibold`). Rouge de marque pour
  les signaux seulement ; aucune couleur de marque d'Eno.
- **FR-2** (bouton) — Un bouton DOIT être l'une de ces variantes : `primary` (`#e5e5e5`, avec au
  besoin la pastille ronde à flèche), `secondary` (`#262626`, appui `#404040`), `outline`, `ghost`,
  `glass` (blanc 10 %, liseré, flou : barre du haut, flèches de rangée) ou `overlay` (sur une
  affiche) ; tailles `sm` 28, `md` 32, `lg` 38 px à la souris, 32, 40, 44 px au doigt. À libellé :
  pilule ; icône seule : 8 px (pilule en `glass` et `overlay`). États : repos, survol, focus
  (contour blanc et halo), pression, désactivé. Étiquettes (`badge`) : 6 px, 13 px/450, blanc 5 %.
- **FR-3** (puce) — Les choix à bascule DOIVENT partager la puce : liseré au repos, fond `#262626`
  une fois choisie.
- **FR-4** (choix exclusif) — Rail `#171717` à liseré ; l'option choisie est une pastille claire
  (`#e5e5e5`), qui glisse d'une option à l'autre. Variante discrète sans rail (catégories).
- **FR-5** (menus, champs, notifications) — Menus : `#171717`, bordure `#2e2e2e`, ombre « raised »,
  8 px, lignes de 32 px (40 au doigt) arrondies à 6 px, coche pour la valeur choisie. Champs : fond
  blanc 4 %, bordure `#343434`, focus blanc et halo. Notifications : pilule `#171717`, ombre
  « floating ». Dialogues : voile noir 72 %.
- **FR-6** (carte de titre) — Toute affiche DOIT suivre la même anatomie : image 2:3 arrondie à
  14 px avec un liseré intérieur, pastilles superposées d'un seul style, actions en boutons
  `overlay`, légende dessous (titre 14 px graisse 450, détails 13 px). Pas de boîte autour.
- **FR-7** (lisibilité) — Aucun texte sous 12 px (préférence de l'utilisateur) ; pas d'étiquettes
  en capitales espacées (sauf jours du calendrier et tampon du tri).
- **FR-8** (micro-animations, GSAP) — Le mouvement DOIT suivre celui d'Eno : entrée en opacité,
  montée de 8 à 12 px et flou de 3 px qui se dissipe, courbe `(.22,1,.36,1)`, cascades de 40 ms ;
  rebond `(.34,1.36,.64,1)` pour les petits « pops » ; couleurs en 150 ms `(.4,0,.2,1)`. Sont
  animés : l'apparition des grilles et rangées, la révélation mot à mot des titres de page, la
  réorganisation des grilles quand un filtre change (FLIP, 120 éléments au plus), la pastille des
  sélecteurs, la pastille qui suit le lien survolé de la barre du haut, l'onglet actif du bas, le
  statut « Vu / À voir » qui roule, les chiffres de compatibilité qui défilent, l'ouverture des
  menus, dialogues et notifications, le reflet des squelettes. Aucune animation NE DOIT retarder
  une action clavier ; seuls la transformation, l'opacité et un flou léger (≤ 6 px) sont animés.
- **FR-9** (mise en page d'Eno) — Les pages DOIVENT vivre dans une colonne de 1352 px bordée de
  traits verticaux (ordinateur) ; un en-tête de section (titre en deux tons à gauche, 40 px ;
  description à droite, 16 px `#d4d4d4` ; actions sous le titre) suivi d'un trait pleine largeur.
  La barre du haut : logo, liens en 13 px, séparateur, réglages en pilule translucide, action
  principale « Ce soir → ». Les cadres (26 px, 8 px de marge, panneau de 18 px) portent les
  éléments phares (proposition de Ce soir) ; les tuiles, les listes d'objets (« Ou plutôt »).

## 3. Exigences non fonctionnelles

- **NFR-1** — Mouvement réduit : aucune animation de déplacement ; les changements d'état restent.
- **NFR-2** — Focus clavier visible sur tout élément interactif (contour 2 px, décalé de 2 px).
- **NFR-3** — Contrastes : texte ≥ 4,5:1 ; le rouge de marque reste lisible sur fond et carte.
- **NFR-4** — GSAP n'est chargé que côté client, par les composants qui l'utilisent.

## 4. Critères d'acceptation

- **AC-1** (FR-7) — Given le code de l'interface, When on cherche `text-[9px]`, `text-[10px]`,
  `text-[11px]`, Then il n'y en a aucun.
- **AC-2** (FR-2) — Given un bouton à fond plein, When on lit sa classe, Then c'est `btn` avec
  une variante et une taille, jamais un assemblage à la main.
- **AC-3** (FR-1) — Given les arrondis de l'interface, When on les recense, Then leurs valeurs
  appartiennent à l'échelle d'Eno : 6, 8, 10, 14, 18, 22, 26 px ou pilule.
- **AC-4** (FR-8, NFR-1) — Given le mouvement réduit, When une grille apparaît, Then elle
  apparaît sans déplacement.

## 5. Précisions de mise en œuvre

- Valeurs relevées le 2026-09-26 dans les styles calculés des quatre pages (titres, boutons,
  surfaces, trame, variables de la racine), et non estimées à l'œil.
- Classes du système dans `globals.css` (`btn`, `chip`, `segmented`, `menu-panel`, `menu-item`,
  `card`, `bezel`, `tile`, `overlay-pill`, `poster`, `frame`, `rule`, `link`) ; l'échelle
  d'arrondis de Tailwind est redéfinie, ce qui range toutes les classes `rounded-*` existantes.
- `PageHeader` remplace les titres de page ; 67 boutons convertis par script, les autres à la main.
- Mouvement (2026-09-27) : skills officiels de GreenSock installés dans `.claude/skills/gsap-*`
  (MIT, Markdown seul) ; `@gsap/react` et `useGSAP()` partout (nettoyage automatique, portée,
  `contextSafe`), extensions CustomEase, Flip et SplitText enregistrées une fois (`lib/motion.ts`).
  Composants : `MotionRoot`, `PageHeader`, `SegmentedControl`, `motion/FlipGrid`,
  `motion/RollText`, `motion/NumberRoll` ; la barre du haut (`TopLinks`).
- GSAP 3.15 (`gsap`), chargé par les seuls composants clients qui l'importent : `MotionRoot`
  (cascades, via `data-stagger`) et `SegmentedControl` (pastille). Installé avec
  `--legacy-peer-deps` : conflit préexistant entre vitest 5 et `@types/node` 20, sans rapport.

## 6. Hors périmètre

- **OS-1** — Effets de page vitrine (parallaxe, sections épinglées, défilement scénarisé) : ils
  alourdiraient un outil utilisé tous les jours.
- **OS-2** — Thème clair.
