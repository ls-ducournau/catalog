# Contrat de parité v1 / v2

Tests HTTP indépendants du langage : une requête, un statut, la **forme** de la réponse (clés et
types, pas les valeurs). La v1 (TypeScript) les a servis à écrire `contrat.json` ; la v2 (Rust) doit
les passer à l'identique. Spec : `specs/catalog-v2-rust-supabase.md` (FR-7, AC-6).

```
node parite/record.mjs http://localhost:3002   # enregistre le contrat (v1 sur une COPIE isolée)
node parite/check.mjs  http://localhost:PORT   # vérifie un serveur (v1 ou v2) contre le contrat
```

## Règles

- Jamais contre le serveur de travail (3000, 3001) : le script refuse. Une copie isolée de la base,
  sans clé externe, comme pour les captures.
- Les cas d'écriture (`write: true` dans `cases.mjs`) ne s'exécutent que sur ce serveur isolé.
- Les routes de synchronisation Notion (`/api/sync/*`) sont hors contrat : la v2 ne les a pas (FR-1).

## Couverture (2026-10-26)

**Lecture** (`contrat.json`, 35 cas) : bibliothèque, classement, duels (titres, personnes, paliers),
recommandations, rangées, découverte, Ce soir, Sorties, Tri rapide, profil, avis sur les personnes,
écartés, abonnements, recherche TMDB, playlists, erreurs 400 et 404.

**Écriture** (`contrat-ecritures.json`, 53 appels) : note et statut d'un titre, titres écartés,
abonnements, affichages et ouvertures, duels de titres (résultat, annulation, réinitialisation),
duels de personnes, avis, paliers, réponses du Tri rapide, et tout le cycle d'une playlist
(création, ajout, ordre, renommage, vu, note, suggestion écartée, retrait, suppression,
rétablissement), avec leurs erreurs.

```
node parite/record-ecritures.mjs http://localhost:3002   # enregistre (copie JETABLE neuve)
node parite/check-ecritures.mjs  http://localhost:PORT   # rejoue et compare (copie JETABLE neuve)
```

Chaque exécution part d'une copie neuve de la base : le contrat se reproduit à l'identique
(vérifié, 53 appels sur 53).

**`--v2`** tolère l'absence des champs que la v2 retire (`notionPageId`, `notionLastEdited`,
`localDirty`, liste dans `shape.mjs`).

## Hors contrat v1, à écrire avec la v2

Ces routes passent par l'ancien service de notes et ne peuvent pas être enregistrées sans lui :
- `POST /api/items` (ajouter un titre depuis TMDB) et la réponse « J'ai envie » du Tri rapide ;
- `DELETE /api/items/:id` (retirer un titre) ;
- `/api/sync/*` (disparaissent).

Leur contrat est celui de la v2 : ajouter et retirer sans aucun service externe (FR-1, AC-1).

Il est écrit à la main dans `ecritures-v2.mjs` (8 appels : ajout, doublon, erreurs, présence, retrait,
absence après retrait, titre inconnu), d'après ce que rendait la v1 moins ce qui disparaît. Il
se passe sur un **compte vierge** d'une copie jetable, avec accès à TMDB :

```
node parite/check-v2.mjs http://localhost:PORT
```

La v1 ne peut pas le passer (elle exige l'ancien service). Reste à écrire : la réponse « J'ai
envie » du Tri rapide (qui ajoute), et le test à deux comptes (retirer chez l'un ne touche pas
le catalogue de l'autre).

## Pas encore couvert

`POST /api/duels/tier/quad`, `GET /api/items/:id?refresh=1` (rafraîchit depuis TMDB, réseau).
