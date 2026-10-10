# Fraîcheur des recommandations — v1

**Auteur** : Claude (assisté) · **Date** : 2026-10-09 · **Statut** : Livré le 2026-10-09 (critère de
renouvellement révisé après mesure, à confirmer, cf. § 7) · **Relecteur** : Louis
**Origine** : fiche Notion « Algorithme Reco. » (backlog, 2026-10-08)

## 1. Contexte

**Symptôme** (fiche Notion) : les recommandations bouclent sur le même pool de titres, quel que
soit l'écran.

**Diagnostic**, revérifié dans le code le 2026-10-09 :

- Le journal `events` (`src/lib/db.ts`, `journalService.ts`) ne connaît que des gestes
  explicites : ajout, retrait, note, écartement, tri, gestes des playlists. Rien n'enregistre
  qu'un titre a été **montré**.
- Les trois classements sont déterministes, et chacun alimente plus d'écrans que la fiche ne le
  dit :
  - `rankPile` (`recommendationService.ts`) : Ma pile (vues Pour toi et Classement), **et
    l'accueil** (`getHomeShowcase` appelle `getRecommendations` : carrousel « Il y a un titre
    pour ça », « À la une », fenêtre sur la pile).
  - `fromPile` / `fromCatalog` (`tonightService.ts`) : Ce soir. Tri par score seul, sans
    diversité ni calibration.
  - `getDiscoveries` (`discoveryService.ts`) : À découvrir, **et le tri rapide**
    (`triageService.ts`). Seule variation : 6 semences tirées parmi tes 20 titres les mieux
    notés.
- Sans nouvelle note, chaque appel rend le même ordre, et rien ne se souvient de ce qui a déjà été
  montré, ni d'un écran à l'autre, ni d'une visite à l'autre.
- Ordre de grandeur (base locale, 2026-10-09) : 498 titres dans ta pile, 12 dans « Le meilleur
  pour toi ». Les quelque 480 autres n'arrivent en tête que si tu notes ou ajoutes un titre.

**Résultat visé** (révisé après mesure, cf. § 7) : sans nouvelle note, la tête de liste se
renouvelle peu à peu (au moins 1,5 fois plus de titres différents en tête dès la première
semaine), sans jamais changer plus de la moitié de la rangée en un jour une fois la rotation
établie, pour un coût d'au plus 0,1 étoile de note réelle moyenne sur les titres montrés. Mesuré
sur le banc (FR-10), avec le même plafond de coût que la calibration (recommendations-v1 FR-33).

**Correction du plan de la fiche** : le critère « `npm run eval:recos` ≥ 0,38 » ne peut rien
révéler. La lassitude ne touche pas au modèle, donc la corrélation du banc ne bouge pas, quelle
que soit la qualité du réglage. Le banc gagne donc une simulation d'exposition (FR-10), qui
mesure ce que la brique change vraiment. Pour mémoire, cette corrélation vaut 0,371 le
2026-10-09, déjà sous 0,38 avant ce chantier : les données ont changé depuis le dernier relevé.

## 2. Exigences fonctionnelles

### Ce qui est montré

- **FR-1** (impression) — Une carte de proposition compte comme montrée quand au moins la moitié
  de sa surface reste visible à l'écran pendant 1 seconde. Surfaces : Ma pile (Pour toi,
  Classement), À découvrir, Ce soir, l'accueil (carrousel, fenêtre sur la pile, carte de devant
  de la pioche À découvrir) et le tri rapide (la découverte au premier plan). La bibliothèque,
  la recherche, les playlists, Sorties et la fiche ne comptent pas : on y cherche un titre, on
  ne s'en voit pas proposer un. Une carte porte sa clé (`data-impression`), l'écran se déclare
  par son archétype (`surface`).
- **FR-2** (enregistrement) — Le navigateur envoie les impressions par lots, par une requête
  `POST /api/impressions`, au plus toutes les 5 secondes et quand on quitte la page. Le serveur
  garde au plus une impression par titre et par jour, avec la surface où il a été vu en premier.
  **Aucune écriture pendant une lecture** : une page rendue côté serveur n'enregistre rien. Un
  navigateur piloté (tests, captures) n'envoie rien non plus, sauf demande explicite sur une
  copie isolée, et le filet des tests (`tests/securite.ts`, désormais aussi dans les captures)
  bloquerait ces requêtes de toute façon.
- **FR-3** (journée) — Le jour d'une impression est la date locale du serveur, décalée de 4 h :
  une soirée qui déborde minuit reste la même journée.
- **FR-4** (geste) — Un geste sur un titre efface sa lassitude : tout événement du journal qui le
  concerne (ajout, note, tri, ajout à une playlist, vu depuis une playlist…), ainsi que
  l'ouverture de sa fiche, journalisée par un nouvel événement `opened` (`POST /api/opened`).

### Ce que ça change au classement

- **FR-5** (lassitude) — Chaque jour où un titre a été montré sans geste depuis le dernier compte
  1 le lendemain, puis s'efface de moitié chaque semaine. Le titre recule de 3 places par unité
  de cette mémoire, **au plus de 12 places** (une rangée). Le pourcentage de compatibilité
  affiché ne change pas : seule la place bouge.
- **FR-6** (rien n'est retiré) — Un titre lassé reste dans la liste, au plus une rangée plus bas,
  et retrouve sa place à mesure que sa mémoire s'efface. *Remplace le « repos » de la
  proposition initiale (renvoi en fin de liste après 5 jours), écarté sur mesure (§ 7).*
- **FR-7** (stabilité) — Les impressions du jour ne comptent pas encore. Le classement ne bouge
  donc pas dans la journée, quels que soient l'écran et le nombre de visites, et il se renouvelle
  d'un jour à l'autre.
- **FR-8** (une seule règle) — Une fonction pure, `applyFatigue` (`listShaping.ts`), appliquée à
  la liste déjà façonnée (après diversité, calibration et exploration). Elle reçoit la lassitude
  en paramètre : le banc l'exécute sans base. *La proposition initiale l'appliquait au score,
  avant la calibration ; écarté sur mesure (§ 7).*
- **FR-9** (branchements) :
  1. Ma pile (`rankPile`), et donc l'accueil ;
  2. Ce soir (`fromPile`, `fromCatalog`) ; un titre de ta pile y est vu sous sa clé de
     bibliothèque, les autres sous leur clé TMDB ;
  3. À découvrir (`getDiscoveries`), et donc le tri rapide : sur les seuls titres reclassés,
     pour qu'un recul ne fasse pas remonter dans la liste visible un titre de la traîne, sans
     disponibilité ni compatibilité.

### Mesure

- **FR-10** (banc) — `npm run eval:recos` comprend une simulation d'exposition. Chaque titre
  noté reçoit le score d'un modèle qui ne l'a jamais vu (scores hors pli, regroupés). On simule
  ensuite 6 semaines sans geste, avec 12 titres montrés en tête chaque jour, et on compare
  plusieurs réglages : titres différents la première semaine et sur les semaines 3 à 6, titres
  entrés en tête par jour, pire jour une fois la rotation établie, note réelle moyenne des titres
  montrés. Six semaines, parce que les défauts d'une rotation n'apparaissent qu'une fois les
  premiers jours montrés effacés. La simulation est pessimiste : elle traite un titre ignoré
  plusieurs jours comme neutre, alors qu'en vrai il te tentait sans doute moins.
- **FR-11** (en service) — La table des impressions permet de suivre, en local, les titres
  différents montrés par semaine, à rapprocher du taux d'acceptation existant
  (`acceptanceStats`), qui ne doit pas baisser. Pas d'écran : une requête suffit.

  ```sql
  SELECT strftime('%Y-%W', day) semaine, surface, COUNT(DISTINCT subject_type || subject_id) titres
  FROM impressions GROUP BY semaine, surface ORDER BY semaine;
  ```

## 3. Exigences non fonctionnelles

- **NFR-1** (local) — Les impressions restent dans SQLite, hors synchronisation Notion.
- **NFR-2** (coût) — Une requête d'exposition par classement, sur une table indexée par jour,
  limitée aux 6 dernières semaines. Les impressions de plus de 90 jours sont purgées à
  l'écriture.
- **NFR-3** (réversible) — Un pas de 0 rend exactement l'ordre actuel (test).
- **NFR-4** (navigateur) — Un seul `IntersectionObserver` pour toute l'application, monté dans la
  mise en page. Aucun rendu React supplémentaire, et rien de visible sur les cartes.

## 4. Critères d'acceptation

- **AC-1** — Une carte de Ma pile visible 1 seconde part dans le lot suivant ; une carte hors
  surface (bibliothèque) ne part jamais.
- **AC-2** — Un même titre vu le même jour sur plusieurs surfaces donne une seule ligne.
- **AC-3** — Deux appels le même jour rendent le même ordre, même après des impressions du jour.
- **AC-4** (tests unitaires de la fonction pure) — Chaque jour montré fait reculer le titre de
  3 places ; un jour vieux d'une semaine, de moitié ; le recul est plafonné à 12 places ; à
  place égale, le moins montré passe devant ; un titre ne disparaît jamais ; un pas de 0 rend
  l'ordre d'entrée.
- **AC-5** — Le pourcentage de compatibilité d'un titre est le même avant et après.
- **AC-6** — Ouvrir une fiche journalise `opened`, une seule fois, et efface la lassitude du
  titre.
- **AC-7** — Le banc affiche la simulation, et le réglage en service tient le résultat visé
  (§ 1). La corrélation de référence est inchangée.
- **AC-8** — Un navigateur piloté sans demande explicite n'envoie aucune impression, et les
  captures bloquent toute écriture : rien n'atteint la base pendant un test.
- **AC-9** — `npm run check` passe.

## 5. Cas limites

- **EC-1** (petite liste) — Si tout le lot a été autant montré, l'ordre ne bouge pas, et la liste
  n'est jamais vide à cause de la lassitude.
- **EC-2** (Ce soir, contexte étroit) — Avec 3 titres qui correspondent, les 3 restent proposés ;
  seul leur ordre peut changer.
- **EC-3** (ajout depuis À découvrir) — Les impressions d'un titre hors bibliothèque ne suivent
  pas l'item créé. Sans conséquence : l'ajout est un geste, qui efface la lassitude.
- **EC-4** (plusieurs onglets, requêtes en double) — L'insertion ignore les doublons : le
  résultat est le même.
- **EC-5** (pas assez de notes) — Sous le seuil du modèle, l'accueil trie la pile par note TMDB
  sans lassitude. Hors périmètre : ce cas est transitoire.
- **EC-6** (exploration) — Les titres d'exploration subissent la même lassitude que les autres,
  après avoir été intercalés.
- **EC-7** (onglet caché) — Un onglet en arrière-plan ne montre rien : le relevé se suspend et
  envoie ce qu'il a.

## 6. Ordre de réalisation

1. Table `impressions`, service, routes `POST /api/impressions` et `POST /api/opened`, tests.
2. Fonction pure, simulation du banc, choix du réglage.
3. Branchements : Ma pile (et l'accueil), Ce soir, À découvrir (et le tri rapide).
4. Côté navigateur : relevé des cartes vues, événement `opened`.
5. Vérifications : `npm run check`, tests de navigateur, parcours réel sur une copie isolée de la
   base (port 3002, sans Notion).

## 7. Livraison (2026-10-09)

**Ce que le banc a changé à la proposition.** Trois formes de lassitude ont été simulées
(42 jours sans geste, 12 titres en tête par jour, 5 plis × 3 répétitions) :

| Forme | Défaut mesuré |
|---|---|
| Score abaissé de β écarts types par jour, repos à 5 jours (proposition initiale) | La rotation s'accélère d'une semaine à l'autre : les scores sont épars en tête et serrés plus bas, la même pénalité déplace un titre de plus en plus loin (à 0,05 : 4 titres nouveaux par jour la première semaine, 7 la suivante). À faible β, les titres entrés ensemble partent au repos ensemble : presque toute la rangée change d'un coup, tous les 5 jours. |
| Recul en places, repos à 5 ou 7 jours, fenêtre de 14 jours | Les premiers titres montrés, les mieux classés, voient leurs vues sortir de la fenêtre le même jour et reviennent ensemble : toute la rangée change d'un coup, tous les 14 jours. Avec le repos à 5 jours, il faut aussi descendre jusqu'au 40e rang : 0,19 étoile de coût. |
| Recul en places, mémoire qui s'efface de moitié chaque semaine, **plafonné à une rangée** (retenu) | Rotation régulière et stable sur 6 semaines, sans perte de note. |

Réglage retenu, comparé (pas de recul par jour, recul maximal) :

| Lassitude | Titres différents 1re semaine / semaines 3 à 6 | Entrés par jour 1re semaine / établie | Pire jour établi | Note montrée |
|---|---|---|---|---|
| aucune | 12 / 12 | 0 / 0 | 0 | 4,14 |
| 2 places, 12 au plus | 17 / 21 | 2,7 / 3,8 | 5 | 4,18 |
| **3 places, 12 au plus** | **19 / 22** | **3,8 / 2,7** | **3** | **4,17** |
| 3 places, 18 au plus | 19 / 25 | 3,8 / 5,7 | 7 | 4,19 |
| 4 places, 12 au plus | 21 / 23 | 4,7 / 2,1 | 3 | 4,16 |

**Critère révisé, à confirmer par Louis.** La proposition visait deux fois plus de titres
différents dès la première semaine. Aucune forme régulière n'y parvient : celles qui doublent
remplacent régulièrement toute la rangée d'un coup. Le réglage retenu fait 1,6 fois plus la
première semaine et 1,8 fois plus en régime établi. Pour aller plus loin, le levier est le recul
maximal (18 places : 25 titres, mais jusqu'à 7 nouveaux en un jour).

**Vérifié sur une copie isolée de la base** (port 3002, sans Notion, supprimée ensuite) :
impressions relevées sur Ma pile, À découvrir, l'accueil, Ce soir et le tri rapide ; rien depuis
la bibliothèque ; un titre vu sur deux écrans le même jour ne compte qu'une fois ; rien depuis un
navigateur piloté sans demande explicite. Après une journée où « Le meilleur pour toi » a été vu
sans geste, 2 titres nouveaux y entrent et les 2 derniers en sortent, compatibilité inchangée ;
ouvrir la fiche d'un titre sorti le ramène à la 9e place.

## 8. Hors périmètre (v1)

- **Varier d'un écran à l'autre dans la même journée.** L'accueil et Ma pile montrent la même
  tête un jour donné. La stabilité dans la journée prime, et les écrans diffèrent déjà par leurs
  filtres.
- **Apprendre des impressions.** Traiter « montré sans geste » comme un léger signal négatif
  dans le modèle demandera des mois de données, puis le banc.
- **Un écran pour voir ou effacer la mémoire d'exposition.**
- **Exploration aléatoire, bandits.**
- **À découvrir reste variable d'une visite à l'autre** : ses 6 semences sont tirées au hasard à
  chaque calcul (FR-16 de recommendations-v1). FR-7 n'y vaut donc qu'à semences égales.
