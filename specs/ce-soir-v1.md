# Spec — Ce soir (v1)

**Auteur** : Claude (assisté) · **Date** : 2026-09-24 · **Statut** : Remplacé par `ce-soir-v2.md` (2026-09-26) · **Relecteur** : Louis

## 1. Contexte

La bibliothèque et l'écran d'ajout servent tous deux à gérer un catalogue déjà connu (la bibliothèque de l'utilisateur, ou un titre précis cherché par nom). Il manque un mode "je ne sais pas quoi regarder ce soir, propose-moi quelque chose" — une découverte guidée par genre + note minimum, puisant dans tout le catalogue TMDB (pas seulement les ~860 items déjà en bibliothèque), pour élargir le choix au-delà de ce qui a déjà été ajouté.

User story validée (via AskUserQuestion) : *"En tant qu'utilisateur, je choisis un genre et une note minimum, et l'app me propose un ensemble de titres correspondants piochés dans tout le catalogue TMDB — en excluant ce que j'ai déjà marqué Vu. Je peux relancer le tirage pour un autre lot si rien ne me tente. Les titres déjà présents dans ma bibliothèque (mais pas encore vus) sont signalés par un badge."*

## 2. Exigences fonctionnelles (FR)

- **FR-1** (amendé) — L'utilisateur DOIT pouvoir choisir, dans cet ordre, une catégorie (Film / Série / Documentaire), un genre (liste TMDB complète, films + séries confondus) et une note minimum (Toute note / ≥50% / ≥60% / ≥70% / ≥80% / ≥90%) avant de lancer un tirage. La catégorie suit la même sémantique que celle de la bibliothèque (`bibliotheque-v1.md` FR-9) : un Movie/TV Series taggé genre "Documentary" appartient à Documentaire, pas à Film/Série.
- **FR-2** (amendé) — Le tirage DOIT interroger `/discover/movie` et `/discover/tv` de TMDB (pas la bibliothèque locale), filtré par genre et note minimum, et retourner **exactement 5 titres** (mélangés films/séries, pas dominés par l'ordre de fusion) plutôt que la page brute TMDB entière.
- **FR-3** — Un titre déjà marqué `Watched` dans la bibliothèque locale DOIT être exclu du tirage (déjà vu, ne sert à rien de le reproposer).
- **FR-4** — Un titre déjà présent dans la bibliothèque locale mais non exclu (`Unwatched`/`Watching`) DOIT afficher un badge "Déjà ajouté" (avec son statut) dans la grille de résultats.
- **FR-5** — L'utilisateur DOIT pouvoir relancer le tirage ("Relancer") pour obtenir un nouveau lot de titres sans changer les filtres.
- **FR-6** — Cliquer un titre marque l'intention "je le regarde ce soir" : s'il n'est pas encore dans la bibliothèque, il DOIT être ajouté (même mécanisme que l'écran d'ajout — création Notion + insertion locale) ; dans tous les cas, son `Watch Status` DOIT passer à `Watching`.
- **FR-7** — Un titre sans suffisamment de votes TMDB (< 50) NE DOIT PAS apparaître dans le tirage — signal de qualité insuffisant pour une découverte à l'aveugle (cohérent avec le choix déjà fait d'utiliser `vote_count` comme signal de notoriété ailleurs dans l'app).

## 3. Exigences non-fonctionnelles (NFR)

- **NFR-1** — Le tirage ne DOIT pas nécessiter de connaître à l'avance tous les tmdb_id du catalogue : l'exclusion des items `Watched` se fait par une requête groupée (batch) sur les tmdb_id retournés par TMDB, pas une boucle par item.
- **NFR-2** — Même direction visuelle que les écrans existants (grille de cards façon bibliothèque/recherche, badge de score réutilisé de l'écran d'ajout).

## 4. Critères d'acceptation (AC)

- **AC-1** (FR-1, FR-2) — Given genre "Horreur" et note minimum 70%, When le tirage est lancé, Then tous les titres retournés ont une note TMDB ≥ 7.0 et appartiennent au genre Horreur (côté film ou série).
- **AC-2** (FR-3) — Given un titre du tirage déjà marqué `Watched` localement, When les résultats s'affichent, Then ce titre n'apparaît pas dans la liste.
- **AC-3** (FR-4) — Given un titre du tirage déjà en bibliothèque en `Unwatched`, When il s'affiche, Then un badge "Déjà ajouté · À voir" est visible sur sa card.
- **AC-4** (FR-6) — Given un titre absent de la bibliothèque, When l'utilisateur clique dessus, Then une page Notion est créée, l'item est inséré localement avec `Watch Status = Watching`, et une confirmation s'affiche.
- **AC-5** (FR-6) — Given un titre déjà en bibliothèque en `Unwatched`, When l'utilisateur clique dessus, Then son `Watch Status` passe à `Watching` sans dupliquer l'item.
- **AC-6** (FR-5) — Given un tirage déjà affiché, When l'utilisateur clique "Relancer", Then un nouveau lot de titres s'affiche (page TMDB différente), mêmes filtres.

## 5. Cas limites (EC)

- **EC-1** — Genre sans correspondance côté films OU séries (nom TMDB propre à un seul média, ex. "Sci-Fi & Fantasy" côté séries) : le tirage interroge uniquement le média où le genre existe, sans erreur.
- **EC-2** — Aucun résultat pour la combinaison genre + note minimum choisie : message explicite, pas de grille vide silencieuse.
- **EC-3** — Notion non configuré au moment du clic (FR-6) : message d'erreur explicite, le statut local n'est pas modifié tant que Notion n'a pas confirmé (même garde-fou que l'ajout existant).

## 6. Contrats d'API

```typescript
// GET /api/tmdb/genres
type TmdbGenresResponse = { genres: string[] };

// GET /api/discover?genre=Action&minScore=70&page=1
type DiscoverResponse = {
  results: {
    tmdbId: number;
    type: "Movie" | "TV Series";
    title: string;
    year: string | null;
    posterUrl: string | null;
    voteAverage: number | null;
    voteCount: number | null;
    isDocumentary: boolean;
    libraryStatus: "Watched" | "Unwatched" | "Watching" | null; // null = pas en bibliothèque
  }[];
  page: number;
  totalPages: number;
};
```

Ajout et passage à `Watching` réutilisent tels quels `POST /api/items` et `PATCH /api/items/:id` (aucun nouvel endpoint d'écriture).

## 7. Modèles de données

Aucun nouveau champ. `libraryStatus` est calculé à la volée (jointure en mémoire entre les tmdb_id retournés par TMDB et la table `items` locale), jamais stocké.

## 8. Hors périmètre (v1)

- **OS-1** — Filtre par plage d'années ou durée ("j'ai 2h ce soir") — seuls genre + note minimum sont retenus pour v1.
- **OS-2** — Crosswalk complet des genres films/séries dont le nom diffère (ex. TMDB "Action" film vs "Action & Adventure" série) — cf. EC-1, traité comme un renoncement silencieux plutôt qu'une correspondance manuelle exhaustive.
- **OS-3** — Historique des tirages précédents (pour ne pas retomber sur la même sélection) — chaque tirage est indépendant.
