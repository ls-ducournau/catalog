# Catalog v2 : indépendant, multi-utilisateur, en Rust sur Vercel et Supabase

**Auteur** : Claude (assisté) · **Date** : 2026-10-26 · **Statut** : Brouillon, à valider · **Relecteur** : Louis

## 1. Contexte et décisions

Décisions de Louis (2026-10-26) :

1. **Notion est retiré pour de bon.** Il ne servait qu'à démarrer. La v2 n'en contient aucune trace
   (code, schéma, interface, specs).
2. **Des personnes extérieures doivent pouvoir essayer l'application**, pour éviter le biais de
   complaisance (page Notion « Interview utilisateur » : 4 inconnus, 15 minutes, retour sans
   relance). Deux versions d'essai : un **compte vierge** et un **compte avec les données de Louis**.
3. **Déploiement sur Vercel et Supabase.** Donc PostgreSQL (plus de fichier SQLite en ligne).
4. **Un système d'identification** : un compte par personne, données isolées.
5. **Serveur en Rust**, réécriture complète menée **en parallèle** de l'application actuelle
   (« plan B »), qui reste utilisable jusqu'à la bascule.

État actuel mesuré (2026-10-26) :

| Élément | Valeur |
|---|---|
| Accès à la base | `better-sqlite3`, synchrone : 181 appels SQL dans 76 fichiers |
| Tables | 17 ; la table `items` mélange infos TMDB et état personnel |
| Routes d'API | 46 |
| Logique serveur (`src/lib`, hors tests) | 8 692 lignes, dont 4 974 touchent la base |
| Tests serveur | 3 565 lignes |
| Interface (`.tsx`) | 20 304 lignes, qui importent des types des services |
| Runtime Rust de Vercel | **bêta**, sur Fluid compute (documentation du 2025-12-08) |

## 2. Architecture cible

- **Interface** : Next.js, inchangée dans l'esprit, déployée sur Vercel. Elle appelle l'API.
- **API** : fonctions Rust (`vercel_runtime`, un binaire par fonction ou un service Axum), dans le même
  projet Vercel.
- **Données et identification** : Supabase (PostgreSQL, Supabase Auth, règles d'accès par ligne).
- **Contrat** : les types échangés sont générés depuis le Rust (pas recopiés à la main), pour que
  l'interface ne perde pas ses types.
- **Application actuelle (v1)** : gelée (corrections seulement) jusqu'à la bascule. Sa synchronisation
  Notion n'est plus utilisée.

## 3. Exigences fonctionnelles

- **FR-1 (indépendance)** — La v2 NE DOIT dépendre d'aucun service de notes externe : ni clé, ni
  route, ni colonne, ni message à l'écran. Ajouter, retirer, noter un titre fonctionne seul.
- **FR-2 (comptes)** — Une personne DOIT pouvoir entrer **sans rien saisir** (accès invité, un clic),
  puis garder son compte avec une **adresse e-mail et un mot de passe**, **sans code de validation**
  (décision de Louis, 2026-10-27 : la friction doit être minimale). Le compte invité devient durable
  en gardant son identifiant (AC-4). Une personne revient de n'importe quel appareil avec son e-mail
  et son mot de passe. Pas de connexion par e-mail seul : sans preuve, n'importe qui ouvrirait le
  compte d'un autre. Google reste possible plus tard.
- **FR-3 (isolation)** — Toute donnée personnelle DOIT porter l'identifiant de son propriétaire. Une
  personne ne lit ni n'écrit jamais les données d'une autre, ni par l'API, ni par la base (règles
  d'accès par ligne en seconde barrière).
- **FR-4 (catalogue partagé)** — Les informations d'un titre qui viennent de TMDB (affiche, synopsis,
  genres, distribution, disponibilité) sont **partagées** entre comptes et rafraîchies une fois ;
  la note, le statut, l'Elo, les duels et les playlists sont personnels.
- **FR-5 (import de Louis)** — La base SQLite actuelle DOIT pouvoir être importée dans le compte de
  Louis sans perte : titres, notes, duels, Elo, playlists, avis sur les personnes, journal, réglages.
  Un rapport compare les comptes avant et après.
- **FR-6 (compte vierge)** — Un compte neuf DOIT pouvoir amorcer son profil en une vingtaine de
  notes (Tri rapide ou import d'une liste), faute de quoi recommandations et Ce soir restent vides.
- **FR-7 (parité)** — Chaque route et chaque comportement de la v1 DOIT exister dans la v2, vérifié
  par des **tests HTTP identiques** passés contre la v1 et contre la v2 (les critères d'acceptation
  des specs existantes en sont la source).
- **FR-8 (déploiement)** — Un déploiement d'aperçu et un déploiement de production sur Vercel,
  secrets hors du code, base en région UE.
- **FR-9 (données personnelles)** — Une personne peut exporter ses données et supprimer son compte
  (effacement complet).

## 4. Exigences non fonctionnelles

- **NFR-1** — Aucune écriture dans les tests de capture (règle conservée), et aucune donnée de testeur
  mêlée à celles de Louis.
- **NFR-2** — Les calculs de recommandation tiennent dans la durée maximale d'une fonction pour 1 100
  titres, sinon ils sont précalculés (tâche planifiée) ; mesuré en phase 0.
- **NFR-3** — Les appels TMDB sont mis en cache et partagés (FR-4) : un testeur de plus ne multiplie
  pas les appels.
- **NFR-4** — La v1 reste utilisable pendant toute la réécriture.

## 5. Critères d'acceptation

- **AC-1** (FR-1) — Given la v2 sans aucune clé externe, When j'ajoute, note et retire un titre,
  Then tout fonctionne ; une recherche de la v2 ne trouve aucune mention de l'ancien service.
- **AC-2** (FR-3) — Given deux comptes A et B, When A lit, écrit ou supprime avec l'identifiant
  d'une donnée de B, Then B n'est ni lu ni modifié, et la base le refuse même sans le filtre de l'API.
- **AC-3** (FR-5) — Given la base de Louis, When je l'importe, Then les comptes (titres, notes,
  duels, playlists) sont égaux avant et après, et le classement Elo est identique.
- **AC-4** (FR-2) — Given un navigateur neuf, When j'ouvre l'application, Then j'entre sans e-mail ;
  When j'ajoute un e-mail, Then mes données restent.
- **AC-5** (FR-6) — Given un compte vierge, When je note 20 titres au Tri rapide, Then Ce soir
  propose au moins une idée.
- **AC-6** (FR-7) — Given la suite de tests HTTP, When je la lance contre la v1 puis la v2, Then les
  deux réussissent.
- **AC-7** (FR-9) — Given un compte, When je le supprime, Then plus aucune ligne ne lui appartient.

## 6. Phases

0. **POC** (preuve de faisabilité, avant tout engagement) : une fonction Rust déployée sur Vercel qui lit Supabase.
   Trois mesures : temps de démarrage à froid, tenue du pool de connexions via le pooler de Supabase,
   durée du calcul des recommandations sur 1 077 titres. **Critère de passage** : cold start et durée
   acceptables pour 4 testeurs ; sinon on rediscute (retour en TypeScript pour l'API).
1. **Contrat et tests de parité** (`parite/`) : lecture (35 cas) et écriture (53 appels) faites le 2026-10-26, rejouables à l'identique.
   Reste le contrat de l'ajout et du retrait d'un titre, propre à la v2 (sans l'ancien service).
   Les routes de synchronisation Notion (3) sortent du contrat.
2. **Schéma PostgreSQL multi-utilisateur**, règles d'accès, import de Louis.
3. **Identification** : invité, e-mail, compte de Louis.
4. **Portage de l'API par domaines** (titres et journal, bibliothèque, duels, recommandations, Ce soir,
   playlists, personnes, Sorties), chacun fermé par ses tests de parité.
5. **Interface branchée** sur l'API v2, états vide et amorçage du compte vierge.
6. **Bascule et déploiement**, puis ouverture aux testeurs.

## 7. Risques

- **Runtime Rust en bêta** : comportement ou tarif qui change. Parade : phase 0, et garder l'API
  derrière le contrat pour pouvoir la refaire en TypeScript.
- **Pool de connexions** : la documentation de Vercel ne couvre que Node ; avec `sqlx`, à valider
  sur le pooler de Supabase.
- **Taille de la réécriture** : 8 700 lignes plus 3 565 de tests. Parade : parité par domaine, v1
  intacte, aucun état intermédiaire livré.
- **Fuite entre comptes** : le pire défaut possible. Parade : AC-2 testé en continu.
- **E-mail non vérifié** (choix de Louis) : une faute de frappe rend la récupération du mot de passe
  impossible, et rien n'empêche d'inscrire l'adresse de quelqu'un d'autre. Acceptable pour un essai
  avec des films ; à revoir avant une ouverture large. Vérifié le 2026-10-27 sur le vrai projet : un invité devient un compte e-mail et mot de passe
  sans confirmation et garde son identifiant ; la reconnexion par e-mail et mot de passe rend le même
  compte (AC-4).
- **Formules gratuites** : un projet Supabase gratuit peut se mettre en pause après une période
  d'inactivité, ce qui fausserait le signal « ils reviennent seuls ». À vérifier avant les testeurs.

## 8. Hors périmètre

- Reprise de l'ancien service de notes sous quelque forme que ce soit.
- Application mobile native, partage de listes, paiement.
- Refonte visuelle : le système de design v2 reste.

## 9. Questions ouvertes

1. Louis : connexion Google ou e-mail ?
2. L'application tourne-t-elle encore en local après la bascule, ou seule la version hébergée
   demeure ? (Recommandation : seule la version hébergée.)
3. Quel niveau d'hébergement au départ (formules gratuites, à vérifier avec le point de pause) ?

## 10. Résultats de la phase 0 (2026-10-27)

POC dans `poc/` (Rust, `vercel_runtime` 2, `sqlx` 0.8), déployée sur Vercel (région `dub1`,
Dublin, proche de la base Supabase d'Irlande `eu-west-1`), reliée à un vrai projet Supabase (PostgreSQL
17.11). Le projet Vercel n'est relié à aucun dépôt Git : on déploie par `vercel deploy`.

| Mesure | Résultat |
|---|---|
| Le runtime Rust de Vercel (bêta) compile et exécute les trois fonctions | oui, sans configuration particulière |
| Connexion à Supabase par le pooler en mode transaction (`:6543`), TLS | oui ; ouverture du pool 30 ms |
| Pool réutilisé par les appels suivants de la même instance | oui (`pool_neuf: false`, 0 ms) |
| Requêtes simples sans requête préparée (`statement_cache_capacity(0)`, `persistent(false)`) | oui, 3 ms |
| Schéma de sécurité prévu : `set_config('request.jwt.claims', …)` puis `set local role authenticated`, dans une transaction | **oui, validé sur le vrai Supabase** ; `auth.uid()` rend bien l'identifiant posé ; 7 à 9 ms |
| Calcul de substitution (1 100 titres, 604 450 paires, similarité creuse) | 180 ms ; appel HTTP complet 0,29 à 0,41 s |
| Appels HTTP complets (réseau compris), pool neuf puis réutilisé | 0,34 s puis 0,26 s |

Réserves, à ne pas oublier :
- Le calcul est un **substitut** (même famille de calcul, pas le vrai modèle). La durée du vrai modèle
  reste à mesurer à la portage.
- Le démarrage à froid n'est pas mesuré proprement : les appels de test ont suivi le déploiement.
  À remesurer après plusieurs minutes d'inactivité.
- Le runtime Rust reste en **bêta** (documentation du 2025-12-08).
- Seule la région Dublin a été essayée ; le plan Hobby gratuit de Vercel n'est pas prévu pour un usage
  commercial (à vérifier avant d'ouvrir à des testeurs).
- Les migrations `supabase/migrations/` ne sont pas encore appliquées au projet Supabase : les
  vérifications d'étanchéité sur le vrai Supabase restent à faire.

**Critère de passage de la phase 0** : atteint pour la connexion, le pool, le changement de rôle et
l'ordre de grandeur du calcul. Il reste le démarrage à froid.

### Vérifications d'identification (2026-10-27, vrai projet Supabase)

- L'accès invité (connexion anonyme) est activé ; il rend un jeton d'accès d'une heure (renouvelé par
  un jeton de renouvellement), rôle `authenticated`, marqueur `is_anonymous`.
- Les jetons sont signés en **ES256** ; les clés publiques sont servies par l'adresse JWKS du projet
  (`/auth/v1/.well-known/jwks.json`) : le service Rust vérifie la signature **sans secret**, en les
  gardant en cache.
- Conversion d'un invité en compte e-mail et mot de passe, sans confirmation (« Confirm email »
  désactivé) : même identifiant, e-mail considéré confirmé, reconnexion depuis un autre appareil
  possible (AC-4 vérifié).

## 11. Première tranche verticale déployée (2026-10-27)

Dossier `serveur/` : un service Axum unique sur Vercel, relié à Supabase, avec une page d'essai
(`serveur/public/index.html`).

- **Identification** : accès invité d'un clic, e-mail et mot de passe sans code, conversion d'un invité
  en compte durable avec le même identifiant, reconnexion depuis un autre navigateur : vérifiés dans un
  vrai navigateur (AC-4).
- **Import** : `supabase/import/importer.mjs` charge la base de Louis dans un compte (194 s, comptes
  identiques table par table, classement Elo identique à la décimale) ; il refuse d'importer si un
  contrôle échoue (transaction annulée) et part d'une sauvegarde cohérente de SQLite, jamais du
  fichier vivant. Le compte de démonstration contient les données de Louis.
- **Routes portées** : `/api/sante`, `/api/genres`, `/api/items`, `/api/items/{id}`. Elles passent le
  contrat de parité (`parite/check.mjs --v2`) et, sur les 1 077 titres, rendent le même ordre et les
  mêmes champs que la v1, sauf les 5 paires de doublons (version la plus fraîche). L'ordre des noms
  reprend la règle de la v1 (repli ASCII, ordre des octets) ; la recherche aussi (la v2 ne trouve pas
  « É » en cherchant « é », comme la v1 : à améliorer plus tard).
- **Mesures sur Vercel** : liste de 48 titres (132 ko) en 0,57 s au premier appel puis 0,16 s.
- **Limites connues** : l'ajout et le retrait d'un titre ne sont pas portés (il manque l'appel TMDB
  côté Rust) ; la protection d'accès de Vercel reste active (le projet n'est ouvrable que connecté au
  compte Vercel) ; les identifiants de la base et la clé secrète ont circulé dans la conversation et
  sont à remplacer avant d'ouvrir à des testeurs.
