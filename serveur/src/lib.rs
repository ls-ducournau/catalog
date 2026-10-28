//! Serveur de la v2 de Catalog (Rust). Même contrat HTTP que la v1 (`parite/`), sans l'ancien
//! service de notes. spec: specs/catalog-v2-rust-supabase.md ; données : specs/catalog-v2-donnees.md

pub mod auth;
pub mod bd;
pub mod duels;
pub mod ecriture;
pub mod erreur;
pub mod items;
pub mod reglages;
pub mod routes;
pub mod tmdb;
pub mod tri;

use axum::{
    Router,
    routing::{get, post},
};

pub fn app() -> Router {
    Router::new()
        .route("/api/sante", get(routes::sante))
        .route("/api/genres", get(routes::genres))
        .route("/api/items", get(items::liste).post(ecriture::ajouter))
        .route("/api/items/{id}", get(items::fiche).patch(ecriture::modifier).delete(ecriture::retirer))
        .route("/api/tmdb/search", get(ecriture::recherche))
        .route("/api/settings/subscriptions", get(reglages::lire_abonnements).put(reglages::ecrire_abonnements))
        .route("/api/providers", get(reglages::fournisseurs))
        .route("/api/triage/batch", get(tri::lot))
        .route("/api/triage/answer", post(tri::repondre))
        .route("/api/triage/undo", post(tri::annuler))
        .route("/api/duels/next", get(duels::suivant))
        .route("/api/duels/scope", get(duels::portee))
        .route("/api/duels/result", post(duels::resultat))
        .route("/api/duels/undo", post(duels::annuler))
        .route("/api/duels/reset", post(duels::reinitialiser))
        .route("/api/duels/restore", post(duels::retablir))
}
