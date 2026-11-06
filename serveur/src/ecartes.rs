//! « Ne plus me proposer ça » : les titres écartés des recommandations. Reprend `src/lib/dismissalService.ts`
//! et la route `/api/dismissals` (GET, POST, DELETE).
use crate::{
    auth::Utilisateur,
    bd::{self, Tx},
    erreur::Erreur,
    journal, js,
};
use axum::{
    Json,
    body::Bytes,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};

/// `tmdbKey` : un même numéro TMDB peut désigner un film et une série.
pub fn cle_tmdb(media: &str, tmdb_id: i64) -> String {
    format!("{}:{tmdb_id}", if media == "Movie" { "movie" } else { "tv" })
}

/// `parseDismissalSubject` puis `subjectId` : (`item`, « 42 ») ou (`tmdb`, « movie:603 »).
pub fn sujet(v: Option<&Value>) -> Option<(&'static str, String)> {
    let v = v?;
    match v.get("type").and_then(Value::as_str) {
        Some("item") => js::est_id(v.get("id")).map(|id| ("item", id.to_string())),
        Some("tmdb") => {
            let tmdb_id = js::est_id(v.get("tmdbId"))?;
            let media = v.get("mediaType").and_then(Value::as_str).filter(|m| *m == "Movie" || *m == "TV Series")?;
            Some(("tmdb", cle_tmdb(media, tmdb_id)))
        }
        _ => None,
    }
}

/// `countDismissals`.
pub async fn compter(tx: &mut Tx) -> Result<i64, Erreur> {
    Ok(sqlx::query_scalar("select count(*) from public.dismissals").persistent(false).fetch_one(&mut ***tx).await?)
}

fn invalide() -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid_request" }))).into_response()
}

/// GET /api/dismissals
pub async fn lire(utilisateur: Utilisateur) -> Result<Json<Value>, Erreur> {
    let mut tx = bd::transaction(&utilisateur).await?;
    let n = compter(&mut tx).await?;
    tx.valider().await?;
    Ok(Json(json!({ "count": n })))
}

/// POST /api/dismissals `{ subject }` : écarte (déjà écarté : rien ne change, le geste est quand même journalisé).
pub async fn ecarter(utilisateur: Utilisateur, corps: Bytes) -> Result<Response, Erreur> {
    let corps: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
    let Some((genre, id)) = sujet(corps.get("subject")) else { return Ok(invalide()) };
    let mut tx = bd::transaction(&utilisateur).await?;
    sqlx::query("insert into public.dismissals (subject_type, subject_id) values ($1, $2) on conflict do nothing")
        .bind(genre)
        .bind(&id)
        .persistent(false)
        .execute(&mut **tx)
        .await?;
    journal::consigner(&mut tx, "dismissed", genre, &id, None).await?;
    let n = compter(&mut tx).await?;
    tx.valider().await?;
    Ok(Json(json!({ "count": n })).into_response())
}

/// DELETE /api/dismissals : `{ subject }` annule un écartement ; `{ all: true }` réaffiche tout.
pub async fn reafficher(utilisateur: Utilisateur, corps: Bytes) -> Result<Response, Erreur> {
    let corps: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
    if corps.get("all") == Some(&Value::Bool(true)) {
        let mut tx = bd::transaction(&utilisateur).await?;
        let mut lignes: Vec<(String, String)> =
            sqlx::query_as("delete from public.dismissals returning subject_type, subject_id").persistent(false).fetch_all(&mut **tx).await?;
        // Même ordre de journal que la v1 : SQLite parcourt l'index de la clé primaire (ordre des octets).
        lignes.sort_by(|a, b| (a.0.as_bytes(), a.1.as_bytes()).cmp(&(b.0.as_bytes(), b.1.as_bytes())));
        journal::consigner_lot(&mut tx, "undismissed", &lignes, None).await?;
        tx.valider().await?;
        return Ok(Json(json!({ "count": 0, "cleared": lignes.len() })).into_response());
    }
    let Some((genre, id)) = sujet(corps.get("subject")) else { return Ok(invalide()) };
    let mut tx = bd::transaction(&utilisateur).await?;
    let retires = sqlx::query("delete from public.dismissals where subject_type = $1 and subject_id = $2")
        .bind(genre)
        .bind(&id)
        .persistent(false)
        .execute(&mut **tx)
        .await?
        .rows_affected();
    if retires > 0 {
        journal::consigner(&mut tx, "undismissed", genre, &id, None).await?;
    }
    let n = compter(&mut tx).await?;
    tx.valider().await?;
    Ok(Json(json!({ "count": n })).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_sujet_est_un_titre_ou_une_fiche_tmdb() {
        assert_eq!(sujet(Some(&json!({ "type": "item", "id": 42 }))), Some(("item", "42".into())));
        assert_eq!(sujet(Some(&json!({ "type": "tmdb", "tmdbId": 603, "mediaType": "Movie" }))), Some(("tmdb", "movie:603".into())));
        assert_eq!(sujet(Some(&json!({ "type": "tmdb", "tmdbId": 1399, "mediaType": "TV Series" }))), Some(("tmdb", "tv:1399".into())));
        assert_eq!(sujet(Some(&json!({ "type": "tmdb", "tmdbId": 603, "mediaType": "Book" }))), None);
        assert_eq!(sujet(Some(&json!({ "type": "item", "id": 0 }))), None);
        assert_eq!(sujet(Some(&json!({ "type": "autre" }))), None);
        assert_eq!(sujet(None), None);
    }
}
