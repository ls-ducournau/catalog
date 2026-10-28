//! Serveur local pour essayer la v2 sans Vercel : cargo run --release --example local
//! Variables : DATABASE_URL, SUPABASE_URL, TMDB_ACCESS_TOKEN, lues dans le fichier `CATALOG_ENV`
//! (par défaut ../poc/.env.local) si elles manquent ; PORT (par défaut 3004).
use std::{env, fs};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let fichier = env::var("CATALOG_ENV").unwrap_or_else(|_| "../poc/.env.local".into());
    if let Ok(texte) = fs::read_to_string(&fichier) {
        for ligne in texte.lines() {
            if let Some((cle, valeur)) = ligne.split_once('=') {
                if matches!(cle, "DATABASE_URL" | "SUPABASE_URL" | "TMDB_ACCESS_TOKEN") && env::var(cle).is_err() {
                    unsafe { env::set_var(cle, valeur.trim()) };
                }
            }
        }
    }
    let port = env::var("PORT").unwrap_or_else(|_| "3004".into());
    let ecoute = tokio::net::TcpListener::bind(format!("127.0.0.1:{port}")).await?;
    println!("serveur v2 local sur http://127.0.0.1:{port}");
    // La page d'essai est servie par Vercel (dossier public/) ; en local, ce serveur la sert aussi.
    let page = axum::Router::new().route("/", axum::routing::get(|| async { axum::response::Html(include_str!("../public/index.html")) }));
    axum::serve(ecoute, page.merge(catalog::app())).await?;
    Ok(())
}
