# Accueil vitrine, connexion et bibliothèque qui démarre — v1

**Auteur** : Claude (assisté) · **Date** : 2026-11-05 · **Statut** : Réalisé le 2026-11-06 (non commité, non déployé) · **Relecteur** : Louis

## 1. La demande (Louis, 2026-11-05)

1. L'accueil local devient la **page d'arrivée** de `catalog-serveur.vercel.app`, avec **toutes ses
   sections**, mais les titres du compte y sont remplacés par des **titres tendances** (les mieux
   notés sur TMDB, les sorties cinéma attendues).
2. Un **bouton de connexion** dans la barre du haut et une **page de connexion**, faits avec le
   système de design.
3. Une fois connecté, les sections sous le héros redeviennent **l'accueil du compte**, avec sa
   bibliothèque.
4. Bibliothèque **vide ou trop petite** (un compte neuf, ou quelqu'un qui essaie l'application) :
   chaque section **invite à enrichir la bibliothèque**, ou se **remplit comme la vitrine**, avec une
   proposition d'ajout discrète.

## 2. Trois états, une seule page

La page reste `src/app/page.tsx`, avec les mêmes sections dans le même ordre. Seule la **source des
titres** change.

| État | Qui | Ce qu'on voit |
|---|---|---|
| **Vitrine** | Un visiteur, sans session | Les sections remplies de titres tendances. Chaque titre s'ajoute d'un clic. |
| **Amorce** | Un compte ou un invité dont la bibliothèque ne remplit pas une section | Ses titres d'abord, complétés par des tendances marquées « à ajouter », ou une invitation à enrichir. |
| **Perso** | Un compte à la bibliothèque garnie (Louis) | L'accueil local actuel, à l'identique. |

L'état se décide **section par section** : un compte peut avoir assez de titres pour sa bibliothèque,
mais trop peu de notes pour des recommandations.

## 3. Section par section

Seuils tirés du code existant : recommandations dès 10 titres notés (`MIN_RATED_TITLES`), score de
compatibilité dès 30 (`COMPATIBILITY_MIN_TITLES`).

| Section | Vitrine (visiteur) | Amorce (bibliothèque maigre) |
|---|---|---|
| **Héros** | Même titre. Boutons « Que regarder ce soir » et « Se connecter ». Pas de compteurs. | Compteurs du compte, comme aujourd'hui. |
| **Il y a un titre pour ça** (humeurs) | Tendances rangées par humeur. | Sa pile d'abord, complétée par des tendances « Ajouter à ma pile ». |
| **Notation** | Des titres très connus : « Tu l'as vu ? Note-le. » | Pareil tant qu'il y a moins de 10 titres notés : noter un titre l'ajoute comme vu. C'est le meilleur démarrage (FR-6 de la spec v2). |
| **À la une** (recommandations) | Tendances de la semaine, note TMDB à la place de la compatibilité. | Tendances avec « Ajouter », et une ligne : « Note encore N titres pour des recommandations à ton goût. » |
| **Duels** | Une paire d'exemple, sans écriture. | Invitation : « Note au moins deux titres pour lancer les duels. » |
| **Ta bibliothèque** (listes) | Onglets « Tendances », « Au cinéma », « Les mieux notés ». | Ses onglets s'ils ont des titres, plus un onglet « Suggestions » tant qu'elle est petite. |
| **Playlists** | L'invitation actuelle (sans playlist). | Inchangé : l'invitation existe déjà. |
| **Sorties** | Inchangé : déjà tiré de TMDB, avec « Ajouter ». | Inchangé. |

La **proposition d'ajout** reprend le bouton des Sorties (`previews.tsx`) : « Ajouter à ma pile »
(secondaire), puis « Ajouté, cliquer pour retirer » (fantôme). Une marque discrète distingue une
tendance d'un titre du compte, jamais par la couleur seule (règle du système de design).

## 4. Connexion

### Bouton dans la barre du haut (`src/app/NavBar.tsx`)

| Situation | Bouton |
|---|---|
| Visiteur ou invité | « Se connecter » (`Button` secondaire, `sm`), à gauche de la roue des réglages. |
| Compte durable | Un `Avatar` (initiale de l'e-mail) qui ouvre un `menu-panel` : l'e-mail, « Se déconnecter ». |
| Local (v1) | Rien : pas de comptes en local (comme le bloc « Ton compte » aujourd'hui). |

### Page `/connexion`

- Archétype : celui des Duels, **`HeroLayout` en scène** (la question sur le héros, une
  `CommandWindow` posée sur le décor). Il n'existe pas de `CommandLayout` dans le code : les Duels et
  le Tri rapide utilisent déjà cette scène.
- Contenu : `Tabs` « Se connecter » | « Créer un compte », deux `TextField`, le bouton `primary`,
  une `ActionBar` avec `Kbd` ↵. États : chargement, erreur (texte, jamais la couleur seule), succès
  (retour à la page d'où l'on venait).
- Un invité qui crée un compte **garde ses titres** (même identifiant, déjà en place). Le texte le
  dit. « Se connecter » à un autre compte prévient que l'essai en invité n'y sera pas repris.
- Le bloc « Ton compte » des réglages (`CompteV2.tsx`) reste, avec les mêmes textes.
- La page entre dans `/design` avec ses états.

## 5. Session : invitée au premier geste (changement proposé)

Aujourd'hui, toute visite ouvre une session invitée (décision du 2026-10-28). Avec une vitrine, je
propose : **pas de session tant qu'on regarde**, une session invitée ouverte **sans écran** au
premier geste (ajouter, noter, ouvrir une page de l'application). Raisons :

- chaque robot qui passe crée aujourd'hui un compte anonyme dans Supabase ;
- la vitrine est la même pour tous : elle peut être mise en cache, donc rapide.

La friction reste nulle pour la personne : aucun écran de connexion avant d'essayer.

## 6. Données des tendances

- Sources TMDB : tendances de la semaine, mieux notés (au moins 300 votes, comme `MIN_VOTES` de la
  vitrine actuelle), à l'affiche en France et sorties à venir triées par popularité (« attendues »).
- Cache partagé entre comptes (NFR-3 de la spec v2), rafraîchi toutes les 6 heures.
- Même forme que les données de l'accueil actuel (`ShowcaseTitle`), plus `tmdbId` et `libraryId`
  (null si le titre n'est pas dans la bibliothèque), comme les Sorties.
- Route publique `GET /api/vitrine` (sans jeton), écrite d'abord en v1 (la référence), puis portée en
  Rust et prouvée par la parité (`serveur/PORTAGE.md`).

## 7. Exigences

- **FR-0 (Louis, 2026-11-05)** — Connecté ou en démo (invité), on retrouve **toutes les pages de
  l'application locale**, à l'identique : Bibliothèque, fiche d'un titre, Classement, Playlists,
  Duels, Tri rapide, Recommandations, Sorties, Ce soir, Réglages. C'est le portage « 1 pour 1 » en
  cours (`serveur/PORTAGE.md`) ; il passe avant la vitrine.
- **FR-1** — Un visiteur voit toutes les sections de l'accueil, remplies de tendances, sans compte.
- **FR-2** — Un compte à la bibliothèque garnie voit l'accueil local à l'identique (écart de capture
  ≈ 0 % contre la v1, mêmes données).
- **FR-3** — Une section que la bibliothèque ne remplit pas se complète par des tendances à ajouter,
  ou invite à enrichir (tableau du § 3). Jamais de section vide sans explication.
- **FR-4** — Ajouter ou noter un titre depuis la vitrine fonctionne en un clic et le titre apparaît
  ensuite comme un titre du compte.
- **FR-5** — Bouton et page de connexion conformes au système de design (archétype, primitives,
  aucun texte sous 12 px, aucune couleur codée, `ds-audit` sans hausse).
- **FR-6** — Même comportement en local (v1) et en ligne (v2), sauf ce qui touche aux comptes.

## 8. Critères d'acceptation

- **AC-1** — Captures des trois états (vitrine, amorce avec 0, 5 et 15 titres, perso), ordinateur et
  téléphone, sans erreur dans la console ni réponse `/api` en erreur.
- **AC-2** — Un compte jetable : visite, ajoute 3 tendances, crée son compte, se déconnecte, se
  reconnecte : ses 3 titres sont là.
- **AC-3** — Une visite sans geste ne crée aucun compte dans Supabase.
- **AC-4** — Parité v1/v2 de `GET /api/vitrine` et de l'accueil en amorce (même forme, mêmes valeurs).
- **AC-5** — Aucune écriture dans les tests ni sur les données de Louis (comptes jetables, supprimés
  à la fin).

## 9. Étapes

| # | Étape | Dépend de |
|---|---|---|
| 0 | Finir le portage de `GET /api/accueil` (et des recommandations) : l'accueil d'un compte en dépend. | Portage en cours |
| 1 | Données des tendances en v1 : `/api/vitrine`, cache, tests. | — |
| 2 | Les sections en trois états (v1), avec leurs états dans `/design`. | 1 |
| 3 | Bouton et page de connexion. | Validation de l'archétype |
| 4 | Portage Rust de `/api/vitrine` et des règles d'amorce, parité. | 0, 1, 2 |
| 5 | Session au premier geste (proxy), déploiement des deux projets. | 3, 4 |
| 6 | Vérifications : captures, parcours AC-2, nettoyage des comptes jetables. | 5 |

## 10. Risques

- **Deux codes à tenir** (TS et Rust) pour les règles d'amorce : on les écrit une fois en v1, on
  prouve la parité, comme pour le reste.
- **Mélange de titres** : un titre tendance ne doit jamais passer pour un titre du compte (marque
  et libellé).
- **Quotas TMDB** : un seul appel par source toutes les 6 heures, quel que soit le nombre de visiteurs.
- **Pause du projet Supabase gratuit** : la vitrine en cache resterait visible, mais la connexion
  tomberait. À régler avant les entretiens (tâche d'entretien ou offre payante).

## 11. Décisions (Louis, 2026-11-05)

1. **Session au premier geste** (§ 5) plutôt qu'à chaque visite : oui.
2. **Page de connexion en palette de commandes** (`CommandLayout`) : oui.
3. **Mot de passe oublié** : hors périmètre pour l'instant.
4. **Toutes les pages locales** une fois connecté ou en démo (FR-0), avant la vitrine.

## 12. Réalisé (2026-11-06)

Code de l'interface dans l'arbre `.claude/worktrees/vitrine` (branche `feat/vitrine-connexion`), serveur
Rust dans `serveur/` du dépôt principal. Rien n'est commité ni déployé.

- **Données** : `src/lib/vitrine.ts` (tendances, à l'affiche et à venir, mieux notés, plus vus pour la
  notation ; cache de 6 h), `GET /api/vitrine` en v1 et en Rust (`serveur/src/vitrine.rs`, publique).
  Parité : réponses identiques champ par champ (envies, à la une, listes, notation), hors `tint`, que
  l'interface calcule en ligne comme en local (`src/lib/teintes.ts`, aussi pour `/api/accueil`).
- **Règles** : `src/lib/amorce.ts` (visiteur, bibliothèque qui démarre sous 30 titres, section vide
  remplie), 10 tests. Notation d'une bibliothèque qui démarre : `SuggestionRating` (« Tu l'as vu ? »,
  une note ajoute le titre vu et noté, « Pas vu » passe).
- **Connexion** : `CompteBouton` (barre du haut), page `/connexion` (`ConnexionForm`), états dans `/design`.
- **Session au premier geste** (`src/proxy.ts`) : l'accueil et les lectures d'API passent sans session ;
  la première écriture ou page de l'application ouvre la session invitée.
- **Sans Notion en local** : ajouter et retirer un titre ne passent plus par Notion
  (`src/lib/libraryActions.ts`), messages d'interface nettoyés.

Vérifications :
- tes données (copie) : accueil identique avant et après, au pixel, sauf la paire de duel tirée au hasard ;
- bibliothèque vide : toutes les sections remplies ; ajout et notation enregistrés, sans erreur ;
- en ligne (front en v2, serveur Rust local, Supabase) : regarder l'accueil ne crée aucun compte (AC-3) ;
  le premier ajout crée l'invité, le titre est dans sa bibliothèque, `/connexion` propose « Créer un
  compte » (compte de test supprimé) ;
- `tsc`, `eslint`, 254 tests, audit du système de design sans écart ; 222 tests Rust, clippy propre.

Reste : déployer les deux projets (bloqué par la sécurité automatique, à lancer par Louis), le cas d'un
compte durable de bout en bout en ligne (AC-2), et la mise à jour du contrat `parite/` pour `/api/vitrine`.
