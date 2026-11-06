//! Le modèle de préférence en service : portage de `src/lib/preferenceService.ts`, `personPreference.ts`,
//! `personOpinionService.ts` (poids des avis) et de la lecture de `impressionService.ts` (lassitude).
//!
//! Cache : la v1 garde UN modèle par processus (une seule personne). Ici, un modèle par COMPTE, reconstruit
//! dès que son empreinte change (risque 3 de specs/catalog-v2-donnees.md : un cache commun mélangerait les
//! goûts de deux comptes). L'empreinte reprend celle de la v1 (nombre de titres notés, somme des notes
//! pondérée par l'identifiant, titres enrichis, dernière modification) et y ajoute la dernière écriture
//! des fiches du catalogue partagé (section 4.8).
use crate::{
    auth::Utilisateur,
    bd::Tx,
    erreur::Erreur,
    fraicheur, js,
    modele::{Compatibilite, Modele, OPTIONS_EN_SERVICE, TitreModele},
};
use serde_json::{Value, json};
use sqlx::{Row, postgres::PgRow};
use std::{
    collections::{HashMap, HashSet},
    sync::{Arc, Mutex},
};

/// En dessous, aucun classement fiable : démarrage à froid (FR-26).
pub const MIN_TITRES_NOTES: usize = 10;

// ---------- conversion d'une ligne ou d'une fiche TMDB en titre du modèle ----------

/// `${valeur}` de JavaScript pour un élément de liste (un nom, un genre).
pub fn texte_js(v: Option<&Value>) -> String {
    match v {
        None => "undefined".into(),
        Some(Value::String(s)) => s.clone(),
        Some(Value::Null) => "null".into(),
        Some(Value::Bool(b)) => b.to_string(),
        Some(Value::Number(n)) => match n.as_f64() {
            Some(f) if f.fract() == 0.0 && f.abs() < 1e21 => format!("{}", f as i64),
            _ => n.to_string(),
        },
        Some(Value::Array(a)) => a.iter().map(|x| if x.is_null() { String::new() } else { texte_js(Some(x)) }).collect::<Vec<_>>().join(","),
        Some(Value::Object(_)) => "[object Object]".into(),
    }
}

fn liste_textes(v: Option<&Value>) -> Option<Vec<String>> {
    v.and_then(Value::as_array).map(|a| a.iter().map(|x| texte_js(Some(x))).collect())
}

fn noms(v: Option<&Value>) -> Vec<String> {
    v.and_then(Value::as_array).map(|a| a.iter().map(|p| texte_js(p.get("name"))).collect()).unwrap_or_default()
}

/// `x ?? null` d'un champ JSON : absent ou null donnent `None`.
fn champ<'a>(objet: &'a Value, cle: &str) -> Option<&'a Value> {
    objet.get(cle).filter(|v| !v.is_null())
}

/// Toutes les personnes d'un titre (`peopleOf`) : interprètes, réalisation, production.
pub fn personnes_de(caracteristiques: &Value) -> Vec<i64> {
    ["cast", "directors", "producers"]
        .iter()
        .flat_map(|k| caracteristiques.get(*k).and_then(Value::as_array).cloned().unwrap_or_default())
        .filter_map(|p| p.get("id").and_then(Value::as_f64).map(|f| f as i64))
        .collect()
}

/// `featuresToTitle` : un titre venu de TMDB (hors bibliothèque).
pub fn titre_de_caracteristiques(id: i64, nom: &str, f: &Value) -> TitreModele {
    TitreModele {
        id,
        nom: nom.to_owned(),
        etoiles: None,
        genres: liste_textes(f.get("genres")).unwrap_or_default(),
        mots_cles: liste_textes(f.get("keywords")).unwrap_or_default(),
        distribution: noms(f.get("cast")),
        realisation: noms(f.get("directors")),
        production: noms(f.get("producers")),
        langue: champ(f, "language").map(|v| texte_js(Some(v))),
        annee: champ(f, "year").and_then(Value::as_f64),
        duree: champ(f, "runtime").and_then(Value::as_f64),
        note_moyenne: champ(f, "voteAverage").and_then(Value::as_f64),
        votes: champ(f, "voteCount").and_then(Value::as_f64),
        personnes: personnes_de(f),
    }
}

/// Colonnes lues pour le modèle (`TITLE_COLUMNS`), dans `library_view`.
pub const COLONNES_MODELE: &str = "id, name, rating::int as etoiles, genres, director, tmdb_rating, vote_count::int as vote_count, tmdb_features";

/// `rowToTitle` : sans caractéristiques TMDB, ce que la base sait déjà (genres, réalisation, note TMDB).
pub fn titre_de_ligne(l: &PgRow) -> Result<TitreModele, Erreur> {
    let f: Option<Value> = l.try_get::<Option<Value>, _>("tmdb_features")?.filter(|v| !v.is_null());
    let genres_base: Option<Value> = l.try_get("genres")?;
    let realisateur: Option<String> = l.try_get("director")?;
    let note: Option<f64> = l.try_get("tmdb_rating")?;
    let votes: Option<i32> = l.try_get("vote_count")?;
    let mut t = match &f {
        Some(f) => {
            let mut t = titre_de_caracteristiques(0, "", f);
            if champ(f, "genres").is_none() {
                t.genres = liste_textes(genres_base.as_ref()).unwrap_or_default();
            }
            if f.get("directors").is_none() {
                t.realisation = realisateur.filter(|r| !r.is_empty()).into_iter().collect();
            }
            t.note_moyenne = t.note_moyenne.or(note);
            t.votes = t.votes.or(votes.map(f64::from));
            t
        }
        None => TitreModele {
            genres: liste_textes(genres_base.as_ref()).unwrap_or_default(),
            realisation: realisateur.filter(|r| !r.is_empty()).into_iter().collect(),
            note_moyenne: note,
            votes: votes.map(f64::from),
            ..Default::default()
        },
    };
    t.id = l.try_get("id")?;
    t.nom = l.try_get("name")?;
    t.etoiles = l.try_get("etoiles")?;
    Ok(t)
}

/// Titres de la bibliothèque, au format du modèle, selon une condition SQL (ordre des identifiants, comme
/// le parcours de la table par SQLite).
pub async fn charger_titres(tx: &mut Tx, condition: &str, ids: Option<&[i64]>) -> Result<Vec<TitreModele>, Erreur> {
    let sql = format!("select {COLONNES_MODELE} from public.library_view where {condition} order by id");
    let mut requete = sqlx::query(&sql);
    if let Some(ids) = ids {
        requete = requete.bind(ids.to_vec());
    }
    let lignes = requete.persistent(false).fetch_all(&mut ***tx).await?;
    lignes.iter().map(titre_de_ligne).collect()
}

/// Début d'une requête de titres du modèle ; on y ajoute des « and … » puis `charger_requete`.
pub fn requete_titres<'a>() -> sqlx::QueryBuilder<'a, sqlx::Postgres> {
    sqlx::QueryBuilder::new(format!("select {COLONNES_MODELE} from public.library_view where true"))
}

pub async fn charger_requete(tx: &mut Tx, mut qb: sqlx::QueryBuilder<'_, sqlx::Postgres>) -> Result<Vec<TitreModele>, Erreur> {
    qb.push(" order by id");
    let lignes = qb.build().persistent(false).fetch_all(&mut ***tx).await?;
    lignes.iter().map(titre_de_ligne).collect()
}

/// Les filtres de catégorie (`DOCUMENTARY_TAG`), de genre et de services de la v1, en PostgreSQL.
pub fn filtrer<'a>(qb: &mut sqlx::QueryBuilder<'a, sqlx::Postgres>, categorie: Option<&'a str>, genre: Option<&'a str>, services: Option<&'a [i64]>) {
    crate::duels::categorie(qb, categorie);
    if let Some(g) = genre {
        qb.push(" and coalesce(genres, '[]'::jsonb) @> jsonb_build_array(").push_bind(g).push("::text)");
    }
    if let Some(ids) = services {
        qb.push(
            " and exists (select 1 from jsonb_array_elements(coalesce(watch_providers -> 'flatrate', '[]'::jsonb) || coalesce(watch_providers -> 'free', '[]'::jsonb) || coalesce(watch_providers -> 'ads', '[]'::jsonb)) fournisseur where (fournisseur ->> 'id')::bigint = any(",
        )
        .push_bind(ids.to_vec())
        .push("))");
    }
}

/// `NOT_DISMISSED_ITEM` : les titres de la bibliothèque écartés (« Ne plus me proposer ») sortent.
pub const NON_ECARTE: &str = " and id not in (select subject_id::bigint from public.dismissals where subject_type = 'item')";

/// Le signal d'apprentissage : tes titres vus et notés.
pub const CONDITION_ENTRAINEMENT: &str = "watch_status = 'Watched' and rating is not null";

// ---------- cache par compte ----------

pub struct Gout {
    pub modele: Arc<Modele>,
    pub compatibilite: Option<Arc<Compatibilite>>,
    /// Les titres notés (entraînement, profil, calibration).
    pub notes: Arc<Vec<TitreModele>>,
}

struct Entree {
    empreinte: String,
    gout: Arc<Gout>,
    utilise: std::time::Instant,
}

static CACHE: Mutex<Option<HashMap<String, Entree>>> = Mutex::new(None);
const CACHE_COMPTES: usize = 16;

async fn empreinte(tx: &mut Tx) -> Result<String, Erreur> {
    let (e,): (String,) = sqlx::query_as(
        "select count(*)::text || '|' || coalesce(sum(li.id * (li.rating + 1))::text, 'null') || '|' || count(c.tmdb_features)::text
                || '|' || coalesce(max(li.updated_at)::text, 'null') || '|' || coalesce(max(c.updated_at)::text, 'null')
           from public.library_items li left join public.catalog_titles c on c.id = li.title_id
          where li.watch_status = 'Watched' and li.rating is not null",
    )
    .persistent(false)
    .fetch_one(&mut ***tx)
    .await?;
    Ok(e)
}

/// FR-28 : le modèle du compte, reconstruit seulement quand ses données ont changé.
pub async fn gout(tx: &mut Tx, utilisateur: &Utilisateur) -> Result<Arc<Gout>, Erreur> {
    let e = empreinte(tx).await?;
    if let Some(gout) = du_cache(&utilisateur.id, &e) {
        return Ok(gout);
    }
    let notes = charger_titres(tx, CONDITION_ENTRAINEMENT, None).await?;
    let debut = std::time::Instant::now();
    let gout = tokio::task::spawn_blocking(move || Gout::entrainer(notes)).await.map_err(|e| Erreur::Interne(format!("entraînement : {e}")))?;
    eprintln!("modèle de préférence entraîné en {} ms sur {} titres notés", debut.elapsed().as_millis(), gout.notes.len());
    let gout = Arc::new(gout);
    mettre_en_cache(&utilisateur.id, e, gout.clone());
    Ok(gout)
}

/// Le modèle d'un compte s'il est à jour (même empreinte), sinon `None`.
pub fn du_cache(compte: &str, empreinte: &str) -> Option<Arc<Gout>> {
    let mut cache = CACHE.lock().ok()?;
    let entree = cache.get_or_insert_with(HashMap::new).get_mut(compte)?;
    if entree.empreinte != empreinte {
        return None;
    }
    entree.utilise = std::time::Instant::now();
    Some(entree.gout.clone())
}

/// Garde le modèle d'un compte (au plus `CACHE_COMPTES` comptes : le moins récemment servi sort).
pub fn mettre_en_cache(compte: &str, empreinte: String, gout: Arc<Gout>) {
    let Ok(mut cache) = CACHE.lock() else { return };
    let cache = cache.get_or_insert_with(HashMap::new);
    if cache.len() >= CACHE_COMPTES && !cache.contains_key(compte)
        && let Some(ancien) = cache.iter().min_by_key(|(_, v)| v.utilise).map(|(k, _)| k.clone()) {
            cache.remove(&ancien);
        }
    cache.insert(compte.to_owned(), Entree { empreinte, gout, utilise: std::time::Instant::now() });
}

impl Gout {
    /// Entraîne le modèle et la compatibilité sur les titres vus notés (dans l'ordre des identifiants).
    pub fn entrainer(notes: Vec<TitreModele>) -> Self {
        let modele = Modele::entrainer(&notes, OPTIONS_EN_SERVICE);
        let compatibilite = Compatibilite::entrainer(&notes, OPTIONS_EN_SERVICE).map(Arc::new);
        Gout { modele: Arc::new(modele), compatibilite, notes: Arc::new(notes) }
    }
}

/// Un titre classé : son score (avis compris) et sa compatibilité.
#[derive(Clone, Debug)]
pub struct Classe {
    pub id: i64,
    pub score: f64,
    pub voisins: Vec<crate::modele::Voisin>,
    pub compatibilite: Option<f64>,
}

/// `rankTitles` : par compatibilité dès qu'elle est calée, par le mélange sinon ; `bonus` = avis sur les
/// personnes. Comme la v1 (`new Map(titles.map(…))`), un identifiant en double prend le DERNIER titre.
pub fn classer(gout: &Gout, titres: &[TitreModele], avis: &HashMap<i64, f64>) -> Vec<Classe> {
    let par_id: HashMap<i64, &TitreModele> = titres.iter().map(|t| (t.id, t)).collect();
    gout.modele
        .noter_lot(titres)
        .into_iter()
        .map(|s| {
            let t = par_id[&s.id];
            let bonus = bonus_personnes(&t.personnes, avis);
            match &gout.compatibilite {
                None => Classe { id: s.id, score: s.score + bonus, voisins: s.voisins, compatibilite: None },
                Some(c) => {
                    let comp = gout.modele.composantes(t);
                    Classe { id: s.id, score: c.score(&comp) + bonus, voisins: s.voisins, compatibilite: Some(c.probabilite(&comp, bonus)) }
                }
            }
        })
        .collect()
}

/// Le taux de base de la compatibilité (`getCompatibility(db)?.baseRate ?? null`).
pub fn taux_de_base(gout: &Gout) -> Option<f64> {
    gout.compatibilite.as_ref().map(|c| c.taux_de_base)
}

// ---------- profil (FR-13) ----------

const AFFINITE_A_PRIORI: f64 = 8.0;

/// `ratingAffinity` : moyenne de notes par genre ou réalisateur, lissée vers ta moyenne globale.
pub fn affinites(notes: &[TitreModele], realisateurs: bool) -> Vec<Value> {
    let titres: Vec<&TitreModele> = notes.iter().filter(|t| t.etoiles.is_some()).collect();
    if titres.is_empty() {
        return vec![];
    }
    let mut somme = 0.0;
    for t in &titres {
        somme += f64::from(t.etoiles.unwrap_or(0));
    }
    let global = somme / titres.len() as f64;
    let mut ordre: Vec<String> = vec![];
    let mut paniers: HashMap<String, Vec<f64>> = HashMap::new();
    for t in &titres {
        for cle in if realisateurs { &t.realisation } else { &t.genres } {
            let p = paniers.entry(cle.clone()).or_insert_with(|| {
                ordre.push(cle.clone());
                vec![]
            });
            p.push(f64::from(t.etoiles.unwrap_or(0)));
        }
    }
    let mut entrees: Vec<(String, f64, usize)> = ordre
        .iter()
        .map(|n| (n, &paniers[n]))
        .filter(|(_, e)| e.len() >= 2)
        .map(|(n, e)| {
            let mut s = 0.0;
            for x in e {
                s += x;
            }
            (n.clone(), (s + AFFINITE_A_PRIORI * global) / (e.len() as f64 + AFFINITE_A_PRIORI), e.len())
        })
        .collect();
    entrees.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    entrees.into_iter().map(|(name, affinity, count)| json!({ "name": name, "affinity": affinity, "count": count })).collect()
}

/// `RecommendationProfile` : genres, réalisateurs, titres notés, taux de base.
pub fn profil(gout: &Gout) -> Value {
    json!({
        "genres": affinites(&gout.notes, false),
        "directors": affinites(&gout.notes, true),
        "ratedCount": gout.notes.len(),
        "compatibilityBaseRate": taux_de_base(gout),
    })
}

/// Distribution des genres de ce que tu aimes (titres vus notés ⭐⭐⭐ ou plus), cible de la calibration.
pub fn distribution_aimee(gout: &Gout) -> crate::faconnage::Distribution {
    crate::faconnage::distribution_des_genres(gout.notes.iter().filter(|t| t.etoiles.unwrap_or(-1) >= 3).map(|t| t.genres.as_slice()))
}

// ---------- avis sur les personnes (tri-rapide FR-7, classement FR-13) ----------

pub const BONUS_PERSONNE: f64 = 0.3;
pub const BONUS_PERSONNE_MAX: f64 = 0.9;
const AVIS_A_PRIORI: f64 = 10.0;

/// Poids d'un avis avant centrage : « je n'aime pas » −1 ; « j'aime » 1, ou note ÷ 3.
pub fn valeur_avis(avis: i32, note: Option<i32>) -> f64 {
    if avis == -1 {
        return -1.0;
    }
    match note {
        None => 1.0,
        Some(n) => f64::from(n) / 3.0,
    }
}

/// Avis centrés (`centeredOpinions`), dans l'ordre des lignes (il fixe la somme).
pub fn avis_centres(avis: &[(i64, f64)]) -> HashMap<i64, f64> {
    // Une Map de la v1 : un identifiant en double garde sa première place et sa dernière valeur.
    let mut ordre: Vec<i64> = vec![];
    let mut valeurs: HashMap<i64, f64> = HashMap::new();
    for (id, v) in avis {
        if valeurs.insert(*id, *v).is_none() {
            ordre.push(*id);
        }
    }
    let mut somme = 0.0;
    for id in &ordre {
        somme += valeurs[id];
    }
    let centre = somme / (ordre.len() as f64 + AVIS_A_PRIORI);
    ordre.iter().map(|id| (*id, valeurs[id] - centre)).collect()
}

/// `personBonus` : somme des avis des personnes du titre (chacune une fois), bornée à ±0,9.
pub fn bonus_personnes(personnes: &[i64], avis: &HashMap<i64, f64>) -> f64 {
    if avis.is_empty() || personnes.is_empty() {
        return 0.0;
    }
    let mut vues = HashSet::new();
    let mut total = 0.0;
    for id in personnes {
        if vues.insert(*id) {
            total += avis.get(id).copied().unwrap_or(0.0) * BONUS_PERSONNE;
        }
    }
    (-BONUS_PERSONNE_MAX).max(BONUS_PERSONNE_MAX.min(total))
}

/// `getOpinionWeights`.
pub async fn poids_des_avis(tx: &mut Tx) -> Result<HashMap<i64, f64>, Erreur> {
    let lignes: Vec<(i32, i16, Option<i16>)> =
        sqlx::query_as("select person_id, opinion, rating from public.person_opinions order by person_id").persistent(false).fetch_all(&mut ***tx).await?;
    Ok(avis_centres(&lignes.into_iter().map(|(id, a, n)| (i64::from(id), valeur_avis(i32::from(a), n.map(i32::from)))).collect::<Vec<_>>()))
}

// ---------- lassitude (recommandations-fraicheur-v1 FR-5, FR-7) ----------

const MEMOIRE_JOURS: i64 = 42;

/// `getExposure` : jours montrés (aujourd'hui exclu, 6 semaines au plus) après le dernier geste, chacun pondéré
/// par son ancienneté. Le calcul est celui de `fraicheur::exposition` (groupe 2) ; les jours sont lus dans
/// l'ordre (il fixe l'ordre des sommes, comme l'index sur le jour de la v1).
pub async fn lassitude(tx: &mut Tx, maintenant: i64) -> Result<HashMap<String, f64>, Erreur> {
    let aujourd_hui = fraicheur::jour_exposition(maintenant);
    let depuis = fraicheur::jour_exposition(maintenant - MEMOIRE_JOURS * js::JOUR_MS);
    let montres: Vec<(String, String, String)> =
        sqlx::query_as("select subject_type, subject_id, day::text from public.impressions where day >= $1::date and day < $2::date order by day")
            .bind(&depuis)
            .bind(&aujourd_hui)
            .persistent(false)
            .fetch_all(&mut ***tx)
            .await?;
    if montres.is_empty() {
        return Ok(HashMap::new());
    }
    let gestes: Vec<(String, String, i64)> = sqlx::query_as(
        "select subject_type, subject_id, floor(extract(epoch from max(created_at)) * 1000)::bigint from public.events
          where subject_type in ('item', 'tmdb') and created_at >= to_timestamp($1::double precision / 1000)
          group by subject_type, subject_id",
    )
    .bind((maintenant - (MEMOIRE_JOURS + 1) * js::JOUR_MS) as f64)
    .persistent(false)
    .fetch_all(&mut ***tx)
    .await?;
    Ok(fraicheur::exposition(&montres, &gestes, maintenant))
}

pub fn cle_item(id: i64) -> String {
    format!("item:{id}")
}

pub fn cle_tmdb_exposition(type_: &str, tmdb_id: i64) -> String {
    format!("tmdb:{}:{tmdb_id}", if type_ == "Movie" { "movie" } else { "tv" })
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- personPreference (tests de triageService.test.ts, AC-4, FR-7) ----

    #[test]
    fn bonus_borne_pour_une_personne_aimee_malus_symetrique_sinon() {
        let avis: HashMap<i64, f64> = [(1, 1.0), (2, -1.0)].into_iter().collect();
        assert_eq!(bonus_personnes(&[1, 99], &avis), BONUS_PERSONNE);
        assert_eq!(bonus_personnes(&[2], &avis), -BONUS_PERSONNE);
        assert_eq!(bonus_personnes(&[1, 2], &avis), 0.0);
        assert_eq!(bonus_personnes(&[1, 1], &avis), BONUS_PERSONNE);
        let beaucoup: HashMap<i64, f64> = (0..10).map(|i| (i, 1.0)).collect();
        assert_eq!(bonus_personnes(&(0..10).collect::<Vec<_>>(), &beaucoup), BONUS_PERSONNE_MAX);
    }

    #[test]
    fn avis_centres_et_notes() {
        assert_eq!(valeur_avis(-1, Some(5)), -1.0);
        assert_eq!(valeur_avis(1, None), 1.0);
        assert_eq!(valeur_avis(1, Some(5)), 5.0 / 3.0);
        let c = avis_centres(&[(1, 1.0), (2, 1.0), (3, -1.0)]);
        let centre = 1.0 / 13.0;
        assert_eq!(c[&1], 1.0 - centre);
        assert_eq!(c[&3], -1.0 - centre);
    }
}
