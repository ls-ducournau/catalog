//! Modèle de préférence : portage exact de `src/lib/preferenceModel.ts` (spec : specs/recommendations-v1.md,
//! amendements v1.3 et v1.5). Module pur, sans base ni réseau.
//!
//! Exactitude : mêmes opérations flottantes, dans le même ordre (sommes séquentielles, ordre d'insertion
//! des `Map` de JavaScript, tris stables), et les fonctions mathématiques de V8 (`crate::flottants`).
//! Les scores et les compatibilités sont donc identiques à la v1 bit à bit, pas seulement à une tolérance
//! près (vérifié sur les données de Louis).
use crate::flottants::{exp, log, log1p};
use std::collections::HashMap;

/// Ce que le modèle sait d'un titre (`ModelTitle`).
#[derive(Clone, Debug, Default)]
pub struct TitreModele {
    pub id: i64,
    pub nom: String,
    /// Ta note : 💩 = 0 … ⭐⭐⭐⭐⭐ = 5 ; `None` si pas notée.
    pub etoiles: Option<i32>,
    pub genres: Vec<String>,
    pub mots_cles: Vec<String>,
    pub distribution: Vec<String>,
    pub realisation: Vec<String>,
    pub production: Vec<String>,
    pub langue: Option<String>,
    pub annee: Option<f64>,
    pub duree: Option<f64>,
    pub note_moyenne: Option<f64>,
    pub votes: Option<f64>,
    /// Identifiants TMDB des personnes du titre (poids des avis) ; ignoré par le modèle.
    pub personnes: Vec<i64>,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Voisin {
    pub id: i64,
    pub nom: String,
    pub etoiles: i32,
    pub similarite: f64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct TitreNote {
    pub id: i64,
    pub score: f64,
    pub voisins: Vec<Voisin>,
}

/// Composantes brutes : qualité, voisins, régression.
pub type Composantes = [f64; 3];

#[derive(Clone, Copy, Default)]
pub struct Options {
    pub production: bool,
    pub votes_a_priori: f64,
}

/// Réglages du modèle en service (`MODEL_OPTIONS` de preferenceService.ts).
pub const OPTIONS_EN_SERVICE: Options = Options { production: true, votes_a_priori: 150.0 };

const KNN_VOISINS: usize = 25;
const KNN_RETRECISSEMENT: f64 = 1.0;
const RIDGE_MIN_TITRES: u32 = 12;
const RIDGE_L2: f64 = 8.0;
const RIDGE_EPOQUES: usize = 300;
const RIDGE_PAS: f64 = 0.01;
const EXPLICATION_MIN_ETOILES: i32 = 4;
const EXPLICATION_NOMBRE: usize = 3;
const EXPLICATION_MIN_SUBSTANCE: f64 = 0.5;
const EXPLICATION_MIN_SIMILARITE: f64 = 0.15;
const NOTE_PAR_DEFAUT: f64 = 6.5;
const DUREE_PAR_DEFAUT: f64 = 60.0;

pub const COMPATIBILITE_MIN_ETOILES: i32 = 4;
pub const COMPATIBILITE_MIN_TITRES: usize = 30;
const COMPATIBILITE_PLIS: usize = 5;
const LOGISTIQUE_L2: f64 = 1.0;
const LOGISTIQUE_EPOQUES: usize = 500;
const LOGISTIQUE_PAS: f64 = 0.5;
pub const ECHELLE_SCORE: f64 = 2.0;

// ---------- utilitaires (mêmes sommes que la v1) ----------

pub fn moyenne(valeurs: &[f64]) -> f64 {
    if valeurs.is_empty() {
        return 0.0;
    }
    let mut s = 0.0;
    for v in valeurs {
        s += v;
    }
    s / valeurs.len() as f64
}

pub fn ecart_type(valeurs: &[f64]) -> f64 {
    let m = moyenne(valeurs);
    let carres: Vec<f64> = valeurs.iter().map(|v| (v - m) * (v - m)).collect();
    moyenne(&carres).sqrt()
}

/// `|| 1` de JavaScript : 0 (ou NaN) devient 1.
fn ou_un(x: f64) -> f64 {
    if x == 0.0 || x.is_nan() { 1.0 } else { x }
}

fn centres_reduits(valeurs: &[f64]) -> Vec<f64> {
    let m = moyenne(valeurs);
    let s = ou_un(ecart_type(valeurs));
    valeurs.iter().map(|v| (v - m) / s).collect()
}

/// Nombre JavaScript en texte, pour un entier (décennie).
fn texte_nombre(x: f64) -> String {
    if x.fract() == 0.0 && x.abs() < 1e21 { format!("{}", x as i64) } else { format!("{x}") }
}

/// Jetons de contenu, préfixés par famille, dans l'ordre de la v1 (doublons compris).
fn jetons(t: &TitreModele, o: &Options) -> Vec<String> {
    let mut v: Vec<String> = Vec::new();
    v.extend(t.genres.iter().map(|g| format!("genre:{g}")));
    v.extend(t.mots_cles.iter().map(|k| format!("motcle:{k}")));
    v.extend(t.distribution.iter().map(|c| format!("acteur:{c}")));
    v.extend(t.realisation.iter().map(|d| format!("real:{d}")));
    if o.production {
        v.extend(t.production.iter().map(|p| format!("prod:{p}")));
    }
    if let Some(l) = t.langue.as_deref().filter(|l| !l.is_empty()) {
        v.push(format!("langue:{l}"));
    }
    if let Some(a) = t.annee.filter(|a| *a != 0.0 && !a.is_nan()) {
        v.push(format!("decennie:{}", texte_nombre((a / 10.0).floor() * 10.0)));
    }
    v
}

/// `new Set(jetons)` : sans doublon, ordre de première apparition.
fn jetons_uniques(t: &TitreModele, o: &Options) -> Vec<String> {
    let mut vus = std::collections::HashSet::new();
    jetons(t, o).into_iter().filter(|j| vus.insert(j.clone())).collect()
}

fn substantiel(j: &str) -> bool {
    j.starts_with("motcle:") || j.starts_with("acteur:") || j.starts_with("real:") || j.starts_with("prod:")
}

fn numeriques(t: &TitreModele) -> [f64; 3] {
    [t.note_moyenne.unwrap_or(NOTE_PAR_DEFAUT), log1p(t.votes.unwrap_or(0.0)), t.duree.unwrap_or(DUREE_PAR_DEFAUT)]
}

/// Une `Map` de JavaScript réduite à ce qu'il faut : ordre d'insertion et compteur.
#[derive(Default)]
struct Compteur {
    ordre: Vec<String>,
    nombre: HashMap<String, u32>,
}

impl Compteur {
    fn compter(titres: &[TitreModele], o: &Options) -> Self {
        let mut c = Compteur::default();
        for t in titres {
            for j in jetons_uniques(t, o) {
                match c.nombre.get_mut(&j) {
                    Some(n) => *n += 1,
                    None => {
                        c.ordre.push(j.clone());
                        c.nombre.insert(j, 1);
                    }
                }
            }
        }
        c
    }
}

// ---------- composante 1 : voisins de contenu ----------

/// Vecteur creux : (identifiant de jeton, poids) dans l'ordre d'insertion, et une table pour chercher.
struct Vecteur {
    ordre: Vec<(u32, f64)>,
    trie: Vec<(u32, f64)>,
}

impl Vecteur {
    fn poids(&self, j: u32) -> Option<f64> {
        self.trie.binary_search_by_key(&j, |e| e.0).ok().map(|i| self.trie[i].1)
    }
}

struct IndexVoisins {
    /// Identifiant d'un jeton présent dans au moins deux titres notés, et son idf.
    jetons: HashMap<String, (u32, f64)>,
    substance: Vec<bool>,
    notes: Vec<(TitreModele, Vecteur)>,
    moyenne_etoiles: f64,
    options: Options,
}

impl IndexVoisins {
    fn construire(notes: &[TitreModele], o: Options) -> Self {
        let df = Compteur::compter(notes, &o);
        let total = notes.len() as f64;
        let mut jetons = HashMap::new();
        let mut substance = vec![];
        for j in &df.ordre {
            let n = df.nombre[j];
            if n >= 2 {
                let id = substance.len() as u32;
                substance.push(substantiel(j));
                jetons.insert(j.clone(), (id, log(total / f64::from(n))));
            }
        }
        let mut index = IndexVoisins { jetons, substance, notes: vec![], moyenne_etoiles: 0.0, options: o };
        let vecteurs: Vec<(TitreModele, Vecteur)> = notes.iter().map(|t| (t.clone(), index.vectoriser(t))).collect();
        index.notes = vecteurs;
        let etoiles: Vec<f64> = notes.iter().map(|t| f64::from(t.etoiles.unwrap_or(0))).collect();
        index.moyenne_etoiles = moyenne(&etoiles);
        index
    }

    fn vectoriser(&self, t: &TitreModele) -> Vecteur {
        let mut ordre: Vec<(u32, f64)> = jetons_uniques(t, &self.options).iter().filter_map(|j| self.jetons.get(j).copied()).collect();
        let mut norme = 0.0;
        for (_, p) in &ordre {
            norme += p * p;
        }
        let norme = ou_un(norme.sqrt());
        for e in &mut ordre {
            e.1 /= norme;
        }
        let mut trie = ordre.clone();
        trie.sort_by_key(|e| e.0);
        Vecteur { ordre, trie }
    }

    fn estimer(&self, t: &TitreModele) -> (f64, Vec<Voisin>) {
        let v = self.vectoriser(t);
        struct Sim<'a> {
            titre: &'a TitreModele,
            sim: f64,
            substance: f64,
        }
        let mut sims: Vec<Sim> = vec![];
        for (candidat, cv) in &self.notes {
            if candidat.id == t.id {
                continue;
            }
            let (mut dot, mut substance) = (0.0, 0.0);
            for (j, p) in &v.ordre {
                let Some(autre) = cv.poids(*j) else { continue };
                dot += p * autre;
                if self.substance[*j as usize] {
                    substance += p * autre;
                }
            }
            if dot > 0.0 {
                sims.push(Sim { titre: candidat, sim: dot, substance });
            }
        }
        sims.sort_by(|a, b| b.sim.partial_cmp(&a.sim).unwrap_or(std::cmp::Ordering::Equal));
        sims.truncate(KNN_VOISINS);
        let mut somme_poids = 0.0;
        for s in &sims {
            somme_poids += s.sim;
        }
        let estimation = if somme_poids == 0.0 {
            self.moyenne_etoiles
        } else {
            let mut num = 0.0;
            for s in &sims {
                num += s.sim * f64::from(s.titre.etoiles.unwrap_or(0));
            }
            (num + KNN_RETRECISSEMENT * self.moyenne_etoiles) / (somme_poids + KNN_RETRECISSEMENT)
        };
        let voisins = sims
            .iter()
            .filter(|s| s.titre.etoiles.unwrap_or(0) >= EXPLICATION_MIN_ETOILES && s.sim >= EXPLICATION_MIN_SIMILARITE && s.substance >= EXPLICATION_MIN_SUBSTANCE * s.sim)
            .take(EXPLICATION_NOMBRE)
            .map(|s| Voisin { id: s.titre.id, nom: s.titre.nom.clone(), etoiles: s.titre.etoiles.unwrap_or(0), similarite: s.sim })
            .collect();
        (estimation, voisins)
    }
}

// ---------- composante 2 : régression ridge ----------

struct Ridge {
    index: HashMap<String, usize>,
    vocabulaire: usize,
    moyennes: [f64; 3],
    ecarts: [f64; 3],
    poids: Vec<f64>,
    moyenne_cible: f64,
    options: Options,
}

impl Ridge {
    fn encoder(&self, t: &TitreModele) -> Vec<f64> {
        let mut x = vec![0.0; self.vocabulaire + 3];
        for j in jetons(t, &self.options) {
            if let Some(i) = self.index.get(&j) {
                x[*i] = 1.0;
            }
        }
        for (j, v) in numeriques(t).iter().enumerate() {
            x[self.vocabulaire + j] = (v - self.moyennes[j]) / self.ecarts[j];
        }
        x
    }

    fn entrainer(notes: &[TitreModele], o: Options) -> Self {
        let comptes = Compteur::compter(notes, &o);
        let vocab: Vec<&String> = comptes.ordre.iter().filter(|j| comptes.nombre[*j] >= RIDGE_MIN_TITRES).collect();
        let index: HashMap<String, usize> = vocab.iter().enumerate().map(|(i, j)| ((*j).clone(), i)).collect();
        let nums: Vec<[f64; 3]> = notes.iter().map(numeriques).collect();
        let colonne = |j: usize| -> Vec<f64> { nums.iter().map(|n| n[j]).collect() };
        let moyennes = [moyenne(&colonne(0)), moyenne(&colonne(1)), moyenne(&colonne(2))];
        let ecarts = [ou_un(ecart_type(&colonne(0))), ou_un(ecart_type(&colonne(1))), ou_un(ecart_type(&colonne(2)))];
        let dimension = vocab.len() + 3;
        let etoiles: Vec<f64> = notes.iter().map(|t| f64::from(t.etoiles.unwrap_or(0))).collect();
        let mut r = Ridge { index, vocabulaire: vocab.len(), moyennes, ecarts, poids: vec![0.0; dimension], moyenne_cible: moyenne(&etoiles), options: o };
        let encodes: Vec<Vec<f64>> = notes.iter().map(|t| r.encoder(t)).collect();
        let decroissance = RIDGE_L2 / notes.len() as f64;
        let poids = &mut r.poids;
        for _ in 0..RIDGE_EPOQUES {
            for (n, x) in encodes.iter().enumerate() {
                let mut prediction = 0.0;
                for d in 0..dimension {
                    prediction += poids[d] * x[d];
                }
                let erreur = etoiles[n] - r.moyenne_cible - prediction;
                for d in 0..dimension {
                    poids[d] += RIDGE_PAS * (erreur * x[d] - decroissance * poids[d]);
                }
            }
        }
        r
    }

    fn predire(&self, t: &TitreModele) -> f64 {
        let x = self.encoder(t);
        let mut p = self.moyenne_cible;
        for (w, xi) in self.poids.iter().zip(&x) {
            p += w * xi;
        }
        p
    }
}

// ---------- composante 3 : qualité reconnue ----------

struct Qualite {
    a_priori: f64,
    votes_a_priori: f64,
}

impl Qualite {
    fn nouvelle(notes: &[TitreModele], votes_a_priori: f64) -> Self {
        let connues: Vec<f64> = notes.iter().filter_map(|t| t.note_moyenne).filter(|v| *v > 0.0).collect();
        Qualite { a_priori: if connues.is_empty() { NOTE_PAR_DEFAUT } else { moyenne(&connues) }, votes_a_priori }
    }

    fn de(&self, t: &TitreModele) -> f64 {
        let votes = t.votes.unwrap_or(0.0);
        let moyenne = t.note_moyenne.unwrap_or(self.a_priori);
        if self.votes_a_priori <= 0.0 {
            return t.note_moyenne.unwrap_or(NOTE_PAR_DEFAUT);
        }
        (moyenne * votes + self.a_priori * self.votes_a_priori) / (votes + self.votes_a_priori)
    }
}

// ---------- assemblage ----------

pub struct Modele {
    pub entraine_sur: usize,
    interieur: Option<(IndexVoisins, Ridge, Qualite)>,
}

impl Modele {
    /// `trainPreferenceModel` : déterministe, mêmes notes, mêmes scores.
    pub fn entrainer(titres: &[TitreModele], o: Options) -> Self {
        let notes: Vec<TitreModele> = titres.iter().filter(|t| t.etoiles.is_some()).cloned().collect();
        if notes.is_empty() {
            return Modele { entraine_sur: 0, interieur: None };
        }
        let voisins = IndexVoisins::construire(&notes, o);
        let ridge = Ridge::entrainer(&notes, o);
        let qualite = Qualite::nouvelle(&notes, o.votes_a_priori);
        Modele { entraine_sur: notes.len(), interieur: Some((voisins, ridge, qualite)) }
    }

    /// `components` : les trois avis bruts, indépendants du lot.
    pub fn composantes(&self, t: &TitreModele) -> Composantes {
        match &self.interieur {
            None => [t.note_moyenne.unwrap_or(NOTE_PAR_DEFAUT), 0.0, 0.0],
            Some((v, r, q)) => [q.de(t), v.estimer(t).0, r.predire(t)],
        }
    }

    /// `scoreBatch` : mélange des trois composantes centrées-réduites sur le lot.
    pub fn noter_lot(&self, lot: &[TitreModele]) -> Vec<TitreNote> {
        match &self.interieur {
            None => {
                let notes: Vec<f64> = lot.iter().map(|t| t.note_moyenne.unwrap_or(NOTE_PAR_DEFAUT)).collect();
                centres_reduits(&notes).into_iter().zip(lot).map(|(score, t)| TitreNote { id: t.id, score, voisins: vec![] }).collect()
            }
            Some((v, r, q)) => {
                if lot.is_empty() {
                    return vec![];
                }
                let qualite: Vec<f64> = lot.iter().map(|t| q.de(t)).collect();
                let knn: Vec<(f64, Vec<Voisin>)> = lot.iter().map(|t| v.estimer(t)).collect();
                let ridge: Vec<f64> = lot.iter().map(|t| r.predire(t)).collect();
                let zq = centres_reduits(&qualite);
                let zk = centres_reduits(&knn.iter().map(|k| k.0).collect::<Vec<_>>());
                let zr = centres_reduits(&ridge);
                lot.iter().zip(knn).enumerate().map(|(i, (t, k))| TitreNote { id: t.id, score: zq[i] + zk[i] + zr[i], voisins: k.1 }).collect()
            }
        }
    }
}

// ---------- compatibilité ----------

fn sigmoide(z: f64) -> f64 {
    1.0 / (1.0 + exp(-z))
}

#[derive(Clone, Debug)]
pub struct Compatibilite {
    moyennes: [f64; 3],
    ecarts: [f64; 3],
    biais: f64,
    poids: [f64; 3],
    moyenne_logits: f64,
    ecart_logits: f64,
    pub taux_de_base: f64,
}

impl Compatibilite {
    fn reduire(&self, x: &Composantes) -> [f64; 3] {
        [(x[0] - self.moyennes[0]) / self.ecarts[0], (x[1] - self.moyennes[1]) / self.ecarts[1], (x[2] - self.moyennes[2]) / self.ecarts[2]]
    }

    fn logit(&self, c: &Composantes) -> f64 {
        let r = self.reduire(c);
        let mut s = 0.0;
        for (rj, pj) in r.iter().zip(&self.poids) {
            s += rj * pj;
        }
        self.biais + s
    }

    /// Probabilité de noter ⭐⭐⭐⭐ ou plus ; `bonus` (unités du score) y reporte les avis sur les personnes.
    pub fn probabilite(&self, c: &Composantes, bonus: f64) -> f64 {
        sigmoide(self.logit(c) + (bonus * self.ecart_logits) / ECHELLE_SCORE)
    }

    pub fn score(&self, c: &Composantes) -> f64 {
        ((self.logit(c) - self.moyenne_logits) / self.ecart_logits) * ECHELLE_SCORE
    }

    fn caler(lignes: &[(Composantes, f64)]) -> Self {
        let col = |j: usize| -> Vec<f64> { lignes.iter().map(|l| l.0[j]).collect() };
        let moyennes = [moyenne(&col(0)), moyenne(&col(1)), moyenne(&col(2))];
        let ecarts = [ou_un(ecart_type(&col(0))), ou_un(ecart_type(&col(1))), ou_un(ecart_type(&col(2)))];
        let mut c = Compatibilite { moyennes, ecarts, biais: 0.0, poids: [0.0; 3], moyenne_logits: 0.0, ecart_logits: 1.0, taux_de_base: 0.0 };
        let encodes: Vec<([f64; 3], f64)> = lignes.iter().map(|l| (c.reduire(&l.0), l.1)).collect();
        let taux = moyenne(&lignes.iter().map(|l| l.1).collect::<Vec<_>>());
        let borne = 0.99f64.min(0.01f64.max(taux));
        let mut biais = log(borne / (1.0 - borne));
        let mut poids = [0.0f64; 3];
        let n = encodes.len() as f64;
        for _ in 0..LOGISTIQUE_EPOQUES {
            let mut grad_biais = 0.0;
            let mut grad = [0.0f64; 3];
            for (x, y) in &encodes {
                let mut s = 0.0;
                for j in 0..3 {
                    s += x[j] * poids[j];
                }
                let erreur = sigmoide(biais + s) - y;
                grad_biais += erreur;
                for j in 0..3 {
                    grad[j] += erreur * x[j];
                }
            }
            biais -= (LOGISTIQUE_PAS * grad_biais) / n;
            for j in 0..3 {
                poids[j] -= (LOGISTIQUE_PAS * (grad[j] + LOGISTIQUE_L2 * poids[j])) / n;
            }
        }
        c.biais = biais;
        c.poids = poids;
        c.taux_de_base = taux;
        let logits: Vec<f64> = lignes.iter().map(|l| c.logit(&l.0)).collect();
        c.moyenne_logits = moyenne(&logits);
        c.ecart_logits = ou_un(ecart_type(&logits));
        c
    }

    /// `trainCompatibility` : validation croisée à 5 plis (par ordre d'identifiant), puis régression logistique.
    /// `None` sous 30 titres notés.
    pub fn entrainer(titres: &[TitreModele], o: Options) -> Option<Self> {
        let mut notes: Vec<TitreModele> = titres.iter().filter(|t| t.etoiles.is_some()).cloned().collect();
        notes.sort_by_key(|t| t.id); // tri stable
        if notes.len() < COMPATIBILITE_MIN_TITRES {
            return None;
        }
        let mut lignes = vec![];
        for pli in 0..COMPATIBILITE_PLIS {
            let gardes: Vec<&TitreModele> = notes.iter().enumerate().filter(|(i, _)| i % COMPATIBILITE_PLIS == pli).map(|(_, t)| t).collect();
            let entrainement: Vec<TitreModele> = notes.iter().enumerate().filter(|(i, _)| i % COMPATIBILITE_PLIS != pli).map(|(_, t)| t.clone()).collect();
            let modele = Modele::entrainer(&entrainement, o);
            for t in gardes {
                let sans_note = TitreModele { etoiles: None, ..t.clone() };
                lignes.push((modele.composantes(&sans_note), if t.etoiles.unwrap_or(0) >= COMPATIBILITE_MIN_ETOILES { 1.0 } else { 0.0 }));
            }
        }
        Some(Compatibilite::caler(&lignes))
    }
}

/// Corrélation de rang de Spearman (le banc ; ici, pour les tests).
pub fn spearman(xs: &[f64], ys: &[f64]) -> f64 {
    let rang = |valeurs: &[f64]| -> Vec<f64> {
        let mut tries: Vec<(f64, usize)> = valeurs.iter().copied().zip(0..).collect();
        tries.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        let mut rangs = vec![0.0; valeurs.len()];
        let mut i = 0;
        while i < tries.len() {
            let mut j = i;
            while j + 1 < tries.len() && tries[j + 1].0 == tries[i].0 {
                j += 1;
            }
            for k in i..=j {
                rangs[tries[k].1] = (i + j) as f64 / 2.0;
            }
            i = j + 1;
        }
        rangs
    };
    let (rx, ry) = (rang(xs), rang(ys));
    let (mx, my) = (moyenne(&rx), moyenne(&ry));
    let (mut cov, mut vx, mut vy) = (0.0, 0.0, 0.0);
    for i in 0..xs.len() {
        cov += (rx[i] - mx) * (ry[i] - my);
        vx += (rx[i] - mx) * (rx[i] - mx);
        vy += (ry[i] - my) * (ry[i] - my);
    }
    if vx == 0.0 || vy == 0.0 { 0.0 } else { cov / (vx * vy).sqrt() }
}

/// Générateur pseudo-aléatoire à graine des tests de la v1 (mulberry32), aussi utilisé pour comparer la
/// découverte de la v1 et de la v2 à semences égales.
pub fn mulberry32(graine: i32) -> impl FnMut() -> f64 {
    let mut a = graine;
    move || {
        a = a.wrapping_add(0x6d2b79f5_u32 as i32);
        let mut t = (a ^ ((a as u32) >> 15) as i32).wrapping_mul(1 | a);
        t = (t.wrapping_add((t ^ ((t as u32) >> 7) as i32).wrapping_mul(61 | t))) ^ t;
        ((t ^ ((t as u32) >> 14) as i32) as u32) as f64 / 4294967296.0
    }
}

#[cfg(test)]
mod tests {
    //! Tests de src/lib/preferenceModel.test.ts, mêmes cas, mêmes valeurs (AC-17, AC-18, FR-34, FR-35).
    use super::*;

    const MOTS_CLES: [&str; 16] = [
        "espace", "enquête", "zombie", "musique", "braquage", "romance", "guerre", "famille", "politique", "sport", "voyage", "vengeance", "amitié", "trahison",
        "futur", "passé",
    ];
    const GENRES: [&str; 6] = ["Drama", "Comedy", "Thriller", "Science Fiction", "Documentary", "Action"];

    fn gout(k: &str) -> f64 {
        match k {
            "espace" => 1.6,
            "enquête" => 1.2,
            "zombie" => -1.6,
            "musique" => -1.2,
            _ => 0.0,
        }
    }

    /// `Math.round` de JavaScript (moitiés vers +∞).
    fn arrondi_js(x: f64) -> f64 {
        (x + 0.5).floor()
    }

    fn bibliotheque(nombre: usize, graine: i32) -> Vec<TitreModele> {
        let mut hasard = mulberry32(graine);
        let distribution: Vec<String> = (0..30).map(|i| format!("Acteur {i}")).collect();
        let tirer = |pool: &[String], n: usize, h: &mut dyn FnMut() -> f64| -> Vec<String> {
            let mut copie = pool.to_vec();
            let mut sortie = vec![];
            while sortie.len() < n {
                let i = (h() * copie.len() as f64).floor() as usize;
                sortie.push(copie.remove(i));
            }
            sortie
        };
        let mots: Vec<String> = MOTS_CLES.iter().map(|s| s.to_string()).collect();
        let genres: Vec<String> = GENRES.iter().map(|s| s.to_string()).collect();
        (0..nombre)
            .map(|id| {
                let n = 2 + (hasard() * 3.0).floor() as usize;
                let mots_cles = tirer(&mots, n, &mut hasard);
                let note_moyenne = 5.0 + hasard() * 3.0;
                let mut g = 0.0;
                for k in &mots_cles {
                    g += gout(k);
                }
                let brut = 2.5 + g + 0.3 * (note_moyenne - 6.5) + (hasard() - 0.5) * 1.2;
                let etoiles = 0f64.max(5f64.min(arrondi_js(brut))) as i32;
                let ng = 1 + (hasard() * 2.0).floor() as usize;
                let genres_t = tirer(&genres, ng, &mut hasard);
                let dist = tirer(&distribution, 3, &mut hasard);
                let langue = if hasard() < 0.7 { "en" } else { "fr" };
                let annee = 1980.0 + (hasard() * 45.0).floor();
                let duree = 90.0 + (hasard() * 60.0).floor();
                let votes = (100.0 + hasard() * 20000.0).floor();
                TitreModele {
                    id: id as i64,
                    nom: format!("Titre {id}"),
                    etoiles: Some(etoiles),
                    genres: genres_t,
                    mots_cles,
                    distribution: dist,
                    langue: Some(langue.into()),
                    annee: Some(annee),
                    duree: Some(duree),
                    note_moyenne: Some(note_moyenne),
                    votes: Some(votes),
                    ..Default::default()
                }
            })
            .collect()
    }

    fn sans_note(t: &[TitreModele]) -> Vec<TitreModele> {
        t.iter().map(|t| TitreModele { etoiles: None, ..t.clone() }).collect()
    }

    fn jeu(graine: i32, coupe: usize) -> (Vec<TitreModele>, Vec<TitreModele>, Vec<f64>) {
        let b = bibliotheque(300, graine);
        let verite = b[coupe..].iter().map(|t| f64::from(t.etoiles.unwrap())).collect();
        (b[..coupe].to_vec(), sans_note(&b[coupe..]), verite)
    }

    #[test]
    fn retrouve_un_gout_connu_mieux_que_tmdb_ac17() {
        let (train, test, verite) = jeu(42, 240);
        let m = Modele::entrainer(&train, Options::default());
        let scores: Vec<f64> = m.noter_lot(&test).iter().map(|s| s.score).collect();
        let cm = spearman(&scores, &verite);
        let ct = spearman(&test.iter().map(|t| t.note_moyenne.unwrap()).collect::<Vec<_>>(), &verite);
        assert_eq!(m.entraine_sur, 240);
        assert!(cm > ct, "{cm} > {ct}");
        assert!(cm > 0.4, "{cm}");
    }

    #[test]
    fn n_explique_que_par_des_titres_notes_4_ac18() {
        let (train, test, _) = jeu(42, 240);
        let voisins: Vec<Voisin> = Modele::entrainer(&train, Options::default()).noter_lot(&test).into_iter().flat_map(|s| s.voisins).collect();
        assert!(!voisins.is_empty());
        assert!(voisins.iter().all(|v| v.etoiles >= 4));
    }

    #[test]
    fn deterministe() {
        let (train, test, _) = jeu(42, 240);
        assert_eq!(Modele::entrainer(&train, Options::default()).noter_lot(&test), Modele::entrainer(&train, Options::default()).noter_lot(&test));
    }

    #[test]
    fn pas_son_propre_voisin() {
        let (train, _, _) = jeu(42, 240);
        let s = Modele::entrainer(&train, Options::default()).noter_lot(&train[..1]);
        assert!(!s[0].voisins.iter().any(|v| v.id == train[0].id));
    }

    #[test]
    fn qualite_seule_sans_note() {
        let b = bibliotheque(300, 42);
        let lot = sans_note(&b[..3]);
        let notes = Modele::entrainer(&lot, Options::default()).noter_lot(&lot);
        let mut par_score = notes.clone();
        par_score.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap());
        let mut par_qualite = lot.clone();
        par_qualite.sort_by(|a, b| b.note_moyenne.partial_cmp(&a.note_moyenne).unwrap());
        assert_eq!(par_score.iter().map(|s| s.id).collect::<Vec<_>>(), par_qualite.iter().map(|t| t.id).collect::<Vec<_>>());
    }

    #[test]
    fn titre_sans_caracteristique() {
        let (train, test, _) = jeu(42, 240);
        let nu = TitreModele { id: 9999, nom: "Inconnu".into(), ..Default::default() };
        let s = Modele::entrainer(&train, Options::default()).noter_lot(&[nu, test[0].clone()]);
        assert!(s[0].score.is_finite());
        assert!(s[0].voisins.is_empty());
    }

    #[test]
    fn compatibilite_attend_assez_de_notes() {
        let b = bibliotheque(300, 7);
        assert!(Compatibilite::entrainer(&b[..COMPATIBILITE_MIN_TITRES - 1], Options::default()).is_none());
    }

    #[test]
    fn probabilite_entre_0_et_1_plus_haute_pour_ce_qu_on_aime() {
        let (train, test, verite) = jeu(7, 220);
        let c = Compatibilite::entrainer(&train, Options::default()).unwrap();
        let m = Modele::entrainer(&train, Options::default());
        let p: Vec<f64> = test.iter().map(|t| c.probabilite(&m.composantes(t), 0.0)).collect();
        assert!(p.iter().all(|x| *x > 0.0 && *x < 1.0));
        let aimes: Vec<f64> = p.iter().zip(&verite).filter(|(_, v)| **v >= 4.0).map(|(x, _)| *x).collect();
        let pas: Vec<f64> = p.iter().zip(&verite).filter(|(_, v)| **v <= 1.0).map(|(x, _)| *x).collect();
        assert!(moyenne(&aimes) > moyenne(&pas) + 0.2);
    }

    #[test]
    fn classe_comme_la_probabilite_et_un_bonus_la_fait_monter_fr35() {
        let (train, test, _) = jeu(7, 220);
        let c = Compatibilite::entrainer(&train, Options::default()).unwrap();
        let m = Modele::entrainer(&train, Options::default());
        let comps: Vec<Composantes> = test.iter().map(|t| m.composantes(t)).collect();
        let mut par_score = comps.clone();
        par_score.sort_by(|a, b| c.score(b).partial_cmp(&c.score(a)).unwrap());
        let p: Vec<f64> = par_score.iter().map(|x| c.probabilite(x, 0.0)).collect();
        for i in 1..p.len() {
            assert!(p[i] <= p[i - 1]);
        }
        assert!(c.probabilite(&comps[0], 0.6) > c.probabilite(&comps[0], 0.0));
    }

    #[test]
    fn ne_depend_pas_du_lot() {
        let (train, test, _) = jeu(7, 220);
        let c = Compatibilite::entrainer(&train, Options::default()).unwrap();
        let m = Modele::entrainer(&train, Options::default());
        let seul = c.score(&m.composantes(&test[0]));
        let lot: Vec<f64> = test.iter().map(|t| c.score(&m.composantes(t))).collect();
        assert_eq!(lot[0].to_bits(), seul.to_bits());
    }

    #[test]
    fn spearman_vaut_1_et_moins_1() {
        // toBeCloseTo(x) de vitest : |écart| < 0,005.
        assert!((spearman(&[1.0, 2.0, 3.0, 4.0], &[10.0, 20.0, 30.0, 40.0]) - 1.0).abs() < 0.005);
        assert!((spearman(&[1.0, 2.0, 3.0, 4.0], &[40.0, 30.0, 20.0, 10.0]) + 1.0).abs() < 0.005);
    }

    /// Égalité BIT À BIT avec la v1 : scores, composantes, probabilités et scores de classement calculés par
    /// src/lib/preferenceModel.ts lui-même (Node), avec et sans les réglages en service.
    #[test]
    fn identique_a_la_v1_bit_a_bit() {
        let texte = include_str!("donnees_tests/modele_v1.txt");
        let mut sections: Vec<(String, HashMap<String, Vec<u64>>)> = vec![];
        for ligne in texte.lines() {
            if let Some(nom) = ligne.strip_prefix("// ") {
                sections.push((nom.to_owned(), HashMap::new()));
            } else if let (Some((cle, valeurs)), Some(s)) = (ligne.split_once(": "), sections.last_mut()) {
                let v = valeurs.trim_matches(['[', ']']).split(", ").filter(|x| !x.is_empty()).map(|x| match x.strip_prefix("0x") {
                    Some(h) => u64::from_str_radix(h, 16).unwrap(),
                    None => x.parse().unwrap(),
                });
                s.1.insert(cle.to_owned(), v.collect());
            }
        }
        assert_eq!(sections.len(), 2);
        for (nom, attendu) in sections {
            let o = if nom == "service" { OPTIONS_EN_SERVICE } else { Options::default() };
            let (train, test, _) = jeu(7, 220);
            let m = Modele::entrainer(&train, o);
            let c = Compatibilite::entrainer(&train, o).unwrap();
            let notes = m.noter_lot(&test);
            let bits = |v: Vec<f64>| v.into_iter().map(f64::to_bits).collect::<Vec<_>>();
            assert_eq!(bits(notes.iter().take(40).map(|s| s.score).collect()), attendu["scores"], "{nom} : scores");
            assert_eq!(notes.iter().take(40).map(|s| s.voisins.len() as u64).collect::<Vec<_>>(), attendu["voisins"], "{nom} : voisins");
            assert_eq!(bits(test.iter().take(10).flat_map(|t| m.composantes(t)).collect()), attendu["composantes"], "{nom} : composantes");
            let p = test.iter().take(40).enumerate().map(|(i, t)| c.probabilite(&m.composantes(t), (i % 5) as f64 * 0.3 - 0.6)).collect();
            assert_eq!(bits(p), attendu["probabilites"], "{nom} : probabilités");
            assert_eq!(bits(test.iter().take(40).map(|t| c.score(&m.composantes(t))).collect()), attendu["classement"], "{nom} : classement");
            assert_eq!(vec![c.taux_de_base.to_bits()], attendu["taux"], "{nom} : taux de base");
        }
    }

    /// Le générateur à graine donne la même suite que la v1 (valeurs relevées dans Node).
    #[test]
    fn mulberry32_comme_la_v1() {
        let mut h = mulberry32(42);
        let v: Vec<f64> = (0..3).map(|_| h()).collect();
        assert_eq!(v, vec![0.6011037519201636, 0.44829055899754167, 0.8524657934904099]);
    }
}
