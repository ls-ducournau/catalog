# Ce soir — v2 : une recommandation pour le moment

**Statut :** livré le 2026-09-26 (phase 5 de `recommandations-v2-plan.md` ; demande « travail UI
et d'interactions sur le parcours de Ce soir » du 2026-09-25)
**Date :** 2026-09-26
**Remplace :** `ce-soir-v1.md` (le tirage par genre et note)

## 1. Contexte

La v1 est un filtre : quatre écrans successifs (catégorie, genre, note), puis cinq titres tirés au
hasard dans TMDB, sans rien savoir de l'utilisateur ni de sa soirée. Or l'app sait maintenant
prédire ce qu'il aimera (compatibilité, recommendations v1.5), où c'est disponible, combien de
temps ça dure, et il a 480 titres qui l'attendent dans sa pile. « Ce soir » devient une
recommandation contextuelle : on dit ce qu'on a envie de voir, l'app propose.

## 2. Exigences fonctionnelles

- **FR-1** (contexte, un seul écran) — Le contexte DOIT tenir sur un écran, chaque réglage
  visible et modifiable à tout moment, avec une valeur par défaut, et mémorisé :
  - **Envie** : Léger, Intense, Émouvant, Évasion, Réfléchir, Surprends-moi (défaut) ;
  - **Format** : Film, Série, Documentaire, Peu importe (défaut) ;
  - **Durée** (films) : 1 h 30, 2 h, Sans limite (défaut) ;
  - **Avec qui** : Seul (défaut), À deux, En famille ;
  - **Où** : Sur mes abonnements (défaut s'il y en a), Partout ;
  - **Parmi** : Ma pile (défaut), Tout le catalogue.
- **FR-2** (envies) — Une envie se traduit en genres TMDB (films et séries) : Léger = comédie,
  animation, familial ; Intense = thriller, action, crime, horreur, mystère ; Émouvant = drame,
  romance ; Évasion = science-fiction, fantastique, aventure ; Réfléchir = documentaire,
  histoire, guerre. Un titre correspond s'il a au moins un de ces genres.
- **FR-3** (avec qui) — « En famille » DOIT exclure l'horreur et exiger un genre familial
  (familial, animation, comédie, aventure, fantastique, jeunesse). « À deux » et « Seul » ne
  filtrent rien.
- **FR-4** (durée) — La durée ne s'applique qu'aux films (une série se regarde à l'épisode) ; un
  film sans durée connue est gardé.
- **FR-5** (classement) — Les candidats qui correspondent DOIVENT être classés par compatibilité
  (recommendations v1.5 FR-35), titres écartés exclus. Ma pile : les titres « à voir » ; tout le
  catalogue : titres TMDB populaires correspondant au contexte (fournisseurs de tes abonnements
  si « Sur mes abonnements »), hors titres vus.
- **FR-6** (propositions) — L'écran DOIT montrer une proposition principale, en grand (affiche,
  compatibilité, durée, où la voir, raison, synopsis), et deux autres. « Autres idées » DOIT
  passer aux trois suivantes ; « Pas ce soir » DOIT retirer un titre des propositions de la
  soirée (sans rien enregistrer).
- **FR-7** (je regarde ça) — « Je regarde ça » DOIT ajouter le titre à la bibliothèque s'il n'y
  est pas, le marquer vu, et afficher une confirmation annulable qui défait exactement les deux.
- **FR-8** (réactivité) — Changer un réglage DOIT mettre à jour les propositions sans autre clic.

## 3. Exigences non fonctionnelles

- **NFR-1** — Ma pile : réponse locale, sans appel TMDB. Tout le catalogue : les fiches TMDB sont
  gardées 7 jours (cache de la découverte).
- **NFR-2** — Mouvement réduit respecté ; textes d'au moins 12 px ; cibles tactiles de 44 px.

## 4. Critères d'acceptation

- **AC-1** (FR-2) — Given l'envie « Léger », When un drame sans comédie est évalué, Then il ne
  correspond pas ; une comédie dramatique, si.
- **AC-2** (FR-3) — Given « En famille », When un film d'animation d'horreur est évalué, Then il
  est exclu ; un film d'animation familial est gardé.
- **AC-3** (FR-4) — Given une durée de 1 h 30, When un film de 2 h 10 et une série aux épisodes
  de 50 min sont évalués, Then le film est exclu et la série gardée.
- **AC-4** (FR-5) — Given trois titres de la pile qui correspondent, When les propositions se
  calculent, Then ils arrivent dans l'ordre de leur compatibilité, et un titre écarté n'y figure
  pas.

## 5. Cas limites

- **EC-1** — Aucun titre ne correspond : dire lequel des réglages relâcher (le plus restrictif).
- **EC-2** — Moins de 30 titres notés (pas de compatibilité) : classement par le mélange de la v1.3,
  sans pourcentage.
- **EC-3** — TMDB injoignable en « Tout le catalogue » : le dire, et proposer la pile.

## 6. Précisions de mise en œuvre

- Ordinateur : réglages dans un panneau à gauche, propositions à droite. Mobile : réglages
  repliés en une ligne de résumé (« Modifier »), pour voir la proposition d'emblée ; carte
  principale compacte (affiche à côté du titre).
- « Plutôt celui-ci » fait passer une alternative en proposition principale.
- L'ancien tirage (`/api/discover`, `/api/tmdb/genres`) est supprimé.

## 7. Hors périmètre

- **OS-1** — Humeur apprise automatiquement (heure, jour) : pas de signal fiable à ce jour.
- **OS-2** — Épisode suivant d'une série en cours : l'app ne suit pas les épisodes vus.
