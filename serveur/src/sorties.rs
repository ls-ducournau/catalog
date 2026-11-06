//! Sorties : portage de `src/lib/calendar.ts` (`eventsOf`), de `calendarService.ts` et de `GET /api/calendar`
//! (specs/sorties-v1.md FR-3 à FR-6 ter, NFR-2). Les fonctions de calendar.ts qui ne servent qu'à la page
//! (semaines, libellés, tranches) restent dans l'interface.
//!
//! NFR-2 : les dates des titres de la bibliothèque qui peuvent encore bouger sont rafraîchies par lots (60 au
//! plus par visite). La v1 les écrivait dans sa base ; ici, dans la fiche du CATALOGUE PARTAGÉ (`release_info`,
//! `release_fetched_at`), avec le pool du serveur (jamais la transaction de l'utilisateur) et seulement avec
//! la réponse de TMDB (specs/catalog-v2-donnees.md 4.7).
use crate::{
    auth::Utilisateur,
    bd::{self, Tx},
    decouverte::{self, PARALLELE, cle_tmdb},
    erreur::Erreur,
    js,
    preference,
    tmdb_decouverte::{self as tmdb, Resultat},
};
use axum::{
    Json,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Map, Value, json};
use sqlx::Row;
use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
};

pub const JOURS_PASSES: i64 = 30;
pub const JOURS_FUTURS_MAX: i64 = 400;
pub const TRANCHE_MAX_JOURS: f64 = 70.0;
const RAFRAICHISSEMENT_LOT: usize = 60;
const LISTES_DUREE_MS: i64 = js::JOUR_MS;
const DATES_DUREE_MS: i64 = 7 * js::JOUR_MS;
const PEUT_CHANGER: [&str; 5] = ["Returning Series", "In Production", "Planned", "Post Production", "Pilot"];

/// `new Date("2026-10-09T12:34:56.789Z").getTime()` pour les dates écrites par `toISOString` ; `None` = NaN.
pub fn instant_iso(texte: &str) -> Option<i64> {
    let jour = js::date_iso(texte.get(..10)?)?;
    let reste = texte.get(10..)?;
    if reste.is_empty() {
        return Some(jour);
    }
    let reste = reste.strip_prefix('T')?.strip_suffix('Z')?;
    let (hms, ms) = reste.split_once('.').map_or((reste, "0"), |(a, b)| (a, b));
    let p: Vec<i64> = hms.split(':').map(|x| x.parse::<i64>().ok().filter(|_| x.len() == 2)).collect::<Option<_>>()?;
    let ms: i64 = if ms.bytes().all(|b| b.is_ascii_digit()) && !ms.is_empty() { format!("{ms:0<3}")[..3].parse().ok()? } else { return None };
    if p.len() != 3 || p[0] > 24 || p[1] > 59 || p[2] > 59 {
        return None;
    }
    Some(jour + p[0] * 3_600_000 + p[1] * 60_000 + p[2] * 1000 + ms)
}

/// FR-3, AC-5 (`eventsOf`) : événements datés d'un titre dans [de, a] ; la sortie numérique sur demande.
pub fn evenements(sortie: Option<&Value>, de: &str, a: &str, numerique: bool) -> Vec<(String, &'static str, Option<Value>)> {
    let Some(s) = sortie.filter(|s| s.is_object()) else { return vec![] };
    let dans = |d: Option<&Value>| d.and_then(Value::as_str).filter(|d| *d >= de && *d <= a).map(str::to_owned);
    let mut e = vec![];
    if s.get("kind").and_then(Value::as_str) == Some("movie") {
        if let Some(d) = dans(s.get("theatrical")) {
            e.push((d, "theatrical", None));
        }
        if numerique
            && let Some(d) = dans(s.get("digital")) {
                e.push((d, "digital", None));
            }
        return e;
    }
    if let Some(d) = dans(s.get("firstAir")) {
        e.push((d, "series_premiere", None));
    }
    // La saison 1 d'une série, c'est sa première diffusion : déjà comptée.
    if let Some(n) = s.get("nextEpisode").filter(|n| n.is_object()) {
        let premier = n.get("episode").and_then(Value::as_f64) == Some(1.0);
        let saison = n.get("season").and_then(Value::as_f64).filter(|x| *x > 1.0);
        if let (true, Some(_), Some(d)) = (premier, saison, dans(n.get("date"))) {
            e.push((d, "season_premiere", n.get("season").cloned()));
        }
    }
    e
}

/// `clampWindow` : pas plus de 30 jours en arrière, ni plus de 400 devant ; une tranche de 70 jours au plus.
pub fn borner(de: &str, a: &str, aujourd_hui: i64) -> Option<(String, String)> {
    if js::date_iso(de).is_none() || js::date_iso(a).is_none() || de > a {
        return None;
    }
    let plus_tot = js::jour_utc(aujourd_hui - JOURS_PASSES * js::JOUR_MS);
    let plus_tard = js::jour_utc(aujourd_hui + JOURS_FUTURS_MAX * js::JOUR_MS);
    let debut = if de < plus_tot.as_str() { plus_tot.clone() } else { de.to_owned() };
    let fin = if a > plus_tard.as_str() { plus_tard.clone() } else { a.to_owned() };
    if debut > fin {
        return None;
    }
    let etendue = (js::date_iso(&fin)? - js::date_iso(&debut)?) as f64 / js::JOUR_MS as f64;
    (etendue <= TRANCHE_MAX_JOURS).then_some((debut, fin))
}

/// `isReleaseStale` : jamais récupérée, ou il y a plus de 7 jours (une date illisible n'est jamais périmée).
fn perimee(sortie: Option<&Value>, maintenant: i64) -> bool {
    let Some(s) = sortie else { return true };
    match s.get("fetchedAt").and_then(Value::as_str).and_then(instant_iso) {
        Some(quand) => maintenant - quand > DATES_DUREE_MS,
        None => false,
    }
}

/// NFR-2 : les dates qui peuvent encore bouger (série qui continue, film pas encore sorti, statut annoncé).
fn a_rafraichir(sortie: Option<&Value>, de: &str, maintenant: i64) -> bool {
    if !perimee(sortie, maintenant) {
        return false;
    }
    let Some(s) = sortie else { return true };
    let statut = s.get("status");
    let annonce = |v: Option<&Value>| v.and_then(Value::as_str).is_some_and(|x| PEUT_CHANGER.contains(&x));
    if s.get("kind").and_then(Value::as_str) == Some("tv") {
        return statut == Some(&Value::Null) || annonce(statut);
    }
    let salle = s.get("theatrical");
    salle == Some(&Value::Null) || salle.and_then(Value::as_str).is_some_and(|t| t >= de) || annonce(statut)
}

struct Ligne {
    id: i64,
    titre_id: Option<i64>,
    nom: String,
    type_: String,
    tmdb_id: i64,
    affiche: Option<String>,
    synopsis: Option<String>,
    statut: Option<String>,
    genres: Option<Value>,
    sortie: Option<Value>,
    bande_annonce: Option<Value>,
}

/// Listes TMDB d'une tranche, avec l'instant où elles ont été lues.
type ListesDatees = HashMap<String, (Vec<Resultat>, i64)>;
static LISTES: Mutex<Option<ListesDatees>> = Mutex::new(None);

/// FR-6 ter : les titres les plus populaires de la tranche (films en salle en France, nouvelles séries, séries
/// qui diffusent), gardés une journée ; une liste vide n'est pas gardée.
async fn listes_de_sorties(de: &str, a: &str) -> Vec<Resultat> {
    let cle = format!("{de}|{a}");
    let maintenant = js::maintenant_ms();
    if let Some((r, quand)) = LISTES.lock().ok().and_then(|c| c.as_ref().and_then(|c| c.get(&cle).cloned()))
        && maintenant - quand < LISTES_DUREE_MS {
            return r;
        }
    let etendue = (js::date_iso(a).unwrap_or(0) - js::date_iso(de).unwrap_or(0)) as f64 / js::JOUR_MS as f64;
    let pages_films = if etendue > 40.0 { 2 } else { 1 };
    let mut demandes: Vec<(bool, i64, bool)> = (1..=pages_films).map(|p| (true, p, false)).collect();
    demandes.extend([(false, 1, false), (false, 1, true)]);
    let (de2, a2) = (de.to_owned(), a.to_owned());
    let listes = decouverte::en_parallele(demandes, 4, move |(film, page, diffusion)| {
        let (d, f) = (de2.clone(), a2.clone());
        async move { tmdb::decouvrir_sorties(film, &d, &f, page, diffusion).await }
    })
    .await;
    let mut vus = HashSet::new();
    let resultats: Vec<Resultat> = listes.into_iter().flatten().filter(|r| vus.insert(format!("{}:{}", r.type_, r.tmdb_id))).collect();
    if !resultats.is_empty()
        && let Ok(mut c) = LISTES.lock() {
            c.get_or_insert_with(HashMap::new).insert(cle, (resultats.clone(), js::maintenant_ms()));
        }
    resultats
}

fn entree(cle: String, date: String, ev: &str, saison: Option<Value>, champs: Vec<(&str, Value)>, bande: Option<Value>) -> Value {
    let mut o = Map::new();
    o.insert("key".into(), json!(cle));
    o.insert("date".into(), json!(date));
    o.insert("event".into(), json!(ev));
    o.insert("season".into(), saison.unwrap_or(Value::Null));
    for (k, v) in champs {
        o.insert(k.into(), v);
    }
    // `parseTrailer` : la clé `trailer` du JSON, absente si elle manque (comme `undefined` en v1).
    if let Some(b) = bande {
        o.insert("trailer".into(), b);
    }
    Value::Object(o)
}

/// FR-3 à FR-5, FR-6 ter (`getCalendar`) : les sorties d'une tranche.
async fn calendrier(tx: &mut Tx, u: &Utilisateur, de: &str, a: &str) -> Result<Value, Erreur> {
    let maintenant = js::maintenant_ms();
    let lignes = sqlx::query(
        "select id, title_id, name, type, tmdb_id, poster_path, overview, watch_status, genres, release_info, trailer_info
           from public.library_view where tmdb_id is not null order by id",
    )
    .persistent(false)
    .fetch_all(&mut ***tx)
    .await?;
    let mut lignes: Vec<Ligne> = lignes
        .iter()
        .map(|l| {
            Ok(Ligne {
                id: l.try_get("id")?,
                titre_id: l.try_get("title_id")?,
                nom: l.try_get("name")?,
                type_: l.try_get("type")?,
                tmdb_id: i64::from(l.try_get::<i32, _>("tmdb_id")?),
                affiche: l.try_get("poster_path")?,
                synopsis: l.try_get("overview")?,
                statut: l.try_get("watch_status")?,
                genres: l.try_get("genres")?,
                sortie: l.try_get::<Option<Value>, _>("release_info")?.filter(|v| !v.is_null()),
                bande_annonce: l.try_get::<Option<Value>, _>("trailer_info")?.filter(|v| !v.is_null()),
            })
        })
        .collect::<Result<_, sqlx::Error>>()?;

    // NFR-2 : rafraîchit par lots les dates qui peuvent encore bouger (catalogue partagé, rôle du serveur).
    let perimes: Vec<usize> = lignes.iter().enumerate().filter(|(_, l)| a_rafraichir(l.sortie.as_ref(), de, maintenant)).map(|(i, _)| i).take(RAFRAICHISSEMENT_LOT).collect();
    let demandes: Vec<(usize, i64, bool)> = perimes.iter().map(|i| (*i, lignes[*i].tmdb_id, lignes[*i].type_ == "Movie")).collect();
    let neuves = decouverte::en_parallele(demandes, PARALLELE, |(i, id, film)| async move { (i, tmdb::sortie(id, film).await) }).await;
    for (i, neuve) in neuves {
        let Some(neuve) = neuve else { continue };
        if let Some(titre_id) = lignes[i].titre_id {
            let quand = neuve.get("fetchedAt").and_then(Value::as_str).and_then(instant_iso).map(|m| m as f64 / 1000.0);
            sqlx::query("update public.catalog_titles set release_info = $1, release_fetched_at = to_timestamp($2) where id = $3")
                .bind(&neuve)
                .bind(quand)
                .bind(titre_id)
                .persistent(false)
                .execute(bd::pool().await?)
                .await?;
        }
        lignes[i].sortie = Some(neuve);
    }

    let mut entrees: Vec<Value> = vec![];
    let mut dans_bibliotheque: HashSet<String> = HashSet::new();
    for l in &lignes {
        dans_bibliotheque.insert(cle_tmdb(&l.type_, l.tmdb_id));
        // Un film déjà vu n'a plus de sortie à attendre ; une série vue peut revenir.
        if l.type_ == "Movie" && l.statut.as_deref() == Some("Watched") {
            continue;
        }
        let genres: Vec<Value> = l.genres.as_ref().and_then(Value::as_array).map(|g| g.iter().filter(|x| x.is_string()).cloned().collect()).unwrap_or_default();
        let documentaire = genres.iter().any(|g| g == "Documentary");
        for (date, ev, saison) in evenements(l.sortie.as_ref(), de, a, true) {
            let cle = format!("{}:{}:{ev}:{}", l.type_, l.tmdb_id, saison.as_ref().map(|s| preference::texte_js(Some(s))).unwrap_or_default());
            entrees.push(entree(
                cle,
                date,
                ev,
                saison,
                vec![
                    ("tmdbId", json!(l.tmdb_id)),
                    ("mediaType", json!(l.type_)),
                    ("isDocumentary", json!(documentaire)),
                    ("genres", json!(genres)),
                    ("title", json!(l.nom)),
                    ("posterUrl", json!(tmdb::url_affiche(l.affiche.as_deref()))),
                    ("overview", json!(l.synopsis.clone().unwrap_or_default())),
                    ("libraryId", json!(l.id)),
                    ("libraryStatus", json!(l.statut)),
                    ("compatibility", Value::Null),
                ],
                // `parseTrailer` : null sans fiche de bande-annonce ; la clé `trailer` du JSON sinon (absente s'il n'en a pas).
                match &l.bande_annonce {
                    None => Some(Value::Null),
                    Some(b) => b.get("trailer").cloned(),
                },
            ));
        }
    }

    // Compatibilité des titres de ta pile (pas des séries déjà vues : tu les as notées).
    let gout = preference::gout(tx, u).await?;
    let avis = preference::poids_des_avis(tx).await?;
    let mut pile: Vec<i64> = vec![];
    for e in &entrees {
        if e["libraryStatus"] != "Watched"
            && let Some(id) = e["libraryId"].as_i64().filter(|id| !pile.contains(id)) {
                pile.push(id);
            }
    }
    if !pile.is_empty() {
        let titres = preference::charger_titres(tx, "id = any($1)", Some(&pile)).await?;
        let compat: HashMap<i64, Option<f64>> = preference::classer(&gout, &titres, &avis).into_iter().map(|s| (s.id, s.compatibilite)).collect();
        for e in entrees.iter_mut().filter(|e| e["libraryStatus"] != "Watched") {
            let c = e["libraryId"].as_i64().and_then(|id| compat.get(&id).copied().flatten());
            e["compatibility"] = json!(c);
        }
    }

    // Le reste : sorties en salle en France et nouvelles séries, hors bibliothèque.
    let ecartes = decouverte::tmdb_ecartes(tx).await?;
    let listes = listes_de_sorties(de, a).await;
    let externes: Vec<Resultat> = listes.iter().filter(|r| !dans_bibliotheque.contains(&cle_tmdb(r.type_, r.tmdb_id)) && !ecartes.contains(&cle_tmdb(r.type_, r.tmdb_id))).cloned().collect();
    let fiches = decouverte::en_parallele(externes.iter().map(|r| (r.tmdb_id, r.type_)).collect(), PARALLELE, |(id, t)| decouverte::donnees_externes(id, t)).await;
    let avec_fiche: Vec<(&Resultat, &std::sync::Arc<tmdb::DonneesTitre>)> = externes.iter().zip(&fiches).filter_map(|(r, f)| f.as_ref().map(|f| (r, f))).collect();
    let titres: Vec<crate::modele::TitreModele> = avec_fiche.iter().map(|(r, f)| preference::titre_de_caracteristiques(-r.tmdb_id, &r.titre, &f.caracteristiques)).collect();
    let compat: HashMap<String, Option<f64>> =
        preference::classer(&gout, &titres, &avis).into_iter().enumerate().map(|(i, s)| (cle_tmdb(avec_fiche[i].0.type_, avec_fiche[i].0.tmdb_id), s.compatibilite)).collect();
    for (r, f) in externes.iter().zip(&fiches) {
        let cle = cle_tmdb(r.type_, r.tmdb_id);
        // Les dates exactes (sortie française) viennent de la fiche ; sans elle, on ne devine pas.
        for (date, ev, saison) in evenements(f.as_ref().map(|f| &f.sortie), de, a, false) {
            let cle_entree = format!("{}:{}:{ev}:{}", r.type_, r.tmdb_id, saison.as_ref().map(|s| preference::texte_js(Some(s))).unwrap_or_default());
            entrees.push(entree(
                cle_entree,
                date,
                ev,
                saison,
                vec![
                    ("tmdbId", json!(r.tmdb_id)),
                    ("mediaType", json!(r.type_)),
                    ("isDocumentary", json!(r.documentaire)),
                    ("genres", f.as_ref().map(|f| f.caracteristiques["genres"].clone()).unwrap_or(json!([]))),
                    ("title", json!(r.titre)),
                    ("posterUrl", json!(tmdb::url_affiche(r.affiche.as_deref()))),
                    ("overview", json!(r.synopsis)),
                    ("libraryId", Value::Null),
                    ("libraryStatus", Value::Null),
                    ("compatibility", json!(compat.get(&cle).copied().flatten())),
                ],
                Some(f.as_ref().map(|f| f.bande_annonce["trailer"].clone()).unwrap_or(Value::Null)),
            ));
        }
    }
    Ok(json!({ "from": de, "to": a, "entries": entrees, "baseRate": preference::taux_de_base(&gout), "externalUnavailable": listes.is_empty() }))
}

/// GET /api/calendar?from=AAAA-MM-JJ&to=AAAA-MM-JJ
pub async fn route(utilisateur: Utilisateur, Query(p): Query<HashMap<String, String>>) -> Result<Response, Erreur> {
    let Some((de, a)) = borner(p.get("from").map(String::as_str).unwrap_or(""), p.get("to").map(String::as_str).unwrap_or(""), js::maintenant_ms()) else {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid_request" }))).into_response());
    };
    let mut tx = bd::transaction(&utilisateur).await?;
    let corps = calendrier(&mut tx, &utilisateur, &de, &a).await?;
    tx.valider().await?;
    Ok(Json(corps).into_response())
}

#[cfg(test)]
mod tests {
    //! Tests de src/lib/calendar.test.ts pour `eventsOf` (sorties-v1 FR-3), mêmes cas ; `groupByWeek` et
    //! `calendarWindows` servent à la page et restent dans l'interface. Plus les bornes de `clampWindow`.
    use super::*;

    const DE: &str = "2026-08-27";
    const A: &str = "2026-12-25";

    fn base() -> Value {
        json!({ "kind": "movie", "theatrical": null, "digital": null, "firstAir": null, "nextEpisode": null, "status": null, "fetchedAt": "2026-09-26T10:00:00.000Z" })
    }
    fn avec(mut v: Value, champs: Value) -> Value {
        for (k, x) in champs.as_object().unwrap() {
            v[k] = x.clone();
        }
        v
    }
    fn ev(e: &[(String, &str, Option<Value>)]) -> Vec<(String, String, Value)> {
        e.iter().map(|(d, n, s)| (d.clone(), n.to_string(), s.clone().unwrap_or(Value::Null))).collect()
    }

    #[test]
    fn sortie_en_salle_et_numerique_sur_demande() {
        let film = avec(base(), json!({ "theatrical": "2026-10-16", "digital": "2026-12-20" }));
        assert_eq!(ev(&evenements(Some(&film), DE, A, false)), vec![("2026-10-16".into(), "theatrical".into(), Value::Null)]);
        assert_eq!(evenements(Some(&film), DE, A, true).iter().map(|e| e.1).collect::<Vec<_>>(), vec!["theatrical", "digital"]);
    }

    #[test]
    fn ignore_ce_qui_sort_de_la_periode() {
        assert!(evenements(Some(&avec(base(), json!({ "theatrical": "2025-01-10" }))), DE, A, false).is_empty());
    }

    #[test]
    fn nouvelle_saison_mais_pas_deux_fois_la_premiere() {
        let revient = avec(base(), json!({ "kind": "tv", "firstAir": "2019-07-26", "nextEpisode": { "date": "2026-10-08", "season": 5, "episode": 1 } }));
        assert_eq!(ev(&evenements(Some(&revient), DE, A, false)), vec![("2026-10-08".into(), "season_premiere".into(), json!(5))]);
        let neuve = avec(base(), json!({ "kind": "tv", "firstAir": "2026-11-02", "nextEpisode": { "date": "2026-11-02", "season": 1, "episode": 1 } }));
        assert_eq!(ev(&evenements(Some(&neuve), DE, A, false)), vec![("2026-11-02".into(), "series_premiere".into(), Value::Null)]);
    }

    #[test]
    fn pas_un_episode_de_milieu_de_saison() {
        let en_cours = avec(base(), json!({ "kind": "tv", "firstAir": "2020-01-01", "nextEpisode": { "date": "2026-10-01", "season": 3, "episode": 6 } }));
        assert!(evenements(Some(&en_cours), DE, A, false).is_empty());
    }

    #[test]
    fn la_tranche_est_bornee() {
        let aujourd_hui = js::date_utc(2026, 8, 26) + 10 * 3_600_000; // 2026-09-26 10 h UTC
        assert_eq!(borner("2026-09-26", "2026-10-10", aujourd_hui), Some(("2026-09-26".into(), "2026-10-10".into())));
        assert_eq!(borner("2026-01-01", "2026-09-30", aujourd_hui), Some(("2026-08-27".into(), "2026-09-30".into())));
        assert_eq!(borner("2026-09-26", "2027-01-01", aujourd_hui), None); // plus de 70 jours
        assert_eq!(borner("2026-10-10", "2026-09-26", aujourd_hui), None);
        assert_eq!(borner("", "2026-09-26", aujourd_hui), None);
        assert_eq!(borner("2026-13-01", "2026-12-01", aujourd_hui), None);
        assert_eq!(borner("2026-09-26", "2026-09-31", aujourd_hui), Some(("2026-09-26".into(), "2026-09-31".into())));
    }

    #[test]
    fn instant_comme_new_date() {
        assert_eq!(instant_iso("2025-10-28T14:01:41.409Z"), Some(1761660101409));
        assert_eq!(instant_iso("2025-10-28"), Some(js::date_iso("2025-10-28").unwrap()));
        assert_eq!(instant_iso("bientôt"), None);
    }

    #[test]
    fn rafraichit_ce_qui_peut_encore_bouger() {
        let maintenant = instant_iso("2026-11-06T12:00:00.000Z").unwrap();
        let vieux = "2026-10-01T00:00:00.000Z";
        assert!(a_rafraichir(None, DE, maintenant));
        assert!(a_rafraichir(Some(&json!({ "kind": "tv", "status": "Returning Series", "fetchedAt": vieux })), DE, maintenant));
        assert!(!a_rafraichir(Some(&json!({ "kind": "tv", "status": "Ended", "fetchedAt": vieux })), DE, maintenant));
        assert!(!a_rafraichir(Some(&json!({ "kind": "tv", "status": "Returning Series", "fetchedAt": "2026-11-05T00:00:00.000Z" })), DE, maintenant));
        assert!(a_rafraichir(Some(&json!({ "kind": "movie", "theatrical": "2026-12-01", "status": "Released", "fetchedAt": vieux })), DE, maintenant));
        assert!(!a_rafraichir(Some(&json!({ "kind": "movie", "theatrical": "2020-12-01", "status": "Released", "fetchedAt": vieux })), DE, maintenant));
        // Sans date lisible, jamais périmée (`now - NaN > TTL` est faux).
        assert!(!a_rafraichir(Some(&json!({ "kind": "tv", "status": null })), DE, maintenant));
    }
}
