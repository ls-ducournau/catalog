//! Les routes. Chacune reprend la forme de réponse de la v1 (contrat : `parite/`).
use crate::{auth::Utilisateur, bd, erreur::Erreur};
use axum::Json;
use serde_json::{Value, json};

/// GET /api/sante : sans identification, pour vérifier que le service répond.
pub async fn sante() -> Json<Value> {
    Json(json!({ "ok": true }))
}

/// GET /api/genres : les genres distincts de la bibliothèque de l'utilisateur, triés sans tenir
/// compte de la casse (équivalent de `listDistinctGenres` de la v1).
pub async fn genres(utilisateur: Utilisateur) -> Result<Json<Value>, Erreur> {
    let mut tx = bd::transaction(&utilisateur).await?;
    let lignes: Vec<(String,)> = sqlx::query_as(
        "select genre from (
           select distinct g.value as genre
             from public.library_view v, jsonb_array_elements_text(v.genres) as g(value)
            where v.genres is not null and jsonb_typeof(v.genres) = 'array'
         ) t
         order by lower(genre), genre",
    )
    .persistent(false)
    .fetch_all(&mut *tx)
    .await?;
    tx.commit().await?;
    Ok(Json(json!({ "genres": lignes.into_iter().map(|l| l.0).collect::<Vec<_>>() })))
}
