# Serveur de la v2 (Rust)

Un service Axum unique, déployé sur Vercel (`vercel.json` réécrit toutes les routes vers `api/axum.rs`),
qui lit et écrit dans Supabase. Spec : `specs/catalog-v2-rust-supabase.md` ; données :
`specs/catalog-v2-donnees.md` ; contrat HTTP : `parite/`.

- `src/auth.rs` : vérifie le jeton Supabase (ES256) avec les clés publiques du projet (JWKS, en cache).
  Un invité et un compte e-mail suivent le même chemin. Aucun secret.
- `src/bd.rs` : un pool par instance ; `transaction()` pose l'identité de l'utilisateur
  (`request.jwt.claims`) puis `set local role authenticated` : les règles d'accès par ligne s'appliquent.
  **Toute route qui touche aux tables personnelles passe par `transaction()`.**
- `src/items.rs`, `src/routes.rs` : les routes portées (voir ci-dessous).
- `public/index.html` : la page d'essai (entrer en invité, e-mail et mot de passe, bibliothèque, fiche).

## Routes portées

Lecture : `GET /api/sante`, `/api/genres`, `/api/items` (filtres, tri, pagination), `/api/items/{id}`,
`/api/tmdb/search`. Écriture : `POST /api/items` (ajouter depuis TMDB), `PATCH /api/items/{id}` (statut,
note, ressenti, avec les règles de la v1), `DELETE /api/items/{id}`. 9 routes sur 41.

- La lecture passe le contrat de parité sur les vraies données de Louis (compte de démonstration) : les
  1 077 titres sortent dans le même ordre que la v1, champ par champ (sauf les 5 paires de doublons,
  fusionnées à l'import).
- L'écriture passe le contrat v2 (`parite/check-v2.mjs`, 23 vérifications sur un compte vierge) et un test
  d'étanchéité à deux comptes (aucun accès croisé, le catalogue partagé survit au retrait d'un titre).
- Pas encore porté : le filtre `onMyServices`, `?refresh=1`, et, pour un titre ajouté, les
  caractéristiques du modèle de préférence, la disponibilité, les dates de sortie et la bande-annonce
  (un titre déjà connu du catalogue partagé les garde ; un titre neuf ne les a pas encore).

## Transactions : une règle à ne pas casser

Toute route qui touche aux tables personnelles ouvre `bd::transaction()`, qui rend un garde `Tx`
(`valider()` ou `annuler()`). Abandonner une transaction sqlx sans rollback explicite garde sa
connexion : constaté, le pool de 5 connexions s'épuisait après 6 requêtes qui sortaient tôt (404).
Le garde lance lui-même le rollback quand on le détruit (sortie anticipée, `?` sur une erreur).

## Essayer en local, sans Vercel

```
cd serveur
cargo run --release --example local        # http://127.0.0.1:3004 (lit ../poc/.env.local)
PARITE_JETON=<jeton> node ../parite/check.mjs http://127.0.0.1:3004 --v2 --seulement=genres,items,item
```

## Déployer

`vercel deploy --prod` depuis `serveur/`. Variables d'environnement du projet : `DATABASE_URL`
(sensible) et `SUPABASE_URL`. Le projet n'est pas relié à Git.
