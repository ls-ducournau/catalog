//! Erreurs de l'API : un statut et un corps `{ "error": "..." }`, comme la v1.
use axum::{Json, http::StatusCode, response::{IntoResponse, Response}};
use serde_json::json;

#[derive(Debug)]
pub enum Erreur {
    /// Jeton absent ou invalide.
    NonAutorise,
    /// Une erreur interne : le détail va dans les journaux, jamais dans la réponse.
    Interne(String),
}

impl IntoResponse for Erreur {
    fn into_response(self) -> Response {
        match self {
            Erreur::NonAutorise => (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" }))).into_response(),
            Erreur::Interne(detail) => {
                eprintln!("erreur interne : {detail}");
                (StatusCode::INTERNAL_SERVER_ERROR, Json(json!({ "error": "internal_error" }))).into_response()
            }
        }
    }
}

impl<E: std::error::Error> From<E> for Erreur {
    fn from(e: E) -> Self {
        Erreur::Interne(e.to_string())
    }
}
