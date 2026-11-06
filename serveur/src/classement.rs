//! Classement par étoiles (classement-v1 FR-2, FR-9) : les titres vus, palier par palier, du plus haut au
//! plus bas. Reprend `getRanking` de `src/lib/tierDuelService.ts` et `GET /api/classement`.
//!
//! Le dernier départage de la v1 est `name.localeCompare(autre, "fr")` (ICU). PostgreSQL a la même
//! collation ICU (`fr-x-icu`) : vérifié identique à Node sur les 1 779 noms de la base de Louis. Le rang
//! du nom est donc calculé par la base (`dense_rank`, deux noms identiques ont le même rang), et le tri,
//! stable comme celui de V8, se fait ici.
use crate::{
    auth::Utilisateur,
    bd,
    duels::categorie,
    erreur::Erreur,
    items::annee_affichee,
    js_v8,
    paliers::{DEPARTAGE, MIN_REPARTITION, note_affichee},
};
use axum::{Json, extract::Query};
use serde_json::{Value, json};
use sqlx::{Postgres, QueryBuilder, Row};
use std::cmp::Ordering;

const AFFICHE: &str = "https://image.tmdb.org/t/p/w500";

/// Un titre vu et noté, avec son état de départage effectif.
#[derive(Clone, Debug)]
pub(crate) struct Ligne {
    pub id: i64,
    pub note: i16,
    pub nom: String,
    /// Rang du nom selon la collation française d'ICU.
    pub rang_nom: i64,
    pub annee: Option<String>,
    pub affiche: Option<String>,
    pub elo: f64,
    pub duels: i32,
    /// Score de palier ; None tant que le titre n'a pas été comparé pour sa note actuelle.
    pub score: Option<f64>,
    pub comparaisons: i32,
    pub groupe: Option<i16>,
}

/// `byScore` : les titres comparés par score ; les autres par Elo général (s'il a servi), puis par nom.
fn par_score(x: &Ligne, y: &Ligne) -> Ordering {
    let signe = |d: f64| d.partial_cmp(&0.0).unwrap_or(Ordering::Equal);
    match (x.score, y.score) {
        (Some(a), Some(b)) => return signe(b - a),
        (Some(_), None) => return Ordering::Less,
        (None, Some(_)) => return Ordering::Greater,
        (None, None) => {}
    }
    let elo = |l: &Ligne| if l.duels > 0 { l.elo } else { f64::NEG_INFINITY };
    if elo(x) != elo(y) {
        return signe(elo(y) - elo(x));
    }
    x.rang_nom.cmp(&y.rang_nom)
}

/// `getRanking`, sans la base : `lignes` dans l'ordre des identifiants ; `sans_note` : titres vus non notés.
pub(crate) fn classement(lignes: &[Ligne], sans_note: i64) -> Value {
    let mut paliers = vec![];
    for etoiles in (0..=5).rev() {
        let mut palier: Vec<&Ligne> = lignes.iter().filter(|l| l.note == etoiles).collect();
        if palier.is_empty() {
            continue;
        }
        let reparti = palier.len() >= MIN_REPARTITION;
        // AC-15 : Haut, Milieu, Bas, puis les titres pas encore répartis.
        let rang_groupe = |l: &Ligne| if reparti { l.groupe.map_or(-1, i32::from) } else { 0 };
        palier.sort_by(|x, y| (rang_groupe(y) - rang_groupe(x)).cmp(&0).then_with(|| par_score(x, y)));
        paliers.push(json!({
            "stars": etoiles,
            "rating": note_affichee(etoiles),
            "compared": palier.iter().filter(|l| l.score.is_some()).count(),
            "settled": palier.iter().filter(|l| l.comparaisons >= DEPARTAGE).count(),
            "banded": reparti,
            "placed": palier.iter().filter(|l| l.groupe.is_some()).count(),
            "items": palier.iter().map(|l| json!({
                "id": l.id, "name": l.nom, "year": annee_affichee(l.annee.as_deref()),
                "posterUrl": l.affiche.as_ref().filter(|a| !a.is_empty()).map(|a| format!("{AFFICHE}{a}")),
                "tierScore": l.score, "tierDuels": l.comparaisons, "band": if reparti { l.groupe } else { None },
            })).collect::<Vec<_>>(),
        }));
    }
    json!({ "tiers": paliers, "unrated": sans_note })
}

/// GET /api/classement?category=
pub async fn lire(utilisateur: Utilisateur, Query(p): Query<Vec<(String, String)>>) -> Result<Json<Value>, Erreur> {
    let cat = js_v8::premier(&p, "category").filter(|c| matches!(*c, "Movie" | "TV Series" | "Documentary"));
    let mut tx = bd::transaction(&utilisateur).await?;
    let mut q = QueryBuilder::<Postgres>::new(
        "select id, rating as note, name, dense_rank() over (order by name collate \"fr-x-icu\") as rang_nom, year, poster_path, elo_score,
                duels_count::int as duels,
                case when tier_rating = rating and tier_duels_count > 0 then tier_elo end as score,
                (case when tier_rating = rating then tier_duels_count else 0 end)::int as comparaisons,
                case when tier_rating = rating then tier_band end as groupe
           from public.library_view where watch_status = 'Watched' and rating is not null",
    );
    categorie(&mut q, cat);
    q.push(" order by id");
    let lignes = q
        .build()
        .persistent(false)
        .fetch_all(&mut **tx)
        .await?
        .iter()
        .map(|l| {
            Ok(Ligne {
                id: l.try_get("id")?,
                note: l.try_get("note")?,
                nom: l.try_get("name")?,
                rang_nom: l.try_get("rang_nom")?,
                annee: l.try_get("year")?,
                affiche: l.try_get("poster_path")?,
                elo: l.try_get("elo_score")?,
                duels: l.try_get("duels")?,
                score: l.try_get("score")?,
                comparaisons: l.try_get("comparaisons")?,
                groupe: l.try_get("groupe")?,
            })
        })
        .collect::<Result<Vec<_>, sqlx::Error>>()?;
    let mut n = QueryBuilder::<Postgres>::new("select count(*) from public.library_view where watch_status = 'Watched' and rating is null");
    categorie(&mut n, cat);
    let sans_note: i64 = n.build_query_scalar().persistent(false).fetch_one(&mut **tx).await?;
    tx.valider().await?;
    Ok(Json(classement(&lignes, sans_note)))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::paliers::tests::Banc;

    /// Le classement du banc des paliers, avec les noms et l'Elo général de chaque titre.
    fn classer(b: &Banc, noms: &[(i64, &str)]) -> Value {
        let mut ids: Vec<&i64> = b.lignes.keys().collect();
        ids.sort();
        // Le rang du nom : les noms des essais sont ordonnés comme ICU les ordonne.
        let mut tries: Vec<&str> = noms.iter().map(|n| n.1).collect();
        tries.sort_by_key(|n| n.to_lowercase());
        tries.dedup();
        let nom = |id: i64| noms.iter().find(|n| n.0 == id).map(|n| n.1).unwrap_or("?");
        let mut sans_note = 0;
        let mut lignes = vec![];
        for id in ids {
            let l = &b.lignes[id];
            if l.statut.as_deref() != Some("Watched") {
                continue;
            }
            let Some(note) = l.note else {
                sans_note += 1;
                continue;
            };
            let valide = l.note_palier == Some(note);
            lignes.push(Ligne {
                id: *id,
                note,
                nom: nom(*id).into(),
                rang_nom: tries.iter().position(|n| *n == nom(*id)).unwrap_or(0) as i64,
                annee: None,
                affiche: None,
                elo: 1200.0,
                duels: 0,
                score: (valide && l.comparaisons > 0).then_some(l.elo_palier),
                comparaisons: if valide { l.comparaisons } else { 0 },
                groupe: if valide { l.groupe } else { None },
            });
        }
        classement(&lignes, sans_note)
    }

    fn noms_du_palier(c: &Value, etoiles: i64) -> Vec<String> {
        let palier = c["tiers"].as_array().unwrap().iter().find(|t| t["stars"] == json!(etoiles)).unwrap();
        palier["items"].as_array().unwrap().iter().map(|i| i["name"].as_str().unwrap().to_owned()).collect()
    }

    /// classement.test.ts, « Classement par étoiles (FR-2) », AC-5 : les comparés d'abord, par score.
    #[test]
    fn range_les_titres_compares_d_abord_par_score_puis_les_autres() {
        let mut b = Banc::default();
        let [premier, deuxieme, troisieme] = [0; 3].map(|_| b.titre(Some(4), "Watched"));
        let pas_compare = b.titre(Some(4), "Watched");
        let cinq = b.titre(Some(5), "Watched");
        let sans = b.titre(None, "Watched");
        b.quatuor(&[premier, deuxieme, troisieme], 4, premier, Some(troisieme)).unwrap();
        let noms = [(premier, "Premier"), (deuxieme, "Deuxième"), (troisieme, "Troisième"), (pas_compare, "Pas encore comparé"), (cinq, "Cinq étoiles"), (sans, "Vu sans note")];
        let c = classer(&b, &noms);
        assert_eq!(c["unrated"], json!(1));
        assert_eq!(c["tiers"].as_array().unwrap().iter().map(|t| t["stars"].as_i64().unwrap()).collect::<Vec<_>>(), [5, 4]);
        assert_eq!(noms_du_palier(&c, 4), ["Premier", "Deuxième", "Troisième", "Pas encore comparé"]);
        assert_eq!(c["tiers"][1]["compared"], json!(3));
        assert_eq!(c["tiers"][1]["items"][3]["tierScore"], Value::Null);
    }

    /// AC-4 : un titre dont la note change repart « pas encore comparé ».
    #[test]
    fn remet_pas_encore_compare_un_titre_dont_la_note_change() {
        let mut b = Banc::default();
        let [a, x] = [0; 2].map(|_| b.titre(Some(4), "Watched"));
        let c = b.titre(Some(5), "Watched");
        b.quatuor(&[a, x], 4, a, None).unwrap();
        b.lignes.get_mut(&a).unwrap().note = Some(5);
        let cl = classer(&b, &[(a, "A"), (x, "B"), (c, "C")]);
        let cinq = cl["tiers"].as_array().unwrap().iter().find(|t| t["stars"] == json!(5)).unwrap();
        let deplace = cinq["items"].as_array().unwrap().iter().find(|i| i["name"] == json!("A")).unwrap();
        assert_eq!(deplace["tierScore"], Value::Null);
        assert_eq!(deplace["tierDuels"], json!(0));
    }

    /// AC-15 : Haut, Milieu, Bas, puis les non répartis.
    #[test]
    fn range_par_groupe_haut_milieu_bas_puis_non_repartis() {
        let mut b = Banc::default();
        let ids: Vec<i64> = (0..MIN_REPARTITION).map(|_| b.titre(Some(4), "Watched")).collect();
        b.repartir(ids[0], 4, 0).unwrap();
        b.repartir(ids[1], 4, 2).unwrap();
        b.repartir(ids[2], 4, 1).unwrap();
        let noms: Vec<(i64, String)> = ids.iter().enumerate().map(|(i, id)| (*id, format!("Titre {i:03}"))).collect();
        let noms: Vec<(i64, &str)> = noms.iter().map(|(id, n)| (*id, n.as_str())).collect();
        let c = classer(&b, &noms);
        let palier = &c["tiers"][0];
        assert_eq!(palier["banded"], json!(true));
        assert_eq!(palier["placed"], json!(3));
        let premiers: Vec<i64> = palier["items"].as_array().unwrap()[..3].iter().map(|i| i["id"].as_i64().unwrap()).collect();
        assert_eq!(premiers, [ids[1], ids[2], ids[0]]);
        assert_eq!(palier["items"][3]["band"], Value::Null);
    }

    /// « annule une répartition »
    #[test]
    fn annule_une_repartition() {
        let mut b = Banc::default();
        let ids: Vec<i64> = (0..MIN_REPARTITION).map(|_| b.titre(Some(4), "Watched")).collect();
        let manche = b.repartir(ids[0], 4, 2).unwrap();
        assert_eq!(b.annuler(manche), Ok(true));
        assert_eq!(classer(&b, &[])["tiers"][0]["placed"], json!(0));
    }

    #[test]
    fn les_non_compares_suivent_l_elo_general_puis_le_nom() {
        let l = |id: i64, nom: &str, rang: i64, elo: f64, duels: i32| Ligne {
            id,
            note: 3,
            nom: nom.into(),
            rang_nom: rang,
            annee: None,
            affiche: Some(String::new()),
            elo,
            duels,
            score: None,
            comparaisons: 0,
            groupe: Some(1),
        };
        let lignes = vec![l(1, "Zorro", 3, 1300.0, 0), l(2, "Élise", 2, 1200.0, 0), l(3, "Alpha", 1, 1250.0, 2), l(4, "Élise", 2, 1100.0, 0)];
        let c = classement(&lignes, 0);
        let ids: Vec<i64> = c["tiers"][0]["items"].as_array().unwrap().iter().map(|i| i["id"].as_i64().unwrap()).collect();
        // Le seul Elo qui a servi d'abord ; puis les noms ; deux noms égaux gardent l'ordre des identifiants.
        assert_eq!(ids, [3, 2, 4, 1]);
        assert_eq!(c["tiers"][0]["items"][0]["band"], Value::Null, "un petit palier ne montre pas de groupe");
        assert_eq!(c["tiers"][0]["placed"], json!(4), "mais les compte, comme la v1");
        assert_eq!(c["tiers"][0]["items"][0]["posterUrl"], Value::Null);
    }
}
