//! Le catalogue partagé, écrit depuis TMDB. Reprend `addTitleToLibrary` (src/lib/libraryActions.ts, la
//! partie fiche), `insertItem`, `getItemWithOverview`, `refreshItemFromTmdb` et `storeTitleData`
//! (src/lib/itemService.ts) :
//! - à l'ajout d'un titre, la fiche complète (titre et synopsis en français, genres, réalisation, note,
//!   votes, affiche, caractéristiques du modèle, disponibilité, dates de sortie, bande-annonce) ;
//! - à l'ouverture d'un titre (`GET /api/items/{id}`), le synopsis s'il n'a jamais été cherché, et la
//!   disponibilité, les dates et la bande-annonce si elles manquent ou ont plus de 7 jours ;
//! - `?refresh=1`, tout, à la demande.
//!
//! RÈGLE (specs/catalog-v2-donnees.md 4.7) : `catalog_titles` ne s'écrit qu'avec le rôle du serveur, dans une
//! transaction serveur (`bd::transaction_serveur()`, voir bd.rs : jamais de requête avec paramètres sur le pool
//! hors transaction), jamais dans la transaction d'un compte, et seulement avec des réponses de TMDB.
//! Les appels à TMDB se font hors de toute transaction.
use crate::{
    auth::Utilisateur,
    bd,
    erreur::Erreur,
    items::{COLONNES, titre},
    tmdb::{self, Details, DetailsFr, DonneesTitre, temps},
};
use serde_json::{Number, Value, json};
use sqlx::{Row, postgres::PgRow};

/// Colonnes de la vue `library_view` lues en plus de `items::COLONNES` pour la fiche.
const COLONNES_FICHE: &str = "title_id, tmdb_id::bigint as tmdb_id, director, tmdb_features";

/// Ce que le catalogue sait d'un titre (une ligne de `catalog_titles`, ou la partie TMDB d'un titre de
/// la bibliothèque). Un titre saisi à la main en v1 n'a ni fiche ni numéro TMDB.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Fiche {
    pub title_id: Option<i64>,
    pub tmdb_id: Option<i64>,
    pub type_: String,
    pub nom: String,
    pub annee: Option<String>,
    pub affiche: Option<String>,
    pub genres: Option<Value>,
    pub realisation: Option<String>,
    pub note: Option<f64>,
    pub votes: Option<i64>,
    /// `None` : jamais cherché ; `Some("")` : cherché, TMDB n'en a pas.
    pub synopsis: Option<String>,
    pub caracteristiques: Option<Value>,
    pub disponibilite: Option<Value>,
    pub sortie: Option<Value>,
    pub bande_annonce: Option<Value>,
}

impl Fiche {
    fn depuis(ligne: &PgRow) -> Result<Self, Erreur> {
        Ok(Fiche {
            title_id: ligne.try_get("title_id")?,
            tmdb_id: ligne.try_get("tmdb_id")?,
            type_: ligne.try_get("type")?,
            nom: ligne.try_get("name")?,
            annee: ligne.try_get("year")?,
            affiche: ligne.try_get("poster_path")?,
            genres: ligne.try_get("genres")?,
            realisation: ligne.try_get("director")?,
            note: ligne.try_get("tmdb_rating")?,
            votes: ligne.try_get::<Option<i32>, _>("vote_count")?.map(i64::from),
            synopsis: ligne.try_get("overview")?,
            caracteristiques: ligne.try_get("tmdb_features")?,
            disponibilite: ligne.try_get("watch_providers")?,
            sortie: ligne.try_get("release_info")?,
            bande_annonce: ligne.try_get("trailer_info")?,
        })
    }
}

fn reel(n: Option<&Number>) -> Option<f64> {
    n.and_then(Number::as_f64)
}
fn entier(n: Option<&Number>) -> Option<i64> {
    n.and_then(|n| n.as_i64().or_else(|| n.as_f64().map(|f| f.round() as i64)))
}

/// Ce qu'il faut demander à TMDB en ouvrant un titre (`getItemWithOverview`).
#[derive(Debug, PartialEq)]
pub struct Besoins {
    /// Le synopsis n'a jamais été cherché : titre et synopsis en français, note et votes au passage.
    pub synopsis: bool,
    /// Disponibilité ou dates absentes ou de plus de 7 jours, ou bande-annonce jamais cherchée : tout le
    /// titre en un appel. À l'ajout d'un titre déjà au catalogue, aussi des caractéristiques absentes
    /// (un ajout de la v1 les récupère toujours).
    pub donnees: bool,
}

pub fn besoins(fiche: &Fiche, maintenant_ms: f64, pour_ajout: bool) -> Besoins {
    let tmdb = fiche.tmdb_id.is_some();
    Besoins {
        synopsis: tmdb && fiche.synopsis.is_none(),
        donnees: tmdb
            && (temps::perime(fiche.disponibilite.as_ref(), maintenant_ms)
                || temps::perime(fiche.sortie.as_ref(), maintenant_ms)
                || fiche.bande_annonce.is_none()
                || (pour_ajout && fiche.caracteristiques.is_none())),
    }
}

/// Le synopsis rendu par la fiche : « déjà tenté, rien à afficher » (`""`) pour un titre sans numéro TMDB.
pub fn synopsis_affiche(fiche: &Fiche) -> Option<String> {
    match (&fiche.synopsis, fiche.tmdb_id) {
        (None, None) => Some(String::new()),
        (s, _) => s.clone(),
    }
}

/// Le synopsis en français, avec la note et le nombre de votes du même appel (ils écrasent les
/// précédents, même vides, comme la v1).
pub fn appliquer_synopsis(fiche: &mut Fiche, fr: &DetailsFr) {
    fiche.synopsis = Some(fr.synopsis.clone());
    fiche.note = reel(fr.note.as_ref());
    fiche.votes = entier(fr.votes.as_ref());
}

/// `storeTitleData` : disponibilité, dates, bande-annonce et caractéristiques.
pub fn appliquer_donnees(fiche: &mut Fiche, donnees: &DonneesTitre) {
    fiche.disponibilite = Some(donnees.disponibilite.clone());
    fiche.sortie = Some(donnees.sortie.clone());
    fiche.bande_annonce = Some(donnees.bande_annonce.clone());
    fiche.caracteristiques = Some(donnees.caracteristiques.clone());
}

/// `insertItem` appelé par `addTitleToLibrary` : la fiche d'un titre ajouté. Titre et nombre de votes en
/// français quand TMDB les a ; synopsis français ou vide ; genres `null` s'il n'y en a pas ; ce que
/// l'appel groupé n'a pas rapporté reste `null` (un rattrapage le complétera).
pub fn fiche_ajoutee(details: &Details, fr: Option<&DetailsFr>, donnees: Option<&DonneesTitre>) -> Fiche {
    Fiche {
        title_id: None,
        tmdb_id: Some(details.tmdb_id),
        type_: details.type_.to_owned(),
        nom: fr.map(|f| f.titre.clone()).filter(|t| !t.is_empty()).unwrap_or_else(|| details.titre.clone()),
        annee: details.annee.clone(),
        affiche: details.affiche.clone(),
        genres: (!details.genres.is_empty()).then(|| Value::Array(details.genres.clone())),
        realisation: details.realisation.clone(),
        note: reel(details.note.as_ref()),
        votes: entier(fr.and_then(|f| f.votes.as_ref()).or(details.votes.as_ref())),
        synopsis: Some(fr.map(|f| f.synopsis.clone()).unwrap_or_default()),
        caracteristiques: donnees.map(|d| d.caracteristiques.clone()),
        disponibilite: donnees.map(|d| d.disponibilite.clone()),
        sortie: donnees.map(|d| d.sortie.clone()),
        bande_annonce: donnees.map(|d| d.bande_annonce.clone()),
    }
}

/// `refreshItemFromTmdb` : la fiche rafraîchie, chaque champ gardant sa valeur précédente quand l'appel
/// qui le donne a échoué. `None` si ni la fiche ni sa version française n'ont répondu (rien ne change).
pub fn fiche_rafraichie(actuelle: &Fiche, details: Option<&Details>, fr: Option<&DetailsFr>, donnees: Option<&DonneesTitre>) -> Option<Fiche> {
    if details.is_none() && fr.is_none() {
        return None;
    }
    let mut f = actuelle.clone();
    f.nom = fr.map(|x| x.titre.clone()).filter(|t| !t.is_empty()).or_else(|| details.map(|d| d.titre.clone()).filter(|t| !t.is_empty())).unwrap_or_else(|| actuelle.nom.clone());
    if let Some(fr) = fr {
        f.synopsis = Some(fr.synopsis.clone());
    }
    f.note = reel(fr.and_then(|x| x.note.as_ref())).or_else(|| reel(details.and_then(|d| d.note.as_ref()))).or(actuelle.note);
    f.votes = entier(fr.and_then(|x| x.votes.as_ref())).or_else(|| entier(details.and_then(|d| d.votes.as_ref()))).or(actuelle.votes);
    f.affiche = details.and_then(|d| d.affiche.clone()).or_else(|| actuelle.affiche.clone());
    if let Some(d) = details {
        f.genres = (!d.genres.is_empty()).then(|| Value::Array(d.genres.clone()));
    }
    f.realisation = details.and_then(|d| d.realisation.clone()).or_else(|| actuelle.realisation.clone());
    f.annee = details.and_then(|d| d.annee.clone()).or_else(|| actuelle.annee.clone());
    if let Some(d) = donnees {
        appliquer_donnees(&mut f, d);
    }
    Some(f)
}

// ---------- écritures (transaction du serveur) ----------

/// Ajoute la fiche d'un titre au catalogue. Si un ajout simultané l'a créée entre-temps, rend la sienne.
pub async fn inserer(fiche: &Fiche, imdb_id: Option<&str>) -> Result<i64, Erreur> {
    let mut tx = bd::transaction_serveur().await?;
    let cree: Option<(i64,)> = sqlx::query_as(
        "insert into public.catalog_titles (type, tmdb_id, imdb_id, name, year, poster_path, genres, director, tmdb_rating, vote_count, overview,
           tmdb_features, watch_providers, availability_fetched_at, release_info, release_fetched_at, trailer_info)
         values ($1, $2::int, $3, $4, $5, $6, $7, $8, $9, $10::int, $11, $12, $13, ($13::jsonb ->> 'fetchedAt')::timestamptz, $14,
           ($14::jsonb ->> 'fetchedAt')::timestamptz, $15)
         on conflict (type, tmdb_id) do nothing returning id",
    )
    .bind(&fiche.type_)
    .bind(fiche.tmdb_id.map(|i| i as i32))
    .bind(imdb_id)
    .bind(&fiche.nom)
    .bind(&fiche.annee)
    .bind(&fiche.affiche)
    .bind(&fiche.genres)
    .bind(&fiche.realisation)
    .bind(fiche.note)
    .bind(fiche.votes.map(|v| v as i32))
    .bind(&fiche.synopsis)
    .bind(&fiche.caracteristiques)
    .bind(&fiche.disponibilite)
    .bind(&fiche.sortie)
    .bind(&fiche.bande_annonce)
    .persistent(false)
    .fetch_optional(&mut **tx)
    .await?;
    let id = match cree {
        Some((id,)) => id,
        None => {
            sqlx::query_scalar("select id from public.catalog_titles where type = $1 and tmdb_id = $2::int")
                .bind(&fiche.type_)
                .bind(fiche.tmdb_id.map(|i| i as i32))
                .persistent(false)
                .fetch_one(&mut **tx)
                .await?
        }
    };
    tx.valider().await?;
    Ok(id)
}

/// La fiche du catalogue d'un titre TMDB, si elle existe.
pub async fn chercher(type_: &str, tmdb_id: i64) -> Result<Option<Fiche>, Erreur> {
    let mut tx = bd::transaction_serveur().await?;
    let ligne = sqlx::query(
        "select id as title_id, tmdb_id::bigint as tmdb_id, type, name, year, poster_path, genres, director, tmdb_rating, vote_count::int as vote_count,
                overview, tmdb_features, watch_providers, release_info, trailer_info
           from public.catalog_titles where type = $1 and tmdb_id = $2::int",
    )
    .bind(type_)
    .bind(tmdb_id as i32)
    .persistent(false)
    .fetch_optional(&mut **tx)
    .await?;
    tx.valider().await?;
    ligne.as_ref().map(Fiche::depuis).transpose()
}

/// Enregistre le synopsis, la note et les votes d'une fiche (sans toucher sa date de modification).
async fn enregistrer_synopsis(fiche: &Fiche) -> Result<(), Erreur> {
    let mut tx = bd::transaction_serveur().await?;
    sqlx::query("update public.catalog_titles set overview = $2, tmdb_rating = $3, vote_count = $4::int where id = $1")
        .bind(fiche.title_id)
        .bind(&fiche.synopsis)
        .bind(fiche.note)
        .bind(fiche.votes.map(|v| v as i32))
        .persistent(false)
        .execute(&mut **tx)
        .await?;
    tx.valider().await
}

/// `storeTitleData` : disponibilité, dates, bande-annonce et caractéristiques, avec leurs dates de
/// récupération. Ne touche pas la date de modification (ce n'est pas une modification du titre).
pub async fn enregistrer_donnees(title_id: i64, donnees: &DonneesTitre) -> Result<(), Erreur> {
    let mut tx = bd::transaction_serveur().await?;
    sqlx::query(
        "update public.catalog_titles set watch_providers = $2, availability_fetched_at = ($2::jsonb ->> 'fetchedAt')::timestamptz,
           release_info = $3, release_fetched_at = ($3::jsonb ->> 'fetchedAt')::timestamptz, trailer_info = $4, tmdb_features = $5
         where id = $1",
    )
    .bind(title_id)
    .bind(&donnees.disponibilite)
    .bind(&donnees.sortie)
    .bind(&donnees.bande_annonce)
    .bind(&donnees.caracteristiques)
    .persistent(false)
    .execute(&mut **tx)
    .await?;
    tx.valider().await
}

/// `storeRelease` : les dates de sortie seules (rafraîchissement par lots du calendrier, sorties-v1 NFR-2).
pub async fn enregistrer_sortie(title_id: i64, sortie: &Value) -> Result<(), Erreur> {
    let mut tx = bd::transaction_serveur().await?;
    sqlx::query("update public.catalog_titles set release_info = $2, release_fetched_at = ($2::jsonb ->> 'fetchedAt')::timestamptz where id = $1")
        .bind(title_id)
        .bind(sortie)
        .persistent(false)
        .execute(&mut **tx)
        .await?;
    tx.valider().await
}

/// Écrit une fiche rafraîchie, et la date de modification (le modèle de préférence se réentraîne).
async fn enregistrer_rafraichie(fiche: &Fiche) -> Result<(), Erreur> {
    let mut tx = bd::transaction_serveur().await?;
    sqlx::query(
        "update public.catalog_titles set name = $2, overview = $3, tmdb_rating = $4, vote_count = $5::int, poster_path = $6, genres = $7,
           director = $8, year = $9, tmdb_features = $10, watch_providers = $11, availability_fetched_at = ($11::jsonb ->> 'fetchedAt')::timestamptz,
           release_info = $12, release_fetched_at = ($12::jsonb ->> 'fetchedAt')::timestamptz, trailer_info = $13, updated_at = now()
         where id = $1",
    )
    .bind(fiche.title_id)
    .bind(&fiche.nom)
    .bind(&fiche.synopsis)
    .bind(fiche.note)
    .bind(fiche.votes.map(|v| v as i32))
    .bind(&fiche.affiche)
    .bind(&fiche.genres)
    .bind(&fiche.realisation)
    .bind(&fiche.annee)
    .bind(&fiche.caracteristiques)
    .bind(&fiche.disponibilite)
    .bind(&fiche.sortie)
    .bind(&fiche.bande_annonce)
    .persistent(false)
    .execute(&mut **tx)
    .await?;
    tx.valider().await
}

/// Complète une fiche à l'ouverture (ou à l'ajout d'un titre déjà au catalogue) : synopsis jamais cherché,
/// données périmées ou absentes. Les deux appels partent ensemble. Rend `true` si la fiche a changé.
pub async fn completer(fiche: &Fiche, pour_ajout: bool) -> Result<bool, Erreur> {
    let (Some(title_id), Some(tmdb_id)) = (fiche.title_id, fiche.tmdb_id) else { return Ok(false) };
    let b = besoins(fiche, temps::maintenant_ms(), pour_ajout);
    if !b.synopsis && !b.donnees {
        return Ok(false);
    }
    let (fr, donnees) = tokio::join!(
        async {
            if b.synopsis { tmdb::details_fr(tmdb_id, &fiche.type_).await } else { None }
        },
        async {
            if b.donnees { tmdb::donnees_titre(tmdb_id, &fiche.type_).await } else { None }
        }
    );
    // Échec de TMDB : rien n'est écrit, on retentera à la prochaine ouverture.
    let mut nouvelle = fiche.clone();
    if let Some(fr) = &fr {
        appliquer_synopsis(&mut nouvelle, fr);
        enregistrer_synopsis(&nouvelle).await?;
    }
    if let Some(d) = &donnees {
        enregistrer_donnees(title_id, d).await?;
    }
    Ok(fr.is_some() || donnees.is_some())
}

// ---------- la fiche d'un titre de la bibliothèque ----------

async fn lire(utilisateur: &Utilisateur, id: i64) -> Result<Option<(Fiche, Value)>, Erreur> {
    let mut tx = bd::transaction(utilisateur).await?;
    let ligne = sqlx::query(&format!("select {COLONNES}, {COLONNES_FICHE} from public.library_view where id = $1")).bind(id).persistent(false).fetch_optional(&mut **tx).await?;
    tx.valider().await?;
    let Some(ligne) = ligne else { return Ok(None) };
    Ok(Some((Fiche::depuis(&ligne)?, titre(&ligne)?)))
}

/// `GET /api/items/{id}` (`getItemWithOverview`), ou avec `?refresh=1` (`refreshItemFromTmdb`). `None` si
/// le titre n'est pas dans la bibliothèque du compte.
pub async fn fiche_du_titre(utilisateur: &Utilisateur, id: i64, rafraichir: bool) -> Result<Option<Value>, Erreur> {
    let Some((fiche, mut item)) = lire(utilisateur, id).await? else { return Ok(None) };
    let (Some(_), Some(tmdb_id)) = (fiche.title_id, fiche.tmdb_id) else {
        // Titre saisi à la main : rien à demander à TMDB. Son synopsis est « déjà tenté, vide » : la v1
        // l'écrit à la première ouverture de la fiche (et le rafraîchissement, qui ne s'atteint que depuis
        // la fiche ouverte, le relit) ; la v2 n'a pas de colonne pour un titre sans fiche, elle le rend.
        item["overview"] = json!(synopsis_affiche(&fiche));
        return Ok(Some(item));
    };

    if rafraichir {
        let (details, fr, donnees) = tokio::join!(tmdb::details(tmdb_id, &fiche.type_), tmdb::details_fr(tmdb_id, &fiche.type_), tmdb::donnees_titre(tmdb_id, &fiche.type_));
        let Some(nouvelle) = fiche_rafraichie(&fiche, details.as_ref(), fr.as_ref(), donnees.as_ref()) else { return Ok(Some(item)) };
        enregistrer_rafraichie(&nouvelle).await?;
        // Le rafraîchissement est une modification du titre pour ce compte (specs/catalog-v2-donnees.md 4.8).
        let mut tx = bd::transaction(utilisateur).await?;
        sqlx::query("update public.library_items set updated_at = now() where id = $1").bind(id).persistent(false).execute(&mut **tx).await?;
        tx.valider().await?;
    } else if !completer(&fiche, false).await? {
        return Ok(Some(item));
    }
    Ok(lire(utilisateur, id).await?.map(|(_, item)| item))
}

#[cfg(test)]
mod tests_disponibilite {
    // Cas de src/lib/availability.test.ts (AC-1, AC-2, AC-3 de disponibilite-streaming-v1), mêmes entrées et
    // mêmes valeurs attendues. Les fonctions pures sont dans `reglages.rs` (familles, inclusion) et
    // `tmdb::temps` (péremption, `isStale`).
    use crate::reglages::{famille_service, inclus_dans, services_couverts_de};
    use crate::tmdb::temps::{iso, lire_iso, perime};
    use serde_json::{Value, json};

    fn catalogue() -> Vec<Value> {
        vec![
            json!({ "id": 8, "name": "Netflix", "logoPath": "/netflix.jpg" }),
            json!({ "id": 1796, "name": "Netflix Standard with Ads", "logoPath": "/nf-ads.jpg" }),
            json!({ "id": 119, "name": "Amazon Prime Video", "logoPath": "/prime.jpg" }),
            json!({ "id": 582, "name": "Paramount+ Amazon Channel", "logoPath": null }),
        ]
    }
    fn service(id: i64) -> Value {
        catalogue().into_iter().find(|p| p["id"] == id).unwrap()
    }
    fn dispo(champs: Value) -> Value {
        let mut d = json!({ "link": "https://www.themoviedb.org/tv/1396/watch?locale=FR", "flatrate": [], "free": [], "ads": [], "rent": [], "buy": [], "fetchedAt": "2026-09-25T12:00:00.000Z" });
        for (k, v) in champs.as_object().unwrap() {
            d[k] = v.clone();
        }
        d
    }
    fn ids(liste: Vec<Value>) -> Vec<i64> {
        liste.iter().filter_map(|p| p["id"].as_i64()).collect()
    }

    #[test]
    fn assimile_une_formule_avec_publicite_au_service_lui_meme() {
        assert_eq!(famille_service("Netflix Standard with Ads"), famille_service("Netflix"));
    }

    #[test]
    fn garde_distincte_une_chaine_vendue_via_un_autre_service() {
        assert_ne!(famille_service("Paramount+ Amazon Channel"), famille_service("Amazon Prime Video"));
    }

    #[test]
    fn retient_un_titre_liste_seulement_sous_la_formule_avec_publicite() {
        let couverts = services_couverts_de(&[8], &catalogue());
        assert_eq!(ids(inclus_dans(Some(&dispo(json!({ "flatrate": [service(1796)] }))), &couverts)), [1796]);
    }

    #[test]
    fn ne_retient_pas_un_titre_seulement_en_location_ou_a_l_achat() {
        let couverts = services_couverts_de(&[119], &catalogue());
        assert!(inclus_dans(Some(&dispo(json!({ "rent": [service(119)], "buy": [service(119)] }))), &couverts).is_empty());
    }

    #[test]
    fn ne_confond_pas_prime_video_et_une_chaine_amazon() {
        let couverts = services_couverts_de(&[119], &catalogue());
        assert!(inclus_dans(Some(&dispo(json!({ "flatrate": [service(582)] }))), &couverts).is_empty());
    }

    #[test]
    fn n_affiche_qu_une_fois_un_service_present_sous_deux_formules() {
        let couverts = services_couverts_de(&[8], &catalogue());
        assert_eq!(ids(inclus_dans(Some(&dispo(json!({ "flatrate": [service(8), service(1796)] }))), &couverts)), [8]);
    }

    #[test]
    fn ne_retient_rien_sans_disponibilite_connue() {
        assert!(inclus_dans(None, &services_couverts_de(&[8], &catalogue())).is_empty());
    }

    fn recuperee(il_y_a_jours: f64) -> (Value, f64) {
        let maintenant = lire_iso("2026-09-25T12:00:00Z").unwrap();
        (dispo(json!({ "fetchedAt": iso((maintenant - il_y_a_jours * 86_400_000.0) as i64) })), maintenant)
    }

    #[test]
    fn considere_perimee_une_disponibilite_de_plus_de_7_jours() {
        let (d, maintenant) = recuperee(8.0);
        assert!(perime(Some(&d), maintenant));
    }

    #[test]
    fn garde_une_disponibilite_recente() {
        let (d, maintenant) = recuperee(2.0);
        assert!(!perime(Some(&d), maintenant));
    }

    #[test]
    fn considere_perimee_une_disponibilite_jamais_recuperee() {
        assert!(perime(None, lire_iso("2026-09-25T12:00:00Z").unwrap()));
    }
}

#[cfg(test)]
mod tests {
    // Cas de src/lib/itemService.test.ts (« getItemWithOverview », « getItemWithOverview — disponibilité et
    // dates », « insertItem »), mêmes entrées et mêmes valeurs attendues. Les appels à TMDB y sont simulés :
    // ici, `besoins` dit lesquels partiraient, et `appliquer_*` ce qui serait enregistré.
    use super::*;
    use crate::tmdb::temps::{TTL_MS, iso, maintenant_ms};

    const JOUR: f64 = 86_400_000.0;

    fn fr(titre: &str, synopsis: &str, note: f64, votes: i64) -> DetailsFr {
        DetailsFr { titre: titre.into(), synopsis: synopsis.into(), note: Number::from_f64(note), votes: Some(votes.into()) }
    }

    #[test]
    fn recupere_et_garde_le_synopsis_en_francais_et_les_votes_quand_pas_encore_connus() {
        let mut fiche = Fiche { title_id: Some(1), tmdb_id: Some(157_336), type_: "Movie".into(), nom: "Interstellar".into(), ..Fiche::default() };
        assert!(besoins(&fiche, maintenant_ms(), false).synopsis);
        appliquer_synopsis(&mut fiche, &fr("Interstellar", "Des explorateurs voyagent à travers un trou de ver.", 8.4, 16_000));
        assert_eq!(fiche.synopsis.as_deref(), Some("Des explorateurs voyagent à travers un trou de ver."));
        assert_eq!(fiche.votes, Some(16_000));
        // Gardé : une seconde ouverture ne redemande pas le synopsis.
        assert!(!besoins(&fiche, maintenant_ms(), false).synopsis);
    }

    #[test]
    fn ne_redemande_pas_un_synopsis_deja_garde_meme_vide() {
        let fiche = Fiche { nom: "Sans synopsis connu".into(), synopsis: Some(String::new()), ..Fiche::default() };
        assert_eq!(besoins(&fiche, maintenant_ms(), false), Besoins { synopsis: false, donnees: false });
        assert_eq!(synopsis_affiche(&fiche).as_deref(), Some(""));
    }

    #[test]
    fn un_titre_sans_numero_tmdb_a_un_synopsis_vide_sans_appel() {
        let fiche = Fiche { nom: "Sans tmdb_id".into(), type_: "Movie".into(), ..Fiche::default() };
        assert_eq!(besoins(&fiche, maintenant_ms(), false), Besoins { synopsis: false, donnees: false });
        assert_eq!(synopsis_affiche(&fiche).as_deref(), Some(""));
    }

    /// `seedWithAvailability` : disponibilité récupérée il y a `jours`, dates il y a `jours_dates` (ou
    /// jamais), bande-annonce cherchée ou non.
    fn fiche_datee(jours: f64, jours_dates: Option<f64>, avec_bande_annonce: bool) -> Fiche {
        let maintenant = maintenant_ms();
        let il_y_a = |j: f64| iso((maintenant - j * JOUR) as i64);
        Fiche {
            title_id: Some(1),
            tmdb_id: Some(603),
            type_: "Movie".into(),
            nom: "Titre".into(),
            synopsis: Some("Synopsis déjà là".into()),
            disponibilite: Some(json!({ "link": null, "flatrate": [], "free": [], "ads": [], "rent": [], "buy": [], "fetchedAt": il_y_a(jours) })),
            sortie: jours_dates.map(|j| json!({ "kind": "movie", "theatrical": "1999-03-31", "digital": null, "firstAir": null, "nextEpisode": null, "status": "Released", "fetchedAt": il_y_a(j) })),
            bande_annonce: avec_bande_annonce.then(|| json!({ "trailer": null, "fetchedAt": il_y_a(0.0) })),
            ..Fiche::default()
        }
    }

    fn donnees_simulees() -> DonneesTitre {
        let maintenant = iso(maintenant_ms() as i64);
        DonneesTitre {
            disponibilite: json!({ "link": null, "flatrate": [{ "id": 8, "name": "Netflix", "logoPath": null }], "free": [], "ads": [], "rent": [], "buy": [], "fetchedAt": maintenant }),
            sortie: json!({ "kind": "movie", "theatrical": "1999-06-23", "digital": null, "firstAir": null, "nextEpisode": null, "status": "Released", "fetchedAt": maintenant }),
            bande_annonce: json!({ "trailer": null, "fetchedAt": maintenant }),
            caracteristiques: json!({ "genres": [], "keywords": [], "cast": [], "directors": [], "year": 1999, "runtime": 136, "language": "en", "countries": ["US"],
                "voteAverage": 8.2, "voteCount": 25000, "popularity": 80 }),
        }
    }

    #[test]
    fn rafraichit_une_disponibilite_de_8_jours_dates_comprises() {
        let mut fiche = fiche_datee(8.0, Some(8.0), true);
        assert!(besoins(&fiche, maintenant_ms(), false).donnees);
        appliquer_donnees(&mut fiche, &donnees_simulees());
        assert_eq!(fiche.disponibilite.as_ref().unwrap()["flatrate"][0]["name"], "Netflix");
        assert_eq!(fiche.sortie.as_ref().unwrap()["theatrical"], "1999-06-23");
        assert!(!besoins(&fiche, maintenant_ms(), false).donnees);
    }

    #[test]
    fn ne_rappelle_pas_tmdb_pour_une_disponibilite_et_des_dates_de_2_jours() {
        assert_eq!(besoins(&fiche_datee(2.0, Some(2.0), true), maintenant_ms(), false), Besoins { synopsis: false, donnees: false });
    }

    #[test]
    fn va_chercher_la_bande_annonce_d_un_titre_qui_ne_l_a_jamais_cherchee() {
        assert!(besoins(&fiche_datee(2.0, Some(2.0), false), maintenant_ms(), false).donnees);
    }

    #[test]
    fn va_chercher_les_dates_d_un_titre_qui_n_en_a_pas_encore() {
        let mut fiche = fiche_datee(2.0, None, true);
        assert!(besoins(&fiche, maintenant_ms(), false).donnees);
        appliquer_donnees(&mut fiche, &donnees_simulees());
        assert_eq!(fiche.sortie.as_ref().unwrap()["kind"], "movie");
    }

    #[test]
    fn a_l_ajout_d_un_titre_deja_au_catalogue_les_caracteristiques_absentes_sont_cherchees() {
        let fiche = fiche_datee(2.0, Some(2.0), true);
        assert!(!besoins(&fiche, maintenant_ms(), false).donnees);
        assert!(besoins(&fiche, maintenant_ms(), true).donnees);
    }

    #[test]
    fn la_duree_de_vie_est_de_7_jours_pile() {
        let maintenant = maintenant_ms();
        let a = |jours: f64| json!({ "fetchedAt": iso((maintenant - jours * JOUR) as i64) });
        assert!(!crate::tmdb::temps::perime(Some(&a(7.0)), maintenant) && crate::tmdb::temps::perime(Some(&a(7.0 + 1.0 / 86_400.0)), maintenant));
        assert_eq!(TTL_MS, 7.0 * JOUR);
    }

    #[test]
    fn la_fiche_ajoutee_porte_les_proprietes_tmdb() {
        // « insertItem (AC-2 ajout-item) » : mêmes valeurs, construites depuis les réponses de TMDB.
        let details = Details {
            tmdb_id: 603,
            type_: "Movie",
            titre: "The Matrix".into(),
            annee: Some("1999".into()),
            affiche: Some("/poster.jpg".into()),
            note: Number::from_f64(8.2),
            votes: Some(23_000.into()),
            imdb_id: Some("tt0133093".into()),
            genres: vec![json!("Action"), json!("Science-Fiction")],
            realisation: Some("Lana Wachowski, Lilly Wachowski".into()),
        };
        let mut donnees = donnees_simulees();
        donnees.caracteristiques = json!({ "genres": ["Action", "Science Fiction"], "keywords": ["simulated reality"],
            "cast": [{ "id": 6384, "name": "Keanu Reeves", "profilePath": "/keanu.jpg" }], "directors": [{ "id": 9340, "name": "Lana Wachowski", "profilePath": null }],
            "year": 1999, "runtime": 136, "language": "en", "countries": ["US"], "voteAverage": 8.2, "voteCount": 24000, "popularity": 80 });
        let fiche = fiche_ajoutee(&details, Some(&fr("", "Un programmeur découvre que la réalité est une simulation.", 8.2, 24_000)), Some(&donnees));
        assert_eq!(fiche.nom, "The Matrix");
        assert_eq!((fiche.annee.as_deref(), fiche.affiche.as_deref(), fiche.note), (Some("1999"), Some("/poster.jpg"), Some(8.2)));
        assert_eq!(fiche.synopsis.as_deref(), Some("Un programmeur découvre que la réalité est une simulation."));
        assert_eq!(fiche.votes, Some(24_000));
        assert_eq!(fiche.disponibilite.as_ref().unwrap()["flatrate"][0]["name"], "Netflix");
        assert_eq!(fiche.caracteristiques.as_ref().unwrap()["cast"][0], json!({ "id": 6384, "name": "Keanu Reeves", "profilePath": "/keanu.jpg" }));
        // Sans réponse française ni appel groupé : titre TMDB, synopsis vide, votes de la fiche, données nulles.
        let sans = fiche_ajoutee(&Details { genres: vec![], ..details }, None, None);
        assert_eq!((sans.synopsis.as_deref(), sans.votes, &sans.genres, &sans.disponibilite), (Some(""), Some(23_000), &None, &None));
    }

    #[test]
    fn le_rafraichissement_garde_ce_que_tmdb_n_a_pas_rendu() {
        let actuelle = Fiche { title_id: Some(1), tmdb_id: Some(603), type_: "Movie".into(), nom: "Ancien".into(), synopsis: Some("Ancien synopsis".into()),
            affiche: Some("/a.jpg".into()), genres: Some(json!(["Drama"])), note: Some(7.0), votes: Some(10), ..Fiche::default() };
        assert_eq!(fiche_rafraichie(&actuelle, None, None, None), None);
        let f = fiche_rafraichie(&actuelle, None, Some(&fr("", "Nouveau", 8.0, 20)), None).unwrap();
        assert_eq!((f.nom.as_str(), f.synopsis.as_deref(), f.votes, f.affiche.as_deref(), &f.genres), ("Ancien", Some("Nouveau"), Some(20), Some("/a.jpg"), &Some(json!(["Drama"]))));
    }
}
