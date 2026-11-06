//! Réglages du compte et disponibilité en streaming : abonnements déclarés, services couverts, et ce qui
//! décide qu'un titre est « sur tes abonnements ». Reprend `src/lib/settingsService.ts` et
//! `src/lib/availability.ts` (logique pure), plus les routes `/api/settings/subscriptions` et `/api/providers`.
use crate::{
    auth::Utilisateur,
    bd::{self, Tx},
    erreur::Erreur,
    tmdb,
};
use axum::{
    Json,
    body::Bytes,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use std::collections::HashSet;

const CLE_ABONNEMENTS: &str = "streaming_subscriptions";

/// Identifiants TMDB des services auxquels le compte est abonné.
pub async fn abonnements(tx: &mut Tx) -> Result<Vec<i64>, Erreur> {
    let valeur: Option<(Value,)> = sqlx::query_as("select value from public.settings where key = $1").bind(CLE_ABONNEMENTS).persistent(false).fetch_optional(&mut ***tx).await?;
    Ok(valeur.and_then(|v| v.0.as_array().cloned()).unwrap_or_default().iter().filter_map(|x| x.as_i64().filter(|_| x.is_i64() || x.is_u64())).collect())
}

/// Nom du service sans la mention d'une formule avec publicité (« Netflix Standard with Ads » = « Netflix »).
pub fn famille_service(nom: &str) -> String {
    let bas = nom.trim().to_lowercase();
    let mots: Vec<&str> = bas.split_whitespace().collect();
    // Équivalent de / +(standard|basic|essential)? *with +ads$/i
    if mots.len() >= 2 && mots[mots.len() - 2] == "with" && mots[mots.len() - 1] == "ads" {
        let mut garde = mots.len() - 2;
        if garde >= 1 && matches!(mots[garde - 1], "standard" | "basic" | "essential") {
            garde -= 1;
        }
        return mots[..garde].join(" ");
    }
    mots.join(" ")
}

/// Tous les services couverts par les abonnements, formules avec publicité comprises.
pub fn services_couverts_de(abonnes: &[i64], catalogue: &[Value]) -> HashSet<i64> {
    let abonnes_set: HashSet<i64> = abonnes.iter().copied().collect();
    let nom = |p: &Value| p.get("name").and_then(Value::as_str).unwrap_or_default().to_owned();
    let id = |p: &Value| p.get("id").and_then(Value::as_i64);
    let familles: HashSet<String> = catalogue.iter().filter(|p| id(p).is_some_and(|i| abonnes_set.contains(&i))).map(|p| famille_service(&nom(p))).collect();
    let mut couverts = abonnes_set.clone();
    for p in catalogue {
        if let Some(i) = id(p)
            && familles.contains(&famille_service(&nom(p))) {
                couverts.insert(i);
            }
    }
    couverts
}

/// Services couverts du compte (vide sans abonnement) : ce que filtrent « sur mes abonnements ».
pub async fn services_couverts(tx: &mut Tx) -> Result<HashSet<i64>, Erreur> {
    let abonnes = abonnements(tx).await?;
    if abonnes.is_empty() {
        return Ok(HashSet::new());
    }
    Ok(services_couverts_de(&abonnes, &tmdb::fournisseurs_fr().await))
}

/// Services de tes abonnements où le titre est inclus (ni location ni achat), un par famille.
pub fn inclus_dans(disponibilite: Option<&Value>, couverts: &HashSet<i64>) -> Vec<Value> {
    let Some(d) = disponibilite else { return vec![] };
    let mut vues = HashSet::new();
    ["flatrate", "free", "ads"]
        .iter()
        .flat_map(|k| d.get(*k).and_then(Value::as_array).cloned().unwrap_or_default())
        .filter(|p| {
            let Some(id) = p.get("id").and_then(Value::as_i64) else { return false };
            if !couverts.contains(&id) {
                return false;
            }
            vues.insert(famille_service(p.get("name").and_then(Value::as_str).unwrap_or_default()))
        })
        .collect()
}

/// GET /api/settings/subscriptions
pub async fn lire_abonnements(utilisateur: Utilisateur) -> Result<Json<Value>, Erreur> {
    let mut tx = bd::transaction(&utilisateur).await?;
    let ids = abonnements(&mut tx).await?;
    tx.valider().await?;
    Ok(Json(json!({ "ids": ids })))
}

/// PUT /api/settings/subscriptions : remplace la liste (entiers positifs, sans doublon, ordre gardé).
pub async fn ecrire_abonnements(utilisateur: Utilisateur, corps: Bytes) -> Result<Response, Erreur> {
    let corps: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
    let Some(liste) = corps.get("ids").and_then(Value::as_array) else {
        return Ok((StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid_request" }))).into_response());
    };
    let mut propres: Vec<i64> = vec![];
    for v in liste {
        // Number.isInteger(id) && id > 0 : un nombre entier, même écrit 8.0
        let entier = v.as_i64().or_else(|| v.as_f64().filter(|f| f.fract() == 0.0 && f.is_finite()).map(|f| f as i64));
        if let Some(i) = entier.filter(|i| *i > 0)
            && !propres.contains(&i) {
                propres.push(i);
            }
    }
    let mut tx = bd::transaction(&utilisateur).await?;
    sqlx::query("insert into public.settings (key, value) values ($1, $2) on conflict (user_id, key) do update set value = excluded.value")
        .bind(CLE_ABONNEMENTS)
        .bind(json!(propres))
        .persistent(false)
        .execute(&mut **tx)
        .await?;
    tx.valider().await?;
    Ok(Json(json!({ "ids": propres })).into_response())
}

/// GET /api/providers : services disponibles en France (sans identification, comme la v1, mais derrière
/// le même contrôle d'accès que le reste de l'API).
pub async fn fournisseurs(_utilisateur: Utilisateur) -> Json<Value> {
    Json(json!({ "providers": tmdb::fournisseurs_fr().await }))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn la_famille_ignore_la_formule_avec_publicite() {
        assert_eq!(famille_service("Netflix Standard with Ads"), "netflix");
        assert_eq!(famille_service("Netflix basic with Ads"), "netflix");
        assert_eq!(famille_service("Netflix"), "netflix");
        assert_eq!(famille_service("Paramount Plus Apple TV Channel"), "paramount plus apple tv channel");
    }

    #[test]
    fn les_formules_avec_publicite_sont_couvertes() {
        let catalogue = vec![json!({ "id": 8, "name": "Netflix" }), json!({ "id": 1796, "name": "Netflix Standard with Ads" }), json!({ "id": 337, "name": "Disney Plus" })];
        let couverts = services_couverts_de(&[8], &catalogue);
        assert!(couverts.contains(&8) && couverts.contains(&1796) && !couverts.contains(&337));
    }

    #[test]
    fn inclus_ne_compte_ni_location_ni_achat_et_un_par_famille() {
        let couverts: HashSet<i64> = [8, 1796].into_iter().collect();
        let dispo = json!({ "flatrate": [{ "id": 8, "name": "Netflix" }], "ads": [{ "id": 1796, "name": "Netflix Standard with Ads" }], "rent": [{ "id": 2, "name": "Apple TV" }] });
        let inclus = inclus_dans(Some(&dispo), &couverts);
        assert_eq!(inclus.len(), 1);
        assert_eq!(inclus[0]["id"], 8);
    }
}
