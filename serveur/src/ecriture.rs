//! Écriture dans la bibliothèque : noter ou changer le statut, ajouter un titre depuis TMDB, le retirer,
//! et la recherche TMDB qui sert à l'ajout. Mêmes règles et mêmes réponses que la v1, SANS l'ancien
//! service de notes (FR-1) : la base est la seule source. Contrat : `parite/ecritures*.mjs`. La fiche
//! TMDB d'un titre ajouté est écrite dans le catalogue partagé par `catalogue.rs`.
//!
//! Chaque transaction est un garde `bd::Tx` : `valider()` l'enregistre ; toute autre sortie (un 404,
//! une erreur) l'annule explicitement (voir bd.rs).
use crate::{
    auth::Utilisateur,
    bd::{self, Tx},
    catalogue,
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

// « home » : une suggestion de l'accueil (spec accueil-vitrine-connexion-v1 § 3).
const SOURCES_AJOUT: [&str; 7] = ["search", "discover", "suggestions", "triage", "tonight", "calendar", "home"];

fn reponse(statut: u16, corps: Value) -> Response {
    (StatusCode::from_u16(statut).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), Json(corps)).into_response()
}
fn invalide() -> Response {
    reponse(400, json!({ "error": "invalid_request" }))
}
fn introuvable() -> Response {
    reponse(404, json!({ "error": "not_found" }))
}

/// L'identifiant d'un titre dans l'adresse, lu comme `Number(id)` en v1 (« 12 », « 12.0 », « 0xC ») ;
/// `None` s'il ne désigne aucun titre possible.
pub(crate) fn identifiant(texte: &str) -> Option<i64> {
    let n = tmdb::nombre_js(texte);
    (n.is_finite() && n == n.trunc() && n.abs() < 9.0e15).then_some(n as i64)
}

/// Lit un titre de la bibliothèque du compte (la transaction pose déjà l'identité).
async fn lire(tx: &mut Tx, id: i64) -> Result<Option<Value>, Erreur> {
    let ligne = sqlx::query(&format!("select {COLONNES} from public.library_view where id = $1")).bind(id).persistent(false).fetch_optional(&mut ***tx).await?;
    ligne.as_ref().map(titre).transpose()
}

/// Journalise un geste sur un titre (`logEvent`). Sans contexte (`Value::Null`), la colonne reste NULL SQL,
/// comme la v1 (`context ? JSON.stringify(context) : null`) ; la contrainte refuse un `null` JSON.
pub(crate) async fn journal(tx: &mut Tx, genre: &str, id: i64, contexte: Value) -> Result<(), Erreur> {
    sqlx::query("insert into public.events (kind, subject_type, subject_id, context) values ($1, 'item', $2, $3)")
        .bind(genre)
        .bind(id.to_string())
        .bind(Some(contexte).filter(|c| !c.is_null()))
        .persistent(false)
        .execute(&mut ***tx)
        .await?;
    Ok(())
}

/// Le titre de la bibliothèque du compte qui porte ce numéro TMDB, s'il y en a un (`findByTmdbId` : le
/// premier arrivé, quel que soit son type).
async fn chercher_existant(utilisateur: &Utilisateur, tmdb_id: i64) -> Result<Option<Value>, Erreur> {
    let Ok(tmdb_id) = i32::try_from(tmdb_id) else { return Ok(None) };
    let mut tx = bd::transaction(utilisateur).await?;
    let ligne = sqlx::query(&format!("select {COLONNES} from public.library_view where tmdb_id = $1 order by id limit 1")).bind(tmdb_id).persistent(false).fetch_optional(&mut **tx).await?;
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
    let Some(id) = identifiant(&id) else { return Ok(introuvable()) };
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
    journal(&mut tx, "removed", id, Value::Null).await?;
    tx.valider().await?;
    Ok(true)
}

/// DELETE /api/items/{id}
pub async fn retirer(utilisateur: Utilisateur, Path(id): Path<String>) -> Result<Response, Erreur> {
    let Some(id) = identifiant(&id) else { return Ok(introuvable()) };
    Ok(if retirer_titre(&utilisateur, id).await? { Json(json!({ "ok": true })).into_response() } else { introuvable() })
}

/// Le résultat d'un ajout.
pub enum Ajout {
    Cree(Value),
    Existant(Value),
    TmdbIntrouvable,
}

/// `addTitleToLibrary` : ajoute un titre TMDB à la bibliothèque (à voir). Déjà présent : rien ne change.
/// `source` : d'où vient l'ajout (journal).
///
/// La fiche va dans le catalogue partagé, écrit seulement par le serveur. Titre absent du catalogue : la
/// fiche complète de la v1 (`getDetails`, `getDetailsFr`, `getTitleData` en parallèle), avec ses dates de
/// récupération. Titre déjà au catalogue (un autre compte l'a, ou on l'a retiré) : sa fiche est gardée,
/// complétée seulement de ce qui manque ou a plus de 7 jours (FR-4 : rafraîchie une fois pour tous ;
/// `?refresh=1` la rafraîchit à la demande).
pub async fn ajouter_titre(utilisateur: &Utilisateur, tmdb_id: i64, type_: &str, source: &str) -> Result<Ajout, Erreur> {
    // Déjà dans la bibliothèque ? Une courte transaction, avant tout appel réseau.
    if let Some(item) = chercher_existant(utilisateur, tmdb_id).await? {
        return Ok(Ajout::Existant(item));
    }

    let existante = if tmdb_id > 0 && i32::try_from(tmdb_id).is_ok() { catalogue::chercher(type_, tmdb_id).await? } else { None };
    let titre_id = match existante {
        Some(fiche) => {
            catalogue::completer(&fiche, true).await?;
            fiche.title_id.ok_or_else(|| Erreur::Interne("fiche sans identifiant".into()))?
        }
        None => {
            let (details, fr, donnees) = tokio::join!(tmdb::details(tmdb_id, type_), tmdb::details_fr(tmdb_id, type_), tmdb::donnees_titre(tmdb_id, type_));
            let Some(details) = details else { return Ok(Ajout::TmdbIntrouvable) };
            let fiche = catalogue::fiche_ajoutee(&details, fr.as_ref(), donnees.as_ref());
            catalogue::inserer(&fiche, details.imdb_id.as_deref()).await?
        }
    };

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
    journal(&mut tx, "added", id, json!({ "source": source, "tmdbId": tmdb_id, "type": type_ })).await?;
    let Some(item) = lire(&mut tx, id).await? else { return Err(Erreur::Interne("titre ajouté introuvable".into())) };
    tx.valider().await?;
    Ok(Ajout::Cree(item))
}

/// `tmdb_not_found` : 502, comme toute erreur d'ajout de la v1 autre que `not_found` (`actionErrorStatus`).
pub fn tmdb_introuvable() -> Response {
    reponse(502, json!({ "error": "tmdb_not_found" }))
}

/// POST /api/items
pub async fn ajouter(utilisateur: Utilisateur, corps: Bytes) -> Result<Response, Erreur> {
    let Ok(corps) = serde_json::from_slice::<Value>(&corps) else { return Ok(invalide()) };
    // `typeof tmdbId === "number"` : tout nombre passe. Un nombre qui ne peut pas être un numéro TMDB
    // (décimal, trop grand) ne trouve rien chez TMDB en v1 : même réponse, sans l'appel.
    let (Some(Value::Number(numero)), Some(type_)) = (corps.get("tmdbId"), corps.get("type").and_then(Value::as_str)) else { return Ok(invalide()) };
    if type_ != "Movie" && type_ != "TV Series" {
        return Ok(invalide());
    }
    let source = corps.get("source").and_then(Value::as_str).filter(|s| SOURCES_AJOUT.contains(s)).unwrap_or("search");
    let tmdb_id = numero.as_i64().or_else(|| numero.as_f64().filter(|f| f.fract() == 0.0 && f.abs() < 9.0e15).map(|f| f as i64));
    let Some(tmdb_id) = tmdb_id else { return Ok(tmdb_introuvable()) };
    Ok(match ajouter_titre(&utilisateur, tmdb_id, type_, source).await? {
        Ajout::Cree(item) => reponse(201, json!({ "item": item, "alreadyExists": false })),
        Ajout::Existant(item) => reponse(200, json!({ "item": item, "alreadyExists": true })),
        Ajout::TmdbIntrouvable => tmdb_introuvable(),
    })
}

/// GET /api/tmdb/search?q=&page= : résultats de TMDB (titres, et filmographie d'une personne cherchée
/// par son nom), avec « déjà dans ta bibliothèque » (`libraryId`, `libraryStatus`).
pub async fn recherche(utilisateur: Utilisateur, Query(p): Query<HashMap<String, String>>) -> Result<Json<Value>, Erreur> {
    let q = p.get("q").map(String::as_str).unwrap_or("");
    // `Number(searchParams.get("page") ?? "1") || 1`
    let page = tmdb::nombre_js(p.get("page").map(String::as_str).unwrap_or("1"));
    let page = if page.is_nan() || page == 0.0 { 1.0 } else { page };
    let (resultats, total_pages) = tmdb::rechercher(q, page).await;

    // `getLibraryInfoByTmdbIds` : par numéro TMDB, quel que soit le type ; à numéro égal, le dernier arrivé.
    let ids: Vec<i32> = resultats.iter().filter_map(|r| i32::try_from(r.tmdb_id).ok()).collect();
    let mut connus: HashMap<i64, (i64, Option<String>)> = HashMap::new();
    if !ids.is_empty() {
        let mut tx = bd::transaction(&utilisateur).await?;
        let lignes = sqlx::query("select id, tmdb_id, watch_status from public.library_view where tmdb_id = any($1) order by id").bind(&ids).persistent(false).fetch_all(&mut **tx).await?;
        tx.valider().await?;
        for l in &lignes {
            connus.insert(i64::from(l.try_get::<i32, _>("tmdb_id")?), (l.try_get("id")?, l.try_get("watch_status")?));
        }
    }

    let results: Vec<Value> = resultats
        .iter()
        .map(|r| {
            let dedans = connus.get(&r.tmdb_id);
            json!({
                "tmdbId": r.tmdb_id, "type": r.type_, "isDocumentary": r.documentaire, "genres": r.genres, "title": r.titre, "year": r.annee,
                "posterUrl": tmdb::adresse_affiche(r.affiche.as_deref()), "voteAverage": r.note, "voteCount": r.votes, "overview": r.synopsis,
                "libraryId": dedans.map(|d| d.0), "libraryStatus": dedans.and_then(|d| d.1.clone()),
                "personCredit": r.credit.as_ref().map(tmdb::Credit::json),
            })
        })
        .collect();
    Ok(Json(json!({ "results": results, "page": tmdb::json_nombre_js(page), "totalPages": total_pages })))
}
