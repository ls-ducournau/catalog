# Bandes-annonces — v1

**Statut :** livré le 2026-09-26 (demande de l'utilisateur du 2026-09-26 : « le lien des
bandes-annonces », « bien réfléchir à l'UX pour lire la bande-annonce »)
**Date :** 2026-09-26

## 1. Contexte

La bande-annonce sert à décider (« ça me tente ? », « je regarde ça ce soir ? »). TMDB fournit les
vidéos de chaque titre (`videos` : type, langue, officielle, clé YouTube), dans l'appel groupé que
l'app fait déjà. Mais il faut choisir la bonne : pour *Dune : Deuxième partie*, les premières
vidéos sont des extraits et des discours de cérémonie.

## 2. Exigences fonctionnelles

- **FR-1** (choix de la vidéo) — Pour un titre, l'app DOIT retenir au plus une vidéo YouTube :
  une bande-annonce plutôt qu'un teaser, jamais un extrait, un making-of ou un bêtisier ; en
  français d'abord, puis en anglais, puis sans langue ; officielle d'abord ; la plus récente à
  égalité. Aucune sinon.
- **FR-2** (données) — La vidéo retenue DOIT être stockée localement avec les autres données TMDB
  du titre (création, rafraîchissement, découverte) ; un titre sans bande-annonce est retenu
  comme tel, pour ne pas la redemander. Rattrapage local pour la bibliothèque existante.
- **FR-3** (où) — Un bouton « Bande-annonce » DOIT apparaître là où l'on décide : fiche d'un
  titre, carte du tri rapide, proposition principale de Ce soir, lignes de Sorties, cartes
  d'« À découvrir » et de « Ma pile à voir » (ajout du 2026-09-26). Seulement s'il existe une bande-annonce : jamais de bouton vers du vide.
- **FR-4** (lecture) — Le clic DOIT ouvrir un lecteur en surimpression, dans l'app : vidéo 16:9
  qui démarre aussitôt, titre, mention VF ou VO (sous-titres français demandés en VO), lien
  « Ouvrir sur YouTube ». Fermeture par Échap, clic hors du lecteur ou bouton ; le focus revient
  au bouton d'origine.
- **FR-6** (échec, 2026-09-26) — Si la vidéo n'a pas démarré quelques secondes après l'ouverture,
  le lecteur DOIT proposer « Regarder sur YouTube » et « Réessayer », en donnant la cause
  probable : un VPN, que YouTube prend pour un robot (constaté par l'utilisateur : la vidéo passe
  VPN coupé), et en expliquant qu'une connexion demandée par YouTube ne peut pas se faire dans un
  lecteur intégré (Google interdit sa page de connexion dans un autre site). Si YouTube signale
  une erreur (vidéo interdite hors de YouTube, supprimée), ou si son lecteur ne se charge pas, le
  lecteur DOIT être remplacé par ce recours. Le message DOIT nommer la vraie cause (la chaîne qui
  publie la vidéo, par son nom quand on le connaît ; son retrait ; le lecteur de YouTube) et
  JAMAIS l'app, ni « les autres sites », ni « ici » : rien ne doit laisser croire que l'app est en
  cause (remarques de l'utilisateur, 2026-09-26 et 2026-09-27). Vidéo retirée : « Chercher
  sur YouTube » une autre bande-annonce du titre.
  Amendement 2026-09-27 : une erreur 101 ou 150 du lecteur NE DOIT PAS être attribuée à la
  chaîne. Toutes les vidéos lues dans le lecteur ont été vérifiées lisibles hors de YouTube
  (FR-8) ; ces erreurs viennent alors du contexte de lecture, que YouTube filtre : un VPN (pays
  de connexion), un navigateur ou un bloqueur. Constaté par l'utilisateur : la bande-annonce de
  Sky TV du « Tatoueur d'Auschwitz », annoncée « réservée à YouTube », se lit dans Chrome ou
  Comet sans VPN. Le message DOIT dire que YouTube a bloqué la lecture, donner ces causes et
  proposer « Réessayer » et « Regarder sur YouTube ».
- **FR-7** (préférence, 2026-09-26) — L'utilisateur DOIT pouvoir choisir : lire dans l'app
  (défaut), toujours ouvrir sur YouTube (le bouton devient un lien), ou ne pas afficher de
  bandes-annonces. Le choix est proposé dans le lecteur et dans les réglages de la barre de
  navigation (d'où l'on revient en arrière) ; mémorisé sur l'appareil.
- **FR-8** (vidéo lisible, 2026-09-27) — Parmi les vidéos du titre, l'app DOIT retenir la
  meilleure (ordre de FR-1) que sa chaîne autorise hors de YouTube, vérifiée auprès de YouTube
  (point d'accès public oEmbed : 200 lisible, 401 réservée à YouTube, 404 retirée), et retenir le
  nom de la chaîne. S'il n'y en a aucune, la meilleure réservée à YouTube est gardée et marquée :
  son bouton mène alors directement à YouTube, sans lecteur voué à l'échec. Un doute (réseau) ne
  pénalise pas la vidéo.
- **FR-5** (raccourcis) — Tant que le lecteur est ouvert, les raccourcis clavier des pages (tri
  rapide, duels, départage) NE DOIVENT PAS agir.

## 3. Exigences non fonctionnelles

- **NFR-1** — Rien n'est chargé de YouTube avant le clic : le lecteur n'est créé qu'à l'ouverture.
  Lecteur standard (`youtube.com/embed`, avec `origin`) : le mode sans cookie
  (`youtube-nocookie.com`), prévu d'abord, n'a pas accès à la session YouTube du navigateur, et
  YouTube y affichait « Connectez-vous pour confirmer que vous n'êtes pas un robot » (constaté
  par l'utilisateur le 2026-09-26 ; la cause était son VPN). L'API officielle du lecteur
  (`iframe_api`), chargée au premier clic, sert à savoir si la vidéo a démarré (FR-6).
- **NFR-2** — Pas de lecture automatique au survol ni d'aperçu dans les grilles.
- **NFR-3** — Mouvement réduit : apparition sans zoom. Mobile : lecteur pleine largeur, bouton de
  fermeture d'au moins 44 px.

## 4. Critères d'acceptation

- **AC-1** (FR-1) — Given un extrait français, une bande-annonce anglaise officielle et un teaser
  français, When la vidéo est choisie, Then c'est la bande-annonce anglaise.
- **AC-2** (FR-1) — Given deux bandes-annonces françaises, l'une officielle, When la vidéo est
  choisie, Then c'est l'officielle ; à égalité, la plus récente.
- **AC-3** (FR-1) — Given seulement des extraits et des making-of, When la vidéo est choisie,
  Then il n'y en a pas.
- **AC-4** (FR-2) — Given un titre sans bande-annonce, When il est lu, Then il est marqué « sans »
  et le bouton n'apparaît pas.
- **AC-5** (FR-6) — Given une erreur YouTube 101 ou 150, When le lecteur la reçoit, Then le
  message dit que YouTube a bloqué la lecture et cite le VPN, le navigateur ou un bloqueur, sans
  nommer ni mettre en cause la chaîne, avec « Réessayer » ; 100, qu'elle a été retirée, avec
  « Chercher sur YouTube » et la chaîne nommée quand on la connaît ; aucun message ne met en
  cause l'app.
- **AC-6** (FR-8) — Given une bande-annonce VF réservée à YouTube et une VO lisible, When la vidéo
  est choisie, Then c'est la VO, avec le nom de sa chaîne.
- **AC-7** (FR-8) — Given uniquement des vidéos réservées à YouTube, When la vidéo est choisie,
  Then c'est la meilleure, marquée « réservée à YouTube », et son bouton est un lien.

## 5. Précisions de mise en œuvre

- Délai avant l'aide (FR-6) : 6 s sans lecture ni chargement. Le lecteur reste visible : un clic
  sur ▶ peut encore lancer la vidéo, et l'aide disparaît alors.
- Réglage (FR-7) : clé `watchlist:trailerMode` du stockage local (`embed`, `youtube`, `hidden`) ;
  menu ⚙ au bout de la barre de navigation. Tous les boutons suivent le réglage sans recharger.

- Rattrapage : `scripts/backfill-trailers.mjs` (local) ; 1 019 titres sur 1 056 ont une
  bande-annonce, dont 852 en VF.
- Emplacements : à côté de la note TMDB dans la fiche ; sur l'affiche de la carte du tri rapide ;
  entre « Je regarde ça » et « Ajouter » dans Ce soir ; ▶ au centre de l'affiche dans Sorties,
  « Ma pile à voir » (grille et rangées) et « À découvrir », toujours visible.
- Le lecteur est rendu à la racine du document : dans le tri rapide, la carte est déplacée par
  une transformation CSS, qui décalerait un lecteur placé à l'intérieur.
- Un auteur peut interdire la lecture de sa vidéo hors de YouTube : le lien « Ouvrir sur
  YouTube » reste alors le recours.

- Revérification du 2026-09-27 (`scripts/backfill-trailers.mjs --recheck`, local) : sur 1 063
  titres, 1 022 ont une bande-annonce ; 15 ont été remplacées par une version lisible dans l'app,
  2 restent réservées à YouTube. Sondage préalable : 58 lisibles, 1 réservée, 1 retirée sur 60.

## 6. Hors périmètre

- **OS-1** — Aperçus au survol façon plateformes (NFR-2).
- **OS-2** — Vidéos hors YouTube (Vimeo) : rares sur TMDB.
