//! Fraîcheur des recommandations : les titres montrés (impressions), l'ouverture d'une fiche, le jour
//! d'exposition et la lassitude qu'on en tire. Reprend `src/lib/impressionService.ts`, `impressionKeys.ts`,
//! `fatigueWeight` (`listShaping.ts`) et les routes `POST /api/impressions`, `POST /api/opened`.
//! spec: specs/recommandations-fraicheur-v1.md (FR-1 à FR-7)
//!
//! Le jour d'exposition de la v1 était la date locale du serveur (celui de Louis, à Paris) décalée de 4 h.
//! Le serveur v2 tourne en UTC : le fuseau `Europe/Paris` est donc calculé explicitement (règle de l'heure
//! d'été de l'Union européenne), sans dépendance.
use crate::{auth::Utilisateur, bd, erreur::Erreur, journal};
use axum::{
    Json,
    body::Bytes,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

/// Les surfaces qui proposent des titres (`impressionKeys.ts`).
pub const SURFACES: [&str; 5] = ["pile", "discover", "tonight", "home", "triage"];
/// Au plus autant de titres par lot envoyé par le navigateur.
pub const LOT_MAX: usize = 200;
/// Au-delà de 6 semaines, un jour montré ne pèse plus que 2 % : il n'est plus lu.
const MEMOIRE_JOURS: i64 = 42;
/// Les impressions plus anciennes sont purgées à l'écriture (NFR-2).
const CONSERVATION_JOURS: i64 = 90;
/// FR-3 : la journée commence à 4 h, pour qu'une soirée qui déborde minuit reste la même.
const DEBUT_JOURNEE_MS: i64 = 4 * 60 * 60 * 1000;
const JOUR_MS: i64 = 24 * 60 * 60 * 1000;
const HEURE_MS: i64 = 60 * 60 * 1000;
/// Un jour montré compte 1 la veille, puis s'efface de moitié chaque semaine (FR-5).
const DEMI_VIE_JOURS: f64 = 7.0;

/// Jours écoulés depuis le 1970-01-01 pour une date civile (algorithme de H. Hinnant). Le jour du mois peut
/// déborder (0, -111…), comme dans `new Date(a, m, j)`.
pub fn jours_depuis_epoque(annee: i64, mois: i64, jour: i64) -> i64 {
    let a = if mois <= 2 { annee - 1 } else { annee };
    let ere = a.div_euclid(400);
    let ae = a - ere * 400;
    let mp = (mois + 9) % 12;
    let jour_annee = (153 * mp + 2) / 5;
    let je = ae * 365 + ae / 4 - ae / 100 + jour_annee;
    ere * 146_097 + je - 719_468 + (jour - 1)
}

/// La date civile (année, mois, jour) d'un nombre de jours depuis le 1970-01-01.
pub fn date_civile(jours: i64) -> (i64, i64, i64) {
    let z = jours + 719_468;
    let ere = z.div_euclid(146_097);
    let je = z - ere * 146_097;
    let ae = (je - je / 1460 + je / 36_524 - je / 146_096) / 365;
    let ja = je - (365 * ae + ae / 4 - ae / 100);
    let mp = (5 * ja + 2) / 153;
    let jour = ja - (153 * mp + 2) / 5 + 1;
    let mois = if mp < 10 { mp + 3 } else { mp - 9 };
    (if mois <= 2 { ae + ere * 400 + 1 } else { ae + ere * 400 }, mois, jour)
}

/// Le dernier dimanche d'un mois, en jours depuis l'époque.
fn dernier_dimanche(annee: i64, mois: i64) -> i64 {
    let dernier = jours_depuis_epoque(annee, mois + 1, 1) - 1;
    dernier - (dernier + 4).rem_euclid(7) // le 1970-01-01 était un jeudi
}

/// Décalage de l'heure de Paris à un instant (en ms depuis l'époque, UTC) : 2 h du dernier dimanche de mars
/// à 1 h UTC au dernier dimanche d'octobre à 1 h UTC, 1 h sinon.
pub fn decalage_paris(ms: i64) -> i64 {
    let (annee, _, _) = date_civile(ms.div_euclid(JOUR_MS));
    let debut = dernier_dimanche(annee, 3) * JOUR_MS + HEURE_MS;
    let fin = dernier_dimanche(annee, 10) * JOUR_MS + HEURE_MS;
    if (debut..fin).contains(&ms) { 2 * HEURE_MS } else { HEURE_MS }
}

/// FR-3 (`exposureDay`) : le jour d'exposition d'un instant, date de Paris de l'instant décalé de 4 h (« 2026-10-09 »).
pub fn jour_exposition(ms: i64) -> String {
    let decale = ms - DEBUT_JOURNEE_MS;
    let (a, m, j) = date_civile((decale + decalage_paris(decale)).div_euclid(JOUR_MS));
    format!("{a:04}-{m:02}-{j:02}")
}

/// Jours écoulés entre deux jours d'exposition (« 2026-10-01 », « 2026-10-09 » : 8).
fn jours_entre(de: &str, a: &str) -> i64 {
    let jours = |j: &str| jours_depuis_epoque(j[0..4].parse().unwrap_or(0), j[5..7].parse().unwrap_or(1), j[8..10].parse().unwrap_or(1));
    jours(a) - jours(de)
}

/// `fatigueWeight` : poids d'un jour où le titre a été montré, il y a `jours` jours (1 : hier).
/// Groupe 3 : la valeur exacte de V8 (`0.5 ** ((jours - 1) / 7)`), que `powf` ne rend pas toujours au
/// dernier bit près (écarts mesurés) ; un écart d'un bit peut départager deux titres autrement.
pub fn poids_lassitude(jours: i64) -> f64 {
    debug_assert_eq!(DEMI_VIE_JOURS, 7.0, "la table de V8 est faite pour une demi-vie de 7 jours");
    crate::flottants::demi_puissance_septiemes((jours - 1) as f64)
}

/// L'instant présent, en ms depuis l'époque.
pub fn maintenant_ms() -> i64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Clé d'un sujet (`item:12`, `tmdb:movie:603`, `tmdb:tv:1399`) : (`item`, « 12 ») ou (`tmdb`, « movie:603 »).
pub fn cle_sujet(v: &Value) -> Option<(&'static str, String)> {
    let cle = v.as_str()?;
    let numero = |n: &str| n.starts_with(|c: char| ('1'..='9').contains(&c)) && n.bytes().all(|b| b.is_ascii_digit());
    if let Some(n) = cle.strip_prefix("item:") {
        return numero(n).then(|| ("item", n.to_owned()));
    }
    let tmdb = cle.strip_prefix("tmdb:")?;
    let n = tmdb.strip_prefix("movie:").or_else(|| tmdb.strip_prefix("tv:"))?;
    numero(n).then(|| ("tmdb", tmdb.to_owned()))
}

/// Les sujets valides d'un lot, sans doublon, dans l'ordre : la première occurrence l'emporte (EC-4), comme
/// l'insertion une à une de la v1 (`INSERT OR IGNORE`).
pub fn sujets_du_lot(cles: &[Value]) -> Vec<(&'static str, String)> {
    let mut vus = HashSet::new();
    cles.iter().take(LOT_MAX).filter_map(cle_sujet).filter(|s| vus.insert(s.clone())).collect()
}

/// FR-5, FR-7 (`getExposure`) : pour chaque titre (`item:12`, `tmdb:movie:603`), les jours où il a été montré,
/// aujourd'hui exclu et après son dernier geste (jour du geste compris), chacun pondéré par son ancienneté.
/// `affichages` : (type, id, jour) ; `gestes` : (type, id, instant en ms) des événements du journal.
pub fn exposition(affichages: &[(String, String, String)], gestes: &[(String, String, i64)], maintenant: i64) -> HashMap<String, f64> {
    let aujourd_hui = jour_exposition(maintenant);
    let depuis = jour_exposition(maintenant - MEMOIRE_JOURS * JOUR_MS);
    let montres: Vec<_> = affichages.iter().filter(|(_, _, j)| *j >= depuis && *j < aujourd_hui).collect();
    if montres.is_empty() {
        return HashMap::new();
    }
    // Un jour de marge : l'instant du geste est en UTC, le jour d'exposition à l'heure de Paris.
    let borne = maintenant - (MEMOIRE_JOURS + 1) * JOUR_MS;
    let mut dernier: HashMap<String, i64> = HashMap::new();
    for (t, id, quand) in gestes.iter().filter(|(t, _, q)| (t == "item" || t == "tmdb") && *q >= borne) {
        let e = dernier.entry(format!("{t}:{id}")).or_insert(*quand);
        *e = (*e).max(*quand);
    }
    let jour_geste: HashMap<String, String> = dernier.into_iter().map(|(k, q)| (k, jour_exposition(q))).collect();
    let mut exposition = HashMap::new();
    for (t, id, jour) in montres {
        let cle = format!("{t}:{id}");
        // Un geste efface aussi les impressions du jour où il a eu lieu : le titre t'a intéressé.
        if jour_geste.get(&cle).is_some_and(|g| jour <= g) {
            continue;
        }
        *exposition.entry(cle).or_insert(0.0) += poids_lassitude(jours_entre(jour, &aujourd_hui));
    }
    exposition
}

fn invalide() -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({ "error": "invalid_request" }))).into_response()
}

/// POST /api/impressions `{ surface, subjects }` : les titres montrés, au plus une ligne par titre et par jour
/// (la première surface l'emporte). Rend le nombre de lignes créées ; purge ce qui a plus de 90 jours.
pub async fn affichages(utilisateur: Utilisateur, corps: Bytes) -> Result<Response, Erreur> {
    let corps: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
    let surface = corps.get("surface").and_then(Value::as_str).filter(|s| SURFACES.contains(s));
    let sujets = corps.get("subjects").and_then(Value::as_array);
    let (Some(surface), Some(sujets)) = (surface, sujets) else { return Ok(invalide()) };
    if sujets.len() > LOT_MAX {
        return Ok(invalide());
    }
    let lot = sujets_du_lot(sujets);
    let maintenant = maintenant_ms();
    let (types, ids): (Vec<&str>, Vec<&str>) = lot.iter().map(|(t, i)| (*t, i.as_str())).unzip();
    let mut tx = bd::transaction(&utilisateur).await?;
    let crees = sqlx::query(
        "insert into public.impressions (subject_type, subject_id, day, surface)
         select s.type, s.id, $3::date, $4 from unnest($1::text[], $2::text[]) with ordinality as s(type, id, rang) order by s.rang
         on conflict do nothing",
    )
    .bind(&types)
    .bind(&ids)
    .bind(jour_exposition(maintenant))
    .bind(surface)
    .persistent(false)
    .execute(&mut **tx)
    .await?
    .rows_affected();
    sqlx::query("delete from public.impressions where day < $1::date")
        .bind(jour_exposition(maintenant - CONSERVATION_JOURS * JOUR_MS))
        .persistent(false)
        .execute(&mut **tx)
        .await?;
    tx.valider().await?;
    Ok(Json(json!({ "recorded": crees })).into_response())
}

/// POST /api/opened `{ subject }` : ouvrir la fiche d'un titre est un geste (FR-4).
pub async fn ouverture(utilisateur: Utilisateur, corps: Bytes) -> Result<Response, Erreur> {
    let corps: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
    let Some((genre, id)) = corps.get("subject").and_then(cle_sujet) else { return Ok(invalide()) };
    let mut tx = bd::transaction(&utilisateur).await?;
    journal::consigner(&mut tx, "opened", genre, &id, None).await?;
    tx.valider().await?;
    Ok(Json(json!({ "ok": true })).into_response())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// `new Date(annee, mois0, jour, heure, minute)` à l'heure de Paris (le jour peut déborder).
    fn paris(annee: i64, mois0: i64, jour: i64, heure: i64, minute: i64) -> i64 {
        let local = (jours_depuis_epoque(annee, mois0 + 1, jour) * 24 * 60 + heure * 60 + minute) * 60_000;
        let essai = local - HEURE_MS;
        local - decalage_paris(essai - HEURE_MS)
    }

    /// Le 9 octobre 2026 à `heures` heures (Paris), décalé de `jours` jours (`at` de la v1).
    fn at(jours: i64, heures: i64) -> i64 {
        paris(2026, 9, 9 + jours, heures, 0)
    }

    /// La table des impressions telle que la base la tient : (type, id, jour) unique, première surface gardée,
    /// purge des plus de 90 jours. Rend le nombre de lignes créées (`recordImpressions`).
    #[derive(Default)]
    struct Impressions(Vec<(String, String, String, String)>);

    impl Impressions {
        fn enregistrer(&mut self, surface: &str, cles: &[Value], quand: i64) -> usize {
            let jour = jour_exposition(quand);
            let mut crees = 0;
            for (t, id) in sujets_du_lot(cles) {
                if !self.0.iter().any(|l| l.0 == t && l.1 == id && l.2 == jour) {
                    self.0.push((t.into(), id, jour.clone(), surface.into()));
                    crees += 1;
                }
            }
            let seuil = jour_exposition(quand - CONSERVATION_JOURS * JOUR_MS);
            self.0.retain(|l| l.2 >= seuil);
            crees
        }
        fn lignes(&self) -> Vec<(String, String, String)> {
            self.0.iter().map(|l| (l.0.clone(), l.1.clone(), l.2.clone())).collect()
        }
    }

    fn cles(c: &[&str]) -> Vec<Value> {
        c.iter().map(|k| json!(k)).collect()
    }

    fn proche(a: Option<&f64>, b: f64) {
        let a = *a.expect("valeur attendue");
        assert!((a - b).abs() < 5e-7, "{a} au lieu de {b}");
    }

    fn poids(n: i64) -> f64 {
        0.5f64.powf((n - 1) as f64 / 7.0)
    }

    #[test]
    fn la_journee_commence_a_4_h() {
        assert_eq!(jour_exposition(paris(2026, 9, 9, 23, 50)), "2026-10-09");
        assert_eq!(jour_exposition(paris(2026, 9, 10, 0, 30)), "2026-10-09");
        assert_eq!(jour_exposition(paris(2026, 9, 10, 4, 30)), "2026-10-10");
    }

    #[test]
    fn l_heure_de_paris_suit_l_heure_d_ete() {
        // 2026 : heure d'été du 29 mars 01:00 UTC au 25 octobre 01:00 UTC.
        assert_eq!(decalage_paris(jours_depuis_epoque(2026, 3, 29) * JOUR_MS + HEURE_MS - 1), HEURE_MS);
        assert_eq!(decalage_paris(jours_depuis_epoque(2026, 3, 29) * JOUR_MS + HEURE_MS), 2 * HEURE_MS);
        assert_eq!(decalage_paris(jours_depuis_epoque(2026, 10, 25) * JOUR_MS + HEURE_MS - 1), 2 * HEURE_MS);
        assert_eq!(decalage_paris(jours_depuis_epoque(2026, 10, 25) * JOUR_MS + HEURE_MS), HEURE_MS);
        // 2026-10-28 03:30 UTC = 04:30 à Paris (heure d'hiver) : nouvelle journée.
        assert_eq!(jour_exposition(jours_depuis_epoque(2026, 10, 28) * JOUR_MS + 3 * HEURE_MS + 30 * 60_000), "2026-10-28");
        assert_eq!(jour_exposition(jours_depuis_epoque(2026, 10, 28) * JOUR_MS + 2 * HEURE_MS + 30 * 60_000), "2026-10-27");
        assert_eq!(date_civile(jours_depuis_epoque(2024, 2, 29)), (2024, 2, 29));
        assert_eq!(date_civile(0), (1970, 1, 1));
    }

    #[test]
    fn un_meme_titre_le_meme_jour_sur_trois_surfaces_donne_une_ligne() {
        let mut t = Impressions::default();
        assert_eq!(t.enregistrer("home", &cles(&["item:7"]), at(0, 18)), 1);
        assert_eq!(t.enregistrer("pile", &cles(&["item:7"]), at(0, 19)), 0);
        assert_eq!(t.enregistrer("tonight", &cles(&["item:7"]), at(0, 21)), 0);
        assert_eq!(t.0.iter().map(|l| l.3.as_str()).collect::<Vec<_>>(), ["home"]);
    }

    #[test]
    fn ignore_les_cles_invalides_et_garde_les_titres_hors_bibliotheque() {
        let lot = vec![json!("item:3"), json!("tmdb:movie:603"), json!("tmdb:tv:1399"), json!("item:0"), json!("tmdb:book:1"), json!(12), json!("item:3")];
        assert_eq!(Impressions::default().enregistrer("discover", &lot, at(0, 20)), 3);
        assert_eq!(sujets_du_lot(&lot), [("item", "3".to_owned()), ("tmdb", "movie:603".to_owned()), ("tmdb", "tv:1399".to_owned())]);
        assert_eq!(cle_sujet(&json!("item:01")), None);
        assert_eq!(cle_sujet(&json!("item:3 ")), None);
    }

    #[test]
    fn purge_les_impressions_de_plus_de_90_jours() {
        let mut t = Impressions::default();
        t.enregistrer("pile", &cles(&["item:1"]), at(-120, 20));
        t.enregistrer("pile", &cles(&["item:2"]), at(0, 20));
        assert_eq!(t.0.iter().map(|l| l.1.as_str()).collect::<Vec<_>>(), ["2"]);
    }

    #[test]
    fn compte_les_jours_montres_avant_aujourd_hui() {
        let mut t = Impressions::default();
        for j in [-3, -2, -1, 0] {
            t.enregistrer("pile", &cles(&["item:5", "tmdb:movie:603"]), at(j, 20));
        }
        let e = exposition(&t.lignes(), &[], at(0, 22));
        proche(e.get("item:5"), poids(1) + poids(2) + poids(3));
        proche(e.get("tmdb:movie:603"), poids(1) + poids(2) + poids(3));
    }

    #[test]
    fn un_jour_montre_compte_1_la_veille_et_la_moitie_une_semaine_plus_tard() {
        let mut t = Impressions::default();
        t.enregistrer("pile", &cles(&["item:5"]), at(-1, 20));
        t.enregistrer("pile", &cles(&["item:6"]), at(-8, 20));
        let e = exposition(&t.lignes(), &[], at(0, 20));
        proche(e.get("item:5"), 1.0);
        proche(e.get("item:6"), 0.5);
    }

    #[test]
    fn le_classement_du_jour_ne_bouge_pas_avec_les_impressions_du_jour() {
        let mut t = Impressions::default();
        t.enregistrer("pile", &cles(&["item:5"]), at(-1, 20));
        let avant = exposition(&t.lignes(), &[], at(0, 9));
        t.enregistrer("pile", &cles(&["item:5", "item:6"]), at(0, 10));
        assert_eq!(exposition(&t.lignes(), &[], at(0, 23)), avant);
    }

    #[test]
    fn ne_lit_plus_ce_qui_a_plus_de_6_semaines() {
        let mut t = Impressions::default();
        t.enregistrer("pile", &cles(&["item:5"]), at(-50, 20));
        t.enregistrer("pile", &cles(&["item:5"]), at(-2, 20));
        proche(exposition(&t.lignes(), &[], at(0, 20)).get("item:5"), poids(2));
    }

    #[test]
    fn un_geste_remet_le_compteur_a_zero_jour_du_geste_compris() {
        let mut t = Impressions::default();
        for j in [-4, -3, -2, -1] {
            t.enregistrer("pile", &cles(&["item:5"]), at(j, 20));
        }
        let gestes = [("item".to_owned(), "5".to_owned(), at(-3, 21))];
        proche(exposition(&t.lignes(), &gestes, at(0, 20)).get("item:5"), poids(1) + poids(2));
    }

    #[test]
    fn un_geste_sur_un_titre_hors_bibliotheque_compte_aussi() {
        let mut t = Impressions::default();
        t.enregistrer("discover", &cles(&["tmdb:tv:1399"]), at(-2, 20));
        let gestes = [("tmdb".to_owned(), "tv:1399".to_owned(), at(-1, 20))];
        assert!(!exposition(&t.lignes(), &gestes, at(0, 20)).contains_key("tmdb:tv:1399"));
    }
}
