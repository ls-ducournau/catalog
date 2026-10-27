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

`GET /api/sante`, `/api/genres`, `/api/items` (filtres, tri, pagination), `/api/items/{id}`.
Elles passent le contrat de parité sur les vraies données de Louis (compte de démonstration) et rendent
les 1 077 titres dans le même ordre que la v1, champ par champ (sauf les 5 paires de doublons, fusionnées
à l'import). Pas encore porté : le filtre `onMyServices` et `?refresh=1`. Les 36 routes restantes sont à
porter, domaine par domaine (specs/catalog-v2-rust-supabase.md §6, phase 4).

## Essayer en local, sans Vercel

```
cd serveur
cargo run --release --example local        # http://127.0.0.1:3004 (lit ../poc/.env.local)
PARITE_JETON=<jeton> node ../parite/check.mjs http://127.0.0.1:3004 --v2 --seulement=genres,items,item
```

## Déployer

`vercel deploy --prod` depuis `serveur/`. Variables d'environnement du projet : `DATABASE_URL`
(sensible) et `SUPABASE_URL`. Le projet n'est pas relié à Git.
