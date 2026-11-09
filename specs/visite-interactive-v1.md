# Essayer sans compte : la visite interactive — v1

**Auteur** : Claude (assisté) · **Date** : 2026-11-06 · **Statut** : Réalisé le 2026-11-06 (non commité, non déployé) · **Relecteur** : Louis

## 1. La demande (Louis, 2026-11-06)

1. Sur la page d'arrivée, les sections « fonctions » doivent se **jouer** : le visiteur essaie la fonction
   pour avoir un aperçu de l'application.
2. Pour Biblio, Classement, Playlists, Duels, Tri rapide, Recos, Sorties et Ce soir : soit des **pages
   distinctes** qui présentent chaque partie, soit une **page plus créative** qui les présente toutes,
   toujours de manière interactive.
3. Pour un visiteur, ni la roue des réglages ni « Ajouter » dans la barre (fait le 2026-11-06).

## 2. Principe commun

- **Les vraies fonctions, sur de vrais titres** : les composants de l'application, alimentés par les
  tendances TMDB (la vitrine), pas des maquettes.
- **Rien n'est écrit tant qu'on joue** : l'état vit dans le navigateur du visiteur. Aucun compte créé.
- **On garde tout d'un clic** : « Garder ce que j'ai fait » crée le compte invité, y verse les titres,
  notes et statuts, puis propose de le garder (e-mail et mot de passe).

## 3. Deux options

| | A. Pages d'aperçu distinctes | B. Une visite interactive (recommandée) |
|---|---|---|
| Forme | 8 pages `/apercu/…`, une par partie | Une page `/visite` en 8 chapitres, qui s'enchaînent |
| Lien entre les parties | Aucun : chaque page repart de zéro | Ce qu'on fait nourrit la suite (tri, puis notes, puis duels, puis classement, puis recos) |
| Ce que le visiteur comprend | Huit fonctions séparées | Comment Catalog apprend ses goûts, de bout en bout |
| Entretien | 8 pages à tenir en phase avec l'application | 1 page, des composants partagés avec l'accueil |
| Navigation d'un visiteur | Chaque lien va sur sa page d'aperçu | Chaque lien va au chapitre (`/visite#duels`…) |

**Recommandation : B.** Une seule histoire : en trois minutes, le visiteur trie, note, tranche, voit son
classement se former et reçoit ses premières recommandations. Les sections de l'accueil en sont les
bandes-annonces : chacune se joue sur place et mène au chapitre complet.

## 4. Les chapitres de la visite (option B)

| # | Chapitre | Ce que le visiteur fait | Source |
|---|---|---|---|
| 1 | Tri rapide | Douze titres très connus : « Vu », « Pas vu », « Ça me tente » | Vitrine (les plus vus) |
| 2 | Notation | Note d'une touche les titres vus (0 à 5) | Chapitre 1 |
| 3 | Duels | Deux de ses titres notés s'affrontent ; l'ordre se précise | Chapitres 1 et 2 |
| 4 | Classement | Ses paliers d'étoiles, rangés par les duels, en direct | Chapitres 2 et 3 |
| 5 | Recos | « Parce que tu as aimé X » : les titres proches de ses meilleurs | TMDB (route publique à ajouter) |
| 6 | Ce soir | Une envie, une durée : trois titres pour ce soir | Ses « Ça me tente » et les tendances |
| 7 | Playlists | Une saga dans l'ordre, « lequel vient ensuite » | Collection TMDB (ex. une saga connue) |
| 8 | Sorties | Ce qui sort au cinéma ces deux semaines, à ajouter | Vitrine (à l'affiche, à venir) |
| Fin | Garder | « Garder ce que j'ai fait » : compte invité, titres et notes versés, puis /connexion | — |

La bibliothèque se montre dans le chapitre 1 et à la fin : la pile qui s'est remplie.

## 5. Sur la page d'arrivée

| Section | Aujourd'hui | Jouable |
|---|---|---|
| Notation | « Tu l'as vu ? » écrit déjà (premier geste) | Garder, et y ajouter « Continuer la visite » |
| Duels | « Note au moins deux titres » (cul-de-sac) | Une paire de titres très connus, choisir n'écrit rien, l'ordre s'affiche |
| Playlists | « Aucune playlist en cours » | Une saga d'exemple, cocher « vu » fait avancer « ensuite » |
| Sorties | Un texte et un bouton | Les prochaines sorties au cinéma, sans compatibilité |
| Tes goûts, onglet Tendances | En double | Retirés pour un visiteur |

## 6. Étapes

1. Accueil jouable : Duels, Playlists, Sorties ; retraits (Tes goûts, onglet Tendances, Réglages) ;
   barre d'onglets et menus d'un visiteur vers les chapitres.
2. `/visite`, chapitres 1 à 4 (tri, notes, duels, classement), état dans le navigateur.
3. Chapitres 5 à 8, et « Garder ce que j'ai fait ».
4. Mesure : part des visiteurs qui finissent un chapitre, et qui gardent (à voir avec les entretiens).

## 7. Décisions (Louis, 2026-11-06)

1. **Option B**, avec une logique d'accueil et d'appel à l'action dans chaque chapitre.
2. « Garder » verse les titres, statuts, notes **et les duels**.

## 8. Réalisé (2026-11-06)

- `src/lib/visite.ts` (état, Elo, paires, classement, recos, Ce soir, bilan), 7 tests ;
  `src/components/visite/` (état dans le navigateur, les 8 chapitres, « Garder », le fil des étapes) ;
  page `/visite`.
- Accueil d'un visiteur : « Fais le tour » ; Notation = tri de la visite ; Duels, Playlists et Sorties
  jouables sur place ; chaque section mène à son chapitre ; plus d'onglet « Tendances » ni de carte
  « Tes goûts » en double ; barre sans réglages ni « Ajouter », liens et menus vers les chapitres.
- Session : l'accueil et la visite se regardent sans compte ; une page de l'application n'ouvre la session
  que sur une vraie navigation (`sec-fetch-dest: document`). **Défaut corrigé** : les préchargements de
  liens de Next.js (dont il retire les en-têtes avant le proxy) ouvraient chacun un compte invité vide
  (16 en 4 minutes pendant l'audit, supprimés).
- Vérifié en version de production locale (v2, serveur Rust, Supabase) : jouer et précharger ne créent
  aucun compte ; « Garder » crée l'invité et verse 6 titres avec statuts et notes, puis /connexion
  (compte de test supprimé). `tsc`, `eslint`, 261 tests, audit du système de design sans écart.


## 9. Pas à pas et page d'arrivée distincte (2026-11-08)

Suite de l'audit `docs/audit/landing-visite-app-2026-11-07.md` et des décisions de Louis (§ 5 de l'audit).

- **Visite pas à pas** : une étape à l'écran (`/visite?etape=<id>`, l'ancienne ancre `#id` redirigée),
  dans la fenêtre de commande de l'application ; « Étape n sur 8 » et un fil de huit traits ; Précédent et
  Suivant (et les flèches ←, →) ; le retour du navigateur revient à l'étape précédente. Les touches d'un
  chapitre marchent sans cliquer d'abord. Sous chaque étape, « Dans l'application, en plus : … ».
- **Barre « Garder » fixe** en bas dès le premier titre trié (« 2 titres, 1 note ») : on garde à tout
  moment ; la dernière étape reprend le bilan. Dans la barre du haut, « Quitter la visite » remplace
  « Fais le tour ».
- **La page d'arrivée ne joue plus la visite** : plus aucun chapitre ni commande qui écrit sur l'accueil
  d'un visiteur (le § 5 ci-dessus est remplacé). Elle compte cinq blocs : héros et éventail des titres du
  moment ; comment ça marche (noter, départager, recevoir des recommandations) ; les huit parties, chacune
  vers son étape ; pourquoi Catalog (il apprend de tes notes ; gratuit pendant la bêta) ; dernier appel et
  pied de page (un projet Yugen, attribution TMDB).
- L'accueil d'un compte est inchangé : sa refonte est le prochain chantier.

## 10. Continuer plutôt que garder (2026-11-09)

Audit `docs/audit/parcours-visiteur-2026-11-09.md`. « Garder ce que j'ai fait » devient **« Continuer avec mes
titres »** : la visite n'écrit plus rien ; elle mène à la bienvenue, qui verse ses titres, notes et duels dans
la bibliothèque à l'arrivée (`specs/bienvenue-v1.md`, FR-13). La barre du haut n'a plus « Quitter la visite » :
le logo ramène à l'accueil, « Tester » reste le seul bouton principal.

