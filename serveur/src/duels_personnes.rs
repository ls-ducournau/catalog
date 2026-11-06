//! Duels d'acteurs : la paire suivante, la portée, le résultat (Elo), la réinitialisation, son
//! annulation, et l'annulation d'un duel (`POST /api/duels/undo`, mode `people`). Reprend
//! `src/lib/personDuelService.ts`, `pairSelection.ts`, `elo.ts` et la partie « personnes » de `duelUndo.ts`.
//!
//! La personne (nom, photo) est dans le catalogue partagé (`catalog_people`), écrit par le serveur avec
//! les crédits TMDB des titres ; son Elo est personnel (`person_scores`). Sans l'ancien service : plus de
//! sauvegarde de fichier avant une réinitialisation (l'instantané `person_elo_snapshot` suffit).
use crate::{
    auth::Utilisateur,
    bd::{self, Tx},
    erreur::Erreur,
    js_v8,
    personnes::url_image,
};
use axum::{
    Json,
    body::Bytes,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use sqlx::Row;
use std::collections::{HashMap, HashSet};

pub(crate) const ELO_DEPART: f64 = 1200.0;
const FACTEUR_K: f64 = 32.0;
/// FR-19 : une préférence doit reposer sur une vraie exposition, pas sur un seul rôle.
pub(crate) const MIN_TITRES_PAR_PERSONNE: usize = 3;
pub(crate) const FENETRE_PAIRES_RECENTES: i64 = 50;
pub(crate) const PETIT_LOT: usize = 15;

fn reponse(statut: u16, corps: Value) -> Response {
    (StatusCode::from_u16(statut).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), Json(corps)).into_response()
}

/// `computeElo` (elo.ts) : scores des deux sujets après un duel ; `a_gagne` désigne le vainqueur.
pub(crate) fn elo(elo_a: f64, elo_b: f64, a_gagne: bool) -> (f64, f64) {
    let attendu = |moi: f64, lui: f64| 1.0 / (1.0 + 10f64.powf((lui - moi) / 400.0));
    let (score_a, score_b) = if a_gagne { (1.0, 0.0) } else { (0.0, 1.0) };
    (elo_a + FACTEUR_K * (score_a - attendu(elo_a, elo_b)), elo_b + FACTEUR_K * (score_b - attendu(elo_b, elo_a)))
}

/// `pairKey`
pub(crate) fn cle_paire(a: i64, b: i64) -> String {
    if a < b { format!("{a}:{b}") } else { format!("{b}:{a}") }
}

/// `weightedPick` : poids 1 / (duels + 1), parcours dans l'ordre du lot.
fn tirer(lot: &[(i64, i32)], rng: &mut impl FnMut() -> f64) -> (i64, i32) {
    let poids = |d: i32| 1.0 / (f64::from(d) + 1.0);
    let total = lot.iter().fold(0.0, |s, (_, d)| s + poids(*d));
    let mut r = rng() * total;
    for &(id, d) in lot {
        r -= poids(d);
        if r <= 0.0 {
            return (id, d);
        }
    }
    *lot.last().expect("lot non vide")
}

/// `pickPair` (pairSelection.ts) : (id, nombre de duels) ; évite les paires récentes sauf petit lot
/// (EC-3), jamais deux fois le même. `None` sous deux éligibles.
pub(crate) fn choisir_paire(eligibles: &[(i64, i32)], recentes: &HashSet<String>, rng: &mut impl FnMut() -> f64) -> Option<(i64, i64)> {
    if eligibles.len() < 2 {
        return None;
    }
    let (a, _) = tirer(eligibles, rng);
    let assouplir = eligibles.len() < PETIT_LOT;
    let mut candidats: Vec<(i64, i32)> = eligibles.iter().copied().filter(|(id, _)| *id != a && (assouplir || !recentes.contains(&cle_paire(a, *id)))).collect();
    if candidats.is_empty() {
        candidats = eligibles.iter().copied().filter(|(id, _)| *id != a).collect();
    }
    let (b, _) = tirer(&candidats, rng);
    Some((a, b))
}

/// Un acteur croisé dans les titres vus.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Apparition {
    pub id: i64,
    pub nom: String,
    pub photo: Option<String>,
    /// (titre, étoiles ou -1), dans l'ordre des titres.
    pub titres: Vec<(String, i32)>,
}

/// `eligibleAppearances` : les acteurs (distribution seulement) vus dans au moins 3 titres, dans
/// l'ordre de leur première apparition. `titres` : (nom, note 0 à 5, `tmdb_features`), titres vus,
/// dans l'ordre des identifiants. Nom et photo : ceux de la première apparition.
pub(crate) fn apparitions(titres: &[(String, Option<i32>, Value)]) -> Vec<Apparition> {
    let mut ordre: Vec<i64> = vec![];
    let mut par_id: HashMap<i64, Apparition> = HashMap::new();
    for (nom, etoiles, traits) in titres {
        for p in traits.get("cast").and_then(Value::as_array).into_iter().flatten() {
            let Some(id) = p.get("id").and_then(Value::as_i64) else { continue };
            let entree = par_id.entry(id).or_insert_with(|| {
                ordre.push(id);
                Apparition {
                    id,
                    nom: p.get("name").and_then(Value::as_str).unwrap_or_default().to_owned(),
                    photo: p.get("profilePath").and_then(Value::as_str).map(str::to_owned),
                    titres: vec![],
                }
            });
            entree.titres.push((nom.clone(), etoiles.unwrap_or(-1)));
        }
    }
    ordre.into_iter().filter_map(|id| par_id.remove(&id)).filter(|p| p.titres.len() >= MIN_TITRES_PAR_PERSONNE).collect()
}

/// `toDuelItem` : les titres où on l'a croisé, les mieux notés d'abord (tri stable).
pub(crate) fn personne_duel(p: &Apparition, elo: f64, duels: i32) -> Value {
    let mut titres = p.titres.clone();
    titres.sort_by_key(|t| std::cmp::Reverse(t.1));
    json!({
        "id": p.id, "name": p.nom, "photoUrl": url_image(p.photo.as_ref().map(|s| Value::String(s.clone())).as_ref()),
        "eloScore": elo, "duelsCount": duels, "seenIn": titres.into_iter().map(|t| t.0).collect::<Vec<_>>(),
    })
}

async fn eligibles(tx: &mut Tx) -> Result<Vec<Apparition>, Erreur> {
    let lignes = sqlx::query("select name, rating::int as etoiles, tmdb_features from public.library_view where watch_status = 'Watched' and tmdb_features is not null order by id")
        .persistent(false)
        .fetch_all(&mut ***tx)
        .await?;
    let titres = lignes.iter().map(|l| Ok((l.try_get("name")?, l.try_get("etoiles")?, l.try_get("tmdb_features")?))).collect::<Result<Vec<_>, sqlx::Error>>()?;
    Ok(apparitions(&titres))
}

/// `syncPeople` : inscrit les nouveaux éligibles (Elo de départ) et rafraîchit nom et photo. Le
/// catalogue partagé ne s'écrit qu'avec le pool du serveur, et seulement avec les crédits TMDB.
async fn inscrire(tx: &mut Tx, personnes: &[Apparition]) -> Result<(), Erreur> {
    let ids: Vec<i32> = personnes.iter().filter_map(|p| i32::try_from(p.id).ok()).collect();
    let noms: Vec<&str> = personnes.iter().filter(|p| i32::try_from(p.id).is_ok()).map(|p| p.nom.as_str()).collect();
    let photos: Vec<Option<&str>> = personnes.iter().filter(|p| i32::try_from(p.id).is_ok()).map(|p| p.photo.as_deref()).collect();
    let mut catalogue = bd::transaction_serveur().await?;
    sqlx::query(
        "insert into public.catalog_people (id, name, profile_path)
         select * from unnest($1::int[], $2::text[], $3::text[])
         on conflict (id) do update set name = excluded.name, profile_path = excluded.profile_path
         where (catalog_people.name, catalog_people.profile_path) is distinct from (excluded.name, excluded.profile_path)",
    )
    .bind(&ids)
    .bind(&noms)
    .bind(&photos)
    .persistent(false)
    // Règle 11 de PORTAGE.md : une requête avec paramètres passe par une transaction du serveur
    // (le pooler de Supabase peut séparer préparation et exécution hors transaction).
    .execute(&mut **catalogue)
    .await?;
    catalogue.valider().await?;
    sqlx::query("insert into public.person_scores (person_id) select unnest($1::int[]) on conflict do nothing").bind(&ids).persistent(false).execute(&mut ***tx).await?;
    Ok(())
}

/// GET /api/duels/people/next : la prochaine paire, ou `not_enough_people` (200, comme la v1).
pub async fn suivant(utilisateur: Utilisateur) -> Result<Json<Value>, Erreur> {
    let mut tx = bd::transaction(&utilisateur).await?;
    let personnes = eligibles(&mut tx).await?;
    let manque = || Json(json!({ "error": "not_enough_people", "eligibleCount": personnes.len() }));
    if personnes.len() < 2 {
        tx.annuler().await?;
        return Ok(manque());
    }
    inscrire(&mut tx, &personnes).await?;
    let ids: Vec<i32> = personnes.iter().filter_map(|p| i32::try_from(p.id).ok()).collect();
    // Comme `WHERE id IN (…)` de SQLite sur la clé : par identifiant croissant.
    let scores: Vec<(i32, f64, i32)> = sqlx::query_as("select person_id, elo_score, duels_count from public.person_scores where person_id = any($1) order by person_id")
        .bind(&ids)
        .persistent(false)
        .fetch_all(&mut **tx)
        .await?;
    let recentes: HashSet<String> = sqlx::query_as::<_, (i32, i32)>("select person_a_id, person_b_id from public.person_duels order by id desc limit $1")
        .bind(FENETRE_PAIRES_RECENTES)
        .persistent(false)
        .fetch_all(&mut **tx)
        .await?
        .into_iter()
        .map(|(a, b)| cle_paire(a.into(), b.into()))
        .collect();
    tx.valider().await?;
    let lot: Vec<(i64, i32)> = scores.iter().map(|s| (i64::from(s.0), s.2)).collect();
    let Some((a, b)) = choisir_paire(&lot, &recentes, &mut js_v8::hasard) else { return Ok(manque()) };
    let carte = |id: i64| {
        let p = personnes.iter().find(|p| p.id == id).expect("éligible");
        let s = scores.iter().find(|s| i64::from(s.0) == id).expect("inscrit");
        personne_duel(p, s.1, s.2)
    };
    Ok(Json(json!({ "personA": carte(a), "personB": carte(b) })))
}

/// GET /api/duels/people/scope : même forme que la portée des titres (`watched` = éligibles).
pub async fn portee(utilisateur: Utilisateur) -> Result<Json<Value>, Erreur> {
    let mut tx = bd::transaction(&utilisateur).await?;
    let eligibles = eligibles(&mut tx).await?.len();
    let (notes,): (i64,) = sqlx::query_as(&format!("select count(*) from public.person_scores where elo_score <> {ELO_DEPART} or duels_count > 0")).persistent(false).fetch_one(&mut **tx).await?;
    tx.valider().await?;
    Ok(Json(json!({ "watched": eligibles, "scored": notes })))
}

/// POST /api/duels/people/result : `{ personAId, personBId, result: "A" | "B" | "skip" }`. Un passage compte
/// comme une exposition sans changer l'Elo. Rend l'identifiant du duel, de quoi l'annuler.
pub async fn resultat(utilisateur: Utilisateur, corps: Bytes) -> Result<Response, Erreur> {
    let corps: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
    let (Some(a), Some(b), Some(choix)) = (
        corps.get("personAId").filter(|v| v.is_number()),
        corps.get("personBId").filter(|v| v.is_number()),
        corps.get("result").and_then(Value::as_str).filter(|c| matches!(*c, "A" | "B" | "skip")),
    ) else {
        return Ok(reponse(400, json!({ "error": "invalid_request" })));
    };
    let (Some(a), Some(b)) = (js_v8::identifiant_i32(a), js_v8::identifiant_i32(b)) else { return Ok(reponse(404, json!({ "error": "not_found" }))) };
    // La v1 enregistrait un duel d'une personne contre elle-même ; le schéma v2 l'interdit (comme pour les titres).
    if a == b {
        return Ok(reponse(400, json!({ "error": "invalid_request" })));
    }
    let mut tx = bd::transaction(&utilisateur).await?;
    let scores: Vec<(i32, f64)> = sqlx::query_as("select person_id, elo_score from public.person_scores where person_id in ($1, $2)").bind(a).bind(b).persistent(false).fetch_all(&mut **tx).await?;
    let score = |id: i32| scores.iter().find(|s| s.0 == id).map(|s| s.1);
    let (Some(avant_a), Some(avant_b)) = (score(a), score(b)) else { return Ok(reponse(404, json!({ "error": "not_found" }))) };
    let (apres_a, apres_b, vainqueur) = match choix {
        "skip" => (avant_a, avant_b, None),
        c => {
            let (x, y) = elo(avant_a, avant_b, c == "A");
            (x, y, Some(if c == "A" { a } else { b }))
        }
    };
    let (duel,): (i64,) = sqlx::query_as(
        "insert into public.person_duels (person_a_id, person_b_id, winner_id, elo_a_before, elo_b_before, elo_a_after, elo_b_after)
         values ($1, $2, $3, $4, $5, $6, $7) returning id",
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
        sqlx::query("update public.person_scores set elo_score = $1, duels_count = duels_count + 1, last_duel_at = now(), updated_at = now() where person_id = $2")
            .bind(elo_apres)
            .bind(id)
            .persistent(false)
            .execute(&mut **tx)
            .await?;
    }
    tx.valider().await?;
    Ok(Json(json!({ "ok": true, "duelId": duel })).into_response())
}

/// POST /api/duels/people/reset : remet l'Elo des acteurs à 1200, après un instantané pour l'annuler.
pub async fn reinitialiser(utilisateur: Utilisateur) -> Result<Json<Value>, Erreur> {
    let mut tx = bd::transaction(&utilisateur).await?;
    sqlx::query("delete from public.person_elo_snapshot where user_id = (select auth.uid())").persistent(false).execute(&mut **tx).await?;
    sqlx::query(&format!(
        "insert into public.person_elo_snapshot (person_id, elo_score, duels_count, last_duel_at)
         select person_id, elo_score, duels_count, last_duel_at from public.person_scores where elo_score <> {ELO_DEPART} or duels_count > 0"
    ))
    .persistent(false)
    .execute(&mut **tx)
    .await?;
    let nb = sqlx::query(&format!(
        "update public.person_scores set elo_score = {ELO_DEPART}, duels_count = 0, last_duel_at = null, updated_at = now()
          where user_id = (select auth.uid()) and (elo_score <> {ELO_DEPART} or duels_count > 0)"
    ))
    .persistent(false)
    .execute(&mut **tx)
    .await?
    .rows_affected();
    tx.valider().await?;
    Ok(Json(json!({ "reset": nb })))
}

/// POST /api/duels/people/restore : annule la dernière réinitialisation.
pub async fn retablir(utilisateur: Utilisateur) -> Result<Json<Value>, Erreur> {
    let mut tx = bd::transaction(&utilisateur).await?;
    let nb = sqlx::query(
        "update public.person_scores ps set elo_score = s.elo_score, duels_count = s.duels_count, last_duel_at = s.last_duel_at, updated_at = now()
           from public.person_elo_snapshot s where ps.user_id = s.user_id and ps.person_id = s.person_id",
    )
    .persistent(false)
    .execute(&mut **tx)
    .await?
    .rows_affected();
    sqlx::query("delete from public.person_elo_snapshot where user_id = (select auth.uid())").persistent(false).execute(&mut **tx).await?;
    tx.valider().await?;
    Ok(Json(json!({ "restored": nb })))
}

/// `undoDuel(db, "people", id)` : défait un duel d'acteurs. Refusé (409) si un duel plus récent a touché
/// l'un des deux, ou si leurs scores ont bougé depuis (réinitialisation…).
pub(crate) async fn annuler_duel(utilisateur: &Utilisateur, duel_id: &Value) -> Result<Response, Erreur> {
    let introuvable = || Ok(reponse(404, json!({ "error": "not_found" })));
    let conflit = || Ok(reponse(409, json!({ "error": "conflict" })));
    let Some(duel_id) = js_v8::identifiant(duel_id) else { return introuvable() };
    let mut tx = bd::transaction(utilisateur).await?;
    type Duel = (i32, i32, f64, f64, f64, f64);
    let duel: Option<Duel> = sqlx::query_as("select person_a_id, person_b_id, elo_a_before, elo_b_before, elo_a_after, elo_b_after from public.person_duels where id = $1")
        .bind(duel_id)
        .persistent(false)
        .fetch_optional(&mut **tx)
        .await?;
    let Some((a, b, avant_a, avant_b, apres_a, apres_b)) = duel else { return introuvable() };
    let plus_recent: Option<(i32,)> = sqlx::query_as("select 1 from public.person_duels where id > $1 and (person_a_id in ($2, $3) or person_b_id in ($2, $3)) limit 1")
        .bind(duel_id)
        .bind(a)
        .bind(b)
        .persistent(false)
        .fetch_optional(&mut **tx)
        .await?;
    if plus_recent.is_some() {
        return conflit();
    }
    let actuels: Vec<(i32, f64)> = sqlx::query_as("select person_id, elo_score from public.person_scores where person_id in ($1, $2)").bind(a).bind(b).persistent(false).fetch_all(&mut **tx).await?;
    let score = |id: i32| actuels.iter().find(|s| s.0 == id).map(|s| s.1);
    let identique = |actuel: Option<f64>, attendu: f64| actuel.is_some_and(|s| (s - attendu).abs() <= 1e-6);
    if !identique(score(a), apres_a) || !identique(score(b), apres_b) {
        return conflit();
    }
    sqlx::query("delete from public.person_duels where id = $1").bind(duel_id).persistent(false).execute(&mut **tx).await?;
    for (id, elo_avant) in [(a, avant_a), (b, avant_b)] {
        sqlx::query(
            "update public.person_scores set elo_score = $1, duels_count = greatest(0, duels_count - 1),
               last_duel_at = (select max(created_at) from public.person_duels where person_a_id = $2 or person_b_id = $2), updated_at = now()
             where person_id = $2",
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

#[cfg(test)]
mod tests {
    use super::*;

    // ---------- elo.test.ts ----------

    #[test]
    fn elo_applique_le_gain_attendu_pour_deux_scores_egaux() {
        let (a, b) = elo(1200.0, 1200.0, true);
        assert!((a - 1216.0).abs() < 5e-6 && (b - 1184.0).abs() < 5e-6);
    }

    #[test]
    fn elo_est_symetrique_quand_b_gagne() {
        let (a, b) = elo(1200.0, 1200.0, false);
        assert!((a - 1184.0).abs() < 5e-6 && (b - 1216.0).abs() < 5e-6);
    }

    #[test]
    fn elo_fait_gagner_peu_au_favori_et_perdre_beaucoup_s_il_perd() {
        let gain = elo(1400.0, 1000.0, true).0 - 1400.0;
        assert!(gain > 0.0 && gain < FACTEUR_K / 2.0);
        let perte = 1400.0 - elo(1400.0, 1000.0, false).0;
        assert!(perte > FACTEUR_K / 2.0);
    }

    #[test]
    fn elo_conserve_la_somme() {
        let (a, b) = elo(1350.0, 1180.0, true);
        assert!((a + b - (1350.0 + 1180.0)).abs() < 5e-6);
        assert_eq!(ELO_DEPART, 1200.0);
    }

    // ---------- pairSelection.test.ts ----------

    #[test]
    fn pas_de_paire_sous_deux_eligibles() {
        assert!(choisir_paire(&[(1, 0)], &HashSet::new(), &mut js_v8::hasard).is_none());
        assert!(choisir_paire(&[], &HashSet::new(), &mut js_v8::hasard).is_none());
    }

    #[test]
    fn la_paire_est_toujours_de_deux_distincts() {
        let (a, b) = choisir_paire(&[(1, 0), (2, 0)], &HashSet::new(), &mut js_v8::hasard).unwrap();
        assert_ne!(a, b);
    }

    /// AC-7 : lot de 15 ou plus, une paire récente n'est pas reproposée (rng fixé à 0 : l'item 1 en A).
    #[test]
    fn evite_une_paire_recente_quand_le_lot_est_assez_grand() {
        let lot: Vec<(i64, i32)> = (1..=16).map(|i| (i, 0)).collect();
        assert!(lot.len() >= PETIT_LOT);
        let recentes: HashSet<String> = [cle_paire(1, 2)].into_iter().collect();
        for _ in 0..20 {
            let (a, b) = choisir_paire(&lot, &recentes, &mut || 0.0).unwrap();
            assert!(!((a == 1 && b == 2) || (a == 2 && b == 1)));
        }
    }

    /// EC-3 : la seule paire possible est récente, la contrainte est assouplie.
    #[test]
    fn assouplit_la_contrainte_si_le_lot_est_trop_petit() {
        let recentes: HashSet<String> = [cle_paire(1, 2)].into_iter().collect();
        assert!(choisir_paire(&[(1, 0), (2, 0)], &recentes, &mut || 0.0).is_some());
    }

    /// AC-8 : un sujet sans duel est tiré bien plus souvent en A.
    #[test]
    fn favorise_les_sujets_avec_le_moins_de_duels() {
        let lot = [(1, 0), (2, 40), (3, 40), (4, 40)];
        let (mut un, mut autres) = (0, 0);
        for _ in 0..5000 {
            if choisir_paire(&lot, &HashSet::new(), &mut js_v8::hasard).unwrap().0 == 1 { un += 1 } else { autres += 1 }
        }
        assert!(un > autres);
    }

    #[test]
    fn la_fenetre_de_rappel_est_de_50_duels() {
        assert_eq!(FENETRE_PAIRES_RECENTES, 50);
    }

    // ---------- personDuelService.test.ts ----------

    /// Les titres du `beforeEach` : Pitt et DiCaprio 3 titres chacun, Fiennes 3, le second rôle 2.
    fn titres_de_l_essai() -> Vec<(String, Option<i32>, Value)> {
        let pitt = json!({ "id": 287, "name": "Brad Pitt", "profilePath": "/pitt.jpg" });
        let leo = json!({ "id": 6193, "name": "Leonardo DiCaprio", "profilePath": "/leo.jpg" });
        let fiennes = json!({ "id": 5469, "name": "Ralph Fiennes", "profilePath": "/fiennes.jpg" });
        let rare = json!({ "id": 1, "name": "Second rôle", "profilePath": null });
        let t = |nom: &str, cast: Vec<&Value>, etoiles: i32| (nom.to_owned(), Some(etoiles), json!({ "genres": [], "cast": cast, "directors": [] }));
        vec![
            t("Fight Club", vec![&pitt], 5),
            t("Troie", vec![&pitt], 2),
            t("Once Upon a Time in Hollywood", vec![&pitt, &leo], 4),
            t("Inception", vec![&leo, &rare], 5),
            t("Titanic", vec![&leo, &rare], 3),
            t("The Grand Budapest Hotel", vec![&fiennes], 5),
            t("Harry Potter", vec![&fiennes], 3),
            t("La Liste de Schindler", vec![&fiennes], 5),
        ]
    }

    /// AC-15 : seuls les acteurs vus dans au moins 3 titres s'affrontent.
    #[test]
    fn n_oppose_que_des_acteurs_vus_dans_au_moins_3_titres() {
        let eligibles = apparitions(&titres_de_l_essai());
        assert_eq!(eligibles.iter().map(|p| p.id).collect::<Vec<_>>(), [287, 6193, 5469]);
        let lot: Vec<(i64, i32)> = eligibles.iter().map(|p| (p.id, 0)).collect();
        for _ in 0..20 {
            let (a, b) = choisir_paire(&lot, &HashSet::new(), &mut js_v8::hasard).unwrap();
            assert!(a != 1 && b != 1);
        }
    }

    /// AC-16 : l'Elo des deux acteurs bouge (le gagnant monte, le perdant descend).
    #[test]
    fn met_a_jour_l_elo_des_deux_acteurs() {
        let (pitt, fiennes) = elo(1200.0, 1200.0, true);
        assert!(pitt > 1200.0 && fiennes < 1200.0);
    }

    /// AC-17 : les titres où on l'a croisé, du mieux noté au moins bien noté.
    #[test]
    fn liste_les_titres_du_mieux_au_moins_bien_note() {
        let eligibles = apparitions(&titres_de_l_essai());
        let pitt = personne_duel(eligibles.iter().find(|p| p.id == 287).unwrap(), 1200.0, 0);
        assert_eq!(pitt["seenIn"], json!(["Fight Club", "Once Upon a Time in Hollywood", "Troie"]));
        assert!(pitt["photoUrl"].as_str().unwrap().contains("/pitt.jpg"));
    }

    /// « signale l'absence de deux acteurs éligibles » : un seul titre, aucun éligible.
    #[test]
    fn signale_l_absence_de_deux_acteurs_eligibles() {
        let pitt = json!({ "id": 287, "name": "Brad Pitt", "profilePath": "/pitt.jpg" });
        assert_eq!(apparitions(&[("Seul".into(), Some(3), json!({ "cast": [pitt] }))]).len(), 0);
    }

    #[test]
    fn une_apparition_garde_le_nom_et_la_photo_de_la_premiere_et_compte_chaque_credit() {
        let titres = vec![
            ("A".to_owned(), None, json!({ "cast": [{ "id": 5, "name": "X", "profilePath": "/1.jpg" }] })),
            ("B".to_owned(), Some(0), json!({ "cast": [{ "id": 5, "name": "X2", "profilePath": "/2.jpg" }] })),
            ("C".to_owned(), Some(2), json!({ "cast": [{ "id": 5, "name": "X3", "profilePath": null }], "directors": [{ "id": 6, "name": "R" }] })),
        ];
        let p = &apparitions(&titres)[0];
        assert_eq!((p.nom.as_str(), p.photo.as_deref()), ("X", Some("/1.jpg")));
        assert_eq!(p.titres, vec![("A".into(), -1), ("B".into(), 0), ("C".into(), 2)]);
        // Les réalisateurs ne comptent pas pour les duels d'acteurs.
        assert_eq!(apparitions(&titres).len(), 1);
        assert_eq!(personne_duel(p, 1210.5, 2)["seenIn"], json!(["C", "B", "A"]));
    }
}
