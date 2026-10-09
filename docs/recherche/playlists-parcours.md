# Playlists : parcours actuel et pistes (recherche UX)

**Date** : 2026-10-06 · **Méthode** : `ux-researcher-designer`, carte de parcours (état actuel) et
synthèse · **Suite de** : `specs/playlists-v1.md` (livrée le 2026-10-06)

## 1. Niveau de preuve

- **Participants** : 2. Louis, qui a testé la v1 (« c'est un début, il faut aller plus loin »),
  et une testeuse (l'idée d'origine : « un regroupement de titres personnalisé »).
- **Données** : aucune mesure d'usage. La base n'avait aucune playlist avant le test.
- **Conséquence** : tout ce qui suit est une **hypothèse**, issue d'une revue experte de la v1.
  Chaque friction porte le nombre de personnes qui l'ont réellement signalée. À 0 ou 1, c'est
  une anecdote à confirmer, pas un constat.

## 2. Périmètre

| Élément | Valeur |
|---|---|
| Qui | Quelqu'un qui regarde surtout à la maison, seul ou à deux, avec une grande bibliothèque (1 069 titres) |
| But | Rassembler des titres autour d'une idée, puis les regarder dans l'ordre voulu |
| Début | Une idée : « les films de Noël », « la saga à revoir », « ce que je veux lui montrer » |
| Fin | Les titres de la playlist sont vus, ou la playlist sert de mémoire |
| Durée | De quelques minutes (créer) à plusieurs semaines (regarder) |

## 3. Carte du parcours (v1)

Émotion notée de 1 (pénible) à 5 (agréable), estimée.

| Étape | Ce qu'on fait | Où | Émotion | Frictions supposées | Signalé par |
|---|---|---|---|---|---|
| 1. Avoir l'idée | Penser à un thème, à une soirée | Hors de l'app | – | Rien ne suggère de créer une playlist au bon moment, par exemple après un coup de cœur ou devant un titre de Sorties | 0/2 |
| 2. Créer | « Nouvelle playlist », un nom | `/playlists`, fiche | 4 | Simple. Mais la playlist n'a pas d'identité : pas de couverture choisie, pas d'emoji ni de couleur | 0/2 |
| 3. Remplir | Chercher chaque titre par son nom, ou ouvrir chaque fiche | Champ de la playlist, fiche | **2** | **Un titre à la fois.** Il faut se souvenir des titres. Impossible d'ajouter depuis les cartes de la bibliothèque, Recommandations, Sorties, Ce soir ou le Tri rapide. Impossible de sélectionner plusieurs titres. Aucune aide pour compléter le thème | 1/2 (Louis) |
| 4. Organiser | Glisser, Alt+↑ et Alt+↓ | Page de la playlist | 4 | Pas de tri en un geste (par date de sortie pour une saga, par durée). Pas de note par titre (« à voir après le 2 »). Pas de sections | 0/2 |
| 5. Choisir quoi regarder | Lire « À suivre » | Page de la playlist | 3 | On ne voit pas où le regarder (abonnements, déjà présent dans Ce soir). Pas de durée ni d'heure de fin. Ce soir ignore les playlists | 1/2 (Louis) |
| 6. Regarder | « Je regarde ça » | Page de la playlist | 3 | Après visionnage, pas d'invitation à noter (le lien avec Notation manque). La progression se résume à « 1 sur 7 vu », sans geste pour enchaîner | 1/2 (Louis) |
| 7. Revenir | Rouvrir l'app un autre soir | Accueil, menu | **2** | Les playlists n'existent que dans le menu « Ta collection ». Rien sur l'accueil pour reprendre la playlist en cours | 1/2 (Louis) |
| 8. Partager | Montrer la liste à quelqu'un | – | 1 | Rien : ni lien, ni export, ni liste lisible hors de l'app | 0/2 |

### Retour de test (2026-10-06)

Louis, après avoir testé la v1, situe les manques à trois étapes : **Remplir**, **Regarder** et
**Revenir**. Organiser et l'identité de la playlist ne lui ont pas manqué. Avec un seul
participant, cela oriente le travail sans le prouver : le test de la section 5 avec la testeuse
dira si elle bute aux mêmes endroits.

## 4. Pistes classées

Score = Fréquence × Gravité × Faisabilité (1 à 5 chacun, estimés). Ce classement sert de point de
départ à la priorisation (piste PRIORITIZE, avec RICE), pas de décision.

| # | Piste | Étape | F | G | Fa | Score |
|---|---|---|---|---|---|---|
| P1 | Ajouter depuis partout : bouton « + playlist » sur les cartes (bibliothèque, Recommandations, Sorties, Ce soir, Tri rapide) | 3 | 5 | 4 | 4 | 80 |
| P2 | Sélection multiple dans la bibliothèque, puis « Ajouter à une playlist » | 3 | 4 | 4 | 4 | 64 |
| P3 | Suggestions pour compléter : titres de ta bibliothèque proches de ceux de la playlist (genres, réalisation, mots-clés). Tu choisis, la playlist reste faite à la main | 3 | 4 | 3 | 4 | 48 |
| P4 | « Reprendre » sur l'accueil : la playlist en cours et son prochain titre | 7 | 4 | 3 | 4 | 48 |
| P5 | Après « Je regarde ça », proposer la note (les six touches de Notation) et enchaîner sur le suivant | 6 | 4 | 3 | 4 | 48 |
| P6 | « Où le regarder » et l'heure de fin sur « À suivre » ; Ce soir peut piocher dans une playlist | 5 | 3 | 3 | 4 | 36 |
| P7 | Trier en un geste : date de sortie, durée, ta note, compatibilité | 4 | 2 | 3 | 5 | 30 |
| P8 | Identité : emoji ou couleur, couverture choisie parmi les affiches | 2 | 2 | 2 | 5 | 20 |
| P9 | Partage : une page en lecture seule ou un export texte | 8 | 1 | 3 | 3 | 9 |

## 5. Test d'utilisabilité proposé (rapide, en guérilla)

Deux participants (Louis et la testeuse), 10 minutes chacun, en pensant à voix haute. Au-dessous de
5 participants, le test sert à repérer les problèmes, pas à les mesurer.

| Tâche | Scénario | Réussite |
|---|---|---|
| T1 Remplir | « Prépare une playlist “Films de Noël” avec 5 titres de ta bibliothèque. » | 5 titres en moins de 3 minutes |
| T2 Organiser | « Mets cette saga dans l'ordre de sortie. » | Ordre correct, sans aide |
| T3 Regarder | « Choisis ce que vous regardez ce soir dans “À regarder à deux”, puis note-le une fois vu. » | Titre lancé et noté, sans aide |
| T4 Revenir | « Le lendemain, reprends là où tu en étais. » | Trouve la playlist et le titre suivant en moins de 20 secondes |

À noter pour chaque tâche : réussite, temps, hésitations (gravité de 1 à 4) et citations.

## 6. Résultat visé (à valider)

Proposition : **une playlist créée est remplie (5 titres ou plus) et regardée (au moins 1 titre vu
depuis la playlist) dans les deux semaines.** Ce résultat se mesurera en local, dans le journal
d'événements (`events`), sans rien envoyer. Il faut d'abord journaliser les gestes des playlists
(création, ajout, « Je regarde ça »), ce que la v1 ne fait pas encore.

## 7. Suite

Priorisation formelle écartée par l'utilisateur (2026-10-06) : son test désigne déjà Remplir,
Regarder et Revenir. Les pistes P1 à P6 deviennent la spec `specs/playlists-v2.md`. P7 à P9
attendent un retour qui les réclame.
