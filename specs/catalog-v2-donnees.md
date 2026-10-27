# Catalog v2 : données multi-utilisateur (phase 2)

**Auteur** : Claude (assisté) · **Date** : 2026-10-26 · **Statut** : Brouillon, à valider · **Relecteur** : Louis
**Spec parente** : `specs/catalog-v2-rust-supabase.md` (phase 2 : schéma PostgreSQL multi-utilisateur, règles d'accès, import de Louis)

Livrables de la phase :

| Fichier | Contenu |
|---|---|
| `specs/catalog-v2-donnees.md` | Ce document : classement des tables, séparation catalogue / rapport personnel, schéma, équivalences SQLite vers PostgreSQL, sécurité, plan d'import, tests, questions et risques. |
| `supabase/migrations/0001_schema.sql` | Schéma : 2 tables partagées, 16 tables personnelles, 1 vue de lecture. |
| `supabase/migrations/0002_securite.sql` | Droits et règles d'accès par ligne (66 règles). |
| `supabase/tests/01_etancheite.sql` à `04_contraintes.sql` | Tests d'étanchéité (AC-2), de catalogue partagé (FR-4), de suppression de compte (AC-7) et de contraintes, en SQL simple. |

Décisions déjà prises, rappelées sans les rediscuter : l'ancien service de notes est retiré pour de bon ; la v1 reste intacte jusqu'à la bascule ; un compte neuf est vierge ; le compte de Louis reçoit l'import de `data/watchlist.db` ; l'isolation entre comptes est le point le plus critique.

## 1. Sources et méthode

Code lu (chaque affirmation sur la v1 renvoie à l'un de ces fichiers) :

- `src/lib/db.ts` en entier : le schéma (lignes 12 à 193) et `migrate()` (lignes 218 à 265), qui ajoute à `items` les colonnes `director`, `tmdb_rating`, `overview`, `vote_count`, `tmdb_features`, `watch_providers`, `trailer_info`, `release_info`, `tier_elo`, `tier_duels_count`, `tier_rating`, `tier_band`, et `rating` à `person_opinions`.
- Les services qui touchent la base : `itemService.ts`, `duelService.ts`, `duelUndo.ts`, `tierDuelService.ts`, `personDuelService.ts`, `personOpinionService.ts`, `peopleService.ts`, `playlistService.ts`, `impressionService.ts`, `dismissalService.ts`, `journalService.ts`, `settingsService.ts`, `preferenceService.ts`, `recommendationService.ts`, `discoveryService.ts`, `tonightService.ts`, `calendarService.ts`, `triageService.ts`, `libraryActions.ts`, `showcase.ts`, `homeFeatures.ts`, `notion.ts`.
- Les types des JSON : `availability.ts`, `release.ts`, `trailer.ts`, `tmdb.ts` (`TmdbFeatures`, lignes 502 à 519), `impressionKeys.ts`, `playlistFormat.ts`.
- Le SQL hors `src/lib` : `src/app/page.tsx` (compteurs), `src/app/api/sync/*` (état de synchronisation), et les scripts `scripts/backfill-*.mjs`.
- Le contrat de parité : `parite/README.md`, `parite/shape.mjs`.

Données réelles : `data/watchlist.db` **et son journal** `watchlist.db-wal` copiés dans un dossier temporaire hors dépôt, puis lus depuis la copie. Rien n'a été écrit dans `data/`. Le journal pesait 5,6 Mo (dernière écriture le 2026-10-25) alors que le fichier principal datait du 2026-10-09 : une partie des données récentes n'était **que** dans le journal (conséquence pour l'import en section 8.1).

Documentation Supabase consultée (URL citées là où elles servent) ; ce qui n'a pas pu être confirmé est marqué « à vérifier ».

## 2. Ce que contient la base de Louis (mesuré le 2026-10-26 sur la copie)

| Table v1 | Lignes | Observations utiles à la conception |
|---|---:|---|
| `items` | 1 077 | 913 films, 164 séries ; 573 vus, 504 à voir. 3 sans `tmdb_id` (ni `imdb_id`). 5 paires de doublons TMDB (section 4.4). 4 titres notés mais « à voir ». 80 séries ont une année en plage (« 2019 - 2023 », « 2024 - »). `ressenti` toujours null. `overview` : 4 null, 14 vides. `local_dirty` à 1 sur 589 lignes. Identifiants de 1 à 1 958. |
| `duels` | 1 563 | 101 passés. La somme des `duels_count` vaut 134 : une réinitialisation remet les compteurs à zéro mais garde l'historique (`duelService.ts`, `resetElo`). Il faut donc copier les compteurs, pas les recalculer. |
| `elo_snapshot` | 7 | Instantané de la dernière réinitialisation. |
| `tier_duels` | 176 | Plus écrits par la v1 (seulement supprimés, `itemService.ts` ligne 625). |
| `tier_rounds` | 429 | 413 répartitions, 16 quatuors. Le `payload` contient des identifiants de titres et des notes. |
| `people` | 332 | 218 avec au moins un duel. |
| `person_duels` | 151 | |
| `person_elo_snapshot` | 0 | |
| `person_opinions` | 370 | Toutes « aimée » ; 110 notées. 97 portent sur des personnes absentes de `people`. |
| `events` | 854 | Du 2026-09-25 au 2026-10-25. 2 événements visent un titre supprimé depuis, 2 une playlist supprimée. Clés de `context` : `rating`, `watchStatus`, `family`, `answer`, `source`, `tmdbId`, `type`, `count`, `playlistId`. |
| `dismissals` | 44 | Tous des titres TMDB hors bibliothèque (`movie:…`, `tv:…`). |
| `impressions` | 189 | Du 2026-10-09 au 2026-10-25. |
| `settings` | 1 | `streaming_subscriptions` = `[]`. |
| `playlists` | 1 | Vide. |
| `playlist_items` | 0 | |
| `playlist_suggestion_dismissals` | 0 | |
| `sync_state` | 1 | `last_pull_at`. |

Aucune ligne orpheline dans les tables à clé étrangère (duels, départages, instantanés, playlists). Tous les JSON sont valides. Les notes en base sont exactement les six valeurs de `RATING_SCALE` (`itemService.ts` ligne 106) ou null.

## 3. Classement des tables

Règle : ce qui vient de TMDB et vaut pour tout le monde est **partagé** ; ce qui exprime le jugement ou l'activité d'une personne est **personnel** et porte `user_id` ; ce qui ne sert qu'à l'ancien service de notes est **abandonné**.

| Table v1 | Classement | Table(s) v2 | Justification |
|---|---|---|---|
| `items` | Scindée | `catalog_titles` (partagée) + `library_items` (personnelle) | Mélange fiche TMDB et rapport personnel (section 4). |
| `people` | Scindée | `catalog_people` (partagée) + `person_scores` (personnelle) | Nom et photo viennent des crédits TMDB (`personDuelService.ts`, `syncPeople`, lignes 65 à 74) ; l'Elo est personnel. |
| `duels` | Personnelle | `duels` | Jugements d'une personne. |
| `elo_snapshot` | Personnelle | `elo_snapshot` | Annulation de la réinitialisation d'une personne. |
| `person_duels` | Personnelle | `person_duels` | |
| `person_elo_snapshot` | Personnelle | `person_elo_snapshot` | |
| `person_opinions` | Personnelle | `person_opinions` | Avis ; le nom reçu avec l'avis reste ici (section 4.5). |
| `tier_duels` | Personnelle | `tier_duels` | Plus écrite, gardée pour ne rien perdre (FR-5). |
| `tier_rounds` | Personnelle | `tier_rounds` | Annulation des départages. |
| `events` | Personnelle | `events` | Journal des gestes d'une personne. |
| `dismissals` | Personnelle | `dismissals` | |
| `impressions` | Personnelle | `impressions` | |
| `settings` | Personnelle | `settings` | Abonnements de la personne. |
| `playlists`, `playlist_items`, `playlist_suggestion_dismissals` | Personnelles | mêmes noms | |
| `sync_state` | **Abandonnée** | aucune | Ne sert qu'à l'ancien service (`src/app/api/sync/*`). |

Colonnes abandonnées (FR-1, aucune trace dans la v2) :

| Colonne | Usage v1 | Pourquoi l'abandonner |
|---|---|---|
| `items.notion_page_id` | Identifiant de page distante, clé du rapprochement (`notion.ts` lignes 117 à 136), archivage avant suppression (`libraryActions.ts` lignes 89 à 105). | Service retiré. |
| `items.notion_last_edited` | Arbitrage des mises à jour lors du rapatriement (`notion.ts` ligne 135). | Idem. |
| `items.local_dirty` | Marque des lignes à envoyer (`itemService.ts` ligne 342, `duelService.ts` lignes 136 et 201, `duelUndo.ts` ligne 117). | Idem. |
| `items.tmdb_resolve_failed_at` | Freine la résolution `imdb_id` vers TMDB après le rapatriement (`notion.ts` lignes 186 à 211). Aucune ligne renseignée. | Seul l'ancien service l'utilise ; la v2 ajoute toujours un titre depuis TMDB. |
| `sync_state` (table) | `last_pull_at`, `last_push_at`. | Idem. |

Champ d'API concerné : `DuelItem.notionPageId` (`duelService.ts` ligne 14). Le contrat de parité tolère déjà son absence (`parite/shape.mjs`, `RETIRES_EN_V2`).

## 4. Séparation catalogue partagé / rapport personnel

### 4.1 Colonnes de `items`, une par une

| Colonne v1 | Destination v2 | Remarque |
|---|---|---|
| `id` | `library_items.id` | Identifiant personnel (section 5.1). |
| `type`, `tmdb_id` | `catalog_titles.type`, `.tmdb_id` | Clé naturelle **(type, tmdb_id)** : « un même numéro peut désigner un film et une série » (`dismissalService.ts` ligne 11, `discoveryService.ts` ligne 338). |
| `imdb_id`, `poster_path`, `genre`, `director`, `tmdb_rating`, `vote_count`, `overview`, `year`, `name` | `catalog_titles` | Données TMDB. `genre` devient `genres` (jsonb). |
| `tmdb_features`, `watch_providers`, `release_info`, `trailer_info` | `catalog_titles` (jsonb) | Plus `availability_fetched_at` et `release_fetched_at`, recopiés du `fetchedAt` des JSON (`availability.ts` ligne 17, `release.ts` ligne 19) pour trouver les fiches à rafraîchir sans lire le JSON. |
| `watch_status`, `rating`, `ressenti` | `library_items` | Personnel. `rating` devient un entier 0 à 5 (section 5.2). |
| `elo_score`, `duels_count`, `last_duel_at` | `library_items` | Personnel. |
| `tier_elo`, `tier_duels_count`, `tier_rating`, `tier_band` | `library_items` | Personnel. |
| `updated_at` | `library_items.updated_at` | Personnel : c'est l'empreinte du modèle (`preferenceService.ts` lignes 137 à 148) et le « touchedAt » des playlists (`playlistService.ts` lignes 197 à 206). |
| `notion_page_id`, `notion_last_edited`, `local_dirty`, `tmdb_resolve_failed_at` | abandonnées | Section 3. |

Le nom relève du catalogue : `scripts/backfill-titles-scores.mjs` a remplacé les noms de tous les titres résolus par le titre français de TMDB (« Le titre local divergera de celui affiché dans Notion, accepté sciemment »), et un ajout depuis l'application prend le titre TMDB (`libraryActions.ts` ligne 45). Le rapatriement depuis le service de notes pouvait réécrire un nom plus tard (`notion.ts` lignes 123 à 135, si la page était plus récente) ; ce cas résiduel est traité en section 8.7 (contrôle des noms).

### 4.2 Titre sans identifiant TMDB, ou dont la résolution a échoué

Trois titres de Louis n'ont pas de `tmdb_id` (ids 154, 373, 766 : documentaires saisis à la main dans l'ancien service). Leur nom, leur type, leur année et leurs genres (`["Documentary"]` pour deux d'entre eux, ce qui décide de la catégorie, `itemService.ts` ligne 121) restent **personnels** : colonnes `local_name`, `local_type`, `local_year`, `local_genres` de `library_items`, `title_id` à null. Ils n'entrent jamais dans le catalogue, sinon un titre saisi par un compte serait visible de tous. Une contrainte (`library_items_title_or_local`) impose l'un ou l'autre, jamais les deux. La vue `library_view` rend ces titres comme les autres (`coalesce`).

La v2 ne crée plus de tels titres : ajouter passe toujours par TMDB (`libraryActions.ts`, `addTitleToLibrary`, refuse sans fiche TMDB). Le cas « résolution échouée » de la v1 n'existait qu'au rapatriement depuis l'ancien service ; il disparaît avec lui.

### 4.3 Titre ajouté à la main

En v1, un titre entrait soit depuis TMDB (application), soit par l'ancien service (saisie libre, puis résolution par `imdb_id`). En v2, seul le premier chemin existe. Si un jour on veut une saisie libre, elle suivra la section 4.2 (titre personnel, sans fiche partagée).

### 4.4 Doublons

Cinq titres apparaissent deux fois dans la bibliothèque de Louis, avec des états personnels **différents** : par exemple « Ghost in the Shell » (ids 617 et 653), à voir d'un côté, vu et noté 3 étoiles de l'autre ; « Matrix Reloaded » (304 et 500), deux Elo et deux historiques de duels. Les fusionner perdrait des notes, des duels et des départages. Décision :

- le catalogue n'a qu'une fiche par (type, tmdb_id) : 1 069 fiches pour 1 074 titres résolus ;
- l'import garde les deux lignes personnelles ; la plus récente (identifiant le plus grand) est marquée `import_duplicate = true` ;
- l'index unique partiel `library_items_one_per_title (user_id, title_id) where not import_duplicate` interdit tout nouveau doublon (ajout idempotent, comme `findByTmdbId` en v1) ;
- fusion des fiches d'une paire : première valeur non vide pour les champs simples, JSON daté le plus frais pour la disponibilité, les dates et la bande-annonce. Sur les données réelles, aucun conflit entre deux valeurs non vides ; 3 réalisateurs vides d'un côté sont complétés par l'autre ligne.

Question ouverte 1 : Louis préfère-t-il fusionner ces cinq paires dans la v1 avant l'import ?

### 4.5 Personnes : fiche partagée, scores et avis personnels

- `catalog_people (id, name, profile_path)` : la personne TMDB, écrite par le serveur à partir des crédits du catalogue.
- `person_scores` : l'Elo des duels d'acteurs, par compte, clé `(user_id, person_id)`, référence `catalog_people`.
- `person_opinions` : l'avis et sa note, par compte. Deux choix délibérés : **pas de clé étrangère** vers `catalog_people` (97 avis de Louis portent sur des personnes hors duels) ; **le nom reste dans l'avis**. Ce nom arrive du navigateur (`src/app/api/people/opinions/route.ts` lignes 11 à 23, `triageService.ts` ligne 222) : s'il nourrissait le catalogue, un compte pourrait renommer une personne pour tous les autres.

### 4.6 Titres hors bibliothèque

La découverte, Ce soir et le calendrier lisent des fiches TMDB de titres qu'aucun compte n'a ajoutés, gardées en mémoire du processus pendant 7 jours (`discoveryService.ts` lignes 252 à 267, `calendarService.ts` ligne 67). Sur des fonctions sans état, ce cache disparaît à chaque démarrage. `catalog_titles` peut le remplacer (NFR-3 : un testeur de plus ne multiplie pas les appels) : une fiche peut exister sans aucune ligne de bibliothèque. Les listes TMDB par tranche du calendrier (24 h) n'ont pas d'équivalent dans le schéma : à trancher en phase 4 (une table de cache générique, ou un précalcul).

### 4.7 Règle d'écriture du catalogue

Le catalogue n'est écrit que par le serveur, et **seulement avec des réponses de TMDB**, jamais avec une valeur reçue d'un navigateur. C'est ce qui empêche un compte d'altérer ce que voient les autres (test `02_catalogue_partage.sql`).

### 4.8 Rafraîchissement et date de modification

En v1, `storeTitleData` ne touche pas `updated_at` (`itemService.ts` lignes 660 à 679) mais le rafraîchissement explicite si (`itemService.ts` ligne 596), ce qui relance l'entraînement du modèle. En v2, rafraîchir une fiche partagée met à jour `catalog_titles.updated_at` ; pour garder le comportement, la route de rafraîchissement met aussi à jour `library_items.updated_at` du compte qui l'a demandé, et l'empreinte du modèle inclut le maximum de `catalog_titles.updated_at` des titres du compte.

## 5. Schéma

### 5.1 Conventions

**Identifiants personnels : clé primaire `(user_id, id)`**, `id bigint generated by default as identity (start with 1000000)`.

- Chaque compte a son propre espace : le titre n° 1 peut exister chez Louis et dans le compte de démonstration (test `04_contraintes.sql`). L'import garde les identifiants de la v1 (tous sous 1 958), ce qui évite de réécrire les références cachées dans du texte et du JSON : `events.subject_id`, `events.context.playlistId`, `impressions.subject_id`, `dismissals.subject_id`, `tier_rounds.payload.items[].id`.
- Les nouvelles lignes prennent un numéro à partir de 1 000 000 : l'ordre d'arrivée reste croissant dans un compte (le tri « ajouté » suit l'identifiant, `itemService.ts` ligne 146 ; l'annulation des duels compare `id > ?`, `duelUndo.ts` ligne 82).
- Des nombres et non des UUID : le contrat de parité compare des types JSON (`parite/shape.mjs`), un identifiant doit rester `number`.
- Toute clé étrangère entre tables personnelles inclut `user_id` : une ligne de B ne peut pas désigner une ligne de A, même avec le bon numéro (vérifié structurellement et en comportement, section 9).

**Dates** : `timestamptz` (les dates ISO de la v1, en millisecondes, passent sans perte) ; `impressions.day` en `date`. **JSON** : `jsonb`, avec une contrainte sur le type racine (tableau ou objet). `jsonb` ne garde ni l'ordre des clés ni les espaces : toute comparaison se fait sur le JSON relu, jamais sur le texte. **Année** : texte, comme en v1 (plages des séries). **Flottants** : `double precision`, même représentation que le `REAL` de SQLite ; égalité exacte vérifiée sur les 1 077 Elo.

### 5.2 Note en entier

`rating`, `tier_rating`, `tier_duels.rating`, `tier_rounds.rating` et les états `before.rating` / `after.rating` du `payload` passent de l'émoji (`RATING_SCALE`, `itemService.ts` ligne 106) à un `smallint` de 0 (💩) à 5, avec `check (rating between 0 and 5)`. Correspondance : `💩` 0, `⭐️` 1, `⭐️⭐️` 2, `⭐️⭐️⭐️` 3, `⭐️⭐️⭐️⭐️` 4, `⭐️⭐️⭐️⭐️⭐️` 5. Raisons : une contrainte simple, le tri et les seuils deviennent directs (`RATING_RANK_SQL` disparaît), la base ne dépend plus d'une échelle d'affichage héritée de l'ancien service. L'API rend la note sous la forme actuelle, l'interface ne change pas. Le contexte des événements `rated` garde l'émoji d'origine (journal historique, non relu par le calcul : seule `context.source` est lue, `journalService.ts` ligne 63). Question ouverte 5.

### 5.3 Tables

| Table | Clé primaire | Clés étrangères | Contraintes principales | Index (requête servie) |
|---|---|---|---|---|
| `catalog_titles` | `id` (identity) | aucune | unique `(type, tmdb_id)` ; type Movie ou TV Series ; `name` non vide ; JSON de bon type | GIN `genres` (filtre genre, catégorie Documentaire) ; `availability_fetched_at`, `release_fetched_at` (rafraîchissement par lots) |
| `catalog_people` | `id` (TMDB) | aucune | `id > 0` | |
| `library_items` | `(user_id, id)` | `user_id` vers `auth.users` (cascade) ; `title_id` vers `catalog_titles` (restrict) | fiche ou titre local, jamais les deux ; statut ; note 0 à 5 ; groupe 0 à 2 ; doublon hérité seulement avec fiche | unique partiel `(user_id, title_id)` ; `(user_id, watch_status)` (pile, duels, compteurs) ; `(title_id)` (nettoyage du catalogue) |
| `elo_snapshot` | `(user_id, item_id)` | `(user_id, item_id)` vers `library_items` (cascade) | | |
| `duels` | `(user_id, id)` | `(user_id, item_a_id)`, `(user_id, item_b_id)` vers `library_items` (cascade) | paire distincte ; vainqueur dans la paire | `(user_id, item_a_id)`, `(user_id, item_b_id)` (annulation, retrait) ; la clé primaire sert `order by id desc limit` |
| `tier_duels` | `(user_id, id)` | idem `duels` | note 0 à 5 ; vainqueur dans la paire | idem |
| `tier_rounds` | `(user_id, id)` | aucune (ids dans le JSON) | `kind` band ou quad ; `payload.items` tableau | |
| `person_scores` | `(user_id, person_id)` | `person_id` vers `catalog_people` (restrict) | | `(person_id)` |
| `person_duels` | `(user_id, id)` | `(user_id, person_a_id)`, `(user_id, person_b_id)` vers `person_scores` (cascade) | paire distincte ; vainqueur dans la paire | `(user_id, person_a_id)`, `(user_id, person_b_id)` |
| `person_elo_snapshot` | `(user_id, person_id)` | vers `person_scores` (cascade) | | |
| `person_opinions` | `(user_id, person_id)` | aucune vers le catalogue | avis -1 ou 1 ; note seulement si aimée | |
| `events` | `(user_id, id)` | aucune (le journal survit à son sujet) | 13 gestes connus ; sujet bien formé | `(user_id, kind)` ; `(user_id, subject_type, subject_id, created_at)` (dernier geste, lassitude) |
| `dismissals` | `(user_id, subject_type, subject_id)` | aucune | sujet bien formé | |
| `impressions` | `(user_id, subject_type, subject_id, day)` | aucune | surface parmi `SURFACES` (`impressionKeys.ts` ligne 5) | `(user_id, day)` (42 derniers jours, purge à 90) |
| `settings` | `(user_id, key)` | aucune | valeur jsonb | |
| `playlists` | `(user_id, id)` | | nom 1 à 60, sans espace en bord ; description 1 à 200 (`playlistFormat.ts` lignes 7 et 8) | `(user_id, updated_at desc, id desc)` (dernière modifiée) |
| `playlist_items` | `(user_id, playlist_id, item_id)` | vers `playlists` et `library_items` (cascade) | position positive | `(user_id, item_id)` ; `(user_id, playlist_id, position, added_at)` |
| `playlist_suggestion_dismissals` | `(user_id, playlist_id, item_id)` | vers `playlists` et `library_items` (cascade) | | `(user_id, item_id)` |

Toutes les tables personnelles ont `user_id uuid not null references auth.users (id) on delete cascade`, conformément à la recommandation de Supabase (« Reference the auth.users table to ensure data integrity. Specify on delete cascade in the reference », https://supabase.com/docs/guides/auth/managing-user-data). La plupart ont `default auth.uid()`.

Les sujets du journal, des titres écartés et des impressions restent textuels (`item` + « 42 », `tmdb` + « movie:603 »), comme les clés partagées avec le navigateur (`impressionKeys.ts`). Une clé étrangère n'y a pas sa place : le journal doit garder la trace d'un titre retiré (2 cas réels). Des contraintes vérifient le format.

Cascades reprises de la v1 : retirer un titre efface ses duels, départages, places en playlist et suggestions écartées (`itemService.ts` lignes 622 à 634) ; en v2, il efface aussi son instantané d'Elo (la v1 le laissait orphelin, sans effet). Supprimer une playlist efface ses lignes (`playlistService.ts` lignes 278 à 283).

Ce qui n'est délibérément pas dans le schéma : déclencheur de mise à jour de `updated_at` (la v1 le pose à la main, avec un sens précis, section 4.8) ; contrainte « note seulement si vu » (4 titres réels l'enfreignent, on les garde) ; cache du modèle de préférence et des listes TMDB (phase 0 et 4) ; table de profil.

### 5.4 Vue de lecture

`library_view` joint `library_items` et `catalog_titles` et rend les colonnes de l'ancienne `items` (sans celles du service retiré). Elle est créée `with (security_invoker = true)` : sans cette option, une vue lit avec les droits de son propriétaire et contourne les règles par ligne (https://supabase.com/docs/guides/database/postgres/row-level-security, sections « Views and RLS » et « Expose a view safely »). Elle sert de point d'entrée au portage des lectures.

## 6. Équivalences SQLite vers PostgreSQL

Relevées par recherche dans `src/lib` et `src/app`. « Vérifié » : la requête v1 sur la copie SQLite et sa traduction sur les mêmes données chargées dans PGlite donnent le même résultat.

| Construction v1 | Où | Équivalent v2 | Vérifié |
|---|---|---|---|
| `EXISTS (SELECT 1 FROM json_each(items.genre) je WHERE je.value = ?)` | `itemService.ts` 121, 234 ; `recommendationService.ts` 159 | `genres @> jsonb_build_array($1::text)` (index GIN) | oui (catégorie Documentaire) |
| `json_extract(genre, '$[0]')` | `itemService.ts` 151 | `genres ->> 0` | oui (tri par genre) |
| `SELECT DISTINCT je.value FROM items, json_each(items.genre)` | `itemService.ts` 199 | `select distinct g from library_view, jsonb_array_elements_text(genres) g` | oui |
| `json_each(watch_providers, '$.flatrate')` + `json_extract(p.value, '$.id') IN (…)` | `itemService.ts` 644 | `exists (select 1 from jsonb_array_elements(coalesce(wp->'flatrate','[]') \|\| coalesce(wp->'free','[]') \|\| coalesce(wp->'ads','[]')) p where (p->>'id')::int = any($1))`, ou trois `jsonb_path_exists(wp, '$.flatrate[*] ? (@.id == $s[*])', vars)` | oui, les deux formes |
| `json_extract(context, '$.source') IN (…)` | `journalService.ts` 63 | `context ->> 'source' in (…)` | oui |
| `INSERT OR IGNORE` | `impressionService.ts` 55 ; `playlistService.ts` 325, 582 | `insert … on conflict do nothing` ; le nombre de lignes créées par le compte de lignes touchées | oui (test 04) |
| `ON CONFLICT(key) DO UPDATE SET value = excluded.value` | `settingsService.ts` 27 ; `personOpinionService.ts` 29, 35, 59 ; `personDuelService.ts` 68 ; `dismissalService.ts` 34 | Même syntaxe ; la cible du conflit inclut `user_id` : `on conflict (user_id, key)` | syntaxe |
| `lastInsertRowid`, `.changes` | `duelService.ts` 130 ; `playlistService.ts` 228 ; etc. | `returning id` ; nombre de lignes touchées | |
| `SUM(watch_status = 'Watched')` (somme de booléens) | `duelService.ts` 167 ; `preferenceService.ts` 142 ; `journalService.ts` 83 | `count(*) filter (where …)` | oui |
| `MAX(0, x)` (scalaire) | `duelUndo.ts` 106 | `greatest(0, x)` | |
| `CAST(subject_id AS INTEGER)` | `dismissalService.ts` 62 ; `journalService.ts` 61 | `subject_id::bigint`, toujours derrière `subject_type = 'item'` : PostgreSQL lève une erreur sur `'movie:603'` là où SQLite rendait 0 | oui |
| `RATING_RANK_SQL` (`CASE rating WHEN '💩' THEN 0 …`) | `itemService.ts` 134 et ses usages | `rating` directement (section 5.2) | oui (titres aimés, empreinte du modèle) |
| `UPDATE … FROM elo_snapshot s WHERE items.id = s.item_id` | `duelService.ts` 219 ; `personDuelService.ts` 218 | Même forme, jointure aussi sur `user_id` | |
| `DELETE FROM elo_snapshot` (toute la table) | `duelService.ts` 191 ; `personDuelService.ts` 193 | `delete … where user_id = $1` : sans filtre, la règle d'accès ne laisse effacer que ses lignes, mais le filtre explicite reste obligatoire | |
| `ORDER BY x IS NULL, x DESC` | `itemService.ts` 269 | Inchangé (faux avant vrai), ou `nulls last` | |
| `name COLLATE NOCASE` | `itemService.ts` 137, 202, 269 | Équivalent exact : `translate(name, 'A…Z', 'a…z') collate "C"` (SQLite ne replie que l'ASCII). `lower(name)` replie aussi « É » : 3 titres changent de place. Un `order by name` sans repli (collation `C` de PGlite) en déplace 317 ; la collation par défaut du projet Supabase est à vérifier. | oui, les trois |
| `LOWER(name) LIKE ?` | `itemService.ts` 229 | `name ilike $1` trouve 6 titres de plus pour « é » (repli des majuscules accentuées) ; équivalent exact : `translate(…) like` | oui |
| `MAX(created_at)` sur texte ISO, `created_at >= ?` | `impressionService.ts` 96 à 100 ; `duelUndo.ts` 111 | Sur `timestamptz` | oui (dernier geste) |
| `day < ?` sur texte « AAAA-MM-JJ » | `impressionService.ts` 61, 89 | Sur `date` | |
| Jour d'exposition en heure locale du serveur | `impressionService.ts` lignes 28 à 32 (`getFullYear`, `getDate`) | Fuseau explicite (`Europe/Paris`) : un serveur hébergé tourne en UTC | question ouverte 4 |
| `PRAGMA table_info` + `ALTER TABLE ADD COLUMN` | `db.ts` 218 à 265 | Migrations numérotées dans `supabase/migrations` | |
| `db.transaction(() => …)` | partout | `begin` / `commit` explicites, dans lesquels le serveur pose aussi l'identité (section 7.2) | |
| Cache de module `cached` (modèle de préférence) | `preferenceService.ts` lignes 150 à 168 | Indexé par compte, ou stocké ; **un cache unique mélangerait les modèles de deux comptes** | risque 3 |

## 7. Sécurité

### 7.1 Rôles et règles

| Rôle | Qui | Catalogue partagé | Tables personnelles | Vue |
|---|---|---|---|---|
| `anon` | requête sans session | aucun droit | aucun droit | aucun droit |
| `authenticated` | compte durable **et invité** : « Anonymous users use the authenticated role » (https://supabase.com/docs/guides/auth/auth-anonymous) | lecture seule (`using (true)`) | ses lignes seulement, pour les 4 opérations : `user_id = (select auth.uid())` | lecture, règles appliquées |
| `service_role` | serveur (import, écriture du catalogue) | tout | tout, en contournant les règles | lecture |

- `auth.uid()` est appelé dans un `select` : évalué une fois par requête (« Wrapping the function causes an initPlan to be run by the Postgres optimizer », page RLS citée ci-dessus). Hors session il vaut null et rien ne passe.
- Droits : `0002_securite.sql` révoque tout à `anon` et `authenticated` sur chaque table, puis redonne exactement ce qu'il faut. C'est la démarche décrite par Supabase (`revoke all on table … from anon, authenticated;` puis `grant …`), parce qu'une nouvelle table de `public` peut naître avec tous les droits accordés aux trois rôles (« On existing projects, a new table in public starts with every privilege already granted to all three roles »). Les droits par défaut de `postgres` sont aussi resserrés pour les tables à venir ; des retours de la communauté indiquent que des droits par défaut appartenant à `supabase_admin` peuvent subsister (à vérifier) : ce sont les révocations par table, contrôlées par le test 01, qui protègent.
- `service_role` contourne les règles par ligne (« Full access. It bypasses RLS, so keep it server-side ») ; `postgres` aussi chez Supabase (attribut `bypassrls`, même page). Aucun des deux ne doit servir pour une requête d'utilisateur.

### 7.2 Comment le serveur Rust applique les règles

Chaque requête d'utilisateur s'exécute dans une transaction qui, avant toute lecture :

1. vérifie la signature du jeton Supabase (jamais de revendications non vérifiées) ;
2. pose `select set_config('request.jwt.claims', <revendications vérifiées>, true)` ;
3. passe en `set local role authenticated` ;
4. garde en plus le filtre explicite `user_id = $1` dans chaque requête (première barrière ; les règles sont la seconde, FR-3).

`auth.uid()` lit le `sub` de `request.jwt.claim.sub`, sinon de `request.jwt.claims` (définition de Supabase Auth, migration `20220224000811_update_auth_functions.up.sql` du dépôt `supabase/auth` : https://raw.githubusercontent.com/supabase/auth/master/migrations/20220224000811_update_auth_functions.up.sql). Les deux réglages sont locaux à la transaction, ce qui convient au pool en mode transaction : « Session-level state is lost between transactions », il faut donc les poser dans la transaction qui en a besoin ; ce mode ne prend pas les requêtes préparées (« Transaction mode does not support prepared statements », https://supabase.com/docs/guides/database/connecting-to-postgres). Réglage de `sqlx` correspondant : à vérifier en phase 0.

Recommandation : se connecter avec un rôle dédié (par exemple `catalog_api`) **sans** `bypassrls`, membre de `authenticated`, avec les seuls droits d'écriture du catalogue. Un oubli de `set local role` échoue alors fermé (rien de visible) au lieu de tout ouvrir. Possibilité de créer un tel rôle sur Supabase : à vérifier (question ouverte 2).

### 7.3 Surface d'attaque

- L'interface n'a pas besoin de l'API de données de Supabase (PostgREST) si elle passe par le serveur Rust. Supabase conseille de la désactiver dans ce cas : « With the Data API disabled, none of the auto-generated REST endpoints respond, regardless of grants or RLS » (https://supabase.com/docs/guides/database/hardening-data-api). Les règles restent écrites comme si elle était ouverte (question ouverte 3).
- Accès invité : Supabase recommande un CAPTCHA invisible ou Turnstile contre les abus et ne purge pas les comptes anonymes de lui-même (même page sur l'accès anonyme). Rattacher un e-mail se fait par `updateUser()` ; que l'identifiant de l'utilisateur reste le même n'est pas écrit explicitement dans cette page : à vérifier en phase 3 (AC-4 en dépend, car toutes les lignes sont rattachées à cet identifiant).
- `restorePlaylist` recrée une playlist « sous le même identifiant s'il est libre » à partir d'un identifiant envoyé par le navigateur (`playlistService.ts` lignes 301 à 330). Avec la clé `(user_id, id)`, la recherche et l'insertion se font dans l'espace du compte : pas de collision ni d'indice sur les playlists des autres.

### 7.4 Suppression d'un compte (FR-9, AC-7)

Supprimer l'utilisateur dans Supabase Auth efface sa ligne de `auth.users` ; toutes les tables personnelles suivent par `on delete cascade`, directement ou par leurs clés composées. Le catalogue partagé ne contient rien de personnel et reste. Le test 03 vérifie qu'il ne reste aucune ligne du compte dans aucune table portant `user_id` (liste lue dans le catalogue système, donc valable pour les tables futures) ni aucune valeur uuid égale à son identifiant ailleurs dans `public`. Supabase signale une erreur à la suppression d'un utilisateur qui possède des fichiers stockés (https://supabase.com/docs/guides/auth/managing-user-data) : sans objet aujourd'hui.

## 8. Plan d'import

Conçu, pas écrit (sauf l'essai jetable de la section 8.9). L'outil d'import et le script de vérification restent à écrire.

### 8.1 Préalables

1. Le compte de Louis existe dans Supabase Auth ; son identifiant (uuid) est l'unique paramètre « compte cible ».
2. **Image cohérente de la base v1** : produite par l'API de sauvegarde de SQLite (`db.backup()` de better-sqlite3) depuis une connexion en lecture seule, ou après un arrêt propre de la v1. Ne jamais copier le seul fichier `watchlist.db` : le 2026-10-26, 5,6 Mo d'écritures n'étaient que dans `watchlist.db-wal`.
3. Contrôles préalables, qui arrêtent l'import s'ils échouent (rien n'est corrigé en silence) : notes et notes de palier dans l'échelle ou null ; `watch_status` et `type` renseignés et connus ; JSON valides ; identifiants v1 tous sous 1 000 000 ; formats des sujets (`item` numérique, `tmdb` « movie:… » ou « tv:… ») ; surfaces connues ; noms de playlist valides.
4. Un rapport « avant » : comptes par table et empreintes des lignes (section 8.6).

### 8.2 Ordre

Une seule transaction pour les données personnelles (environ 5 000 lignes ; 2,2 s dans l'essai), tout ou rien.

1. Catalogue (rôle serveur) : `catalog_titles` depuis les titres résolus, regroupés par (type, tmdb_id), fusion de la section 4.4 ; insertion seulement si la fiche manque (le catalogue est commun : une fiche déjà présente n'est pas écrasée, l'écart est noté au rapport). `catalog_people` depuis `people`.
2. `library_items` dans l'ordre des identifiants v1.
3. `elo_snapshot`.
4. `person_scores` (depuis `people`), puis `person_elo_snapshot`.
5. `duels`, `tier_duels`, `tier_rounds` (dans l'ordre des identifiants).
6. `person_duels`.
7. `person_opinions`.
8. `playlists`, `playlist_items`, `playlist_suggestion_dismissals`.
9. `events`, `dismissals`, `impressions`, `settings`.
10. `sync_state` : ignorée.

Ré-import (tant que la v1 vit) : même transaction, précédée de l'effacement des lignes du compte cible (supprimer ses `library_items`, `playlists`, `person_scores` fait suivre les cascades ; puis `events`, `dismissals`, `impressions`, `settings`, `person_opinions`, `tier_rounds`). Le catalogue n'est pas effacé.

### 8.3 Correspondance des identifiants

| Données | Ancien vers nouveau |
|---|---|
| Titres, duels, départages, playlists, journal | Identiques (même numéro, dans l'espace du compte cible). Aucune réécriture de `subject_id`, `context.playlistId`, `payload.items[].id`. |
| Personnes | Identifiant TMDB, inchangé. |
| Fiche partagée d'un titre | Nouvelle (`catalog_titles.id`), retrouvée par (type, tmdb_id). La table « id v1 vers id de fiche » est écrite dans le rapport d'import, pas en base. |
| Compte de démonstration | Même import, autre compte cible, mêmes numéros (espaces séparés). Vérifié dans l'essai : la démonstration voit ses 1 077 titres et aucun de ceux de Louis. |

### 8.4 Transformations

| Donnée | Transformation |
|---|---|
| `rating`, `tier_rating`, `tier_duels.rating`, `tier_rounds.rating` | Émoji vers 0 à 5 (section 5.2) ; valeur inconnue : arrêt. |
| `tier_rounds.payload` | Même conversion pour `before.rating` et `after.rating` de chaque élément ; le reste inchangé. |
| `genre`, `tmdb_features`, `watch_providers`, `release_info`, `trailer_info`, `events.context`, `settings.value` | Texte JSON vers `jsonb`. |
| `availability_fetched_at`, `release_fetched_at` | Copiés du `fetchedAt` du JSON correspondant. |
| Dates ISO | Vers `timestamptz` ; `impressions.day` vers `date`. |
| Titre sans `tmdb_id` | `local_name`, `local_type`, `local_year`, `local_genres` ; aucune fiche. |
| Doublons | Seconde ligne marquée `import_duplicate`. |
| `notion_page_id`, `notion_last_edited`, `local_dirty`, `tmdb_resolve_failed_at` | Ignorés. |

### 8.5 Lignes orphelines

- Tables à clé étrangère (duels, départages, instantanés, places en playlist, suggestions écartées, duels de personnes) : une ligne qui vise un titre, une playlist ou une personne absente est **écartée et recopiée intégralement dans le rapport**, l'import continue. Aucune aujourd'hui.
- Journal, titres écartés, impressions : sans clé étrangère, importés tels quels même si leur sujet a disparu (4 événements aujourd'hui), comme en v1.
- `tier_rounds` dont le `payload` vise un titre absent : importé ; l'annulation le refusera comme en v1 (`conflict`).
- Avis sur une personne absente de `people` : importés (97), c'est voulu.

### 8.6 Comptes attendus (base du 2026-10-26)

| v1 | v2 | Avant | Après (compte de Louis) |
|---|---|---:|---:|
| `items` | `library_items` | 1 077 | 1 077 (dont 3 locaux, 5 doublons marqués) |
| `items` (titres résolus distincts) | `catalog_titles` | 1 069 | 1 069 (communes à tous les comptes) |
| `duels` | `duels` | 1 563 | 1 563 |
| `elo_snapshot` | `elo_snapshot` | 7 | 7 |
| `tier_duels` | `tier_duels` | 176 | 176 |
| `tier_rounds` | `tier_rounds` | 429 | 429 |
| `people` | `catalog_people` + `person_scores` | 332 | 332 + 332 |
| `person_duels` | `person_duels` | 151 | 151 |
| `person_elo_snapshot` | `person_elo_snapshot` | 0 | 0 |
| `person_opinions` | `person_opinions` | 370 | 370 |
| `events` | `events` | 854 | 854 |
| `dismissals` | `dismissals` | 44 | 44 |
| `impressions` | `impressions` | 189 | 189 |
| `settings` | `settings` | 1 | 1 |
| `playlists`, `playlist_items`, `playlist_suggestion_dismissals` | mêmes | 1, 0, 0 | 1, 0, 0 |
| `sync_state` | aucune | 1 | 0 |

### 8.7 Script de vérification (à écrire)

Lit l'image SQLite et le compte cible (en rôle serveur), écrit un rapport, et échoue au premier écart non expliqué.

1. Comptes de la section 8.6.
2. Ligne à ligne, par identifiant, champs personnels : statut, note (après conversion), ressenti (null distinct de vide), Elo, compteurs, dates de dernier duel et de modification (comparées en instants), départage (score, compteur, note, groupe). Égalité exacte des flottants.
3. Classement Elo identique : liste `(id, elo_score, duels_count)` triée, égale à la v1 (AC-3).
4. Fiches : nom, type, année, genres, réalisateur, notes TMDB, synopsis (null distinct de vide), affiche, `imdb_id`, et les quatre JSON comparés après relecture. Écarts admis et listés : ceux des doublons (valeur vide complétée, JSON plus frais).
5. Duels, départages, journal : même suite d'identifiants, mêmes valeurs ; `payload` relu égal à la conversion de la v1.
6. Calculs dérivés recalculés des deux côtés : titres aimés, empreinte d'entraînement, ajouts issus d'une proposition, répartition des notes, nombre de titres par catégorie, portée des duels.
7. Noms : comparaison facultative des noms des titres résolus avec le titre français de TMDB, pour repérer un nom saisi à la main par Louis qui deviendrait visible des autres comptes (section 4.1).
8. Étanchéité : un compte témoin ne voit aucune ligne du compte importé (vue et tables).
9. Parité : `node parite/check.mjs` contre la v2 connectée au compte importé (FR-7).

### 8.8 Comptes neufs

Un compte neuf n'a aucune ligne (FR-6) ; il lit le catalogue déjà rempli par l'import, ce qui rend ses premiers ajouts moins coûteux en appels TMDB.

### 8.9 Essai réalisé

Un chargement jetable (dossier temporaire, hors dépôt) a suivi les sections 8.2 à 8.5 sur la copie de la base, dans PGlite, pour le compte de Louis puis pour un compte de démonstration. Résultat : aucune contrainte violée, aucune ligne écartée, comptes de la section 8.6 identiques pour les deux comptes, classement Elo identique à la décimale près, champs personnels et TMDB identiques (hors 15 JSON et 3 réalisateurs des doublons, expliqués), `payload` des 429 départages relus égaux à leur conversion, et le compte de démonstration ne voit aucun titre de Louis. Ce n'est pas l'outil d'import : ni reprise, ni rapport, ni image cohérente prise sur la base vivante.

## 9. Tests d'étanchéité et banc PGlite

### 9.1 Ce que prouvent les tests

| Fichier | Ce qu'il vérifie |
|---|---|
| `01_etancheite.sql` | **Structure** : toutes les tables de `public` ont la RLS ; `anon` n'a aucun droit ; chaque table portant `user_id` a exactement 4 règles permissives, pour `authenticated` seul, limitées au propriétaire là où PostgreSQL les évalue ; toute clé étrangère entre deux tables personnelles apparie `user_id` ; la vue est en `security_invoker`. **Comportement**, pour chacune des 16 tables personnelles, B (invité) contre A (compte durable) : B ne lit aucune ligne de A (avec ou sans filtre) ; ne modifie ni ne supprime rien de A (0 ligne touchée) ; une modification sans filtre ne touche que ses lignes ; écrire une ligne au nom de A est refusé (42501) ; céder ses lignes à A est refusé, avec et sans filtre (42501) ; les empreintes des lignes de A et de B sont identiques avant et après. **Par identifiant** : B vise les numéros de A (titre, playlist, duel, départage, avis, réglage) sans rien lire ni toucher ; rattacher ses lignes à celles de A (duel, départage, instantané, playlist, suggestion, duel de personnes) est refusé par les clés étrangères (23503). **Sans session** : `anon` refusé sur toutes les tables et la vue ; `authenticated` sans identifiant ne voit ni n'écrit rien. **Serveur** : `service_role` lit et écrit tout (chemin de l'import). |
| `02_catalogue_partage.sql` | Le compte durable et l'invité lisent le catalogue ; ni l'un ni l'autre n'y ajoute, ne modifie ou ne supprime une fiche ou une personne (42501) ; le serveur l'écrit ; deux fiches distinctes pour le même numéro TMDB en film et en série ; les filtres genre et disponibilité de la v2 fonctionnent sous les règles d'un compte. |
| `03_suppression_compte.sql` | Après suppression de A dans `auth.users` : plus aucune ligne de A dans les 16 tables (liste lue dans le catalogue système), aucune valeur uuid égale à A ailleurs dans `public`, B et le catalogue intacts. |
| `04_contraintes.sql` | Espaces d'identifiants par compte ; un titre une fois par compte sauf doublon hérité ; titre local ; bornes des notes, groupes, statuts ; cohérence des duels ; numérotation à partir de 1 000 000 ; format des sujets ; `on conflict do nothing` ; note d'avis ; noms de playlist ; cascades du retrait d'un titre et de la suppression d'une playlist ; protection d'une fiche utilisée. |

Format : SQL simple, chaque bloc lève une exception au premier écart et affiche « OK … » sinon ; tout se passe dans une transaction annulée à la fin. Ce n'est pas du pgTAP, que `supabase test db` attend (« All sql files use pgTAP as the test runner », https://supabase.com/docs/guides/database/testing) : sur un vrai projet, ils s'exécutent avec `psql -v ON_ERROR_STOP=1 -f supabase/tests/01_etancheite.sql` en tant que `postgres`. Les passer en pgTAP plus tard est mécanique.

### 9.2 Banc PGlite

PGlite 0.5.10 (PostgreSQL 18.6 compilé en WebAssembly), installé dans un dossier temporaire hors dépôt, sans Docker ni projet Supabase. Pour chaque fichier de test : base neuve, schéma `auth` de remplacement, `0001`, `0002`, puis le test ; ensuite, contrôle qu'il ne reste aucune ligne.

Schéma `auth` de remplacement (exécuté avant les migrations) :

```sql
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;
create schema auth;
grant usage on schema auth to anon, authenticated, service_role;
create table auth.users (
  id uuid primary key, email text,
  is_anonymous boolean not null default false,
  created_at timestamptz not null default now()
);
-- Même ordre de recherche que la fonction de Supabase Auth (section 7.2).
create function auth.uid() returns uuid language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant usage on schema public to anon, authenticated, service_role;
-- Cas le plus défavorable : tout est accordé par défaut ; ce sont les révocations de 0002 qui protègent.
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
```

Une connexion de compte se simule comme le ferait le serveur : `select set_config('request.jwt.claims', '{"sub": "<uuid>", "role": "authenticated"}', true); set local role authenticated;`.

Résultats (2026-10-26) :

- les deux migrations s'appliquent : 18 tables, 1 vue, 66 règles ;
- les 4 fichiers de test passent et ne laissent aucune ligne ;
- **les tests mordent** : dix failles introduites une à une dans le schéma (RLS coupée sur une table, règle de lecture trop large, règle d'ajout ou de modification qui ne vérifie pas le propriétaire, règle manquante, droit de lecture pour `anon`, vue sans `security_invoker`, clés étrangères sans `user_id`, table sans cascade avec le compte, catalogue modifiable) ; chacune fait échouer au moins un test. Une première version des tests laissait passer la modification sans `with check` : elle est corrigée (cession sans filtre ajoutée, contrôle de structure resserré) ;
- l'essai d'import (section 8.9) et les équivalences (section 6) ont tourné sur la même base.

### 9.3 Ce que PGlite permet de vérifier, et ce qu'il ne permet pas

Vérifié avec PGlite :

- syntaxe et application des migrations sur PostgreSQL 18.6 ;
- comportement des règles d'accès pour `authenticated`, `anon` et un rôle `bypassrls`, avec un `auth.uid()` qui lit les revendications comme celui de Supabase ;
- clés composées, cascades, contraintes, vue en `security_invoker` ;
- acceptation des données réelles de Louis par le schéma, et égalité après chargement ;
- résultats des requêtes traduites, sur les données réelles.

**Non vérifié** (dépend du vrai Supabase ou d'éléments pas encore écrits) :

- le vrai schéma `auth` (colonnes et déclencheurs de `auth.users`), la vraie fonction `auth.uid()`, et la possibilité, en tant que `postgres` sur un projet hébergé (qui n'est pas superutilisateur), d'insérer dans `auth.users` et de faire `set local role` dans les tests : à vérifier au premier passage des tests sur le projet ;
- la vérification des jetons, la connexion invité et le rattachement d'un e-mail en gardant le même identifiant (AC-4) ;
- Supavisor en mode transaction avec `set local`, et `sqlx` sans requêtes préparées ;
- PostgREST et l'exposition de `public` ; les droits par défaut réels du projet (y compris ceux de `supabase_admin`) ;
- la suppression par l'API d'administration de Supabase (seule la cascade depuis `auth.users` est testée) ;
- la version de PostgreSQL du projet (15 ou 17, à vérifier ; les fonctionnalités utilisées existent depuis la 15) et sa collation par défaut (PGlite est en `C`) ;
- les performances réelles (latence, plans d'exécution avec les règles) ;
- l'outil d'import, l'image cohérente prise sur la base vivante, le script de vérification ;
- la région UE (FR-8).

## 10. Questions ouvertes et risques

### 10.1 Questions ouvertes, les plus bloquantes d'abord

1. **Doublons** : fusionner dans la v1, avant l'import, les 5 paires (304/500, 1/512, 617/653, 276/479, 69/384), ou les importer marqués comme le prévoit le schéma ? Si on importe, quelle ligne garder comme principale (proposition : la plus ancienne) ?
2. **Rôle de connexion du serveur Rust** : `postgres` avec `set local role authenticated` à chaque requête, ou un rôle dédié sans `bypassrls` (recommandé, création à vérifier sur Supabase) ? À trancher dans la maquette de la phase 0, avec le pool.
3. **API de données de Supabase** : la désactiver (l'interface ne parle qu'au serveur Rust, et à Supabase Auth pour l'identification) ? Recommandation : oui.
4. **Jour d'exposition** : fuseau fixe `Europe/Paris` pour tous, ou par compte ? Sur Vercel, le serveur est en UTC et la v1 calcule en heure locale.
5. **Note en entier** (0 à 5) au lieu de l'émoji, rendue à l'identique par l'API : validé ?
6. **Compte de démonstration** : copie figée réimportée avant chaque session de test, ou copie vivante ? Qui la remet à zéro ?
7. **Ordre de tri** : garder exactement l'ordre de la v1 (repli ASCII, « Élise » après « Zorro »), ou un ordre français ?
8. **Catalogue** : durée de vie des fiches qu'aucun compte n'utilise (cache de la découverte, de Ce soir et du calendrier) ; cache des listes du calendrier ?
9. **Invités** : purge des comptes invités inactifs après combien de jours ?
10. **Journal et départages v1.0** : conserver indéfiniment `events` et `tier_duels` ?

### 10.2 Risques, du plus grave au moins grave

1. **Requête d'utilisateur exécutée avec un rôle qui contourne les règles** (`postgres`, `service_role`) : la seconde barrière disparaît sans bruit. Parade : rôle dédié sans `bypassrls` (question 2), test d'API qui vérifie `current_user` et l'absence de lignes d'un autre compte.
2. **Revendications non vérifiées** posées dans `request.jwt.claims` : usurpation de n'importe quel compte. Parade : vérifier la signature avant, jamais d'identifiant pris dans le corps d'une requête.
3. **Caches de processus partagés entre comptes** : le modèle de préférence (`preferenceService.ts`, variable `cached`) est personnel ; recopié tel quel en Rust, un compte recevrait les recommandations d'un autre. Parade : clé par compte, ou stockage.
4. **Import depuis une copie sans le journal WAL** : perte silencieuse des écritures récentes. Parade : API de sauvegarde de SQLite (section 8.1).
5. **Écriture du catalogue avec une donnée venue d'un navigateur** : un compte altère ce que voient les autres. Parade : règle 4.7, test 02.
6. **Nom saisi à la main dans l'ancien service, devenu public** via le catalogue : faible probabilité (noms remplacés par TMDB), contrôle 8.7.7.
7. **Écarts de comportement** sans effet sur le contrat de parité (qui compare des formes) : recherche accentuée (+6 titres pour « é »), ordre de tri, jour d'exposition, ordre des clés JSON. Parade : choix explicites (questions 4 et 7), équivalents exacts disponibles (section 6).
8. **Suite d'identifiants commune** : un compte peut estimer l'activité globale (numéros croissants à partir de 1 000 000). Sans conséquence sur l'isolation ; acceptable pour quatre testeurs.
9. **Tests non pgTAP** : non lancés par `supabase test db`. Parade : `psql`, ou conversion plus tard.
10. **Points Supabase non testés** (section 9.3) : premier passage des tests sur le projet dès sa création, avant toute donnée réelle.
