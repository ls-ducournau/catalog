# Catalog

Tes films, séries et documentaires, à ton goût. Application web locale et personnelle (Next.js,
SQLite), en français : on note, on classe, et elle trouve quoi regarder ce soir.

- **Bibliothèque** : tout ce que tu as vu et veux voir ; note d'un clic, statut depuis l'affiche,
  fiche détaillée (synopsis, où regarder, bande-annonce).
- **Recommandations** : ta pile « à voir » classée d'après tes notes, des titres à découvrir, et
  ton profil de goûts.
- **Ce soir** : une envie, une durée, avec qui ; une proposition, et d'autres idées.
- **Tri rapide**, **Duels**, **Classement** : affiner tes goûts, carte par carte ou deux par deux.
- **Sorties** : ce qui arrive au cinéma et en séries, semaine par semaine.

Les données vivent dans une base SQLite locale (`data/`), enrichie par TMDB. La synchronisation
avec Notion ne se fait **que sur demande**.

## Démarrer

```bash
npm install
npm run dev
```

Puis ouvrir http://localhost:3000.

Variables d'environnement, dans `.env` (jamais versionné) :

| Variable | Rôle |
|---|---|
| `TMDB_ACCESS_TOKEN` | Jeton de lecture de l'API TMDB (fiches, affiches, disponibilités, sorties) |
| `NOTION_TOKEN` | Intégration Notion, pour la synchronisation à la demande |
| `NOTION_DATA_SOURCE_ID` | Base Notion synchronisée |

La base `data/watchlist.db` est créée au premier lancement ; `data/` n'est jamais versionné.

## Vérifier

```bash
npm run check        # jetons à jour, TypeScript, ESLint, Vitest, audit du système de design
npm run test:motion  # règles de mouvement (Playwright, Chrome installé)
npm run test:visual  # captures des 10 écrans et référence au pixel de /design
npm run build
```

Les tests Playwright tournent sur le serveur de développement et n'écrivent jamais dans la base :
toute requête `/api` autre qu'une lecture est interceptée (`tests/securite.ts`).

## Système de design

Catalog suit le langage visuel de Raycast, d'après `docs/design-reference/raycast/DESIGN.md`
(référence normative des principes) et les fiches de QA par composant de
`docs/design-reference/raycast/composants/` (relevés de raycast.com, qui priment pour les
recettes). Le plan et les critères d'acceptation sont dans `specs/design-system-v2-raycast.md`.

- **Jetons** : `design/tokens.json` est la seule source. `npm run tokens` génère
  `src/styles/tokens.css` et `src/lib/tokens.ts`.
- **Primitives** : `src/components/ui`.
- **Sections** : `src/components/sections`.
- **Archétypes de pages** : `src/components/layouts`.
- **Mouvement** : `src/lib/motion.ts`, avec des préréglages GSAP, sans rebond.
- **Guide vivant** : la page http://localhost:3000/design.
- **Garde-fous** : `npm run ds:audit` compte les écarts au système, et la ligne de base
  (`design/audit-baseline.json`) ne peut que baisser.
- **Skill projet** : `.claude/skills/catalog-design-system` donne les règles à suivre pour produire
  une vue.

## Structure

```
src/app/            pages (une par vue) et routes d'API
src/components/     composants de l'app ; ui/, sections/, layouts/, motion/, charts/ (Bklit)
src/lib/            logique métier (recommandations, duels, TMDB, Notion, SQLite)
scripts/            rattrapages de données, jetons, audit
specs/              spécifications fonctionnelles, avec critères d'acceptation
docs/               références de design et listes culturelles
tests/              Playwright (captures, mouvement, /design)
```
