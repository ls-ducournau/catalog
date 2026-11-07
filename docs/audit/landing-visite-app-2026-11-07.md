# Audit : page d'arrivée, « Fais le tour » et application, trois espaces à distinguer

**Date** : 2026-11-07 · **Site** : https://catalog-serveur.vercel.app (version du 2026-11-07)
**Méthode** : visite du site en ligne comme un inconnu (ordinateur et téléphone, lecture seule), comparée à
l'accueil d'un compte (base de Louis, copie). Corrigé le jour même, à la demande de Louis : plus de menus
d'application ni de barre d'onglets pour un visiteur ; plus aucun chapitre bloqué dans la visite.

## 1. Ce que chaque espace doit faire

| Espace | Pour qui | Son seul but | Il réussit si… |
|---|---|---|---|
| **Page d'arrivée** (`/`, visiteur) | Un inconnu venu d'un lien (Reddit, Discord, SensCritique…) | **Convaincre** : comprendre ce qu'est Catalog et en quoi c'est différent | il clique « Fais le tour » |
| **Fais le tour** (`/visite`) | Le même, une fois convaincu d'essayer | **Faire essayer** : vivre la boucle « je trie, je note, je départage, on me recommande » | il clique « Garder ce que j'ai fait » |
| **L'application** (compte) | Quelqu'un qui a sa bibliothèque | **Servir** : trouver quoi regarder, noter, ranger | il revient |

## 2. Ce qui ne va pas aujourd'hui

### Les trois espaces se ressemblent trop

1. **La page d'arrivée est l'accueil de l'application, rempli de tendances.** Même phrase d'accroche (« Tes films,
   séries et documentaires, à ton goût. »), mêmes sections dans le même ordre, mêmes composants (la fenêtre
   « À la une » avec son champ de recherche, la liste à onglets de la bibliothèque). Un inconnu voit un outil,
   pas une promesse.
2. **« Fais le tour » reprend la mise en page de la page d'arrivée** : même héros en éclats, mêmes sections
   « texte d'un côté, visuel de l'autre », en alternance. On croit relire la même page.
3. **L'accueil d'un compte garde le discours d'un visiteur.** Louis, avec 1 077 titres, lit encore « Note, classe,
   trouve quoi regarder ce soir : Catalog apprend de chacun de tes avis. »

### La page d'arrivée et la visite font deux fois la même chose

4. **Chaque section de la page d'arrivée est un petit chapitre de la visite** (trier, départager, cocher une
   liste, les sorties), suivi de « …dans la visite ». Le visiteur joue deux fois au même jeu, et la page fait
   5 500 px de haut sur ordinateur.
5. **Deux façons d'enregistrer, qui se contredisent.** Sur la page d'arrivée, « Ajouter à ma pile » (carrousel,
   « À la une », liste) écrit tout de suite et crée un compte invité ; le tri et les sorties, eux, restent dans le
   navigateur jusqu'à « Garder ». Pire : après un seul ajout, l'accueil bascule en « compte qui démarre »
   (réglages, « Ma pile à voir », compteurs) au rechargement suivant.
6. **Le vocabulaire de l'application, sans explication** : « Ta pile », « Suggestion », « Départage », « palier ».

### Il manque ce qu'une page d'arrivée doit dire

7. **Pourquoi Catalog plutôt que Letterboxd, SensCritique ou Betaseries ?** Rien ne le dit. C'est pourtant la
   première question des inconnus des entretiens, recrutés sur ces mêmes communautés.
8. **Pas de fin de page** : ni dernier appel à l'action, ni pied de page (qui fait Catalog, données personnelles,
   contact). Pour un site qui demande un e-mail, c'est attendu.

### La visite ne se vit pas comme un parcours

9. **Une longue page de neuf sections**, pas des étapes : on ne sait pas où on en est sans le fil collé en haut,
   et « Garder » n'apparaît qu'à la toute fin.
10. **Rien ne dit ce que l'application ajoute** à chaque chapitre (le vrai modèle de goûts, les abonnements, la
    compatibilité), donc la visite peut paraître plus pauvre que le produit.
11. **Après « Garder », rien n'accueille le nouveau venu** : il arrive sur la création de compte, puis sur sa
    bibliothèque, sans premier pas guidé.

## 3. Proposition : trois espaces, trois règles

| | Page d'arrivée | Fais le tour | Application |
|---|---|---|---|
| **Barre du haut** | Logo, « Se connecter », « Fais le tour » (fait) | Logo, « Étape 3 sur 8 », « Quitter la visite » | Menus, réglages, « Ajouter », « Ce soir » |
| **Enregistre ?** | Jamais | Dans le navigateur, jusqu'à « Garder » | Toujours |
| **Ton** | La promesse : ce que tu y gagnes | Le geste : essaie | L'outil : ta pile, tes notes |
| **Rythme** | Court : cinq blocs | Une étape à l'écran | Dense, aller droit au contenu |
| **Visuel** | Grandes affiches, éclats de la marque | La fenêtre de commande, comme dans l'application | L'application |

### Page d'arrivée : cinq blocs, aucun geste qui écrit

1. **Héros** : la promesse en une phrase, un seul bouton principal « Fais le tour (3 min) », et « Se connecter ».
   À côté, un aperçu vivant mais muet (une carte de tri qui défile).
2. **Comment ça marche, en trois temps** : tu tries et tu notes ; tu départages ; Catalog te recommande et te
   dit quoi regarder ce soir. Chaque temps renvoie au chapitre de la visite.
3. **Tout ce que tu y trouves** : une grille des huit parties (icône, une ligne, « Essayer » vers le chapitre).
4. **Pourquoi Catalog** : trois différences (à écrire avec Louis, voir § 5).
5. **Dernier appel et pied de page** : « Fais le tour », puis à propos, données personnelles, contact.

À retirer de la page d'arrivée : « Ajouter à ma pile » partout, la fenêtre « À la une », la liste à onglets,
les démonstrations de duel, de liste et de sorties (elles vivent dans la visite).

### Fais le tour : un parcours pas à pas

- Une étape à l'écran, « Précédent » et « Suivant » (et le clavier), « Étape n sur 8 » en haut.
- Une barre fixe en bas : « Garder ce que j'ai fait · 6 titres, 4 notes », disponible dès la première action.
- Chaque étape : une phrase sur le pourquoi, le geste, et « Dans l'application, en plus : … ».
- Après « Garder » : un premier pas guidé dans l'application (« Encore 6 notes pour tes recommandations »,
  l'état « bibliothèque qui démarre » existe déjà).

### Application : l'accueil d'un compte n'est plus une page d'arrivée

- Un héros compact : une salutation selon l'heure, trois actions (Ce soir, Noter, Duels) et les compteurs ;
  puis les sections du compte, comme aujourd'hui.

## 4. Ordre proposé

| # | Lot | Effet |
|---|---|---|
| 1 | La page d'arrivée n'écrit plus rien ; on retire « À la une », la liste et les démonstrations en double | Fin des deux façons d'enregistrer, page deux fois plus courte |
| 2 | Visite pas à pas, barre « Garder » fixe, « Dans l'application, en plus » | La visite devient un parcours, distinct de la page d'arrivée |
| 3 | Page d'arrivée en cinq blocs (comment ça marche, la grille, pourquoi, pied de page) | La page convainc, au lieu de montrer l'outil |
| 4 | Héros compact pour un compte, premier pas après « Garder » | L'application se distingue de la vitrine |

## 5. À décider par Louis

1. Les trois espaces et leurs règles (§ 3) ?
2. Les arguments de « Pourquoi Catalog » : lesquels sont vrais et voulus ? Par exemple : il apprend de tes
   notes (pas des notes des autres) ; sans publicité ; tes données t'appartiennent (export et suppression,
   FR-9) ; gratuit. Aucun ne sera écrit sans ton accord.
3. La visite pas à pas (une étape à l'écran) plutôt que la longue page actuelle ?
4. Le pied de page : quel nom et quel contact afficher ?
