# Porter une route de la v1 vers le serveur Rust : la règle du « 1 pour 1 »

Décision de Louis (2026-10-28) : **« du 1 pour 1, sans concession »**. L'application en ligne doit être
identique à l'application locale : même interface (la vraie interface Next.js, déployée telle quelle),
mêmes réponses de l'API, mêmes données, mêmes comportements. Seules différences admises :
- l'ancien service de notes (Notion) a disparu : plus de `notionPageId`, de `/api/sync/*`, d'erreurs `notion_*` ;
- chaque personne a son compte (Supabase Auth) : les données sont isolées par `user_id`.

Toute autre différence est un défaut, sauf si elle est **écrite, justifiée et validée** dans la spec
(`specs/catalog-v2-rust-supabase.md`). « Plus propre » ne justifie pas un écart.

## Où regarder

- La v1 : `src/app/api/**/route.ts` (les routes) et `src/lib/*.ts` (la logique). C'est la référence.
- Les tests de la v1 : `src/lib/*.test.ts`. **Porte en Rust les tests unitaires du module que tu portes**
  (mêmes cas, mêmes valeurs attendues) : c'est la preuve la plus forte du 1 pour 1.
- Le schéma v2 : `supabase/migrations/*.sql`, expliqué dans `specs/catalog-v2-donnees.md` (catalogue partagé
  `catalog_titles`, `catalog_people` ; données personnelles avec `user_id` ; vue `library_view`).
- Le serveur : `serveur/src/` (lis `bd.rs`, `auth.rs`, `items.rs`, `ecriture.rs`, `duels.rs`, `tri.rs` avant
  d'écrire : ce sont les modèles à suivre).
- Le contrat HTTP : `parite/` (`contrat.json` pour les lectures, `contrat-ecritures.json` pour les
  écritures, `README.md`).

## Règles d'écriture du serveur (toutes ont été apprises à la dure)

1. **Transactions** : toute route qui touche aux données d'un compte ouvre `bd::transaction(&utilisateur)`,
   qui rend un garde `Tx`. On termine par `tx.valider().await?`. Une sortie anticipée (404, `?`) le détruit
   et il annule lui-même. **Jamais** de `pool.begin()` direct : une transaction abandonnée gardait sa
   connexion et épuisait le pool (500 « pool timed out » après 6 requêtes).
2. Exécuteur : avec `tx: Tx` possédé, `&mut **tx` ; dans une fonction qui reçoit `tx: &mut Tx`, `&mut ***tx`.
3. **Toujours `.persistent(false)`** sur chaque requête (le pooler de Supabase, en mode transaction, ne
   garde pas les requêtes préparées).
4. Le **catalogue partagé** (`catalog_titles`, `catalog_people`) ne s'écrit **qu'avec le pool direct**
   (`bd::pool()`, rôle du serveur), jamais dans la transaction de l'utilisateur.
5. `events.context` : un objet JSON, ou **NULL SQL** (`Option<Value>` à `None`) ; un `null` JSON est refusé
   par la contrainte.
6. `user_id` a `auth.uid()` pour valeur par défaut partout : ne le nomme pas dans un `insert` (sauf si tu
   recopies une ligne existante, `select user_id, ...`).
7. Les notes sont des entiers 0 à 5 en base ; l'API les rend en émoji (`items::NOTES`) comme la v1.
8. Les tris « COLLATE NOCASE » de SQLite : `items::nocase(...)` (repli ASCII + ordre des octets) ; la
   recherche « LOWER(name) LIKE » : repli ASCII seulement. Sinon l'ordre diffère de la v1.
9. Erreurs : même statut et même corps que la v1 (`{ "error": "..." }`). Une erreur interne : `Erreur::Interne`
   (le détail va dans les journaux, la réponse dit `internal_error`).
10. Une route non portée n'existe pas (404 vide d'Axum) : ne crée pas de fausse route.

## Comment prouver le 1 pour 1 (obligatoire pour chaque route)

On compare la v1 et la v2 **sur les mêmes données** :

1. **Une copie isolée de la v1**, sur un port à toi : copie `src`, `public`, `package.json`,
   `next.config.ts`, `tsconfig.json`, `postcss.config.mjs`, `next-env.d.ts` et `.env` **sans les lignes
   `NOTION`** dans un dossier jetable de ton scratchpad ; fais une sauvegarde cohérente de la base
   (`new Database("C:/Users/USER/Programmation/catalog/data/watchlist.db", { readonly: true }).backup(<copie>/data/watchlist.db)`,
   avec `better-sqlite3` du dépôt principal) ; relie `node_modules` par une **jonction** vers
   `C:\Users\USER\Programmation\catalog\node_modules` ; lance `npx next dev --webpack -p <ton port v1>`
   **caché** (PowerShell `Start-Process cmd.exe -WindowStyle Hidden ...`, jamais une tâche de fond Bash).
   À la fin : arrête-le, retire la jonction avec `cmd /c rmdir` (**JAMAIS** `rm -rf` sur une jonction : ça
   effacerait le vrai `node_modules`), puis supprime le dossier.
2. **Un compte v2 jetable avec les mêmes données** : crée un utilisateur (API d'administration de Supabase,
   e-mail `parite-<ton groupe>-<horodatage>@catalog-poc.test`, mot de passe aléatoire, `email_confirm: true`),
   puis `node C:/Users/USER/Programmation/catalog/supabase/import/importer.mjs --compte <uuid> --source <la
   même sauvegarde>` (lance-le depuis le dépôt principal : il a besoin de ses `node_modules`). À la fin :
   supprime l'utilisateur (la cascade efface ses données).
3. **Ton serveur Rust local** : `cargo run --release --example local` avec `PORT=<ton port v2>` et
   `CATALOG_ENV=C:/Users/USER/Programmation/catalog/poc/.env.local` (les secrets : base, Supabase, TMDB).
4. **Compare** :
   - la forme : `PARITE_JETON=<jeton du compte> node parite/check.mjs http://127.0.0.1:<port v2> --v2 --seulement=<cas>` ;
   - les écritures : `PARITE_JETON=... PARITE_SEULEMENT=<préfixe> node parite/check-ecritures.mjs ... --v2` ;
   - **les valeurs**, champ par champ, entre ta copie v1 et ta v2 (JSON aux clés triées) : mêmes éléments,
     même ordre, mêmes champs. Note chaque écart et sa cause ; un écart non expliqué est un défaut.
   - le hasard (duels, semences de découverte, « Surprends-moi ») : compare ce qui est déterministe, et
     prouve le reste par les tests unitaires portés (mêmes entrées, même RNG injecté).
5. Ajoute au contrat (`parite/cases.mjs`, `parite/ecritures.mjs`) les cas qui manquent pour tes routes.

## Interdits

- **Jamais** d'écriture vers le serveur de travail de Louis (ports 3000, 3001) ni vers `data/` : lecture
  seule, et seulement pour faire la sauvegarde. Tes comparaisons se font contre **ta copie** de la v1.
- Jamais de déploiement Vercel, jamais de commit, jamais de modification de `src/` (l'interface) : c'est
  le travail du coordinateur. Tu travailles dans `serveur/`, `parite/` et, si un changement de schéma est
  indispensable, une migration `supabase/migrations/0004_<groupe>_<objet>.sql` **additive** que tu signales
  (ne l'applique pas toi-même au projet partagé).
- Jamais d'affichage d'un secret (clé, mot de passe, adresse de base).
- Supprime tout ce que tu crées : comptes Supabase d'essai, copies, serveurs, jonctions.
