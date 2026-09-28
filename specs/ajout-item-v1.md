# Spec — Ajout d'item (v1)

**Auteur** : Claude (assisté) · **Date** : 2026-09-24 · **Statut** : Draft · **Relecteur** : Louis

## 1. Contexte

`bibliotheque-v1.md` (OS-4) excluait explicitement la création de nouveaux items depuis l'app : l'ajout restait piloté depuis Notion via le mécanisme `Title[m2020;` (déclencheur texte qui lance une automatisation TMDB côté Notion). Ce mécanisme s'est montré fragile en pratique (29 items sur la base initiale sont restés bloqués en "No Title Found!", cf. session de correction manuelle).

Cette v1 ajoute un écran de recherche TMDB directement dans l'app : l'utilisateur cherche un titre, choisit le bon résultat (film ou série), et l'app crée la page Notion **avec les propriétés déjà remplies** (récupérées via l'API TMDB), sans passer par le déclencheur texte fragile.

## 2. Exigences fonctionnelles (FR)

- **FR-1** — Le système DOIT permettre de rechercher un titre (film ou série) via l'API TMDB (`/search/multi`), avec un debounce (~400 ms) pour éviter une requête par frappe.
- **FR-2** — Chaque résultat de recherche DOIT afficher : affiche (si disponible), titre, année, type (Film/Série). Les résultats qui ne sont ni film ni série (ex. `media_type: person`) DOIVENT être exclus.
- **FR-3** — Au clic sur un résultat, le système DOIT récupérer les détails complets via TMDB (genres, réalisateur/créateurs, IMDb ID, note TMDB), créer la page Notion correspondante avec ces propriétés, puis insérer l'item localement en base SQLite.
- **FR-4** — Un item nouvellement ajouté DOIT avoir `Watch Status = Unwatched` par défaut (il n'a pas encore été vu).
- **FR-5** — Si un item avec le même `tmdb_id` existe déjà localement, le système NE DOIT PAS créer de doublon (ni côté Notion, ni localement) : il DOIT signaler à l'utilisateur que l'item est déjà dans la bibliothèque.
- **FR-6** — Après ajout réussi, la bibliothèque (liste filtrée/triée courante) DOIT être rafraîchie pour refléter le nouvel item si les filtres actifs l'incluent.

## 3. Exigences non-fonctionnelles (NFR)

- **NFR-1** — La recherche ne DOIT pas bloquer l'interface : indicateur de chargement pendant l'appel TMDB.
- **NFR-2** — Même direction visuelle que les écrans existants (modal sombre, cohérent avec `DetailPanel`).

## 4. Critères d'acceptation (AC)

- **AC-1** (FR-1, FR-2) — Given l'utilisateur tape "Matrix", When les résultats arrivent, Then seuls des films/séries sont listés (pas de résultats `person`), chacun avec affiche/titre/année/type.
- **AC-2** (FR-3, FR-4) — Given un résultat "The Matrix (1999)" sélectionné, When l'ajout se termine, Then une page Notion existe avec Name="The Matrix", Type=Movie, Year="1999", Watch Status=Unwatched, Genre/Director/IMDb ID/TMDB Rating remplis depuis TMDB, et l'item apparaît en local avec le même `tmdb_id`.
- **AC-3** (FR-5) — Given un item déjà présent localement avec `tmdb_id = 603`, When l'utilisateur sélectionne à nouveau ce même résultat TMDB, Then aucune nouvelle page Notion n'est créée et l'utilisateur voit un message "déjà dans ta bibliothèque".

## 5. Cas limites (EC)

- **EC-1** — Recherche vide ou espaces uniquement : aucun appel TMDB, liste de résultats vide.
- **EC-2** — TMDB indisponible ou erreur réseau pendant la recherche : liste vide + message d'erreur discret (pas de crash).
- **EC-3** — Notion non configuré (`NOTION_TOKEN`/`NOTION_DATA_SOURCE_ID` absents) : l'ajout échoue proprement avec un message explicite, rien n'est créé ni côté Notion ni en local.
- **EC-4** — Détails TMDB introuvables après sélection (item retiré du catalogue entre la recherche et le clic) : message d'erreur, aucune création.

## 6. Contrats d'API

```typescript
// GET /api/tmdb/search?q=matrix
type TmdbSearchResponse = {
  results: {
    tmdbId: number;
    type: "Movie" | "TV Series";
    title: string;
    year: string | null;
    posterUrl: string | null;
    voteAverage: number | null;
  }[];
};

// POST /api/items
type AddItemRequest = { tmdbId: number; type: "Movie" | "TV Series" };
type AddItemResponse =
  | { item: LibraryItem; alreadyExists: false }
  | { item: LibraryItem; alreadyExists: true }
  | { error: "notion_not_configured" | "tmdb_unreachable" | "tmdb_not_found" };
```

## 7. Modèles de données

Aucune nouvelle colonne — remplit `items.tmdb_id`, `items.poster_path`, `items.imdb_id`, `items.genre`, `items.director`, `items.tmdb_rating` dès la création (au lieu de les laisser résolus a posteriori par `resolveMissingTmdbIds`, cf. duels-elo-v1).

### Notion : propriétés écrites à la création

`Name` (title), `Type` (select), `Year` (rich_text), `Watch Status` (select = "Unwatched"), `IMDb ID` (rich_text, si résolu), `Genre` (multi_select), `Director` (rich_text), `TMDB Rating` (number). Mêmes noms de propriétés que celles lues par `pullFromNotion` — aucun changement de schéma Notion nécessaire.

## 8. Hors périmètre (v1)

- **OS-1** — Ajout par IMDb ID direct ou import en masse (CSV) — recherche TMDB unitaire uniquement.
- **OS-2** — Édition des propriétés avant création (l'utilisateur ne peut pas corriger le titre/année proposés par TMDB avant validation — il choisit parmi les résultats tels quels).
- ~~**OS-3** — Ajout de documentaires comme catégorie distincte~~ : revenu sur cette exclusion, voir `bibliotheque-v1.md` FR-9 (catégorie `Documentary` dérivée du genre TMDB, indépendamment de `Movie`/`TV Series`).
