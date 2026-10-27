// POC (phase 0) : la fonction la plus simple, pour mesurer le démarrage à froid d'un binaire Rust.
// spec: specs/catalog-v2-rust-supabase.md (§6, phase 0)
use serde_json::{Value, json};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use vercel_runtime::{Error, Request, run, service_fn};

/// Nombre d'appels servis par cette instance : 1 = instance neuve (démarrage à froid).
static APPELS: AtomicU64 = AtomicU64::new(0);

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(service_fn(handler)).await
}

async fn handler(_req: Request) -> Result<Value, Error> {
    let n = APPELS.fetch_add(1, Ordering::SeqCst) + 1;
    let ms = SystemTime::now().duration_since(UNIX_EPOCH)?.as_millis() as u64;
    Ok(json!({ "ok": true, "appel_de_l_instance": n, "horodatage_ms": ms }))
}
