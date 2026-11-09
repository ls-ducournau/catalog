# Audit UX : le parcours d'un visiteur, plan du site

**Date** : 2026-11-09 · **Site** : https://catalog-serveur.vercel.app
**Demande de Louis** : « Il y a une confusion dans la logique de test et de connexion ? Faut un audit UX, type
logique de site map pour harmoniser tout ça. » Et, sur la page d'arrivée, reprendre en version pour tous les
sections de l'accueil d'un compte, pour voir les fonctions de plus près après avoir balayé.

## 1. Ce qui n'allait pas

| Où | Bouton | Mène à | Enregistre ? |
|---|---|---|---|
| Barre du haut | « Tester » | /bienvenue | Oui, dès le premier geste (compte invité) |
| Barre du haut | « Fais le tour » (principal) | /visite | Non, jusqu'à « Garder » |
| Héros | « Fais le tour » (principal), « Tester », « J'ai déjà un compte » | /visite, /bienvenue, /connexion | |
| Paquet de la page d'arrivée | « Garder mes N titres et continuer » | crée le compte, puis /bienvenue | Dans le navigateur jusqu'au clic |
| Visite | « Garder ce que j'ai fait » | crée le compte, puis /bienvenue | Dans le navigateur jusqu'au clic |
| Bienvenue | « Se connecter » | /connexion | |

1. **Deux boutons principaux qui disent la même chose** : « Tester » et « Fais le tour » veulent tous deux dire
   « essayer », dans un ordre inversé entre la barre et le héros.
2. **Trois façons d'essayer, deux règles** : la visite et le paquet gardaient tout dans le navigateur jusqu'à
   « Garder » ; « Tester » écrivait dès le premier geste. Un visiteur qui balayait le paquet puis cliquait
   « Tester » perdait ses choix et revoyait les mêmes cartes.
3. **Se connecter** n'était plus qu'un petit lien sous le héros ; absent de la barre, sauf sur la bienvenue.
4. **Sept libellés pour quatre intentions** : Tester, Fais le tour, Garder ce que j'ai fait, Garder mes N
   titres et continuer, Garder mon compte, Se connecter, J'ai déjà un compte.
5. **« Tout ce que tu y trouves »** : une grille de liens, moins parlante que les fonctions elles-mêmes.

## 2. Plan du site

```
Visiteur (pas de compte)
  /  Page d'arrivée
  │   héros ─ « Tester » (principal) ─────────────────────────────► /bienvenue
  │         └ « Fais le tour » (second) ─► /visite ─ « Continuer » ─► /bienvenue
  │   paquet à balayer, sections jouables (dans le navigateur)
  │         └ « Continuer avec mes N titres » ─────────────────────► /bienvenue
  └── barre : « Se connecter » (discret) ──────────────────────────► /connexion

  /bienvenue  ce qu'il a fait sans compte entre dans sa bibliothèque ;
              son premier geste ouvre un compte invité (sans e-mail)

Invité qui a des titres          l'application + « Garder mon compte » ─► /connexion
Compte (e-mail, mot de passe)    l'application
```

## 3. Trois règles

1. **Un seul bouton principal pour un visiteur, partout : « Tester ».** « Fais le tour » vient en second, dans
   la page, pas dans la barre. Le logo ramène à l'accueil (plus de « Quitter la visite »).
2. **Sans compte, rien ne s'écrit, et tout te suit.** Le paquet, les sections de la page d'arrivée et la visite
   gardent tes choix dans le navigateur (un seul état). La bienvenue les verse dans ta bibliothèque à
   l'arrivée, que tu viennes de « Tester » ou de « Continuer » ; les cartes déjà répondues ne reviennent pas.
3. **Un verbe par intention.**

| Intention | Libellé | Où |
|---|---|---|
| Commencer pour de vrai | **Tester** | barre, héros, dernier appel, fin du paquet vide |
| Découvrir, guidé | **Fais le tour** | héros, dernier appel (en second) |
| Reprendre ce qu'on a fait sans compte | **Continuer** (« avec mes N titres ») | paquet, sections, visite |
| Garder son compte (e-mail, mot de passe) | **Garder mon compte** | barre d'un invité, jauge prête |
| Revenir | **Se connecter** | barre d'un visiteur (discret), bienvenue |

## 4. La barre du haut

| | Visiteur | Invité qui a des titres | Compte |
|---|---|---|---|
| Gauche | Logo | Logo, menus | Logo, menus |
| Droite | Se connecter (discret), **Tester** (absent sur /bienvenue) | Garder mon compte, réglages, Ajouter, Ce soir | Initiale, réglages, Ajouter, Ce soir |

## 5. La page d'arrivée

1. Héros : la promesse, **Tester**, Fais le tour ; l'éventail des titres du moment.
2. « Ça te tente ? » : le paquet à balayer.
3. Comment ça marche, en trois temps.
4. **Les fonctions de l'application, en version pour tous** (à la place de la grille) : Il y a un titre pour
   ça (envies), Note d'une touche, À la une, Deux titres un seul passe devant, Ta bibliothèque, Tes listes
   dans l'ordre, Ce qui sort à ne pas rater. Jouables sans compte (même état que le paquet), chacune avec
   son lien vers l'étape de la visite.
5. Pourquoi Catalog ; dernier appel (**Tester**, Fais le tour) ; pied de page.

## 6. Réalisé le 2026-11-09

Les trois règles, la barre et la page d'arrivée ci-dessus. « Ça me tente » des sections (cartes, mur, liste)
reste dans le navigateur sur la page d'arrivée ; les touches d'un bloc n'agissent que s'il a le focus. Voir
`specs/bienvenue-v1.md` (FR-9, FR-13) et `specs/visite-interactive-v1.md` (§ 10).

## 7. À trancher

1. **La visite fait-elle double emploi** avec les sections jouables de la page d'arrivée ? Elle reste le
   parcours guidé, en second ; on peut la retirer si la page d'arrivée suffit.
2. **La longueur de la page d'arrivée** : sept sections de plus. À regarder sur les premiers visiteurs.
3. **L'accueil d'un compte** : le prochain chantier.
