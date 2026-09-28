# Tri rapide et boucle d'apprentissage — v1

**Statut :** livré le 2026-09-25 (phase 4 de `recommandations-v2-plan.md`)
**Date :** 2026-09-25

## 1. Contexte

La phase 1 a montré que le plafond de précision vient du manque de signal, pas de l'algorithme.
Cette phase en collecte davantage, sans demander plus d'effort : un tri « j'aime / je n'aime
pas » d'une carte à la fois, un « ne plus me proposer ça », et un journal local de ce que tu fais
déjà dans l'app.

Piège central, validé avec l'utilisateur : un « je n'aime pas » sur un titre **pas vu** veut dire
« ça ne me tente pas », pas « je ne l'ai pas aimé ». Ces signaux ne se mélangent jamais aux notes
qui entraînent le modèle.

## 2. Exigences fonctionnelles

### Journal et « ne plus me proposer »

- **FR-1** (journal) — Les gestes suivants DOIVENT être journalisés localement, avec leur date et
  leur origine : ajout (et depuis où : découverte, suggestions de l'ajout, tri rapide), retrait,
  note, écartement, réponse de tri. Rien n'est envoyé à Notion ni ailleurs.
- **FR-2** (écarter) — Un titre DOIT pouvoir être écarté depuis une recommandation (« Ne plus me
  proposer ») : un item de ta pile disparaît des recommandations sans quitter ta bibliothèque ;
  un titre hors bibliothèque disparaît de « À découvrir » et des suggestions. L'écartement DOIT
  être annulable sur le moment, et réversible ensuite depuis le profil de goûts.

### Tri rapide

- **FR-3** (familles) — Le tri rapide DOIT proposer trois familles : **À découvrir** (titres hors
  bibliothèque, tirés de « À découvrir »), **Déjà vus** (titres vus sans note), **Personnes**
  (interprètes, réalisation, production présents dans au moins 3 de tes titres vus). Les deux
  familles de titres acceptent le filtre Tout / Films / Séries / Documentaires.
- **FR-4** (effets) —
  - À découvrir : « J'aime » ajoute le titre à ta pile à voir ; « Je n'aime pas » l'écarte (FR-2).
  - Déjà vus : « J'aime » pose ⭐⭐⭐⭐, « Je n'aime pas » pose ⭐⭐ — une première note grossière,
    à affiner ensuite.
  - Personnes : la réponse est retenue comme ton avis sur la personne.
  - « Passer » n'a aucun effet : « je ne connais pas » n'est ni un oui ni un non.
- **FR-5** (gestes) — Sur ordinateur : deux grands boutons, « Je n'aime pas » à gauche et
  « J'aime » à droite, et les raccourcis **1** (je n'aime pas), **2** (j'aime), **3** (passer),
  ainsi que ← / →. Sur mobile : balayage horizontal, les boutons restant affichés. Mouvement
  réduit respecté.
- **FR-6** (annulation) — La dernière réponse DOIT pouvoir être annulée (un balayage part vite),
  en défaisant exactement son effet.

### Retour vers les recommandations

- **FR-7** (avis sur les personnes) — Un avis sur une personne DOIT peser sur le classement des
  recommandations : léger bonus pour un titre où figure une personne aimée, léger malus pour une
  personne non aimée. Ce réglage n'est pas mesurable sur le banc tant qu'il n'y a pas d'avis ; il
  reste donc faible et plafonné, pour ne jamais écraser le modèle.
- **FR-8** (taux d'acceptation) — Le profil de goûts DOIT afficher, dès qu'il y a de quoi : la
  part des propositions gardées (ajoutées plutôt qu'écartées), et, parmi celles vues depuis, la
  part notée ⭐⭐⭐⭐ ou plus. C'est l'équivalent personnel des tests A/B des plateformes.
- **FR-9** (production) — Le magasin de caractéristiques DOIT inclure la production (films :
  « Producer » ; séries : producteurs exécutifs). Elle sert au tri des personnes et à FR-7, mais
  **pas au modèle** tant qu'elle n'a pas été validée par le banc.

## 3. Critères d'acceptation

- **AC-1** (FR-2) — Given un item écarté, When les recommandations se recalculent, Then il n'y
  figure plus et reste dans la bibliothèque ; When l'écartement est annulé, Then il revient.
- **AC-2** (FR-4) — Given un titre déjà vu sans note, When on répond « J'aime », Then sa note
  devient ⭐⭐⭐⭐ ; When on annule, Then il redevient sans note.
- **AC-3** (FR-4) — Given « Passer », When on répond, Then rien ne change sinon le journal.
- **AC-4** (FR-7) — Given un acteur aimé présent dans un candidat, When la pile est classée, Then
  ce candidat gagne un bonus borné ; un acteur non aimé produit le malus symétrique.
- **AC-5** (FR-8) — Given 4 titres ajoutés et 1 écarté depuis les propositions, dont 2 vus et
  1 noté ⭐⭐⭐⭐⭐, When le taux est calculé, Then il vaut 80 % gardés et 50 % bien notés.

## 4. Précisions de mise en œuvre

- **FR-5 (libellés)** — Les deux boutons gardent leur place (non à gauche, oui à droite), mais
  leur libellé suit la famille, pour ne pas tomber dans le piège central : « Pas pour moi » /
  « Ça me tente » (à découvrir), « Pas aimé » / « Aimé » (déjà vus), « Je n'aime pas » /
  « J'aime » (personnes). Chaque bouton annonce son effet sous le libellé (« Ajouter à ma pile »,
  « Noter 4 étoiles »…).
- **FR-5 (mobile)** — Les boutons restent collés en bas de l'écran quand la carte dépasse. Une
  réponse au doigt ou à la souris fait partir la carte du côté choisi ; au clavier, pas
  d'animation (le geste se répète trop vite pour qu'elle serve), la ligne sous les boutons dit ce
  qui vient d'être fait.
- **FR-6** — Les 20 dernières réponses de la session s'annulent une à une (bouton « Annuler » ou
  Ctrl+Z). Annuler un « J'aime » sur un titre qui était déjà dans la bibliothèque ne le retire
  pas : il y était avant la réponse.
- **EC-1** — Une réponse refusée (Notion injoignable lors d'un ajout) remet la carte en tête et
  n'est pas comptée.
- **EC-2** — Une carte passée ne revient pas dans la même session, même si le lot suivant la
  contient encore (elle n'a laissé aucune trace en base).
- **FR-2 (suggestions)** — Dans la fenêtre d'ajout, qui n'a pas de toast, l'annulation d'un
  écartement se fait par une ligne au-dessus des suggestions.
- **Ordre des cartes** — Découvertes les mieux classées d'abord, titres vus les plus récemment
  modifiés, personnes les plus présentes dans tes titres vus. L'ordre « là où la réponse apprend
  le plus » du plan v2 est reporté faute de pouvoir le mesurer (cf. plan, phase 4).

- **FR-7 et FR-9, suite (2026-09-25)** — Mesurés sur le banc : la production entre dans le
  modèle (+0,010) ; les avis sur les personnes n'améliorent pas la prédiction des notes et sont
  désormais centrés. Détails : recommendations-v1 §13.

## 5. Hors périmètre

- **OS-1** — Réinjecter les « je n'aime pas » sur des titres pas vus dans l'entraînement du modèle
  de notes (le piège central).
- **OS-2** — Duels « actifs » : abandonnés sur mesure, cf. plan v2.
