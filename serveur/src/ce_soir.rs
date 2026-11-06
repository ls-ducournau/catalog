//! Ce soir : portage de `src/lib/tonight.ts` (contexte de la soirée, logique pure), de `tonightService.ts`
//! (ma pile, une playlist, tout le catalogue) et de `GET /api/tonight` (specs/ce-soir-v2.md ; lassitude :
//! recommandations-fraicheur-v1 FR-9).
use crate::{
    auth::Utilisateur,
    bd::{self, Tx},
    decouverte::{self, PARALLELE, cle_tmdb},
    erreur::Erreur,
    faconnage,
    js,
    modele::TitreModele,
    preference::{self, Classe},
    recommandations::titres_par_ids,
    reglages,
    tmdb_decouverte::{self as tmdb, Resultat},
};
use axum::{Json, extract::Query};
use serde_json::{Value, json};
use std::collections::HashMap;

// ---------- le contexte (tonight.ts) ----------

#[derive(Clone, Debug, PartialEq)]
pub struct Contexte {
    pub envie: &'static str,
    pub format: &'static str,
    /// Films seulement (FR-4) ; `None` = sans limite.
    pub minutes_max: Option<f64>,
    pub compagnie: &'static str,
    pub ou: &'static str,
    pub source: &'static str,
    pub playlist: Option<i64>,
    /// Un genre TMDB précis (nom anglais), en plus de l'envie.
    pub genre: Option<String>,
}

pub const PAR_DEFAUT: Contexte = Contexte { envie: "any", format: "any", minutes_max: None, compagnie: "alone", ou: "services", source: "pile", playlist: None, genre: None };

/// FR-2 : genres TMDB (films et séries) de chaque envie.
pub fn genres_de_l_envie(envie: &str) -> &'static [&'static str] {
    match envie {
        "light" => &["Comedy", "Animation", "Family", "Kids"],
        "intense" => &["Thriller", "Action", "Crime", "Horror", "Mystery", "Action & Adventure"],
        "moving" => &["Drama", "Romance"],
        "escape" => &["Science Fiction", "Fantasy", "Adventure", "Sci-Fi & Fantasy", "Action & Adventure"],
        "think" => &["Documentary", "History", "War", "War & Politics"],
        _ => &[],
    }
}

/// FR-3 : « en famille », un de ces genres, et jamais l'horreur.
pub const GENRES_FAMILLE: [&str; 6] = ["Family", "Animation", "Comedy", "Adventure", "Fantasy", "Kids"];
pub const EXCLUS_FAMILLE: [&str; 1] = ["Horror"];

#[derive(Clone, Debug)]
pub struct Candidat {
    pub film: bool,
    pub documentaire: bool,
    pub genres: Vec<String>,
    pub duree: Option<f64>,
}

/// FR-1 à FR-4 (`matchesContext`) : ce titre convient-il à la soirée décrite ?
pub fn convient(c: &Candidat, x: &Contexte) -> bool {
    if x.format == "Documentary" && !c.documentaire {
        return false;
    }
    if (x.format == "Movie" || x.format == "TV Series") && (c.film != (x.format == "Movie") || c.documentaire) {
        return false;
    }
    if let Some(g) = &x.genre
        && !c.genres.contains(g) && !(g == "Documentary" && c.documentaire) {
            return false;
        }
    if x.envie != "any" {
        let voulus = genres_de_l_envie(x.envie);
        if !(c.genres.iter().any(|g| voulus.contains(&g.as_str())) || (x.envie == "think" && c.documentaire)) {
            return false;
        }
    }
    if x.compagnie == "family"
        && (c.genres.iter().any(|g| EXCLUS_FAMILLE.contains(&g.as_str())) || !c.genres.iter().any(|g| GENRES_FAMILLE.contains(&g.as_str()))) {
            return false;
        }
    if let (Some(m), true, Some(d)) = (x.minutes_max, c.film, c.duree)
        && d > m {
            return false;
        }
    true
}

/// EC-1 (`mostRestrictive`) : le réglage dont le relâchement rend le plus de titres ; `None` si rien ne filtre.
pub fn plus_restrictif(candidats: &[Candidat], x: &Contexte) -> Option<&'static str> {
    let relaches: [(&'static str, Contexte); 5] = [
        ("mood", Contexte { envie: "any", ..x.clone() }),
        ("genre", Contexte { genre: None, ..x.clone() }),
        ("format", Contexte { format: "any", ..x.clone() }),
        ("maxMinutes", Contexte { minutes_max: None, ..x.clone() }),
        ("company", Contexte { compagnie: "alone", ..x.clone() }),
    ];
    let mut meilleur: Option<(&'static str, usize)> = None;
    for (cle, relache) in relaches {
        if relache == *x {
            continue;
        }
        let gagnes = candidats.iter().filter(|c| convient(c, &relache)).count();
        if gagnes > 0 && meilleur.is_none_or(|m| gagnes > m.1) {
            meilleur = Some((cle, gagnes));
        }
    }
    meilleur.map(|m| m.0)
}

fn choisir(v: Option<&String>, permis: &[&'static str], defaut: &'static str) -> &'static str {
    v.and_then(|v| permis.iter().find(|p| **p == v.as_str()).copied()).unwrap_or(defaut)
}

/// `parseContext` : réglage par réglage, la valeur par défaut sinon.
pub fn lire_contexte(p: &HashMap<String, String>) -> Contexte {
    let minutes = p.get("maxMinutes").and_then(|m| js::nombre(m)).filter(|m| m.is_finite() && *m > 0.0);
    let playlist = p.get("playlistId").and_then(|m| js::nombre(m)).filter(|n| n.is_finite() && n.fract() == 0.0 && *n > 0.0).map(|n| n as i64);
    let source = choisir(p.get("source"), &["pile", "catalog", "playlist"], PAR_DEFAUT.source);
    Contexte {
        envie: choisir(p.get("mood"), &["any", "light", "intense", "moving", "escape", "think"], PAR_DEFAUT.envie),
        format: choisir(p.get("format"), &["any", "Movie", "TV Series", "Documentary"], PAR_DEFAUT.format),
        minutes_max: minutes,
        compagnie: choisir(p.get("company"), &["alone", "duo", "family"], PAR_DEFAUT.compagnie),
        ou: choisir(p.get("where"), &["services", "anywhere"], PAR_DEFAUT.ou),
        source: if source == "playlist" && playlist.is_none() { "pile" } else { source },
        playlist: if source == "playlist" { playlist } else { None },
        genre: p.get("genre").filter(|g| !js::trim(g).is_empty() && js::longueur(g) <= 60).map(|g| js::trim(g).to_owned()),
    }
}

// ---------- les propositions (tonightService.ts) ----------

const PROPOSITIONS_MAX: usize = 24;
const PAGES_CATALOGUE: i64 = 2;
const FICHES_CATALOGUE: usize = 36;

fn raison(c: &Classe) -> Value {
    c.voisins.first().map(|v| json!(js::proche_de(&v.nom))).unwrap_or(Value::Null)
}

fn classes_et_lasses(gout: &preference::Gout, titres: &[TitreModele], avis: &HashMap<i64, f64>, lassitude: impl Fn(&Classe) -> f64) -> Vec<Classe> {
    let mut classes = preference::classer(gout, titres, avis);
    classes.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    faconnage::appliquer_lassitude(classes, lassitude)
}

/// Ma pile, ou une playlist (playlists-v2 FR-8) : local, sans TMDB (NFR-1).
async fn depuis_la_pile(tx: &mut Tx, u: &Utilisateur, x: &Contexte, couverts: &[i64]) -> Result<Value, Erreur> {
    let mut qb = preference::requete_titres();
    qb.push(" and watch_status = 'Unwatched'").push(preference::NON_ECARTE);
    if let (true, Some(p)) = (x.source == "playlist", x.playlist) {
        qb.push(" and id in (select item_id from public.playlist_items where playlist_id = ").push_bind(p).push(")");
    }
    let services = (x.ou == "services" && !couverts.is_empty()).then_some(couverts);
    preference::filtrer(&mut qb, None, None, services);
    let titres = preference::charger_requete(tx, qb).await?;
    let items: HashMap<i64, Value> = titres_par_ids(tx, &titres.iter().map(|t| t.id).collect::<Vec<_>>()).await?.into_iter().map(|i| (i["id"].as_i64().unwrap_or_default(), i)).collect();
    let candidat = |t: &TitreModele| -> Option<Candidat> {
        let item = items.get(&t.id)?;
        Some(Candidat { film: item["type"] == "Movie", documentaire: item["category"] == "Documentary", genres: t.genres.clone(), duree: t.duree })
    };
    let correspondants: Vec<TitreModele> = titres.iter().filter(|t| candidat(t).is_some_and(|c| convient(&c, x))).cloned().collect();
    let gout = preference::gout(tx, u).await?;
    let avis = preference::poids_des_avis(tx).await?;
    let exposition = preference::lassitude(tx, js::maintenant_ms()).await?;
    let classes = classes_et_lasses(&gout, &correspondants, &avis, |c| exposition.get(&preference::cle_item(c.id)).copied().unwrap_or(0.0));
    let par_id: HashMap<i64, &TitreModele> = correspondants.iter().map(|t| (t.id, t)).collect();
    let propositions: Vec<Value> = classes
        .iter()
        .take(PROPOSITIONS_MAX)
        .map(|s| {
            let item = &items[&s.id];
            let t = par_id[&s.id];
            json!({
                "key": format!("item:{}", s.id), "tmdbId": null, "libraryId": s.id, "libraryStatus": item["watchStatus"],
                "type": item["type"], "isDocumentary": item["category"] == "Documentary", "title": item["name"], "year": item["year"],
                "posterUrl": item["posterUrl"], "overview": item["overview"].as_str().unwrap_or(""), "runtime": t.duree.map(js::nombre_json),
                "genres": t.genres, "voteAverage": item["voteAverage"], "voteCount": item["voteCount"], "compatibility": s.compatibilite,
                "reason": raison(s), "availability": item["availability"], "release": item["release"], "trailer": item["trailer"],
            })
        })
        .collect();
    let relache = if correspondants.is_empty() { plus_restrictif(&titres.iter().filter_map(candidat).collect::<Vec<_>>(), x) } else { None };
    Ok(json!({ "picks": propositions, "matched": correspondants.len(), "relax": relache, "catalogUnavailable": false, "baseRate": preference::taux_de_base(&gout) }))
}

/// Tout le catalogue (FR-5) : titres TMDB populaires du contexte, fiches gardées 7 jours.
async fn depuis_le_catalogue(tx: &mut Tx, u: &Utilisateur, x: &Contexte, couverts: &[i64]) -> Result<Value, Erreur> {
    let types: Vec<bool> = match x.format {
        "Movie" => vec![true],
        "TV Series" => vec![false],
        _ => vec![true, false],
    };
    // Dégrossir côté TMDB : le genre choisi, sinon le documentaire, l'envie, la famille ; le reste est vérifié ici.
    let genres: Option<Vec<String>> = if let Some(g) = &x.genre {
        Some(vec![g.clone()])
    } else if x.format == "Documentary" {
        Some(vec!["Documentary".into()])
    } else if x.envie != "any" {
        Some(genres_de_l_envie(x.envie).iter().map(|s| s.to_string()).collect())
    } else if x.compagnie == "family" {
        Some(GENRES_FAMILLE.iter().map(|s| s.to_string()).collect())
    } else {
        None
    };
    let services: Option<Vec<i64>> = (x.ou == "services" && !couverts.is_empty()).then(|| couverts.to_vec());
    let demandes: Vec<(bool, i64)> = types.iter().flat_map(|f| (1..=PAGES_CATALOGUE).map(move |p| (*f, p))).collect();
    let (genres_c, services_c, minutes) = (genres.clone(), services.clone(), x.minutes_max);
    let pages: Vec<Vec<Resultat>> = decouverte::en_parallele(demandes, 8, move |(film, page)| {
        let (g, s) = (genres_c.clone(), services_c.clone());
        async move { tmdb::decouvrir_pour_ce_soir(film, g.as_deref(), minutes, s.as_deref(), page).await }
    })
    .await;
    let trouves: Vec<Resultat> = pages.into_iter().flatten().collect();
    let gout = preference::gout(tx, u).await?;
    if trouves.is_empty() {
        return Ok(json!({ "picks": [], "matched": 0, "relax": null, "catalogUnavailable": true, "baseRate": preference::taux_de_base(&gout) }));
    }
    // Hors titres vus et titres écartés ; un titre de ta pile est gardé, et signalé.
    let bibliotheque = decouverte::bibliotheque_par_tmdb(tx, &trouves.iter().map(|r| r.tmdb_id).collect::<Vec<_>>()).await?;
    let ecartes = decouverte::tmdb_ecartes(tx).await?;
    let mut vus = std::collections::HashSet::new();
    let premier_tri: Vec<Resultat> = trouves
        .into_iter()
        .filter(|r| {
            let cle = cle_tmdb(r.type_, r.tmdb_id);
            if vus.contains(&cle) || ecartes.contains(&cle) {
                return false;
            }
            vus.insert(cle);
            if bibliotheque.get(&r.tmdb_id).is_some_and(|b| b.1.as_deref() == Some("Watched")) {
                return false;
            }
            convient(&Candidat { film: r.type_ == "Movie", documentaire: r.documentaire, genres: r.genres.clone(), duree: None }, x)
        })
        .collect();
    let tete: Vec<Resultat> = premier_tri.into_iter().take(FICHES_CATALOGUE).collect();
    let fiches = decouverte::en_parallele(tete.iter().map(|r| (r.tmdb_id, r.type_)).collect(), PARALLELE, |(id, t)| decouverte::donnees_externes(id, t)).await;

    // Durée connue maintenant : on revérifie (FR-4).
    let mut correspondants: Vec<(Resultat, TitreModele, std::sync::Arc<tmdb::DonneesTitre>)> = vec![];
    for (r, f) in tete.into_iter().zip(fiches) {
        let Some(f) = f else { continue };
        let duree = f.caracteristiques["runtime"].as_f64();
        let genres_f: Vec<String> = f.caracteristiques["genres"].as_array().map(|a| a.iter().map(|g| preference::texte_js(Some(g))).collect()).unwrap_or_default();
        if !convient(&Candidat { film: r.type_ == "Movie", documentaire: r.documentaire, genres: genres_f, duree }, x) {
            continue;
        }
        let titre = preference::titre_de_caracteristiques(-(correspondants.len() as i64) - 1, &r.titre, &f.caracteristiques);
        correspondants.push((r, titre, f));
    }
    let avis = preference::poids_des_avis(tx).await?;
    let exposition = preference::lassitude(tx, js::maintenant_ms()).await?;
    let par_id: HashMap<i64, usize> = correspondants.iter().enumerate().map(|(i, c)| (c.1.id, i)).collect();
    // Un titre de ta pile est vu sous sa clé de bibliothèque, les autres sous leur clé TMDB.
    let cle_vue = |r: &Resultat| match bibliotheque.get(&r.tmdb_id) {
        Some((id, _)) if *id != 0 => preference::cle_item(*id),
        _ => preference::cle_tmdb_exposition(r.type_, r.tmdb_id),
    };
    let titres: Vec<TitreModele> = correspondants.iter().map(|c| c.1.clone()).collect();
    let classes = classes_et_lasses(&gout, &titres, &avis, |s| exposition.get(&cle_vue(&correspondants[par_id[&s.id]].0)).copied().unwrap_or(0.0));
    let propositions: Vec<Value> = classes
        .iter()
        .take(PROPOSITIONS_MAX)
        .map(|s| {
            let (r, _, f) = &correspondants[par_id[&s.id]];
            let dans = bibliotheque.get(&r.tmdb_id);
            json!({
                "key": cle_tmdb(r.type_, r.tmdb_id), "tmdbId": r.tmdb_id, "libraryId": dans.map(|d| d.0), "libraryStatus": dans.and_then(|d| d.1.clone()),
                "type": r.type_, "isDocumentary": r.documentaire, "title": r.titre, "year": r.annee, "posterUrl": tmdb::url_affiche(r.affiche.as_deref()),
                "overview": r.synopsis, "runtime": f.caracteristiques["runtime"], "genres": f.caracteristiques["genres"], "voteAverage": r.note_moyenne,
                "voteCount": r.votes, "compatibility": s.compatibilite, "reason": raison(s), "availability": f.disponibilite, "release": f.sortie,
                "trailer": f.bande_annonce["trailer"],
            })
        })
        .collect();
    Ok(json!({ "picks": propositions, "matched": correspondants.len(), "relax": null, "catalogUnavailable": false, "baseRate": preference::taux_de_base(&gout) }))
}

/// GET /api/tonight?mood=&format=&maxMinutes=&company=&where=&source=&playlistId=&genre=
pub async fn route(utilisateur: Utilisateur, Query(p): Query<HashMap<String, String>>) -> Result<Json<Value>, Erreur> {
    let contexte = lire_contexte(&p);
    let mut tx = bd::transaction(&utilisateur).await?;
    let couverts: Vec<i64> = reglages::services_couverts(&mut tx).await?.into_iter().collect();
    let corps = if contexte.source == "catalog" {
        depuis_le_catalogue(&mut tx, &utilisateur, &contexte, &couverts).await?
    } else {
        depuis_la_pile(&mut tx, &utilisateur, &contexte, &couverts).await?
    };
    tx.valider().await?;
    Ok(Json(corps))
}

#[cfg(test)]
mod tests {
    //! Tests de src/lib/tonight.test.ts (ce-soir-v2 AC-1 à AC-3, EC-1 ; playlists-v2 FR-8), mêmes cas.
    use super::*;

    fn film(genres: &[&str], duree: Option<f64>) -> Candidat {
        Candidat { film: true, documentaire: false, genres: genres.iter().map(|s| s.to_string()).collect(), duree }
    }
    fn ctx(f: impl FnOnce(&mut Contexte)) -> Contexte {
        let mut c = PAR_DEFAUT.clone();
        f(&mut c);
        c
    }
    fn params(p: &[(&str, &str)]) -> HashMap<String, String> {
        p.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect()
    }

    #[test]
    fn leger_garde_une_comedie_dramatique_pas_un_drame_ac1() {
        let leger = ctx(|c| c.envie = "light");
        assert!(!convient(&film(&["Drama"], Some(110.0)), &leger));
        assert!(convient(&film(&["Comedy", "Drama"], Some(110.0)), &leger));
    }

    #[test]
    fn en_famille_exclut_l_horreur_et_exige_un_genre_familial_ac2() {
        let famille = ctx(|c| c.compagnie = "family");
        assert!(!convient(&film(&["Animation", "Horror"], Some(110.0)), &famille));
        assert!(convient(&film(&["Animation", "Family"], Some(110.0)), &famille));
        assert!(!convient(&film(&["Thriller"], Some(110.0)), &famille));
    }

    #[test]
    fn la_duree_ne_vaut_que_pour_les_films_ac3() {
        let court = ctx(|c| c.minutes_max = Some(90.0));
        assert!(!convient(&film(&["Drama"], Some(130.0)), &court));
        assert!(convient(&Candidat { film: false, documentaire: false, genres: vec!["Drama".into()], duree: Some(50.0) }, &court));
        assert!(convient(&film(&["Drama"], None), &court));
    }

    #[test]
    fn un_documentaire_a_part_des_films_et_series() {
        let doc = Candidat { film: true, documentaire: true, genres: vec!["Documentary".into()], duree: Some(90.0) };
        assert!(!convient(&doc, &ctx(|c| c.format = "Movie")));
        assert!(convient(&doc, &ctx(|c| c.format = "Documentary")));
        assert!(convient(&doc, &ctx(|c| c.envie = "think")));
    }

    #[test]
    fn un_genre_precis_s_ajoute_a_l_envie() {
        let western = ctx(|c| c.genre = Some("Western".into()));
        assert!(convient(&film(&["Western", "Drama"], Some(110.0)), &western));
        assert!(!convient(&film(&["Drama"], Some(110.0)), &western));
        assert!(!convient(&film(&["Western"], Some(110.0)), &Contexte { envie: "light", ..western.clone() }));
        let doc = Candidat { film: true, documentaire: true, genres: vec![], duree: Some(90.0) };
        assert!(convient(&doc, &ctx(|c| c.genre = Some("Documentary".into()))));
    }

    #[test]
    fn designe_le_reglage_qui_rend_le_plus_ec1() {
        let candidats = vec![film(&["Drama"], Some(150.0)), film(&["Drama"], Some(140.0)), film(&["Comedy"], Some(150.0))];
        assert_eq!(plus_restrictif(&candidats, &ctx(|c| {
            c.envie = "light";
            c.minutes_max = Some(90.0)
        })), Some("maxMinutes"));
    }

    #[test]
    fn propose_de_retirer_le_genre() {
        let candidats = vec![film(&["Drama"], Some(110.0)), film(&["Comedy"], Some(110.0))];
        assert_eq!(plus_restrictif(&candidats, &ctx(|c| c.genre = Some("Western".into()))), Some("genre"));
    }

    #[test]
    fn ne_designe_rien_quand_rien_ne_filtre() {
        assert_eq!(plus_restrictif(&[film(&["Drama"], Some(110.0))], &PAR_DEFAUT), None);
    }

    #[test]
    fn garde_les_reglages_valides_et_remplace_les_autres() {
        let c = lire_contexte(&params(&[("mood", "intense"), ("format", "Série"), ("maxMinutes", "120"), ("source", "catalog")]));
        assert_eq!(c, Contexte { envie: "intense", minutes_max: Some(120.0), source: "catalog", ..PAR_DEFAUT.clone() });
    }

    #[test]
    fn lit_la_source_playlist_et_sa_playlist() {
        let c = lire_contexte(&params(&[("source", "playlist"), ("playlistId", "7")]));
        assert_eq!((c.source, c.playlist), ("playlist", Some(7)));
        let c = lire_contexte(&params(&[("source", "playlist")]));
        assert_eq!((c.source, c.playlist), ("pile", None));
        let c = lire_contexte(&params(&[("source", "pile"), ("playlistId", "7")]));
        assert_eq!((c.source, c.playlist), ("pile", None));
    }

    #[test]
    fn lit_un_genre_et_ignore_un_genre_vide() {
        assert_eq!(lire_contexte(&params(&[("genre", "Western")])).genre.as_deref(), Some("Western"));
        assert_eq!(lire_contexte(&params(&[("genre", "  ")])).genre, None);
        assert_eq!(lire_contexte(&params(&[])).genre, None);
    }
}
