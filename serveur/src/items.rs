//! Bibliothèque : liste paginée et fiche d'un titre. Même forme de réponse que la v1 (`LibraryItem`,
//! src/lib/libraryItem.ts ; contrat `parite/`), lue dans la vue `library_view` du compte.
//!
//! Pas encore porté : le synopsis rafraîchi depuis TMDB à
//! la demande (`?refresh=1`).
use crate::{
    auth::Utilisateur,
    bd,
    erreur::Erreur,
};
use axum::{
    Json,
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use sqlx::{Postgres, QueryBuilder, Row, postgres::PgRow};
use std::collections::HashMap;

pub(crate) const NOTES: [&str; 6] = ["💩", "⭐️", "⭐️⭐️", "⭐️⭐️⭐️", "⭐️⭐️⭐️⭐️", "⭐️⭐️⭐️⭐️⭐️"];
const AFFICHE: &str = "https://image.tmdb.org/t/p/w500";

/// Équivalent de `x COLLATE NOCASE` de SQLite : seules les lettres ASCII sont repliées et l'ordre est celui
/// des octets. La collation par défaut de PostgreSQL range autrement (accents, ponctuation).
fn nocase(x: &str) -> String {
    format!("translate({x}, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') collate \"C\"")
}

pub(crate) const COLONNES: &str = "id, name, year, type, genres, watch_status, poster_path, rating::int as rating, ressenti, elo_score,
    duels_count::int as duels_count, overview, tmdb_rating, vote_count::int as vote_count, watch_providers, release_info,
    trailer_info, (coalesce(genres, '[]'::jsonb) @> '[\"Documentary\"]'::jsonb) as documentaire";

/// L'année telle qu'on la lit : « 2013 - 2022 » devient « 2013–2022 », « 2022 - » « depuis 2022 ».
pub fn annee_affichee(brute: Option<&str>) -> Option<String> {
    let annee = brute?.trim();
    if annee.is_empty() {
        return None;
    }
    let (debut, reste) = annee.split_at(annee.find(|c: char| !c.is_ascii_digit()).unwrap_or(annee.len()));
    if debut.len() != 4 {
        return Some(annee.to_owned());
    }
    let reste = reste.trim_start();
    let Some(reste) = reste.strip_prefix('-').or_else(|| reste.strip_prefix('–')) else {
        return Some(annee.to_owned());
    };
    let fin = reste.trim();
    if fin.is_empty() {
        return Some(format!("depuis {debut}"));
    }
    if fin.len() == 4 && fin.chars().all(|c| c.is_ascii_digit()) {
        return Some(if fin == debut { debut.to_owned() } else { format!("{debut}–{fin}") });
    }
    Some(annee.to_owned())
}

pub(crate) fn titre(ligne: &PgRow) -> Result<Value, Erreur> {
    let type_: String = ligne.try_get("type")?;
    let documentaire: bool = ligne.try_get("documentaire")?;
    let duels: i32 = ligne.try_get("duels_count")?;
    let elo: f64 = ligne.try_get("elo_score")?;
    let note: Option<i32> = ligne.try_get("rating")?;
    let genres: Option<Value> = ligne.try_get("genres")?;
    let affiche: Option<String> = ligne.try_get("poster_path")?;
    let annee: Option<String> = ligne.try_get("year")?;
    let trailer: Option<Value> = ligne.try_get("trailer_info")?;
    Ok(json!({
        "id": ligne.try_get::<i64, _>("id")?,
        "name": ligne.try_get::<String, _>("name")?,
        "year": annee_affichee(annee.as_deref()),
        "type": type_,
        "category": if documentaire { "Documentary".to_owned() } else { type_ },
        "genres": genres.filter(Value::is_array).unwrap_or_else(|| json!([])),
        "watchStatus": ligne.try_get::<Option<String>, _>("watch_status")?,
        "posterUrl": affiche.filter(|a| !a.is_empty()).map(|a| format!("{AFFICHE}{a}")),
        "rating": note.and_then(|n| NOTES.get(n as usize)).map(|s| (*s).to_owned()),
        "ressenti": ligne.try_get::<Option<String>, _>("ressenti")?,
        "eloScore": if duels >= 1 { Some(elo) } else { None },
        "duelsCount": duels,
        "overview": ligne.try_get::<Option<String>, _>("overview")?,
        "voteAverage": ligne.try_get::<Option<f64>, _>("tmdb_rating")?,
        "voteCount": ligne.try_get::<Option<i32>, _>("vote_count")?,
        "availability": ligne.try_get::<Option<Value>, _>("watch_providers")?,
        "release": ligne.try_get::<Option<Value>, _>("release_info")?,
        "trailer": trailer.and_then(|t| t.get("trailer").cloned()).filter(|t| !t.is_null()),
    }))
}

/// Les filtres de la liste, tels que la v1 les lit dans l'adresse (une valeur inconnue = pas de filtre).
fn filtres<'a>(qb: &mut QueryBuilder<'a, Postgres>, p: &'a HashMap<String, String>, couverts: &Option<Vec<i32>>) {
    qb.push(" where true");
    match p.get("type").map(String::as_str) {
        Some("Documentary") => {
            qb.push(" and coalesce(genres, '[]'::jsonb) @> '[\"Documentary\"]'::jsonb");
        }
        Some(t @ ("Movie" | "TV Series")) => {
            qb.push(" and type = ").push_bind(t).push(" and not coalesce(genres, '[]'::jsonb) @> '[\"Documentary\"]'::jsonb");
        }
        _ => {}
    }
    if let Some(s @ ("Watched" | "Unwatched")) = p.get("watchStatus").map(String::as_str) {
        qb.push(" and watch_status = ").push_bind(s);
    }
    if let Some(q) = p.get("q").filter(|q| !q.is_empty()) {
        qb.push(format!(" and {} like ", nocase("name"))).push_bind(format!("%{}%", q.to_ascii_lowercase()));
    }
    if let Some(g) = p.get("genre").filter(|g| !g.is_empty()) {
        qb.push(" and coalesce(genres, '[]'::jsonb) @> jsonb_build_array(").push_bind(g.as_str()).push("::text)");
    }
    if let Some(n) = p.get("minRating").and_then(|v| v.parse::<i32>().ok()).filter(|n| (1..=5).contains(n)) {
        qb.push(" and rating >= ").push_bind(n);
    }
    if let Some(n) = p.get("rating").and_then(|v| v.parse::<i32>().ok()).filter(|n| (0..=5).contains(n)) {
        qb.push(" and rating = ").push_bind(n);
    }
    // « Sur mes abonnements » : inclus (abonnement, gratuit, avec publicité) sur un service couvert ;
    // sans abonnement, rien ne passe (comme `onServicesCondition` de la v1).
    if let Some(ids) = couverts {
        qb.push(
            " and exists (select 1 from jsonb_array_elements(coalesce(watch_providers -> 'flatrate', '[]'::jsonb) || coalesce(watch_providers -> 'free', '[]'::jsonb) || coalesce(watch_providers -> 'ads', '[]'::jsonb)) fournisseur where (fournisseur ->> 'id')::int = any(",
        )
        .push_bind(ids.clone())
        .push("))");
    }
}

/// Le tri : (expression, sens par défaut). Départage par nom puis identifiant pour que la pagination
/// ne répète ni ne saute un titre (même règle que la v1).
fn tri(par: Option<&str>) -> (&'static str, &'static str) {
    match par {
        Some("year") => ("(year collate \"C\")", "desc"),
        Some("elo") => ("(case when duels_count >= 1 then elo_score end)", "desc"),
        Some("tmdbRating") => ("tmdb_rating", "desc"),
        Some("added") => ("id", "desc"),
        Some("rating") => ("rating", "desc"),
        Some("status") => ("(case watch_status when 'Watched' then 1 else 0 end)", "asc"),
        Some("category") => (
            "(case when coalesce(genres, '[]'::jsonb) @> '[\"Documentary\"]'::jsonb then 'Documentaire' when type = 'Movie' then 'Film' else 'Série' end)",
            "asc",
        ),
        Some("genre") => ("GENRE", "asc"),
        _ => ("NOM", "asc"),
    }
}

/// GET /api/items
pub async fn liste(utilisateur: Utilisateur, Query(p): Query<HashMap<String, String>>) -> Result<Json<Value>, Erreur> {
    let page = p.get("page").and_then(|v| v.parse::<i64>().ok()).unwrap_or(1).max(1);
    let taille = p.get("pageSize").and_then(|v| v.parse::<i64>().ok()).unwrap_or(24).max(1);
    let (colonne, sens_defaut) = tri(p.get("sortBy").map(String::as_str));
    let nom = nocase("name");
    let colonne = match colonne {
        "NOM" => nom.clone(),
        "GENRE" => nocase("(genres ->> 0)"),
        autre => autre.to_owned(),
    };
    let sens = match p.get("sortDir").map(String::as_str) {
        Some("asc") => "asc",
        Some("desc") => "desc",
        _ => sens_defaut,
    };

    let mut tx = bd::transaction(&utilisateur).await?;
    let couverts: Option<Vec<i32>> = if p.get("onMyServices").map(String::as_str) == Some("1") {
        Some(crate::reglages::services_couverts(&mut tx).await?.into_iter().map(|i| i as i32).collect())
    } else {
        None
    };
    let mut total = QueryBuilder::<Postgres>::new("select count(*) from public.library_view");
    filtres(&mut total, &p, &couverts);
    let total: i64 = total.build_query_scalar().persistent(false).fetch_one(&mut **tx).await?;

    let mut liste = QueryBuilder::<Postgres>::new(format!("select {COLONNES} from public.library_view"));
    filtres(&mut liste, &p, &couverts);
    liste.push(format!(" order by {colonne} is null, {colonne} {sens}, {nom} asc, id asc limit "));
    liste.push_bind(taille).push(" offset ").push_bind((page - 1) * taille);
    let lignes = liste.build().persistent(false).fetch_all(&mut **tx).await?;
    tx.valider().await?;

    let items = lignes.iter().map(titre).collect::<Result<Vec<_>, _>>()?;
    Ok(Json(json!({ "items": items, "page": page, "pageSize": taille, "total": total })))
}

/// GET /api/items/{id}
pub async fn fiche(utilisateur: Utilisateur, Path(id): Path<String>) -> Result<Response, Erreur> {
    let introuvable = || (StatusCode::NOT_FOUND, Json(json!({ "error": "not_found" }))).into_response();
    let Ok(id) = id.parse::<i64>() else { return Ok(introuvable()) };
    let mut tx = bd::transaction(&utilisateur).await?;
    let ligne = sqlx::query(&format!("select {COLONNES} from public.library_view where id = $1")).bind(id).persistent(false).fetch_optional(&mut **tx).await?;
    tx.valider().await?;
    Ok(match ligne {
        Some(l) => Json(titre(&l)?).into_response(),
        None => introuvable(),
    })
}

#[cfg(test)]
mod tests {
    use super::annee_affichee;

    #[test]
    fn l_annee_se_lit_comme_en_v1() {
        assert_eq!(annee_affichee(Some("2013 - 2022")).as_deref(), Some("2013–2022"));
        assert_eq!(annee_affichee(Some("2022 - ")).as_deref(), Some("depuis 2022"));
        assert_eq!(annee_affichee(Some("2001 - 2001")).as_deref(), Some("2001"));
        assert_eq!(annee_affichee(Some("1999")).as_deref(), Some("1999"));
        assert_eq!(annee_affichee(Some("  ")), None);
        assert_eq!(annee_affichee(None), None);
        assert_eq!(annee_affichee(Some("2022 -")).as_deref(), Some("depuis 2022"));
    }
}
