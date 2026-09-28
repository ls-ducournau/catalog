# Spec — Duels Elo (v1)

**Auteur** : Claude (assisté) · **Date** : 2026-09-24 · **Statut** : Draft · **Relecteur** : Louis

## 1. Contexte

Le projet "life" a déjà une base Notion `Watchlist DB` (711+ entrées films/séries/documentaires, enrichies automatiquement via TMDB : titre, statut vu/à voir, genre, année, note TMDB, ID IMDb, réalisateur, type...). L'objectif final est une app web locale de suivi personnel avec bibliothèque, notation, ressenti, recommandations et classement par duels. Ce document ne couvre que le **premier jet : le système de duels façon Elo**, qui doit produire un classement de préférence entre les films/séries/documentaires déjà vus, en présentant des paires à l'utilisateur qui choisit son préféré (ou passe).

Ce classement Elo servira plus tard de signal principal pour les recommandations (hors scope ici).

Référence de style visuel : [docs/design-reference/refero-raycast/](../docs/design-reference/refero-raycast/) — dark UI façon Raycast (fond quasi noir, accents dégradés rouge/cramoisi en formes anguleuses, cartes à coins arrondis, modale flottante façon palette de commandes).

## 2. Exigences fonctionnelles (FR)

- **FR-1** — Le système DOIT importer depuis Notion, dans une base SQLite locale, les items avec leurs propriétés pertinentes (nom, type, année, statut vu/à voir, genre, IMDb ID, note TMDB, poster).
- **FR-2** — Le système DOIT ajouter deux propriétés à la base Notion si elles n'existent pas : `Elo Score` (number) et `Ressenti` (rich text).
- **FR-3** — Seuls les items avec `Watch Status = Watched` DOIVENT être éligibles pour apparaître dans un duel (on ne peut pas préférer un film qu'on n'a pas vu).
- **FR-4** — Un item sans score Elo préalable DOIT recevoir un score initial de 1200 dès sa première entrée en rotation.
- **FR-5** — Le système DOIT présenter une paire de deux items éligibles distincts à la fois, chacun avec son affiche (poster TMDB), titre et année.
- **FR-6** — L'utilisateur DOIT pouvoir choisir : item 1 préféré (touche/bouton "1"), item 2 préféré (touche/bouton "2"), ou passer (touche/bouton "3").
- **FR-7** — Un choix "1" ou "2" DOIT déclencher un recalcul Elo des deux items selon la formule Elo standard (voir FR-8) et l'écriture du nouveau score en local (SQLite).
- **FR-8** — Le calcul Elo DOIT utiliser : `E_A = 1 / (1 + 10^((R_B - R_A) / 400))`, `R_A' = R_A + K * (S_A - E_A)` avec `K = 32` fixe, `S_A ∈ {0, 1}` (pas d'égalité possible, un duel a toujours un gagnant ou est passé).
- **FR-9** — Un "skip" (touche "3") NE DOIT PAS modifier les scores Elo des deux items, mais DOIT être enregistré (pour éviter de représenter la même paire trop vite).
- **FR-10** — Chaque duel (résultat ou skip) DOIT être journalisé dans une table `duels` (items comparés, gagnant le cas échéant, scores avant/après, horodatage).
- **FR-11** — Le sélecteur de paires DOIT éviter de représenter une paire déjà vue récemment (dans les 50 derniers duels, ou tous les duels si la bibliothèque éligible a moins de 15 items).
- **FR-12** — Le sélecteur de paires DOIT favoriser les items avec le moins de duels disputés (poids de sélection inversement proportionnel à `duels_count`), pour que tous les items entrent progressivement dans le classement, pas seulement les plus "populaires".
- **FR-13** — Le système DOIT pouvoir pousser vers Notion (à la demande ou périodiquement) les scores Elo et les champs Ressenti modifiés localement, sans écraser les autres propriétés gérées par l'automatisation TMDB de Notion.
- **FR-14** — Le système DOIT résoudre et mettre en cache le `tmdb_id` de chaque item (absent du schéma Notion actuel) via l'endpoint TMDB `/find/{imdb_id}?external_source=imdb_id`, à partir de l'IMDb ID déjà stocké.
- **FR-15** — Le système DOIT récupérer et mettre en cache localement le chemin d'affiche (`poster_path`) TMDB de chaque item via son `tmdb_id`, plutôt que de dépendre de l'URL de fichier Notion (qui expire).

## 3. Exigences non-fonctionnelles (NFR)

- **NFR-1** — La sélection de la paire suivante DOIT répondre en moins de 300 ms (lecture SQLite locale uniquement, aucun appel réseau synchrone pendant un duel).
- **NFR-2** — La synchronisation Notion (pull ou push) DOIT s'exécuter en tâche de fond, sans bloquer l'interface de duel.
- **NFR-3** — L'app est mono-utilisateur, exécutée en local (`localhost`) : aucune authentification requise.
- **NFR-4** — Si le poster TMDB est indisponible (échec réseau, `poster_path` nul), l'interface DOIT afficher un placeholder plutôt qu'une image cassée.
- **NFR-5** — L'interface DOIT suivre la direction visuelle de [docs/design-reference/refero-raycast/](../docs/design-reference/refero-raycast/) : thème sombre par défaut, cartes à coins arrondis, accents dégradés utilisés avec parcimonie.

## 4. Critères d'acceptation (AC)

- **AC-1** (FR-3, FR-5) — Given une bibliothèque avec au moins 2 items `Watched`, When l'utilisateur ouvre l'écran de duel, Then deux items distincts avec `Watch Status = Watched` sont affichés avec leur affiche et titre.
- **AC-2** (FR-3) — Given une bibliothèque avec moins de 2 items `Watched`, When l'utilisateur ouvre l'écran de duel, Then un état vide explicite est affiché (pas de crash, pas de paire incomplète).
- **AC-3** (FR-4) — Given un item n'ayant jamais participé à un duel, When il apparaît pour la première fois dans une paire, Then son score Elo affiché/utilisé est 1200.
- **AC-4** (FR-7, FR-8) — Given deux items avec Elo 1200 et 1200, When l'utilisateur choisit l'item 1, Then le nouveau score de l'item 1 est 1216 et celui de l'item 2 est 1184 (K=32, E=0.5 de part et d'autre).
- **AC-5** (FR-9) — Given une paire affichée, When l'utilisateur choisit "passer", Then les scores Elo des deux items restent inchangés et un enregistrement `duels` avec `winner_id = null` est créé.
- **AC-6** (FR-10) — When un résultat de duel (choix ou skip) est soumis, Then une ligne est ajoutée à la table `duels` avec les scores avant/après et l'horodatage.
- **AC-7** (FR-11) — Given une bibliothèque éligible de plus de 15 items, When une paire vient d'être jugée, Then cette même paire (dans un sens ou l'autre) ne DOIT PAS réapparaître dans les 50 duels suivants.
- **AC-8** (FR-12) — Given un item avec `duels_count = 0` et un autre avec `duels_count = 40` dans un pool de taille suffisante, When le sélecteur tire une paire, Then l'item à 0 duel a une probabilité de sélection strictement supérieure à l'item à 40 duels.
- **AC-9** (FR-2) — Given une base Notion sans les propriétés `Elo Score` / `Ressenti`, When le système effectue sa première synchronisation, Then ces deux propriétés sont créées dans le schéma Notion sans supprimer ni modifier les propriétés existantes.
- **AC-10** (FR-13) — Given des scores Elo modifiés localement depuis le dernier push, When une synchronisation push est déclenchée, Then seules les pages Notion concernées sont mises à jour, uniquement sur les champs `Elo Score` et `Ressenti`.
- **AC-11** (FR-14, FR-15) — Given un item avec un IMDb ID mais sans `tmdb_id` en cache, When il est importé, Then son `tmdb_id` et son `poster_path` sont résolus via TMDB et stockés localement pour les imports suivants (pas de re-résolution systématique).
- **AC-12** (NFR-4) — Given un item sans `poster_path` résolvable, When il apparaît dans un duel, Then un visuel de remplacement (placeholder) s'affiche à la place d'une image cassée.

## 5. Cas limites (EC)

- **EC-1** — Notion inaccessible (réseau/API down) pendant un pull : le système DOIT continuer à fonctionner sur les données SQLite déjà présentes, et signaler l'échec de sync sans bloquer l'UI de duel.
- **EC-2** — Item modifié à la fois dans Notion (par l'utilisateur, manuellement) et localement (Elo recalculé) entre deux syncs : le push NE DOIT écraser que les champs `Elo Score`/`Ressenti` ; les autres champs modifiés côté Notion restent intacts et sont récupérés au prochain pull.
- **EC-3** — Bibliothèque éligible (`Watched`) de très petite taille (2 ou 3 items) : la contrainte anti-répétition (FR-11) DOIT s'assouplir automatiquement pour ne pas bloquer la sélection (impossible d'éviter indéfiniment de répéter avec 2 items seulement).
- **EC-4** — Résolution TMDB via IMDb ID sans résultat (item introuvable sur TMDB) : l'item reste éligible aux duels mais avec un poster placeholder (voir NFR-4) ; le système DOIT éviter de re-tenter la résolution à chaque import (marquer comme "résolution échouée" avec une date, retry après un délai raisonnable plutôt qu'à l'infini).
- **EC-5** — Double soumission rapide du même résultat de duel (ex. double-clic ou double appui touche) : le système NE DOIT appliquer le recalcul Elo qu'une seule fois pour un même duel affiché.

## 6. Contrats d'API

```typescript
// GET /api/duels/next
type NextDuelResponse = {
  itemA: DuelItem;
  itemB: DuelItem;
} | {
  error: "not_enough_watched_items";
  eligibleCount: number;
};

type DuelItem = {
  id: number;              // id local SQLite
  notionPageId: string;
  name: string;
  year: string | null;
  type: "Movie" | "TV Series";
  posterUrl: string | null; // URL TMDB résolue, ou null -> placeholder côté UI
  eloScore: number;
  duelsCount: number;
};

// POST /api/duels/result
type DuelResultRequest = {
  itemAId: number;
  itemBId: number;
  result: "A" | "B" | "skip";
};

type DuelResultResponse = {
  itemA: DuelItem; // scores mis à jour
  itemB: DuelItem;
};

// POST /api/sync/notion/pull
type SyncPullResponse = {
  imported: number;
  updated: number;
  failed: number;
  lastSyncAt: string; // ISO datetime
};

// POST /api/sync/notion/push
type SyncPushResponse = {
  pushed: number;
  failed: number;
  lastPushAt: string;
};

// GET /api/sync/status
type SyncStatusResponse = {
  lastPullAt: string | null;
  lastPushAt: string | null;
  pendingLocalChanges: number;
};
```

## 7. Modèles de données

### SQLite — table `items`

| Champ | Type | Contraintes |
|---|---|---|
| id | INTEGER | PK autoincrement |
| notion_page_id | TEXT | UNIQUE, NOT NULL |
| name | TEXT | NOT NULL |
| type | TEXT | CHECK IN ('Movie','TV Series') |
| year | TEXT | nullable |
| watch_status | TEXT | CHECK IN ('Watched','Unwatched','Watching') |
| imdb_id | TEXT | nullable |
| tmdb_id | INTEGER | nullable |
| tmdb_resolve_failed_at | DATETIME | nullable — dernière tentative échouée (EC-4) |
| poster_path | TEXT | nullable |
| genre | TEXT | nullable — JSON array sérialisé |
| elo_score | REAL | NOT NULL, DEFAULT 1200 |
| duels_count | INTEGER | NOT NULL, DEFAULT 0 |
| last_duel_at | DATETIME | nullable |
| ressenti | TEXT | nullable |
| rating | TEXT | nullable — miroir du select Notion (emoji) |
| notion_last_edited | DATETIME | NOT NULL |
| local_dirty | INTEGER | NOT NULL, DEFAULT 0 — 1 si modifié localement depuis dernier push |
| updated_at | DATETIME | NOT NULL |

### SQLite — table `duels`

| Champ | Type | Contraintes |
|---|---|---|
| id | INTEGER | PK autoincrement |
| item_a_id | INTEGER | FK -> items.id, NOT NULL |
| item_b_id | INTEGER | FK -> items.id, NOT NULL |
| winner_id | INTEGER | FK -> items.id, nullable (null = skip) |
| elo_a_before | REAL | NOT NULL |
| elo_b_before | REAL | NOT NULL |
| elo_a_after | REAL | NOT NULL |
| elo_b_after | REAL | NOT NULL |
| created_at | DATETIME | NOT NULL |

### SQLite — table `sync_state`

| Champ | Type | Contraintes |
|---|---|---|
| key | TEXT | PK |
| value | TEXT | |

### Notion — nouvelles propriétés (data source `Watchlist DB`)

| Propriété | Type | Notes |
|---|---|---|
| Elo Score | number | défaut vide tant qu'aucun duel ; 1200 dès le premier duel |
| Ressenti | rich_text | notes libres, non structurées en v1 |

## 8. Hors périmètre (v1)

- **OS-1** — Bibliothèque avec filtres (vu/à voir, genre, type) — écran séparé, prévu après ce jet.
- **OS-2** — Notation détaillée par fiche et édition du ressenti en dehors du contexte d'un duel.
- **OS-3** — Recommandations basées sur le classement Elo — brique suivante, dépend des données produites ici.
- **OS-4** — Responsive mobile — v1 cible un usage bureau/navigateur local.
- **OS-5** — Authentification / multi-utilisateur.
- **OS-6** — K-factor adaptatif (décroissant avec le nombre de duels) — v1 utilise un K fixe ; à évaluer plus tard si le classement est jugé trop volatil ou pas assez.
- **OS-7** — Annulation ("undo") d'un résultat de duel déjà soumis.
- **OS-8** — Synchronisation Notion en temps réel (webhooks) — v1 se limite à un déclenchement manuel ou périodique (polling).

---

## Amendements v1.1 — catégorie de duel et réinitialisation de l'Elo

- **FR-16** (catégorie) — L'utilisateur DOIT pouvoir restreindre les duels à une catégorie :
  Films, Séries, Documentaires, ou Tout confondu. La catégorie suit la sémantique de la
  bibliothèque (bibliotheque-v1 FR-9 : un film ou une série taggé Documentary relève de
  Documentaires). Le choix DOIT être mémorisé d'une visite à l'autre. L'Elo reste un score unique
  par titre : un duel restreint met à jour le même Elo qu'un duel « Tout ».
- **FR-17** (réinitialisation) — L'utilisateur DOIT pouvoir remettre l'Elo à sa valeur de
  départ (1200, 0 duel) pour la catégorie sélectionnée. L'opération DOIT :
  - annoncer avant confirmation le nombre de titres touchés (ceux dont l'Elo a déjà bougé) ;
  - copier les scores d'avant dans un instantané, pour permettre l'annulation depuis l'écran ;
  - faire une sauvegarde complète de la base avant d'écrire ;
  - conserver l'historique des duels (ce sont des jugements réels, réutilisables) ;
  - ne marquer pour le prochain envoi vers Notion que les titres dont l'Elo change.

### Critères d'acceptation ajoutés

- **AC-12** (FR-16) — Given la catégorie Films, When une paire est tirée, Then les deux titres
  sont des films non documentaires.
- **AC-13** (FR-17) — Given une réinitialisation des films, When elle s'applique, Then l'Elo des
  films revient à 1200 et celui des séries est inchangé.
- **AC-14** (FR-17) — Given une réinitialisation, When l'utilisateur annule, Then chaque titre
  retrouve exactement son Elo et son nombre de duels d'avant.

## Amendements v1.2 — duels d'acteurs

Le magasin de caractéristiques (recommendations-v1 FR-23) stocke le casting principal de chaque
titre avec l'identifiant TMDB et la photo de chaque personne. Sur les titres vus, 329 acteurs
apparaissent dans au moins 3 titres, tous avec une photo.

- **FR-18** (mode) — L'écran de duels DOIT proposer deux modes : **Titres** (existant) et
  **Acteurs**. Les raccourcis 1 / 2 / 3 fonctionnent à l'identique dans les deux modes.
- **FR-19** (éligibilité) — Un acteur DOIT apparaître dans au moins **3 titres vus** pour entrer
  en duel : une préférence doit reposer sur une vraie exposition, pas sur un seul rôle. La liste
  est recalculée à partir du casting des titres vus ; un titre qui passe « Vu » peut faire entrer
  un acteur.
- **FR-20** (Elo) — Chaque acteur DOIT avoir un Elo propre, distinct de celui des titres, avec la
  même formule et la même sélection de paires (FR-11, FR-12). Cet Elo est **purement local** :
  Notion n'a pas de propriété pour les personnes, rien n'y est envoyé.
- **FR-21** (carte) — Une carte d'acteur DOIT montrer sa photo, son nom, son Elo, et les titres
  vus où tu l'as croisé, les mieux notés d'abord.
- **FR-22** (réinitialisation) — La réinitialisation (FR-17) DOIT s'appliquer au mode en cours :
  en mode Acteurs, elle remet à zéro l'Elo des acteurs seulement, avec le même instantané
  annulable et la même conservation de l'historique.

### Critères d'acceptation ajoutés

- **AC-15** (FR-19) — Given un acteur présent dans 2 titres vus seulement, When une paire
  d'acteurs est tirée, Then il n'y figure jamais.
- **AC-16** (FR-20) — Given un duel d'acteurs gagné par A, When le résultat est enregistré, Then
  l'Elo de A monte, celui de B baisse, et aucun titre n'est modifié.
- **AC-17** (FR-21) — Given un acteur, When sa carte s'affiche, Then ses titres vus sont listés
  du mieux noté au moins bien noté.
- **AC-18** (FR-22) — Given une réinitialisation en mode Acteurs, When elle s'applique, Then
  l'Elo des titres est inchangé ; When on l'annule, Then chaque acteur retrouve son Elo d'avant.

### Suite (phase 4 du plan recommandations v2)

L'Elo d'un acteur est une préférence explicite : le modèle de recommandation pourra l'exploiter
au lieu de la deviner à partir des notes.
