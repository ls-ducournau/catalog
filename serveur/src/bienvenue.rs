//! Bienvenue — spec: specs/bienvenue-v1.md (FR-10). `GET /api/welcome/cards?page=N`, comme
//! `src/app/api/welcome/cards/route.ts` : la suite du paquet de cartes quand la vitrine est épuisée, pour
//! que le geste ne s'arrête pas. Chaque page mêle des titres très vus (deux films, une série) et des titres
//! populaires du moment, au format des aperçus. Publique comme la vitrine (un visiteur balaie avant d'avoir
//! un compte) ; avec un jeton, sans les titres du compte ni ceux qu'il a écartés. Gardée six heures par page.

use crate::{auth, bd, decouverte, erreur::Erreur, tmdb, vitrine};
use axum::{
    Json,
    extract::Query,
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use sqlx::Row;
use std::{
    collections::{HashMap, HashSet},
    sync::Mutex,
    time::{Duration, Instant},
};

/// Au-delà, TMDB propose des titres trop confidentiels pour un premier geste.
pub const PAGES_MAX: u32 = 20;
const DUREE: Duration = Duration::from_secs(6 * 60 * 60);
static PAGES: Mutex<Option<HashMap<u32, (Instant, Value)>>> = Mutex::new(None);

/// `composeWelcomePage` : très vus (deux films pour une série) et populaires (tendances, films, séries),
/// en alternance, présentables et sans doublon.
pub fn composer(films_connus: Vec<tmdb::Resultat>, series_connues: Vec<tmdb::Resultat>, tendances: Vec<tmdb::Resultat>, films: Vec<tmdb::Resultat>, series: Vec<tmdb::Resultat>) -> Vec<Value> {
    let mut series_connues = series_connues.into_iter();
    let mut connus = Vec::new();
    for (i, film) in films_connus.into_iter().enumerate() {
        connus.push(film);
        if i % 2 == 1
            && let Some(serie) = series_connues.next()
        {
            connus.push(serie);
        }
    }
    let populaires = vitrine::alterner(tendances, vitrine::alterner(films, series));
    vitrine::unique(vitrine::alterner(connus, populaires).into_iter().filter(vitrine::presentable).collect())
        .iter()
        .map(vitrine::suggestion)
        .collect()
}

async fn charger(page: u32) -> Value {
    let maintenant = Instant::now();
    if let Some((quand, valeur)) = PAGES.lock().ok().and_then(|p| p.as_ref().and_then(|p| p.get(&page).cloned()))
        && maintenant.duration_since(quand) < DUREE
    {
        return valeur;
    }
    // La vitrine a pris la première page des très vus et les deux premières des tendances.
    let connus = [("sort_by", "vote_count.desc".to_owned()), ("page", (page + 1).to_string())];
    let tendances = [("page", (page + 2).to_string())];
    let populaires = [("region", "FR".to_owned()), ("page", page.to_string())];
    let (films_connus, series_connues, tendances, films, series) = tokio::join!(
        tmdb::liste("/discover/movie", &connus, Some("Movie")),
        tmdb::liste("/discover/tv", &connus, Some("TV Series")),
        tmdb::liste("/trending/all/week", &tendances, None),
        tmdb::liste("/movie/popular", &populaires, Some("Movie")),
        tmdb::liste("/tv/popular", &populaires, Some("TV Series")),
    );
    let valeur = Value::Array(composer(films_connus, series_connues, tendances, films, series));
    // Une page vide (TMDB injoignable) n'est pas gardée : on réessaie à la prochaine demande.
    if valeur.as_array().is_some_and(|a| !a.is_empty())
        && let Ok(mut p) = PAGES.lock()
    {
        p.get_or_insert_with(HashMap::new).insert(page, (maintenant, valeur.clone()));
    }
    valeur
}

/// GET /api/welcome/cards?page=N
pub async fn cartes(entetes: HeaderMap, Query(p): Query<HashMap<String, String>>) -> Result<Response, Erreur> {
    let Some(page) = p.get("page").and_then(|v| v.parse::<u32>().ok()).filter(|n| (1..=PAGES_MAX).contains(n)) else {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid" }))).into_response());
    };
    let mut titres = charger(page).await;
    let jeton = entetes.get("authorization").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer "));
    if let Some(utilisateur) = match jeton {
        Some(j) => auth::utilisateur(j).await.ok(),
        None => None,
    } {
        let mut tx = bd::transaction(&utilisateur).await?;
        let lignes = sqlx::query("select type, tmdb_id from public.library_view where tmdb_id is not null").persistent(false).fetch_all(&mut **tx).await?;
        let ecartes = decouverte::tmdb_ecartes(&mut tx).await?;
        tx.valider().await?;
        let siens: HashSet<String> = lignes
            .iter()
            .map(|l| format!("{}:{}", l.get::<String, _>("type"), l.get::<i32, _>("tmdb_id")))
            .collect();
        if let Some(liste) = titres.as_array_mut() {
            liste.retain(|t| {
                let type_ = t["type"].as_str().unwrap_or_default();
                let tmdb_id = t["suggestion"]["tmdbId"].as_i64().unwrap_or_default();
                !siens.contains(&format!("{type_}:{tmdb_id}")) && !ecartes.contains(&decouverte::cle_tmdb(type_, tmdb_id))
            });
        }
    }
    Ok(Json(json!({ "items": titres, "page": page, "more": page < PAGES_MAX })).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(tmdb_id: i64, type_: &'static str) -> tmdb::Resultat {
        tmdb::Resultat {
            tmdb_id,
            type_,
            documentaire: false,
            genres: vec!["Drame".into()],
            titre: format!("Titre {tmdb_id}"),
            annee: Some("2026".into()),
            affiche: Some(format!("/p{tmdb_id}.jpg")),
            note: serde_json::Number::from_f64(7.5),
            votes: Some(1000.into()),
            synopsis: "Un synopsis.".into(),
            credit: None,
        }
    }

    #[test]
    fn alterne_tres_vus_et_populaires_sans_doublon() {
        let page = composer(
            vec![r(1, "Movie"), r(2, "Movie"), r(3, "Movie")],
            vec![r(10, "TV Series")],
            vec![r(1, "Movie"), r(20, "Movie")],
            vec![r(30, "Movie")],
            vec![r(40, "TV Series")],
        );
        let cles: Vec<String> = page.iter().map(|t| format!("{}:{}", t["type"].as_str().unwrap(), t["suggestion"]["tmdbId"])).collect();
        assert_eq!(cles, ["Movie:1", "Movie:2", "Movie:30", "TV Series:10", "Movie:20", "Movie:3", "TV Series:40"]);
    }
}
