//! « Ma pile à voir » : portage de `src/lib/recommendationService.ts` et des routes
//! `GET /api/recommendations` et `GET /api/recommendations/rows`. Modèle (v1.3), diversité (FR-12),
//! calibration (FR-30), exploration (FR-31), puis lassitude (fraîcheur FR-5). Même forme de réponse
//! que la v1 : un `LibraryItem` complet enrichi de son score, de ses voisins, de l'exploration et de la
//! compatibilité.
use crate::{
    auth::Utilisateur,
    bd::{self, Tx},
    erreur::Erreur,
    faconnage::{self, Ancre, CandidatRangee, Faconnable},
    items::{COLONNES, titre},
    js,
    modele::TitreModele,
    preference::{self, Classe, Gout},
};
use axum::{Json, extract::Query};
use serde_json::{Map, Value, json};
use std::{collections::HashMap, sync::Arc};

/// Un titre de la pile façonnée (`ShapedTitle`) : le titre du modèle, son classement, l'exploration.
#[derive(Clone, Debug)]
pub struct Facon {
    pub titre: TitreModele,
    pub classe: Classe,
    pub exploration: bool,
}

impl Faconnable for Facon {
    fn id(&self) -> i64 {
        self.classe.id
    }
    fn score(&self) -> f64 {
        self.classe.score
    }
    fn genres(&self) -> &[String] {
        &self.titre.genres
    }
}

/// Le lot d'un titre : ses deux voisins explicatifs principaux, dans un ordre stable.
fn lot_de_voisins(f: &Facon) -> String {
    let mut ids: Vec<i64> = f.classe.voisins.iter().take(2).map(|v| v.id).collect();
    ids.sort();
    ids.iter().map(i64::to_string).collect::<Vec<_>>().join("|")
}

pub struct Pile {
    pub faconnee: Vec<Facon>,
    pub total: usize,
    pub profil: Value,
    pub gout: Arc<Gout>,
}

/// `rankPile`. `Err(n)` : démarrage à froid, `n` titres vus notés.
pub async fn classer_la_pile(
    tx: &mut Tx,
    utilisateur: &Utilisateur,
    categorie: Option<&str>,
    genre: Option<&str>,
    services: Option<&[i64]>,
    maintenant: i64,
) -> Result<Result<Pile, usize>, Erreur> {
    let gout = preference::gout(tx, utilisateur).await?;
    let notes = gout.notes.len();
    if notes < preference::MIN_TITRES_NOTES {
        return Ok(Err(notes));
    }
    let profil = preference::profil(&gout);
    let mut qb = preference::requete_titres();
    qb.push(" and watch_status = 'Unwatched'").push(preference::NON_ECARTE);
    preference::filtrer(&mut qb, categorie, genre, services);
    let candidats = preference::charger_requete(tx, qb).await?;
    if candidats.is_empty() {
        return Ok(Ok(Pile { faconnee: vec![], total: 0, profil, gout }));
    }
    let avis = preference::poids_des_avis(tx).await?;
    let exposition = preference::lassitude(tx, maintenant).await?;
    let faconnee = faconner_pile(&gout, &candidats, &avis, &exposition);
    Ok(Ok(Pile { faconnee, total: candidats.len(), profil, gout }))
}

/// Le cœur pur de `rankPile` : classement, diversité, calibration, exploration, lassitude.
pub fn faconner_pile(gout: &Gout, candidats: &[TitreModele], avis: &HashMap<i64, f64>, exposition: &HashMap<String, f64>) -> Vec<Facon> {
    let par_id: HashMap<i64, &TitreModele> = candidats.iter().map(|t| (t.id, t)).collect();
    let mut classes: Vec<Facon> =
        preference::classer(gout, candidats, avis).into_iter().map(|c| Facon { titre: par_id[&c.id].clone(), classe: c, exploration: false }).collect();
    classes.sort_by(|a, b| b.classe.score.partial_cmp(&a.classe.score).unwrap_or(std::cmp::Ordering::Equal));
    let variee = faconnage::diversifier(classes, lot_de_voisins, faconnage::MAX_PAR_LOT);
    let cible = preference::distribution_aimee(gout);
    let calibree = faconnage::calibrer(&variee, &cible);
    let vivier = faconnage::vivier_d_exploration(&calibree, &cible, |f| (f.titre.note_moyenne, f.titre.votes));
    let intercalee: Vec<Facon> =
        faconnage::intercaler_exploration(&calibree, &vivier, |f| f.classe.id, 6).into_iter().map(|(f, exploration)| Facon { exploration, ..f }).collect();
    faconnage::appliquer_lassitude(intercalee, |f| exposition.get(&preference::cle_item(f.classe.id)).copied().unwrap_or(0.0))
}

/// `getItemsByIds` : les titres complets de la bibliothèque, dans l'ordre demandé (inconnus ignorés).
pub async fn titres_par_ids(tx: &mut Tx, ids: &[i64]) -> Result<Vec<Value>, Erreur> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let lignes = sqlx::query(&format!("select {COLONNES} from public.library_view where id = any($1)")).bind(ids.to_vec()).persistent(false).fetch_all(&mut ***tx).await?;
    let mut par_id: HashMap<i64, Value> = HashMap::new();
    for l in &lignes {
        let t = titre(l)?;
        par_id.insert(t["id"].as_i64().unwrap_or_default(), t);
    }
    Ok(ids.iter().filter_map(|id| par_id.get(id).cloned()).collect())
}

/// `toRecommendedItems`.
pub async fn titres_recommandes(tx: &mut Tx, faconnee: &[Facon]) -> Result<Vec<Value>, Erreur> {
    let par_id: HashMap<i64, &Facon> = faconnee.iter().map(|f| (f.classe.id, f)).collect();
    let titres = titres_par_ids(tx, &faconnee.iter().map(|f| f.classe.id).collect::<Vec<_>>()).await?;
    Ok(titres
        .into_iter()
        .map(|mut t| {
            let f = par_id[&t["id"].as_i64().unwrap_or_default()];
            if let Some(o) = t.as_object_mut() {
                o.insert("recommendationScore".into(), json!(f.classe.score));
                o.insert("neighbours".into(), json!(f.classe.voisins.iter().map(|v| json!({ "id": v.id, "name": v.nom, "stars": v.etoiles })).collect::<Vec<_>>()));
                o.insert("exploration".into(), json!(f.exploration));
                o.insert("compatibility".into(), json!(f.classe.compatibilite));
            }
            t
        })
        .collect())
}

fn categorie_valide(c: Option<&String>) -> Option<&str> {
    c.map(String::as_str).filter(|c| matches!(*c, "Movie" | "TV Series" | "Documentary"))
}

fn pas_assez(notes: usize) -> Json<Value> {
    Json(json!({ "error": "not_enough_signal", "ratedCount": notes }))
}

/// `getRecommendations` : le classement complet, tronqué (`limit`, 24 par défaut).
pub async fn recommandations_de(tx: &mut Tx, utilisateur: &Utilisateur, p: &HashMap<String, String>, limite: Option<f64>, services: Option<&[i64]>) -> Result<Value, Erreur> {
    let categorie = categorie_valide(p.get("category").or_else(|| p.get("type")));
    let genre = p.get("genre").map(String::as_str).filter(|g| !g.is_empty());
    Ok(match classer_la_pile(tx, utilisateur, categorie, genre, services, js::maintenant_ms()).await? {
        Err(n) => pas_assez(n).0,
        Ok(pile) => {
            let fin = js::fin_slice(limite.unwrap_or(24.0), pile.faconnee.len());
            let items = titres_recommandes(tx, &pile.faconnee[..fin]).await?;
            json!({ "items": items, "total": pile.total, "profile": pile.profil })
        }
    })
}

/// GET /api/recommendations?category=&genre=&limit=&onMyServices=1
pub async fn recommandations(utilisateur: Utilisateur, Query(p): Query<HashMap<String, String>>) -> Result<Json<Value>, Erreur> {
    // `category ?? type` de la v1 : une catégorie présente, même vide, l'emporte.
    let mut p = p;
    if p.contains_key("category") {
        p.remove("type");
    }
    let limite = p.get("limit").filter(|l| !l.is_empty()).map(|l| js::nombre_ou_nan(l));
    let mut tx = bd::transaction(&utilisateur).await?;
    let services: Option<Vec<i64>> =
        if p.get("onMyServices").map(String::as_str) == Some("1") { Some(crate::reglages::services_couverts(&mut tx).await?.into_iter().collect()) } else { None };
    let corps = recommandations_de(&mut tx, &utilisateur, &p, limite, services.as_deref()).await?;
    tx.valider().await?;
    Ok(Json(corps))
}

/// GET /api/recommendations/rows?category=&genre=&onMyServices=1 (FR-32) : la même liste en rangées.
pub async fn rangees(utilisateur: Utilisateur, Query(p): Query<HashMap<String, String>>) -> Result<Json<Value>, Erreur> {
    let maintenant = js::maintenant_ms();
    let categorie = categorie_valide(p.get("category"));
    let genre = p.get("genre").map(String::as_str).filter(|g| !g.is_empty());
    let mut tx = bd::transaction(&utilisateur).await?;
    // Les abonnements servent toujours à la rangée « Disponible sur tes abonnements ».
    let couverts = crate::reglages::services_couverts(&mut tx).await?;
    let liste: Vec<i64> = couverts.iter().copied().collect();
    let services = (p.get("onMyServices").map(String::as_str) == Some("1")).then_some(liste.as_slice());
    let pile = match classer_la_pile(&mut tx, &utilisateur, categorie, genre, services, maintenant).await? {
        Err(n) => {
            tx.valider().await?;
            return Ok(pas_assez(n));
        }
        Ok(pile) => pile,
    };
    if pile.faconnee.is_empty() {
        tx.valider().await?;
        return Ok(Json(json!({ "rows": [], "total": 0, "profile": pile.profil })));
    }
    let items = titres_recommandes(&mut tx, &pile.faconnee).await?;
    tx.valider().await?;
    let par_id: HashMap<i64, &Value> = items.iter().map(|i| (i["id"].as_i64().unwrap_or_default(), i)).collect();
    let candidats: Vec<CandidatRangee> = pile
        .faconnee
        .iter()
        .filter_map(|f| {
            let item = par_id.get(&f.classe.id)?;
            let annee = f.titre.annee.or_else(|| item["year"].as_str().filter(|a| !a.is_empty()).map(js::nombre_ou_nan));
            Some(CandidatRangee {
                id: f.classe.id,
                score: f.classe.score,
                film: item["type"] == "Movie",
                duree: f.titre.duree,
                annee,
                votes: f.titre.votes,
                sur_mes_abonnements: !crate::reglages::inclus_dans(item.get("availability").filter(|a| !a.is_null()), &couverts).is_empty(),
                ancre: f.classe.voisins.first().map(|v| Ancre { id: v.id, nom: v.nom.clone(), etoiles: v.etoiles }),
                exploration: f.exploration,
            })
        })
        .collect();
    let rangees = faconnage::composer_rangees(&candidats, js::annee_paris(maintenant) as f64, !couverts.is_empty());
    let rows: Vec<Value> = rangees
        .into_iter()
        .map(|r| {
            let mut o = Map::new();
            o.insert("key".into(), json!(r.cle));
            o.insert("title".into(), json!(r.titre));
            if let Some(a) = r.ancre {
                o.insert("anchor".into(), json!(a));
            }
            o.insert("items".into(), json!(r.ids.iter().filter_map(|id| par_id.get(id).map(|v| (*v).clone())).collect::<Vec<_>>()));
            Value::Object(o)
        })
        .collect();
    Ok(Json(json!({ "rows": rows, "total": pile.total, "profile": pile.profil })))
}

#[cfg(test)]
mod tests {
    //! Tests de src/lib/recommendationService.test.ts (FR-12, AC-19, AC-20, fraîcheur AC-3, AC-5) et du
    //! classement par les avis (triageService.test.ts, AC-4), sur le cœur pur de la pile.
    use super::*;
    use crate::fraicheur::{exposition, jour_exposition as jour_d_exposition};

    /// Un titre comme le `seed` des tests de la v1 : un drame de 2010, 110 min, anglais, 7/10 sur 5 000 votes.
    fn titre(id: i64, nom: &str, etoiles: Option<i32>, mots_cles: &[&str], distribution: &[i64]) -> TitreModele {
        TitreModele {
            id,
            nom: nom.into(),
            etoiles,
            genres: vec!["Drama".into()],
            mots_cles: mots_cles.iter().map(|s| s.to_string()).collect(),
            distribution: distribution.iter().map(|i| format!("Personne {i}")).collect(),
            langue: Some("en".into()),
            annee: Some(2010.0),
            duree: Some(110.0),
            note_moyenne: Some(7.0),
            votes: Some(5000.0),
            personnes: distribution.to_vec(),
            ..Default::default()
        }
    }

    /// Tu adores l'espace, tu détestes les zombies : 16 titres vus notés, puis deux candidats.
    fn espace_et_zombies() -> (Gout, Vec<TitreModele>, i64) {
        let mut notes = vec![];
        let mut id = 0;
        for i in 0..8 {
            id += 1;
            notes.push(titre(id, &format!("Espace {i}"), Some(5), &["space", "astronaut"], &[]));
            id += 1;
            notes.push(titre(id, &format!("Zombie {i}"), Some(1), &["zombie", "undead"], &[]));
        }
        let candidats = vec![titre(17, "Candidat zombie", None, &["zombie", "undead"], &[]), titre(18, "Candidat espace", None, &["space", "astronaut"], &[])];
        (Gout::entrainer(notes), candidats, 18)
    }

    fn noms(f: &[Facon]) -> Vec<&str> {
        f.iter().map(|x| x.titre.nom.as_str()).collect()
    }

    #[test]
    fn demarrage_a_froid_sous_10_titres_notes_ac20() {
        let notes: Vec<TitreModele> = (1..=9).map(|i| titre(i, &format!("Vu {i}"), Some(4), &[], &[])).collect();
        assert!(Gout::entrainer(notes).notes.len() < preference::MIN_TITRES_NOTES);
    }

    #[test]
    fn classe_d_apres_les_themes_et_l_explique_par_eux() {
        let (gout, candidats, _) = espace_et_zombies();
        let pile = faconner_pile(&gout, &candidats, &HashMap::new(), &HashMap::new());
        assert_eq!(noms(&pile), vec!["Candidat espace", "Candidat zombie"]);
        assert!(!pile[0].classe.voisins.is_empty());
        assert!(pile[0].classe.voisins.iter().all(|v| v.nom.starts_with("Espace")));
    }

    #[test]
    fn un_titre_montre_hier_cede_sa_place_compatibilite_intacte_ac5() {
        let (gout, candidats, espace) = espace_et_zombies();
        let maintenant = js::maintenant_ms();
        let avant = faconner_pile(&gout, &candidats, &HashMap::new(), &HashMap::new());
        let montres = vec![("item".to_owned(), espace.to_string(), jour_d_exposition(maintenant - js::JOUR_MS))];
        let apres = faconner_pile(&gout, &candidats, &HashMap::new(), &exposition(&montres, &[], maintenant));
        assert_eq!(noms(&apres), vec!["Candidat zombie", "Candidat espace"]);
        assert_eq!(apres[1].classe.compatibilite, avant[0].classe.compatibilite);
    }

    #[test]
    fn les_impressions_du_jour_ne_changent_rien_ac3() {
        let (gout, candidats, espace) = espace_et_zombies();
        let maintenant = js::maintenant_ms();
        let montres = vec![("item".to_owned(), espace.to_string(), jour_d_exposition(maintenant))];
        let pile = faconner_pile(&gout, &candidats, &HashMap::new(), &exposition(&montres, &[], maintenant));
        assert_eq!(noms(&pile), vec!["Candidat espace", "Candidat zombie"]);
    }

    #[test]
    fn le_modele_est_reutilise_tant_que_rien_ne_change_ac19() {
        let notes: Vec<TitreModele> = (1..=12).map(|i| titre(i, &format!("Vu {i}"), Some(3), &["drama"], &[])).collect();
        let premier = Arc::new(Gout::entrainer(notes));
        preference::mettre_en_cache("compte-test-ac19", "12|a".into(), premier.clone());
        assert!(Arc::ptr_eq(&preference::du_cache("compte-test-ac19", "12|a").unwrap(), &premier));
        // Une note change l'empreinte : le modèle est reconstruit.
        assert!(preference::du_cache("compte-test-ac19", "12|b").is_none());
        assert!(preference::du_cache("autre-compte", "12|a").is_none());
    }

    #[test]
    fn l_acteur_aime_fait_passer_devant_ac4() {
        let notes: Vec<TitreModele> = (0..12).map(|i| titre(i + 1, &format!("Vu {i}"), Some(3 + (i as i32 % 3)), &["drama"], &[])).collect();
        let gout = Gout::entrainer(notes);
        let candidats = vec![titre(13, "Avec l'acteur", None, &["drama"], &[42]), titre(14, "Sans lui", None, &["drama"], &[43])];
        let ordre = |avis: i32| {
            let poids = preference::avis_centres(&[(42, preference::valeur_avis(avis, None))]);
            faconner_pile(&gout, &candidats, &poids, &HashMap::new()).iter().map(|f| f.titre.nom.clone()).collect::<Vec<_>>()
        };
        assert_eq!(ordre(1), vec!["Avec l'acteur", "Sans lui"]);
        assert_eq!(ordre(-1), vec!["Sans lui", "Avec l'acteur"]);
    }
}
