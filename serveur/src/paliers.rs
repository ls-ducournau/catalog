//! Départage par palier (classement-v1 FR-3 à FR-11) : l'étape suivante d'un palier, la répartition
//! Haut / Milieu / Bas, le quatuor (un duel depuis 2026-09-28), et l'annulation d'une manche
//! (`POST /api/duels/undo`, mode `round`). Reprend `src/lib/tierDuelService.ts`.
//!
//! La logique est faite de fonctions pures (testées avec les mêmes cas que `classement.test.ts`) ; les
//! routes lisent et écrivent la base autour. Comme la v1, un palier ne touche ni l'Elo général ni la date
//! de modification du titre (AC-3). Les notes sont des entiers 0 à 5, y compris dans `tier_rounds.payload`.
use crate::{
    auth::Utilisateur,
    bd::{self, Tx},
    duels::categorie,
    erreur::Erreur,
    items::{NOTES, annee_affichee},
    js_v8,
};
use axum::{
    Json,
    body::Bytes,
    extract::Query,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
use sqlx::{Postgres, QueryBuilder, Row};
use std::collections::HashMap;

const AFFICHE: &str = "https://image.tmdb.org/t/p/w500";
const ELO_DEPART: f64 = 1200.0;
const FACTEUR_K: f64 = 32.0;
/// FR-7 : un titre est départagé après ce nombre de comparaisons dans son palier.
pub(crate) const DEPARTAGE: i32 = 5;
/// FR-8 : à partir de cette taille, on répartit avant d'affiner.
pub(crate) const MIN_REPARTITION: usize = 60;
/// FR-10 : titres montrés à la fois (deux depuis le 2026-09-28).
pub(crate) const TAILLE_QUATUOR: usize = 2;
/// Tolérance de `undoRound` sur le score.
const MEME: f64 = 1e-6;

fn reponse(statut: u16, corps: Value) -> Response {
    (StatusCode::from_u16(statut).unwrap_or(StatusCode::INTERNAL_SERVER_ERROR), Json(corps)).into_response()
}
fn invalide() -> Response {
    reponse(400, json!({ "error": "invalid_request" }))
}

/// `parseStars` : null, absent ou chaîne vide : rien ; sinon `Number(valeur)` entier de 0 à 5.
pub(crate) fn etoiles_de(v: Option<&Value>) -> Option<i16> {
    let v = v.filter(|v| !v.is_null() && v.as_str() != Some(""))?;
    let n = js_v8::nombre(v);
    (n.fract() == 0.0 && (0.0..=5.0).contains(&n)).then_some(n as i16)
}

/// `parseBand` : 0, 1 ou 2 exactement.
fn groupe_de(v: Option<&Value>) -> Option<i16> {
    let n = v?.as_f64()?;
    [0.0, 1.0, 2.0].contains(&n).then_some(n as i16)
}

// ---------- l'étape suivante (FR-7 à FR-11) ----------

/// Un titre d'un palier, avec son état de départage effectif (remis à zéro si la note a changé, FR-4).
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Membre {
    pub id: i64,
    pub comparaisons: i32,
    pub score: f64,
    pub groupe: Option<i16>,
}

fn portee(m: &[Membre]) -> Value {
    json!({
        "titles": m.len(),
        "compared": m.iter().filter(|x| x.comparaisons > 0).count(),
        "settled": m.iter().filter(|x| x.comparaisons >= DEPARTAGE).count(),
        "banded": m.len() >= MIN_REPARTITION,
        "placed": m.iter().filter(|x| x.groupe.is_some()).count(),
    })
}

fn inacheve(m: &[Membre]) -> bool {
    if m.len() < 2 {
        return false;
    }
    if m.len() >= MIN_REPARTITION && m.iter().any(|x| x.groupe.is_none()) {
        return true;
    }
    m.iter().any(|x| x.comparaisons < DEPARTAGE)
}

/// `nextUnsettledTier` : du plus haut au plus bas après celui-ci, puis en reprenant du haut.
fn palier_suivant(paliers: &HashMap<i16, Vec<Membre>>, etoiles: i16) -> Option<i16> {
    let ordre: Vec<i16> = [5, 4, 3, 2, 1, 0].into_iter().filter(|s| *s != etoiles).collect();
    let apres = ordre.iter().filter(|s| **s < etoiles).chain(ordre.iter().filter(|s| **s > etoiles));
    apres.copied().find(|s| inacheve(paliers.get(s).map(Vec::as_slice).unwrap_or_default()))
}

/// `pickQuad` : l'ancre est tirée parmi les moins comparés (de préférence pas encore départagés) ; ses
/// partenaires sont proches d'elle en score, avec un peu de hasard ; puis l'ordre est mélangé par le tri
/// de V8 avec un comparateur au hasard. Même suite d'appels à `rng` que la v1.
pub(crate) fn choisir_quatuor<T: Clone>(
    groupe: &[T],
    comparaisons: impl Fn(&T) -> i32,
    score: impl Fn(&T) -> f64,
    rng: &mut impl FnMut() -> f64,
    seulement_inacheves: bool,
    taille: usize,
) -> Vec<T> {
    if groupe.len() <= taille {
        let mut tout = groupe.to_vec();
        js_v8::tri_v8(&mut tout, |_, _| rng() - 0.5);
        return tout;
    }
    let inacheves: Vec<usize> = (0..groupe.len()).filter(|&i| comparaisons(&groupe[i]) < DEPARTAGE).collect();
    let reserve: Vec<usize> = if seulement_inacheves && !inacheves.is_empty() { inacheves } else { (0..groupe.len()).collect() };
    let poids: Vec<f64> = reserve.iter().map(|&i| 1.0 / (f64::from(comparaisons(&groupe[i])) + 1.0)).collect();
    let mut r = rng() * poids.iter().fold(0.0, |a, b| a + b);
    let mut ancre = *reserve.last().expect("groupe non vide");
    for (k, &i) in reserve.iter().enumerate() {
        r -= poids[k];
        if r <= 0.0 {
            ancre = i;
            break;
        }
    }
    let score_ancre = score(&groupe[ancre]);
    let mut partenaires: Vec<(usize, f64)> = (0..groupe.len())
        .filter(|&i| i != ancre)
        .map(|i| {
            let m = &groupe[i];
            let cle = (score(m) - score_ancre).abs() / 100.0 + if comparaisons(m) >= DEPARTAGE { 0.5 } else { 0.0 } + rng() * 0.8;
            (i, cle)
        })
        .collect();
    js_v8::tri_v8(&mut partenaires, |a, b| a.1 - b.1);
    let mut choix: Vec<usize> = std::iter::once(ancre).chain(partenaires.iter().take(taille - 1).map(|p| p.0)).collect();
    js_v8::tri_v8(&mut choix, |_, _| rng() - 0.5);
    choix.into_iter().map(|i| groupe[i].clone()).collect()
}

/// Une étape du départage (`TierStep`).
#[derive(Debug, PartialEq)]
pub(crate) enum Etape {
    Repartir { membre: Membre, portee: Value },
    Quatuor { membres: Vec<Membre>, groupe: Option<i16>, titres_groupe: usize, departages_groupe: usize, portee: Value },
    Fini { portee: Value, suivant: Option<i16> },
    PasAssez(usize),
}

/// `getTierStep` : palier de 60 titres ou plus, répartir d'abord chaque titre, puis affiner le Haut, le
/// Milieu, le Bas ; plus petit, directement les quatuors. `affiner` : on affine un palier départagé.
/// `paliers` : les membres de chaque palier de la catégorie, dans l'ordre des identifiants.
pub(crate) fn etape(paliers: &HashMap<i16, Vec<Membre>>, etoiles: i16, rng: &mut impl FnMut() -> f64, affiner: bool) -> Etape {
    let membres: &[Membre] = paliers.get(&etoiles).map(Vec::as_slice).unwrap_or_default();
    if membres.len() < 2 {
        return Etape::PasAssez(membres.len());
    }
    let reparti = membres.len() >= MIN_REPARTITION;
    if reparti {
        let a_placer: Vec<&Membre> = membres.iter().filter(|m| m.groupe.is_none()).collect();
        if !a_placer.is_empty() {
            let suivant = a_placer[(rng() * a_placer.len() as f64).floor() as usize];
            return Etape::Repartir { membre: suivant.clone(), portee: portee(membres) };
        }
    }
    // FR-11 : le Haut d'abord. Un palier non réparti forme un seul groupe.
    let groupes: Vec<(Option<i16>, Vec<Membre>)> = if reparti {
        [2, 1, 0].iter().map(|g| (Some(*g), membres.iter().filter(|m| m.groupe == Some(*g)).cloned().collect())).collect()
    } else {
        vec![(None, membres.to_vec())]
    };
    let ouvert = groupes.iter().find(|g| g.1.len() >= 2 && g.1.iter().any(|m| m.comparaisons < DEPARTAGE));
    if ouvert.is_none() && !affiner {
        return Etape::Fini { portee: portee(membres), suivant: palier_suivant(paliers, etoiles) };
    }
    // Affiner encore : un groupe au hasard parmi ceux qui ont de quoi comparer.
    let jouables: Vec<&(Option<i16>, Vec<Membre>)> = groupes.iter().filter(|g| g.1.len() >= 2).collect();
    let groupe = match ouvert {
        Some(g) => g,
        None => jouables[(rng() * jouables.len() as f64).floor() as usize],
    };
    let membres_choisis = choisir_quatuor(&groupe.1, |m| m.comparaisons, |m| m.score, rng, ouvert.is_some(), TAILLE_QUATUOR);
    Etape::Quatuor {
        membres: membres_choisis,
        groupe: groupe.0,
        titres_groupe: groupe.1.len(),
        departages_groupe: groupe.1.iter().filter(|m| m.comparaisons >= DEPARTAGE).count(),
        portee: portee(membres),
    }
}

/// Ce qu'il faut pour montrer un titre (`toItems`).
#[derive(Clone, Debug)]
pub(crate) struct Fiche {
    pub nom: String,
    pub annee: Option<String>,
    pub genres: Option<Value>,
    pub affiche: Option<String>,
}

fn titre_palier(m: &Membre, f: &Fiche) -> Value {
    // parseGenres : un tableau, ses seules chaînes.
    let genres: Vec<Value> = f.genres.as_ref().and_then(Value::as_array).map(|g| g.iter().filter(|x| x.is_string()).cloned().collect()).unwrap_or_default();
    json!({
        "id": m.id, "name": f.nom, "year": annee_affichee(f.annee.as_deref()), "genres": genres,
        "posterUrl": f.affiche.as_ref().filter(|a| !a.is_empty()).map(|a| format!("{AFFICHE}{a}")),
        "tierScore": if m.comparaisons > 0 { Some(m.score) } else { None },
        "comparisons": m.comparaisons, "band": m.groupe,
    })
}

/// La réponse de `GET /api/duels/tier/next` pour une étape.
pub(crate) fn etape_json(e: &Etape, fiches: &HashMap<i64, Fiche>) -> Result<Value, Erreur> {
    let titre = |m: &Membre| fiches.get(&m.id).map(|f| titre_palier(m, f)).ok_or_else(|| Erreur::Interne(format!("titre {} introuvable", m.id)));
    Ok(match e {
        Etape::Repartir { membre, portee } => json!({ "step": "band", "item": titre(membre)?, "scope": portee }),
        Etape::Quatuor { membres, groupe, titres_groupe, departages_groupe, portee } => json!({
            "step": "quad", "items": membres.iter().map(titre).collect::<Result<Vec<_>, _>>()?, "group": groupe,
            "groupScope": { "titles": titres_groupe, "settled": departages_groupe }, "scope": portee,
        }),
        Etape::Fini { portee, suivant } => json!({ "step": "done", "scope": portee, "nextTier": suivant }),
        Etape::PasAssez(n) => json!({ "error": "not_enough_titles", "eligibleCount": n }),
    })
}

/// Les membres de chaque palier d'une catégorie (titres vus et notés), dans l'ordre des identifiants.
async fn lire_paliers(tx: &mut Tx, cat: Option<&str>) -> Result<HashMap<i16, Vec<Membre>>, Erreur> {
    let mut q = QueryBuilder::<Postgres>::new(format!(
        "select id, rating as note,
                (case when tier_rating = rating then tier_duels_count else 0 end)::int as comparaisons,
                case when tier_rating = rating then tier_elo else {ELO_DEPART} end as score,
                case when tier_rating = rating then tier_band end as groupe
           from public.library_view where watch_status = 'Watched' and rating is not null"
    ));
    categorie(&mut q, cat);
    q.push(" order by id");
    let mut paliers: HashMap<i16, Vec<Membre>> = HashMap::new();
    for l in q.build().persistent(false).fetch_all(&mut ***tx).await? {
        paliers.entry(l.try_get("note")?).or_default().push(Membre { id: l.try_get("id")?, comparaisons: l.try_get("comparaisons")?, score: l.try_get("score")?, groupe: l.try_get("groupe")? });
    }
    Ok(paliers)
}

/// GET /api/duels/tier/next?stars=&category=&refine=1
pub async fn suivant(utilisateur: Utilisateur, Query(p): Query<Vec<(String, String)>>) -> Result<Response, Erreur> {
    let Some(etoiles) = etoiles_de(js_v8::premier(&p, "stars").map(|s| Value::String(s.to_owned())).as_ref()) else { return Ok(invalide()) };
    let cat = js_v8::premier(&p, "category").filter(|c| matches!(*c, "Movie" | "TV Series" | "Documentary"));
    let affiner = js_v8::premier(&p, "refine") == Some("1");
    let mut tx = bd::transaction(&utilisateur).await?;
    let paliers = lire_paliers(&mut tx, cat).await?;
    let e = etape(&paliers, etoiles, &mut js_v8::hasard, affiner);
    let ids: Vec<i64> = match &e {
        Etape::Repartir { membre, .. } => vec![membre.id],
        Etape::Quatuor { membres, .. } => membres.iter().map(|m| m.id).collect(),
        _ => vec![],
    };
    let mut fiches = HashMap::new();
    if !ids.is_empty() {
        for l in sqlx::query("select id, name, year, genres, poster_path from public.library_view where id = any($1)").bind(&ids).persistent(false).fetch_all(&mut **tx).await? {
            fiches.insert(l.try_get::<i64, _>("id")?, Fiche { nom: l.try_get("name")?, annee: l.try_get("year")?, genres: l.try_get("genres")?, affiche: l.try_get("poster_path")? });
        }
    }
    tx.valider().await?;
    Ok(Json(etape_json(&e, &fiches)?).into_response())
}

// ---------- les réponses et leur annulation (FR-1, FR-9, FR-10) ----------

/// L'état de départage d'un titre (`TierState`) ; `rating` : la note pour laquelle il vaut.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct EtatPalier {
    pub elo: f64,
    pub count: i32,
    pub band: Option<i16>,
    pub rating: Option<i16>,
}

impl EtatPalier {
    fn json(&self) -> Value {
        json!({ "elo": self.elo, "count": self.count, "band": self.band, "rating": self.rating })
    }
}

/// Une ligne de la bibliothèque, telle que `readRows` la lit.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct LigneTitre {
    pub id: i64,
    pub note: Option<i16>,
    pub statut: Option<String>,
    pub note_palier: Option<i16>,
    pub elo_palier: f64,
    pub comparaisons: i32,
    pub groupe: Option<i16>,
}

impl LigneTitre {
    /// `stateOf`
    pub(crate) fn etat(&self) -> EtatPalier {
        EtatPalier { elo: self.elo_palier, count: self.comparaisons, band: self.groupe, rating: self.note_palier }
    }
    /// `effective` : ce qui vaut pour une autre note repart de zéro.
    fn effectif(&self, note: i16) -> EtatPalier {
        if self.note_palier == Some(note) { self.etat() } else { EtatPalier { elo: ELO_DEPART, count: 0, band: None, rating: Some(note) } }
    }
    fn a_jour(&self, note: i16) -> bool {
        self.statut.as_deref() == Some("Watched") && self.note == Some(note)
    }
}

/// Un titre touché par une manche : son état avant et après.
#[derive(Clone, Debug, PartialEq)]
pub(crate) struct Changement {
    pub id: i64,
    pub avant: EtatPalier,
    pub apres: EtatPalier,
}

#[derive(Debug, PartialEq)]
pub(crate) enum Refus {
    /// EC-2 : le titre n'est plus (vu et) noté comme le palier annoncé.
    Perime,
    /// Quatuor mal formé.
    Invalide,
}

/// `submitBand`, sans la base : le changement à écrire.
pub(crate) fn repartition(ligne: Option<&LigneTitre>, etoiles: i16, groupe: i16) -> Result<Changement, Refus> {
    let ligne = ligne.filter(|l| l.a_jour(etoiles)).ok_or(Refus::Perime)?;
    let apres = EtatPalier { band: Some(groupe), rating: Some(etoiles), ..ligne.effectif(etoiles) };
    Ok(Changement { id: ligne.id, avant: ligne.etat(), apres })
}

/// `submitQuad`, sans la base (AC-12) : le meilleur bat tous les autres ; chacun des autres bat le moins
/// bon (s'il est désigné). Les scores bougent ensemble, calculés depuis ceux d'avant. Les identifiants
/// sont des nombres JSON (un non entier ne désigne aucun titre : périmé, comme en v1).
pub(crate) fn quatuor(ids: &[f64], lignes: &HashMap<i64, LigneTitre>, etoiles: i16, meilleur: f64, pire: Option<f64>) -> Result<Vec<Changement>, Refus> {
    let unique = ids.iter().enumerate().all(|(i, x)| !ids[..i].contains(x));
    if ids.len() < 2 || !unique || !ids.contains(&meilleur) || pire.is_some_and(|p| !ids.contains(&p) || p == meilleur) {
        return Err(Refus::Invalide);
    }
    let ligne = |x: f64| js_v8::identifiant(&json!(x)).and_then(|id| lignes.get(&id));
    if ids.iter().any(|x| !ligne(*x).is_some_and(|l| l.a_jour(etoiles))) {
        return Err(Refus::Perime);
    }
    let rangs: Vec<&LigneTitre> = ids.iter().map(|x| ligne(*x).expect("vérifié")).collect();
    let rang = |x: f64| ids.iter().position(|y| *y == x).expect("dans le quatuor");
    let depart: Vec<EtatPalier> = rangs.iter().map(|l| l.effectif(etoiles)).collect();
    let mut delta = vec![0.0; ids.len()];
    let mut nombre = vec![0; ids.len()];
    let mut jouer = |g: usize, p: usize| {
        let attendu = 1.0 / (1.0 + 10f64.powf((depart[p].elo - depart[g].elo) / 400.0));
        let ecart = FACTEUR_K * (1.0 - attendu);
        delta[g] += ecart;
        delta[p] -= ecart;
        nombre[g] += 1;
        nombre[p] += 1;
    };
    let m = rang(meilleur);
    for i in 0..ids.len() {
        if i != m {
            jouer(m, i);
        }
    }
    if let Some(p) = pire.map(rang) {
        for i in 0..ids.len() {
            if i != m && i != p {
                jouer(i, p);
            }
        }
    }
    Ok(rangs
        .iter()
        .enumerate()
        .map(|(i, l)| {
            let d = &depart[i];
            Changement { id: l.id, avant: l.etat(), apres: EtatPalier { elo: d.elo + delta[i], count: d.count + nombre[i], band: d.band, rating: Some(etoiles) } }
        })
        .collect())
}

/// `undoRound`, sans la base : la manche n'est défaite que si aucun de ses titres n'a bougé depuis.
/// `elements` : `payload.items` tel qu'il est rangé ; rend les états à rétablir.
pub(crate) fn defaire(elements: &[Value], lignes: &HashMap<i64, LigneTitre>) -> Result<Option<Vec<(i64, EtatPalier)>>, Erreur> {
    let egal = |v: Option<&Value>, attendu: Option<i64>| match (v, attendu) {
        (Some(Value::Null), None) => true,
        (Some(v), Some(a)) => v.as_f64() == Some(a as f64),
        _ => false,
    };
    let intact = elements.iter().all(|e| {
        let apres = e.get("after");
        let Some(l) = e.get("id").and_then(js_v8::identifiant).and_then(|id| lignes.get(&id)) else { return false };
        apres.and_then(|a| a.get("elo")).and_then(Value::as_f64).is_some_and(|elo| (l.elo_palier - elo).abs() < MEME)
            && egal(apres.and_then(|a| a.get("count")), Some(i64::from(l.comparaisons)))
            && egal(apres.and_then(|a| a.get("band")), l.groupe.map(i64::from))
            && egal(apres.and_then(|a| a.get("rating")), l.note_palier.map(i64::from))
    });
    if !intact {
        return Ok(None);
    }
    let lire = |e: &Value| -> Option<(i64, EtatPalier)> {
        let avant = e.get("before")?;
        let entier = |k: &str| -> Option<Option<i16>> {
            match avant.get(k)? {
                Value::Null => Some(None),
                v => v.as_i64().and_then(|n| i16::try_from(n).ok()).map(Some),
            }
        };
        let etat = EtatPalier { elo: avant.get("elo")?.as_f64()?, count: i32::try_from(avant.get("count")?.as_i64()?).ok()?, band: entier("band")?, rating: entier("rating")? };
        Some((e.get("id").and_then(js_v8::identifiant)?, etat))
    };
    elements.iter().map(|e| lire(e).ok_or_else(|| Erreur::Interne(format!("manche illisible : {e}")))).collect::<Result<Vec<_>, _>>().map(Some)
}

async fn lire_lignes(tx: &mut Tx, ids: &[i64]) -> Result<HashMap<i64, LigneTitre>, Erreur> {
    let lignes = sqlx::query("select id, rating, watch_status, tier_rating, tier_elo, tier_duels_count, tier_band from public.library_items where id = any($1)")
        .bind(ids)
        .persistent(false)
        .fetch_all(&mut ***tx)
        .await?;
    lignes
        .iter()
        .map(|l| {
            let ligne = LigneTitre {
                id: l.try_get("id")?,
                note: l.try_get("rating")?,
                statut: l.try_get("watch_status")?,
                note_palier: l.try_get("tier_rating")?,
                elo_palier: l.try_get("tier_elo")?,
                comparaisons: l.try_get("tier_duels_count")?,
                groupe: l.try_get("tier_band")?,
            };
            Ok((ligne.id, ligne))
        })
        .collect()
}

async fn ecrire_etat(tx: &mut Tx, id: i64, e: &EtatPalier) -> Result<(), Erreur> {
    sqlx::query("update public.library_items set tier_elo = $1, tier_duels_count = $2, tier_band = $3, tier_rating = $4 where id = $5")
        .bind(e.elo)
        .bind(e.count)
        .bind(e.band)
        .bind(e.rating)
        .bind(id)
        .persistent(false)
        .execute(&mut ***tx)
        .await?;
    Ok(())
}

/// `writeRound` : les nouveaux états, puis la manche (de quoi l'annuler en entier).
async fn ecrire_manche(mut tx: Tx, etoiles: i16, genre: &str, changements: &[Changement]) -> Result<Response, Erreur> {
    for c in changements {
        ecrire_etat(&mut tx, c.id, &c.apres).await?;
    }
    let payload = json!({ "items": changements.iter().map(|c| json!({ "id": c.id, "before": c.avant.json(), "after": c.apres.json() })).collect::<Vec<_>>() });
    let (id,): (i64,) = sqlx::query_as("insert into public.tier_rounds (rating, kind, payload) values ($1, $2, $3) returning id")
        .bind(etoiles)
        .bind(genre)
        .bind(payload)
        .persistent(false)
        .fetch_one(&mut **tx)
        .await?;
    tx.valider().await?;
    Ok(Json(json!({ "roundId": id })).into_response())
}

fn refus(r: Refus) -> Response {
    match r {
        Refus::Perime => reponse(409, json!({ "error": "stale" })),
        Refus::Invalide => reponse(400, json!({ "error": "invalid" })),
    }
}

/// POST /api/duels/tier/band : `{ itemId, stars, band }` (FR-9, EC-2).
pub async fn repartir(utilisateur: Utilisateur, corps: Bytes) -> Result<Response, Erreur> {
    let corps: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
    let (Some(etoiles), Some(groupe), Some(id)) = (etoiles_de(corps.get("stars")), groupe_de(corps.get("band")), corps.get("itemId").filter(|v| v.is_number())) else {
        return Ok(invalide());
    };
    let mut tx = bd::transaction(&utilisateur).await?;
    let id = js_v8::identifiant(id);
    let lignes = match id {
        Some(id) => lire_lignes(&mut tx, &[id]).await?,
        None => HashMap::new(),
    };
    match repartition(id.and_then(|id| lignes.get(&id)), etoiles, groupe) {
        Ok(c) => ecrire_manche(tx, etoiles, "band", &[c]).await,
        Err(r) => Ok(refus(r)),
    }
}

/// POST /api/duels/tier/quad : `{ itemIds, stars, bestId, worstId }` (FR-10, EC-2).
pub async fn quatuor_route(utilisateur: Utilisateur, corps: Bytes) -> Result<Response, Erreur> {
    let corps: Value = serde_json::from_slice(&corps).unwrap_or(Value::Null);
    let ids: Option<Vec<f64>> = corps.get("itemIds").and_then(Value::as_array).and_then(|a| a.iter().map(Value::as_f64).collect());
    let meilleur = corps.get("bestId").and_then(Value::as_f64);
    let pire: Option<Option<f64>> = match corps.get("worstId") {
        Some(Value::Null) => Some(None),
        Some(v) => v.as_f64().map(Some),
        None => None,
    };
    let (Some(ids), Some(meilleur), Some(pire), Some(etoiles)) = (ids, meilleur, pire, etoiles_de(corps.get("stars"))) else { return Ok(invalide()) };
    let mut tx = bd::transaction(&utilisateur).await?;
    let entiers: Vec<i64> = ids.iter().filter_map(|x| js_v8::identifiant(&json!(x))).collect();
    let lignes = lire_lignes(&mut tx, &entiers).await?;
    match quatuor(&ids, &lignes, etoiles, meilleur, pire) {
        Ok(c) => ecrire_manche(tx, etoiles, "quad", &c).await,
        Err(r) => Ok(refus(r)),
    }
}

/// `undoRound` : défait une répartition ou un quatuor, si aucun des titres n'a bougé depuis.
pub(crate) async fn annuler_manche(utilisateur: &Utilisateur, id: &Value) -> Result<Response, Erreur> {
    let introuvable = || Ok(reponse(404, json!({ "error": "not_found" })));
    let Some(id) = js_v8::identifiant(id) else { return introuvable() };
    let mut tx = bd::transaction(utilisateur).await?;
    let manche: Option<(Value,)> = sqlx::query_as("select payload from public.tier_rounds where id = $1").bind(id).persistent(false).fetch_optional(&mut **tx).await?;
    let Some((payload,)) = manche else { return introuvable() };
    let mut elements = payload.get("items").and_then(Value::as_array).cloned().unwrap_or_default();
    // Les scores, au bit près : serde_json (sans `float_roundtrip`) peut relire un flottant à un bit près ;
    // le cast `float8` de PostgreSQL arrondit correctement (constaté : 1292.5947710683595 relu …597).
    let scores: Vec<(Option<f64>, Option<f64>)> = sqlx::query_as(
        "select case when jsonb_typeof(e -> 'before' -> 'elo') = 'number' then (e -> 'before' ->> 'elo')::float8 end,
                case when jsonb_typeof(e -> 'after' -> 'elo') = 'number' then (e -> 'after' ->> 'elo')::float8 end
           from public.tier_rounds r, jsonb_array_elements(r.payload -> 'items') with ordinality as t(e, n)
          where r.id = $1 order by n",
    )
    .bind(id)
    .persistent(false)
    .fetch_all(&mut **tx)
    .await?;
    for (element, (avant, apres)) in elements.iter_mut().zip(scores) {
        for (cle, score) in [("before", avant), ("after", apres)] {
            if let (Some(etat), Some(s)) = (element.get_mut(cle).and_then(Value::as_object_mut), score) {
                etat.insert("elo".into(), json!(s));
            }
        }
    }
    let ids: Vec<i64> = elements.iter().filter_map(|e| e.get("id").and_then(js_v8::identifiant)).collect();
    let lignes = lire_lignes(&mut tx, &ids).await?;
    let Some(a_retablir) = defaire(&elements, &lignes)? else { return Ok(reponse(409, json!({ "error": "conflict" }))) };
    for (titre, etat) in &a_retablir {
        ecrire_etat(&mut tx, *titre, etat).await?;
    }
    sqlx::query("delete from public.tier_rounds where id = $1").bind(id).persistent(false).execute(&mut **tx).await?;
    tx.valider().await?;
    Ok(Json(json!({ "ok": true })).into_response())
}

/// La note d'un palier, telle que l'API la rend (`RATING_SCALE[stars]`).
pub(crate) fn note_affichee(etoiles: i16) -> &'static str {
    NOTES[etoiles as usize]
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;

    /// Un générateur de Park et Miller, celui des tests de la v1 (`seedValue * 16807 % 2147483647`).
    pub(crate) fn lehmer(graine: i64) -> impl FnMut() -> f64 {
        let mut s = graine;
        move || {
            s = (s * 16807) % 2_147_483_647;
            s as f64 / 2_147_483_647.0
        }
    }

    /// Le banc : une bibliothèque en mémoire, écrite comme le ferait la base (mêmes états).
    #[derive(Default)]
    pub(crate) struct Banc {
        pub lignes: HashMap<i64, LigneTitre>,
        pub manches: Vec<(i64, Vec<Changement>)>,
        prochain: i64,
    }

    impl Banc {
        /// `seed` : un titre vu (par défaut), noté `etoiles`, à l'état de départage neuf.
        pub(crate) fn titre(&mut self, etoiles: Option<i16>, statut: &str) -> i64 {
            self.prochain += 1;
            let id = self.prochain;
            self.lignes.insert(id, LigneTitre { id, note: etoiles, statut: Some(statut.into()), note_palier: None, elo_palier: ELO_DEPART, comparaisons: 0, groupe: None });
            id
        }
        pub(crate) fn appliquer(&mut self, changements: Vec<Changement>) -> i64 {
            for c in &changements {
                let l = self.lignes.get_mut(&c.id).unwrap();
                (l.elo_palier, l.comparaisons, l.groupe, l.note_palier) = (c.apres.elo, c.apres.count, c.apres.band, c.apres.rating);
            }
            let id = self.manches.len() as i64 + 1;
            self.manches.push((id, changements));
            id
        }
        pub(crate) fn quatuor(&mut self, ids: &[i64], etoiles: i16, meilleur: i64, pire: Option<i64>) -> Result<i64, Refus> {
            let ids: Vec<f64> = ids.iter().map(|i| *i as f64).collect();
            let c = quatuor(&ids, &self.lignes, etoiles, meilleur as f64, pire.map(|p| p as f64))?;
            Ok(self.appliquer(c))
        }
        pub(crate) fn repartir(&mut self, id: i64, etoiles: i16, groupe: i16) -> Result<i64, Refus> {
            let c = repartition(self.lignes.get(&id), etoiles, groupe)?;
            Ok(self.appliquer(vec![c]))
        }
        /// `undoRound` : `Ok(true)`, conflit `Ok(false)`, introuvable `Err(())`.
        pub(crate) fn annuler(&mut self, manche: i64) -> Result<bool, ()> {
            let i = self.manches.iter().position(|m| m.0 == manche).ok_or(())?;
            let elements: Vec<Value> = self.manches[i].1.iter().map(|c| json!({ "id": c.id, "before": c.avant.json(), "after": c.apres.json() })).collect();
            let Some(retablir) = defaire(&elements, &self.lignes).unwrap() else { return Ok(false) };
            for (id, e) in retablir {
                let l = self.lignes.get_mut(&id).unwrap();
                (l.elo_palier, l.comparaisons, l.groupe, l.note_palier) = (e.elo, e.count, e.band, e.rating);
            }
            self.manches.remove(i);
            Ok(true)
        }
        /// `tierMembers` de tous les paliers (titres vus et notés), dans l'ordre des identifiants.
        pub(crate) fn paliers(&self) -> HashMap<i16, Vec<Membre>> {
            let mut ids: Vec<&i64> = self.lignes.keys().collect();
            ids.sort();
            let mut p: HashMap<i16, Vec<Membre>> = HashMap::new();
            for id in ids {
                let l = &self.lignes[id];
                let (Some(note), Some("Watched")) = (l.note, l.statut.as_deref()) else { continue };
                let valide = l.note_palier == l.note;
                p.entry(note).or_default().push(Membre {
                    id: l.id,
                    comparaisons: if valide { l.comparaisons } else { 0 },
                    score: if valide { l.elo_palier } else { ELO_DEPART },
                    groupe: if valide { l.groupe } else { None },
                });
            }
            p
        }
    }

    fn quatuor_attendu(e: Etape) -> (Vec<Membre>, Option<i16>, Value) {
        match e {
            Etape::Quatuor { membres, groupe, portee, .. } => (membres, groupe, portee),
            autre => panic!("quatuor attendu, {autre:?}"),
        }
    }

    // ---------- classement.test.ts : « Départage (FR-3, FR-4, FR-10) » ----------

    /// AC-3 : seul le score de palier bouge (l'Elo général et la date ne sont pas dans le changement).
    #[test]
    fn ne_touche_que_le_score_de_palier() {
        let mut b = Banc::default();
        let [a, x, c, d] = [0; 4].map(|_| b.titre(Some(4), "Watched"));
        b.quatuor(&[a, x, c, d], 4, a, Some(d)).unwrap();
        assert!(b.lignes[&a].elo_palier > 1200.0);
    }

    /// AC-12 : 5 comparaisons pour un quatuor de quatre ; 3 pour un trio sans « moins bon ».
    #[test]
    fn compte_les_comparaisons_d_un_quatuor() {
        let mut b = Banc::default();
        let [a, x, c, d] = [0; 4].map(|_| b.titre(Some(4), "Watched"));
        b.quatuor(&[a, x, c, d], 4, a, Some(d)).unwrap();
        let l = |id: i64| b.lignes[&id].clone();
        assert_eq!([a, x, c, d].map(|i| l(i).comparaisons), [3, 2, 2, 3]);
        assert!(l(a).elo_palier > l(x).elo_palier);
        assert!((l(x).elo_palier - l(c).elo_palier).abs() < 5e-10);
        assert!(l(c).elo_palier > l(d).elo_palier);
        let [e, f, g] = [0; 3].map(|_| b.titre(Some(3), "Watched"));
        b.quatuor(&[e, f, g], 3, e, None).unwrap();
        assert_eq!([e, f, g].map(|i| b.lignes[&i].comparaisons), [2, 1, 1]);
    }

    /// AC-14 : annuler un quatuor rend l'état d'avant, puis la manche n'existe plus.
    #[test]
    fn annule_un_quatuor_en_entier() {
        let mut b = Banc::default();
        let ids = [0; 4].map(|_| b.titre(Some(4), "Watched"));
        let avant: Vec<LigneTitre> = ids.iter().map(|i| b.lignes[i].clone()).collect();
        let manche = b.quatuor(&ids, 4, ids[1], Some(ids[2])).unwrap();
        assert_eq!(b.annuler(manche), Ok(true));
        assert_eq!(ids.iter().map(|i| b.lignes[i].clone()).collect::<Vec<_>>(), avant);
        assert_eq!(b.annuler(manche), Err(()));
    }

    #[test]
    fn refuse_d_annuler_un_quatuor_que_d_autres_reponses_ont_suivi() {
        let mut b = Banc::default();
        let ids = [0; 4].map(|_| b.titre(Some(4), "Watched"));
        let premier = b.quatuor(&ids, 4, ids[0], Some(ids[3])).unwrap();
        b.quatuor(&ids, 4, ids[3], Some(ids[0])).unwrap();
        assert_eq!(b.annuler(premier), Ok(false));
    }

    /// AC-6 : seuls les titres du palier et de la catégorie (la catégorie est filtrée par la requête).
    #[test]
    fn ne_propose_que_des_titres_du_palier_demande() {
        let mut b = Banc::default();
        let f1 = b.titre(Some(4), "Watched");
        let f2 = b.titre(Some(4), "Watched");
        b.titre(Some(5), "Watched");
        b.titre(Some(4), "Unwatched");
        let (membres, _, portee) = quatuor_attendu(etape(&b.paliers(), 4, &mut js_v8::hasard, false));
        let mut ids: Vec<i64> = membres.iter().map(|m| m.id).collect();
        ids.sort();
        assert_eq!(ids, [f1, f2]);
        assert_eq!((portee["titles"].clone(), portee["compared"].clone(), portee["settled"].clone(), portee["banded"].clone()), (json!(2), json!(0), json!(0), json!(false)));
    }

    /// EC-1
    #[test]
    fn signale_un_palier_sans_de_quoi_departager() {
        let mut b = Banc::default();
        b.titre(Some(5), "Watched");
        assert_eq!(etape(&b.paliers(), 5, &mut js_v8::hasard, false), Etape::PasAssez(1));
        assert_eq!(etape_json(&Etape::PasAssez(1), &HashMap::new()).unwrap(), json!({ "error": "not_enough_titles", "eligibleCount": 1 }));
    }

    /// EC-2 : la note a changé entre-temps (`updateItem(b, ⭐⭐⭐⭐⭐)`).
    #[test]
    fn refuse_une_reponse_quand_la_note_a_change() {
        let mut b = Banc::default();
        let a = b.titre(Some(4), "Watched");
        let x = b.titre(Some(4), "Watched");
        b.lignes.get_mut(&x).unwrap().note = Some(5);
        assert_eq!(b.quatuor(&[a, x], 4, a, None), Err(Refus::Perime));
        assert_eq!(b.repartir(x, 4, 2), Err(Refus::Perime));
        assert_eq!(b.lignes[&a].comparaisons, 0);
    }

    // ---------- « Gros palier : répartir puis affiner (FR-8, FR-9, FR-11) » ----------

    fn gros_palier(b: &mut Banc, n: usize) -> Vec<i64> {
        (0..n).map(|_| b.titre(Some(4), "Watched")).collect()
    }

    /// AC-11
    #[test]
    fn repartit_d_abord_un_gros_palier_pas_un_petit() {
        let mut b = Banc::default();
        gros_palier(&mut b, MIN_REPARTITION);
        match etape(&b.paliers(), 4, &mut js_v8::hasard, false) {
            Etape::Repartir { portee, .. } => {
                assert_eq!((portee["banded"].clone(), portee["placed"].clone(), portee["titles"].clone()), (json!(true), json!(0), json!(MIN_REPARTITION)));
            }
            autre => panic!("répartition attendue, {autre:?}"),
        }
        for _ in 0..3 {
            b.titre(Some(3), "Watched");
        }
        quatuor_attendu(etape(&b.paliers(), 3, &mut js_v8::hasard, false));
    }

    /// AC-13 : le Haut d'abord, puis le Milieu.
    #[test]
    fn affine_le_haut_d_abord_puis_le_milieu() {
        let mut b = Banc::default();
        let ids = gros_palier(&mut b, MIN_REPARTITION);
        for (i, id) in ids.iter().enumerate() {
            b.repartir(*id, 4, (i % 3) as i16).unwrap();
        }
        let haut: Vec<i64> = ids.iter().enumerate().filter(|(i, _)| i % 3 == 2).map(|(_, id)| *id).collect();
        let (membres, groupe, _) = quatuor_attendu(etape(&b.paliers(), 4, &mut js_v8::hasard, false));
        assert_eq!(groupe, Some(2));
        assert_eq!(membres.len(), TAILLE_QUATUOR);
        assert!(membres.iter().all(|m| haut.contains(&m.id)));
        for id in &haut {
            b.lignes.get_mut(id).unwrap().comparaisons = DEPARTAGE;
        }
        let (_, groupe, _) = quatuor_attendu(etape(&b.paliers(), 4, &mut js_v8::hasard, false));
        assert_eq!(groupe, Some(1));
    }

    // ---------- « Fin du départage (FR-7) » ----------

    fn departager(b: &mut Banc, id: i64, comparaisons: i32) {
        let l = b.lignes.get_mut(&id).unwrap();
        l.comparaisons = comparaisons;
        l.note_palier = l.note;
    }

    /// AC-9
    #[test]
    fn met_toujours_en_jeu_un_titre_qui_reste_a_departager() {
        let mut b = Banc::default();
        let ids: Vec<i64> = (0..7).map(|_| b.titre(Some(4), "Watched")).collect();
        for id in &ids[..6] {
            departager(&mut b, *id, DEPARTAGE);
        }
        for _ in 0..20 {
            let (membres, _, portee) = quatuor_attendu(etape(&b.paliers(), 4, &mut js_v8::hasard, false));
            assert!(membres.iter().any(|m| m.id == ids[6]));
            assert_eq!(portee["settled"], json!(6));
        }
    }

    /// AC-10
    #[test]
    fn annonce_la_fin_du_palier_et_le_suivant_puis_affine_sur_demande() {
        let mut b = Banc::default();
        for _ in 0..3 {
            let id = b.titre(Some(4), "Watched");
            departager(&mut b, id, DEPARTAGE);
        }
        b.titre(Some(3), "Watched");
        b.titre(Some(3), "Watched");
        let fini = etape(&b.paliers(), 4, &mut js_v8::hasard, false);
        assert_eq!(
            etape_json(&fini, &HashMap::new()).unwrap(),
            json!({ "step": "done", "scope": { "titles": 3, "compared": 3, "settled": 3, "banded": false, "placed": 0 }, "nextTier": 3 })
        );
        quatuor_attendu(etape(&b.paliers(), 4, &mut js_v8::hasard, true));
    }

    #[test]
    fn rouvre_un_palier_departage_quand_un_titre_y_entre() {
        let mut b = Banc::default();
        for _ in 0..2 {
            let id = b.titre(Some(4), "Watched");
            departager(&mut b, id, DEPARTAGE);
        }
        assert!(matches!(etape(&b.paliers(), 4, &mut js_v8::hasard, false), Etape::Fini { .. }));
        b.titre(Some(4), "Watched");
        quatuor_attendu(etape(&b.paliers(), 4, &mut js_v8::hasard, false));
    }

    // ---------- « Choix des quatuors (FR-5, AC-7) » ----------

    #[derive(Clone, Debug, PartialEq)]
    struct M {
        id: i64,
        comparaisons: i32,
        score: f64,
    }

    #[test]
    fn reunit_autour_d_un_titre_ceux_qui_lui_sont_proches() {
        let mut rng = lehmer(7);
        let ancre = M { id: 1, comparaisons: 0, score: 1200.0 };
        let proches: Vec<M> = [2, 3, 4].iter().map(|&id| M { id, comparaisons: 1, score: 1200.0 + id as f64 * 5.0 }).collect();
        let loin: Vec<M> = [5, 6, 7].iter().map(|&id| M { id, comparaisons: DEPARTAGE, score: 1600.0 + id as f64 }).collect();
        let groupe: Vec<M> = std::iter::once(ancre).chain(proches.clone()).chain(loin).collect();
        let mut nb = 0;
        for _ in 0..200 {
            let q = choisir_quatuor(&groupe, |m| m.comparaisons, |m| m.score, &mut rng, true, 4);
            nb += q.iter().filter(|m| proches.contains(m)).count();
        }
        assert!(nb as f64 / 200.0 > 2.2, "{nb}");
    }

    #[test]
    fn en_duel_oppose_l_ancre_a_un_voisin_proche() {
        let mut rng = lehmer(11);
        let ancre = M { id: 1, comparaisons: 0, score: 1200.0 };
        let proche = M { id: 2, comparaisons: 0, score: 1210.0 };
        let groupe: Vec<M> = [ancre.clone(), proche.clone()].into_iter().chain([5, 6, 7].iter().map(|&id| M { id, comparaisons: DEPARTAGE, score: 1600.0 + id as f64 })).collect();
        let mut tous_deux = 0;
        for _ in 0..200 {
            let paire = choisir_quatuor(&groupe, |m| m.comparaisons, |m| m.score, &mut rng, true, TAILLE_QUATUOR);
            assert_eq!(paire.len(), TAILLE_QUATUOR);
            if paire.contains(&ancre) && paire.contains(&proche) {
                tous_deux += 1;
            }
        }
        assert!(tous_deux as f64 / 200.0 > 0.8, "{tous_deux}");
    }

    #[test]
    fn les_etoiles_se_lisent_comme_parse_stars() {
        assert_eq!(etoiles_de(Some(&json!("4"))), Some(4));
        assert_eq!(etoiles_de(Some(&json!(" 0x2 "))), Some(2));
        assert_eq!(etoiles_de(Some(&json!("  "))), Some(0));
        assert_eq!(etoiles_de(Some(&json!(""))), None);
        assert_eq!(etoiles_de(Some(&json!(null))), None);
        assert_eq!(etoiles_de(None), None);
        assert_eq!(etoiles_de(Some(&json!(true))), Some(1));
        assert_eq!(etoiles_de(Some(&json!([3]))), Some(3));
        assert_eq!(etoiles_de(Some(&json!(6))), None);
        assert_eq!(etoiles_de(Some(&json!(2.5))), None);
        assert_eq!(etoiles_de(Some(&json!("x"))), None);
        assert_eq!(groupe_de(Some(&json!(1.0))), Some(1));
        assert_eq!(groupe_de(Some(&json!("1"))), None);
        assert_eq!(groupe_de(Some(&json!(3))), None);
        assert_eq!(note_affichee(4), "⭐️⭐️⭐️⭐️");
    }

    #[test]
    fn un_quatuor_mal_forme_est_invalide() {
        let mut b = Banc::default();
        let [a, x] = [0; 2].map(|_| b.titre(Some(4), "Watched"));
        assert_eq!(b.quatuor(&[a], 4, a, None), Err(Refus::Invalide));
        assert_eq!(b.quatuor(&[a, a], 4, a, None), Err(Refus::Invalide));
        assert_eq!(b.quatuor(&[a, x], 4, 99, None), Err(Refus::Invalide));
        assert_eq!(b.quatuor(&[a, x], 4, a, Some(a)), Err(Refus::Invalide));
        assert_eq!(b.quatuor(&[a, x], 4, a, Some(99)), Err(Refus::Invalide));
        // Un identifiant non entier ne désigne aucun titre : périmé, comme en v1.
        assert_eq!(quatuor(&[a as f64, 1.5], &b.lignes, 4, a as f64, None), Err(Refus::Perime));
    }
}
