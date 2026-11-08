//! « À découvrir » : portage de `src/lib/discoveryService.ts` et de `GET /api/recommendations/discover`
//! (recommendations-v1 v1.2, v1.3 FR-27 ; sorties-v1 FR-7 ; fraîcheur FR-9). Semences tirées parmi tes
//! titres les mieux notés, titres proches selon TMDB, reclassement par ton modèle, lassitude, diversité.
//!
//! Hasard : les 6 semences sont tirées au hasard à chaque calcul (FR-16). Pour comparer la v1 et la v2 à
//! semences égales, la variable d'environnement `CATALOG_GRAINE_HASARD` (absente en production) fixe le
//! tirage (mulberry32, repris à chaque calcul, comme la copie de parité de la v1).
use crate::{
    auth::Utilisateur,
    bd::{self, Tx},
    erreur::Erreur,
    faconnage::{self, Ancre, CandidatRangee},
    js,
    modele::TitreModele,
    preference::{self, Gout},
    reglages,
    tmdb_decouverte::{self as tmdb, DonneesTitre, Resultat},
};
use axum::{Json, extract::Query};
use serde_json::{Map, Value, json};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};

const SEMENCES_VIVIER: i64 = 20;
const SEMENCE_NOTE_MIN: i32 = 4;
const RECLASSEMENT_MIN: f64 = 40.0;
const RECLASSEMENT_MAX: f64 = 72.0;
const BONUS_SEMENCE: f64 = 0.75;
pub const PARALLELE: usize = 8;
const SEMENCES: usize = 6;
const VOTES_MIN: f64 = 120.0;

// ---------- utilitaires partagés (Ce soir, Sorties) ----------

/// Exécute `travail` sur chaque élément, `n` à la fois ; résultats dans l'ordre des éléments.
pub async fn en_parallele<T, R, F, Fut>(elements: Vec<T>, n: usize, travail: F) -> Vec<R>
where
    T: Send + 'static,
    R: Send + 'static,
    F: Fn(T) -> Fut,
    Fut: std::future::Future<Output = R> + Send + 'static,
{
    let semaphore = Arc::new(tokio::sync::Semaphore::new(n.max(1)));
    let mut taches = tokio::task::JoinSet::new();
    let total = elements.len();
    for (i, e) in elements.into_iter().enumerate() {
        let s = semaphore.clone();
        let f = travail(e);
        taches.spawn(async move {
            let _jeton = s.acquire_owned().await;
            (i, f.await)
        });
    }
    let mut resultats: Vec<Option<R>> = (0..total).map(|_| None).collect();
    while let Some(Ok((i, r))) = taches.join_next().await {
        resultats[i] = Some(r);
    }
    resultats.into_iter().flatten().collect()
}

/// Fiches TMDB hors bibliothèque, avec l'instant où elles ont été lues.
type FichesDatees = HashMap<String, (Option<Arc<DonneesTitre>>, i64)>;
static EXTERNES: Mutex<Option<FichesDatees>> = Mutex::new(None);
const EXTERNES_DUREE_MS: i64 = 7 * js::JOUR_MS;

/// `externalTitleData` : fiche TMDB d'un titre hors bibliothèque, gardée 7 jours en mémoire (échecs compris),
/// partagée avec Ce soir et le calendrier.
pub async fn donnees_externes(tmdb_id: i64, type_: &'static str) -> Option<Arc<DonneesTitre>> {
    let cle = format!("{type_}:{tmdb_id}");
    let maintenant = js::maintenant_ms();
    if let Some((d, quand)) = EXTERNES.lock().ok().and_then(|c| c.as_ref().and_then(|c| c.get(&cle).cloned()))
        && maintenant - quand < EXTERNES_DUREE_MS {
            return d;
        }
    let d = tmdb::donnees_titre(tmdb_id, type_ == "Movie").await.map(Arc::new);
    if let Ok(mut c) = EXTERNES.lock() {
        c.get_or_insert_with(HashMap::new).insert(cle, (d.clone(), js::maintenant_ms()));
    }
    d
}

/// `getLibraryInfoByTmdbIds` : identifiant et statut par numéro TMDB (film ou série confondus, le dernier
/// titre de la bibliothèque l'emporte, comme la v1).
pub async fn bibliotheque_par_tmdb(tx: &mut Tx, ids: &[i64]) -> Result<HashMap<i64, (i64, Option<String>)>, Erreur> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let lignes: Vec<(i64, i32, Option<String>)> =
        sqlx::query_as("select id, tmdb_id, watch_status from public.library_view where tmdb_id = any($1) order by id").bind(ids.iter().map(|i| *i as i32).collect::<Vec<_>>()).persistent(false).fetch_all(&mut ***tx).await?;
    Ok(lignes.into_iter().map(|(id, t, s)| (i64::from(t), (id, s))).collect())
}

/// `dismissedTmdbKeys`.
pub async fn tmdb_ecartes(tx: &mut Tx) -> Result<HashSet<String>, Erreur> {
    let l: Vec<(String,)> = sqlx::query_as("select subject_id from public.dismissals where subject_type = 'tmdb'").persistent(false).fetch_all(&mut ***tx).await?;
    Ok(l.into_iter().map(|r| r.0).collect())
}

/// `tmdbKey` : « movie:603 », « tv:1399 » (celle des titres écartés, `ecartes.rs`).
pub use crate::ecartes::cle_tmdb;

// ---------- découvertes ----------

#[derive(Clone, Debug)]
pub struct Decouverte {
    pub r: Resultat,
    pub semences: Vec<String>,
    pub disponibilite: Option<Value>,
    pub compatibilite: Option<f64>,
    pub sortie: Option<Value>,
    pub duree: Option<Value>,
    pub bande_annonce: Option<Value>,
}

impl Decouverte {
    /// `DiscoveredItem`.
    pub fn json(&self) -> Value {
        json!({
            "tmdbId": self.r.tmdb_id, "type": self.r.type_, "title": self.r.titre, "year": self.r.annee,
            "posterUrl": tmdb::url_affiche(self.r.affiche.as_deref()), "voteAverage": self.r.note_moyenne, "voteCount": self.r.votes,
            "isDocumentary": self.r.documentaire, "overview": self.r.synopsis, "seeds": self.semences,
            "availability": self.disponibilite, "compatibility": self.compatibilite, "release": self.sortie,
            "runtime": self.duree, "trailer": self.bande_annonce,
        })
    }
}

/// FR-18, FR-19 : fusionne les retours des semences (`mergeDiscoveries`).
pub fn fusionner(lots: &[(String, Vec<Resultat>)], exclus: &HashSet<i64>, votes_min: f64, categorie: Option<&str>) -> Vec<Decouverte> {
    let mut ordre: Vec<i64> = vec![];
    let mut fusion: HashMap<i64, Decouverte> = HashMap::new();
    for (semence, resultats) in lots {
        for r in resultats {
            if exclus.contains(&r.tmdb_id) || r.votes.unwrap_or(0.0) < votes_min {
                continue;
            }
            match categorie {
                Some("Documentary") if !r.documentaire => continue,
                Some(c) if c != "Documentary" && (r.type_ != c || r.documentaire) => continue,
                _ => {}
            }
            if let Some(d) = fusion.get_mut(&r.tmdb_id) {
                if !d.semences.contains(semence) {
                    d.semences.push(semence.clone());
                }
                continue;
            }
            ordre.push(r.tmdb_id);
            fusion.insert(r.tmdb_id, Decouverte { r: r.clone(), semences: vec![semence.clone()], disponibilite: None, compatibilite: None, sortie: None, duree: None, bande_annonce: None });
        }
    }
    let mut liste: Vec<Decouverte> = ordre.into_iter().filter_map(|id| fusion.remove(&id)).collect();
    liste.sort_by(|a, b| {
        b.semences
            .len()
            .cmp(&a.semences.len())
            .then(b.r.votes.unwrap_or(0.0).partial_cmp(&a.r.votes.unwrap_or(0.0)).unwrap_or(std::cmp::Ordering::Equal))
            .then(b.r.note_moyenne.unwrap_or(0.0).partial_cmp(&a.r.note_moyenne.unwrap_or(0.0)).unwrap_or(std::cmp::Ordering::Equal))
    });
    liste
}

/// Tirage sans remise (`pickRandom`).
fn tirer<T: Clone>(vivier: &[T], n: usize, hasard: &mut dyn FnMut() -> f64) -> Vec<T> {
    let mut copie = vivier.to_vec();
    let mut tires = vec![];
    while tires.len() < n && !copie.is_empty() {
        let i = (hasard() * copie.len() as f64).floor() as usize;
        tires.push(copie.remove(i.min(copie.len() - 1)));
    }
    tires
}

/// Le hasard du tirage : à graine si `CATALOG_GRAINE_HASARD` est posée (comparaison avec la v1), sinon de l'horloge.
fn hasard() -> Box<dyn FnMut() -> f64 + Send> {
    if let Some(g) = std::env::var("CATALOG_GRAINE_HASARD").ok().and_then(|g| js::trim(&g).parse::<i32>().ok()) {
        return Box::new(crate::modele::mulberry32(g));
    }
    let mut x = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0x9E37_79B9_7F4A_7C15) | 1;
    Box::new(move || {
        x ^= x << 13;
        x ^= x >> 7;
        x ^= x << 17;
        (x >> 11) as f64 / (1u64 << 53) as f64
    })
}

fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN } else { a.min(b) }
}
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN } else { a.max(b) }
}

/// Reclassement des meilleurs candidats par le modèle (`rerankWithModel`), avec leurs fiches TMDB.
async fn reclasser(gout: &Gout, avis: &HashMap<i64, f64>, candidats: Vec<Decouverte>) -> Vec<Decouverte> {
    if candidats.is_empty() {
        return vec![];
    }
    let fiches: Vec<Option<Arc<DonneesTitre>>> = en_parallele(candidats.iter().map(|c| (c.r.tmdb_id, c.r.type_)).collect(), PARALLELE, |(id, t)| donnees_externes(id, t)).await;
    // Identifiants négatifs : un titre TMDB ne se confond jamais avec un titre de la bibliothèque.
    let titres: Vec<TitreModele> = candidats
        .iter()
        .zip(&fiches)
        .map(|(c, f)| match f {
            Some(f) => preference::titre_de_caracteristiques(-c.r.tmdb_id, &c.r.titre, &f.caracteristiques),
            None => TitreModele {
                id: -c.r.tmdb_id,
                nom: c.r.titre.clone(),
                annee: c.r.annee.as_deref().filter(|a| !a.is_empty()).map(js::nombre_ou_nan),
                note_moyenne: c.r.note_moyenne,
                votes: c.r.votes,
                ..Default::default()
            },
        })
        .collect();
    let classes = preference::classer(gout, &titres, avis);
    let scores: HashMap<i64, f64> = classes.iter().map(|s| (-s.id, s.score)).collect();
    let avec_fiche: HashSet<i64> = candidats.iter().zip(&fiches).filter(|(_, f)| f.is_some()).map(|(c, _)| c.r.tmdb_id).collect();
    let compatibilite: HashMap<i64, Option<f64>> = classes.iter().filter(|s| avec_fiche.contains(&-s.id)).map(|s| (-s.id, s.compatibilite)).collect();
    let mut liste: Vec<Decouverte> = candidats
        .into_iter()
        .zip(fiches)
        .map(|(mut c, f)| {
            c.disponibilite = f.as_ref().map(|f| f.disponibilite.clone());
            c.compatibilite = compatibilite.get(&c.r.tmdb_id).copied().flatten();
            c.sortie = f.as_ref().map(|f| f.sortie.clone());
            c.duree = f.as_ref().map(|f| f.caracteristiques["runtime"].clone()).filter(|v| !v.is_null());
            c.bande_annonce = f.as_ref().map(|f| f.bande_annonce["trailer"].clone()).filter(|v| !v.is_null());
            c
        })
        .collect();
    let score = |d: &Decouverte| scores.get(&d.r.tmdb_id).copied().unwrap_or(0.0) + BONUS_SEMENCE * (d.semences.len() as f64 - 1.0);
    liste.sort_by(|a, b| score(b).partial_cmp(&score(a)).unwrap_or(std::cmp::Ordering::Equal));
    liste
}

/// `getDiscoveries`. `Ok(None)` : aucun titre vu bien noté avec un numéro TMDB (AC-15, aucun appel TMDB).
pub async fn decouvertes(
    tx: &mut Tx,
    utilisateur: &Utilisateur,
    categorie: Option<&str>,
    limite: f64,
    services: Option<&HashSet<i64>>,
) -> Result<Option<(Vec<Decouverte>, Vec<String>)>, Erreur> {
    let mut qb = sqlx::QueryBuilder::<sqlx::Postgres>::new("select tmdb_id, type, name from public.library_view where watch_status = 'Watched' and tmdb_id is not null and rating >= ");
    qb.push_bind(SEMENCE_NOTE_MIN);
    crate::duels::categorie(&mut qb, categorie);
    qb.push(" order by rating desc, elo_score desc, id asc limit ").push_bind(SEMENCES_VIVIER);
    let vivier: Vec<(i32, String, String)> = qb.build_query_as().persistent(false).fetch_all(&mut ***tx).await?;
    if vivier.is_empty() {
        return Ok(None);
    }
    let semences: Vec<(i64, String, String)> = tirer(&vivier, SEMENCES, &mut *hasard()).into_iter().map(|(id, t, n)| (i64::from(id), t, n)).collect();
    let lots: Vec<(String, Vec<Resultat>)> =
        en_parallele(semences.clone(), SEMENCES, |(id, t, n)| async move { (n, tmdb::recommandes_pour(id, &t).await) }).await;

    let tous: Vec<i64> = lots.iter().flat_map(|(_, r)| r.iter().map(|x| x.tmdb_id)).collect();
    let dans_bibliotheque: HashSet<i64> = bibliotheque_par_tmdb(tx, &tous).await?.into_keys().collect();
    let ecartes = tmdb_ecartes(tx).await?;
    let fusion: Vec<Decouverte> =
        fusionner(&lots, &dans_bibliotheque, VOTES_MIN, categorie).into_iter().filter(|d| !ecartes.contains(&cle_tmdb(d.r.type_, d.r.tmdb_id))).collect();

    let taille = js_min(RECLASSEMENT_MAX, js_max(RECLASSEMENT_MIN, limite));
    let fin = js::fin_slice(taille, fusion.len());
    let debut_queue = js::debut_slice(taille, fusion.len());
    let tete: Vec<Decouverte> = fusion[..fin].to_vec();
    let queue: Vec<Decouverte> = fusion[debut_queue..].to_vec();
    let gout = preference::gout(tx, utilisateur).await?;
    let avis = preference::poids_des_avis(tx).await?;
    let exposition = preference::lassitude(tx, js::maintenant_ms()).await?;
    let reclasses = faconnage::appliquer_lassitude(reclasser(&gout, &avis, tete).await, |d| {
        exposition.get(&preference::cle_tmdb_exposition(d.r.type_, d.r.tmdb_id)).copied().unwrap_or(0.0)
    });
    let mut classes: Vec<Decouverte> = reclasses.into_iter().chain(queue).collect();
    if let Some(couverts) = services {
        classes.retain(|d| !reglages::inclus_dans(d.disponibilite.as_ref(), couverts).is_empty());
    }
    let variee = faconnage::diversifier(classes, |d| d.semences.first().cloned().unwrap_or_default(), faconnage::MAX_PAR_LOT);
    let fin = js::fin_slice(limite, variee.len());
    Ok(Some((variee.into_iter().take(fin).collect(), semences.into_iter().map(|s| s.2).collect())))
}

/// `discoveryKey`.
pub fn cle_decouverte(d: &Decouverte) -> String {
    format!("{}:{}", d.r.type_, d.r.tmdb_id)
}

/// sorties-v1 FR-7 : les rangées de la découverte (`discoveryRows`), les titres désignés par clé.
pub fn rangees(items: &[Decouverte], couverts: &HashSet<i64>, annee_courante: f64) -> Vec<Value> {
    let mut semences: HashMap<String, i64> = HashMap::new();
    let candidats: Vec<CandidatRangee> = items
        .iter()
        .enumerate()
        .map(|(i, d)| {
            let semence = d.semences.first().filter(|s| !s.is_empty());
            if let Some(s) = semence {
                let n = semences.len() as i64 + 1;
                semences.entry(s.clone()).or_insert(n);
            }
            CandidatRangee {
                id: i as i64,
                score: d.compatibilite.unwrap_or(0.0),
                film: d.r.type_ == "Movie",
                duree: d.duree.as_ref().and_then(Value::as_f64),
                annee: d.r.annee.as_deref().filter(|a| !a.is_empty()).map(js::nombre_ou_nan),
                votes: d.r.votes,
                sur_mes_abonnements: !reglages::inclus_dans(d.disponibilite.as_ref(), couverts).is_empty(),
                ancre: semence.map(|s| Ancre { id: semences[s], nom: s.clone(), etoiles: 5 }),
                exploration: false,
            }
        })
        .collect();
    faconnage::composer_rangees(&candidats, annee_courante, !couverts.is_empty())
        .into_iter()
        .map(|r| {
            let mut o = Map::new();
            o.insert("key".into(), json!(r.cle));
            o.insert("title".into(), json!(r.titre));
            if let Some(a) = r.ancre {
                o.insert("anchor".into(), json!(a));
            }
            o.insert("keys".into(), json!(r.ids.iter().map(|i| cle_decouverte(&items[*i as usize])).collect::<Vec<_>>()));
            Value::Object(o)
        })
        .collect()
}

/// La fiche d'une carte de bienvenue (specs/bienvenue-v1.md, FR-4) : bande-annonce, où le voir, durée,
/// réalisation et têtes d'affiche, tirées de la fiche TMDB gardée 7 jours.
pub fn fiche_carte(d: &DonneesTitre) -> Value {
    let noms = |cle: &str, n: usize| -> Vec<String> {
        d.caracteristiques
            .get(cle)
            .and_then(Value::as_array)
            .map(|l| l.iter().filter_map(|p| p.get("name").and_then(Value::as_str)).take(n).map(String::from).collect())
            .unwrap_or_default()
    };
    json!({
        "trailer": d.bande_annonce.get("trailer").cloned().unwrap_or(Value::Null),
        "availability": d.disponibilite.clone(),
        "runtime": d.caracteristiques.get("runtime").cloned().unwrap_or(Value::Null),
        "directors": noms("directors", 2),
        "cast": noms("cast", 4),
    })
}

/// GET /api/tmdb/title?tmdbId=&type= : la fiche d'un titre hors bibliothèque. Publique, comme la vitrine
/// (rien du compte) : un visiteur balaie des cartes sur la page d'arrivée.
pub async fn fiche(Query(p): Query<HashMap<String, String>>) -> axum::response::Response {
    use axum::{http::StatusCode, response::IntoResponse};
    let type_: Option<&'static str> = match p.get("type").map(String::as_str) {
        Some("Movie") => Some("Movie"),
        Some("TV Series") => Some("TV Series"),
        _ => None,
    };
    let tmdb_id = p.get("tmdbId").and_then(|v| v.parse::<i64>().ok()).filter(|n| *n > 0);
    let (Some(type_), Some(tmdb_id)) = (type_, tmdb_id) else {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid" }))).into_response();
    };
    match donnees_externes(tmdb_id, type_).await {
        Some(d) => Json(fiche_carte(&d)).into_response(),
        None => (StatusCode::BAD_GATEWAY, Json(json!({ "error": "tmdb_unavailable" }))).into_response(),
    }
}

/// GET /api/recommendations/discover?category=&limit=&onMyServices=1&rows=1
pub async fn route(utilisateur: Utilisateur, Query(p): Query<HashMap<String, String>>) -> Result<Json<Value>, Erreur> {
    let maintenant = js::maintenant_ms();
    let categorie = p.get("category").map(String::as_str).filter(|c| matches!(*c, "Movie" | "TV Series" | "Documentary"));
    let limite = p.get("limit").filter(|l| !l.is_empty()).map(|l| js::nombre_ou_nan(l)).unwrap_or(24.0);
    let sur_services = p.get("onMyServices").map(String::as_str) == Some("1");
    let avec_rangees = p.get("rows").map(String::as_str) == Some("1");
    let mut tx = bd::transaction(&utilisateur).await?;
    let couverts = if avec_rangees || sur_services { reglages::services_couverts(&mut tx).await? } else { HashSet::new() };
    let resultat = decouvertes(&mut tx, &utilisateur, categorie, limite, sur_services.then_some(&couverts)).await?;
    tx.valider().await?;
    let Some((items, semences)) = resultat else { return Ok(Json(json!({ "error": "not_enough_signal" }))) };
    let mut corps = json!({ "items": items.iter().map(Decouverte::json).collect::<Vec<_>>(), "seedsUsed": semences });
    if avec_rangees {
        corps["rows"] = json!(rangees(&items, &couverts, js::annee_paris(maintenant) as f64));
    }
    Ok(Json(corps))
}

#[cfg(test)]
mod tests {
    //! Tests de src/lib/discoveryService.test.ts (AC-12, AC-13, AC-14 ; sorties-v1 AC-6), mêmes cas.
    use super::*;

    #[test]
    fn la_fiche_d_une_carte_garde_l_essentiel() {
        let d = DonneesTitre {
            caracteristiques: json!({
                "runtime": 155,
                "directors": [{ "id": 1, "name": "Denis Villeneuve" }],
                "cast": [{ "id": 2, "name": "A" }, { "id": 3, "name": "B" }, { "id": 4, "name": "C" }, { "id": 5, "name": "D" }, { "id": 6, "name": "E" }],
            }),
            disponibilite: json!({ "link": null, "flatrate": [], "free": [], "ads": [], "rent": [], "buy": [], "fetchedAt": "2026-11-08" }),
            sortie: Value::Null,
            bande_annonce: json!({ "trailer": { "key": "abc", "language": "fr" }, "fetchedAt": "2026-11-08" }),
        };
        let f = fiche_carte(&d);
        assert_eq!(f["runtime"], 155);
        assert_eq!(f["directors"], json!(["Denis Villeneuve"]));
        assert_eq!(f["cast"].as_array().unwrap().len(), 4);
        assert_eq!(f["trailer"]["key"], "abc");
        assert_eq!(f["availability"]["flatrate"], json!([]));
    }

    fn resultat(tmdb_id: i64) -> Resultat {
        Resultat {
            tmdb_id,
            type_: "Movie",
            documentaire: false,
            genres: vec![],
            titre: format!("Titre {tmdb_id}"),
            annee: Some("2020".into()),
            affiche: None,
            note_moyenne: Some(7.0),
            votes: Some(5000.0),
            synopsis: String::new(),
        }
    }
    fn avec_votes(tmdb_id: i64, votes: f64) -> Resultat {
        Resultat { votes: Some(votes), ..resultat(tmdb_id) }
    }
    fn ids(d: &[Decouverte]) -> Vec<i64> {
        d.iter().map(|x| x.r.tmdb_id).collect()
    }

    #[test]
    fn ecarte_les_titres_deja_en_bibliotheque_ac12() {
        let lots = vec![("Whiplash".to_owned(), vec![resultat(10), resultat(11)])];
        assert_eq!(ids(&fusionner(&lots, &[10].into_iter().collect(), VOTES_MIN, None)), vec![11]);
    }

    #[test]
    fn deux_semences_passent_devant_un_titre_tres_populaire_ac13() {
        let lots = vec![("Whiplash".to_owned(), vec![avec_votes(10, 800.0)]), ("Sicario".to_owned(), vec![avec_votes(10, 800.0), avec_votes(20, 90000.0)])];
        assert_eq!(ids(&fusionner(&lots, &HashSet::new(), VOTES_MIN, None)), vec![10, 20]);
    }

    #[test]
    fn nomme_les_semences_sans_doublon_ac14() {
        let lots = vec![("Whiplash".to_owned(), vec![resultat(10)]), ("Sicario".to_owned(), vec![resultat(10)]), ("Sicario".to_owned(), vec![resultat(10)])];
        assert_eq!(fusionner(&lots, &HashSet::new(), VOTES_MIN, None)[0].semences, vec!["Whiplash", "Sicario"]);
    }

    #[test]
    fn ecarte_le_confidentiel() {
        let lots = vec![("Whiplash".to_owned(), vec![avec_votes(10, 5.0), resultat(11)])];
        assert_eq!(ids(&fusionner(&lots, &HashSet::new(), 120.0, None)), vec![11]);
    }

    #[test]
    fn semantique_de_categorie_de_la_bibliotheque() {
        let lots = vec![(
            "Whiplash".to_owned(),
            vec![resultat(10), Resultat { documentaire: true, ..resultat(11) }, Resultat { type_: "TV Series", ..resultat(12) }],
        )];
        assert_eq!(ids(&fusionner(&lots, &HashSet::new(), VOTES_MIN, Some("Movie"))), vec![10]);
        assert_eq!(ids(&fusionner(&lots, &HashSet::new(), VOTES_MIN, Some("Documentary"))), vec![11]);
        assert_eq!(ids(&fusionner(&lots, &HashSet::new(), VOTES_MIN, Some("TV Series"))), vec![12]);
    }

    fn decouverte(n: i64, semence: &str, duree: f64, annee: &str) -> Decouverte {
        Decouverte {
            r: Resultat { annee: Some(annee.into()), ..resultat(n) },
            semences: vec![semence.into()],
            disponibilite: None,
            compatibilite: Some(0.5),
            sortie: None,
            duree: Some(json!(duree)),
            bande_annonce: None,
        }
    }

    #[test]
    fn rangees_sans_repetition_ni_rangee_de_moins_de_3_ac6() {
        let mut items: Vec<Decouverte> = (1..=14).map(|i| decouverte(i, "Whiplash", 150.0, "2015")).collect();
        items.extend([100, 101, 102].map(|n| decouverte(n, "Sicario", 95.0, "2015")));
        items.extend([200, 201].map(|n| decouverte(n, "Whiplash", 150.0, "2026")));
        let r = rangees(&items, &HashSet::new(), 2026.0);
        let cles: Vec<String> = r.iter().flat_map(|x| x["keys"].as_array().unwrap().iter().map(|k| k.as_str().unwrap().to_owned()).collect::<Vec<_>>()).collect();
        assert_eq!(cles.iter().collect::<HashSet<_>>().len(), cles.len());
        assert!(r.iter().all(|x| x["keys"].as_array().unwrap().len() >= 3));
        assert_eq!(r[0]["title"], "Le meilleur pour toi");
        assert!(!r.iter().any(|x| x["key"] == "recent"));
        assert!(cles.iter().all(|k| k.starts_with("Movie:") || k.starts_with("TV Series:")));
    }

    #[test]
    fn le_tirage_a_graine_suit_celui_de_la_v1() {
        // pickRandom avec mulberry32(42) sur 20 semences : indices 12, 8, 15… comme la copie de parité.
        let vivier: Vec<i64> = (0..20).collect();
        let mut h = crate::modele::mulberry32(42);
        let t = tirer(&vivier, 6, &mut h);
        assert_eq!(t.len(), 6);
        assert_eq!(t[0], 12);
        assert_eq!(t.iter().collect::<HashSet<_>>().len(), 6);
    }
}
