# Audit product et UX des playlists

**Date** : 2026-10-25 · **Périmètre** : `/playlists`, page d'une playlist, sélecteur « Ajouter à une
playlist », section de l'accueil, source « Une playlist » de Ce soir · **Suite de** :
`specs/playlists-v2.md`, `docs/recherche/playlists-parcours.md`

## 1. Méthode et niveau de preuve

- **Usage réel** : lecture seule du journal et de la base de Louis (`events`, `playlists`,
  `playlist_items`).
- **Écrans** : captures ordinateur (1440 px) et téléphone (390 px) sur une **copie isolée** de la
  base, sans Notion, remplie de 4 playlists réalistes (Saga Alien, Films de Noël, Retour vers le
  futur, « Only the best »). Écritures bloquées pendant les captures. La copie est supprimée.
- **Limite** : un seul utilisateur, aucune mesure d'usage avant le 2026-10-06. Les constats sur le
  comportement sont des hypothèses sauf mention. Les constats sur les écrans sont observés.

## 2. Le constat qui change la lecture : personne n'a rempli une playlist

| Mesure (base réelle, 2026-10-25) | Valeur |
|---|---|
| Playlists créées depuis le 2026-10-06 | 2 |
| Titres jamais ajoutés à une playlist (`playlist_item_added`) | **0** |
| Playlists supprimées | 1 (vide, le 2026-10-10) |
| Playlist restante | « Only the best », vide |
| Gestes de la v2 utilisés (carte, sélection, suggestion, Ce soir) | 0 |

Le résultat visé par la v2 (« remplie à 5 titres ou plus, puis regardée, en deux semaines ») est
à 0 sur 2. Les gestes livrés et testés n'ont servi à rien dans la vraie vie. Le problème n'est donc
pas, d'abord, un manque de fonctions : c'est que **rien ne donne envie ni ne facilite la première
playlist**. Aujourd'hui, créer, c'est taper un nom devant une page blanche.

Biais à garder en tête : les deux créations ont eu lieu le jour des tests, avec un seul
utilisateur. C'est une alerte, pas une preuve.

## 3. Constats

Gravité : **P0** bloque l'usage, **P1** freine nettement, **P2** gêne, **P3** détail.

### Product

**PR-1 · P0 · Amorçage : une page blanche à la création.**
Observé : « Nouvelle playlist » ouvre un champ de nom, puis une playlist vide. La bibliothèque
contient pourtant des sagas entières (Alien 5 titres, Harry Potter 8, Seigneur des anneaux,
Retour vers le futur, Dune, Batman…) et des thèmes (10 titres de Noël par mots-clés TMDB).
*Piste* : proposer des playlists **toutes faites à valider** : « Saga Alien, 5 titres, dans l'ordre
de sortie » en un clic, sur la liste vide, dans « Pour compléter » et sur la fiche d'un titre de
saga. Rien n'entre sans ton clic (règle v2 conservée).

**PR-2 · P1 · Les sagas sont incomplètes sans le dire.**
Observé : « Saga Alien » ne contient que ce que la bibliothèque a. Rien n'indique qu'il manque des
titres, et « Pour compléter » ne regarde que la bibliothèque (Avatar, Starship Troopers, Rogue One
pour une saga Alien).
*Piste* : détecter la collection TMDB (`belongs_to_collection`, aujourd'hui non stockée) et
proposer « 2 films de la saga ne sont pas dans ta bibliothèque » avec ajout en un geste (v2 FR-3
gère déjà l'ajout hors bibliothèque).

**PR-3 · P1 · « Entièrement vues » mélange deux usages.**
Observé : « Only the best » (12 titres notés 5 étoiles) est classée « Entièrement vues » avec
« Tu as tout vu. Ajoute d'autres titres… », comme une saga terminée. Or c'est une **collection**
(favoris, souvenir), pas une liste à parcourir.
*Piste* : deux natures de playlist, « à regarder » (suit une progression, alimente Ce soir et
l'accueil) et « collection » (pas de « À suivre », pas de progression). Choix à la création, modifiable.

**PR-4 · P1 · « Je regarde ça » marque vu tout de suite.**
Observé : le bouton passe le titre à « Vu » avant la séance, puis le bandeau « À noter » demande la
note au retour suivant. Pour une série (161 titres dans la bibliothèque), « Vu » dès le clic dit
faux : aucune progression par saison ni par épisode.
*Piste* : un état « En cours » (ou, au minimum, un libellé honnête : « Marquer comme vu »), et pour
les séries, la saison en cours. À arbitrer avec Ce soir, qui utilise le même geste.

**PR-5 · P2 · Les playlists ne nourrissent pas Ce soir.**
Observé : « Une playlist » est la dernière source du filtre « Parmi », en bas de la colonne de gauche.
La playlist en cours (prochain titre : « Aliens, le retour », 2 h 17, fin vers 20 h 23) n'est jamais
proposée d'elle-même.
*Piste* : « Dans ta playlist Saga Alien » comme première idée de Ce soir quand une playlist a un
prochain titre qui colle aux réglages.

**PR-6 · P2 · Pas d'aide pour ordonner.**
Observé : la description de « Saga Alien » dit « Dans l'ordre de sortie » et l'ordre est à faire à la
main. Seul le glisser-déposer existe (v2 : tri en un geste écarté).
*Piste* : une saga arrive **déjà triée par date de sortie** ; un menu « Trier par » (sortie, durée,
ta note) sur la page. À rouvrir : c'est le geste évident d'une saga.

**PR-7 · P2 · Découvrabilité.**
Observé : Playlists est dans le menu « Ta collection » (ordinateur) et dans « Plus » (téléphone) ;
sur l'accueil, la section est loin sous le héros.
*Piste* : une fois PR-1 en place, mettre les propositions de playlists sur l'accueil et dans
Recommandations plutôt que déplacer l'entrée de menu.

**PR-8 · P3 · Mesure.**
Le journal ne sait pas si la page Playlists a été ouverte, ni si une proposition a été vue. Pour
juger PR-1 il faudra journaliser l'affichage et l'acceptation des propositions de playlists
(même mécanisme que `impressions`).

### Écrans : liste

**UX-1 · P2 · Une carte de playlist ne montre pas la suite.** « À suivre : Aliens, le retour » est
un texte de 13 px sous la couverture ; l'affiche du prochain titre, l'info la plus utile, n'y est
pas. *Piste* : l'afficher en petit sur la couverture ou en vignette.

**UX-2 · P3 · Page creuse avec peu de playlists.** Avec 4 playlists, deux cartes de 224 px occupent
le tiers gauche de 1216 px. Rien de cassé ; la mise en page prévoit mal le cas « peu de listes ».

### Écrans : page d'une playlist

**UX-3 · P1 · Le bandeau « À noter » passe avant la liste.** Il pèse environ 270 px, revient à chaque
visite tant qu'un titre vu n'est pas noté, et « Plus tard » n'est pas mémorisé (état local, perdu au
rechargement). La liste, objet de la page, commence sous le pli en téléphone.
*Piste* : le replier en une ligne, placer sous la liste, ou mémoriser « Plus tard » pour la journée.

**UX-4 · P1 · Deux boutons de lecture qui ne font pas la même chose.** Sur chaque ligne, ▷ ouvre la
bande-annonce (étiquette « Bande-annonce de … » au lecteur d'écran) alors que « Je regarde ça » du
bloc À suivre marque le titre vu. Une icône ▷ nue se lit « regarder ». *Piste* : icône de film ou de
clap, ou libellé « Bande-annonce » au survol visible, et différencier du bouton principal.

**UX-5 · P2 · « Pour compléter » : raison pauvre.** Sur « Saga Alien », six suggestions sur huit
affichent « Même univers » (mot-clé partagé, jamais nommé). La raison ne rassure pas, et un titre
éloigné (Avatar) paraît arbitraire. *Piste* : nommer le trait (« Mot-clé : espace »), ou ne
proposer que ce qui a une raison forte (réalisation, saga).

**UX-6 · P2 · Téléphone : titres coupés dans la liste.** À 390 px, « Alien, le huitième passager »
devient « Alien, le huitiè… », la durée est tronquée (« 1 h ! »), le genre disparaît. Les badges
« Vu » ou « À voir » et la croix prennent la place du titre. *Piste* : titre sur deux lignes
(comme dans les cartes, audit 2026-10-09), badge en pastille, croix dans un menu.

**UX-7 · P2 · Indices clavier sur écran tactile.** « Glisse la poignée … ou Alt+↑ et Alt+↓ » s'affiche
au doigt, où Alt n'existe pas. *Piste* : masquer la mention clavier en pointeur grossier.

**UX-8 · P3 · Poignée de 28 × 44 px** : la hauteur suffit, la largeur est juste. Acceptable, à
mesurer au doigt avec le glisser réel avant de toucher.

**UX-9 · P3 · « Supprimer la playlist » en bouton discret à côté de la durée.** L'annulation existe
(8 s, Ctrl+Z) : acceptable. À surveiller si la liste en cours devient précieuse.

### Écrans : ajout depuis une carte

**UX-10 · P3 · La fenêtre « Ajouter à une playlist » fonctionne** (ouverture vérifiée sur la
bibliothèque, ordinateur et téléphone) mais ne donne aucun contexte : ni affiche du titre, ni
aperçu de ce que contient la playlist. Pas un frein tant que PR-1 n'est pas traité.

## 4. Plan par vagues (proposition)

**Vague 1, amorcer (PR-1, PR-8, UX-1)**
- Propositions de playlists depuis la bibliothèque : sagas complètes d'abord (nom commun + années),
  puis thèmes par mots-clés. « Créer, 5 titres, dans l'ordre de sortie » en un clic.
- Affichage sur la liste vide, l'accueil et la fiche d'un titre de saga.
- Journalisation de l'affichage et de l'acceptation.
- Prérequis à spécifier : règles de détection et seuils (au moins 3 titres, pas de doublons avec une
  playlist existante).

**Vague 2, compléter (PR-2, PR-6, UX-5)**
- Collection TMDB stockée à l'enrichissement (une colonne, rattrapage progressif en arrière-plan).
- « Il manque 2 titres » avec ajout en un geste, hors bibliothèque compris.
- Tri en un geste, saga triée par date de sortie à la création.
- Raisons de suggestion nommées.

**Vague 3, regarder (PR-3, PR-4, PR-5, UX-3, UX-4)**
- Playlist « à regarder » ou « collection ».
- État « En cours », saison de série en cours.
- Prochain titre de la playlist proposé en tête de Ce soir.
- Bandeau « À noter » replié, ▷ clarifié.

**Vague 4, finitions (UX-2, UX-6, UX-7, UX-8, PR-7)**
- Liste sur téléphone, mention clavier masquée, mise en page des petites listes.

## 5. Ce que je ne recommande pas

- **Partage et export** (P9 de la recherche) : toujours aucun signal d'utilisation, et rien ne
  se remplit encore.
- **Identité (emoji, couleur)** : les couvertures en mosaïque d'affiches rendent déjà bien (liste,
  accueil). À rouvrir seulement si les playlists se multiplient.
- **Playlists automatiques** : écartées en v1. Les propositions de PR-1 n'en sont pas : elles ne
  créent rien sans clic.

## 6. Question ouverte pour Louis

Les playlists te servent-elles à **organiser ce que tu vas voir** (sagas, soirées) ou à **ranger ce
que tu aimes** (favoris, souvenirs) ? La réponse décide si PR-3 et PR-4 passent avant PR-1 et PR-2.
