# Spec — Recherche par personne, v1 (correctifs)

**Auteur** : Claude (assisté) · **Date** : 2026-09-24 · **Statut** : Draft · **Relecteur** : Louis

## 1. Contexte

`ajout-item-v1.md` a introduit la recherche par nom de personne (réalisateur/producteur/acteur) dans l'écran d'ajout : taper un nom déclenche la récupération de sa filmographie via TMDB (`movie_credits`/`tv_credits`), fusionnée avec les correspondances de titre classiques.

En usage réel, l'utilisateur a rapporté une ambiguïté sur la recherche "Brad Pitt". L'audit `specs/audit-recherche-personne.md` (mesuré contre l'API TMDB réelle, 231 résultats) a identifié la cause : ce n'est pas un problème de détection de rôle (réalisateur/producteur/acteur sont en fait correctement distingués en données), mais un problème de **présentation** — absence de hiérarchie, de regroupement et de tri pertinent sur un volume de résultats important (jusqu'à 227 crédits réels pour une carrière longue). Cette spec formalise les correctifs, priorisés P0→P2 dans l'audit.

## 2. Exigences fonctionnelles (FR)

- **FR-1** (corrige C1, P0) — Quand une recherche fait remonter à la fois une filmographie de personne (`personCredit` non vide sur au moins un résultat) et des correspondances de titre pur (aucun `personCredit`), les résultats DOIVENT être présentés en deux groupes distincts : la filmographie de la personne en premier, les correspondances de titre pur ensuite dans une section clairement intitulée (ex. "Autres résultats pour « {requête} »"). Une recherche de titre classique (aucune personne détectée) NE DOIT PAS changer de comportement.
- **FR-2** (corrige C2, P0) — Les résultats de filmographie DOIVENT être regroupés visuellement par rôle (Réalisateur / Producteur / Acteur), chaque groupe affichant son propre en-tête et son propre compte (ex. "Acteur (133)"), plutôt qu'une liste plate mélangeant les rôles.
- **FR-3** (corrige C5, P1) — Quand des résultats de filmographie sont présents, un filtre par rôle (chips : Tous / Réalisateur / Producteur / Acteur) DOIT être disponible, combinable avec les filtres Type/Genre/Année existants. Un chip de rôle sans aucun résultat NE DOIT PAS être affiché (ex. pas de chip "Réalisateur" si la personne n'a aucun crédit de réalisation).
- **FR-4** (corrige C3, P1 — **amendé** : notoriété plutôt que qualité, cf. retour utilisateur sur l'exemple DiCaprio) — Le tri par défaut à l'intérieur de chaque groupe de rôle, ainsi que des correspondances de titre pur (FR-1), DOIT classer par nombre de votes TMDB décroissant (`voteCount`, valeurs nulles traitées comme 0) — pas par note moyenne (`voteAverage`). Un titre massivement connu mais clivant (mal noté par une partie du public) DOIT ressortir avant un titre confidentiel bien noté par une poignée de votants. La note moyenne et l'année ne servent qu'en 2e/3e critères de départage à nombre de votes égal.
- **FR-5** (corrige C4, P2) — Quand une personne a plusieurs rôles sur un même titre (ex. réalisateur ET acteur sur son propre film), TOUS les rôles applicables DOIVENT être conservés et affichés ensemble (ex. "Réalisateur & Acteur"), au lieu que la déduplication n'en garde qu'un silencieusement.
- **FR-6** (corrige C6, P2) — Un résultat sans année ET sans aucun genre DOIT être trié en fin de son groupe (rôle) plutôt que traité à égalité avec le reste — sans être supprimé (pas de faux négatif sur une entrée légitime mais peu renseignée).
- **FR-7** (atténue C1, P1) — La section "Autres résultats" (titre pur, cf. FR-1) DOIT être repliée par défaut au-delà de 3 entrées, avec une action explicite ("Voir N de plus") pour l'étendre — afin de ne pas repousser la filmographie pertinente hors de l'écran visible sur les noms ayant beaucoup de contenu "à propos de".
- **FR-8** (nouveau, découvert en usage réel : recherche "Fjord") — La récupération de filmographie pour un résultat `person` NE DOIT PAS se déclencher si un titre correspondant à la même requête a une popularité TMDB au moins deux fois supérieure à celle de cette personne. Une simple marge (≥1x) est trop fragile : un documentaire "à propos de" une personne a souvent une popularité proche de la sienne (cf. "Dupieux" : titre 1.24 vs personne 1.17) et ne doit pas suffire à supprimer sa filmographie. Un nom de famille courant sans lien avec la requête (ex. "Fjord" : titre 8.0 vs personnes ≤0.6, x13) doit en revanche être clairement écarté.

## 3. Exigences non-fonctionnelles (NFR)

- **NFR-1** — Aucun appel réseau supplémentaire : regroupement, tri et déduplication multi-rôle DOIVENT être calculés côté client à partir des données déjà récupérées (cohérent avec la contrainte déjà appliquée aux filtres Type/Genre/Année).
- **NFR-2** — Le regroupement par rôle ne DOIT pas s'appliquer si aucun résultat n'a de `personCredit` (recherche de titre simple) — la liste reste plate comme aujourd'hui.

## 4. Critères d'acceptation (AC)

- **AC-1** (FR-1) — Given la recherche "Brad Pitt" (231 résultats : 227 avec crédit, 4 sans), When les résultats s'affichent, Then les 227 crédits réels apparaissent avant les 4 résultats de titre pur, ces derniers regroupés sous "Autres résultats pour « Brad Pitt »".
- **AC-2** (FR-2, FR-3) — Given les 227 crédits (94 producteur, 133 acteur, 0 réalisateur), When affichés, Then ils apparaissent sous deux en-têtes "Producteur (94)" et "Acteur (133)" (pas d'en-tête "Réalisateur" puisque 0 résultat), et les chips de filtre par rôle affichent uniquement "Tous / Producteur / Acteur".
- **AC-3** (FR-4) — Given la filmographie de Leonardo DiCaprio incluant Titanic/Inception/The Wolf of Wall Street (des dizaines de milliers de votes) et des documentaires ou apparitions mineures (quelques centaines de votes, parfois mieux notés), When triée par défaut, Then les titres massivement connus (nombre de votes) apparaissent en premier, indépendamment de leur note moyenne.
- **AC-4** (FR-5) — Given une personne réalisatrice ET actrice d'un même film, When ce film apparaît dans les résultats, Then il affiche les deux rôles ("Réalisateur & Acteur"), pas un seul.
- **AC-5** (FR-7) — Given 4 résultats de titre pur pour "Brad Pitt", When la section "Autres résultats" s'affiche, Then elle montre 3 entrées et un bouton "Voir 1 de plus".

## 5. Cas limites (EC)

- **EC-1** — Une personne avec un seul rôle (ex. producteur pur type Jerry Bruckheimer) : le regroupement ne produit qu'un seul groupe/chip, pas de groupes vides pour les rôles absents.
- **EC-2** — Un nom de personne sans aucune correspondance de titre pur associée : la section "Autres résultats" ne s'affiche pas du tout (ni vide, ni à 0).
- **EC-3** — Recherche de titre classique sans personne détectée : comportement inchangé (liste plate, tri existant, pas de groupes de rôle).

## 6. Hors périmètre (v1 de ce correctif)

- **OS-1** — Regroupement par personne distincte en cas d'homonymes multiples (ex. deux "John Smith" différents) : actuellement leurs filmographies sont fusionnées dans un même pool sans séparation par personne. Non traité ici — à specifier séparément si le cas se présente en usage réel.
- **OS-2** — Un sélecteur de rôle *au moment de la frappe* (chercher explicitement "en tant que réalisateur") : écarté précédemment (cf. décision utilisateur sur `ajout-item-v1.md`) au profit de la détection automatique déjà en place. *(Amendé par FR-8 : la détection automatique elle-même a depuis été affinée par un filtre de popularité comparative, au-delà de la simple présentation.)*
- **OS-3** — Filtrage qualité avancé (détection de contenus TMDB de faible qualité au-delà du critère simple "ni année ni genre") — cf. FR-6, volontairement limité à ce seul signal.
