//! Façonnage de la liste : portage exact de `src/lib/listShaping.ts` (recommendations-v1 v1.4, v1.5 ;
//! recommandations-fraicheur-v1) et de `diversify` (recommendationService.ts). Module pur : il réordonne
//! la sortie du modèle sans la recalculer.
use crate::flottants::log;
use std::collections::{HashMap, HashSet};

/// Ce que le façonnage lit d'un titre.
pub trait Faconnable {
    fn id(&self) -> i64;
    fn score(&self) -> f64;
    fn genres(&self) -> &[String];
}

/// Part de chaque genre, dans l'ordre d'insertion de la `Map` de la v1 (il fixe l'ordre des sommes).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Distribution {
    pub ordre: Vec<String>,
    pub parts: HashMap<String, f64>,
}

impl Distribution {
    pub fn get(&self, genre: &str) -> Option<f64> {
        self.parts.get(genre).copied()
    }
    pub fn est_vide(&self) -> bool {
        self.ordre.is_empty()
    }
    fn ajouter(&mut self, genre: &str, part: f64) {
        match self.parts.get_mut(genre) {
            Some(v) => *v += part,
            None => {
                self.ordre.push(genre.to_owned());
                self.parts.insert(genre.to_owned(), 0.0 + part);
            }
        }
    }
}

const ALPHA: f64 = 0.01;
pub const LAMBDA: f64 = 0.8;
pub const BLOC: usize = 12;
pub const FENETRE: usize = 48;
const TAILLE: usize = 48;

pub fn distribution_des_genres<'a>(titres: impl IntoIterator<Item = &'a [String]>) -> Distribution {
    let mut d = Distribution::default();
    let mut masse = 0.0;
    for genres in titres {
        if genres.is_empty() {
            continue;
        }
        let part = 1.0 / genres.len() as f64;
        for g in genres {
            d.ajouter(g, part);
        }
        masse += 1.0;
    }
    if masse == 0.0 {
        return d;
    }
    for g in &d.ordre {
        if let Some(v) = d.parts.get_mut(g) {
            *v /= masse;
        }
    }
    d
}

/// Écart de calibration de Steck : KL(p ‖ q̃), q̃ = (1 − α)·q + α·p.
pub fn ecart_de_calibration(cible: &Distribution, liste: &HashMap<String, f64>) -> f64 {
    let mut kl = 0.0;
    for g in &cible.ordre {
        let p = cible.parts[g];
        if p <= 0.0 {
            continue;
        }
        let q = (1.0 - ALPHA) * liste.get(g).copied().unwrap_or(0.0) + ALPHA * p;
        kl += p * log(p / q);
    }
    kl
}

fn compare_desc(a: f64, b: f64) -> std::cmp::Ordering {
    b.partial_cmp(&a).unwrap_or(std::cmp::Ordering::Equal)
}

/// FR-30 : ré-ordonnancement glouton de Steck, par groupes de `BLOC` rangés par pertinence.
pub fn calibrer<T: Faconnable + Clone>(classes: &[T], cible: &Distribution) -> Vec<T> {
    calibrer_avec(classes, cible, LAMBDA, TAILLE, BLOC, FENETRE)
}

pub fn calibrer_avec<T: Faconnable + Clone>(classes: &[T], cible: &Distribution, lambda: f64, taille: usize, bloc: usize, fenetre: usize) -> Vec<T> {
    if classes.is_empty() || cible.est_vide() {
        return classes.to_vec();
    }
    let scores: Vec<f64> = classes.iter().map(Faconnable::score).collect();
    let min = scores.iter().copied().fold(f64::INFINITY, f64::min);
    let max = scores.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    let etendue = if max - min == 0.0 { 1.0 } else { max - min };
    let mut pertinence: HashMap<i64, f64> = HashMap::new();
    for t in classes {
        pertinence.insert(t.id(), (t.score() - min) / etendue);
    }
    let mut restants: Vec<T> = classes.to_vec();
    let mut choisis: Vec<T> = vec![];
    let mut comptes: HashMap<String, f64> = HashMap::new();
    let mut listes = 0.0f64;
    let mut somme_pertinence = 0.0;
    let avec = |comptes: &HashMap<String, f64>, listes: f64, candidat: &T| -> HashMap<String, f64> {
        let mut d = comptes.clone();
        let mut total = listes;
        let genres = candidat.genres();
        if !genres.is_empty() {
            let part = 1.0 / genres.len() as f64;
            for g in genres {
                *d.entry(g.clone()).or_insert(0.0) += part;
            }
            total += 1.0;
        }
        if total > 0.0 {
            for v in d.values_mut() {
                *v /= total;
            }
        }
        d
    };
    while choisis.len() < taille.min(classes.len()) {
        let mut meilleur = 0;
        let mut objectif_max = f64::NEG_INFINITY;
        for (i, candidat) in restants.iter().take(fenetre).enumerate() {
            let objectif = (1.0 - lambda) * (somme_pertinence + pertinence.get(&candidat.id()).copied().unwrap_or(0.0))
                - lambda * ecart_de_calibration(cible, &avec(&comptes, listes, candidat));
            if objectif > objectif_max {
                objectif_max = objectif;
                meilleur = i;
            }
        }
        let choisi = restants.remove(meilleur);
        somme_pertinence += pertinence.get(&choisi.id()).copied().unwrap_or(0.0);
        let genres = choisi.genres();
        if !genres.is_empty() {
            let part = 1.0 / genres.len() as f64;
            for g in genres {
                *comptes.entry(g.clone()).or_insert(0.0) += part;
            }
            listes += 1.0;
        }
        choisis.push(choisi);
    }
    let mut ordonnes: Vec<T> = vec![];
    for groupe in choisis.chunks(bloc) {
        let mut g = groupe.to_vec();
        g.sort_by(|a, b| compare_desc(a.score(), b.score()));
        ordonnes.extend(g);
    }
    ordonnes.extend(restants);
    ordonnes
}

const EXPLORATION_PART_MAX: f64 = 0.05;
const EXPLORATION_NOTE_MIN: f64 = 7.0;
const EXPLORATION_VOTES_MIN: f64 = 500.0;

/// FR-31 : genre principal peu présent, reconnu (≥ 7, ≥ 500 votes), score au moins médian.
pub fn vivier_d_exploration<T: Faconnable + Clone>(candidats: &[T], cible: &Distribution, note: impl Fn(&T) -> (Option<f64>, Option<f64>)) -> Vec<T> {
    if candidats.is_empty() {
        return vec![];
    }
    let mut tries: Vec<f64> = candidats.iter().map(Faconnable::score).collect();
    tries.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let mediane = tries[tries.len() / 2];
    let mut vivier: Vec<T> = candidats
        .iter()
        .filter(|c| {
            let Some(principal) = c.genres().first().filter(|g| !g.is_empty()) else { return false };
            let (moyenne, votes) = note(c);
            cible.get(principal).unwrap_or(0.0) < EXPLORATION_PART_MAX
                && moyenne.unwrap_or(0.0) >= EXPLORATION_NOTE_MIN
                && votes.unwrap_or(0.0) >= EXPLORATION_VOTES_MIN
                && c.score() >= mediane
        })
        .cloned()
        .collect();
    vivier.sort_by(|a, b| compare_desc(a.score(), b.score()));
    vivier
}

/// FR-31 : un rang sur `tous` (6, 12, 18…) reçoit le titre d'exploration suivant, marqué comme tel.
pub fn intercaler_exploration<T: Clone>(principale: &[T], vivier: &[T], id: impl Fn(&T) -> i64, tous: usize) -> Vec<(T, bool)> {
    let ids: HashSet<i64> = vivier.iter().map(&id).collect();
    let reste: Vec<(T, bool)> = principale.iter().filter(|t| !ids.contains(&id(t))).map(|t| (t.clone(), false)).collect();
    let choix: Vec<(T, bool)> = vivier.iter().map(|t| (t.clone(), true)).collect();
    let mut resultat = vec![];
    let (mut i_reste, mut i_choix) = (0, 0);
    while resultat.len() < principale.len() && (i_reste < reste.len() || i_choix < choix.len()) {
        let position = resultat.len() + 1;
        if position % tous == 0 && i_choix < choix.len() {
            resultat.push(choix[i_choix].clone());
            i_choix += 1;
        } else if i_reste < reste.len() {
            resultat.push(reste[i_reste].clone());
            i_reste += 1;
        } else {
            resultat.push(choix[i_choix].clone());
            i_choix += 1;
        }
    }
    resultat
}

// ---------- lassitude ----------

pub const LASSITUDE_PAS: f64 = 3.0;
pub const LASSITUDE_RECUL_MAX: f64 = 12.0;

/// FR-5 : un titre recule de `pas` places par jour montré sans geste, au plus de `recul_max`.
pub fn appliquer_lassitude<T>(liste: Vec<T>, lassitude: impl Fn(&T) -> f64) -> Vec<T> {
    appliquer_lassitude_avec(liste, lassitude, LASSITUDE_PAS, LASSITUDE_RECUL_MAX)
}

pub fn appliquer_lassitude_avec<T>(liste: Vec<T>, lassitude: impl Fn(&T) -> f64, pas: f64, recul_max: f64) -> Vec<T> {
    if pas == 0.0 {
        return liste;
    }
    let mut places: Vec<(f64, f64, usize, T)> = liste
        .into_iter()
        .enumerate()
        .map(|(index, t)| {
            let l = lassitude(&t);
            (index as f64 + (pas * l).min(recul_max), l, index, t)
        })
        .collect();
    places.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal).then(a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal)).then(a.2.cmp(&b.2)));
    places.into_iter().map(|p| p.3).collect()
}

// ---------- diversité (recommendationService.ts, FR-12) ----------

pub const MAX_PAR_LOT: u32 = 2;

/// Au-delà de `max` titres d'un même lot, les suivants sont différés (jamais retirés) ; clé vide : jamais.
pub fn diversifier<T>(classes: Vec<T>, lot: impl Fn(&T) -> String, max: u32) -> Vec<T> {
    let (mut gardes, mut differes) = (vec![], vec![]);
    let mut vus: HashMap<String, u32> = HashMap::new();
    for t in classes {
        let cle = lot(&t);
        let n = vus.get(&cle).copied().unwrap_or(0);
        if !cle.is_empty() && n >= max {
            differes.push(t);
            continue;
        }
        vus.insert(cle, n + 1);
        gardes.push(t);
    }
    gardes.extend(differes);
    gardes
}

// ---------- rangées expliquées (FR-32) ----------

#[derive(Clone, Debug)]
pub struct Ancre {
    pub id: i64,
    pub nom: String,
    pub etoiles: i32,
}

#[derive(Clone, Debug)]
pub struct CandidatRangee {
    pub id: i64,
    pub score: f64,
    pub film: bool,
    pub duree: Option<f64>,
    /// Année (NaN possible, comme `Number("2013–2022")` dans la v1).
    pub annee: Option<f64>,
    pub votes: Option<f64>,
    pub sur_mes_abonnements: bool,
    pub ancre: Option<Ancre>,
    pub exploration: bool,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Rangee {
    pub cle: String,
    pub titre: String,
    pub ids: Vec<i64>,
    pub ancre: Option<String>,
}

const RANGEE: usize = 12;
const RANGEE_MIN: usize = 3;
const CE_SOIR_MAX_MINUTES: f64 = 120.0;
const PEPITE_VOTES_MAX: f64 = 1500.0;
const PEPITE_CENTILE: f64 = 0.7;
const RECENT_ANNEES: f64 = 2.0;

pub fn composer_rangees(liste: &[CandidatRangee], annee_courante: f64, abonnements: bool) -> Vec<Rangee> {
    let mut rangees = vec![];
    let mut pris: HashSet<i64> = HashSet::new();
    let meilleur: Vec<i64> = liste.iter().take(RANGEE).map(|c| c.id).collect();
    pris.extend(&meilleur);
    if meilleur.len() >= RANGEE_MIN {
        rangees.push(Rangee { cle: "best".into(), titre: "Le meilleur pour toi".into(), ids: meilleur, ancre: None });
    }
    let ajouter = |rangees: &mut Vec<Rangee>, pris: &mut HashSet<i64>, cle: String, titre: String, choix: &dyn Fn(&CandidatRangee) -> bool, ancre: Option<String>| {
        let ids: Vec<i64> = liste.iter().filter(|c| !pris.contains(&c.id) && choix(c)).take(RANGEE).map(|c| c.id).collect();
        if ids.len() < RANGEE_MIN {
            return;
        }
        pris.extend(&ids);
        rangees.push(Rangee { cle, titre, ids, ancre });
    };
    if abonnements {
        ajouter(&mut rangees, &mut pris, "services".into(), "Disponible sur tes abonnements".into(), &|c| c.sur_mes_abonnements, None);
    }
    // « Parce que tu as adoré X » : les titres aimés qui expliquent le plus de candidats restants.
    let mut ordre_ancres: Vec<i64> = vec![];
    let mut ancres: HashMap<i64, (String, i32, usize)> = HashMap::new();
    for c in liste {
        let Some(a) = c.ancre.as_ref().filter(|_| !pris.contains(&c.id)) else { continue };
        let e = ancres.entry(a.id).or_insert_with(|| {
            ordre_ancres.push(a.id);
            (a.nom.clone(), a.etoiles, 0)
        });
        e.2 += 1;
    }
    let mut retenues: Vec<(i64, (String, i32, usize))> = ordre_ancres.iter().map(|id| (*id, ancres[id].clone())).filter(|(_, a)| a.2 >= RANGEE_MIN).collect();
    retenues.sort_by(|a, b| b.1.2.cmp(&a.1.2).then(b.1.1.cmp(&a.1.1)));
    retenues.truncate(2);
    let parce_que = |rangees: &mut Vec<Rangee>, pris: &mut HashSet<i64>, (id, (nom, _, _)): &(i64, (String, i32, usize))| {
        let id = *id;
        ajouter(rangees, pris, format!("because-{id}"), format!("Parce que tu as adoré {nom}"), &move |c: &CandidatRangee| c.ancre.as_ref().is_some_and(|a| a.id == id), Some(nom.clone()));
    };
    if let Some(a) = retenues.first() {
        parce_que(&mut rangees, &mut pris, a);
    }
    ajouter(&mut rangees, &mut pris, "tonight".into(), "Pour ce soir, en moins de 2 h".into(), &|c| c.film && c.duree.is_some_and(|d| d <= CE_SOIR_MAX_MINUTES), None);
    let mut scores: Vec<f64> = liste.iter().map(|c| c.score).collect();
    scores.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let seuil = scores.get((scores.len() as f64 * PEPITE_CENTILE).floor() as usize).copied().unwrap_or(f64::INFINITY);
    ajouter(
        &mut rangees,
        &mut pris,
        "gems".into(),
        "Pépites peu connues".into(),
        &|c| {
            let v = c.votes.unwrap_or(0.0);
            v > 0.0 && v < PEPITE_VOTES_MAX && c.score >= seuil
        },
        None,
    );
    if let Some(a) = retenues.get(1) {
        parce_que(&mut rangees, &mut pris, a);
    }
    ajouter(&mut rangees, &mut pris, "recent".into(), "Sorties récentes".into(), &|c| c.annee.is_some_and(|a| a >= annee_courante - RECENT_ANNEES), None);
    ajouter(&mut rangees, &mut pris, "explore".into(), "Pour sortir de tes habitudes".into(), &|c| c.exploration, None);
    rangees
}

#[cfg(test)]
mod tests {
    //! Tests de src/lib/listShaping.test.ts (AC-21 à AC-23, fraîcheur AC-4, AC-5) et de `diversify`
    //! (recommendationService.test.ts, FR-12), mêmes cas, mêmes valeurs attendues.
    use super::*;

    #[derive(Clone, Debug, PartialEq)]
    struct T {
        id: i64,
        score: f64,
        genres: Vec<String>,
        moyenne: Option<f64>,
        votes: Option<f64>,
    }
    impl Faconnable for T {
        fn id(&self) -> i64 {
            self.id
        }
        fn score(&self) -> f64 {
            self.score
        }
        fn genres(&self) -> &[String] {
            &self.genres
        }
    }
    fn t(id: i64, score: f64, genres: &[&str]) -> T {
        T { id, score, genres: genres.iter().map(|g| g.to_string()).collect(), moyenne: None, votes: None }
    }
    fn dist(liste: &[&[&str]]) -> Distribution {
        let v: Vec<Vec<String>> = liste.iter().map(|g| g.iter().map(|s| s.to_string()).collect()).collect();
        distribution_des_genres(v.iter().map(|g| g.as_slice()))
    }
    fn comme_liste(d: &Distribution) -> HashMap<String, f64> {
        d.parts.clone()
    }

    #[test]
    fn calibration_nulle_quand_la_liste_reproduit_tes_proportions() {
        let h = dist(&[&["Drama"], &["Documentary"]]);
        assert!(ecart_de_calibration(&h, &comme_liste(&h)).abs() < 5e-6);
    }

    #[test]
    fn calibration_grandit_quand_un_interet_manque() {
        let h = dist(&[&["Drama"], &["Documentary"]]);
        assert!(ecart_de_calibration(&h, &comme_liste(&dist(&[&["Drama"]]))) > 0.5);
    }

    fn historique_70_30() -> Distribution {
        let mut v: Vec<&[&str]> = vec![&["Drama"]; 7];
        v.extend(vec![&["Documentary"] as &[&str]; 3]);
        dist(&v)
    }
    fn candidats_ac21() -> Vec<T> {
        let mut r: Vec<T> = (0..20).map(|i| t(i, 10.0 - i as f64 * 0.1, &["Drama"])).collect();
        r.extend((0..10).map(|i| t(100 + i, 9.0 - i as f64 * 0.1, &["Documentary"])));
        r
    }

    #[test]
    fn calibre_groupe_par_groupe_ac21() {
        let premier: Vec<T> = calibrer(&candidats_ac21(), &historique_70_30()).into_iter().take(BLOC).collect();
        let docs = premier.iter().filter(|x| x.genres[0] == "Documentary").count();
        assert!((3..=5).contains(&docs), "{docs}");
    }

    #[test]
    fn chaque_groupe_est_range_par_pertinence() {
        let premier: Vec<T> = calibrer(&candidats_ac21(), &historique_70_30()).into_iter().take(BLOC).collect();
        let scores: Vec<f64> = premier.iter().map(|x| x.score).collect();
        let mut tries = scores.clone();
        tries.sort_by(|a, b| b.partial_cmp(a).unwrap());
        assert_eq!(scores, tries);
        let mut avec = vec![t(999, 0.0, &["Drama", "Documentary"])];
        avec.extend(candidats_ac21());
        assert_ne!(calibrer(&avec, &historique_70_30())[0].id, 999);
    }

    #[test]
    fn sans_calibration_aucun_documentaire_en_tete() {
        assert!(candidats_ac21()[..10].iter().all(|x| x.genres[0] == "Drama"));
    }

    #[test]
    fn calibration_ne_perd_ni_ne_duplique() {
        let c = calibrer(&candidats_ac21(), &historique_70_30());
        assert_eq!(c.len(), 30);
        assert_eq!(c.iter().map(|x| x.id).collect::<HashSet<_>>().len(), 30);
    }

    #[test]
    fn vivier_d_exploration_retient_un_genre_peu_present() {
        let mut v: Vec<&[&str]> = vec![&["Drama"]; 30];
        v.push(&["Western"]);
        let h = dist(&v);
        let base = |mut x: T| {
            x.moyenne = Some(7.5);
            x.votes = Some(2000.0);
            x
        };
        let mut c3 = t(3, 1.0, &["Western"]);
        c3.moyenne = Some(5.0);
        c3.votes = Some(2000.0);
        let c = vec![base(t(1, 3.0, &["Western"])), base(t(2, 2.0, &["Drama"])), c3, base(t(4, -5.0, &["Western"]))];
        let ids: Vec<i64> = vivier_d_exploration(&c, &h, |x| (x.moyenne, x.votes)).iter().map(|x| x.id).collect();
        assert_eq!(ids, vec![1]);
    }

    #[test]
    fn exploration_aux_rangs_6_12_18_ac22() {
        let principale: Vec<i64> = (0..20).collect();
        let vivier = vec![100, 101, 102, 3];
        let r = intercaler_exploration(&principale, &vivier, |x| *x, 6);
        assert_eq!(r.len(), 20);
        assert_eq!(vec![r[5].0, r[11].0, r[17].0], vec![100, 101, 102]);
        assert!(r[5].1 && r[11].1 && r[17].1);
        assert_eq!(r.iter().map(|x| x.0).collect::<HashSet<_>>().len(), 20);
    }

    fn candidat(id: i64) -> CandidatRangee {
        CandidatRangee {
            id,
            score: 100.0 - id as f64,
            film: true,
            duree: Some(100.0),
            annee: Some(2010.0),
            votes: Some(5000.0),
            sur_mes_abonnements: false,
            ancre: None,
            exploration: false,
        }
    }

    #[test]
    fn rangees_sans_repetition_ac23() {
        let liste: Vec<CandidatRangee> = (0..60)
            .map(|i| CandidatRangee {
                sur_mes_abonnements: i % 2 == 0,
                ancre: (i % 3 == 0).then(|| Ancre { id: 999, nom: "Whiplash".into(), etoiles: 5 }),
                annee: Some(if i % 4 == 0 { 2026.0 } else { 2010.0 }),
                ..candidat(i)
            })
            .collect();
        let r = composer_rangees(&liste, 2026.0, true);
        let meilleur: HashSet<i64> = r[0].ids.iter().copied().collect();
        let mut vus = HashSet::new();
        assert_eq!(r[0].titre, "Le meilleur pour toi");
        for rangee in &r[1..] {
            for id in &rangee.ids {
                assert!(!meilleur.contains(id));
                assert!(vus.insert(*id));
            }
        }
        let titres: Vec<&str> = r.iter().map(|x| x.titre.as_str()).collect();
        assert!(titres.contains(&"Parce que tu as adoré Whiplash"));
        assert!(titres.contains(&"Disponible sur tes abonnements"));
    }

    #[test]
    fn pas_de_rangee_de_moins_de_trois() {
        let liste: Vec<CandidatRangee> = (0..14).map(|i| CandidatRangee { sur_mes_abonnements: true, ..candidat(i) }).collect();
        let r = composer_rangees(&liste, 2026.0, false);
        assert_eq!(r.iter().map(|x| x.cle.as_str()).collect::<Vec<_>>(), vec!["best"]);
    }

    // ---- lassitude ----

    fn lot() -> Vec<i64> {
        (1..=20).collect()
    }
    fn montre(jours: &[(i64, f64)]) -> impl Fn(&i64) -> f64 + '_ {
        move |id| jours.iter().find(|(i, _)| i == id).map(|(_, j)| *j).unwrap_or(0.0)
    }

    #[test]
    fn un_pas_de_0_rend_l_ordre_d_entree() {
        assert_eq!(appliquer_lassitude_avec(lot(), montre(&[(1, 9.0)]), 0.0, 12.0), lot());
    }

    #[test]
    fn sans_exposition_l_ordre_ne_bouge_pas() {
        assert_eq!(appliquer_lassitude(lot(), |_| 0.0), lot());
    }

    #[test]
    fn chaque_jour_fait_reculer_de_pas_places() {
        assert_eq!(appliquer_lassitude_avec(lot(), montre(&[(1, 1.0)]), 3.0, 12.0)[..5], [2, 3, 4, 1, 5]);
        assert_eq!(appliquer_lassitude_avec(lot(), montre(&[(1, 2.0)]), 3.0, 12.0)[..8], [2, 3, 4, 5, 6, 7, 1, 8]);
    }

    #[test]
    fn un_jour_ancien_fait_reculer_a_moitie() {
        assert_eq!(appliquer_lassitude_avec(lot(), montre(&[(1, 0.5)]), 4.0, 12.0)[..4], [2, 3, 1, 4]);
    }

    #[test]
    fn le_recul_est_plafonne_a_une_rangee() {
        let r = appliquer_lassitude_avec(lot(), montre(&[(1, 30.0)]), 3.0, 12.0);
        assert_eq!(r.iter().position(|x| *x == 1), Some(12));
    }

    #[test]
    fn a_place_egale_le_moins_montre_passe_devant() {
        assert_eq!(appliquer_lassitude_avec(lot(), montre(&[(1, 1.0)]), 3.0, 12.0)[2..4], [4, 1]);
        assert_eq!(appliquer_lassitude_avec(lot(), montre(&[(1, 1.0), (2, 1.0)]), 3.0, 12.0)[..6], [3, 4, 1, 5, 2, 6]);
    }

    #[test]
    fn tout_le_lot_autant_montre_ne_bouge_pas() {
        assert_eq!(appliquer_lassitude(lot(), |_| 3.0), lot());
    }

    #[test]
    fn rien_n_est_retire_ac5() {
        let mut r = appliquer_lassitude(lot(), montre(&[(1, 2.0), (4, 1.0)]));
        r.sort();
        assert_eq!(r, lot());
    }

    #[test]
    fn poids_d_un_jour_exact_comme_v8() {
        // `fatigueWeight` (fraicheur.rs) : 1 la veille, la moitié une semaine plus tard, bits de V8 entre les deux.
        assert_eq!(crate::fraicheur::poids_lassitude(1), 1.0);
        assert_eq!(crate::fraicheur::poids_lassitude(8), 0.5);
        assert_eq!(crate::fraicheur::poids_lassitude(12).to_bits(), 0x3fd588cea3f093be);
    }

    // ---- diversité ----

    #[test]
    fn diversite_repousse_au_dela_de_deux_par_lot() {
        let classes = vec![(1, "docs"), (2, "docs"), (3, "docs"), (4, "comédies")];
        let r: Vec<i64> = diversifier(classes, |x| x.1.to_owned(), MAX_PAR_LOT).iter().map(|x| x.0).collect();
        assert_eq!(r, vec![1, 2, 4, 3]);
    }

    #[test]
    fn diversite_ne_differe_jamais_un_titre_sans_lot() {
        let r: Vec<i64> = diversifier(vec![1, 2, 3], |_| String::new(), MAX_PAR_LOT);
        assert_eq!(r, vec![1, 2, 3]);
    }
}
