# Bienvenue : le « Tinder du titre » — v1

**Statut :** livré le 2026-11-08
**Date :** 2026-11-08 · **Demande** : Louis, 2026-11-08

## 1. La demande

« Une sorte de tinder du titre en guise d'onboarding quand on commence avec un compte. Ce sera la feature
d'appel marketing : celle qui va attirer les gens, remplir leur bibliothèque, et l'utiliser aussi
facilement que l'on scroll sur Instagram. »

Décisions de Louis (2026-11-08) :

- **Trois gestes** : → ça me tente (dans ta pile), ← pas pour moi, ↑ déjà vu, puis une note d'une touche.
- **Où** : le premier écran d'un compte ; un **avant-goût sur la page d'arrivée**, entre l'éventail
  d'affiches et « Comment ça marche ».
- **La carte** : l'affiche en grand, la bande-annonce comme sur les cartes de l'application, le synopsis
  discrètement, un moyen d'en savoir plus.
- **Une jauge de progression** pour un nouveau compte : un minimum de titres pour profiter des autres
  fonctions avec assez de contenu.
- Sur la page d'arrivée, **« Tester » remplace « Se connecter »** ; le titre suit le nouveau geste.

## 2. Exigences

- **FR-1** (gestes) — Une carte à la fois, la suivante dessous. Balayer à droite : le titre rejoint ta pile
  (`POST /api/triage/answer`, famille « à découvrir », « like ») ; à gauche : il est écarté pour de bon
  (« dislike ») ; vers le haut : « Déjà vu » (`POST /api/items`, source « triage », puis `PATCH` vu),
  **sans note** (décision de Louis, 2026-11-09 : on note ensuite ses titres vus dans le tri rapide). Trois
  boutons et les flèches du clavier font la même chose.
- **FR-2** (annuler) — « Annuler » (Ctrl+Z) défait exactement le dernier geste (`POST /api/triage/undo`) et
  remet la carte sur le dessus.
- **FR-3** (ordre des cartes) — Le paquet de départ vient de la vitrine : un titre que presque tout le
  monde a vu (à noter d'un geste), puis un titre du moment, en alternance, sans doublon ni titre déjà dans
  la bibliothèque. Dès un titre noté 4 étoiles ou plus (et toutes les 8 réponses), la découverte
  (`/api/recommendations/discover`) glisse des cartes plus personnelles, « Parce que tu as aimé … » (pour un
  compte qui a déjà des titres vus bien notés).
- **FR-4** (la carte) — L'affiche en plein cadre ; en bas, sur un dégradé : titre, type, année, genres et
  deux lignes de synopsis. En haut : la bande-annonce (le lecteur de l'application) et « Plus d'infos ». Un
  tap, « i » ou « Plus d'infos » retourne la carte : synopsis complet, durée, note TMDB, réalisation,
  têtes d'affiche, services en abonnement, bande-annonce. Ces détails viennent de `GET /api/tmdb/title`
  (public, fiche TMDB gardée 7 jours), demandés trois cartes à l'avance.
- **FR-5** (mouvement) — La carte suit le doigt, penche, affiche le tampon du geste (blanc, jamais en
  couleur) et part en 220 ms (transform et opacité, sans ressort). Mouvement réduit : elle change sans voler.
- **FR-6** (jauge) — Deux barres : titres (objectif 30, le seuil d'une bibliothèque qui « démarre ») et notes
  (objectif 10, le minimum des recommandations), et le prochain palier en une phrase, les titres d'abord.
  Les cartes ne notant pas, « Noter mes titres vus (N) » mène au tri rapide des titres vus. En haut de la
  bienvenue, et sur l'accueil d'un compte tant qu'elle n'est pas pleine (avec « Remplir ma bibliothèque »).
  Pleine : « Voir mes recommandations », et « Garder mon compte » pour un invité.
- **FR-7** (premier écran) — `/bienvenue`. « Tester » y mène ; « Garder ce que j'ai fait » (visite, page
  d'arrivée) y mène ; un compte sans aucun titre qui ouvre l'accueil y est renvoyé. La page s'ouvre sans
  compte : le premier geste ouvre la session invitée (proxy).
- **FR-8** (avant-goût) — Sur la page d'arrivée, une dizaine de cartes, même geste, sans compte : les
  réponses restent dans le navigateur (l'état de la visite). « Garder mes N titres et continuer » les verse
  dans un compte et ouvre la bienvenue. Au doigt, la page défile à la verticale (« Déjà vu » par son bouton) ;
  au clavier, les flèches n'agissent que dans le paquet.
- **FR-9** (compte, revu le 2026-11-09, `docs/audit/parcours-visiteur-2026-11-09.md`) — Barre du haut d'un
  visiteur : « Se connecter » (discret) et **« Tester »**, le seul bouton principal (absent sur la bienvenue) ;
  « Fais le tour » n'y est plus. « Garder mon compte » pour un invité qui a des titres.

- **FR-10** (sans fin, 2026-11-09) — Le paquet ne s'arrête pas : sous 8 cartes, la page suivante arrive
  (`GET /api/welcome/cards?page=N`, 1 à 20, publique ; avec un compte, sans ses titres ni ceux qu'il a
  écartés) : des titres très vus (deux films pour une série) et des titres populaires du moment, en
  alternance, gardés six heures par page. Les affiches des quatre cartes suivantes sont chargées d'avance.
- **FR-11** (états vides, 2026-11-09) — Là où une bibliothèque qui démarre n'a encore rien (recommandations
  sans 10 notes, pile vide, découverte sans titre bien noté, duels, classement, bibliothèque vide), l'action
  mène à la bienvenue : c'est le chemin le plus court vers des titres vus et notés.

- **FR-12** (indice du geste, 2026-11-09, demande de Louis : « le swipe n'est pas évident au premier coup
  d'œil ») — Quand le paquet paraît à l'écran, la carte du dessus se balance à droite (tampon « Ça me
  tente ») puis à gauche (« Pas pour moi ») et revient ; une seconde fois 7 s plus tard si rien ne se passe ;
  plus jamais dès le premier contact. Préréglage `preset.indice` (quatre mouvements de 400 ms, sans
  dépassement) ; rien avec le mouvement réduit.

- **FR-13** (tout te suit, 2026-11-09) — Sans compte, rien ne s'écrit : le paquet, les sections jouables de la
  page d'arrivée (« Ça me tente ») et la visite gardent les choix dans le navigateur (un seul état).
  « Continuer avec mes N titres » mène à la bienvenue ; à l'arrivée, d'où qu'on vienne, la bienvenue verse
  titres, notes et duels dans la bibliothèque (un invité, ou un compte encore vide ; jamais la bibliothèque
  locale de Louis) et ne remontre pas les cartes déjà répondues.

## 3. Réalisé

- `src/lib/demarrage.ts` (+ 4 tests) : cartes, paquet, insertion de la découverte, jauge, paliers.
- `src/components/swipe/` : `SwipeDeck` (paquet, gestes, verso, note), `useFiches`, `Bienvenue`,
  `TeaserSwipe`, `JaugeDemarrage`. Page `src/app/bienvenue/page.tsx`.
- `GET /api/tmdb/title` : `serveur/src/decouverte.rs` (`fiche`, `fiche_carte`, 1 test) et
  `src/app/api/tmdb/title/route.ts` (local), même forme (`src/lib/ficheCarte.ts`).
- Page d'arrivée : titre « Balaie des titres. Catalog te dit quoi regarder. », « Tester », « J'ai déjà un
  compte », l'avant-goût sous l'éventail. Accueil d'un compte : la jauge. Visite : « Garder » mène à la
  bienvenue.
- 2026-11-09 : FR-10 (`serveur/src/bienvenue.rs` + 1 test, `src/lib/cartesBienvenue.ts` + 1 test, même ordre ;
  `ajouterAuBout` + 1 test ; préchargement des affiches) et FR-11.
- 2026-11-09 : « Déjà vu » sans note, lien « Noter mes titres vus » dans la jauge ; FR-12 (`preset.indice`).
- 2026-11-09 : audit du parcours visiteur ; FR-9 revu, FR-13 (`src/components/visite/verser.ts`,
  `BacSuggestions`, `ClavierLocal`) ; sections de l'accueil en version pour tous sur la page d'arrivée.
