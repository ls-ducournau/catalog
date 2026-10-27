// Point d'entrée du serveur de la v2 : un service Axum unique, derrière Vercel.
// spec: specs/catalog-v2-rust-supabase.md (§2 architecture)
use tower::ServiceBuilder;
use vercel_runtime::{Error, axum::VercelLayer};

#[tokio::main]
async fn main() -> Result<(), Error> {
    let app = ServiceBuilder::new().layer(VercelLayer::new()).service(catalog::app());
    vercel_runtime::run(app).await
}
