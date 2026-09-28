# Disponibilité streaming — v1

**Statut :** approuvé (phase 2 du plan `recommandations-v2-plan.md`)
**Date :** 2026-09-25

## 1. Contexte

Une recommandation n'est utile ce soir que si le titre est regardable ce soir. Les plateformes
ne recommandent que leur propre catalogue ; ici, l'équivalent est de savoir où chaque titre est
disponible en France, et de pouvoir se limiter à ses abonnements.

TMDB fournit ces données par pays via un partenariat avec JustWatch (endpoints
`/movie/{id}/watch/providers` et `/tv/{id}/watch/providers`). Leurs conditions imposent de
citer JustWatch comme source.

## 2. Exigences fonctionnelles

- **FR-1** (données) — Chaque titre ayant un `tmdb_id` DOIT porter sa disponibilité en France :
  abonnement, gratuit, gratuit avec publicité, location, achat, avec pour chaque service son
  identifiant, son nom et son logo, plus le lien TMDB et la date de récupération.
- **FR-2** (fraîcheur) — Une disponibilité DOIT être considérée périmée au-delà de **7 jours** et
  être rafraîchie à l'ouverture de la fiche du titre. Aucune tâche de fond : comme pour Notion,
  rien ne se met à jour sans action de l'utilisateur. Un script de backfill couvre l'existant.
- **FR-3** (abonnements) — L'utilisateur DOIT pouvoir déclarer ses abonnements, choisis dans la
  liste des services disponibles en France, présentés par popularité avec leur logo. Le choix
  est stocké localement.
- **FR-4** (équivalence) — Une formule avec publicité d'un service (« Netflix Standard with
  Ads ») DOIT compter comme le service lui-même. Une chaîne vendue via un autre service (« …
  Amazon Channel ») est un abonnement distinct.
- **FR-5** (filtre) — Un filtre « Sur mes abonnements » DOIT être disponible dans la
  bibliothèque et dans les deux onglets de recommandations. Il retient les titres disponibles en
  abonnement, gratuitement ou avec publicité sur un service déclaré ; la location et l'achat ne
  comptent pas. Dans la bibliothèque, il est appliqué côté serveur pour que la pagination reste
  exacte.
- **FR-6** (affichage) — La fiche d'un titre DOIT indiquer où le voir, en distinguant « Inclus
  dans tes abonnements », « Abonnement », « Gratuit » et « Location ou achat », avec la mention
  de la source JustWatch et le lien TMDB. Une carte DOIT porter le logo du service quand le titre
  est inclus dans l'un de tes abonnements, et rien sinon.
- **FR-7** (découverte) — Les titres hors bibliothèque de « À découvrir » DOIVENT porter la même
  information pour les titres affichés.

## 3. Critères d'acceptation

- **AC-1** (FR-4) — Given un abonnement déclaré à Netflix, When un titre n'est listé que sous
  « Netflix Standard with Ads », Then il est retenu par le filtre.
- **AC-2** (FR-5) — Given un titre disponible seulement à la location sur un service déclaré,
  When le filtre est actif, Then il n'est pas retenu.
- **AC-3** (FR-2) — Given une disponibilité récupérée il y a 8 jours, When la fiche s'ouvre, Then
  elle est rafraîchie ; récupérée il y a 2 jours, Then elle ne l'est pas.
- **AC-4** (FR-5) — Given le filtre actif dans la bibliothèque, When on fait défiler plusieurs
  pages, Then chaque page ne contient que des titres retenus et le total annoncé est exact.

## 4. Cas limites

- **EC-1** — Aucune donnée pour la France : la fiche indique « Pas disponible en streaming en
  France, d'après JustWatch ».
- **EC-2** — Aucun abonnement déclaré : le filtre invite à les choisir au lieu de vider la liste.
- **EC-3** — Échec de TMDB : la disponibilité précédente est conservée.

## 5. Hors périmètre

- **OS-1** — Autres pays que la France.
- **OS-2** — Prix de location ou d'achat (TMDB ne les fournit pas).
- **OS-3** — Liens profonds vers les applications : TMDB ne les fournit pas, on renvoie à sa page.
