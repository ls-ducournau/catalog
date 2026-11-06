# Audit : la page d'arrivée vue par un visiteur

**Date** : 2026-11-06 · **Site** : https://catalog-serveur.vercel.app (version du 2026-11-06)
**Méthode** : visite sans compte (ordinateur 1440 px et téléphone 390 px), en lecture seule : aucune
écriture, aucun compte créé. Liens, boutons et appels réseau relevés.

Question posée : qu'est-ce qui n'a pas de sens pour quelqu'un qui arrive sans compte ni bibliothèque ?

## À retirer ou à remplacer (par ordre d'importance)

| # | Où | Problème | Proposition |
|---|---|---|---|
| 1 | Réglages (roue), bloc « Ton compte » | Dit « Tu es en invité » à quelqu'un qui n'a pas de session. « Garder mon compte » échoue (« Session absente »). **C'est un défaut.** | Pour un visiteur : un lien « Se connecter » vers /connexion, ou rien (la barre l'a déjà). |
| 2 | « Les titres du moment », onglet « Tendances » | Les mêmes 6 titres que « À la une », dans le même ordre. Le carrousel puise aussi dans ces tendances. Sur téléphone, cela fait six longues cartes de plus. | Retirer l'onglet « Tendances » pour un visiteur : garder « Au cinéma » et « Les mieux notés ». |
| 3 | Carte « Tes goûts » (sous « À la une ») | Redit la Notation, qui est juste au-dessus. Son bouton « Noter mes titres vus » mène à un Tri rapide vide. | La retirer pour un visiteur. |
| 4 | Section Duels | Cul-de-sac : « Note au moins deux titres vus » mène à un Tri rapide vide. | Une paire de démonstration tirée des titres très vus (choisir n'écrit rien), ou retirer la section pour un visiteur. |
| 5 | Section Playlists | « Aucune playlist en cours » et « Nouvelle playlist » n'ont pas de sens sans bibliothèque. | Un exemple de playlist (une saga, depuis TMDB), ou retirer la section pour un visiteur. |
| 6 | Section Sorties | « Pour toi » et « ta compatibilité » ne valent rien sans notes. La carte est presque vide (un texte et un bouton). | Montrer les prochaines sorties au cinéma (déjà dans la vitrine), sans compatibilité, et un texte sans « pour toi ». |

## À ajuster

| # | Où | Problème | Proposition |
|---|---|---|---|
| 7 | « À la une », champ de recherche | « Filtrer ta pile… » alors qu'il n'y a pas de pile. | « Filtrer… » pour un visiteur. |
| 8 | Barre du haut, barre d'onglets du téléphone | « Ajouter », les menus « Ta collection » et « Tes goûts », les onglets Biblio, Tri rapide et Recos mènent à des pages vides. | Masquer « Ajouter » pour un visiteur ; garder la navigation (elle montre ce que fait l'application). |
| 9 | « Que regarder ce soir » (héros, barre) | Mène à Ce soir sans pile : à vérifier qu'il propose bien tout le catalogue plutôt qu'une page vide. | Vérifier, sinon ouvrir Ce soir sur « tout le catalogue » quand la pile est vide. |
| 10 | Réseau | À chaque visite, `/api/providers` et `/api/settings/subscriptions` répondent 401 (erreurs dans la console). Rien de visible. | Ne pas les demander pour un visiteur, ou rendre `/api/providers` publique (c'est la liste des services en France). |

## À garder

- **Le héros**, avec « Se connecter » à la place de « Ma pile à voir », et sans compteurs.
- **Le carrousel d'envies** : grandes affiches, la marque « Suggestion », l'ajout d'un clic.
- **« Tu l'as vu ? »** : la meilleure porte d'entrée. Dix notes, et les recommandations démarrent.
- **« À la une »** : les tendances de la semaine, avec leur fiche.

Les affiches vides des captures pleine page venaient du chargement différé des images. Une fois la page
défilée, elles s'affichent toutes (vérifié).

## Ticket à côté : le favicon (fait le 2026-11-06, à déployer)

- **Cause** : `src/app/icon.svg` contenait un commentaire avec deux tirets (`--logo-mark-from`), ce qui est
  interdit en XML ; un navigateur qui lit le SVG strictement n'affiche rien. Il n'y avait pas non plus de
  `favicon.ico` (404 sur `/favicon.ico`) ni d'icône Apple.
- **Correctif** : commentaire réécrit ; `src/app/favicon.ico` (16, 32 et 48 px) et `src/app/apple-icon.png`
  (180 px), produits par `scripts/build-favicons.mjs` à partir du symbole.
- Restent dans `public/` les SVG de démarrage de Next (`file.svg`, `globe.svg`, `next.svg`, `vercel.svg`,
  `window.svg`) : aucun n'est utilisé, à supprimer.
