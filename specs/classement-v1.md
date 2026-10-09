# Classement, départage et personnes — v1

**Statut :** livré le 2026-09-26 (demandes de l'utilisateur des 2026-09-25 et 26)
**Date :** 2026-09-25

## 1. Contexte

Les notes perso rangent les titres vus en six paliers (💩 à ⭐⭐⭐⭐⭐), mais un palier est gros :
170 titres à ⭐⭐⭐⭐, 251 à ⭐⭐⭐. L'Elo général ne sait pas les départager proprement : un titre à
⭐⭐⭐ qui a souvent croisé des ⭐⭐⭐⭐⭐ en duel finit plus bas qu'un ⭐⭐⭐ qui a croisé des ⭐, sans
que ça dise quoi que ce soit de leur ordre entre eux. Il faut donc un classement par palier, et
des duels qui ne comparent que des titres de même note.

Deux demandes s'y ajoutent : annuler un duel comme on annule une réponse du tri rapide, et voir
d'un coup d'œil les personnes que tu aimes.

## 2. Exigences fonctionnelles

- **FR-1** (annulation des duels) — Dans chaque mode de duel, Ctrl+Z (⌘+Z sur Mac) et un bouton
  « Annuler » DOIVENT défaire le dernier duel de la session : scores et compteurs reprennent leur
  valeur d'avant, le duel sort de l'historique, et la paire revient à l'écran. Les annulations
  s'enchaînent, jusqu'aux 20 derniers duels. Un duel NE DOIT être annulé que si aucun duel
  ultérieur n'a touché ses deux titres et si leurs scores n'ont pas bougé depuis ; sinon
  l'annulation est refusée, sans rien modifier.
- **FR-2** (classement par étoiles) — Une vue « Classement » DOIT présenter les titres vus par
  palier de note, du plus haut au plus bas, puis les titres vus sans note. Filtre Tout / Films /
  Séries / Documentaires. Dans un palier : d'abord les titres départagés, par score de palier
  décroissant, numérotés ; puis les titres « à départager ».
- **FR-3** (départage) — Chaque palier d'au moins deux titres DOIT offrir un bouton
  « Départager » qui lance des duels entre titres de ce palier uniquement (et de la catégorie
  choisie).
- **FR-4** (score de palier) — Un duel de départage DOIT mettre à jour un score propre au palier
  (Elo, départ 1200, K = 32), sans toucher l'Elo général ni marquer le titre pour Notion. Ce score
  est attaché à la note du moment : si la note change (depuis l'app, le tri rapide ou Notion), il
  ne vaut plus, et le titre redevient « à départager » dans son nouveau palier.
- **FR-5** (choix des paires) — Priorité aux titres les moins comparés dans le palier. Dès qu'un
  titre a deux duels de départage, son adversaire SHOULD être proche de lui en score : départager
  ce qui est serré plutôt que confirmer l'évident. Pas de paire répétée parmi les 50 derniers
  duels de départage, sauf palier trop petit pour l'éviter.
- **FR-7** (fin du départage, demande du 2026-09-26) — Un départage DOIT avoir une fin. Un titre
  est **départagé** quand il a disputé 5 duels de départage dans son palier ; un palier est
  **départagé** quand tous ses titres le sont. Tant qu'il reste des titres à départager, chaque
  paire en contient au moins un. Palier départagé : plus de paire, mais un écran de fin
  (titres et duels du palier, liens vers le classement et vers le palier suivant qui reste à
  départager) et un choix explicite « Affiner encore », qui reprend des duels entre tous les titres
  du palier. Un titre noté plus tard dans ce palier le rouvre. Le classement affiche la
  progression en titres départagés.
- **FR-6** (vue Personnes) — Une vue DOIT lister les personnes sur lesquelles tu as donné un avis
  (tri rapide), « J'aime » et « Je n'aime pas » séparés : photo, rôles, nombre de tes titres vus
  où elle figure, moyenne de tes notes sur ces titres, et ses titres dans ta pile à voir. L'avis
  DOIT pouvoir être inversé ou retiré, et ce retrait annulé sur le moment.

### Amendement v1.1 — départager un gros palier (demande du 2026-09-26)

Un palier de 21 titres se départage vite ; un palier de 160 demande 8 fois plus de comparaisons
(de l'ordre de N × log₂ N), soit 400 duels avec la règle v1, sans rien d'utile avant la fin.

- **FR-8** (un seul parcours) — « Départager » DOIT choisir l'étape lui-même et l'annoncer
  (« Étape 1 sur 2 : répartir, 54 sur 183 »). Un palier de moins de 60 titres (dans la catégorie
  choisie) passe directement aux quatuors.
- **FR-9** (répartir) — Dans un palier de 60 titres ou plus, chaque titre DOIT d'abord être rangé
  en Bas, Milieu ou Haut du palier, une carte à la fois (1, 2, 3 ; ou ←, ↓, →). Le classement
  range alors le palier par groupe, du Haut au Bas, dès cette étape.
- **FR-10** (quatuors) — *Modifié le 2026-09-28 : l'affinage montre 2 titres (un duel : « Lequel est au-dessus ? », Espace pour passer), quatre étant trop exigeant ; le calcul ci-dessous vaut pour deux titres (une comparaison).* L'affinage DOIT montrer 4 titres d'un même groupe (moins s'il en reste
  moins) : on désigne le meilleur, puis le moins bon. Deux touches valent 5 comparaisons ; si le
  moins bon est indécidable, « Passer » ne retient que le meilleur (3 comparaisons). Les quatuors
  réunissent de préférence les titres les moins comparés et proches en score. Le score de palier
  est mis à jour pour toutes les comparaisons à la fois, depuis les scores d'avant le quatuor.
- **FR-11** (ordre des groupes) — On affine le Haut d'abord, puis le Milieu, puis le Bas : l'ordre
  compte le plus en haut, et s'arrêter tôt laisse déjà un haut de palier ordonné. Chaque groupe
  fini s'annonce, avec le choix de continuer ou de voir le classement.
- **FR-7, précision** — Un titre est départagé après 5 comparaisons dans son palier (duels v1 et
  quatuors comptent pareil) ; les titres déjà départagés en duels le restent.
- **FR-1, précision** — Ctrl+Z annule aussi une répartition ou un quatuor, en entier.
- **FR-2, précision** (2026-09-26) — La numérotation DOIT être continue sur tout le classement : le
  premier titre des ⭐⭐⭐⭐ suit le dernier des ⭐⭐⭐⭐⭐. Chaque titre a un numéro ; celui d'un titre
  pas encore comparé est provisoire et s'affiche en retrait.

#### Critères d'acceptation ajoutés

- **AC-11** (FR-8, FR-9) — Given un palier de 60 titres dont certains ne sont pas répartis, When
  on départage, Then l'étape proposée est la répartition d'un titre non réparti ; Given un palier
  de 20 titres, Then c'est un quatuor.
- **AC-12** (FR-10) — Given un quatuor A, B, C, D à scores égaux, When A est le meilleur et D le
  moins bon, Then A gagne 3 comparaisons, D en perd 3, B et C en gagnent 1 et en perdent 1 ; les
  scores de A > B = C > D.
- **AC-13** (FR-11) — Given un palier réparti dont le Haut n'est pas départagé, When un quatuor est
  proposé, Then ses titres sont tous du Haut ; Given le Haut départagé, Then ils sont du Milieu.
- **AC-14** (FR-1) — Given un quatuor enregistré, When on l'annule, Then les quatre titres
  retrouvent exactement leur état d'avant.
- **AC-15** (FR-9) — Given un palier réparti, When le classement se calcule, Then les titres du
  Haut précèdent ceux du Milieu, qui précèdent ceux du Bas.

### Amendement v1.2 — personnes : réinitialiser et noter (demande du 2026-09-27)

« Il faut pouvoir réinitialiser les j'aime et j'aime pas des personnages. Et ajouter une notation
aux personnes que l'on aime. » ; « Il faut forcément une confirmation de réinitialisation et un
toast de undo. »

- **FR-12** (réinitialiser) — La vue Personnes DOIT permettre d'effacer d'un geste tous les avis
  de la liste affichée (« J'aime » ou « Je n'aime pas »). Le geste DOIT passer par une confirmation
  qui dit combien d'avis seront effacés et ce que ça change (ils ne pèsent plus sur les
  recommandations) ; une fois fait, une notification DOIT proposer « Annuler » pendant 10 s, qui
  rétablit les avis exactement (avis, note, date).
- **FR-13** (noter) — Une personne aimée DOIT pouvoir recevoir de 1 à 5 étoiles ; recliquer sur la
  note choisie la retire. La note module le poids de l'avis dans les recommandations :
  poids = note ÷ 3 (1 étoile : 0,33 ; 3 : 1 ; 5 : 1,67) ; une personne aimée sans note garde le
  poids 1. Les « Je n'aime pas » ne se notent pas. La liste des personnes aimées se trie par note,
  puis par nombre de titres vus. Changer l'avis en « Je n'aime pas » efface la note.

#### Critères d'acceptation ajoutés (v1.2)

- **AC-16** (FR-12) — Given 3 personnes aimées et 2 écartées, When on réinitialise les « J'aime »,
  Then il ne reste que les 2 écartées ; When on annule, Then les 3 reviennent avec leurs notes.
- **AC-17** (FR-13) — Given une personne aimée notée 5 et une autre notée 1, When les poids se
  calculent, Then la première pèse 5 fois plus que la seconde (avant centrage).
- **AC-18** (FR-13) — Given une personne aimée notée 4, When on la passe en « Je n'aime pas »,
  Then sa note est effacée.

## 3. Exigences non fonctionnelles

- **NFR-1** (barres de défilement) — Les barres de défilement DOIVENT suivre le thème sombre :
  fines, discrètes, sans flèches. Les rangées horizontales n'affichent la leur qu'au survol (leurs
  flèches et leurs bords estompés disent déjà qu'il y a de la suite).
- **NFR-2** — Le score de palier et l'historique des départages restent locaux.

## 4. Critères d'acceptation

- **AC-1** (FR-1) — Given un duel gagné par A, When on l'annule, Then l'Elo de A et de B et leurs
  compteurs de duels reprennent leur valeur d'avant, et le duel n'est plus dans l'historique.
- **AC-2** (FR-1) — Given un duel plus récent impliquant A, When on annule le plus ancien, Then
  l'annulation est refusée et rien ne change.
- **AC-3** (FR-4) — Given deux titres ⭐⭐⭐⭐, When A gagne un duel de départage, Then le score de
  palier de A monte, celui de B baisse, et leur Elo général comme leur marque Notion sont
  inchangés.
- **AC-4** (FR-4) — Given un titre départagé à ⭐⭐⭐⭐, When sa note passe à ⭐⭐⭐⭐⭐, Then il apparaît
  « à départager » parmi les ⭐⭐⭐⭐⭐.
- **AC-5** (FR-2) — Given un palier avec deux titres départagés et un non départagé, When le
  classement se calcule, Then les deux départagés viennent d'abord, du meilleur score au moins
  bon, puis le non départagé.
- **AC-6** (FR-3) — Given un départage des ⭐⭐⭐⭐ en Films, When une paire est proposée, Then les
  deux titres sont des films vus notés ⭐⭐⭐⭐.
- **AC-7** (FR-5) — Given un titre comparé plusieurs fois, When on lui cherche un adversaire, Then
  un titre proche en score est plus souvent choisi qu'un titre éloigné.
- **AC-9** (FR-7) — Given un palier dont un seul titre a moins de 5 duels, When une paire est
  proposée, Then ce titre en fait partie.
- **AC-10** (FR-7) — Given un palier dont tous les titres ont 5 duels, When on demande une paire,
  Then la réponse annonce la fin du palier et le prochain palier à départager ; When on demande à
  affiner, Then une paire est proposée.
- **AC-8** (FR-6) — Given une personne aimée présente dans 3 titres vus (notés 5, 4 et 3) et 1
  titre à voir, When la vue se calcule, Then elle affiche 3 titres vus, une moyenne de 4, et ce
  titre à voir.

## 5. Cas limites

- **EC-1** — Palier de moins de deux titres : pas de bouton « Départager » ; l'écran de duel
  affiche un état vide explicite.
- **EC-2** — Note changée entre l'affichage d'une paire et la réponse : la réponse est refusée,
  une nouvelle paire est proposée.
- **EC-3** — Annulation d'un duel antérieur à une réinitialisation de l'Elo : refusée (les scores
  ont bougé depuis).

## 6. Contrats d'API

```ts
GET  /api/classement?category=Movie            → { tiers: Tier[]; unrated: number }
type Tier = { stars: 0..5; rating: string; items: RankedItem[]; compared: number };
type RankedItem = LibraryItem & { tierScore: number | null; tierDuels: number };

GET  /api/duels/tier/next?stars=4&category=Movie
  → { itemA; itemB; scope: { titles: number; compared: number } }
  | { error: "not_enough_titles"; eligibleCount: number }
POST /api/duels/tier/result { itemAId, itemBId, result: "A" | "B" | "skip", stars }
  → { duelId } | { error: "stale" } (409)

POST /api/duels/undo { mode: "titles" | "people" | "tier", duelId } → { ok: true } | { error: "conflict" } (409)
// Les résultats de duel renvoient désormais leur `duelId`.

GET    /api/people/opinions → { people: PersonView[] }
PUT    /api/people/opinions { id, name, opinion: 1 | -1, rating?: 1..5 | null }  // v1.2 : note
DELETE /api/people/opinions { id }
POST   /api/people/opinions/reset { side: "liked" | "disliked" } → { removed: OpinionRow[] }   // v1.2
POST   /api/people/opinions/restore { rows: OpinionRow[] } → { ok: true }                      // v1.2
type OpinionRow = { personId: number; name: string; opinion: 1 | -1; rating: number | null; updatedAt: string };
```

## 7. Modèle de données

- `items` : `tier_elo REAL NOT NULL DEFAULT 1200`, `tier_duels_count INTEGER NOT NULL DEFAULT 0`,
  `tier_rating TEXT` (la note pour laquelle ce score vaut).
- `tier_duels` : `id`, `item_a_id`, `item_b_id`, `winner_id`, `rating`, `elo_a_before`,
  `elo_b_before`, `elo_a_after`, `elo_b_after`, `created_at`.
- v1.1 : `items.tier_band` (0 Bas, 1 Milieu, 2 Haut ; vaut pour `tier_rating` comme le score) ;
  `tier_rounds` : `id`, `rating`, `kind` (`band` | `quad`), `payload` (état avant/après de chaque
  titre touché, pour l'annulation), `created_at`. Les duels de départage v1 restent en historique.
- v1.2 : `person_opinions.rating INTEGER` (1 à 5, seulement pour un avis +1 ; NULL sinon).

## 8. Hors périmètre

- **OS-1** — Envoyer le score de palier à Notion.
- **OS-2** — Nourrir le modèle de recommandation avec le score de palier : à mesurer sur le banc
  avant tout usage (il pourrait affiner les notes, mais rien ne le prouve encore).
