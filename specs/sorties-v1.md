# Sorties : badges, calendrier, découverte en rangées — v1

**Statut :** livré le 2026-09-26 (demandes de l'utilisateur des 2026-09-25 et 26)
**Date :** 2026-09-26

## 1. Contexte

L'app sait où voir un titre (disponibilité streaming) mais pas quand il sort. Trois demandes :
signaler d'un badge ce qui est au cinéma ou à venir, offrir un calendrier des sorties (TMDB en
publie les données), et présenter « À découvrir » en rangées comme « Ma pile à voir ».

## 2. Exigences fonctionnelles

### Dates de sortie

- **FR-1** (données) — Pour chaque titre enrichi par TMDB, l'app DOIT conserver ses dates de
  sortie : films, sortie en salle en France (types TMDB 3, sinon 2), sortie numérique en France
  (type 4), à défaut la date de sortie mondiale ; séries, première diffusion, prochain épisode
  annoncé (saison, numéro, date) et statut. Stockées localement, rafraîchies au-delà de 7 jours.
- **FR-2** (badge) — Une carte DOIT porter :
  - « Au cinéma » pour un film sorti en salle en France depuis 6 semaines au plus, et pas encore
    sorti en numérique ;
  - « À venir » avec la date pour un film pas encore sorti (« Au cinéma le 15 oct. », ou « Sortie
    le … » sans sortie en salle), une série pas encore diffusée (« Nouvelle série le … ») ou une
    nouvelle saison annoncée (« Saison 3 le … ») ;
  - « Prochainement » pour un titre annoncé sans date.
  Rien sinon. Le badge se calcule à l'affichage (il dépend du jour).

### Calendrier

- **FR-3** (page) — Une page « Sorties » DOIT présenter une frise des sorties, groupées par
  semaine, des 30 derniers jours jusqu'à l'horizon choisi (FR-6 bis) : films en salle en France, nouvelles séries, et
  nouvelles saisons des séries de ta bibliothèque.
- **FR-4** (pour toi) — La frise DOIT pouvoir se restreindre à ce qui te concerne : titres de ta
  bibliothèque, et titres dont la compatibilité (recommendations v1.5 FR-34) dépasse ton taux de
  base. C'est la vue par défaut.
- **FR-5** (actions) — Depuis la frise, un titre hors bibliothèque DOIT pouvoir être ajouté (et
  retiré) ; un titre de la bibliothèque le signale.
- **FR-6** (filtres) — Tout / Films / Séries.
- **FR-6 bis** (horizon, demande du 2026-09-26) — L'horizon DOIT être réglable : 3, 4, 5, 6 mois
  (défaut), 1 an ; mémorisé.
- **FR-6 ter** (par tranches, 2026-09-26) — La frise DOIT se charger par tranches : les 30 derniers
  jours jusqu'à la fin du mois, puis un mois à la fois à mesure qu'on descend, jusqu'à l'horizon.
  Chaque tranche a ses propres titres les plus populaires : d'un seul tenant sur un an, les
  sorties du moment (au pic de leur popularité) évinçaient tout ce qui suivait décembre (97
  sorties en septembre, 1 à 12 par mois en 2027). Séries : les nouvelles, et les débuts de
  saison des séries populaires qui diffusent sur la tranche, même hors bibliothèque.

### « À découvrir » en rangées

- **FR-7** — L'onglet « À découvrir » DOIT offrir la même double lecture que la pile : « Pour
  toi » en rangées expliquées (le meilleur pour toi, parce que tu as aimé X, disponible sur tes
  abonnements, pépites peu connues, récents, films de moins de 2 h) et « Classement » en grille.

## 3. Exigences non fonctionnelles

- **NFR-1** — Aucune écriture vers Notion : dates et calendrier restent locaux.
- **NFR-2** — Les listes TMDB du calendrier sont gardées une journée en mémoire ; les dates des
  titres de la bibliothèque sont rafraîchies par lots (au plus 60 par visite du calendrier).

## 4. Critères d'acceptation

- **AC-1** (FR-2) — Given un film sorti en salle en France il y a 10 jours, sans sortie
  numérique, When le badge se calcule, Then il vaut « Au cinéma » ; Given sa sortie numérique
  hier, Then il n'y a plus de badge.
- **AC-2** (FR-2) — Given une série dont le prochain épisode est l'épisode 1 de la saison 3, dans
  12 jours, When le badge se calcule, Then il vaut « Saison 3 » avec cette date.
- **AC-3** (FR-2) — Given un film sans sortie en France mais avec une sortie mondiale dans 20
  jours, When le badge se calcule, Then il est « À venir » à cette date.
- **AC-4** (FR-1) — Given une fiche TMDB de film avec plusieurs sorties françaises, When elle est
  lue, Then la salle retient la plus ancienne des sorties de type 3 (sinon 2), le numérique la
  plus ancienne de type 4.
- **AC-5** (FR-3) — Given des sorties réparties sur plusieurs semaines, When la frise se compose,
  Then elles sont groupées par semaine, dans l'ordre, sans doublon.
- **AC-6** (FR-7) — Given des découvertes, When les rangées se composent, Then aucun titre
  n'apparaît dans deux rangées et une rangée de moins de 3 titres n'est pas affichée.

## 5. Cas limites

- **EC-1** — TMDB injoignable : la frise affiche ce qu'elle a (bibliothèque) et le dit.
- **EC-2** — Date au format partiel ou absente : pas de badge daté ; « Prochainement » seulement
  si TMDB annonce le titre (statut « En production », « Prévu »).

## 6. Précisions de mise en œuvre

- La frise s'ouvre sur la semaine en cours, juste sous les filtres ; les semaines passées sont
  repliées derrière un bouton (« Voir les N sorties des semaines passées »), sans défilement
  automatique qui masquerait les filtres (2026-09-28) ; les jours passés estompés ; en-têtes de
  semaine collants.
- « Pour toi » : titres de la bibliothèque, et titres dont la compatibilité dépasse le taux de
  base. Les titres écartés (« Ne plus me proposer ») n'y figurent pas.
- En révélant des séries confidentielles à 85 %, le calendrier a mené à la moyenne bayésienne de
  la note TMDB (recommendations-v1 §13) : +0,014 sur le banc.
- Rattrapage des dates : `scripts/backfill-release.mjs` (local, relançable).

## 7. Hors périmètre

- **OS-1** — Arrivées sur les plateformes de streaming (TMDB n'en fournit pas la date).
- **OS-2** — Notifications de sortie.
