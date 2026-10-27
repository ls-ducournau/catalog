//! Tri rapide : un lot de cartes, la réponse à une carte, et de quoi la défaire. Reprend
//! `src/lib/triageService.ts` et ses trois routes.
//!
//! Porté : les cartes « titres déjà vus à noter » (`seen`) et « personnes » (`person`), toutes les réponses
//! (y compris « ça me tente » sur un titre à découvrir, qui l'ajoute sans l'ancien service de notes) et
//! l'annulation. Pas encore porté : les cartes « à découvrir » (`unseen`), qui reposent sur le modèle de
//! préférence : le lot est vide pour l'instant.
use crate::{
    auth::Utilisateur,
    bd::{self, Tx},
    duels::{categorie, parse_categorie},
    ecriture::{self, Ajout},
    erreur::Erreur,
    items::{NOTES, annee_affichee},
};
use axum::{
    Json,
    body::Bytes,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use sqlx::{Postgres, QueryBuilder, Row};
use std::collections::{HashMap, HashSet};

const AFFICHE: &str = "https://image.tmdb.org/t/p/w500";
/// Comme pour les duels de personnes : un avis doit reposer sur une vraie exposition.
const MIN_TITRES_PAR_PERSONNE: usize = 3;
/// Note grossière posée par « Aimé » et « Pas aimé » sur un titre déjà vu (⭐⭐⭐⭐ et ⭐⭐).
const NOTE_AIME: i16 = 4;
const NOTE_PAS_AIME: i16 = 2;

fn reponse(statut: u16, corps: Value) -> Response {
    (StatusCode::from_u16(statut).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), Json(corps)).into_response()
}
fn invalide() -> Response {
    reponse(400, json!({ "error": "invalid_request" }))
}

fn cle_tmdb(media: &str, id: i64) -> String {
    format!("{}:{id}", if media == "Movie" { "movie" } else { "tv" })
}

/// `contexte` : un objet JSON, ou `None` (NULL en base : un `null` JSON est refusé par la contrainte).
async fn evenement(tx: &mut Tx, genre: &str, sujet: &str, id: &str, contexte: Option<Value>) -> Result<(), Erreur> {
    sqlx::query("insert into public.events (kind, subject_type, subject_id, context) values ($1, $2, $3, $4)")
        .bind(genre)
        .bind(sujet)
        .bind(id)
        .bind(contexte)
        .persistent(false)
        .execute(&mut ***tx)
        .await?;
    Ok(())
}

// ---------- les cartes ----------

async fn cartes_vues(u: &Utilisateur, cat: Option<&str>, limite: i64, exclure: &HashSet<String>) -> Result<Vec<Value>, Erreur> {
    let ignores: Vec<i64> = exclure.iter().filter_map(|k| k.strip_prefix("item:")?.parse().ok()).collect();
    let mut tx = bd::transaction(u).await?;
    let mut q = QueryBuilder::<Postgres>::new(
        "select id, name, year, overview, type, genres, poster_path, trailer_info from public.library_view where watch_status = 'Watched' and rating is null",
    );
    categorie(&mut q, cat);
    if !ignores.is_empty() {
        q.push(" and id <> all(").push_bind(ignores).push(")");
    }
    q.push(" order by updated_at desc, id desc limit ").push_bind(limite);
    let lignes = q.build().persistent(false).fetch_all(&mut **tx).await?;
    tx.valider().await?;
    lignes
        .iter()
        .map(|l| {
            let id: i64 = l.try_get("id")?;
            let type_: String = l.try_get("type")?;
            let genres: Option<Value> = l.try_get("genres")?;
            let documentaire = genres.as_ref().and_then(Value::as_array).is_some_and(|g| g.iter().any(|x| x == "Documentary"));
            let annee: Option<String> = l.try_get("year")?;
            let affiche: Option<String> = l.try_get("poster_path")?;
            let trailer: Option<Value> = l.try_get("trailer_info")?;
            Ok(json!({
                "family": "seen", "key": format!("item:{id}"), "id": id,
                "title": l.try_get::<String, _>("name")?, "year": annee_affichee(annee.as_deref()),
                "posterUrl": affiche.filter(|a| !a.is_empty()).map(|a| format!("{AFFICHE}{a}")),
                "overview": l.try_get::<Option<String>, _>("overview")?,
                "category": if documentaire { "Documentary".to_owned() } else { type_ },
                "trailer": trailer.and_then(|t| t.get("trailer").cloned()).filter(|t| !t.is_null()),
            }))
        })
        .collect()
}

struct Personne {
    nom: String,
    photo: Option<String>,
    roles: [bool; 3],
    titres: Vec<(String, i32)>,
}

/// Personnes présentes dans au moins 3 titres vus, tous rôles confondus, sans avis encore ; les plus
/// présentes d'abord (les plus reconnaissables, celles dont l'avis pèsera le plus).
async fn cartes_personnes(u: &Utilisateur, limite: usize, exclure: &HashSet<String>) -> Result<Vec<Value>, Erreur> {
    let mut tx = bd::transaction(u).await?;
    let lignes = sqlx::query("select name, rating::int as note, tmdb_features from public.library_view where watch_status = 'Watched' and tmdb_features is not null order by id")
        .persistent(false)
        .fetch_all(&mut **tx)
        .await?;
    let repondues: HashSet<i64> = sqlx::query_as::<_, (i32,)>("select person_id from public.person_opinions").persistent(false).fetch_all(&mut **tx).await?.into_iter().map(|r| i64::from(r.0)).collect();
    tx.valider().await?;

    // L'ordre d'arrivée compte : il départage les personnes à égalité (comme la Map de la v1).
    let mut ordre: Vec<i64> = vec![];
    let mut gens: HashMap<i64, Personne> = HashMap::new();
    for ligne in &lignes {
        let titre: String = ligne.try_get("name")?;
        let etoiles = ligne.try_get::<Option<i32>, _>("note")?.unwrap_or(-1);
        let Some(traits) = ligne.try_get::<Option<Value>, _>("tmdb_features")? else { continue };
        for (role, cle) in ["cast", "directors", "producers"].iter().enumerate() {
            for p in traits.get(*cle).and_then(Value::as_array).into_iter().flatten() {
                let (Some(id), Some(nom)) = (p.get("id").and_then(Value::as_i64), p.get("name").and_then(Value::as_str)) else { continue };
                let photo = p.get("profilePath").and_then(Value::as_str).map(str::to_owned);
                if !gens.contains_key(&id) {
                    ordre.push(id);
                }
                let entree = gens.entry(id).or_insert_with(|| Personne { nom: nom.to_owned(), photo: None, roles: [false; 3], titres: vec![] });
                entree.roles[role] = true;
                if entree.photo.is_none() {
                    entree.photo = photo;
                }
                match entree.titres.iter_mut().find(|t| t.0 == titre) {
                    Some(t) => t.1 = etoiles,
                    None => entree.titres.push((titre.clone(), etoiles)),
                }
            }
        }
    }
    let mut retenues: Vec<(i64, &Personne)> = ordre
        .iter()
        .filter_map(|id| gens.get(id).map(|p| (*id, p)))
        .filter(|(id, p)| !repondues.contains(id) && !exclure.contains(&format!("person:{id}")) && p.titres.len() >= MIN_TITRES_PAR_PERSONNE)
        .collect();
    retenues.sort_by_key(|(_, p)| std::cmp::Reverse(p.titres.len())); // tri stable
    Ok(retenues
        .into_iter()
        .take(limite)
        .map(|(id, p)| {
            let mut titres = p.titres.clone();
            titres.sort_by_key(|t| std::cmp::Reverse(t.1)); // les mieux notés d'abord, tri stable
            let roles: Vec<&str> = ["cast", "director", "producer"].iter().enumerate().filter(|(i, _)| p.roles[*i]).map(|(_, r)| *r).collect();
            json!({
                "family": "person", "key": format!("person:{id}"), "id": id, "name": p.nom,
                "photoUrl": p.photo.as_ref().filter(|x| !x.is_empty()).map(|x| format!("{AFFICHE}{x}")),
                "roles": roles, "seenIn": titres.into_iter().map(|t| t.0).collect::<Vec<_>>(),
            })
        })
        .collect())
}

/// GET /api/triage/batch?family=&category=&limit=&exclude=
pub async fn lot(utilisateur: Utilisateur, Query(p): Query<HashMap<String, String>>) -> Result<Response, Erreur> {
    let Some(famille) = p.get("family").map(String::as_str).filter(|f| matches!(*f, "unseen" | "seen" | "person")) else { return Ok(invalide()) };
    let limite = p.get("limit").and_then(|v| v.parse::<i64>().ok()).filter(|n| *n > 0 && *n <= 50).unwrap_or(20);
    let exclure: HashSet<String> = p.get("exclude").map(|e| e.split(',').filter(|x| !x.is_empty()).take(500).map(str::to_owned).collect()).unwrap_or_default();
    let cartes = match famille {
        "seen" => cartes_vues(&utilisateur, parse_categorie(&p), limite, &exclure).await?,
        "person" => cartes_personnes(&utilisateur, limite as usize, &exclure).await?,
        _ => vec![], // « à découvrir » : pas encore porté (modèle de préférence)
    };
    Ok(Json(json!({ "cards": cartes })).into_response())
}

// ---------- les réponses ----------

fn est_id(v: Option<&Value>) -> Option<i64> {
    v.and_then(Value::as_i64).filter(|n| *n > 0)
}
fn est_media(v: Option<&Value>) -> Option<&str> {
    v.and_then(Value::as_str).filter(|m| *m == "Movie" || *m == "TV Series")
}
fn emoji_vers_note(v: &Value) -> Option<i16> {
    v.as_str().and_then(|s| NOTES.iter().position(|n| *n == s)).map(|i| i as i16)
}

/// POST /api/triage/answer : applique la réponse (`like`, `dislike`, `skip`) et rend de quoi la défaire.
pub async fn repondre(utilisateur: Utilisateur, corps: Bytes) -> Result<Response, Erreur> {
    let Ok(corps) = serde_json::from_slice::<Value>(&corps) else { return Ok(invalide()) };
    let carte = corps.get("card");
    let famille = carte.and_then(|c| c.get("family")).and_then(Value::as_str);
    let Some(reponse_donnee) = corps.get("answer").and_then(Value::as_str).filter(|a| matches!(*a, "like" | "dislike" | "skip")) else { return Ok(invalide()) };
    // Une note (0 à 5) n'a de sens que pour un titre déjà vu.
    let note = match corps.get("rating") {
        None => None,
        Some(n) if famille == Some("seen") && n.as_i64().is_some_and(|n| (0..=5).contains(&n)) => n.as_i64(),
        Some(_) => return Ok(invalide()),
    };
    let like = reponse_donnee == "like";
    let mut contexte = json!({ "family": famille, "answer": reponse_donnee });

    match famille {
        Some("unseen") => {
            let (Some(tmdb_id), Some(media)) = (est_id(carte.and_then(|c| c.get("tmdbId"))), est_media(carte.and_then(|c| c.get("mediaType")))) else { return Ok(invalide()) };
            let cle = cle_tmdb(media, tmdb_id);
            let mut tx = bd::transaction(&utilisateur).await?;
            evenement(&mut tx, "triage", "tmdb", &cle, Some(contexte)).await?;
            if reponse_donnee == "skip" {
                tx.valider().await?;
                return Ok(Json(json!({ "undo": { "kind": "none" } })).into_response());
            }
            if !like {
                sqlx::query("insert into public.dismissals (subject_type, subject_id) values ('tmdb', $1) on conflict do nothing").bind(&cle).persistent(false).execute(&mut **tx).await?;
                evenement(&mut tx, "dismissed", "tmdb", &cle, None).await?;
                tx.valider().await?;
                return Ok(Json(json!({ "undo": { "kind": "undismiss", "mediaType": media, "tmdbId": tmdb_id } })).into_response());
            }
            tx.valider().await?;
            Ok(match ecriture::ajouter_titre(&utilisateur, tmdb_id, media, "triage").await? {
                Ajout::Cree(item) => Json(json!({ "undo": { "kind": "remove", "itemId": item["id"] } })).into_response(),
                // Un titre déjà présent n'est pas « défait » : il était là avant la réponse.
                Ajout::Existant(_) => Json(json!({ "undo": { "kind": "none" } })).into_response(),
                Ajout::TmdbIntrouvable => reponse(404, json!({ "error": "tmdb_not_found" })),
            })
        }
        Some("seen") => {
            let Some(id) = est_id(carte.and_then(|c| c.get("id"))) else { return Ok(invalide()) };
            if let Some(n) = note {
                contexte["rating"] = json!(n);
            }
            let mut tx = bd::transaction(&utilisateur).await?;
            let Some((avant,)): Option<(Option<i16>,)> = sqlx::query_as("select rating from public.library_items where id = $1").bind(id).persistent(false).fetch_optional(&mut **tx).await? else {
                return Ok(reponse(404, json!({ "error": "not_found" })));
            };
            evenement(&mut tx, "triage", "item", &id.to_string(), Some(contexte)).await?;
            if reponse_donnee == "skip" {
                tx.valider().await?;
                return Ok(Json(json!({ "undo": { "kind": "none" } })).into_response());
            }
            let apres = note.map(|n| n as i16).unwrap_or(if like { NOTE_AIME } else { NOTE_PAS_AIME });
            // Comme la v1, une note ne se pose que sur un titre vu ; les cartes de ce lot le sont.
            sqlx::query("update public.library_items set rating = $1, updated_at = now() where id = $2 and watch_status = 'Watched'").bind(apres).bind(id).persistent(false).execute(&mut **tx).await?;
            tx.valider().await?;
            Ok(Json(json!({ "undo": { "kind": "rating", "itemId": id, "previous": avant.and_then(|n| NOTES.get(n as usize)) } })).into_response())
        }
        Some("person") => {
            let (Some(id), Some(nom)) = (est_id(carte.and_then(|c| c.get("id"))), carte.and_then(|c| c.get("name")).and_then(Value::as_str)) else { return Ok(invalide()) };
            let mut tx = bd::transaction(&utilisateur).await?;
            evenement(&mut tx, "triage", "person", &id.to_string(), Some(contexte)).await?;
            if reponse_donnee == "skip" {
                tx.valider().await?;
                return Ok(Json(json!({ "undo": { "kind": "none" } })).into_response());
            }
            let avant: Option<(i16,)> = sqlx::query_as("select opinion from public.person_opinions where person_id = $1").bind(id as i32).persistent(false).fetch_optional(&mut **tx).await?;
            poser_avis(&mut tx, id, nom, if like { 1 } else { -1 }).await?;
            tx.valider().await?;
            Ok(Json(json!({ "undo": { "kind": "opinion", "personId": id, "name": nom, "previous": avant.map(|a| a.0) } })).into_response())
        }
        _ => Ok(invalide()),
    }
}

/// Pose un avis sur une personne ; un « je n'aime pas » efface la note, un « j'aime » garde celle qui existe.
async fn poser_avis(tx: &mut Tx, id: i64, nom: &str, avis: i16) -> Result<(), Erreur> {
    let requete = if avis == -1 {
        "insert into public.person_opinions (person_id, name, opinion, rating) values ($1, $2, $3, null)
         on conflict (user_id, person_id) do update set opinion = excluded.opinion, rating = null, updated_at = now()"
    } else {
        "insert into public.person_opinions (person_id, name, opinion) values ($1, $2, $3)
         on conflict (user_id, person_id) do update set opinion = excluded.opinion, updated_at = now()"
    };
    sqlx::query(requete).bind(id as i32).bind(nom).bind(avis).persistent(false).execute(&mut ***tx).await?;
    Ok(())
}

/// POST /api/triage/undo : défait exactement une réponse.
pub async fn annuler(utilisateur: Utilisateur, corps: Bytes) -> Result<Response, Erreur> {
    let Ok(corps) = serde_json::from_slice::<Value>(&corps) else { return Ok(invalide()) };
    let Some(undo) = corps.get("undo").filter(|u| u.is_object()) else { return Ok(invalide()) };
    let ok = || Ok(Json(json!({ "ok": true })).into_response());
    match undo.get("kind").and_then(Value::as_str) {
        Some("none") => ok(),
        Some("remove") => {
            let Some(id) = est_id(undo.get("itemId")) else { return Ok(invalide()) };
            if ecriture::retirer_titre(&utilisateur, id).await? { ok() } else { Ok(reponse(404, json!({ "error": "not_found" }))) }
        }
        Some("undismiss") => {
            let (Some(media), Some(tmdb_id)) = (est_media(undo.get("mediaType")), est_id(undo.get("tmdbId"))) else { return Ok(invalide()) };
            let cle = cle_tmdb(media, tmdb_id);
            let mut tx = bd::transaction(&utilisateur).await?;
            let retire = sqlx::query("delete from public.dismissals where subject_type = 'tmdb' and subject_id = $1").bind(&cle).persistent(false).execute(&mut **tx).await?.rows_affected();
            if retire > 0 {
                evenement(&mut tx, "undismissed", "tmdb", &cle, None).await?;
            }
            tx.valider().await?;
            ok()
        }
        Some("rating") => {
            let Some(id) = est_id(undo.get("itemId")) else { return Ok(invalide()) };
            let avant = match undo.get("previous") {
                Some(Value::Null) => None,
                Some(v) => match emoji_vers_note(v) {
                    Some(n) => Some(n),
                    None => return Ok(invalide()),
                },
                None => return Ok(invalide()),
            };
            let mut tx = bd::transaction(&utilisateur).await?;
            sqlx::query("update public.library_items set rating = $1, updated_at = now() where id = $2 and (watch_status = 'Watched' or $1::smallint is null)").bind(avant).bind(id).persistent(false).execute(&mut **tx).await?;
            tx.valider().await?;
            ok()
        }
        Some("opinion") => {
            let (Some(id), Some(nom)) = (est_id(undo.get("personId")), undo.get("name").and_then(Value::as_str)) else { return Ok(invalide()) };
            let avant = match undo.get("previous") {
                Some(Value::Null) => None,
                Some(v) if v.as_i64() == Some(1) || v.as_i64() == Some(-1) => v.as_i64().map(|n| n as i16),
                _ => return Ok(invalide()),
            };
            let mut tx = bd::transaction(&utilisateur).await?;
            match avant {
                None => {
                    sqlx::query("delete from public.person_opinions where person_id = $1").bind(id as i32).persistent(false).execute(&mut **tx).await?;
                }
                Some(a) => poser_avis(&mut tx, id, nom, a).await?,
            }
            tx.valider().await?;
            ok()
        }
        _ => Ok(invalide()),
    }
}
