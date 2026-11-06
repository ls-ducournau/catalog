//! Playlists faites à la main : des listes nommées et ordonnées de titres de la bibliothèque. Reprend
//! `src/lib/playlistService.ts` (et `loadModelTitles` de `preferenceService.ts` pour les durées et les
//! suggestions), `playlistFormat.ts` (limites) et les routes `/api/playlists/**`.
//! spec: specs/playlists-v1.md, specs/playlists-v2.md
//!
//! La logique (résumé, place d'un titre, ordre, suggestions, instantané) est en fonctions pures, testées avec
//! les cas de `playlistService.test.ts` ; les routes lisent et écrivent dans une transaction du compte.
//! Les dates sont celles de `toISOString()` (milliseconde, UTC) : l'ordre « dernière modifiée » départage
//! comme la v1.
use crate::{
    auth::Utilisateur,
    bd::{self, Tx},
    erreur::Erreur,
    items::{COLONNES, NOTES, titre},
    journal, js,
};
use axum::{
    Json,
    body::Bytes,
    extract::{Path, Query},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Map, Value, json};
use sqlx::Row;
use std::collections::{HashMap, HashSet};

/// EC-1 : nom de 1 à 60 caractères, description de 200 au plus (`playlistFormat.ts`), en unités UTF-16.
const NOM_MAX: usize = 60;
const DESCRIPTION_MAX: usize = 200;
/// D'où vient un geste (v2 FR-12).
const SOURCES: [&str; 11] = ["fiche", "carte", "selection", "suggestion", "recherche", "ce-soir", "sorties", "tri", "decouvrir", "accueil", "playlist"];
/// Ajout groupé : au plus autant de titres par appel.
const LOT_MAX: usize = 500;
/// v2 FR-5 : nombre de suggestions.
const SUGGESTIONS: usize = 8;
/// `new Date().toISOString()` : l'instant, à la milliseconde.
const MAINTENANT: &str = "date_trunc('milliseconds', now())";

/// Une date comme `toISOString()` (« 2026-10-06T13:56:08.703Z »).
fn iso(colonne: &str) -> String {
    format!("to_char({colonne} at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"')")
}

// ---------------------------------------------------------------------------------------------
// Logique pure
// ---------------------------------------------------------------------------------------------

/// `parseSource`.
pub fn source(v: Option<&Value>) -> Option<&'static str> {
    let s = v?.as_str()?;
    SOURCES.iter().copied().find(|x| *x == s)
}

/// `parseName` (EC-1) : 1 à 60 caractères, espaces superflus retirés ; `None` si invalide.
pub fn nom(v: Option<&Value>) -> Option<String> {
    let brut = v?.as_str()?;
    let mut nom = String::with_capacity(brut.len());
    let mut dans_espace = false;
    for c in js::trim(brut).chars() {
        if js::espace(c) {
            if !dans_espace {
                nom.push(' ');
            }
            dans_espace = true;
        } else {
            nom.push(c);
            dans_espace = false;
        }
    }
    (1..=NOM_MAX).contains(&js::longueur(&nom)).then_some(nom)
}

/// `parseDescription` : `Ok(None)` si absente ou vide, `Err(())` si invalide.
#[allow(clippy::result_unit_err)]
pub fn description(v: Option<&Value>) -> Result<Option<String>, ()> {
    match v {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => {
            let texte = js::trim(s);
            if texte.is_empty() {
                Ok(None)
            } else if js::longueur(texte) <= DESCRIPTION_MAX {
                Ok(Some(texte.to_owned()))
            } else {
                Err(())
            }
        }
        _ => Err(()),
    }
}

/// `summarize` : compte, titres vus, durée (EC-3), couverture (FR-10, EC-2), prochain à voir (v2 FR-11).
/// `titres` : les titres de la playlist, dans l'ordre, avec leur durée TMDB.
pub fn resumer(mut playlist: Map<String, Value>, titres: &[(Value, Option<f64>)]) -> Map<String, Value> {
    let (mut minutes, mut connues) = (0.0, 0);
    for (_, duree) in titres {
        // `if (runtime)` : ni null, ni 0, ni NaN.
        if let Some(d) = duree.filter(|d| *d != 0.0 && !d.is_nan()) {
            minutes += d;
            connues += 1;
        }
    }
    let vu = |t: &Value| t["watchStatus"] == "Watched";
    playlist.insert("count".into(), json!(titres.len()));
    playlist.insert("watched".into(), json!(titres.iter().filter(|(t, _)| vu(t)).count()));
    playlist.insert(
        "runtime".into(),
        json!({ "minutes": js::nombre_json(minutes), "known": connues, "hasSeries": titres.iter().any(|(t, _)| t["type"] == "TV Series") }),
    );
    let couverture: Vec<Value> = titres.iter().filter_map(|(t, _)| t["posterUrl"].as_str().filter(|u| !u.is_empty())).take(4).map(|u| json!(u)).collect();
    playlist.insert("covers".into(), json!(couverture));
    let prochain = titres.iter().find(|(t, _)| !vu(t)).map(|(t, _)| json!({ "id": t["id"], "name": t["name"], "posterUrl": t["posterUrl"] }));
    playlist.insert("next".into(), prochain.unwrap_or(Value::Null));
    playlist
}

/// `getPlaylist` : le résumé, les titres dans l'ordre (place, durée, dernière modification) et le prochain à voir.
/// `titres` : (titre, durée, dernière modification).
pub fn detailler(playlist: Map<String, Value>, titres: &[(Value, Option<f64>, Option<String>)]) -> Map<String, Value> {
    let resume: Vec<(Value, Option<f64>)> = titres.iter().map(|(t, d, _)| (t.clone(), *d)).collect();
    let mut detail = resumer(playlist, &resume);
    let entrees: Vec<Value> = titres
        .iter()
        .enumerate()
        .map(|(place, (t, duree, touche))| {
            let mut e = t.clone();
            e["position"] = json!(place);
            e["runtime"] = duree.map(js::nombre_json).unwrap_or(Value::Null);
            e["touchedAt"] = json!(touche);
            e
        })
        .collect();
    let prochain = titres.iter().find(|(t, _, _)| t["watchStatus"] != "Watched").map(|(t, _, _)| t["id"].clone());
    detail.insert("items".into(), Value::Array(entrees));
    detail.insert("nextId".into(), prochain.unwrap_or(Value::Null));
    detail
}

/// FR-4, FR-6 : la place d'un titre ajouté, en fin de liste (ou à `position`, bornée, pour annuler un retrait) ;
/// `None` s'il y est déjà (rien ne change). L'ordre qui en résulte est dans `ids`.
pub fn inserer(ids: &mut Vec<i64>, item: i64, position: Option<i64>) -> Option<usize> {
    if ids.contains(&item) {
        return None;
    }
    let n = ids.len() as i64;
    let place = position.unwrap_or(n).min(n).max(0) as usize;
    ids.insert(place, item);
    Some(place)
}

/// FR-8 : retire un titre de l'ordre ; rend sa place (`None` s'il n'y était pas).
pub fn retirer_de(ids: &mut Vec<i64>, item: i64) -> Option<usize> {
    let place = ids.iter().position(|i| *i == item)?;
    ids.remove(place);
    Some(place)
}

/// FR-7 : un nouvel ordre doit reprendre exactement les titres de la playlist, sans doublon.
pub fn ordre_valide(actuel: &[i64], nouveau: &[i64]) -> bool {
    nouveau.len() == actuel.len() && nouveau.iter().collect::<HashSet<_>>().len() == nouveau.len() && nouveau.iter().all(|i| actuel.contains(i))
}

/// v2 FR-4 (`addManyToPlaylist`) : ajoute en fin de liste, dans l'ordre donné, les titres connus ; ceux qui y sont
/// déjà sont comptés à part. Rend (ajoutés avec leur place, déjà présents) ; l'ordre qui en résulte est dans `ids`.
pub fn ajouter_plusieurs(ids: &mut Vec<i64>, demandes: &[i64], connus: &HashSet<i64>) -> (Vec<(i64, usize)>, Vec<i64>) {
    let mut vus = HashSet::new();
    let (mut ajoutes, mut deja) = (vec![], vec![]);
    for &item in demandes {
        if !vus.insert(item) || !connus.contains(&item) {
            continue;
        }
        if ids.contains(&item) {
            deja.push(item);
            continue;
        }
        ajoutes.push((item, ids.len()));
        ids.push(item);
    }
    (ajoutes, deja)
}

/// FR-3 : de quoi recréer une playlist supprimée (même nom, mêmes titres, même ordre).
#[derive(Debug, PartialEq)]
pub struct Instantane {
    pub id: i64,
    pub nom: String,
    pub description: Option<String>,
    pub cree: String,
    pub ids: Vec<i64>,
}

/// `parseSnapshot` : `None` si l'instantané est mal formé (la description doit être présente, chaîne ou null).
pub fn instantane(v: Option<&Value>) -> Option<Instantane> {
    let v = v?;
    let id = js::est_id(v.get("id"))?;
    let nom = v.get("name")?.as_str()?.to_owned();
    let cree = v.get("createdAt")?.as_str()?.to_owned();
    let description = match v.get("description")? {
        Value::Null => None,
        Value::String(s) => Some(s.clone()),
        _ => return None,
    };
    let ids = v.get("itemIds")?.as_array()?.iter().map(|x| js::est_id(Some(x))).collect::<Option<Vec<_>>>()?;
    Some(Instantane { id, nom, description, cree, ids })
}

/// `restorePlaylist` : les titres encore dans la bibliothèque, à leur place dans la liste filtrée ; un doublon
/// garde sa première place (`INSERT OR IGNORE`).
pub fn places_retablies(ids: &[i64], existants: &HashSet<i64>) -> Vec<(i64, usize)> {
    let mut vus = HashSet::new();
    ids.iter().filter(|i| existants.contains(i)).enumerate().filter(|(_, i)| vus.insert(**i)).map(|(place, i)| (*i, place)).collect()
}

/// Ce que les suggestions savent d'un titre (`ModelTitle` réduit à ce qui sert ici).
#[derive(Debug, Clone, Default)]
pub struct TitreModele {
    pub id: i64,
    pub genres: Vec<String>,
    pub mots_cles: Vec<String>,
    pub distribution: Vec<String>,
    pub realisation: Vec<String>,
}

fn noms(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array).map(|a| a.iter().map(|p| p.get("name").map(js::chaine).unwrap_or_else(|| "undefined".into())).collect()).unwrap_or_default()
}

fn chaines(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array).map(|a| a.iter().map(js::chaine).collect()).unwrap_or_default()
}

/// `rowToTitle` : les caractéristiques TMDB du titre ; sans elles, ce que la base sait déjà (genres, réalisation).
pub fn titre_modele(id: i64, traits: Option<&Value>, genres_ligne: Option<&Value>, realisateur: Option<&str>) -> TitreModele {
    let traits = traits.filter(|t| !t.is_null());
    let present = |cle: &str| traits.and_then(|t| t.get(cle)).filter(|v| !v.is_null());
    TitreModele {
        id,
        genres: chaines(present("genres").or(genres_ligne)),
        mots_cles: chaines(present("keywords")),
        distribution: noms(present("cast")),
        realisation: match traits {
            Some(_) => noms(present("directors")),
            None => realisateur.filter(|r| !r.is_empty()).map(|r| vec![r.to_owned()]).unwrap_or_default(),
        },
    }
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Trait {
    Realisation,
    MotCle,
    Distribution,
    Genre,
}

impl Trait {
    fn poids(self) -> f64 {
        match self {
            Trait::Realisation => 4.0,
            Trait::MotCle => 2.0,
            Trait::Distribution => 1.5,
            Trait::Genre => 1.0,
        }
    }
    fn nom(self) -> &'static str {
        match self {
            Trait::Realisation => "director",
            Trait::MotCle => "keyword",
            Trait::Distribution => "cast",
            Trait::Genre => "genre",
        }
    }
}

/// `traitsOf` : réalisation, mots-clés, cinq premiers interprètes, genres ; dans cet ordre, doublons compris.
fn traits(t: &TitreModele) -> Vec<(Trait, &str)> {
    let mut v: Vec<(Trait, &str)> = vec![];
    v.extend(t.realisation.iter().map(|x| (Trait::Realisation, x.as_str())));
    v.extend(t.mots_cles.iter().map(|x| (Trait::MotCle, x.as_str())));
    v.extend(t.distribution.iter().take(5).map(|x| (Trait::Distribution, x.as_str())));
    v.extend(t.genres.iter().map(|x| (Trait::Genre, x.as_str())));
    v
}

/// v2 FR-5 (`suggestForPlaylist`) : jusqu'à `limite` titres absents de la playlist et non écartés, les plus proches
/// de ceux qu'elle contient. La proximité additionne les traits partagés, pondérés par leur poids et par la part
/// des titres de la playlist qui les portent. Rien sous deux titres (EC-3). `titres` : toute la bibliothèque, dans
/// l'ordre des identifiants (il départage les égalités, comme le tri stable de la v1). Rend (titre, raison).
pub fn suggerer(titres: &[TitreModele], dedans: &[i64], ecartes: &HashSet<i64>, limite: usize) -> Vec<(i64, Option<String>)> {
    if dedans.len() < 2 {
        return vec![];
    }
    let dedans: HashSet<i64> = dedans.iter().copied().collect();
    let membres: Vec<&TitreModele> = titres.iter().filter(|t| dedans.contains(&t.id)).collect();
    // Ce que la playlist a en commun : chaque trait, la part de ses titres qui le portent (une fois par titre).
    let mut profil: HashMap<String, f64> = HashMap::new();
    for t in &membres {
        let mut vus = HashSet::new();
        for (genre, valeur) in traits(t) {
            let cle = format!("{}:{valeur}", genre.nom());
            if vus.insert(cle.clone()) {
                *profil.entry(cle).or_insert(0.0) += 1.0 / membres.len() as f64;
            }
        }
    }
    type Note = (i64, f64, Option<(Trait, String)>);
    let mut notes: Vec<Note> = titres
        .iter()
        .filter(|t| !dedans.contains(&t.id) && !ecartes.contains(&t.id))
        .map(|t| {
            let mut score = 0.0;
            let mut meilleur: Option<(Trait, &str, f64)> = None;
            for (genre, valeur) in traits(t) {
                let Some(part) = profil.get(&format!("{}:{valeur}", genre.nom())).filter(|p| **p != 0.0) else { continue };
                let poids = genre.poids() * part;
                score += poids;
                if meilleur.is_none_or(|m| poids > m.2) {
                    meilleur = Some((genre, valeur, poids));
                }
            }
            (t.id, score, meilleur.map(|m| (m.0, m.1.to_owned())))
        })
        .filter(|s| s.1 > 0.0)
        .collect();
    notes.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal)); // stable
    notes
        .into_iter()
        .take(limite)
        .map(|(id, _, meilleur)| {
            let raison = meilleur.map(|(genre, valeur)| match genre {
                Trait::Realisation => format!("Même réalisation : {valeur}"),
                Trait::Distribution => format!("Avec {valeur}"),
                Trait::MotCle => "Même univers".to_owned(),
                Trait::Genre => "Même genre".to_owned(),
            });
            (id, raison)
        })
        .collect()
}

// ---------------------------------------------------------------------------------------------
// Base
// ---------------------------------------------------------------------------------------------

fn erreur(statut: StatusCode, code: &str) -> Response {
    (statut, Json(json!({ "error": code }))).into_response()
}
fn introuvable() -> Response {
    erreur(StatusCode::NOT_FOUND, "not_found")
}
fn invalide(code: &str) -> Response {
    erreur(StatusCode::BAD_REQUEST, code)
}

/// La playlist (`toPlaylist`), ou `None`.
pub(crate) async fn playlist(tx: &mut Tx, id: i64) -> Result<Option<Map<String, Value>>, Erreur> {
    let ligne = sqlx::query(&format!("select id, name, description, {} as cree, {} as modifie from public.playlists where id = $1", iso("created_at"), iso("updated_at")))
        .bind(id)
        .persistent(false)
        .fetch_optional(&mut ***tx)
        .await?;
    ligne.map(|l| ligne_playlist(&l)).transpose()
}

fn ligne_playlist(l: &sqlx::postgres::PgRow) -> Result<Map<String, Value>, Erreur> {
    let mut m = Map::new();
    m.insert("id".into(), json!(l.try_get::<i64, _>("id")?));
    m.insert("name".into(), json!(l.try_get::<String, _>("name")?));
    m.insert("description".into(), json!(l.try_get::<Option<String>, _>("description")?));
    m.insert("createdAt".into(), json!(l.try_get::<String, _>("cree")?));
    m.insert("updatedAt".into(), json!(l.try_get::<String, _>("modifie")?));
    Ok(m)
}

/// `itemIdsOf` : les titres de la playlist, dans l'ordre (place, puis date d'ajout).
pub(crate) async fn ids_de(tx: &mut Tx, playlist: i64) -> Result<Vec<i64>, Erreur> {
    Ok(sqlx::query_scalar("select item_id from public.playlist_items where playlist_id = $1 order by position, added_at, item_id")
        .bind(playlist)
        .persistent(false)
        .fetch_all(&mut ***tx)
        .await?)
}

/// Les titres de la bibliothèque (`getItemsByIds`), avec leur durée TMDB et leur dernière modification.
pub(crate) async fn titres(tx: &mut Tx, ids: &[i64]) -> Result<HashMap<i64, (Value, Option<f64>, Option<String>)>, Erreur> {
    if ids.is_empty() {
        return Ok(HashMap::new());
    }
    let lignes = sqlx::query(&format!("select {COLONNES}, {} as touche, tmdb_features -> 'runtime' as duree from public.library_view where id = any($1)", iso("updated_at")))
        .bind(ids)
        .persistent(false)
        .fetch_all(&mut ***tx)
        .await?;
    lignes
        .iter()
        .map(|l| {
            let duree: Option<Value> = l.try_get("duree")?;
            Ok((l.try_get::<i64, _>("id")?, (titre(l)?, duree.and_then(|d| d.as_f64()), l.try_get::<Option<String>, _>("touche")?)))
        })
        .collect()
}

async fn existe(tx: &mut Tx, item: i64) -> Result<bool, Erreur> {
    Ok(sqlx::query_scalar("select exists (select 1 from public.library_items where id = $1)").bind(item).persistent(false).fetch_one(&mut ***tx).await?)
}

async fn contient(tx: &mut Tx, playlist: i64, item: i64) -> Result<bool, Erreur> {
    Ok(sqlx::query_scalar("select exists (select 1 from public.playlist_items where playlist_id = $1 and item_id = $2)")
        .bind(playlist)
        .bind(item)
        .persistent(false)
        .fetch_one(&mut ***tx)
        .await?)
}

/// La playlist devient la plus récente.
async fn toucher(tx: &mut Tx, playlist: i64) -> Result<(), Erreur> {
    sqlx::query(&format!("update public.playlists set updated_at = {MAINTENANT} where id = $1")).bind(playlist).persistent(false).execute(&mut ***tx).await?;
    Ok(())
}

/// `renumber` : places 0, 1, 2… dans l'ordre donné.
async fn renumeroter(tx: &mut Tx, playlist: i64, ids: &[i64]) -> Result<(), Erreur> {
    sqlx::query(
        "update public.playlist_items p set position = (o.rang - 1)::int
           from unnest($1::bigint[]) with ordinality as o(item_id, rang)
          where p.playlist_id = $2 and p.item_id = o.item_id",
    )
    .bind(ids)
    .bind(playlist)
    .persistent(false)
    .execute(&mut ***tx)
    .await?;
    Ok(())
}

/// Insère des places (titre, position) d'un coup, datées de maintenant ; un titre déjà présent est ignoré.
async fn placer(tx: &mut Tx, playlist: i64, places: &[(i64, usize)]) -> Result<(), Erreur> {
    if places.is_empty() {
        return Ok(());
    }
    let (items, positions): (Vec<i64>, Vec<i32>) = places.iter().map(|(i, p)| (*i, *p as i32)).unzip();
    sqlx::query(&format!(
        "insert into public.playlist_items (playlist_id, item_id, position, added_at)
         select $1, p.item_id, p.position, {MAINTENANT} from unnest($2::bigint[], $3::int[]) as p(item_id, position)
         on conflict do nothing"
    ))
    .bind(playlist)
    .bind(&items)
    .bind(&positions)
    .persistent(false)
    .execute(&mut ***tx)
    .await?;
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------------------------

/// GET /api/playlists : la dernière modifiée d'abord (FR-10) ; `?item=<id>` dit lesquelles contiennent ce titre (FR-4).
pub async fn liste(utilisateur: Utilisateur, Query(p): Query<Vec<(String, String)>>) -> Result<Json<Value>, Erreur> {
    // `Number(searchParams.get("item"))` : absent vaut `Number(null)`, soit 0.
    let item = p.iter().find(|(k, _)| k == "item").map_or(Some(0), |(_, v)| js::identifiant(v)).filter(|n| *n > 0);
    let mut tx = bd::transaction(&utilisateur).await?;
    let lignes = sqlx::query(&format!(
        "select id, name, description, {} as cree, {} as modifie from public.playlists order by updated_at desc, id desc",
        iso("created_at"),
        iso("updated_at")
    ))
    .persistent(false)
    .fetch_all(&mut **tx)
    .await?;
    let places: Vec<(i64, i64)> = sqlx::query_as("select playlist_id, item_id from public.playlist_items order by playlist_id, position, added_at, item_id")
        .persistent(false)
        .fetch_all(&mut **tx)
        .await?;
    let mut par_playlist: HashMap<i64, Vec<i64>> = HashMap::new();
    for (pl, it) in &places {
        par_playlist.entry(*pl).or_default().push(*it);
    }
    let mut tous: Vec<i64> = places.iter().map(|p| p.1).collect();
    tous.sort_unstable();
    tous.dedup();
    let connus = titres(&mut tx, &tous).await?;
    tx.valider().await?;

    let mut playlists = vec![];
    for l in &lignes {
        let pl = ligne_playlist(l)?;
        let ids = par_playlist.get(&pl["id"].as_i64().unwrap_or(0)).cloned().unwrap_or_default();
        let dedans: Vec<(Value, Option<f64>)> = ids.iter().filter_map(|i| connus.get(i)).map(|(t, d, _)| (t.clone(), *d)).collect();
        let mut resume = resumer(pl, &dedans);
        if let Some(item) = item {
            resume.insert("contains".into(), json!(ids.contains(&item)));
        }
        playlists.push(Value::Object(resume));
    }
    Ok(Json(json!({ "playlists": playlists })))
}

/// POST /api/playlists `{ name, description?, itemId?, source? }` : crée la playlist, avec un premier titre s'il
/// est donné et dans la bibliothèque (FR-1, FR-4).
pub async fn creer(utilisateur: Utilisateur, corps: Bytes) -> Result<Response, Erreur> {
    let corps: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
    let Some(nom) = nom(corps.get("name")) else { return Ok(invalide("invalid_name")) };
    let Ok(description) = description(corps.get("description")) else { return Ok(invalide("invalid_description")) };
    let item = js::entier(corps.get("itemId"));
    let source = source(corps.get("source"));

    let mut tx = bd::transaction(&utilisateur).await?;
    let id: i64 = sqlx::query_scalar(&format!("insert into public.playlists (name, description, created_at, updated_at) values ($1, $2, {MAINTENANT}, {MAINTENANT}) returning id"))
        .bind(&nom)
        .bind(&description)
        .persistent(false)
        .fetch_one(&mut **tx)
        .await?;
    journal::consigner(&mut tx, "playlist_created", "playlist", &id.to_string(), Some(json!({ "source": source }))).await?;
    if let Some(item) = item
        && existe(&mut tx, item).await?
    {
        placer(&mut tx, id, &[(item, 0)]).await?;
        journal::consigner(&mut tx, "playlist_item_added", "item", &item.to_string(), Some(json!({ "playlistId": id, "source": source }))).await?;
    }
    let Some(cree) = playlist(&mut tx, id).await? else { return Err(Erreur::Interne("playlist créée introuvable".into())) };
    tx.valider().await?;
    Ok((StatusCode::CREATED, Json(json!({ "playlist": cree }))).into_response())
}

/// GET /api/playlists/{id} : la playlist, ses titres dans l'ordre et le prochain à voir (FR-11, FR-12).
pub async fn fiche(utilisateur: Utilisateur, Path(id): Path<String>) -> Result<Response, Erreur> {
    let Some(id) = js::identifiant(&id) else { return Ok(introuvable()) };
    let mut tx = bd::transaction(&utilisateur).await?;
    let Some(pl) = playlist(&mut tx, id).await? else { return Ok(introuvable()) };
    let ids = ids_de(&mut tx, id).await?;
    let connus = titres(&mut tx, &ids).await?;
    tx.valider().await?;
    let dedans: Vec<(Value, Option<f64>, Option<String>)> = ids.iter().filter_map(|i| connus.get(i).cloned()).collect();
    Ok(Json(json!({ "playlist": detailler(pl, &dedans) })).into_response())
}

/// PATCH /api/playlists/{id} `{ name?, description? }` (FR-2).
pub async fn modifier(utilisateur: Utilisateur, Path(id): Path<String>, corps: Bytes) -> Result<Response, Erreur> {
    let corps: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
    let Some(id) = js::identifiant(&id) else { return Ok(introuvable()) };
    let mut tx = bd::transaction(&utilisateur).await?;
    if playlist(&mut tx, id).await?.is_none() {
        return Ok(introuvable());
    }
    let nouveau_nom = match corps.get("name") {
        None => None,
        Some(v) => match nom(Some(v)) {
            Some(n) => Some(n),
            None => return Ok(invalide("invalid_name")),
        },
    };
    let nouvelle_description = match corps.get("description") {
        None => None,
        Some(v) => match description(Some(v)) {
            Ok(d) => Some(d),
            Err(()) => return Ok(invalide("invalid_description")),
        },
    };
    sqlx::query(&format!(
        "update public.playlists set name = coalesce($2, name), description = case when $3 then $4 else description end, updated_at = {MAINTENANT} where id = $1"
    ))
    .bind(id)
    .bind(&nouveau_nom)
    .bind(nouvelle_description.is_some())
    .bind(nouvelle_description.flatten())
    .persistent(false)
    .execute(&mut **tx)
    .await?;
    let Some(pl) = playlist(&mut tx, id).await? else { return Ok(introuvable()) };
    tx.valider().await?;
    Ok(Json(json!({ "playlist": pl })).into_response())
}

/// DELETE /api/playlists/{id} : supprime la playlist (pas ses titres) et rend son instantané, pour « Annuler » (FR-3).
pub async fn supprimer(utilisateur: Utilisateur, Path(id): Path<String>) -> Result<Response, Erreur> {
    let Some(id) = js::identifiant(&id) else { return Ok(introuvable()) };
    let mut tx = bd::transaction(&utilisateur).await?;
    let Some(pl) = playlist(&mut tx, id).await? else { return Ok(introuvable()) };
    let ids = ids_de(&mut tx, id).await?;
    // Les places et les suggestions écartées partent avec la playlist (clés étrangères en cascade).
    sqlx::query("delete from public.playlists where id = $1").bind(id).persistent(false).execute(&mut **tx).await?;
    journal::consigner(&mut tx, "playlist_deleted", "playlist", &id.to_string(), Some(json!({ "count": ids.len() }))).await?;
    tx.valider().await?;
    Ok(Json(json!({ "snapshot": { "id": id, "name": pl["name"], "description": pl["description"], "createdAt": pl["createdAt"], "itemIds": ids } })).into_response())
}

/// POST /api/playlists/restore `{ snapshot }` : recrée la playlist, sous le même identifiant s'il est libre, avec ses
/// titres dans le même ordre (ceux qui ont quitté la bibliothèque sont ignorés).
pub async fn retablir(utilisateur: Utilisateur, corps: Bytes) -> Result<Response, Erreur> {
    let corps: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
    let Some(snap) = instantane(corps.get("snapshot")) else { return Ok(invalide("invalid_request")) };
    let Some(nom) = nom(Some(&json!(snap.nom))) else { return Ok(invalide("invalid_name")) };
    let Ok(description) = description(snap.description.as_ref().map(|d| json!(d)).as_ref()) else { return Ok(invalide("invalid_description")) };

    let mut tx = bd::transaction(&utilisateur).await?;
    let libre = playlist(&mut tx, snap.id).await?.is_none();
    let avec_id = format!("insert into public.playlists (id, name, description, created_at, updated_at) values ($4, $1, $2, $3::timestamptz, {MAINTENANT}) returning id");
    let sans_id = format!("insert into public.playlists (name, description, created_at, updated_at) values ($1, $2, $3::timestamptz, {MAINTENANT}) returning id");
    let mut insertion = sqlx::query_scalar::<_, i64>(if libre { &avec_id } else { &sans_id }).bind(&nom).bind(&description).bind(&snap.cree);
    if libre {
        insertion = insertion.bind(snap.id);
    }
    let id = match insertion.persistent(false).fetch_one(&mut **tx).await {
        Ok(id) => id,
        // Une date de création illisible : la v1 (SQLite) la gardait telle quelle, le schéma v2 la refuse.
        Err(sqlx::Error::Database(e)) if matches!(e.code().as_deref(), Some("22007" | "22008")) => return Ok(invalide("invalid_request")),
        Err(e) => return Err(e.into()),
    };
    let existants: HashSet<i64> = sqlx::query_scalar("select id from public.library_items where id = any($1)")
        .bind(&snap.ids)
        .persistent(false)
        .fetch_all(&mut **tx)
        .await?
        .into_iter()
        .collect();
    placer(&mut tx, id, &places_retablies(&snap.ids, &existants)).await?;
    let Some(pl) = playlist(&mut tx, id).await? else { return Err(Erreur::Interne("playlist rétablie introuvable".into())) };
    tx.valider().await?;
    Ok(Json(json!({ "playlist": pl })).into_response())
}

/// POST /api/playlists/{id}/items : `{ itemId, position?, source? }` ajoute un titre (FR-4 à FR-6) ;
/// `{ itemIds, source? }` en ajoute plusieurs d'un coup (v2 FR-4).
pub async fn ajouter(utilisateur: Utilisateur, Path(id): Path<String>, corps: Bytes) -> Result<Response, Erreur> {
    let corps: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
    let source = source(corps.get("source"));
    let pid = js::identifiant(&id);
    if let Some(liste) = corps.get("itemIds").and_then(Value::as_array) {
        let Some(demandes) = liste.iter().map(|x| js::est_id(Some(x))).collect::<Option<Vec<i64>>>().filter(|d| d.len() <= LOT_MAX) else {
            return Ok(invalide("invalid_request"));
        };
        let Some(pid) = pid else { return Ok(introuvable()) };
        let mut tx = bd::transaction(&utilisateur).await?;
        if playlist(&mut tx, pid).await?.is_none() {
            return Ok(introuvable());
        }
        let connus: HashSet<i64> =
            sqlx::query_scalar("select id from public.library_items where id = any($1)").bind(&demandes).persistent(false).fetch_all(&mut **tx).await?.into_iter().collect();
        let mut ids = ids_de(&mut tx, pid).await?;
        let (ajoutes, deja) = ajouter_plusieurs(&mut ids, &demandes, &connus);
        placer(&mut tx, pid, &ajoutes).await?;
        let sujets: Vec<(String, String)> = ajoutes.iter().map(|(i, _)| ("item".to_owned(), i.to_string())).collect();
        journal::consigner_lot(&mut tx, "playlist_item_added", &sujets, Some(json!({ "playlistId": pid, "source": source }))).await?;
        if !ajoutes.is_empty() {
            toucher(&mut tx, pid).await?;
        }
        tx.valider().await?;
        return Ok(Json(json!({ "added": ajoutes.iter().map(|a| a.0).collect::<Vec<_>>(), "already": deja })).into_response());
    }
    let Some(item) = js::est_id(corps.get("itemId")) else { return Ok(invalide("invalid_request")) };
    let position = js::entier(corps.get("position"));
    let Some(pid) = pid else { return Ok(introuvable()) };
    let mut tx = bd::transaction(&utilisateur).await?;
    if playlist(&mut tx, pid).await?.is_none() || !existe(&mut tx, item).await? {
        return Ok(introuvable());
    }
    let mut ids = ids_de(&mut tx, pid).await?;
    let Some(place) = inserer(&mut ids, item, position) else {
        tx.valider().await?;
        return Ok(Json(json!({ "added": false })).into_response());
    };
    placer(&mut tx, pid, &[(item, place)]).await?;
    renumeroter(&mut tx, pid, &ids).await?;
    toucher(&mut tx, pid).await?;
    journal::consigner(&mut tx, "playlist_item_added", "item", &item.to_string(), Some(json!({ "playlistId": pid, "source": source }))).await?;
    tx.valider().await?;
    Ok(Json(json!({ "added": true })).into_response())
}

/// DELETE /api/playlists/{id}/items `{ itemId }` : retire un titre ; rend sa place (FR-8).
pub async fn retirer(utilisateur: Utilisateur, Path(id): Path<String>, corps: Bytes) -> Result<Response, Erreur> {
    let corps: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
    let Some(item) = js::est_id(corps.get("itemId")) else { return Ok(invalide("invalid_request")) };
    let Some(pid) = js::identifiant(&id) else { return Ok(introuvable()) };
    let mut tx = bd::transaction(&utilisateur).await?;
    if playlist(&mut tx, pid).await?.is_none() {
        return Ok(introuvable());
    }
    let mut ids = ids_de(&mut tx, pid).await?;
    let Some(place) = retirer_de(&mut ids, item) else {
        tx.valider().await?;
        return Ok(Json(json!({ "removed": false, "position": null })).into_response());
    };
    sqlx::query("delete from public.playlist_items where playlist_id = $1 and item_id = $2").bind(pid).bind(item).persistent(false).execute(&mut **tx).await?;
    renumeroter(&mut tx, pid, &ids).await?;
    toucher(&mut tx, pid).await?;
    journal::consigner(&mut tx, "playlist_item_removed", "item", &item.to_string(), Some(json!({ "playlistId": pid }))).await?;
    tx.valider().await?;
    Ok(Json(json!({ "removed": true, "position": place })).into_response())
}

/// PUT /api/playlists/{id}/items `{ itemIds }` : le nouvel ordre, avec exactement les titres de la playlist (FR-7).
pub async fn ordonner(utilisateur: Utilisateur, Path(id): Path<String>, corps: Bytes) -> Result<Response, Erreur> {
    let corps: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
    let Some(nouveau) = corps.get("itemIds").and_then(Value::as_array).and_then(|l| l.iter().map(|x| js::est_id(Some(x))).collect::<Option<Vec<i64>>>()) else {
        return Ok(invalide("invalid_request"));
    };
    let Some(pid) = js::identifiant(&id) else { return Ok(introuvable()) };
    let mut tx = bd::transaction(&utilisateur).await?;
    if playlist(&mut tx, pid).await?.is_none() {
        return Ok(introuvable());
    }
    if !ordre_valide(&ids_de(&mut tx, pid).await?, &nouveau) {
        return Ok(invalide("invalid_order"));
    }
    renumeroter(&mut tx, pid, &nouveau).await?;
    toucher(&mut tx, pid).await?;
    tx.valider().await?;
    Ok(Json(json!({ "ok": true })).into_response())
}

/// POST /api/playlists/{id}/watch `{ itemId, source? }` : « Je regarde ça » ; le titre passe à vu et la réponse
/// rend le statut d'avant, pour l'annulation (v2 FR-9).
pub async fn voir(utilisateur: Utilisateur, Path(id): Path<String>, corps: Bytes) -> Result<Response, Erreur> {
    let corps: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
    let Some(item) = js::entier(corps.get("itemId")) else { return Ok(invalide("invalid_request")) };
    let source = source(corps.get("source")).unwrap_or("playlist");
    let Some(pid) = js::identifiant(&id) else { return Ok(introuvable()) };
    let mut tx = bd::transaction(&utilisateur).await?;
    if playlist(&mut tx, pid).await?.is_none() || !contient(&mut tx, pid, item).await? {
        return Ok(introuvable());
    }
    let Some((avant,)): Option<(String,)> = sqlx::query_as("select watch_status from public.library_items where id = $1").bind(item).persistent(false).fetch_optional(&mut **tx).await? else {
        return Ok(introuvable());
    };
    sqlx::query(&format!("update public.library_items set watch_status = 'Watched', updated_at = {MAINTENANT} where id = $1")).bind(item).persistent(false).execute(&mut **tx).await?;
    toucher(&mut tx, pid).await?;
    journal::consigner(&mut tx, "playlist_watched", "item", &item.to_string(), Some(json!({ "playlistId": pid, "source": source }))).await?;
    tx.valider().await?;
    Ok(Json(json!({ "previous": if avant == "Watched" { "Watched" } else { "Unwatched" } })).into_response())
}

/// POST /api/playlists/{id}/rate `{ itemId, rating }` : note de 0 (💩) à 5 étoiles d'un titre de la playlist ; rend
/// la note d'avant (v2 FR-7). Comme partout, une note ne se pose que sur un titre vu (sinon elle est ignorée).
pub async fn noter(utilisateur: Utilisateur, Path(id): Path<String>, corps: Bytes) -> Result<Response, Erreur> {
    let corps: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
    let Some(item) = js::entier(corps.get("itemId")) else { return Ok(invalide("invalid_request")) };
    let Some(etoiles) = js::entier(corps.get("rating")).filter(|n| (0..=5).contains(n)) else { return Ok(invalide("invalid_rating")) };
    let Some(pid) = js::identifiant(&id) else { return Ok(introuvable()) };
    let mut tx = bd::transaction(&utilisateur).await?;
    if playlist(&mut tx, pid).await?.is_none() || !contient(&mut tx, pid, item).await? {
        return Ok(introuvable());
    }
    let Some((statut, avant)): Option<(String, Option<i16>)> =
        sqlx::query_as("select watch_status, rating from public.library_items where id = $1").bind(item).persistent(false).fetch_optional(&mut **tx).await?
    else {
        return Ok(introuvable());
    };
    if statut == "Watched" {
        sqlx::query(&format!("update public.library_items set rating = $2, updated_at = {MAINTENANT} where id = $1"))
            .bind(item)
            .bind(etoiles as i16)
            .persistent(false)
            .execute(&mut **tx)
            .await?;
    }
    toucher(&mut tx, pid).await?;
    journal::consigner(&mut tx, "playlist_rated", "item", &item.to_string(), Some(json!({ "playlistId": pid, "stars": etoiles }))).await?;
    tx.valider().await?;
    let note = |n: i64| NOTES.get(n as usize).copied();
    Ok(Json(json!({ "previous": avant.and_then(|n| note(i64::from(n))), "rating": note(etoiles) })).into_response())
}

/// GET /api/playlists/{id}/suggestions : « Pour compléter » (v2 FR-5), depuis les caractéristiques TMDB déjà en
/// base, sans réseau. Une playlist inconnue n'a pas de suggestion (pas de 404, comme la v1).
pub async fn suggestions(utilisateur: Utilisateur, Path(id): Path<String>) -> Result<Json<Value>, Erreur> {
    let Some(pid) = js::identifiant(&id) else { return Ok(Json(json!({ "suggestions": [] }))) };
    let mut tx = bd::transaction(&utilisateur).await?;
    let dedans = ids_de(&mut tx, pid).await?;
    if dedans.len() < 2 {
        tx.valider().await?;
        return Ok(Json(json!({ "suggestions": [] })));
    }
    let ecartes: HashSet<i64> = sqlx::query_scalar("select item_id from public.playlist_suggestion_dismissals where playlist_id = $1")
        .bind(pid)
        .persistent(false)
        .fetch_all(&mut **tx)
        .await?
        .into_iter()
        .collect();
    // Seuls les traits utiles quittent la base (genres, mots-clés, distribution, réalisation).
    let lignes = sqlx::query(
        "select id, genres, director,
                case when tmdb_features is null then null else jsonb_build_object('genres', tmdb_features -> 'genres',
                  'keywords', tmdb_features -> 'keywords', 'cast', tmdb_features -> 'cast', 'directors', tmdb_features -> 'directors') end as traits
           from public.library_view order by id",
    )
    .persistent(false)
    .fetch_all(&mut **tx)
    .await?;
    let modeles = lignes
        .iter()
        .map(|l| {
            let traits: Option<Value> = l.try_get("traits")?;
            let genres: Option<Value> = l.try_get("genres")?;
            let realisateur: Option<String> = l.try_get("director")?;
            Ok(titre_modele(l.try_get("id")?, traits.as_ref(), genres.as_ref(), realisateur.as_deref()))
        })
        .collect::<Result<Vec<_>, Erreur>>()?;
    let retenus = suggerer(&modeles, &dedans, &ecartes, SUGGESTIONS);
    let ids: Vec<i64> = retenus.iter().map(|r| r.0).collect();
    let connus = titres(&mut tx, &ids).await?;
    tx.valider().await?;
    let liste: Vec<Value> = retenus
        .into_iter()
        .filter_map(|(id, raison)| {
            let mut t = connus.get(&id)?.0.clone();
            t["reason"] = json!(raison);
            Some(t)
        })
        .collect();
    Ok(Json(json!({ "suggestions": liste })))
}

/// POST /api/playlists/{id}/suggestions `{ dismiss: itemId }` : « Pas celui-là » écarte ce titre des suggestions
/// de la playlist (v2 FR-5). Un titre absent de la bibliothèque viole la clé étrangère : 500, comme la v1
/// (better-sqlite3 active les clés étrangères, et `INSERT OR IGNORE` n'ignore pas cette violation).
pub async fn ecarter_suggestion(utilisateur: Utilisateur, Path(id): Path<String>, corps: Bytes) -> Result<Response, Erreur> {
    let corps: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
    let Some(item) = js::entier(corps.get("dismiss")) else { return Ok(invalide("invalid_request")) };
    let Some(pid) = js::identifiant(&id) else { return Ok(introuvable()) };
    let mut tx = bd::transaction(&utilisateur).await?;
    if playlist(&mut tx, pid).await?.is_none() {
        return Ok(introuvable());
    }
    sqlx::query("insert into public.playlist_suggestion_dismissals (playlist_id, item_id) values ($1, $2) on conflict do nothing")
    .bind(pid)
    .bind(item)
    .persistent(false)
    .execute(&mut **tx)
    .await?;
    tx.valider().await?;
    Ok(Json(json!({ "ok": true })).into_response())
}

#[cfg(test)]
mod tests {
    //! Les cas de `src/lib/playlistService.test.ts`, mêmes données, mêmes valeurs attendues. Ceux qui reposent sur
    //! la base (cascade du retrait d'un titre, « Je regarde ça », note depuis la playlist, journal, playlist
    //! inconnue) sont rejoués en HTTP contre la v1 et la v2 (voir le rendu du portage).
    use super::*;

    const AFFICHE: &str = "https://image.tmdb.org/t/p/w500";

    /// Un titre tel que l'API le rend (`LibraryItem`, champs utiles ici).
    fn titre(id: i64, nom: &str, statut: &str, affiche: Option<&str>) -> Value {
        json!({ "id": id, "name": nom, "type": "Movie", "watchStatus": statut, "posterUrl": affiche.map(|p| format!("{AFFICHE}{p}")) })
    }

    fn playlist(id: i64, nom: &str) -> Map<String, Value> {
        let Value::Object(m) = json!({ "id": id, "name": nom, "description": null, "createdAt": "2026-10-28T10:00:00.000Z", "updatedAt": "2026-10-28T10:00:00.000Z" }) else {
            unreachable!()
        };
        m
    }

    /// `seedItem` avec des caractéristiques : le JSON `tmdb_features` de la v1 (personnes `{ id, name }`).
    fn modele(id: i64, realisation: &[&str], mots: &[&str], genres: &[&str]) -> TitreModele {
        let personne = |(i, n): (usize, &&str)| json!({ "id": n.len() * 100 + i, "name": n });
        let traits = json!({
            "genres": genres, "keywords": mots, "cast": [], "directors": realisation.iter().enumerate().map(personne).collect::<Vec<_>>(),
            "year": null, "runtime": null, "language": null, "countries": [], "voteAverage": null, "voteCount": null, "popularity": null,
        });
        titre_modele(id, Some(&traits), None, None)
    }

    fn noms(ids: &[i64], titres: &[(i64, &str)]) -> Vec<String> {
        ids.iter().map(|i| titres.iter().find(|t| t.0 == *i).map(|t| t.1.to_owned()).unwrap_or_default()).collect()
    }

    #[test]
    fn ac1_une_playlist_creee_apparait_vide() {
        let r = resumer(playlist(1, "Saga Alien"), &[]);
        assert_eq!((r["name"].clone(), r["count"].clone(), r["watched"].clone(), r["covers"].clone()), (json!("Saga Alien"), json!(0), json!(0), json!([])));
        assert_eq!(r["next"], Value::Null);
    }

    #[test]
    fn ec1_un_nom_vide_ou_trop_long_est_refuse_les_espaces_superflus_retires() {
        assert_eq!(nom(Some(&json!("   "))), None);
        assert_eq!(nom(Some(&json!("x".repeat(61)))), None);
        assert_eq!(nom(Some(&json!("x".repeat(60)))).map(|n| n.len()), Some(60));
        assert_eq!(nom(Some(&json!("  Films   de  Noël "))).as_deref(), Some("Films de Noël"));
        assert_eq!(nom(Some(&json!(12))), None);
        assert_eq!(nom(None), None);
    }

    #[test]
    fn ac2_cocher_ajoute_en_fin_de_liste_decocher_retire() {
        let (a, b) = (1, 2);
        let t = [(a, "Alien"), (b, "Aliens")];
        let mut ids = vec![b]; // créée avec Aliens
        inserer(&mut ids, a, None);
        assert_eq!(noms(&ids, &t), ["Aliens", "Alien"]);
        assert!(ids.contains(&a));
        retirer_de(&mut ids, a);
        assert_eq!(noms(&ids, &t), ["Aliens"]);
        assert!(!ids.contains(&a));
    }

    #[test]
    fn ac3_un_titre_deja_present_n_est_pas_ajoute_deux_fois() {
        let mut ids = vec![1];
        assert_eq!(inserer(&mut ids, 1, None), None);
        assert_eq!(ids, [1]);
    }

    #[test]
    fn ac4_ac5_le_nouvel_ordre_est_garde_un_ordre_incomplet_est_refuse() {
        let (a, b, c) = (1, 2, 3);
        let actuel = [a, b, c];
        assert!(ordre_valide(&actuel, &[c, a, b]));
        assert!(!ordre_valide(&actuel, &[c, a]));
        assert!(!ordre_valide(&actuel, &[c, a, a]));
    }

    #[test]
    fn fr8_retirer_rend_la_place_que_l_annulation_reutilise() {
        let (a, b, c) = (1, 2, 3);
        let t = [(a, "A"), (b, "B"), (c, "C")];
        let mut ids = vec![a, b, c];
        assert_eq!(retirer_de(&mut ids, b), Some(1));
        assert_eq!(retirer_de(&mut ids, 99), None);
        inserer(&mut ids, b, Some(1));
        assert_eq!(noms(&ids, &t), ["A", "B", "C"]);
        // Une place hors bornes est ramenée dans la liste.
        let mut ids = vec![a];
        assert_eq!(inserer(&mut ids, b, Some(-4)), Some(0));
        assert_eq!(inserer(&mut ids, c, Some(99)), Some(2));
    }

    #[test]
    fn ac6_supprimer_puis_annuler_rend_la_playlist_ses_titres_et_leur_ordre() {
        let ids = [1, 2, 3, 4];
        let t = [(1, "Alien"), (2, "Aliens"), (3, "Alien 3"), (4, "Alien, la résurrection")];
        let apres_ordre = [ids[3], ids[0], ids[1], ids[2]];
        // L'instantané rendu par DELETE /api/playlists/{id}, relu par POST /api/playlists/restore.
        let snap = json!({ "id": 7, "name": "Saga Alien", "description": null, "createdAt": "2026-10-06T13:56:08.703Z", "itemIds": apres_ordre });
        let lu = instantane(Some(&snap)).expect("instantané valide");
        assert_eq!(lu, Instantane { id: 7, nom: "Saga Alien".into(), description: None, cree: "2026-10-06T13:56:08.703Z".into(), ids: apres_ordre.to_vec() });
        let places = places_retablies(&lu.ids, &ids.into_iter().collect());
        assert_eq!(noms(&places.iter().map(|p| p.0).collect::<Vec<_>>(), &t), ["Alien, la résurrection", "Alien", "Aliens", "Alien 3"]);
        assert_eq!(places.iter().map(|p| p.1).collect::<Vec<_>>(), [0, 1, 2, 3]);
        // Un titre parti de la bibliothèque est ignoré ; un doublon garde sa première place.
        assert_eq!(places_retablies(&[4, 9, 1, 4, 2], &[1, 2, 4].into_iter().collect()), [(4, 0), (1, 1), (2, 3)]);
        // Mal formé : description absente, identifiant non entier, titres invalides.
        assert_eq!(instantane(Some(&json!({ "id": 7, "name": "X", "createdAt": "x", "itemIds": [] }))), None);
        assert_eq!(instantane(Some(&json!({ "id": 7.5, "name": "X", "description": null, "createdAt": "x", "itemIds": [] }))), None);
        assert_eq!(instantane(Some(&json!({ "id": 7, "name": "X", "description": null, "createdAt": "x", "itemIds": [0] }))), None);
    }

    #[test]
    fn ac8_le_prochain_a_voir_est_le_premier_non_vu_dans_l_ordre() {
        let (a, b, c) = (1, 2, 3);
        let avec = |statuts: [&str; 3]| -> Vec<(Value, Option<f64>, Option<String>)> {
            [a, b, c].iter().zip(statuts).map(|(i, s)| (titre(*i, "T", s, None), None, None)).collect()
        };
        assert_eq!(detailler(playlist(1, "Trois"), &avec(["Watched", "Unwatched", "Unwatched"]))["nextId"], json!(b));
        assert_eq!(detailler(playlist(1, "Trois"), &avec(["Watched", "Watched", "Unwatched"]))["nextId"], json!(c));
        let fini = detailler(playlist(1, "Trois"), &avec(["Watched", "Watched", "Watched"]));
        assert_eq!(fini["nextId"], Value::Null);
        assert_eq!(fini["watched"], json!(3));
    }

    #[test]
    fn ac9_ec3_la_duree_totale_additionne_les_durees_connues() {
        let dedans = [(titre(1, "Long", "Unwatched", None), Some(120.0)), (titre(2, "Court", "Unwatched", None), Some(90.0)), (titre(3, "Inconnu", "Unwatched", None), None)];
        assert_eq!(resumer(playlist(1, "Soirée"), &dedans)["runtime"], json!({ "minutes": 210, "known": 2, "hasSeries": false }));
        // Une durée nulle ne compte pas ; une série le signale.
        let mut serie = titre(4, "Série", "Unwatched", None);
        serie["type"] = json!("TV Series");
        assert_eq!(resumer(playlist(1, "S"), &[(serie, Some(0.0))])["runtime"], json!({ "minutes": 0, "known": 0, "hasSeries": true }));
    }

    #[test]
    fn fr10_ec2_la_couverture_prend_les_affiches_des_quatre_premiers_titres() {
        let mut dedans: Vec<(Value, Option<f64>)> = (0..5).map(|i| (titre(i, &format!("T{i}"), "Unwatched", Some(&format!("/p{i}.jpg"))), None)).collect();
        dedans.push((titre(5, "Sans affiche", "Unwatched", None), None));
        let r = resumer(playlist(1, "Affiches"), &dedans);
        assert_eq!(r["covers"].as_array().map(Vec::len), Some(4));
        assert_eq!(r["covers"][0], json!(format!("{AFFICHE}/p0.jpg")));
    }

    #[test]
    fn fr2_renommer_et_decrire() {
        assert_eq!(nom(Some(&json!("Films de Noël"))).as_deref(), Some("Films de Noël"));
        assert_eq!(description(Some(&json!("  À revoir en décembre  "))), Ok(Some("À revoir en décembre".into())));
        assert_eq!(description(Some(&json!(""))), Ok(None));
        assert_eq!(description(None), Ok(None));
        assert_eq!(description(Some(&Value::Null)), Ok(None));
        assert_eq!(description(Some(&json!("x".repeat(201)))), Err(()));
        assert_eq!(description(Some(&json!(3))), Err(()));
    }

    #[test]
    fn v2_ac3_l_ajout_groupe_garde_l_ordre_et_ignore_les_titres_deja_presents() {
        let ids: Vec<i64> = (0..9).map(|i| i + 1).collect();
        let t: Vec<(i64, String)> = ids.iter().map(|i| (*i, format!("T{}", i - 1))).collect();
        let t: Vec<(i64, &str)> = t.iter().map(|(i, n)| (*i, n.as_str())).collect();
        let mut dedans = vec![ids[2], ids[5]];
        let (ajoutes, deja) = ajouter_plusieurs(&mut dedans, &ids, &ids.iter().copied().collect());
        let attendus: Vec<i64> = ids.iter().enumerate().filter(|(i, _)| *i != 2 && *i != 5).map(|(_, x)| *x).collect();
        assert_eq!(ajoutes.iter().map(|a| a.0).collect::<Vec<_>>(), attendus);
        assert_eq!(deja, [ids[2], ids[5]]);
        assert_eq!(noms(&dedans, &t), ["T2", "T5", "T0", "T1", "T3", "T4", "T6", "T7", "T8"]);
        // Chaque ajout prend la place suivante ; un titre inconnu ou répété est ignoré.
        assert_eq!(ajoutes.iter().map(|a| a.1).collect::<Vec<_>>(), [2, 3, 4, 5, 6, 7, 8]);
        let mut vide = vec![];
        assert_eq!(ajouter_plusieurs(&mut vide, &[1, 1, 42], &[1].into_iter().collect()), (vec![(1, 0)], vec![]));
    }

    #[test]
    fn v2_ac4_les_suggestions_preferent_la_meme_saga_et_la_meme_realisation_sans_doublon() {
        let alien = modele(1, &["Ridley Scott"], &["alien", "space"], &["Horror", "Science Fiction"]);
        let aliens = modele(2, &["James Cameron"], &["alien", "marine"], &["Action", "Science Fiction"]);
        let prometheus = modele(3, &["Ridley Scott"], &["alien"], &["Science Fiction"]);
        let comedie = modele(4, &[], &[], &["Comedy"]);
        let sans_traits = titre_modele(5, None, None, None);
        let t = [(1, "Alien"), (2, "Aliens"), (3, "Prometheus"), (4, "Comédie sans lien"), (5, "Inconnu")];
        let titres = vec![alien, aliens, prometheus, comedie, sans_traits];
        let dedans = [1, 2];
        let s = suggerer(&titres, &dedans, &HashSet::new(), 8);
        let n = noms(&s.iter().map(|x| x.0).collect::<Vec<_>>(), &t);
        assert_eq!(n[0], "Prometheus");
        for absent in ["Alien", "Comédie sans lien", "Inconnu"] {
            assert!(!n.contains(&absent.to_owned()), "{absent}");
        }
        assert_eq!(s[0].1.as_deref(), Some("Même réalisation : Ridley Scott"));
        let ecartes: HashSet<i64> = [s[0].0].into_iter().collect();
        let n = noms(&suggerer(&titres, &dedans, &ecartes, 8).iter().map(|x| x.0).collect::<Vec<_>>(), &t);
        assert!(!n.contains(&"Prometheus".to_owned()));
    }

    #[test]
    fn v2_ec3_moins_de_deux_titres_pas_de_suggestion() {
        let titres = vec![modele(1, &[], &[], &["Drama"]), modele(2, &[], &[], &["Drama"])];
        assert!(suggerer(&titres, &[1], &HashSet::new(), 8).is_empty());
    }

    #[test]
    fn les_traits_suivent_row_to_title() {
        // Sans caractéristiques : les genres et la réalisation de la ligne.
        let t = titre_modele(9, None, Some(&json!(["Drama"])), Some("Agnès Varda"));
        assert_eq!((t.genres, t.realisation), (vec!["Drama".to_owned()], vec!["Agnès Varda".to_owned()]));
        // Avec : leurs genres, même vides ; la réalisation de la ligne est ignorée.
        let t = titre_modele(9, Some(&json!({ "genres": [], "directors": [], "cast": [{ "name": "A" }], "keywords": ["k"] })), Some(&json!(["Drama"])), Some("X"));
        assert!(t.genres.is_empty() && t.realisation.is_empty());
        assert_eq!((t.distribution, t.mots_cles), (vec!["A".to_owned()], vec!["k".to_owned()]));
        // Genres absents des caractéristiques : ceux de la ligne.
        assert_eq!(titre_modele(9, Some(&json!({ "genres": null })), Some(&json!(["Drama"])), None).genres, ["Drama"]);
    }

    #[test]
    fn la_raison_vient_du_trait_le_plus_lourd_et_les_egalites_gardent_l_ordre() {
        let m = |id, cast: &[&str], genres: &[&str]| {
            let traits = json!({ "genres": genres, "keywords": [], "cast": cast.iter().map(|n| json!({ "name": n })).collect::<Vec<_>>(), "directors": [] });
            titre_modele(id, Some(&traits), None, None)
        };
        let titres = vec![m(1, &["Sigourney Weaver"], &["Horror"]), m(2, &["Sigourney Weaver"], &["Horror"]), m(3, &[], &["Horror"]), m(4, &["Sigourney Weaver"], &[]), m(5, &[], &["Horror"])];
        let s = suggerer(&titres, &[1, 2], &HashSet::new(), 8);
        assert_eq!(s, [(4, Some("Avec Sigourney Weaver".to_owned())), (3, Some("Même genre".to_owned())), (5, Some("Même genre".to_owned()))]);
        assert_eq!(suggerer(&titres, &[1, 2], &HashSet::new(), 1).len(), 1);
    }
}
