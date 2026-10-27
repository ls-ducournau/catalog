//! Accès à la base : un pool par instance, et une transaction par requête qui pose l'identité de
//! l'utilisateur puis passe au rôle `authenticated`. Les règles d'accès par ligne s'appliquent alors :
//! une requête ne voit et n'écrit que les lignes de son propriétaire (specs/catalog-v2-donnees.md).
//!
//! RÈGLE : une route qui touche aux tables personnelles passe TOUJOURS par `transaction()`. Le pool
//! se connecte avec un rôle qui contourne les règles d'accès ; seule cette fonction les rétablit.
use crate::{auth::Utilisateur, erreur::Erreur};
use sqlx::{
    PgPool, Postgres, Transaction,
    postgres::{PgConnectOptions, PgPoolOptions},
};
use std::{str::FromStr, time::Duration};
use tokio::sync::OnceCell;

static POOL: OnceCell<PgPool> = OnceCell::const_new();

pub async fn pool() -> Result<&'static PgPool, Erreur> {
    POOL.get_or_try_init(|| async {
        let url = std::env::var("DATABASE_URL").map_err(|_| Erreur::Interne("DATABASE_URL absente".into()))?;
        // Le pooler en mode transaction ne garde pas les requêtes préparées d'une connexion à l'autre.
        let options = PgConnectOptions::from_str(&url)?.statement_cache_capacity(0);
        Ok::<_, Erreur>(
            PgPoolOptions::new()
                .max_connections(5)
                .acquire_timeout(Duration::from_secs(10))
                .idle_timeout(Duration::from_secs(5))
                .connect_with(options)
                .await?,
        )
    })
    .await
}

/// Ouvre une transaction au nom de l'utilisateur. Rien n'est écrit tant qu'on n'appelle pas `commit()`.
pub async fn transaction(utilisateur: &Utilisateur) -> Result<Transaction<'static, Postgres>, Erreur> {
    let mut tx = pool().await?.begin().await?;
    sqlx::query("select set_config('request.jwt.claims', $1, true)").bind(&utilisateur.revendications).persistent(false).execute(&mut *tx).await?;
    sqlx::query("set local role authenticated").persistent(false).execute(&mut *tx).await?;
    Ok(tx)
}
