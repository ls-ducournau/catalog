# Playlists : remplir, regarder, revenir — v2

**Auteur** : Claude (assisté) · **Date** : 2026-10-06 · **Statut** : Livré le 2026-10-06 · **Relecteur** : Louis

## 1. Contexte

La v1 (`specs/playlists-v1.md`) permet de créer une playlist, d'y ajouter des titres un par un et
de les ordonner. Testée le 2026-10-06, elle paraît « un début ». La recherche
(`docs/recherche/playlists-parcours.md`) situe les manques à trois étapes, confirmées par le test
de l'utilisateur (1 participant sur 2, donc une orientation plutôt qu'une preuve) :

- **Remplir** : ajouter est laborieux, un titre à la fois, par son nom ou depuis sa fiche.
- **Regarder** : « À suivre » ne dit pas où regarder, et rien ne relie la playlist à la note ou
  à Ce soir.
- **Revenir** : la playlist en cours n'apparaît nulle part en dehors de son menu.

La v2 traite ces trois étapes. Organiser (tri en un geste), l'identité (emoji, couverture) et le
partage attendent un retour qui les réclame.

**Résultat visé** : une playlist créée est remplie (5 titres ou plus) et regardée (au moins un
titre vu depuis la playlist) dans les deux semaines. Mesuré en local (FR-12).

## 2. Exigences fonctionnelles

### Remplir

- **FR-1** (depuis les cartes) — Les cartes de titre de la bibliothèque et des Recommandations
  (`ItemCard`) DOIVENT offrir « Ajouter à une playlist » : le même sélecteur que la fiche (v1
  FR-4), avec une coche par playlist et « Nouvelle playlist… ». Au survol à la souris, toujours
  visible au doigt, comme les autres gestes de la carte.
- **FR-2** (depuis les autres vues) — Le même geste DOIT exister sur les cartes de Ce soir, de
  Sorties, du Tri rapide « à découvrir » et des suggestions « À découvrir ».
- **FR-3** (titre hors bibliothèque) — Ajouter à une playlist un titre qui n'est pas dans ta
  bibliothèque l'y ajoute d'abord, à voir, comme « Ajouter » aujourd'hui, puis le met dans la
  playlist, en un seul geste. L'annulation retire les deux. *Change la v1, qui limitait les
  playlists aux titres déjà dans la bibliothèque.*
- **FR-4** (sélection multiple) — La bibliothèque DOIT offrir un mode « Sélectionner » : une
  case sur chaque carte, Maj+clic pour une plage, puis une barre d'action « Ajouter à une
  playlist (n) ». Les titres déjà présents sont ignorés, et le message le dit (« 7 ajoutés, 2
  déjà dedans »).
- **FR-5** (suggestions) — La page d'une playlist qui contient au moins deux titres DOIT
  proposer « Pour compléter » : jusqu'à 8 titres de ta bibliothèque, absents de la playlist, les
  plus proches de ceux qu'elle contient (genres, mots-clés, réalisation, distribution). Un
  clic en ajoute un. « Pas celui-là » l'écarte des suggestions de cette playlist. Rien n'entre
  sans ton clic : la playlist reste faite à la main.

### Regarder

- **FR-6** (où et combien de temps) — « À suivre » DOIT dire où regarder le titre (tes
  abonnements d'abord, sinon les autres services) et, pour un film, sa durée et son heure de fin
  si tu lances maintenant.
- **FR-7** (noter ce qu'on a vu) — La page d'une playlist DOIT proposer de noter les titres
  qu'elle contient, vus mais sans note, le plus récemment vu d'abord : la grille des six notes
  de Notation (0 pour 💩, 1 à 5), au clavier quand elle a le focus, annulable.
- **FR-8** (Ce soir) — Ce soir DOIT offrir une troisième source, « Une playlist », à côté de
  « Ta pile » et « Tout le catalogue ». Les propositions se limitent alors aux titres de cette
  playlist pas encore vus. Les autres réglages (envie, durée, avec qui, où) s'appliquent toujours.
- **FR-9** (enchaîner) — Après « Je regarde ça » dans une playlist, « À suivre » passe au titre
  suivant. Le titre qu'on vient de lancer reste annulable.

### Revenir

- **FR-10** (section Playlists de l'accueil, décision de l'utilisateur du 2026-10-06 : pas
  juste sous le héros) — Les playlists DOIVENT devenir une fonction clé de la vitrine : une
  section « texte et visuel » (`FeatureSection`), placée après « Ta bibliothèque », dans
  l'alternance gauche-droite. Son visuel est vivant :
  - avec une playlist en cours (celle qui a un titre non vu et le geste le plus récent) : sa
    couverture, sa progression, son prochain titre (affiche, où le regarder, heure de fin) et
    « Je regarde ça » ;
  - sans playlist en cours : une invitation à en créer une, avec « Nouvelle playlist ».
- **FR-11** (la liste des playlists) — `/playlists` DOIT mettre en tête les playlists en cours,
  avec leur prochain titre, et regrouper à part celles qui sont entièrement vues.

### Mesure

- **FR-12** (journal) — Les gestes des playlists DOIVENT être journalisés en local
  (`events`) : création, ajout (avec sa source : fiche, carte, sélection, suggestion, Ce soir…),
  retrait, « Je regarde ça » depuis une playlist, note posée depuis une playlist. Rien ne sort
  de la machine.

## 3. Exigences non fonctionnelles

- **NFR-1** — Toujours local, rien vers Notion pour les playlists elles-mêmes. Seul l'ajout d'un
  titre hors bibliothèque (FR-3) passe par Notion, comme tout ajout à la pile.
- **NFR-2** — Les suggestions (FR-5) se calculent depuis les caractéristiques TMDB en cache, sans
  appel réseau, en moins de 300 ms pour une bibliothèque de 1 100 titres.
- **NFR-3** — Système de design v2. Un seul composant de sélection de playlist, partagé par la
  fiche, les cartes et la barre de sélection. L'affiche domine les cartes
  (`feedback-vitrine-visuelle`). Chaque geste est annulable.

## 4. Critères d'acceptation

- **AC-1** (FR-1) — Given une carte de la bibliothèque, When je choisis « Ajouter à une
  playlist » puis « Saga Alien », Then le titre est le dernier de « Saga Alien », sans que la
  fiche s'ouvre.
- **AC-2** (FR-3) — Given un film de Sorties absent de la bibliothèque, When je l'ajoute à
  « Films de Noël », Then il est dans la bibliothèque (à voir) et dans la playlist ; When
  j'annule, Then il n'est plus dans aucune des deux.
- **AC-3** (FR-4) — Given 9 cartes sélectionnées dont 2 déjà dans la playlist, When je les ajoute,
  Then 7 titres sont ajoutés dans l'ordre de la sélection et le message dit « 7 ajoutés, 2
  déjà dedans ».
- **AC-4** (FR-5) — Given une playlist avec *Alien* et *Aliens*, When les suggestions
  s'affichent, Then aucune n'est déjà dans la playlist, et un titre de la même saga ou du même
  réalisateur, s'il est dans la bibliothèque, passe avant un titre sans lien.
- **AC-5** (FR-7) — Given deux titres de la playlist vus sans note, When j'appuie sur 4 dans la
  grille, Then le plus récemment vu reçoit 4 étoiles et la grille passe à l'autre.
- **AC-6** (FR-8) — Given la source « Une playlist » et « Soirées d'automne », When Ce soir
  propose, Then chaque titre proposé est dans cette playlist et pas encore vu.
- **AC-7** (FR-10) — Given une playlist avec un titre à voir et une autre entièrement vue, When
  j'ouvre l'accueil, Then la section Playlists, placée après « Ta bibliothèque », montre la
  première et son prochain titre ; Given aucune playlist, Then elle invite à en créer une.
- **AC-8** (FR-12) — Given un ajout depuis une carte, When je lis le journal, Then on trouve un
  événement d'ajout à une playlist, avec la source « carte ».

## 5. Cas limites

- **EC-1** — Aucune playlist au moment d'ajouter depuis une carte : le sélecteur propose
  directement « Nouvelle playlist… ».
- **EC-2** — Ajout d'un titre hors bibliothèque alors que Notion ne répond pas : rien n'est
  ajouté (ni à la pile, ni à la playlist), et le message le dit.
- **EC-3** — Moins de deux titres dans la playlist, ou pas de caractéristiques TMDB : pas de
  suggestions, sans message d'erreur.
- **EC-4** — Ce soir sur une playlist entièrement vue : Ce soir le dit et propose de revenir à
  « Ta pile ».

## 6. Ordre de réalisation

1. FR-12 (journal), pour mesurer dès le premier ajout.
2. Remplir : FR-1 et FR-2 (le sélecteur partagé), FR-3, puis FR-4 et FR-5.
3. Revenir : FR-10 et FR-11.
4. Regarder : FR-6, FR-7, FR-9, puis FR-8.

## 7. Livraison (2026-10-06)

- Journal : nouveaux événements `playlist_*` dans `journalService`, avec la source du geste ;
  service étendu (`addManyToPlaylist`, `watchFromPlaylist`, `rateFromPlaylist`, `currentPlaylist`,
  `suggestForPlaylist`, `dismissSuggestion`), testé critère par critère.
- Un seul sélecteur, `PlaylistChooser` : déplié dans la fiche (`PlaylistPicker`), en fenêtre partout
  ailleurs (`PlaylistDialogHost`, montée dans la mise en page et ouverte par `openPlaylistDialog`).
  Boutons sur `ItemCard` (bibliothèque, Recommandations), `DiscoverCard`, Sorties, Ce soir et le
  Tri rapide « à découvrir » ; barre de sélection de la bibliothèque, avec Maj+clic.
- Page d'une playlist : « À suivre » avec durée, heure de fin et `WhereToWatch` ; « À noter »
  (grille `RatingKeys`) ; « Pour compléter » (affiches, « + », « Pas celui-là »).
- Accueil : section Playlists après « Ta bibliothèque » (`PlaylistPreview`), visuel à gauche.
- Ce soir : source « Une playlist » et choix de la playlist ; repli sur « Ma pile » sans playlist.
- Vérifié de bout en bout sur une copie de la base (serveur de test, sans Notion), puis supprimée.

## 8. Hors périmètre (v2)

- Tri en un geste, notes par titre, sections (étape Organiser : non signalée).
- Emoji, couleur, couverture choisie (identité : non signalée).
- Partage et export.
- Playlists automatiques (décision de la v1).
