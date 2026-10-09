# Playlists faites à la main — v1

**Auteur** : Claude (assisté) · **Date** : 2026-10-06 · **Statut** : Livré le 2026-10-06 · **Relecteur** : Louis

## 1. Contexte

Idée d'une testeuse (2026-09-28) : pouvoir faire des playlists, des regroupements de titres
personnalisés (« la trilogie à revoir », « films de Noël », « à regarder à deux »). Décision de
l'utilisateur : **à la main seulement**. Pas de playlist automatique (par genre, par note…) :
ce que les filtres de la bibliothèque et les recommandations font déjà.

Une playlist est une liste nommée et **ordonnée** de titres de ta bibliothèque. L'ordre compte :
c'est celui dans lequel tu veux les regarder (une saga, un marathon) ou les montrer.

## 2. Exigences fonctionnelles

### Playlists

- **FR-1** (créer) — L'utilisateur DOIT pouvoir créer une playlist avec un nom (1 à 60
  caractères) et, s'il veut, une description courte (200 caractères au plus).
- **FR-2** (modifier) — Il DOIT pouvoir renommer une playlist et changer sa description.
- **FR-3** (supprimer) — Il DOIT pouvoir supprimer une playlist. La suppression s'annule pendant
  quelques secondes (« Annuler », Ctrl+Z), sans boîte de confirmation. Les titres restent dans
  la bibliothèque.

### Titres d'une playlist

- **FR-4** (ajouter depuis la fiche) — La fiche d'un titre DOIT offrir « Ajouter à une
  playlist » : la liste de tes playlists, une coche sur celles qui le contiennent déjà (un clic
  l'ajoute ou le retire), et « Nouvelle playlist… », qui la crée avec ce titre dedans.
- **FR-5** (ajouter depuis la playlist) — La page d'une playlist DOIT offrir un champ « Ajouter
  un titre » qui cherche dans ta bibliothèque pendant la frappe ; ↵ ou un clic ajoute le titre
  en fin de liste.
- **FR-6** (unicité) — Un titre peut appartenir à plusieurs playlists, mais une seule fois à une
  même playlist. L'ajouter de nouveau ne change rien et le dit.
- **FR-7** (ordre) — L'utilisateur DOIT pouvoir réordonner les titres : glisser-déposer à la
  souris ou au doigt, et au clavier (le titre qui a le focus monte et descend avec Alt+↑ et
  Alt+↓). Un nouveau titre arrive en fin de liste.
- **FR-8** (retirer) — Il DOIT pouvoir retirer un titre d'une playlist, avec « Annuler ».
- **FR-9** (bibliothèque seulement) — Seuls les titres de ta bibliothèque entrent dans une
  playlist. Un titre retiré de la bibliothèque (bibliotheque-v1 FR-9) quitte aussi tes playlists.

### Pages

- **FR-10** (liste des playlists) — Une page « Playlists » (`/playlists`) DOIT présenter tes
  playlists en cartes. Chaque carte porte une couverture composée des affiches de ses quatre
  premiers titres, le nom, le nombre de titres, la durée totale si elle est connue, et la part
  déjà vue (« 5 sur 12 vus »). Elle offre aussi « Nouvelle playlist ». Sans playlist, un état
  vide explique la fonction et propose d'en créer une.
- **FR-11** (une playlist) — La page d'une playlist (`/playlists/<id>`) DOIT montrer son nom, sa
  description, ses chiffres (titres, durée totale, vus), puis ses titres dans l'ordre, chacun
  avec son affiche, son année, son statut (vu, à voir), ta note et sa bande-annonce. Un clic
  ouvre la fiche.
- **FR-12** (à suivre) — La page d'une playlist DOIT mettre en avant le **prochain titre à
  voir** : le premier non vu, dans l'ordre de la liste. On peut le marquer vu depuis là (Ce soir
  FR-7, « Je regarde ça »). Quand tout est vu, la page le dit.
- **FR-13** (navigation) — « Playlists » DOIT rejoindre le menu « Ta collection » (ordinateur)
  et le menu « Plus » (téléphone).

## 3. Exigences non fonctionnelles

- **NFR-1** (local) — Les playlists vivent dans la base locale (SQLite), comme les écartements
  et les avis sur les personnes. Rien n'est écrit vers Notion : le schéma Notion n'a pas de
  place pour elles.
- **NFR-2** (vitesse) — Ajouter, retirer ou réordonner s'applique tout de suite à l'écran, sans
  attendre le serveur. Un échec est signalé et l'écran revient à l'état d'avant.
- **NFR-3** (design) — Le système de design v2 s'applique :
  - les deux pages suivent l'archétype `CatalogLayout` (le Store) ; `DetailLayout` reste celui de
    la fiche d'un titre, dans son panneau ;
  - les affiches dominent les cartes (fiche `composants/vitrine.md`) ;
  - les gestes sont annulables, avec leurs touches.

## 4. Critères d'acceptation

- **AC-1** (FR-1, FR-10) — Given aucune playlist, When je crée « Saga Alien », Then elle
  apparaît sur `/playlists` avec 0 titre.
- **AC-2** (FR-4) — Given la fiche d'*Alien* et la playlist « Saga Alien », When je coche
  « Saga Alien », Then *Alien* est le dernier titre de la playlist ; When je décoche, Then il
  n'y est plus.
- **AC-3** (FR-6) — Given *Alien* déjà dans « Saga Alien », When je l'ajoute depuis le champ de
  la playlist, Then la liste ne change pas et un message dit qu'il y est déjà.
- **AC-4** (FR-7) — Given les titres A, B, C dans cet ordre, When je glisse C avant A, Then
  l'ordre devient C, A, B et le reste après un rechargement de la page.
- **AC-5** (FR-7) — Given le focus sur B dans A, B, C, When j'appuie sur Alt+↑, Then l'ordre
  devient B, A, C et le focus reste sur B.
- **AC-6** (FR-3) — Given « Saga Alien » et ses 4 titres, When je la supprime puis clique
  « Annuler », Then elle revient avec ses 4 titres, dans le même ordre.
- **AC-7** (FR-9) — Given *Alien* dans deux playlists, When je le retire de la bibliothèque,
  Then il n'apparaît plus dans aucune.
- **AC-8** (FR-12) — Given A (vu), B (à voir), C (à voir), When j'ouvre la playlist, Then B est
  mis en avant comme prochain titre à voir ; When je marque B vu, Then C prend sa place.
- **AC-9** (FR-10) — Given une playlist de deux films de 2 h et 1 h 30, When la liste des
  playlists s'affiche, Then sa carte indique « 3 h 30 ».

## 5. Cas limites

- **EC-1** — Nom vide ou fait d'espaces : refusé, le champ le dit. Deux playlists peuvent porter
  le même nom ; la liste les distingue par leur contenu et leur couverture.
- **EC-2** — Playlist de moins de quatre titres : la couverture complète avec les affiches
  disponibles ; sans titre, une couverture neutre.
- **EC-3** — Durée inconnue pour certains titres : la durée totale porte sur les titres connus
  et le précise (« au moins 6 h »). Une série compte pour la durée d'un épisode, et la page le
  précise.
- **EC-4** — Glisser-déposer annulé (Échap ou relâché hors de la liste) : l'ordre ne change pas.
- **EC-5** — Playlist ouverte dans deux onglets : le dernier ordre enregistré l'emporte (pas de
  fusion).

## 6. Précisions de mise en œuvre

- Tables : `playlists (id, name, description, created_at, updated_at)` et
  `playlist_items (playlist_id, item_id, position, added_at)`, clé `(playlist_id, item_id)`,
  avec suppression en cascade côté playlist et côté titre.
- Routes : `/api/playlists` (liste, création), `/api/playlists/<id>` (lecture, modification,
  suppression), `/api/playlists/<id>/items` (ajout, retrait, ordre). La suppression renvoie de
  quoi tout recréer (l'annulation de FR-3).
- Durée : celle des caractéristiques TMDB en cache (`runtime`), sans appel réseau.

## 7. Livraison (2026-10-06)

- Service `src/lib/playlistService.ts`, testé critère par critère (`playlistService.test.ts`) ;
  routes sous `src/app/api/playlists/` ; libellés et limites dans `src/lib/playlistFormat.ts`.
- Pages `src/app/playlists/` et composants `src/components/playlists/` : couverture en mosaïque
  d'affiches (`PlaylistCover`), liste (`PlaylistsIndex`), page d'une playlist (`PlaylistView` :
  « À suivre », champ d'ajout, lignes réordonnables par la poignée ou Alt+↑ et Alt+↓), sélecteur
  de la fiche (`PlaylistPicker`, déplié sur place pour ne pas être coupé par le panneau).
- Un titre retiré de la bibliothèque quitte ses playlists dans `deleteItemLocally`.
- La suppression d'une playlist depuis sa page renvoie à la liste, qui propose « Annuler »
  pendant 8 secondes (instantané gardé en session).

## 8. Hors périmètre (v1)

- Playlists automatiques ou intelligentes (décision de l'utilisateur).
- Titres hors bibliothèque (Sorties, À découvrir) : on les ajoute d'abord à la pile, comme
  aujourd'hui.
- Partage, export, synchronisation Notion, couverture choisie à la main.
- Playlists dans Ce soir, sur l'accueil ou dans les recommandations.

## 9. Questions ouvertes

- **Q1** — Ajouter plusieurs titres d'un coup depuis la bibliothèque (sélection multiple) ?
  Proposé : non en v1, la fiche et le champ de la playlist suffisent.
- **Q2** — Faut-il, plus tard, une rangée « Tes playlists » sur l'accueil, avec le prochain
  titre à voir de chacune ? Proposé : à décider après usage.
