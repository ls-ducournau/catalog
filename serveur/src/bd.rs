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

/// Une transaction au nom de l'utilisateur, qui se TERMINE toujours : `valider()` l'enregistre, `annuler()`
/// la défait, et si le garde est simplement détruit (sortie anticipée, `?` sur une erreur), un rollback
/// explicite est lancé. Abandonner une transaction sqlx sans rollback garde sa connexion : constaté, le
/// pool de 5 connexions s'épuisait après 6 requêtes qui sortaient tôt (404).
pub struct Tx(Option<Transaction<'static, Postgres>>);

impl Tx {
    pub async fn valider(mut self) -> Result<(), Erreur> {
        if let Some(tx) = self.0.take() {
            tx.commit().await?;
        }
        Ok(())
    }

    pub async fn annuler(mut self) -> Result<(), Erreur> {
        if let Some(tx) = self.0.take() {
            tx.rollback().await?;
        }
        Ok(())
    }
}

impl std::ops::Deref for Tx {
    type Target = Transaction<'static, Postgres>;
    fn deref(&self) -> &Self::Target {
        self.0.as_ref().expect("transaction terminée")
    }
}

impl std::ops::DerefMut for Tx {
    fn deref_mut(&mut self) -> &mut Self::Target {
        self.0.as_mut().expect("transaction terminée")
    }
}

impl Drop for Tx {
    fn drop(&mut self) {
        if let Some(tx) = self.0.take() {
            tokio::spawn(async move {
                let _ = tx.rollback().await;
            });
        }
    }
}

/// Une transaction du SERVEUR (rôle de connexion, hors règles d'accès), seulement pour le catalogue partagé
/// (`catalog_titles`, `catalog_people`), avec le même garde `Tx`. RÈGLE : jamais de requête avec paramètres
/// sur le pool hors transaction. Derrière le pooler de Supabase en mode transaction, sqlx prépare puis
/// exécute en deux échanges séparés par un `Sync` : hors transaction, ils peuvent partir sur deux connexions
/// différentes, partagées avec d'autres clients (constaté : « bind message supplies 15 parameters, but
/// prepared statement "" requires 1 », « unnamed prepared statement does not exist »). Une transaction
/// garde la même connexion du début à la fin.
pub async fn transaction_serveur() -> Result<Tx, Erreur> {
    Ok(Tx(Some(pool().await?.begin().await?)))
}

/// Ouvre une transaction au nom de l'utilisateur : ses revendications, puis le rôle `authenticated`.
pub async fn transaction(utilisateur: &Utilisateur) -> Result<Tx, Erreur> {
    let mut tx = pool().await?.begin().await?;
    sqlx::query("select set_config('request.jwt.claims', $1, true)").bind(&utilisateur.revendications).persistent(false).execute(&mut *tx).await?;
    sqlx::query("set local role authenticated").persistent(false).execute(&mut *tx).await?;
    Ok(Tx(Some(tx)))
}
