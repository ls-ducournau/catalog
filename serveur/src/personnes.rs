//! Avis sur les personnes et vue Personnes. Reprend `src/app/api/people/opinions/**`,
//! `src/lib/personOpinionService.ts` (poser, retirer, réinitialiser, rétablir) et `src/lib/peopleService.ts`.
//!
//! Le nom d'une personne reste dans son avis (jamais dans le catalogue partagé : il vient du navigateur).
//! Dates : la v1 rend la chaîne ISO qu'elle a écrite (`toISOString`, millisecondes, « Z ») ; la v2 la
//! reformate à l'identique depuis `timestamptz`.
use crate::{
    auth::Utilisateur,
    bd::{self, Tx},
    erreur::Erreur,
    items::annee_affichee,
    js_v8,
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

const AFFICHE: &str = "https://image.tmdb.org/t/p/w500";
/// `toISOString()` : « 2026-10-12T10:20:30.123Z ».
pub(crate) const DATE_ISO: &str = r#"to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')"#;

fn reponse(statut: u16, corps: Value) -> Response {
    (StatusCode::from_u16(statut).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), Json(corps)).into_response()
}
fn invalide() -> Response {
    reponse(400, json!({ "error": "invalid_request" }))
}
fn ok() -> Response {
    Json(json!({ "ok": true })).into_response()
}

/// `posterUrl` : une adresse d'image, ou null pour un chemin absent ou vide.
pub(crate) fn url_image(chemin: Option<&Value>) -> Option<String> {
    chemin.and_then(Value::as_str).filter(|c| !c.is_empty()).map(|c| format!("{AFFICHE}{c}"))
}

/// `isRating` : un entier de 0 (💩) à 5.
fn est_note(v: &Value) -> Option<i16> {
    v.as_f64().filter(|n| n.fract() == 0.0 && (0.0..=5.0).contains(n)).map(|n| n as i16)
}

/// `opinion === 1 || opinion === -1`
fn est_avis(v: Option<&Value>) -> Option<i16> {
    let n = v.and_then(Value::as_f64)?;
    [1, -1].into_iter().find(|a| f64::from(*a) == n)
}

/// L'identifiant d'une personne à écrire. La v1 plante (500) sur un nombre non entier ; elle accepte
/// un identifiant nul ou négatif, que le schéma v2 refuse (`person_id > 0`) : 500 aussi.
fn personne_a_ecrire(v: &Value) -> Result<i32, Erreur> {
    js_v8::identifiant_i32(v).filter(|n| *n > 0).ok_or_else(|| Erreur::Interne(format!("identifiant de personne inutilisable : {v}")))
}

// ---------- la vue Personnes (peopleService) ----------

/// Un avis tel qu'il est en base.
#[derive(Clone, Debug)]
pub(crate) struct Avis {
    pub id: i64,
    pub nom: String,
    pub avis: i16,
    pub note: Option<i16>,
    pub modifie: String,
}

/// Un titre de la bibliothèque qui a ses crédits TMDB (`tmdb_features`).
#[derive(Clone, Debug)]
pub(crate) struct TitreCredite {
    pub id: i64,
    pub nom: String,
    pub annee: Option<String>,
    pub affiche: Option<String>,
    pub statut: Option<String>,
    /// Note de 0 à 5 ; None si le titre n'est pas noté.
    pub etoiles: Option<i32>,
    pub traits: Value,
}

/// Rôles dans l'ordre de `creditsOf` : (rôle, clé dans `tmdb_features`).
const ROLES: [(&str, &str); 3] = [("cast", "cast"), ("director", "directors"), ("producer", "producers")];

/// `getPeopleWithOpinions` : les personnes qui ont un avis, dans l'ordre des avis, avec ce que la
/// bibliothèque dit d'elles (titres vus, moyenne des notes, titres à voir, Elo des duels).
pub(crate) fn vue_personnes(avis: &[Avis], titres: &[TitreCredite], elos: &HashMap<i64, f64>) -> Vec<Value> {
    struct Vue {
        photo: Option<String>,
        roles: [bool; 3],
        vus: Vec<(i64, String, Option<i32>)>,
        a_voir: Vec<Value>,
    }
    let index: HashMap<i64, usize> = avis.iter().enumerate().map(|(i, a)| (a.id, i)).collect();
    let mut vues: Vec<Vue> = avis.iter().map(|_| Vue { photo: None, roles: [false; 3], vus: vec![], a_voir: vec![] }).collect();
    for titre in titres {
        // Une même personne peut être créditée deux fois (actrice et productrice) : un titre, une fois.
        let mut comptees: HashSet<i64> = HashSet::new();
        for (r, (_, cle)) in ROLES.iter().enumerate() {
            for personne in titre.traits.get(*cle).and_then(Value::as_array).into_iter().flatten() {
                let Some(id) = personne.get("id").and_then(Value::as_i64) else { continue };
                let Some(&i) = index.get(&id) else { continue };
                let vue = &mut vues[i];
                vue.roles[r] = true;
                if vue.photo.is_none() {
                    vue.photo = url_image(personne.get("profilePath"));
                }
                if !comptees.insert(id) {
                    continue;
                }
                if titre.statut.as_deref() == Some("Watched") {
                    vue.vus.push((titre.id, titre.nom.clone(), titre.etoiles));
                } else {
                    vue.a_voir.push(json!({
                        "id": titre.id, "name": titre.nom, "year": annee_affichee(titre.annee.as_deref()),
                        "posterUrl": titre.affiche.as_ref().filter(|a| !a.is_empty()).map(|a| format!("{AFFICHE}{a}")),
                    }));
                }
            }
        }
    }
    avis.iter()
        .zip(vues)
        .map(|(a, mut vue)| {
            let notes: Vec<i32> = vue.vus.iter().filter_map(|t| t.2).collect();
            let moyenne = (!notes.is_empty()).then(|| f64::from(notes.iter().sum::<i32>()) / notes.len() as f64);
            vue.vus.sort_by_key(|t| std::cmp::Reverse(t.2.unwrap_or(-1))); // stable, comme la v1
            let roles: Vec<&str> = ROLES.iter().enumerate().filter(|(i, _)| vue.roles[*i]).map(|(_, (r, _))| *r).collect();
            json!({
                "id": a.id, "name": a.nom, "photoUrl": vue.photo, "opinion": a.avis,
                "rating": if a.avis == 1 { a.note } else { None },
                "roles": roles,
                "seen": vue.vus.iter().map(|(id, nom, etoiles)| json!({ "id": id, "name": nom, "stars": etoiles })).collect::<Vec<_>>(),
                "averageStars": moyenne,
                "toWatch": vue.a_voir,
                "duelElo": elos.get(&a.id),
                "updatedAt": a.modifie,
            })
        })
        .collect()
}

async fn lire_avis(tx: &mut Tx, filtre: Option<i16>) -> Result<Vec<Avis>, Erreur> {
    let requete = format!(
        "select person_id, name, opinion, rating, {DATE_ISO} as modifie from public.person_opinions {} order by person_id",
        if filtre.is_some() { "where opinion = $1" } else { "" }
    );
    let mut q = sqlx::query(&requete).persistent(false);
    if let Some(f) = filtre {
        q = q.bind(f);
    }
    q.fetch_all(&mut ***tx)
        .await?
        .iter()
        .map(|l| {
            Ok(Avis {
                id: i64::from(l.try_get::<i32, _>("person_id")?),
                nom: l.try_get("name")?,
                avis: l.try_get("opinion")?,
                note: l.try_get("rating")?,
                modifie: l.try_get("modifie")?,
            })
        })
        .collect()
}

/// GET /api/people/opinions
pub async fn lire(utilisateur: Utilisateur) -> Result<Json<Value>, Erreur> {
    let mut tx = bd::transaction(&utilisateur).await?;
    let avis = lire_avis(&mut tx, None).await?;
    if avis.is_empty() {
        tx.valider().await?;
        return Ok(Json(json!({ "people": [] })));
    }
    let titres = sqlx::query(
        "select id, name, year, poster_path, watch_status, rating::int as etoiles, tmdb_features from public.library_view where tmdb_features is not null order by id",
    )
    .persistent(false)
    .fetch_all(&mut **tx)
    .await?
    .iter()
    .map(|l| {
        Ok(TitreCredite {
            id: l.try_get("id")?,
            nom: l.try_get("name")?,
            annee: l.try_get("year")?,
            affiche: l.try_get("poster_path")?,
            statut: l.try_get("watch_status")?,
            etoiles: l.try_get("etoiles")?,
            traits: l.try_get("tmdb_features")?,
        })
    })
    .collect::<Result<Vec<_>, sqlx::Error>>()?;
    let elos: HashMap<i64, f64> = sqlx::query_as::<_, (i32, f64)>("select person_id, elo_score from public.person_scores where duels_count > 0")
        .persistent(false)
        .fetch_all(&mut **tx)
        .await?
        .into_iter()
        .map(|(id, elo)| (i64::from(id), elo))
        .collect();
    tx.valider().await?;
    Ok(Json(json!({ "people": vue_personnes(&avis, &titres, &elos) })))
}

/// `setOpinion` : un « je n'aime pas » efface toujours la note ; une note donnée (ou null) la remplace ;
/// sans note, celle qui existe est gardée. Le nom d'un avis existant n'est pas réécrit (comme la v1).
pub(crate) async fn poser_avis(tx: &mut Tx, id: i32, nom: &str, avis: i16, note: Option<Option<i16>>) -> Result<(), Erreur> {
    if avis == -1 || note.is_some() {
        let gardee = if avis == -1 { None } else { note.flatten() };
        sqlx::query(
            "insert into public.person_opinions (person_id, name, opinion, rating, updated_at) values ($1, $2, $3, $4, now())
             on conflict (user_id, person_id) do update set opinion = excluded.opinion, updated_at = excluded.updated_at, rating = excluded.rating",
        )
        .bind(id)
        .bind(nom)
        .bind(avis)
        .bind(gardee)
        .persistent(false)
        .execute(&mut ***tx)
        .await?;
    } else {
        sqlx::query(
            "insert into public.person_opinions (person_id, name, opinion, updated_at) values ($1, $2, $3, now())
             on conflict (user_id, person_id) do update set opinion = excluded.opinion, updated_at = excluded.updated_at",
        )
        .bind(id)
        .bind(nom)
        .bind(avis)
        .persistent(false)
        .execute(&mut ***tx)
        .await?;
    }
    Ok(())
}

/// PUT /api/people/opinions : `{ id, name, opinion: 1 | -1, rating?: 0..5 | null }`.
pub async fn poser(utilisateur: Utilisateur, corps: Bytes) -> Result<Response, Erreur> {
    let corps: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
    let (Some(id), Some(nom), Some(avis)) = (corps.get("id").filter(|v| v.is_number()), corps.get("name").and_then(Value::as_str), est_avis(corps.get("opinion"))) else {
        return Ok(invalide());
    };
    // FR-13 : note de 0 à 5, ou null pour la retirer ; absente, inchangée.
    let note: Option<Option<i16>> = match corps.get("rating") {
        None => None,
        Some(Value::Null) => Some(None),
        Some(v) => match est_note(v) {
            Some(n) => Some(Some(n)),
            None => return Ok(invalide()),
        },
    };
    let id = personne_a_ecrire(id)?;
    let mut tx = bd::transaction(&utilisateur).await?;
    poser_avis(&mut tx, id, nom, avis, note).await?;
    tx.valider().await?;
    Ok(ok())
}

/// DELETE /api/people/opinions : `{ id }` ; un avis absent n'est pas une erreur.
pub async fn retirer(utilisateur: Utilisateur, corps: Bytes) -> Result<Response, Erreur> {
    let corps: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
    let Some(id) = corps.get("id").filter(|v| v.is_number()) else { return Ok(invalide()) };
    let mut tx = bd::transaction(&utilisateur).await?;
    // Un identifiant non entier ne désigne aucune ligne.
    if let Some(id) = js_v8::identifiant_i32(id) {
        sqlx::query("delete from public.person_opinions where person_id = $1").bind(id).persistent(false).execute(&mut **tx).await?;
    }
    tx.valider().await?;
    Ok(ok())
}

/// POST /api/people/opinions/reset : efface tous les « j'aime » ou tous les « je n'aime pas », et rend
/// ce qui a été effacé, de quoi l'annuler (FR-12).
pub async fn reinitialiser(utilisateur: Utilisateur, corps: Bytes) -> Result<Response, Erreur> {
    let corps: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
    let avis: i16 = match corps.get("side").and_then(Value::as_str) {
        Some("liked") => 1,
        Some("disliked") => -1,
        _ => return Ok(invalide()),
    };
    let mut tx = bd::transaction(&utilisateur).await?;
    let effaces = lire_avis(&mut tx, Some(avis)).await?;
    sqlx::query("delete from public.person_opinions where user_id = (select auth.uid()) and opinion = $1").bind(avis).persistent(false).execute(&mut **tx).await?;
    tx.valider().await?;
    let removed: Vec<Value> =
        effaces.iter().map(|a| json!({ "personId": a.id, "name": a.nom, "opinion": a.avis, "rating": a.note, "updatedAt": a.modifie })).collect();
    Ok(Json(json!({ "removed": removed })).into_response())
}

/// Une date ISO 8601 complète (« 2026-10-12T10:20:30.123Z ») : ce que la réinitialisation a rendu.
/// La v1 rangeait n'importe quelle chaîne ; une colonne `timestamptz` ne le peut pas.
fn date_iso(s: &str) -> bool {
    let o = s.as_bytes();
    let chiffres = |a: usize, b: usize| o.get(a..b).is_some_and(|x| x.iter().all(u8::is_ascii_digit));
    if !(o.len() >= 20 && chiffres(0, 4) && o[4] == b'-' && chiffres(5, 7) && o[7] == b'-' && chiffres(8, 10) && o[10] == b'T' && chiffres(11, 13) && o[13] == b':' && chiffres(14, 16) && o[16] == b':' && chiffres(17, 19)) {
        return false;
    }
    let mut i = 19;
    if o.get(i) == Some(&b'.') {
        let n = o[i + 1..].iter().take_while(|c| c.is_ascii_digit()).count();
        if n == 0 || n > 6 {
            return false;
        }
        i += 1 + n;
    }
    match &o[i..] {
        b"Z" => true,
        [b'+' | b'-', h1, h2, b':', m1, m2] => [h1, h2, m1, m2].iter().all(|c| c.is_ascii_digit()),
        _ => false,
    }
}

/// POST /api/people/opinions/restore : « Annuler » après une réinitialisation ; les avis reviennent à
/// l'identique (avis, note, date).
pub async fn retablir(utilisateur: Utilisateur, corps: Bytes) -> Result<Response, Erreur> {
    let corps: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
    let Some(lignes) = corps.get("rows").and_then(Value::as_array) else { return Ok(invalide()) };
    // isRow
    let mut propres = vec![];
    for r in lignes {
        let (Some(id), Some(nom), Some(avis), Some(date), Some(note)) = (
            r.get("personId").filter(|v| v.is_number()),
            r.get("name").and_then(Value::as_str),
            est_avis(r.get("opinion")),
            r.get("updatedAt").and_then(Value::as_str),
            r.get("rating").filter(|v| v.is_null() || v.is_number()),
        ) else {
            return Ok(invalide());
        };
        if !date_iso(date) {
            return Ok(invalide());
        }
        propres.push((id, nom, avis, date, if avis == 1 { est_note(note) } else { None }));
    }
    let mut tx = bd::transaction(&utilisateur).await?;
    for (id, nom, avis, date, note) in propres {
        sqlx::query(
            "insert into public.person_opinions (person_id, name, opinion, updated_at, rating) values ($1, $2, $3, $4::timestamptz, $5)
             on conflict (user_id, person_id) do update set name = excluded.name, opinion = excluded.opinion,
               updated_at = excluded.updated_at, rating = excluded.rating",
        )
        .bind(personne_a_ecrire(id)?)
        .bind(nom)
        .bind(avis)
        .bind(date)
        .bind(note)
        .persistent(false)
        .execute(&mut **tx)
        .await?;
    }
    tx.valider().await?;
    Ok(ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn titre(id: i64, nom: &str, etoiles: Option<i32>, statut: &str, cast: &[i64]) -> TitreCredite {
        // Comme `seed` de classement.test.ts : « Personne <id> », photo « /p<id>.jpg ».
        let cast: Vec<Value> = cast.iter().map(|p| json!({ "id": p, "name": format!("Personne {p}"), "profilePath": format!("/p{p}.jpg") })).collect();
        TitreCredite {
            id,
            nom: nom.into(),
            annee: None,
            affiche: None,
            statut: Some(statut.into()),
            etoiles,
            traits: json!({ "genres": ["Drama"], "keywords": [], "cast": cast, "directors": [], "year": 2010 }),
        }
    }
    fn avis(id: i64, nom: &str, a: i16, note: Option<i16>) -> Avis {
        Avis { id, nom: nom.into(), avis: a, note, modifie: "2026-10-28T10:00:00.000Z".into() }
    }

    /// classement.test.ts, « Vue Personnes (FR-6, AC-8) » : titres vus, moyenne, titres à voir.
    #[test]
    fn compte_les_titres_vus_fait_la_moyenne_et_liste_les_titres_a_voir() {
        let titres = vec![
            titre(1, "Cinq", Some(5), "Watched", &[7]),
            titre(2, "Quatre", Some(4), "Watched", &[7]),
            titre(3, "Trois", Some(3), "Watched", &[7]),
            titre(4, "À voir", None, "Unwatched", &[7]),
            titre(5, "Sans elle", Some(1), "Watched", &[8]),
        ];
        let vue = vue_personnes(&[avis(7, "Personne 7", 1, None)], &titres, &HashMap::new());
        let p = &vue[0];
        assert_eq!(p["seen"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect::<Vec<_>>(), ["Cinq", "Quatre", "Trois"]);
        assert_eq!(p["averageStars"], json!(4.0));
        assert_eq!(p["toWatch"].as_array().unwrap().iter().map(|t| t["name"].as_str().unwrap()).collect::<Vec<_>>(), ["À voir"]);
        assert_eq!(p["roles"], json!(["cast"]));
        assert_eq!(p["photoUrl"], json!("https://image.tmdb.org/t/p/w500/p7.jpg"));
    }

    /// classement.test.ts : « ne renvoie rien tant qu'aucun avis n'a été donné ».
    #[test]
    fn ne_renvoie_rien_sans_avis() {
        assert!(vue_personnes(&[], &[titre(1, "Titre", Some(5), "Watched", &[7])], &HashMap::new()).is_empty());
    }

    /// personOpinionService.test.ts (AC-18) : un « je n'aime pas » n'a pas de note, même si la base en garde une.
    #[test]
    fn une_personne_pas_aimee_n_a_pas_de_note() {
        let vue = vue_personnes(&[avis(1, "A", -1, Some(4))], &[], &HashMap::new());
        assert_eq!(vue[0]["opinion"], json!(-1));
        assert_eq!(vue[0]["rating"], Value::Null);
        let vue = vue_personnes(&[avis(1, "A", 1, Some(4))], &[], &HashMap::new());
        assert_eq!(vue[0]["rating"], json!(4));
    }

    #[test]
    fn un_titre_compte_une_fois_meme_avec_deux_roles_et_l_elo_vient_des_duels() {
        let t = TitreCredite {
            id: 1,
            nom: "Double".into(),
            annee: Some("2020 - ".into()),
            affiche: Some(String::new()),
            statut: Some("Unwatched".into()),
            etoiles: None,
            traits: json!({ "cast": [{ "id": 9, "name": "X", "profilePath": null }], "directors": [], "producers": [{ "id": 9, "name": "X", "profilePath": "/x.jpg" }] }),
        };
        let elos: HashMap<i64, f64> = [(9, 1250.5)].into_iter().collect();
        let vue = vue_personnes(&[avis(9, "X", 1, None)], &[t], &elos);
        assert_eq!(vue[0]["roles"], json!(["cast", "producer"]));
        assert_eq!(vue[0]["toWatch"], json!([{ "id": 1, "name": "Double", "year": "depuis 2020", "posterUrl": null }]));
        // La photo : la première non vide rencontrée (`??=`).
        assert_eq!(vue[0]["photoUrl"], json!("https://image.tmdb.org/t/p/w500/x.jpg"));
        assert_eq!(vue[0]["averageStars"], Value::Null);
        assert_eq!(vue[0]["duelElo"], json!(1250.5));
    }

    #[test]
    fn la_note_et_l_avis_se_lisent_comme_la_v1() {
        assert_eq!(est_note(&json!(4)), Some(4));
        assert_eq!(est_note(&json!(4.0)), Some(4));
        assert_eq!(est_note(&json!(0)), Some(0));
        assert_eq!(est_note(&json!(6)), None);
        assert_eq!(est_note(&json!(2.5)), None);
        assert_eq!(est_note(&json!("4")), None);
        assert_eq!(est_avis(Some(&json!(1.0))), Some(1));
        assert_eq!(est_avis(Some(&json!(-1))), Some(-1));
        assert_eq!(est_avis(Some(&json!(0))), None);
        assert_eq!(est_avis(Some(&json!("1"))), None);
    }

    #[test]
    fn la_date_rendue_par_la_reinitialisation_est_acceptee() {
        assert!(date_iso("2026-10-12T10:20:30.123Z"));
        assert!(date_iso("2026-10-12T10:20:30Z"));
        assert!(date_iso("2026-10-12T10:20:30.123+02:00"));
        assert!(!date_iso("hier"));
        assert!(!date_iso("2026-10-12 10:20:30"));
        assert!(!date_iso("2026-10-12T10:20:30.Z"));
    }
}
