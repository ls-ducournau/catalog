//! Duels de titres : la paire suivante, le résultat (Elo), l'annulation, la portée et la
//! réinitialisation de l'Elo. Reprend `src/lib/duelService.ts`, `elo.ts`, `pairSelection.ts` et la partie
//! « titres » de `duelUndo.ts`. Sans l'ancien service de notes : plus d'identifiant distant, plus de drapeau
//! d'envoi, plus de sauvegarde de fichier (l'instantané `elo_snapshot` suffit à annuler une réinitialisation).
//! Pas encore porté : les duels de personnes et de manches (`mode` = `people`, `round`), les paliers.
use crate::{auth::Utilisateur, bd, erreur::Erreur, items::annee_affichee};
use axum::{
    Json,
    body::Bytes,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use sqlx::{Postgres, QueryBuilder, Row, postgres::PgRow};
use std::collections::{HashMap, HashSet};

const ELO_DEPART: f64 = 1200.0;
const FACTEUR_K: f64 = 32.0;
const FENETRE_PAIRES_RECENTES: i64 = 50;
const PETIT_LOT: usize = 15;
const AFFICHE: &str = "https://image.tmdb.org/t/p/w500";

/// Score Elo des deux titres après un duel ; `a_gagne` désigne le vainqueur.
fn elo(elo_a: f64, elo_b: f64, a_gagne: bool) -> (f64, f64) {
    let attendu = |moi: f64, lui: f64| 1.0 / (1.0 + 10f64.powf((lui - moi) / 400.0));
    let (score_a, score_b) = if a_gagne { (1.0, 0.0) } else { (0.0, 1.0) };
    (elo_a + FACTEUR_K * (score_a - attendu(elo_a, elo_b)), elo_b + FACTEUR_K * (score_b - attendu(elo_b, elo_a)))
}

/// Un nombre au hasard dans [0, 1[ (suffisant ici : tirage pondéré de titres).
fn hasard() -> f64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static ETAT: AtomicU64 = AtomicU64::new(0);
    let mut x = ETAT.load(Ordering::Relaxed);
    if x == 0 {
        x = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0x9E37_79B9_7F4A_7C15) | 1;
    }
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    ETAT.store(x, Ordering::Relaxed);
    (x >> 11) as f64 / (1u64 << 53) as f64
}

fn cle_paire(a: i64, b: i64) -> String {
    if a < b { format!("{a}:{b}") } else { format!("{b}:{a}") }
}

/// Tirage pondéré : moins un titre a de duels, plus il a de chances d'être choisi (FR-12 de la v1).
fn tirer(lot: &[(i64, i32)]) -> (i64, i32) {
    let poids = |d: i32| 1.0 / (f64::from(d) + 1.0);
    let total: f64 = lot.iter().map(|(_, d)| poids(*d)).sum();
    let mut r = hasard() * total;
    for (id, d) in lot {
        r -= poids(*d);
        if r <= 0.0 {
            return (*id, *d);
        }
    }
    *lot.last().expect("lot non vide")
}

/// Choisit une paire : évite les 50 dernières paires (sauf petit lot), sans doublon dans la paire.
fn choisir_paire(eligibles: &[(i64, i32)], recentes: &HashSet<String>) -> Option<(i64, i64)> {
    if eligibles.len() < 2 {
        return None;
    }
    let (a, _) = tirer(eligibles);
    let assouplir = eligibles.len() < PETIT_LOT;
    let mut candidats: Vec<(i64, i32)> = eligibles.iter().copied().filter(|(id, _)| *id != a && (assouplir || !recentes.contains(&cle_paire(a, *id)))).collect();
    if candidats.is_empty() {
        candidats = eligibles.iter().copied().filter(|(id, _)| *id != a).collect();
    }
    let (b, _) = tirer(&candidats);
    Some((a, b))
}

/// Ajoute au filtre la catégorie demandée (comme `categoryFilter` de la v1) : un documentaire est un
/// documentaire, film ou série ; Film et Série excluent les documentaires.
fn categorie<'a>(qb: &mut QueryBuilder<'a, Postgres>, categorie: Option<&'a str>) {
    match categorie {
        Some("Documentary") => {
            qb.push(" and coalesce(genres, '[]'::jsonb) @> '[\"Documentary\"]'::jsonb");
        }
        Some(c @ ("Movie" | "TV Series")) => {
            qb.push(" and type = ").push_bind(c).push(" and not coalesce(genres, '[]'::jsonb) @> '[\"Documentary\"]'::jsonb");
        }
        _ => {}
    }
}

fn parse_categorie(p: &HashMap<String, String>) -> Option<&str> {
    p.get("category").map(String::as_str).filter(|c| matches!(*c, "Movie" | "TV Series" | "Documentary"))
}

const COLONNES_DUEL: &str = "id, name, year, type, genres, poster_path, elo_score, duels_count::int as duels_count";

/// Un titre en duel : mêmes champs que la v1, sans l'identifiant de l'ancien service de notes.
fn titre_duel(l: &PgRow) -> Result<Value, Erreur> {
    let annee: Option<String> = l.try_get("year")?;
    let genres: Option<Value> = l.try_get("genres")?;
    let affiche: Option<String> = l.try_get("poster_path")?;
    Ok(json!({
        "id": l.try_get::<i64, _>("id")?,
        "name": l.try_get::<String, _>("name")?,
        "year": annee_affichee(annee.as_deref()),
        "type": l.try_get::<String, _>("type")?,
        "genres": genres.filter(Value::is_array).unwrap_or_else(|| json!([])),
        "posterUrl": affiche.filter(|a| !a.is_empty()).map(|a| format!("{AFFICHE}{a}")),
        "eloScore": l.try_get::<f64, _>("elo_score")?,
        "duelsCount": l.try_get::<i32, _>("duels_count")?,
    }))
}

async fn lire_titre(tx: &mut bd::Tx, id: i64) -> Result<Option<Value>, Erreur> {
    let ligne = sqlx::query(&format!("select {COLONNES_DUEL} from public.library_view where id = $1")).bind(id).persistent(false).fetch_optional(&mut ***tx).await?;
    ligne.as_ref().map(titre_duel).transpose()
}

fn reponse(statut: u16, corps: Value) -> Response {
    (StatusCode::from_u16(statut).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), Json(corps)).into_response()
}

/// GET /api/duels/next : la prochaine paire, ou `not_enough_watched_items` (200, comme la v1).
pub async fn suivant(utilisateur: Utilisateur, Query(p): Query<HashMap<String, String>>) -> Result<Json<Value>, Erreur> {
    let mut tx = bd::transaction(&utilisateur).await?;
    let mut requete = QueryBuilder::<Postgres>::new("select id, duels_count::int as duels_count from public.library_view where watch_status = 'Watched'");
    categorie(&mut requete, parse_categorie(&p));
    let eligibles: Vec<(i64, i32)> = requete.build().persistent(false).fetch_all(&mut **tx).await?.iter().map(|l| Ok::<_, sqlx::Error>((l.try_get("id")?, l.try_get("duels_count")?))).collect::<Result<_, _>>()?;
    let manque = || Json(json!({ "error": "not_enough_watched_items", "eligibleCount": eligibles.len() }));
    if eligibles.len() < 2 {
        tx.annuler().await?;
        return Ok(manque());
    }
    let recentes: HashSet<String> = sqlx::query_as::<_, (i64, i64)>("select item_a_id, item_b_id from public.duels order by id desc limit $1")
        .bind(FENETRE_PAIRES_RECENTES)
        .persistent(false)
        .fetch_all(&mut **tx)
        .await?
        .into_iter()
        .map(|(a, b)| cle_paire(a, b))
        .collect();
    let Some((a, b)) = choisir_paire(&eligibles, &recentes) else {
        tx.annuler().await?;
        return Ok(manque());
    };
    let (item_a, item_b) = (lire_titre(&mut tx, a).await?, lire_titre(&mut tx, b).await?);
    tx.valider().await?;
    match (item_a, item_b) {
        (Some(item_a), Some(item_b)) => Ok(Json(json!({ "itemA": item_a, "itemB": item_b }))),
        _ => Ok(manque()),
    }
}

/// GET /api/duels/scope : ce que couvre une catégorie (titres vus, titres dont l'Elo a bougé).
pub async fn portee(utilisateur: Utilisateur, Query(p): Query<HashMap<String, String>>) -> Result<Json<Value>, Erreur> {
    let mut tx = bd::transaction(&utilisateur).await?;
    let mut requete = QueryBuilder::<Postgres>::new(format!(
        "select coalesce(sum((watch_status = 'Watched')::int), 0)::int as vus, coalesce(sum((elo_score <> {ELO_DEPART} or duels_count > 0)::int), 0)::int as notes from public.library_view where true"
    ));
    categorie(&mut requete, parse_categorie(&p));
    let ligne = requete.build().persistent(false).fetch_one(&mut **tx).await?;
    tx.valider().await?;
    Ok(Json(json!({ "watched": ligne.try_get::<i32, _>("vus")?, "scored": ligne.try_get::<i32, _>("notes")? })))
}

/// POST /api/duels/result : applique un duel (`A`, `B` ou `skip`). Un passage compte comme exposition
/// (`duels_count` + 1) sans changer l'Elo. Le duel est enregistré pour pouvoir être annulé.
pub async fn resultat(utilisateur: Utilisateur, corps: Bytes) -> Result<Response, Erreur> {
    let Ok(corps) = serde_json::from_slice::<Value>(&corps) else { return Ok(reponse(400, json!({ "error": "invalid_request" }))) };
    let (Some(a), Some(b), Some(choix)) = (corps.get("itemAId").and_then(Value::as_i64), corps.get("itemBId").and_then(Value::as_i64), corps.get("result").and_then(Value::as_str)) else {
        return Ok(reponse(400, json!({ "error": "invalid_request" })));
    };
    if !matches!(choix, "A" | "B" | "skip") || a == b {
        return Ok(reponse(400, json!({ "error": "invalid_request" })));
    }
    let mut tx = bd::transaction(&utilisateur).await?;
    let scores: Vec<(i64, f64)> = sqlx::query_as("select id, elo_score from public.library_items where id in ($1, $2)").bind(a).bind(b).persistent(false).fetch_all(&mut **tx).await?;
    let (Some(avant_a), Some(avant_b)) = (scores.iter().find(|s| s.0 == a).map(|s| s.1), scores.iter().find(|s| s.0 == b).map(|s| s.1)) else {
        return Ok(reponse(404, json!({ "error": "not_found" })));
    };
    let (apres_a, apres_b, vainqueur) = match choix {
        "skip" => (avant_a, avant_b, None),
        c => {
            let (x, y) = elo(avant_a, avant_b, c == "A");
            (x, y, Some(if c == "A" { a } else { b }))
        }
    };
    let (duel_id,): (i64,) = sqlx::query_as(
        "insert into public.duels (item_a_id, item_b_id, winner_id, elo_a_before, elo_b_before, elo_a_after, elo_b_after) values ($1, $2, $3, $4, $5, $6, $7) returning id",
    )
    .bind(a)
    .bind(b)
    .bind(vainqueur)
    .bind(avant_a)
    .bind(avant_b)
    .bind(apres_a)
    .bind(apres_b)
    .persistent(false)
    .fetch_one(&mut **tx)
    .await?;
    for (id, elo_apres) in [(a, apres_a), (b, apres_b)] {
        sqlx::query("update public.library_items set elo_score = $1, duels_count = duels_count + 1, last_duel_at = now(), updated_at = now() where id = $2")
            .bind(elo_apres)
            .bind(id)
            .persistent(false)
            .execute(&mut **tx)
            .await?;
    }
    let (item_a, item_b) = (lire_titre(&mut tx, a).await?, lire_titre(&mut tx, b).await?);
    tx.valider().await?;
    Ok(Json(json!({ "itemA": item_a, "itemB": item_b, "duelId": duel_id })).into_response())
}

/// POST /api/duels/undo : défait un duel de titres. Refusé (409) si un duel plus récent a touché l'un des
/// deux titres, ou si leurs scores ont bougé depuis (réinitialisation…) : revenir en arrière écraserait
/// alors autre chose que ce duel. Les modes `people` et `round` ne sont pas encore portés (501).
pub async fn annuler(utilisateur: Utilisateur, corps: Bytes) -> Result<Response, Erreur> {
    let Ok(corps) = serde_json::from_slice::<Value>(&corps) else { return Ok(reponse(400, json!({ "error": "invalid_request" }))) };
    let (Some(mode), Some(duel_id)) = (corps.get("mode").and_then(Value::as_str), corps.get("duelId").and_then(Value::as_i64)) else {
        return Ok(reponse(400, json!({ "error": "invalid_request" })));
    };
    match mode {
        "titles" => {}
        "people" | "round" => return Ok(reponse(501, json!({ "error": "not_implemented" }))),
        _ => return Ok(reponse(400, json!({ "error": "invalid_request" }))),
    }
    let mut tx = bd::transaction(&utilisateur).await?;
    type Duel = (i64, i64, Option<i64>, f64, f64, f64, f64);
    let duel: Option<Duel> = sqlx::query_as("select item_a_id, item_b_id, winner_id, elo_a_before, elo_b_before, elo_a_after, elo_b_after from public.duels where id = $1")
        .bind(duel_id)
        .persistent(false)
        .fetch_optional(&mut **tx)
        .await?;
    let Some((a, b, _vainqueur, avant_a, avant_b, apres_a, apres_b)) = duel else { return Ok(reponse(404, json!({ "error": "not_found" }))) };
    let plus_recent: Option<(i32,)> = sqlx::query_as("select 1 from public.duels where id > $1 and (item_a_id in ($2, $3) or item_b_id in ($2, $3)) limit 1")
        .bind(duel_id)
        .bind(a)
        .bind(b)
        .persistent(false)
        .fetch_optional(&mut **tx)
        .await?;
    if plus_recent.is_some() {
        return Ok(reponse(409, json!({ "error": "conflict" })));
    }
    let actuels: Vec<(i64, f64)> = sqlx::query_as("select id, elo_score from public.library_items where id in ($1, $2)").bind(a).bind(b).persistent(false).fetch_all(&mut **tx).await?;
    let score = |id: i64| actuels.iter().find(|s| s.0 == id).map(|s| s.1);
    let identiques = |actuel: Option<f64>, attendu: f64| actuel.is_some_and(|s| (s - attendu).abs() <= 1e-6);
    if !identiques(score(a), apres_a) || !identiques(score(b), apres_b) {
        return Ok(reponse(409, json!({ "error": "conflict" })));
    }
    sqlx::query("delete from public.duels where id = $1").bind(duel_id).persistent(false).execute(&mut **tx).await?;
    for (id, elo_avant) in [(a, avant_a), (b, avant_b)] {
        sqlx::query(
            "update public.library_items set elo_score = $1, duels_count = greatest(0, duels_count - 1),
               last_duel_at = (select max(created_at) from public.duels where item_a_id = $2 or item_b_id = $2), updated_at = now()
             where id = $2",
        )
        .bind(elo_avant)
        .bind(id)
        .persistent(false)
        .execute(&mut **tx)
        .await?;
    }
    tx.valider().await?;
    Ok(Json(json!({ "ok": true })).into_response())
}

/// POST /api/duels/reset : remet l'Elo à 1200 pour une catégorie (ou tout). Les scores d'avant sont copiés
/// dans `elo_snapshot`, de quoi annuler ; l'historique des duels est conservé.
pub async fn reinitialiser(utilisateur: Utilisateur, corps: Bytes) -> Result<Json<Value>, Erreur> {
    let corps: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
    let cat = corps.get("category").and_then(Value::as_str).filter(|c| matches!(*c, "Movie" | "TV Series" | "Documentary"));
    let mut tx = bd::transaction(&utilisateur).await?;
    sqlx::query("delete from public.elo_snapshot").persistent(false).execute(&mut **tx).await?;
    let mut copie = QueryBuilder::<Postgres>::new("insert into public.elo_snapshot (user_id, item_id, elo_score, duels_count, last_duel_at) select user_id, id, elo_score, duels_count, last_duel_at from public.library_items where ");
    copie.push(format!("(elo_score <> {ELO_DEPART} or duels_count > 0) and id in (select id from public.library_view where true"));
    categorie(&mut copie, cat);
    copie.push(")");
    copie.build().persistent(false).execute(&mut **tx).await?;
    let mut remise = QueryBuilder::<Postgres>::new(format!("update public.library_items set elo_score = {ELO_DEPART}, duels_count = 0, last_duel_at = null, updated_at = now() where "));
    remise.push(format!("(elo_score <> {ELO_DEPART} or duels_count > 0) and id in (select id from public.library_view where true"));
    categorie(&mut remise, cat);
    remise.push(")");
    let nb = remise.build().persistent(false).execute(&mut **tx).await?.rows_affected();
    tx.valider().await?;
    Ok(Json(json!({ "reset": nb })))
}

/// POST /api/duels/restore : annule la dernière réinitialisation.
pub async fn retablir(utilisateur: Utilisateur) -> Result<Json<Value>, Erreur> {
    let mut tx = bd::transaction(&utilisateur).await?;
    let nb = sqlx::query(
        "update public.library_items li set elo_score = s.elo_score, duels_count = s.duels_count, last_duel_at = s.last_duel_at, updated_at = now()
           from public.elo_snapshot s where li.user_id = s.user_id and li.id = s.item_id",
    )
    .persistent(false)
    .execute(&mut **tx)
    .await?
    .rows_affected();
    sqlx::query("delete from public.elo_snapshot").persistent(false).execute(&mut **tx).await?;
    tx.valider().await?;
    Ok(Json(json!({ "restored": nb })))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn elo_conserve_la_somme_et_favorise_le_vainqueur() {
        let (a, b) = elo(1200.0, 1200.0, true);
        assert!((a - 1216.0).abs() < 1e-9 && (b - 1184.0).abs() < 1e-9);
        assert!((a + b - 2400.0).abs() < 1e-9);
        // Un favori qui gagne gagne peu ; un outsider qui gagne gagne beaucoup.
        let (favori, _) = elo(1400.0, 1200.0, true);
        let (outsider, _) = elo(1200.0, 1400.0, true);
        assert!(favori - 1400.0 < outsider - 1200.0);
    }

    #[test]
    fn la_paire_est_distincte_et_evite_les_paires_recentes() {
        let lot: Vec<(i64, i32)> = (1..=40).map(|i| (i, 0)).collect();
        let recentes: HashSet<String> = [cle_paire(1, 2)].into_iter().collect();
        for _ in 0..500 {
            let (a, b) = choisir_paire(&lot, &recentes).unwrap();
            assert_ne!(a, b);
            assert_ne!(cle_paire(a, b), cle_paire(1, 2));
        }
        assert!(choisir_paire(&[(1, 0)], &HashSet::new()).is_none());
    }

    #[test]
    fn un_petit_lot_assouplit_les_paires_recentes() {
        let lot = vec![(1, 0), (2, 0)];
        let recentes: HashSet<String> = [cle_paire(1, 2)].into_iter().collect();
        assert!(choisir_paire(&lot, &recentes).is_some());
    }

    #[test]
    fn le_tirage_prefere_les_titres_peu_disputes() {
        let lot = vec![(1, 0), (2, 50)];
        let mut un = 0;
        for _ in 0..2000 {
            if tirer(&lot).0 == 1 {
                un += 1;
            }
        }
        assert!(un > 1800, "le titre à 0 duel doit sortir presque toujours, {un}/2000");
    }
}
