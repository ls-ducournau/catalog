//! Serveur de la v2 de Catalog (Rust). Même contrat HTTP que la v1 (`parite/`), sans l'ancien
//! service de notes. spec: specs/catalog-v2-rust-supabase.md ; données : specs/catalog-v2-donnees.md

pub mod auth;
pub mod bd;
pub mod erreur;
pub mod items;
pub mod routes;

use axum::{Router, routing::get};

pub fn app() -> Router {
    Router::new()
        .route("/api/sante", get(routes::sante))
        .route("/api/genres", get(routes::genres))
        .route("/api/items", get(items::liste))
        .route("/api/items/{id}", get(items::fiche))
}
