//! Identification : le jeton d'accès Supabase (ES256) est vérifié avec les clés PUBLIQUES du projet
//! (JWKS), gardées en cache. Aucun secret n'est nécessaire. Un invité (connexion anonyme) et un compte
//! e-mail et mot de passe suivent le même chemin.
use crate::erreur::Erreur;
use axum::{extract::FromRequestParts, http::request::Parts};
use jsonwebtoken::{Algorithm, DecodingKey, Validation, decode, decode_header, jwk::JwkSet};
use serde_json::Value;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;

/// L'utilisateur d'une requête, tel que le jeton l'atteste.
pub struct Utilisateur {
    /// Identifiant du compte (`sub`).
    pub id: String,
    /// Les revendications du jeton, posées côté base pour les règles d'accès (`auth.uid()`).
    pub revendications: String,
    pub anonyme: bool,
}

struct Cache {
    cles: Option<JwkSet>,
    chargee_le: Option<Instant>,
}

static CACHE: RwLock<Cache> = RwLock::const_new(Cache { cles: None, chargee_le: None });

/// Au plus un rechargement des clés par minute, pour qu'un jeton à `kid` inconnu ne puisse pas
/// provoquer une rafale d'appels vers Supabase.
const RECHARGEMENT_MINIMAL: Duration = Duration::from_secs(60);

fn url_projet() -> Result<String, Erreur> {
    std::env::var("SUPABASE_URL").map_err(|_| Erreur::Interne("SUPABASE_URL absente".into()))
}

async fn recharger() -> Result<(), Erreur> {
    let url = format!("{}/auth/v1/.well-known/jwks.json", url_projet()?);
    let cles: JwkSet = reqwest::Client::new().get(url).timeout(Duration::from_secs(5)).send().await?.error_for_status()?.json().await?;
    let mut cache = CACHE.write().await;
    cache.cles = Some(cles);
    cache.chargee_le = Some(Instant::now());
    Ok(())
}

async fn cle(kid: &str) -> Result<DecodingKey, Erreur> {
    for essai in 0..2 {
        {
            let cache = CACHE.read().await;
            if let Some(jwk) = cache.cles.as_ref().and_then(|c| c.find(kid)) {
                return DecodingKey::from_jwk(jwk).map_err(|_| Erreur::NonAutorise);
            }
        }
        if essai == 1 {
            break;
        }
        let recent = CACHE.read().await.chargee_le.is_some_and(|t| t.elapsed() < RECHARGEMENT_MINIMAL);
        if recent {
            break;
        }
        recharger().await?;
    }
    Err(Erreur::NonAutorise)
}

/// Vérifie un jeton : signature, expiration, émetteur et public. Rend ses revendications.
pub async fn verifier(jeton: &str) -> Result<Value, Erreur> {
    let en_tete = decode_header(jeton).map_err(|_| Erreur::NonAutorise)?;
    if en_tete.alg != Algorithm::ES256 {
        return Err(Erreur::NonAutorise);
    }
    let kid = en_tete.kid.ok_or(Erreur::NonAutorise)?;
    let cle = cle(&kid).await?;
    let mut validation = Validation::new(Algorithm::ES256);
    validation.set_audience(&["authenticated"]);
    validation.set_issuer(&[format!("{}/auth/v1", url_projet()?)]);
    validation.set_required_spec_claims(&["exp", "sub", "aud", "iss"]);
    decode::<Value>(jeton, &cle, &validation).map(|d| d.claims).map_err(|_| Erreur::NonAutorise)
}

impl<S: Send + Sync> FromRequestParts<S> for Utilisateur {
    type Rejection = Erreur;

    async fn from_request_parts(parts: &mut Parts, _etat: &S) -> Result<Self, Self::Rejection> {
        let jeton = parts
            .headers
            .get("authorization")
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
            .ok_or(Erreur::NonAutorise)?;
        let revendications = verifier(jeton).await?;
        let id = revendications.get("sub").and_then(Value::as_str).ok_or(Erreur::NonAutorise)?.to_owned();
        let anonyme = revendications.get("is_anonymous").and_then(Value::as_bool).unwrap_or(false);
        Ok(Utilisateur { id, revendications: revendications.to_string(), anonyme })
    }
}
