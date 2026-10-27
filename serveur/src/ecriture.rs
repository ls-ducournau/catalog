//! Écriture dans la bibliothèque : noter ou changer le statut, ajouter un titre depuis TMDB, le retirer,
//! et la recherche TMDB qui sert à l'ajout. Mêmes règles et mêmes réponses que la v1, SANS l'ancien
//! service de notes (FR-1) : la base est la seule source. Contrat : `parite/ecritures*.mjs`.
//!
//! Chaque transaction est un garde `bd::Tx` : `valider()` l'enregistre ; toute autre sortie (un 404,
//! une erreur) l'annule explicitement (voir bd.rs).
use crate::{
    auth::Utilisateur,
    bd::{self, Tx},
    erreur::Erreur,
    items::{COLONNES, NOTES, titre},
    tmdb,
};
use axum::{
    Json,
    body::Bytes,
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use sqlx::{Postgres, QueryBuilder, Row};
use std::collections::HashMap;

const AFFICHE: &str = "https://image.tmdb.org/t/p/w500";
const SOURCES_AJOUT: [&str; 6] = ["search", "discover", "suggestions", "triage", "tonight", "calendar"];

fn reponse(statut: u16, corps: Value) -> Response {
    (StatusCode::from_u16(statut).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), Json(corps)).into_response()
}
fn invalide() -> Response {
    reponse(400, json!({ "error": "invalid_request" }))
}
fn introuvable() -> Response {
    reponse(404, json!({ "error": "not_found" }))
}

/// Lit un titre de la bibliothèque du compte (la transaction pose déjà l'identité).
async fn lire(tx: &mut Tx, id: i64) -> Result<Option<Value>, Erreur> {
    let ligne = sqlx::query(&format!("select {COLONNES} from public.library_view where id = $1")).bind(id).persistent(false).fetch_optional(&mut ***tx).await?;
    ligne.as_ref().map(titre).transpose()
}

pub(crate) async fn journal(tx: &mut Tx, genre: &str, id: i64, contexte: Value) -> Result<(), Erreur> {
    sqlx::query("insert into public.events (kind, subject_type, subject_id, context) values ($1, 'item', $2, $3)")
        .bind(genre)
        .bind(id.to_string())
        .bind(contexte)
        .persistent(false)
        .execute(&mut ***tx)
        .await?;
    Ok(())
}

/// Le titre de la bibliothèque du compte qui porte ce numéro TMDB, s'il y en a un.
async fn chercher_existant(utilisateur: &Utilisateur, tmdb_id: i64) -> Result<Option<Value>, Erreur> {
    let mut tx = bd::transaction(utilisateur).await?;
    let ligne = sqlx::query(&format!("select {COLONNES} from public.library_view where tmdb_id = $1 limit 1")).bind(tmdb_id as i32).persistent(false).fetch_optional(&mut **tx).await?;
    let item = ligne.as_ref().map(titre).transpose()?;
    tx.valider().await?;
    Ok(item)
}

/// PATCH /api/items/{id} : statut, note, ressenti.
///
/// Règles de la v1 : repasser un titre à « à voir » efface sa note ; une note ne se pose que sur un
/// titre vu (ou qui le devient dans le même appel), sinon elle est ignorée ; l'effacer est toujours
/// permis. Une note posée ou effacée, ou un statut changé, est journalisé.
pub async fn modifier(utilisateur: Utilisateur, Path(id): Path<String>, corps: Bytes) -> Result<Response, Erreur> {
    let Ok(id) = id.parse::<i64>() else { return Ok(introuvable()) };
    let Ok(corps) = serde_json::from_slice::<Value>(&corps) else { return Ok(invalide()) };
    if !corps.is_object() {
        return Ok(invalide());
    }
    let statut = match corps.get("watchStatus") {
        None => None,
        Some(Value::String(s)) if s == "Watched" || s == "Unwatched" => Some(s.as_str()),
        _ => return Ok(invalide()),
    };
    let note: Option<Option<i16>> = match corps.get("rating") {
        None => None,
        Some(Value::Null) => Some(None),
        Some(Value::String(s)) => match NOTES.iter().position(|n| n == s) {
            Some(i) => Some(Some(i as i16)),
            None => return Ok(invalide()),
        },
        _ => return Ok(invalide()),
    };
    let ressenti: Option<Option<String>> = match corps.get("ressenti") {
        None => None,
        Some(Value::Null) => Some(None),
        Some(Value::String(s)) => Some(Some(s.clone())),
        _ => return Ok(invalide()),
    };
    let journaliser = corps.get("rating").is_some() || corps.get("watchStatus").is_some();

    let mut tx = bd::transaction(&utilisateur).await?;
    let actuel: Option<(Option<String>,)> =
        sqlx::query_as("select watch_status from public.library_items where id = $1").bind(id).persistent(false).fetch_optional(&mut **tx).await?;
    let Some((statut_actuel,)) = actuel else { return Ok(introuvable()) };

    let mut requete = QueryBuilder::<Postgres>::new("update public.library_items set updated_at = now()");
    let mut modifie = false;
    if let Some(s) = statut {
        requete.push(", watch_status = ").push_bind(s);
        modifie = true;
    }
    if statut == Some("Unwatched") {
        requete.push(", rating = null");
        modifie = true;
    } else if let Some(n) = note {
        match n {
            None => {
                requete.push(", rating = null");
                modifie = true;
            }
            Some(n) if statut.or(statut_actuel.as_deref()) == Some("Watched") => {
                requete.push(", rating = ").push_bind(n);
                modifie = true;
            }
            Some(_) => {} // une note sur un titre à voir est ignorée
        }
    }
    if let Some(r) = ressenti {
        requete.push(", ressenti = ").push_bind(r);
        modifie = true;
    }
    if modifie {
        requete.push(" where id = ").push_bind(id);
        requete.build().persistent(false).execute(&mut **tx).await?;
    }
    let Some(item) = lire(&mut tx, id).await? else { return Ok(introuvable()) };
    if modifie && journaliser {
        journal(&mut tx, "rated", id, json!({ "rating": item["rating"], "watchStatus": item["watchStatus"] })).await?;
    }
    tx.valider().await?;
    Ok(Json(item).into_response())
}

/// Retire un titre de la bibliothèque du compte. Ses duels, ses places dans les playlists et ses
/// suggestions écartées partent avec lui (clés étrangères en cascade) ; la fiche partagée du catalogue
/// reste, d'autres comptes peuvent l'utiliser. `false` si le titre n'était pas là.
pub async fn retirer_titre(utilisateur: &Utilisateur, id: i64) -> Result<bool, Erreur> {
    let mut tx = bd::transaction(utilisateur).await?;
    let retire: Option<(i64,)> = sqlx::query_as("delete from public.library_items where id = $1 returning id").bind(id).persistent(false).fetch_optional(&mut **tx).await?;
    if retire.is_none() {
        return Ok(false);
    }
    journal(&mut tx, "removed", id, json!({})).await?;
    tx.valider().await?;
    Ok(true)
}

/// DELETE /api/items/{id}
pub async fn retirer(utilisateur: Utilisateur, Path(id): Path<String>) -> Result<Response, Erreur> {
    let Ok(id) = id.parse::<i64>() else { return Ok(introuvable()) };
    Ok(if retirer_titre(&utilisateur, id).await? { Json(json!({ "ok": true })).into_response() } else { introuvable() })
}

/// Le résultat d'un ajout.
pub enum Ajout {
    Cree(Value),
    Existant(Value),
    TmdbIntrouvable,
}

/// Ajoute un titre TMDB à la bibliothèque (à voir). Déjà présent : rien ne change. La fiche TMDB entre
/// dans le catalogue partagé, écrit seulement par le serveur. `source` : d'où vient l'ajout (journal).
pub async fn ajouter_titre(utilisateur: &Utilisateur, tmdb_id: i64, type_: &str, source: &str) -> Result<Ajout, Erreur> {
    // Déjà dans la bibliothèque ? Une courte transaction, avant tout appel réseau.
    if let Some(item) = chercher_existant(utilisateur, tmdb_id).await? {
        return Ok(Ajout::Existant(item));
    }

    let Some(fiche) = tmdb::fiche(tmdb_id, type_).await else { return Ok(Ajout::TmdbIntrouvable) };

    // Le catalogue partagé : écrit avec le rôle du serveur (hors règles par ligne), jamais avec celui de l'utilisateur.
    let titre_id: i64 = sqlx::query_scalar(
        "insert into public.catalog_titles (type, tmdb_id, imdb_id, name, year, poster_path, genres, director, tmdb_rating, vote_count, overview)
         values ($1, $2::int, $3, $4, $5, $6, $7, $8, $9, $10::int, $11)
         on conflict (type, tmdb_id) do update set tmdb_id = excluded.tmdb_id returning id",
    )
    .bind(fiche.type_)
    .bind(fiche.tmdb_id as i32)
    .bind(&fiche.imdb_id)
    .bind(&fiche.titre)
    .bind(&fiche.annee)
    .bind(&fiche.affiche)
    .bind(json!(fiche.genres))
    .bind(&fiche.realisation)
    .bind(fiche.note)
    .bind(fiche.votes.map(|v| v as i32))
    .bind(&fiche.synopsis)
    .persistent(false)
    .fetch_one(bd::pool().await?)
    .await?;

    // L'ajout dans la bibliothèque du compte. Un ajout simultané du même titre est refusé par l'index
    // d'unicité (23505) : on rend alors celui qui existe.
    let mut tx = bd::transaction(utilisateur).await?;
    let insertion: Result<(i64,), sqlx::Error> =
        sqlx::query_as("insert into public.library_items (title_id, watch_status) values ($1, 'Unwatched') returning id").bind(titre_id).persistent(false).fetch_one(&mut **tx).await;
    let id = match insertion {
        Ok((id,)) => id,
        Err(sqlx::Error::Database(e)) if e.code().as_deref() == Some("23505") => {
            tx.annuler().await?;
            return Ok(match chercher_existant(utilisateur, tmdb_id).await? {
                Some(item) => Ajout::Existant(item),
                None => return Err(Erreur::Interne("ajout simultané introuvable".into())),
            });
        }
        Err(e) => return Err(e.into()),
    };
    journal(&mut tx, "added", id, json!({ "source": source })).await?;
    let Some(item) = lire(&mut tx, id).await? else { return Err(Erreur::Interne("titre ajouté introuvable".into())) };
    tx.valider().await?;
    Ok(Ajout::Cree(item))
}

/// POST /api/items
pub async fn ajouter(utilisateur: Utilisateur, corps: Bytes) -> Result<Response, Erreur> {
    let Ok(corps) = serde_json::from_slice::<Value>(&corps) else { return Ok(invalide()) };
    let (Some(tmdb_id), Some(type_)) = (corps.get("tmdbId").and_then(Value::as_i64), corps.get("type").and_then(Value::as_str)) else { return Ok(invalide()) };
    if type_ != "Movie" && type_ != "TV Series" {
        return Ok(invalide());
    }
    let source = corps.get("source").and_then(Value::as_str).filter(|s| SOURCES_AJOUT.contains(s)).unwrap_or("search");
    Ok(match ajouter_titre(&utilisateur, tmdb_id, type_, source).await? {
        Ajout::Cree(item) => reponse(201, json!({ "item": item, "alreadyExists": false })),
        Ajout::Existant(item) => reponse(200, json!({ "item": item, "alreadyExists": true })),
        Ajout::TmdbIntrouvable => reponse(404, json!({ "error": "tmdb_not_found" })),
    })
}

/// GET /api/tmdb/search?q=&page= : résultats de TMDB, avec « déjà dans ta bibliothèque » (`libraryId`).
pub async fn recherche(utilisateur: Utilisateur, Query(p): Query<HashMap<String, String>>) -> Result<Json<Value>, Erreur> {
    let q = p.get("q").map(String::as_str).unwrap_or("");
    let page = p.get("page").and_then(|v| v.parse::<i64>().ok()).filter(|n| *n > 0).unwrap_or(1);
    let (resultats, total_pages) = tmdb::rechercher(q, page).await;

    let ids: Vec<i32> = resultats.iter().map(|r| r.tmdb_id as i32).collect();
    let mut tx = bd::transaction(&utilisateur).await?;
    let lignes = sqlx::query("select id, tmdb_id, watch_status from public.library_view where tmdb_id = any($1)").bind(&ids).persistent(false).fetch_all(&mut **tx).await?;
    tx.valider().await?;
    let mut connus: HashMap<i64, (i64, Option<String>)> = HashMap::new();
    for l in &lignes {
        connus.entry(l.try_get::<i32, _>("tmdb_id")? as i64).or_insert((l.try_get("id")?, l.try_get("watch_status")?));
    }

    let results: Vec<Value> = resultats
        .iter()
        .map(|r| {
            let dedans = connus.get(&r.tmdb_id);
            json!({
                "tmdbId": r.tmdb_id, "type": r.type_, "isDocumentary": r.documentaire, "genres": r.genres, "title": r.titre, "year": r.annee,
                "posterUrl": r.affiche.as_ref().map(|a| format!("{AFFICHE}{a}")), "voteAverage": r.note, "voteCount": r.votes, "overview": r.synopsis,
                "libraryId": dedans.map(|d| d.0), "libraryStatus": dedans.and_then(|d| d.1.clone()), "personCredit": null,
            })
        })
        .collect();
    Ok(Json(json!({ "results": results, "page": page, "totalPages": total_pages })))
}
