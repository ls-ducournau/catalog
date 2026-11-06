//! Journal des gestes et ce que le profil de goûts en montre. Reprend `src/lib/journalService.ts`
//! (`logEvent`, `acceptanceStats`) et la route `GET /api/profile/feedback`.
use crate::{
    auth::Utilisateur,
    bd::{self, Tx},
    ecartes,
    erreur::Erreur,
    js,
};
use axum::Json;
use serde_json::{Value, json};

/// Les sources d'ajout qui viennent d'une proposition (FR-8 du tri rapide) : seules elles comptent.
const SOURCES_PROPOSITION: [&str; 3] = ["discover", "suggestions", "triage"];

/// `logEvent` : un geste du compte. `contexte` est un objet JSON, ou `None` (NULL en base : la contrainte de la
/// table refuse un `null` JSON).
pub async fn consigner(tx: &mut Tx, genre: &str, sujet: &str, id: &str, contexte: Option<Value>) -> Result<(), Erreur> {
    sqlx::query("insert into public.events (kind, subject_type, subject_id, context) values ($1, $2, $3, $4)")
        .bind(genre)
        .bind(sujet)
        .bind(id)
        .bind(contexte)
        .persistent(false)
        .execute(&mut ***tx)
        .await?;
    Ok(())
}

/// Plusieurs gestes de même nature et de même contexte, dans l'ordre donné, en une requête.
pub async fn consigner_lot(tx: &mut Tx, genre: &str, sujets: &[(String, String)], contexte: Option<Value>) -> Result<(), Erreur> {
    if sujets.is_empty() {
        return Ok(());
    }
    let (types, ids): (Vec<&str>, Vec<&str>) = sujets.iter().map(|(t, i)| (t.as_str(), i.as_str())).unzip();
    sqlx::query(
        "insert into public.events (kind, subject_type, subject_id, context)
         select $1, s.type, s.id, $4 from unnest($2::text[], $3::text[]) with ordinality as s(type, id, rang) order by s.rang",
    )
    .bind(genre)
    .bind(&types)
    .bind(&ids)
    .bind(contexte)
    .persistent(false)
    .execute(&mut ***tx)
    .await?;
    Ok(())
}

/// `acceptanceStats` mis en forme : `gardes` propositions ajoutées, `ecartees` écartées ; parmi les gardées,
/// `vues` vues et notées, dont `aimees` notées ⭐⭐⭐⭐ ou plus.
pub fn acceptation(gardes: i64, ecartees: i64, vues: i64, aimees: i64) -> Value {
    let decidees = gardes + ecartees;
    json!({
        "decided": decidees,
        "keptRate": if decidees > 0 { js::nombre_json(gardes as f64 / decidees as f64) } else { Value::Null },
        "seen": vues,
        "lovedRate": if vues > 0 { js::nombre_json(aimees as f64 / vues as f64) } else { Value::Null },
    })
}

/// FR-8 : l'équivalent personnel d'un test A/B (propositions gardées, écartées, et réussies une fois vues).
pub async fn statistiques_acceptation(tx: &mut Tx) -> Result<Value, Erreur> {
    let gardes: Vec<i64> = sqlx::query_scalar(
        "select distinct subject_id::bigint from public.events
          where kind = 'added' and subject_type = 'item' and context ->> 'source' = any($1)",
    )
    .bind(SOURCES_PROPOSITION.as_slice())
    .persistent(false)
    .fetch_all(&mut ***tx)
    .await?;
    let ecartees: i64 = sqlx::query_scalar("select count(distinct subject_type || ':' || subject_id) from public.events where kind = 'dismissed'")
        .persistent(false)
        .fetch_one(&mut ***tx)
        .await?;
    let (vues, aimees): (i64, i64) = if gardes.is_empty() {
        (0, 0)
    } else {
        sqlx::query_as(
            "select count(*), count(*) filter (where rating >= 4) from public.library_items
              where id = any($1) and watch_status = 'Watched' and rating is not null",
        )
        .bind(&gardes)
        .persistent(false)
        .fetch_one(&mut ***tx)
        .await?
    };
    Ok(acceptation(gardes.len() as i64, ecartees, vues, aimees))
}

/// GET /api/profile/feedback : ce que le profil de goûts affiche de la boucle (acceptation, titres écartés).
pub async fn profil(utilisateur: Utilisateur) -> Result<Json<Value>, Erreur> {
    let mut tx = bd::transaction(&utilisateur).await?;
    let acceptance = statistiques_acceptation(&mut tx).await?;
    let ecartes = ecartes::compter(&mut tx).await?;
    tx.valider().await?;
    Ok(Json(json!({ "acceptance": acceptance, "dismissed": ecartes })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rien_a_mesurer_rend_null() {
        assert_eq!(acceptation(0, 0, 0, 0), json!({ "decided": 0, "keptRate": null, "seen": 0, "lovedRate": null }));
    }

    #[test]
    fn les_parts_s_ecrivent_comme_en_javascript() {
        let a = acceptation(40, 46, 9, 6);
        assert_eq!(a["decided"], 86);
        assert_eq!(a["keptRate"].to_string(), (40.0f64 / 86.0).to_string());
        assert_eq!(a["lovedRate"].to_string(), "0.6666666666666666");
        assert_eq!(acceptation(2, 0, 1, 1)["keptRate"].to_string(), "1");
    }
}
