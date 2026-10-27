// POC (phase 0) : lecture de Supabase par le pooler en mode transaction.
// Trois mesures : ouverture de la connexion, requêtes sur le pool réutilisé, et le schéma de sécurité
// prévu (transaction qui pose les revendications puis `set local role authenticated`).
// spec: specs/catalog-v2-rust-supabase.md (§6 phase 0), specs/catalog-v2-donnees.md (sécurité)
use serde_json::{Value, json};
use sqlx::postgres::{PgConnectOptions, PgPool, PgPoolOptions};
use sqlx::{Executor, Row};
use std::str::FromStr;
use std::time::{Duration, Instant};
use tokio::sync::OnceCell;
use vercel_runtime::{Error, Request, run, service_fn};

/// Le pool vit autant que l'instance : les appels suivants le réutilisent (Fluid compute).
static POOL: OnceCell<PgPool> = OnceCell::const_new();

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(service_fn(handler)).await
}

async fn pool() -> Result<(&'static PgPool, bool), Error> {
    let neuf = !POOL.initialized();
    let pool = POOL
        .get_or_try_init(|| async {
            let url = std::env::var("DATABASE_URL").map_err(|_| "DATABASE_URL absente")?;
            // Le pooler en mode transaction ne garde pas les requêtes préparées d'une connexion à l'autre.
            let options = PgConnectOptions::from_str(&url)?.statement_cache_capacity(0);
            PgPoolOptions::new()
                .max_connections(3)
                .acquire_timeout(Duration::from_secs(10))
                .idle_timeout(Duration::from_secs(5))
                .connect_with(options)
                .await
                .map_err(|e| -> Error { e.into() })
        })
        .await?;
    Ok((pool, neuf))
}

async fn handler(_req: Request) -> Result<Value, Error> {
    let t0 = Instant::now();
    let (pool, pool_neuf) = pool().await?;
    let t_pool = t0.elapsed().as_millis() as u64;

    // Requêtes simples, sans requête préparée.
    let t1 = Instant::now();
    let row = sqlx::query("select version() as v, current_user as u, now()::text as t").persistent(false).fetch_one(pool).await?;
    let premiere_requete_ms = t1.elapsed().as_millis() as u64;
    let t2 = Instant::now();
    sqlx::query("select 1").persistent(false).fetch_one(pool).await?;
    let seconde_requete_ms = t2.elapsed().as_millis() as u64;

    // Le schéma de sécurité prévu : revendications du jeton, puis changement de rôle, dans une transaction.
    let t3 = Instant::now();
    let mut tx = pool.begin().await?;
    tx.execute("select set_config('request.jwt.claims', '{\"sub\":\"00000000-0000-0000-0000-000000000001\",\"role\":\"authenticated\"}', true)").await?;
    let role = match tx.execute("set local role authenticated").await {
        Ok(_) => sqlx::query("select current_user as u, auth.uid()::text as uid").persistent(false).fetch_one(&mut *tx).await.map(|r| {
            json!({ "ok": true, "utilisateur": r.get::<String, _>("u"), "auth_uid": r.try_get::<Option<String>, _>("uid").ok().flatten() })
        }),
        Err(e) => return Ok(json!({ "ok": false, "etape": "set local role", "erreur": e.to_string() })),
    };
    tx.rollback().await?;
    let transaction_ms = t3.elapsed().as_millis() as u64;

    Ok(json!({
        "ok": true,
        "pool_neuf": pool_neuf,
        "pool_ms": t_pool,
        "premiere_requete_ms": premiere_requete_ms,
        "seconde_requete_ms": seconde_requete_ms,
        "transaction_role_ms": transaction_ms,
        "postgres": row.get::<String, _>("v"),
        "utilisateur_connecte": row.get::<String, _>("u"),
        "role_applique": role.unwrap_or_else(|e| json!({ "ok": false, "erreur": e.to_string() })),
        "total_ms": t0.elapsed().as_millis() as u64
    }))
}
