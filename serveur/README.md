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
- `src/tmdb.rs` (et `src/tmdb/` : dates de sortie, bandes-annonces, dates JavaScript) : tout `src/lib/tmdb.ts`
  (recherche avec filmographie d'une personne, fiche, caractéristiques, disponibilité, dates de sortie,
  bande-annonce vérifiée sur YouTube, découvertes, services). `src/catalogue.rs` : le catalogue partagé écrit
  depuis TMDB (ajout complet, synopsis et données récupérés à l'ouverture d'un titre, `?refresh=1`), toujours
  dans une transaction du serveur (`bd::transaction_serveur()`), jamais dans celle d'un compte.
- `public/index.html` : la page d'essai (entrer en invité, e-mail et mot de passe, bibliothèque, fiche).

## Routes portées

Lecture : `GET /api/sante`, `/api/genres`, `/api/items` (filtres, tri, pagination), `/api/items/{id}`,
`/api/tmdb/search`. Écriture : `POST /api/items` (ajouter depuis TMDB), `PATCH /api/items/{id}` (statut,
note, ressenti, avec les règles de la v1), `DELETE /api/items/{id}`. Duels de titres, de personnes et par
palier : `/api/duels/*` (`undo` dans les trois modes). Tri rapide : `/api/triage/*`. Classement :
`GET /api/classement`. Avis sur les personnes : `/api/people/opinions*`. Playlists : `/api/playlists*`.
Titres écartés, affichages, ouvertures, profil : `/api/dismissals`, `/api/impressions`, `/api/opened`,
`/api/profile/feedback`. Réglages : `/api/settings/subscriptions`, `/api/providers`.

- La lecture passe le contrat de parité sur les vraies données de Louis (compte de démonstration) : les
  1 077 titres sortent dans le même ordre que la v1, champ par champ (sauf les 5 paires de doublons,
  fusionnées à l'import).
- L'écriture passe le contrat v2 (`parite/check-v2.mjs`, 23 vérifications sur un compte vierge) et un test
  d'étanchéité à deux comptes (aucun accès croisé, le catalogue partagé survit au retrait d'un titre).
- TMDB (groupe 4) : un titre ajouté reçoit toute la fiche de la v1 (caractéristiques du modèle, disponibilité,
  dates de sortie, bande-annonce, synopsis et votes en français) ; la fiche d'un titre complète le synopsis et
  rafraîchit ce qui a plus de 7 jours ; `?refresh=1` ; la recherche rend la filmographie d'une personne. Prouvé
  contre une copie de la v1 sur les mêmes données (specs/catalog-v2-rust-supabase.md, « TMDB complet »).
- Groupes 1 et 2 (2026-11-06) : classement, personnes, paliers, playlists, titres écartés, fraîcheur et profil,
  prouvés contre une copie de la v1 sur les mêmes données (rendus dans la spec).
- Groupe 3 (2026-11-06) : `GET /api/accueil` (ce que `chargerAccueilLocal()` rend en v1), `/api/recommendations`,
  `/api/recommendations/rows`, `/api/recommendations/discover`, `/api/tonight`, `/api/calendar`, et les cartes
  « à découvrir » du Tri rapide. Le modèle de préférence (`modele.rs`) calcule les mêmes flottants que la v1 au
  bit près : mêmes opérations dans le même ordre, et les fonctions mathématiques de V8 (`flottants.rs`, fdlibm,
  vérifiées sur 800 000 cas). Un modèle par compte, gardé en mémoire tant que son empreinte ne change pas.
  Écart restant : `tint` (teinte des affiches de l'accueil), voir `accueil.rs`.
- Pas encore porté : la vitrine (`/api/vitrine`, spec accueil-vitrine-connexion-v1).

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
