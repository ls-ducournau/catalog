---
name: catalog-design-system
description: Système de design de Catalog (app Next.js locale, en français), d'après DESIGN.md de Raycast. À charger AVANT de créer ou modifier une vue, un composant, un style ou une animation dans Catalog : jetons, primitives (components/ui), sections, archétypes de pages (components/layouts), mouvement GSAP, garde-fous (ds:audit, tests Playwright) et marche à suivre pour produire une vue.
---

# Système de design Catalog (v2, Raycast)

Références : `specs/design-system-v2-raycast.md` (le plan, les critères d'acceptation) ;
`docs/design-reference/raycast/composants/` (**fiches de QA par composant** : relevés de
raycast.com, capture de référence, liste de contrôle ; elles **priment** sur DESIGN.md pour les
recettes, décision D5) ; `docs/design-reference/raycast/DESIGN.md` (référence **normative** des
principes) ; `docs/design-reference/raycast/analyse.md` (relevé complémentaire). Le guide vivant
est la page `/design` de l'app (http://localhost:3000/design) : ouvre-la avant de construire.

## Règles absolues

- **Interface en français**, tutoiement, jamais de tiret cadratin (—) dans un texte d'interface.
- **Aucun texte sous 12 px.**
- **Achromatique.** Aucune couleur fonctionnelle. Le seul bouton plein est `primary` (Mist
  `#e6e6e6`, texte Slate `#2f3031`). Le corail (`--brand`) est une **marque** : logo, décor du
  héros (`ShardsBackdrop`), badge `brand`. Jamais pour un lien, un texte, une icône, une bordure,
  un bouton, un statut. `--success` et `--info` : lavis de mise en valeur seulement, jamais seuls
  porteurs d'une information (toujours un libellé). **Exception (D6) : notes et scores.** Une
  seule étoile partout (`StarIcon` et ses dérivés `StarRating`, `StarsReadOnly`, `StarRow`,
  `StarCount`), pleine en jaune `--rating` ; jamais « ★ » ni « ⭐️ » dans un texte d'interface
  (en phrase : « 4 étoiles »). Score : `--score-high/mid/low` (vert, jaune, gris), toujours avec
  son chiffre. Fiche : `docs/design-reference/raycast/composants/note-et-score.md`.
- **Cartes à arête** : Onyx, arête `--card-edge` (blanc 6 %), reflet `--shadow-card`, rayon 12 ;
  aucune ombre portée sur une carte ou un panneau. Le relief « touche de clavier »
  (`--shadow-key`) est celui du bouton secondaire. Fenêtres flottantes : `--shadow-window`.
- **Jamais d'interlettrage négatif**, même sur un grand titre.
- **Une page ne style pas** : elle importe **un** archétype, compose des sections et des
  primitives, et n'ajoute que de la mise en page (flex, grid, gap, marges de l'échelle de 4/8 px).
  Pas de couleur codée (`#…`, `rgb(…)`), pas de teinte Tailwind (`amber-400`…), pas de
  `text-[13px]`, pas de classe de recette (`btn`, `card`…) écrite à la main : passer par
  `buttonClass()`/`<Button>` et les primitives.
- **Sécurité des données** : ne jamais déclencher d'écriture pendant un test ou une capture (pas
  de clic sur une action qui écrit ; `tests/securite.ts` bloque les requêtes `/api` qui écrivent).
  Jamais de synchronisation Notion. Jamais de commit sans demande explicite.

## Jetons (`design/tokens.json` → `npm run tokens`)

Ne jamais éditer `src/styles/tokens.css` ni `src/lib/tokens.ts` (générés). Rôles utilisables en
classes Tailwind (`bg-surface`, `text-muted`…) :

| Rôle | Emploi |
|---|---|
| `background` | Seul fond de page (`#040506`) |
| `surface` / `surface-2` / `surface-3` | Cartes, tuiles, rails, recherche (Onyx `#0c0d0f`) / champs, survol, appui / pastilles, bas des dégradés |
| `panel`, `surface-raised` | Fenêtres, menus, panneaux (Ink `#07080a`) |
| `foreground` | Titres, texte fort (blanc) |
| `muted` (= `body`) | Texte secondaire (Ash `#9c9c9d`) |
| `subtle` | Smoke, contraste faible (3,2 à 3,8:1) : **icônes, séparateurs, décor seulement**. Tout texte lisible passe en `muted` (axe l'exige : AC-5.2) |
| `card-edge` | Arête des cartes, tuiles, touches (blanc 6 %) |
| `field-edge` (`-hover`, `-focus`) | Arête de la recherche : blanc 8 %, 14 % au survol, 24 % à la saisie |
| `focus` / `focus-ring` | Anneau de focus clavier (blanc 40 %, 2 px décalé de 2) / halo d'un champ (blanc 6 %). Discret : jamais de filet blanc plein |
| `border` | Arête de la barre, des puces, des champs survolés (`#363739`) |
| `divider` | Séparateurs (blanc 10 %) ; `selection` : ligne choisie (blanc 8 %) |
| `accent` / `accent-foreground` | Le bouton d'action (Mist / Slate) |
| `brand` / `brand-tint` | Marque seulement |

Titres (`h1` à `h4`) : **Bricolage Grotesque 600**, posé par une règle de base ; ne jamais écrire
de graisse sur un titre (`font-medium`…). Un texte à l'allure de titre qui n'en est pas un :
`font-heading font-semibold`. Le reste : Work Sans.
Texte : `text-2xs` 12, `text-xs` 13, `text-sm` 14, `text-base` 16, `text-lg` 18,
`text-subheading` 20, `text-heading-sm` 24, `text-heading` 32, `text-heading-lg` 56 (titre de
page en 600, héros en 400), `text-display` 64. Graisses 400, 500, 600. Rayons : `rounded-badge` 6,
`rounded-control`/`rounded-lg` 8, `rounded-frame` 12, `rounded-card` 12, `rounded-card-lg` 20.

## Primitives (`@/components/ui`)

`Button` (primary, secondary, ghost, glass, overlay, danger ; sm, md, lg ; `icon` ; `href`,
`external`, `loading`), `buttonClass()`, `Badge` (neutral, success, brand, count ; lavis), `Kbd`, `Keycap`
(`pressed`), `Card` (key, edge, tile), `IconCircle`, `MetaRow`, `MonoMeta`, `Eyebrow`, `Divider`,
`Avatar`, `Skeleton`, `Switch`, `ListRow`, `ActionBar`, `Tooltip`, `Toast`, `Chip`, `SearchField`
(`shortcut`, `searching`), `Tabs` (contrôle segmenté), `Select` (menu de filtre),
`ConfirmDialog`. Classes de recette disponibles pour les cas particuliers : `poster`,
`overlay-pill`, `menu-panel`, `menu-item`, `bezel`/`bezel-inner`, `field`, `eyebrow`,
`mono-meta`.

## Sections (`@/components/sections`)

`PageHeader`, `Toolbar` (start, end), `SectionHeading`, `FeaturedRow`, `MediaGrid` (FlipGrid),
`MediaRow` (rangée défilante), `TimelineSection` (aside collant, contenu), `DetailHeader`,
`InfoTable`, `CommandWindow` (head, contenu, barre d'actions), `SummaryCards`/`SummaryCard`,
`EmptyState`, `ShardsBackdrop`. Accueil (fiche `composants/vitrine.md`) : `ShowcaseCarousel`,
`FeatureWall` + `RecommendationsWall`, `TitleListSection`, `FeatureSection` (`FeatureEyebrow`,
`ArrowLink`, `reverse`) avec un aperçu vivant (`RatingPreview`, `DuelPreview`,
`ReleasesPreview`, `PlaylistPreview`). Un aperçu de l'accueil est une vraie commande : il écrit seulement sur un
geste de l'utilisateur, répond au clavier quand il a le focus et s'annule.

## Archétypes (`@/components/layouts`) : un seul par page

| Archétype | Modèle Raycast | Vues |
|---|---|---|
| `HeroLayout` (hero, shards) | Accueil | Accueil, Ce soir |
| `CatalogLayout` | Store | Bibliothèque, Recommandations, Classement, Playlists |
| `TimelineLayout` | Changelog | Sorties |
| `HeroLayout stage` | Fenêtre sur le héros (palette de commandes) | Duels, Tri rapide |
| `DetailLayout` (header, tabs, aside) | Page d'extension | Fiche d'un titre |

## Mouvement (`@/lib/motion`)

Registre productif : 100 à 400 ms, courbe `out` (0.23, 1, 0.32, 1), **aucun dépassement ni
ressort**, `transform` et `opacity` seulement, pas de flou. Ne jamais écrire `gsap.to/from/
fromTo` hors de `src/lib/motion.ts` et `components/motion/` (règle ESLint) : appeler
`preset.enter` (arrivée, cascade), `preset.swap` (changement de vue : fondu de 150 ms),
`preset.slide` (repère qui glisse). Un changement de vue, d'onglet ou de filtre ne rejoue rien.
Une action répétée au clavier n'anime pas son résultat. Toujours respecter
`prefersReducedMotion()`. Graphiques Bklit : `enterTransition={{ type: "tween", duration: .4,
ease: [.23, 1, .32, 1] }}`, palette `--chart-1…5` (rampe de gris).

## Produire une vue

1. Choisir l'archétype (tableau ci-dessus). Un besoin qui n'y entre pas se discute avant le code.
2. Composer les sections et les primitives ; écrire les états vide, erreur et chargement
   (`EmptyState`, `Skeleton`).
3. Mouvement : préréglages seulement.
4. Nouveau composant réutilisable : il va dans `components/ui` ou `components/sections`, et dans
   `/design` avec ses états.
5. QA visuelle : pour chaque composant touché, passer la liste de contrôle de sa fiche
   (`docs/design-reference/raycast/composants/`), capture Catalog à côté de la capture de la
   fiche, à 1 440 et 390 px.
6. Vérifier : `npx tsc --noEmit`, `npx eslint <fichiers>`, `node scripts/ds-audit.mjs` (aucun
   compte ne doit monter), `npm run test:motion`, captures `npm run test:visual`.
7. Pré-vol du skill `design-taste` (`reference/pre-flight.md`).
