# Puce, menu de filtre

Raycast n'a pas de puce à bascule sur son site ; la famille reprend donc les règles de la
recherche ([champ-recherche.md](champ-recherche.md)) et des onglets ([onglets.md](onglets.md)),
adoucies à la demande de l'utilisateur (2026-09-28 : « j'aime moins les bordures des
contrôles »).

## Recette Catalog

| Contrôle | Repos | Survol | Choisi ou actif |
|---|---|---|---|
| `Chip` (`.chip` : envies, humeurs) | arête `--field-edge` (blanc 8 %), texte Ash | arête `--field-edge-hover` (14 %), texte blanc | voile `--pill-fill`, arête `--pill-edge` (6 %), texte blanc |
| `Select` (`FilterSelect` : Tout type, Tout genre…) | arête `--field-edge`, texte Ash | arête 14 %, texte blanc | fond `--surface-2`, sans arête, valeur en blanc |
| « Sur mes abonnements » (`ServicesFilter`) | arête `--field-edge` | arête 14 % | fond `--surface-2`, sans arête |
| Choix des services (`ServicesPicker`) | champ : arête `--field-edge` ; tuile : `--card-edge` | arête 14 % | champ : arête 24 % ; tuile : arête 24 %, fond `--selection` |

Forme : pastille, 32 de haut (40 au doigt), 14 px en 500, icône de 14 px. Focus clavier :
l'anneau commun (blanc 40 %, décalé de 2 px).

## Liste de contrôle

- [ ] Jamais d'arête `#363739` (`--border`) ni d'anneau blanc à 25 % (`--line-strong`) sur une
      puce ou un menu de filtre.
- [ ] Au repos, l'arête se devine à peine ; au survol, elle s'éclaircit et le texte passe au
      blanc.
- [ ] Choisi : un voile ou un fond léger, sans anneau ; le texte blanc suffit à le distinguer.
- [ ] Une barre de filtres a un seul aspect : puces, menus et « Sur mes abonnements » se
      ressemblent.
