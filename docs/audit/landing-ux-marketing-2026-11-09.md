# Audit UX et marketing : la page d'arrivée et le parcours « Tester »

**Date** : 2026-11-09 · **Site** : https://catalog-serveur.vercel.app (public, sans jeton)
**Demande de Louis** : « un audit UX complet de la partie landing page et de sa logique UX flow / stratégie
marketing ; une fois fait, applique les améliorations sans t'arrêter ».
**Méthode** : score de conversion automatique (`page-cro`, `conversion_audit.py`) ; mesures dans Chrome sur
ordinateur (1440 × 900) et téléphone (390 × 844) : ce qu'on voit sans défiler, performance, accessibilité
(axe-core, WCAG 2.1 A et AA) ; balises de partage ; lecture du parcours de bout en bout.

## 1. Le contexte

| | |
|---|---|
| Type de page | Page d'arrivée d'un produit grand public, en bêta, gratuit |
| Conversion visée | Faire balayer, puis « Tester » (le parcours de la bienvenue), puis garder son compte |
| Trafic | Des liens partagés : Reddit (r/CineSeries), Discord (Le 7ème Art), SensCritique, Betaseries, Letterboxd |
| Public | Des gens qui notent déjà leurs films ailleurs, venus d'un lien, sans rien connaître de Catalog |

## 2. Score et mesures (avant)

| Mesure | Ordinateur | Téléphone |
|---|---|---|
| Score de conversion automatique | **53/100 (D)** | |
| Boutons d'action · preuve sociale · confiance · mobile | 100 · **0** · **20** · 100 | |
| Premier affichage utile (LCP) | | 0,6 s |
| Poids de la page · requêtes | 532 Ko · 50 | 536 Ko · 53 |
| Hauteur de la page | 7 900 px | 11 300 px |
| **Le paquet à balayer commence à** | **1 008 px (écran : 900)** | **868 px (écran : 844)** |
| Accessibilité (axe) | 2 défauts sérieux | 2 défauts sérieux |
| Titre de la page · description · aperçu de partage | « Catalog » · dépassée · **aucun** | |

## 3. Constat, par ordre d'impact

### Critique

1. **La fonction d'appel n'est pas visible.** Le paquet à balayer, ce qui distingue Catalog, commence sous la
   ligne de flottaison ; au-dessus, un éventail d'affiches immobile. Le visiteur lit une promesse au lieu de la
   vivre.
2. **Un lien partagé n'a pas d'aperçu.** Titre « Catalog », description d'avant (« duels, classement,
   recommandations… »), ni Open Graph ni carte Twitter. Sur Reddit et Discord, les canaux d'acquisition, le
   lien s'affiche nu : c'est la première impression, et elle est vide.

### Fort

3. **Aucune réponse aux objections** d'un inconnu : c'est gratuit ? il faut un compte ? d'où viennent les
   films ? où vont mes données ? Le score de confiance est à 20/100.
4. **Rien ne rassure près du bouton.** « Tester » ne dit pas que c'est gratuit et sans inscription.
5. **Des titres qui ne donnent pas envie** : le talk-show de Jimmy Fallon en vitrine, à côté de films ; la
   tendance TMDB mêle talk-shows, actualités et téléréalité.
6. **Rétention fragile** : un invité perd sa bibliothèque s'il efface ses cookies ; « Garder mon compte » ne lui
   est proposé qu'à la fin du parcours ou dans la barre (après un rechargement).

### Moyen

7. **Accessibilité** : les liens du pied de page ne se distinguent que par la couleur ; le carrousel des envies
   ne défile pas au clavier ; le titre d'une carte (« Interstellar ») est un titre de section pour les lecteurs
   d'écran.
8. **Le logo répété** au-dessus du titre prend de la hauteur sans rien dire (il est déjà dans la barre).

### Ce qui va bien

- Un seul bouton principal, « Tester » ; aucune friction pour commencer (ni formulaire, ni e-mail).
- Une promesse claire (« Balaie des titres. Catalog te dit quoi regarder. ») qui dit le geste et le bénéfice.
- Une page légère et rapide ; une barre épurée ; des sections qui expliquent ce que les gestes y changent.
- Le parcours ouvre les fonctions dans l'ordre où elles deviennent utiles (balayer, noter, départager, recos).

## 4. La stratégie marketing

**Positionnement.** Catalog n'est pas « un Letterboxd de plus » : c'est **le Tinder des films et des séries**.
On commence sans compte, d'un geste, et ce geste suffit à rendre l'application personnelle. Tout le reste
(recommandations, Ce soir, classement, sorties) est la récompense de ce geste.

**Le tunnel, et ce qu'il faudrait mesurer à chaque marche** :

| Marche | Signal | Indicateur |
|---|---|---|
| Arrivée | Un visiteur ouvre la page | Visites, par canal |
| Premier geste | Une carte balayée sur la page d'arrivée | Part des visiteurs qui balaient |
| Tester | Ouverture de la bienvenue | Part des visiteurs qui cliquent |
| Activation | 10 titres dans la bibliothèque | Part des testeurs qui y arrivent |
| Déclic | Les premières recommandations (10 notes) | Part des testeurs qui y arrivent |
| Rétention | Compte gardé (e-mail) ; retour à 7 jours | Part des invités qui gardent leur compte |

**Les canaux.** Le message doit coller à la communauté : sur SensCritique ou Letterboxd, « tu notes déjà
tes films ; ici, un geste suffit, et Catalog te dit quoi regarder ce soir » ; sur Reddit, le geste lui-même
(une vidéo de 10 secondes du paquet). L'aperçu du lien porte désormais la promesse.

**Les boucles de croissance (à venir).** Partager son classement ou ses recommandations (un aperçu de lien
par profil) ; importer sa bibliothèque Letterboxd ou SensCritique (le coût de changement tombe).

## 5. Appliqué le 2026-11-09

| # | Changement | Répond à |
|---|---|---|
| 1 | **Le paquet monte dans le héros** : texte à gauche, paquet à droite sur ordinateur ; juste sous le bouton au téléphone. L'indice du geste joue dès l'arrivée. L'éventail et le logo répété disparaissent. | 1, 8 |
| 2 | **Aperçu de partage** : titre « Catalog · Balaie des titres, il te dit quoi regarder », description, Open Graph et carte Twitter, image d'aperçu 1200 × 630 (la promesse, le paquet et « Ça me tente »), `robots.txt` et plan du site. | 2 |
| 3 | **Questions fréquentes** (six réponses courtes et vérifiables) : gratuit, compte, goûts, TMDB, appareils, données (en Europe). | 3 |
| 4 | **« Gratuit pendant la bêta \| Sans inscription »** sous le bouton. | 4 |
| 5 | **Des vitrines qui donnent envie** : ni talk-shows, ni actualités, ni téléréalité, ni feuilletons, ni jeunesse, sur la page d'arrivée comme dans la bienvenue. | 5 |
| 6 | **« Garde ta bibliothèque »** proposé à un invité dès 10 titres, dans la ligne des messages du parcours. | 6 |
| 7 | **Accessibilité** : liens soulignés, carrousel défilable au clavier, titres des cartes hors du plan de la page. | 7 |
| 8 | Sous-titre du héros réécrit : le geste, puis le bénéfice (« Catalog te recommande ce qui va te plaire »). | 1 |

## 6. À décider ou à faire par Louis

1. **Un nom de domaine à soi.** `catalog-serveur.vercel.app` inspire peu confiance (« serveur ») et ne se retient
   pas. Le domaine se branche dans Vercel en quelques minutes.
2. **Mesurer le tunnel**, sans cookies (Vercel Web Analytics ou Plausible) : sans chiffres, aucune des pistes du
   § 7 ne peut être tranchée. À activer dans le tableau de bord Vercel.
3. **La preuve sociale.** Le score reste à 0 tant qu'aucun avis ne figure sur la page. Les entretiens avec les
   quatre inconnus peuvent en donner, avec leur accord ; rien ne sera inventé.
4. **Une page « données personnelles » et des mentions légales**, avec Yugen : attendues sur une page qui
   ouvre des comptes.
5. **Importer Letterboxd et SensCritique** (un fichier CSV) : le meilleur argument pour les communautés visées.

## 7. Idées de tests

| Hypothèse | Variante | Mesure | Priorité |
|---|---|---|---|
| Un bouton qui dit le geste convertit mieux | « Tester » contre « Commencer à balayer » | Clic sur le bouton | Haute |
| Le paquet suffit à convaincre | Héros avec paquet contre héros texte seul | Part des visiteurs qui balaient | Haute |
| Une page plus courte garde mieux | Sept sections contre trois (Notation, À la une, Duels) | Clic sur « Tester » | Moyenne |
| Proposer de garder le compte plus tôt | À 10 titres contre à 5 | Comptes gardés | Moyenne |

## 8. Variantes de textes

| Élément | Variante | Pourquoi |
|---|---|---|
| Titre | « Balaie des titres. Catalog te dit quoi regarder. » (en place) | Le geste et le bénéfice, sans jargon |
| Titre | « Le Tinder des films et des séries. » | Une image que tout le monde comprend en une seconde ; à tester (marque tierce) |
| Titre | « Dis ce qui te tente. Catalog trouve ton prochain film. » | Le bénéfice d'abord, le geste ensuite |
| Bouton | « Tester » (en place) | Court, choisi par Louis |
| Bouton | « Commencer à balayer » | Dit ce qui se passe après le clic |
| Bouton | « Remplir ma bibliothèque » | Dit le résultat |
