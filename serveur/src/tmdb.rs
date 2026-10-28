//! TMDB : recherche et fiche d'un titre, pour l'ajout à la bibliothèque. Reprend `src/lib/tmdb.ts`
//! (searchMulti, getDetails, getDetailsFr). Pas encore porté : la filmographie d'une personne
//! recherchée par son nom, les caractéristiques du modèle de préférence, la disponibilité, les dates
//! de sortie et la bande-annonce (une fiche ajoutée en v2 les reçoit plus tard).
use serde_json::Value;
use std::{collections::HashMap, time::Duration};
use tokio::sync::OnceCell;

const BASE: &str = "https://api.themoviedb.org/3";
const DOCUMENTAIRE: i64 = 99;

static CLIENT: OnceCell<reqwest::Client> = OnceCell::const_new();
static GENRES: OnceCell<(HashMap<i64, String>, HashMap<i64, String>)> = OnceCell::const_new();

async fn client() -> &'static reqwest::Client {
    CLIENT.get_or_init(|| async { reqwest::Client::builder().timeout(Duration::from_secs(8)).build().expect("client HTTP") }).await
}

/// Un GET sur TMDB ; `None` si la réponse n'est pas un succès ou si le réseau échoue.
async fn get(chemin: &str) -> Option<Value> {
    let jeton = std::env::var("TMDB_ACCESS_TOKEN").ok()?;
    let reponse = client().await.get(format!("{BASE}{chemin}")).bearer_auth(jeton).header("accept", "application/json").send().await.ok()?;
    if !reponse.status().is_success() {
        return None;
    }
    reponse.json().await.ok()
}

async fn genres_connus() -> &'static (HashMap<i64, String>, HashMap<i64, String>) {
    GENRES
        .get_or_init(|| async {
            let liste = |v: Option<Value>| -> HashMap<i64, String> {
                v.and_then(|v| v.get("genres").cloned())
                    .and_then(|g| g.as_array().cloned())
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|g| Some((g.get("id")?.as_i64()?, g.get("name")?.as_str()?.to_owned())))
                    .collect()
            };
            let (film, serie) = tokio::join!(get("/genre/movie/list"), get("/genre/tv/list"));
            (liste(film), liste(serie))
        })
        .await
}

fn annee(date: Option<&Value>) -> Option<String> {
    let d = date?.as_str()?;
    (d.len() >= 4).then(|| d[..4].to_owned())
}

pub struct Resultat {
    pub tmdb_id: i64,
    pub type_: &'static str,
    pub documentaire: bool,
    pub genres: Vec<String>,
    pub titre: String,
    pub annee: Option<String>,
    pub affiche: Option<String>,
    pub note: Option<f64>,
    pub votes: Option<i64>,
    pub synopsis: String,
}

/// Recherche de titres (films et séries). Page 1 de TMDB si la page est invalide.
pub async fn rechercher(requete: &str, page: i64) -> (Vec<Resultat>, i64) {
    if requete.trim().is_empty() {
        return (vec![], 0);
    }
    let encodee: String = requete.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect();
    let chemin = format!("/search/multi?query={encodee}&include_adult=false&page={page}&language=fr-FR");
    let (reponse, (genres_film, genres_serie)) = tokio::join!(get(&chemin), genres_connus());
    let Some(reponse) = reponse else { return (vec![], 0) };
    let total_pages = reponse.get("total_pages").and_then(Value::as_i64).unwrap_or(1);
    let resultats = reponse
        .get("results")
        .and_then(Value::as_array)
        .map(|rows| {
            rows.iter()
                .filter_map(|r| {
                    let (type_, dico, cle_titre, cle_date) = match r.get("media_type")?.as_str()? {
                        "movie" => ("Movie", genres_film, "title", "release_date"),
                        "tv" => ("TV Series", genres_serie, "name", "first_air_date"),
                        _ => return None,
                    };
                    let titre = r.get(cle_titre)?.as_str().filter(|t| !t.is_empty())?.to_owned();
                    let ids: Vec<i64> = r.get("genre_ids").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_i64).collect()).unwrap_or_default();
                    Some(Resultat {
                        tmdb_id: r.get("id")?.as_i64()?,
                        type_,
                        documentaire: ids.contains(&DOCUMENTAIRE),
                        genres: ids.iter().filter_map(|i| dico.get(i).cloned()).collect(),
                        titre,
                        annee: annee(r.get(cle_date)),
                        affiche: r.get("poster_path").and_then(Value::as_str).map(str::to_owned),
                        note: r.get("vote_average").and_then(Value::as_f64),
                        votes: r.get("vote_count").and_then(Value::as_i64),
                        synopsis: r.get("overview").and_then(Value::as_str).unwrap_or_default().to_owned(),
                    })
                })
                .collect()
        })
        .unwrap_or_default();
    (resultats, total_pages)
}

/// Ce qu'il faut pour ajouter un titre : la fiche TMDB, avec le titre et le synopsis en français.
pub struct Fiche {
    pub tmdb_id: i64,
    pub type_: &'static str,
    pub titre: String,
    pub annee: Option<String>,
    pub affiche: Option<String>,
    pub note: Option<f64>,
    pub votes: Option<i64>,
    pub imdb_id: Option<String>,
    pub genres: Vec<String>,
    pub realisation: Option<String>,
    pub synopsis: String,
}

pub async fn fiche(tmdb_id: i64, type_: &str) -> Option<Fiche> {
    let (chemin, type_, cle_titre, cle_date) = if type_ == "Movie" { ("movie", "Movie", "title", "release_date") } else { ("tv", "TV Series", "name", "first_air_date") };
    let chemin_en = format!("/{chemin}/{tmdb_id}?append_to_response=external_ids,credits");
    let chemin_fr = format!("/{chemin}/{tmdb_id}?language=fr-FR");
    let (en, fr) = tokio::join!(get(&chemin_en), get(&chemin_fr));
    let en = en?;
    let titre_en = en.get(cle_titre)?.as_str().filter(|t| !t.is_empty())?.to_owned();
    let titre_fr = fr.as_ref().and_then(|f| f.get(cle_titre)).and_then(Value::as_str).filter(|t| !t.is_empty()).map(str::to_owned);
    let realisation = if type_ == "Movie" {
        en.pointer("/credits/crew").and_then(Value::as_array).and_then(|c| c.iter().find(|p| p.get("job").and_then(Value::as_str) == Some("Director"))).and_then(|p| p.get("name")).and_then(Value::as_str).map(str::to_owned)
    } else {
        let noms: Vec<&str> = en.get("created_by").and_then(Value::as_array).map(|a| a.iter().filter_map(|p| p.get("name")?.as_str()).collect()).unwrap_or_default();
        (!noms.is_empty()).then(|| noms.join(", "))
    };
    Some(Fiche {
        tmdb_id: en.get("id").and_then(Value::as_i64).unwrap_or(tmdb_id),
        type_,
        titre: titre_fr.unwrap_or(titre_en),
        annee: annee(en.get(cle_date)),
        affiche: en.get("poster_path").and_then(Value::as_str).map(str::to_owned),
        note: en.get("vote_average").and_then(Value::as_f64),
        votes: fr.as_ref().and_then(|f| f.get("vote_count")).and_then(Value::as_i64).or_else(|| en.get("vote_count").and_then(Value::as_i64)),
        imdb_id: en.pointer("/external_ids/imdb_id").and_then(Value::as_str).filter(|s| !s.is_empty()).map(str::to_owned),
        genres: en.get("genres").and_then(Value::as_array).map(|g| g.iter().filter_map(|x| x.get("name")?.as_str().map(str::to_owned)).collect()).unwrap_or_default(),
        realisation,
        synopsis: fr.as_ref().and_then(|f| f.get("overview")).and_then(Value::as_str).unwrap_or_default().to_owned(),
    })
}

static FOURNISSEURS: tokio::sync::RwLock<Option<(Vec<Value>, std::time::Instant)>> = tokio::sync::RwLock::const_new(None);

/// Services disponibles en France, films et séries confondus, du plus au moins populaire (ordre
/// d'affichage TMDB pour la France), gardés en mémoire une journée. Reprend `listFrenchProviders`.
pub async fn fournisseurs_fr() -> Vec<Value> {
    if let Some((liste, quand)) = FOURNISSEURS.read().await.as_ref() {
        if quand.elapsed() < Duration::from_secs(24 * 60 * 60) {
            return liste.clone();
        }
    }
    let (films, series) = tokio::join!(get("/watch/providers/movie?watch_region=FR&language=fr-FR"), get("/watch/providers/tv?watch_region=FR&language=fr-FR"));
    if films.is_none() && series.is_none() {
        return FOURNISSEURS.read().await.as_ref().map(|(l, _)| l.clone()).unwrap_or_default();
    }
    // id -> (fournisseur, priorité, rang d'arrivée) ; on garde la meilleure priorité.
    let mut par_id: Vec<(i64, Value, i64)> = vec![];
    for brut in [films, series].into_iter().flatten().filter_map(|v| v.get("results").and_then(Value::as_array).cloned()).flatten() {
        let Some(id) = brut.get("provider_id").and_then(Value::as_i64) else { continue };
        let priorite = brut.pointer("/display_priorities/FR").and_then(Value::as_i64).or_else(|| brut.get("display_priority").and_then(Value::as_i64)).unwrap_or(999);
        let fournisseur = serde_json::json!({ "id": id, "name": brut.get("provider_name").and_then(Value::as_str).unwrap_or_default(), "logoPath": brut.get("logo_path").cloned().filter(|v| !v.is_null()) });
        match par_id.iter_mut().find(|e| e.0 == id) {
            Some(e) if e.2 > priorite => {
                e.1 = fournisseur;
                e.2 = priorite;
            }
            Some(_) => {}
            None => par_id.push((id, fournisseur, priorite)),
        }
    }
    par_id.sort_by_key(|e| e.2); // tri stable, comme Array.prototype.sort
    let liste: Vec<Value> = par_id.into_iter().map(|e| e.1).collect();
    *FOURNISSEURS.write().await = Some((liste.clone(), std::time::Instant::now()));
    liste
}
