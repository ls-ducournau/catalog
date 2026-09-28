# Audit UX — Recherche par personne (écran d'ajout)

**Auteur** : Claude (assisté, méthodologie `product-team/skills/ux-researcher-designer` — évaluation heuristique, N=1 utilisateur réel ayant rapporté le problème en conditions d'usage) · **Date** : 2026-09-24

## Contexte

Rapporté par l'utilisateur : *"si je tape brad pitt le système peut croire que c'est en tant qu'Acteur, Producteur, et les documentaires qui portent son nom"*. Vérifié en conditions réelles contre l'API TMDB (requête `Brad Pitt`, résultat brut mesuré) :

| Mesure | Valeur |
|---|---|
| Résultats totaux | 231 |
| Dont crédits réels (filmographie) | 227 (94 producteur, 133 acteur, 0 réalisateur) |
| Dont correspondances de titre pur (aucun crédit connu) | 4 |
| Entrées de faible qualité (ni année, ni genre) | 1 |

Les 4 correspondances de titre pur sont des documentaires biographiques *sur* Brad Pitt ("Die Brad Pitt Story", "Brad Pitt: More Than a Pretty Face", "Brad Pitt: Breaking Hollywood", "Brad Pitt & Jennifer Aniston: Hollywood's Couple of the Year") — il n'a ni joué, ni produit, ni réalisé aucun d'entre eux.

## Constats (sévérité : 4 Critique · 3 Majeur · 2 Mineur · 1 Cosmétique)

### C1 — [Sévérité 3, Majeur] Le bruit de titre passe devant la vraie filmographie
**Preuve** : les 4 documentaires "à propos de" sortent en tête de liste, avant les 227 vrais crédits (Ocean's Eleven, Fight Club, 12 Years a Slave, etc.).
**Cause** : `sortSearchResults` place tous les `titleMatches` (correspondance de texte brute, `personCredit: null`) avant tous les résultats `personCredit` (filmographie réelle), quel que soit leur pertinence.
**Impact** : l'utilisateur qui tape un nom pour retrouver "tous ses films" voit d'abord des résultats hors-sujet — le cas d'usage principal de la fonctionnalité est desservi par son propre tri.

### C2 — [Sévérité 3, Majeur] Aucune distinction visuelle par rôle
**Preuve** : réalisateur/producteur/acteur sont mélangés dans une liste plate, seule une ligne de 11px sous chaque résultat ("Avec X" / "Produit par X") indique le rôle — sur 227 résultats, ce texte devient illisible à l'usage (aucun regroupement, aucun repère visuel).
**Impact** : correspond exactement au symptôme rapporté ("le système peut croire que...") — l'ambiguïté vient de l'absence de structure, pas d'une erreur de détection (les rôles sont en fait correctement détectés et distincts en données, cf. tableau ci-dessus).

### C3 — [Sévérité 2, Mineur] Le tri par année mélange les rôles et enterre les œuvres majeures
**Preuve** : dans les 15 premiers résultats à crédit réel, uniquement des rôles "producteur" 2006-2013 (The Departed, Kick-Ass, World War Z...) ; ses rôles d'acteur les plus connus (Fight Club 1999, Se7en 1995, Ocean's Eleven 2001) sont plus anciens donc repoussés plus bas par le tri "année décroissante" uniforme.
**Impact** : le tri actuel n'a aucun signal de notoriété/pertinence, seulement la date — un nom avec une longue carrière noie ses œuvres les plus connues sous ses crédits les plus récents (souvent mineurs, ex. producteur exécutif).

### C4 — [Sévérité 2, Mineur] Un double rôle sur un même titre est silencieusement réduit à un seul
**Preuve** : la déduplication (`seen` par `type-tmdbId`) garde le premier rôle poussé (réalisateur > producteur > acteur) et supprime les autres sans indication.
**Impact** : perte d'information silencieuse — un acteur-réalisateur-producteur sur son propre film n'apparaît que sous une seule étiquette, potentiellement la moins pertinente pour l'utilisateur.

### C5 — [Sévérité 1, Cosmétique] Aucun signal de volume ni de filtrage par rôle
**Preuve** : 231 résultats bruts dans une liste `max-h-96` avec seulement des filtres Type/Genre/Année — aucun moyen de dire "seulement ce qu'il a réalisé" ou "seulement ce qu'il a produit".
**Impact** : les filtres existants (Type/Genre/Année) n'aident pas à trancher le cas rapporté ; il manque un filtre par rôle, orthogonal aux trois déjà en place.

### C6 — [Sévérité 1, Cosmétique] Entrées de qualité douteuse non filtrées
**Preuve** : "Brad Pitt: Breaking Hollywood" — ni année, ni genre, probablement un contenu fantôme/mal renseigné dans le catalogue TMDB — traité à égalité avec le reste.
**Impact** : bruit mineur, cumulatif avec C1.

## Priorisation (Fréquence × Sévérité × Facilité de résolution)

| Constat | Fréquence | Sévérité | Facilité | Priorité |
|---|---|---|---|---|
| C1 | Systématique dès qu'un nom a un contenu "à propos de" | 3 | Haute (tri, pas d'API) | **P0** |
| C2 | Systématique dès qu'une personne a >10 crédits | 3 | Moyenne (UI de regroupement) | **P0** |
| C3 | Fréquent pour les longues carrières | 2 | Haute (changer la clé de tri) | **P1** |
| C4 | Rare (doubles rôles sur un même titre) | 2 | Moyenne | **P2** |
| C5 | Systématique pour les filmographies larges | 1 | Moyenne (UI filtre supplémentaire) | **P1** |
| C6 | Rare | 1 | Haute | **P2** |

Le détail des recommandations (comment corriger chaque constat) est formalisé dans `specs/recherche-personne-v1.md`.
