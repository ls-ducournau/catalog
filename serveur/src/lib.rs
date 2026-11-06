//! Serveur de la v2 de Catalog (Rust). Même contrat HTTP que la v1 (`parite/`), sans l'ancien
//! service de notes. spec: specs/catalog-v2-rust-supabase.md ; données : specs/catalog-v2-donnees.md

pub mod accueil;
pub mod auth;
pub mod bd;
pub mod catalogue;
pub mod ce_soir;
pub mod classement;
pub mod decouverte;
pub mod duels;
pub mod duels_personnes;
pub mod ecartes;
pub mod ecriture;
pub mod erreur;
pub mod faconnage;
pub mod flottants;
pub mod fraicheur;
pub mod items;
pub mod journal;
pub mod js;
pub mod js_v8;
pub mod modele;
pub mod paliers;
pub mod personnes;
pub mod playlists;
pub mod preference;
pub mod recommandations;
pub mod reglages;
pub mod routes;
pub mod sorties;
pub mod tmdb;
pub mod tmdb_decouverte;
pub mod tri;
pub mod vitrine;
#[cfg(test)]
mod vecteurs_v1;

use axum::{
    Router,
    routing::{get, post},
};

pub fn app() -> Router {
    Router::new()
        .route("/api/sante", get(routes::sante))
        .route("/api/accueil", get(accueil::route))
        .route("/api/genres", get(routes::genres))
        .route("/api/vitrine", get(vitrine::lire))
        .route("/api/items", get(items::liste).post(ecriture::ajouter))
        .route("/api/items/{id}", get(items::fiche).patch(ecriture::modifier).delete(ecriture::retirer))
        .route("/api/tmdb/search", get(ecriture::recherche))
        .route("/api/settings/subscriptions", get(reglages::lire_abonnements).put(reglages::ecrire_abonnements))
        .route("/api/providers", get(reglages::fournisseurs))
        .route("/api/recommendations", get(recommandations::recommandations))
        .route("/api/recommendations/rows", get(recommandations::rangees))
        .route("/api/recommendations/discover", get(decouverte::route))
        .route("/api/tonight", get(ce_soir::route))
        .route("/api/calendar", get(sorties::route))
        .route("/api/triage/batch", get(tri::lot))
        .route("/api/triage/answer", post(tri::repondre))
        .route("/api/triage/undo", post(tri::annuler))
        .route("/api/duels/next", get(duels::suivant))
        .route("/api/duels/scope", get(duels::portee))
        .route("/api/duels/result", post(duels::resultat))
        .route("/api/duels/undo", post(duels::annuler))
        .route("/api/duels/reset", post(duels::reinitialiser))
        .route("/api/duels/restore", post(duels::retablir))
        .route("/api/playlists", get(playlists::liste).post(playlists::creer))
        .route("/api/playlists/restore", post(playlists::retablir))
        .route("/api/playlists/{id}", get(playlists::fiche).patch(playlists::modifier).delete(playlists::supprimer))
        .route("/api/playlists/{id}/items", post(playlists::ajouter).delete(playlists::retirer).put(playlists::ordonner))
        .route("/api/playlists/{id}/rate", post(playlists::noter))
        .route("/api/playlists/{id}/watch", post(playlists::voir))
        .route("/api/playlists/{id}/suggestions", get(playlists::suggestions).post(playlists::ecarter_suggestion))
        .route("/api/dismissals", get(ecartes::lire).post(ecartes::ecarter).delete(ecartes::reafficher))
        .route("/api/impressions", post(fraicheur::affichages))
        .route("/api/opened", post(fraicheur::ouverture))
        .route("/api/profile/feedback", get(journal::profil))
        .route("/api/classement", get(classement::lire))
        .route("/api/people/opinions", get(personnes::lire).put(personnes::poser).delete(personnes::retirer))
        .route("/api/people/opinions/reset", post(personnes::reinitialiser))
        .route("/api/people/opinions/restore", post(personnes::retablir))
        .route("/api/duels/people/next", get(duels_personnes::suivant))
        .route("/api/duels/people/scope", get(duels_personnes::portee))
        .route("/api/duels/people/result", post(duels_personnes::resultat))
        .route("/api/duels/people/reset", post(duels_personnes::reinitialiser))
        .route("/api/duels/people/restore", post(duels_personnes::retablir))
        .route("/api/duels/tier/next", get(paliers::suivant))
        .route("/api/duels/tier/band", post(paliers::repartir))
        .route("/api/duels/tier/quad", post(paliers::quatuor_route))
}
