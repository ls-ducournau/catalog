# Spec — Bibliothèque (v1)

**Auteur** : Claude (assisté) · **Date** : 2026-09-24 · **Statut** : Draft · **Relecteur** : Louis

## 1. Contexte

Les duels (v1) et les recommandations (v1) sont livrés et utilisés en conditions réelles (1095 duels joués). Il manque la brique la plus basique du pitch de départ : pouvoir **parcourir sa bibliothèque, marquer un item vu/à voir, et éditer sa note/son ressenti** sans repasser par l'interface Notion.

**Extension de scope assumée** : la spec des duels (FR-13/EC-2) limitait le push Notion aux champs `Elo Score`/`Ressenti` pour éviter d'écraser des champs gérés ailleurs. Cette bibliothèque introduit l'édition de `Watch Status` et `Rating` *depuis l'app* — ces deux champs rejoignent donc la liste des champs poussés vers Notion (voir FR-6). Les autres champs (Genre, Director, TMDB Rating, IMG...) restent en lecture seule dans l'app, gérés uniquement par l'automatisation Notion existante.

## 2. Exigences fonctionnelles (FR)

- **FR-1** — Le système DOIT lister les items avec pagination (taille de page par défaut : 24).
- **FR-2** — Le système DOIT permettre de filtrer la liste par `Type` (Movie/TV Series/tous), par `Watch Status` (Watched/Unwatched/Watching/tous), et par recherche texte sur le nom (contient, insensible à la casse).
- **FR-3** — Chaque item de la liste DOIT afficher : affiche, nom, année, type, `Watch Status` actuel, `Rating` actuel (étoiles), score Elo si `duels_count >= 1`.
- **FR-4** — L'utilisateur DOIT pouvoir changer le `Watch Status` d'un item directement depuis la liste (sélecteur à 3 valeurs).
- **FR-5** — L'utilisateur DOIT pouvoir éditer le `Rating` (échelle Notion existante : 💩, ⭐️ à ⭐️⭐️⭐️⭐️⭐️) et le `Ressenti` (texte libre) d'un item, dans un panneau de détail ouvert au clic sur l'item.
- **FR-6** — Toute modification de `Watch Status`, `Rating` ou `Ressenti` DOIT marquer l'item `local_dirty = 1` et être incluse dans le prochain push Notion (extension de `pushToNotion`, en plus de `Elo Score`).
- **FR-7** — Un changement de `Watch Status` vers `Unwatched` sur un item ayant un historique de duels NE DOIT PAS effacer son `elo_score`/`duels_count` (l'historique reste, l'item redevient simplement inéligible aux futurs duels tant qu'il n'est pas repassé à `Watched`).
- **FR-8** — Le `Rating` NE DOIT être modifiable que pour un item `Watched` (ou qui le devient dans la même requête) — noter un item `Unwatched`/`Watching` n'a pas de sens. Une tentative de modification du `Rating` sur un item ne remplissant pas cette condition DOIT être silencieusement ignorée (les autres champs du patch s'appliquent normalement), aussi bien côté API que côté interface.
- **FR-9** — Le système DOIT permettre de filtrer/distinguer les documentaires des films/séries "classiques", malgré l'absence d'une 3e valeur `Documentary` dans le schéma Notion `Type` (Movie/TV Series uniquement). Un item `Movie` ou `TV Series` dont le `Genre` contient "Documentary" DOIT être classé dans une catégorie `Documentary` distincte pour le filtre Type — pas dans Films ni Séries.

## 3. Exigences non-fonctionnelles (NFR)

- **NFR-1** — Une page de résultats (24 items, filtres appliqués) DOIT s'afficher en moins de 300 ms depuis SQLite local.
- **NFR-2** — L'édition du `Ressenti` DOIT être sauvegardée automatiquement (debounce ~600 ms après la dernière frappe), sans bouton "Enregistrer" explicite requis.
- **NFR-3** — Même direction visuelle que les écrans existants (dark UI).

## 4. Critères d'acceptation (AC)

- **AC-1** (FR-2) — Given le filtre `Watch Status = Watched` et une recherche "matrix", When appliqués ensemble, Then seuls les items vus dont le nom contient "matrix" (insensible à la casse) apparaissent.
- **AC-2** (FR-4, FR-6) — Given un item `Unwatched`, When l'utilisateur le passe à `Watched` depuis la liste, Then son `watch_status` est mis à jour localement, l'item est marqué `local_dirty`, et il devient éligible aux duels (cf. spec duels FR-3) sans re-synchronisation manuelle.
- **AC-3** (FR-5) — Given le panneau de détail ouvert, When l'utilisateur choisit une note et tape un ressenti, Then les deux valeurs sont persistées localement (visibles après réouverture du panneau, y compris après rechargement de la page).
- **AC-4** (FR-7) — Given un item avec `elo_score = 1350` et `duels_count = 12`, When il est repassé à `Unwatched`, Then `elo_score` et `duels_count` restent inchangés en base.
- **AC-5** (FR-1) — Given plus de 24 items correspondant aux filtres, When la première page est affichée, Then une pagination permet d'accéder aux pages suivantes sans recharger tous les items d'un coup.
- **AC-6** (FR-8) — Given un item `Unwatched` ou `Watching`, When une requête tente de lui poser une note, Then la note n'est pas appliquée (reste inchangée) alors qu'un éventuel changement de statut dans la même requête, lui, s'applique normalement.

## 5. Cas limites (EC)

- **EC-1** — Aucun item ne correspond aux filtres : message explicite "aucun résultat", pas de liste vide silencieuse.
- **EC-2** — Ressenti vidé complètement (texte effacé) : DOIT être poussé comme chaîne vide vers Notion (pas ignoré), pour permettre d'effacer une note existante.
- **EC-3** — Changement de `Watch Status` puis changement immédiat inverse avant tout push : seul l'état final compte (pas d'accumulation d'historique de changements à pousser, juste l'état courant de la ligne).

## 6. Contrats d'API

```typescript
// GET /api/items?type=&watchStatus=&q=&page=1&pageSize=24
type ItemsResponse = {
  items: LibraryItem[];
  page: number;
  pageSize: number;
  total: number;
};

type LibraryItem = {
  id: number;
  name: string;
  year: string | null;
  type: "Movie" | "TV Series";
  watchStatus: "Watched" | "Unwatched" | "Watching";
  posterUrl: string | null;
  rating: string | null; // valeur emoji Notion, ex. "⭐️⭐️⭐️"
  ressenti: string | null;
  eloScore: number | null; // null si duels_count = 0 (pas de signal réel, cf. AC-3 duels-elo-v1)
  duelsCount: number;
};

// PATCH /api/items/:id
type UpdateItemRequest = Partial<{
  watchStatus: "Watched" | "Unwatched" | "Watching";
  rating: string | null;
  ressenti: string | null;
}>;
type UpdateItemResponse = LibraryItem;
```

## 7. Modèles de données

Aucune nouvelle colonne — utilise `items.watch_status`, `items.rating`, `items.ressenti`, `items.local_dirty` déjà existants (spec duels-elo-v1, section 7).

### Extension de `pushToNotion` (notion.ts)

Le push envoie désormais, pour chaque item `local_dirty = 1` : `Elo Score`, `Ressenti`, `Watch Status`, `Rating` (au lieu de `Elo Score`/`Ressenti` seuls).

## 8. Hors périmètre (v1)

- ~~**OS-1** — Tri personnalisé~~ : livré (filtre genre/tri/note perso, session ultérieure).
- ~~**OS-2** — Filtre par genre/réalisateur~~ : livré (filtre genre, session ultérieure).
- ~~**OS-3** — Édition en masse (sélection multiple d'items)~~ : livré (sélection par lot — statut groupé, suppression groupée).
- ~~**OS-4** — Création de nouveaux items depuis l'app~~ : livré, voir `ajout-item-v1.md`.
