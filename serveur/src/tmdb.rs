//! TMDB : reprend src/lib/tmdb.ts, fonction par fonction, avec les mêmes champs et les mêmes cas d'échec.
//! - recherche (`searchMulti`), avec la filmographie d'une personne cherchée par son nom
//!   (`getPersonFilmography`, `mergeSearchResults`, règle de popularité ×2 de recherche-personne-v1 FR-8) ;
//! - fiche (`getDetails`, `getDetailsFr`) ;
//! - ce qu'un seul appel rapporte d'un titre (`getTitleData`) : caractéristiques du modèle de préférence,
//!   disponibilité en France, dates de sortie, bande-annonce ; et chacun seul (`getTmdbFeatures`,
//!   `getAvailability`, `getRelease`) ;
//! - découvertes (`getRecommendedFor`, `discoverReleases`, `discoverForTonight`), services en France
//!   (`listFrenchProviders`).
//!
//! Les JSON rendus (caractéristiques, disponibilité, dates, bande-annonce) ont la forme de ceux de la v1 :
//! ils sont stockés tels quels dans `catalog_titles`. Le choix de la bande-annonce et la lecture des dates
//! sont dans `bande_annonce` et `sortie` ; les dates JavaScript dans `temps`.
pub mod bande_annonce;
pub mod sortie;
pub mod temps;

use serde_json::{Map, Number, Value, json};
use std::{collections::HashMap, time::Duration};
use tokio::sync::OnceCell;

const BASE: &str = "https://api.themoviedb.org/3";
/// Préfixe des affiches (`POSTER_BASE`).
pub const AFFICHE: &str = "https://image.tmdb.org/t/p/w500";
/// Genre TMDB « Documentary », le même pour les films et les séries.
const DOCUMENTAIRE: i64 = 99;
/// Pays couvert (disponibilite-streaming-v1 OS-1 : la France seulement).
const REGION: &str = "FR";
const METIERS_PRODUCTION: [&str; 2] = ["Producer", "Executive Producer"];
/// Acteurs principaux retenus dans les caractéristiques (`FEATURES_CAST_SIZE`).
const DISTRIBUTION_RETENUE: usize = 8;
/// Producteurs retenus (`FEATURES_PRODUCERS_SIZE`).
const PRODUCTION_RETENUE: usize = 4;
/// recherche-personne-v1 FR-8 : la filmographie d'une personne n'est cherchée que si aucun titre n'est au
/// moins deux fois plus populaire qu'elle (`POPULARITY_DOMINANCE`).
const DOMINATION: f64 = 2.0;
/// Homonymes dont on cherche la filmographie, au plus.
const HOMONYMES_MAX: usize = 3;

static CLIENT: OnceCell<reqwest::Client> = OnceCell::const_new();
static GENRES: OnceCell<Genres> = OnceCell::const_new();

pub(crate) async fn client() -> &'static reqwest::Client {
    CLIENT.get_or_init(|| async { reqwest::Client::builder().timeout(Duration::from_secs(8)).build().expect("client HTTP") }).await
}

/// Un GET sur TMDB, vu comme `fetch` puis `res.json()` : `Err` si la requête échoue (réseau, délai) ou si
/// un succès n'est pas du JSON (les deux lèvent une exception en v1) ; `Ok(None)` si le statut n'est pas
/// un succès (`!res.ok`) ; `Ok(Some(corps))` sinon.
async fn appel(chemin: &str) -> Result<Option<Value>, ()> {
    let mut requete = client().await.get(format!("{BASE}{chemin}")).header("accept", "application/json");
    if let Ok(jeton) = std::env::var("TMDB_ACCESS_TOKEN") {
        requete = requete.bearer_auth(jeton);
    }
    let reponse = requete.send().await.map_err(|_| ())?;
    if !reponse.status().is_success() {
        return Ok(None);
    }
    reponse.json::<Value>().await.map(Some).map_err(|_| ())
}

/// `res.ok ? await res.json() : null`, toute erreur donnant aussi `None`.
async fn get(chemin: &str) -> Option<Value> {
    appel(chemin).await.ok().flatten()
}

/// `encodeURIComponent` : tout sauf les lettres et chiffres ASCII et `-_.!~*'()`.
pub(crate) fn encoder_composant(texte: &str) -> String {
    texte.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect()
}

/// `URLSearchParams.toString()` : encodage de formulaire (espace en « + », tout sauf `*-._` et
/// alphanumériques encodé), paramètres dans l'ordre donné.
fn encoder_formulaire(parametres: &[(&str, String)]) -> String {
    let encoder = |t: &str| -> String {
        t.bytes()
            .map(|b| match b {
                b' ' => "+".to_owned(),
                b if b.is_ascii_alphanumeric() || b"*-._".contains(&b) => (b as char).to_string(),
                b => format!("%{b:02X}"),
            })
            .collect()
    };
    parametres.iter().map(|(k, v)| format!("{}={}", encoder(k), encoder(v))).collect::<Vec<_>>().join("&")
}

/// `Number(texte)` de JavaScript : blancs ignorés, vide = 0, décimal, exposant, hexadécimal, octal, binaire,
/// « Infinity » ; NaN sinon.
pub fn nombre_js(texte: &str) -> f64 {
    let t = texte.trim();
    if t.is_empty() {
        return 0.0;
    }
    for (prefixe, base) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
        if let Some(reste) = t.strip_prefix(prefixe) {
            return if !reste.is_empty() && reste.chars().all(|c| c.is_digit(base)) {
                reste.chars().fold(0.0, |n, c| n * f64::from(base) + f64::from(c.to_digit(base).unwrap_or(0)))
            } else {
                f64::NAN
            };
        }
    }
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    // Rust accepterait « inf » et « nan », pas JavaScript : seuls chiffres, signe, point et exposant.
    if !t.bytes().all(|b| b.is_ascii_digit() || b"+-.eE".contains(&b)) {
        return f64::NAN;
    }
    t.parse::<f64>().unwrap_or(f64::NAN)
}

/// Un nombre JavaScript tel que `String(n)` l'écrit (entiers sans « .0 »).
pub fn texte_nombre_js(n: f64) -> String {
    if n.is_nan() {
        "NaN".into()
    } else if n.is_infinite() {
        if n > 0.0 { "Infinity".into() } else { "-Infinity".into() }
    } else if n == n.trunc() && n.abs() < 1e21 {
        format!("{}", n as i128)
    } else {
        format!("{n}")
    }
}

/// Un nombre JavaScript tel que `JSON.stringify` l'écrit : entier sans « .0 », `null` s'il n'est pas fini.
pub fn json_nombre_js(n: f64) -> Value {
    if !n.is_finite() {
        Value::Null
    } else if n == n.trunc() && n.abs() < 9.0e15 {
        json!(n as i64)
    } else {
        json!(n)
    }
}

/// `typeof x === "number" ? x : null`.
fn nombre(v: Option<&Value>) -> Option<Number> {
    match v {
        Some(Value::Number(n)) => Some(n.clone()),
        _ => None,
    }
}

/// `dateStr ? dateStr.slice(0, 4) : null`.
fn annee(date: Option<&Value>) -> Option<String> {
    let d = date?.as_str().filter(|d| !d.is_empty())?;
    Some(d.chars().take(4).collect())
}

/// Le tableau d'une valeur, ou rien (`x ?? []`, `Array.isArray(x) ? x : []`).
fn tableau(v: Option<&Value>) -> &[Value] {
    v.and_then(Value::as_array).map(Vec::as_slice).unwrap_or_default()
}

// ---------- genres ----------

/// Dictionnaires id → nom des genres TMDB, distincts pour les films et les séries.
#[derive(Default)]
pub struct Genres {
    pub film: HashMap<i64, String>,
    pub serie: HashMap<i64, String>,
}

impl Genres {
    fn de(&self, type_: &str) -> &HashMap<i64, String> {
        if type_ == "Movie" { &self.film } else { &self.serie }
    }

    /// `resolveGenreNames` : les noms connus, dans l'ordre des identifiants.
    fn noms(&self, type_: &str, ids: &[Value]) -> Vec<String> {
        let dico = self.de(type_);
        ids.iter().filter_map(|i| dico.get(&i.as_i64()?)).filter(|n| !n.is_empty()).cloned().collect()
    }

    /// `genreIdByName` : le premier identifiant (ordre croissant, celui d'`Object.entries`) qui porte ce nom.
    fn identifiant(&self, type_: &str, nom: &str) -> Option<i64> {
        self.de(type_).iter().filter(|(_, n)| n.as_str() == nom).map(|(i, _)| *i).min()
    }
}

/// `getGenreMaps` : gardés en mémoire le temps du processus, même vides si TMDB a échoué (comme la v1).
pub async fn genres() -> &'static Genres {
    GENRES
        .get_or_init(|| async {
            let liste = |v: Option<Value>| -> HashMap<i64, String> {
                let mut dico = HashMap::new();
                for g in tableau(v.as_ref().and_then(|v| v.get("genres"))) {
                    if let (Some(id), Some(nom)) = (g.get("id").and_then(Value::as_i64), g.get("name").and_then(Value::as_str)) {
                        dico.insert(id, nom.to_owned());
                    }
                }
                dico
            };
            let (film, serie) = tokio::join!(get("/genre/movie/list"), get("/genre/tv/list"));
            Genres { film: liste(film), serie: liste(serie) }
        })
        .await
}

// ---------- recherche ----------

/// Rôle d'une personne sur un titre (`PersonRole`).
pub type Role = &'static str;

/// `personCredit` : la personne cherchée par son nom et tous ses rôles sur ce titre.
#[derive(Clone, Debug, PartialEq)]
pub struct Credit {
    /// Le nom tel que TMDB le donne ; `None` s'il manque (la clé disparaît alors du JSON, comme en v1).
    pub nom: Option<Value>,
    pub roles: Vec<Role>,
}

impl Credit {
    pub fn json(&self) -> Value {
        let mut m = Map::new();
        if let Some(nom) = &self.nom {
            m.insert("name".into(), nom.clone());
        }
        m.insert("roles".into(), json!(self.roles));
        Value::Object(m)
    }
}

/// Un résultat de recherche ou de découverte (`TmdbSearchResult`).
#[derive(Clone, Debug, PartialEq)]
pub struct Resultat {
    pub tmdb_id: i64,
    pub type_: &'static str,
    pub documentaire: bool,
    pub genres: Vec<String>,
    pub titre: String,
    pub annee: Option<String>,
    /// Chemin brut de l'affiche (`posterPath`).
    pub affiche: Option<String>,
    pub note: Option<Number>,
    /// Nombre de votes : la notoriété (`voteCount`).
    pub votes: Option<Number>,
    pub synopsis: String,
    pub credit: Option<Credit>,
}

/// `posterUrl` : l'adresse de l'affiche, `None` sans chemin (ou chemin vide).
pub fn adresse_affiche(chemin: Option<&str>) -> Option<String> {
    chemin.filter(|c| !c.is_empty()).map(|c| format!("{AFFICHE}{c}"))
}

/// `rowToResult` : une ligne de recherche, de découverte ou de crédits, d'un type connu. `None` sans titre.
fn resultat(r: &Value, type_: &'static str, genres: &Genres, credit: Option<Credit>) -> Option<Resultat> {
    let est_film = type_ == "Movie";
    let titre = r.get(if est_film { "title" } else { "name" }).and_then(Value::as_str).filter(|t| !t.is_empty())?;
    let ids = tableau(r.get("genre_ids"));
    Some(Resultat {
        tmdb_id: r.get("id").and_then(Value::as_i64)?,
        type_,
        documentaire: ids.iter().any(|i| i.as_i64() == Some(DOCUMENTAIRE)),
        genres: genres.noms(type_, ids),
        titre: titre.to_owned(),
        annee: annee(r.get(if est_film { "release_date" } else { "first_air_date" })),
        affiche: r.get("poster_path").and_then(Value::as_str).map(str::to_owned),
        note: nombre(r.get("vote_average")),
        votes: nombre(r.get("vote_count")),
        synopsis: r.get("overview").and_then(Value::as_str).unwrap_or_default().to_owned(),
        credit,
    })
}

/// `toSearchResult` : seulement les films et les séries.
fn resultat_recherche(r: &Value, genres: &Genres) -> Option<Resultat> {
    let type_ = match r.get("media_type")?.as_str()? {
        "movie" => "Movie",
        "tv" => "TV Series",
        _ => return None,
    };
    resultat(r, type_, genres, None)
}

/// `mergeSearchResults` : un même titre (type et numéro) n'apparaît qu'une fois, à sa première place ;
/// ses rôles s'ajoutent (recherche-personne-v1 FR-5 : aucun rôle n'est supprimé en silence).
pub fn fusionner(resultats: Vec<Resultat>) -> Vec<Resultat> {
    let mut sortie: Vec<Resultat> = Vec::with_capacity(resultats.len());
    let mut place: HashMap<(&'static str, i64), usize> = HashMap::new();
    for r in resultats {
        match place.get(&(r.type_, r.tmdb_id)) {
            None => {
                place.insert((r.type_, r.tmdb_id), sortie.len());
                sortie.push(r);
            }
            Some(&i) => {
                let Some(credit) = r.credit else { continue };
                match &mut sortie[i].credit {
                    None => sortie[i].credit = Some(credit),
                    Some(existant) => {
                        for role in credit.roles {
                            if !existant.roles.contains(&role) {
                                existant.roles.push(role);
                            }
                        }
                    }
                }
            }
        }
    }
    sortie
}

/// Les personnes dont on cherche la filmographie (au plus trois) : un résultat `person` dont la popularité
/// atteint la moitié de celle du titre le plus populaire (recherche-personne-v1 FR-8). Identifiant et nom.
pub fn personnes_a_suivre(lignes: &[Value]) -> Vec<(Option<Value>, Option<Value>)> {
    let media = |r: &Value| r.get("media_type").and_then(Value::as_str).map(str::to_owned);
    let meilleur = lignes
        .iter()
        .filter(|r| matches!(media(r).as_deref(), Some("movie" | "tv")))
        .map(|r| r.get("popularity").and_then(Value::as_f64).unwrap_or(0.0))
        .fold(0.0_f64, f64::max);
    lignes
        .iter()
        .filter(|r| media(r).as_deref() == Some("person") && r.get("popularity").and_then(Value::as_f64).is_some_and(|p| p * DOMINATION >= meilleur))
        .take(HOMONYMES_MAX)
        .map(|r| (r.get("id").cloned(), r.get("name").cloned()))
        .collect()
}

/// `getPersonFilmography` : réalisateur, producteur et acteur, films puis séries. Vide si l'un des deux
/// appels échoue au réseau ou rend autre chose que du JSON ; une réponse en erreur est seulement sautée.
async fn filmographie(id: Option<&Value>, nom: Option<Value>, genres: &Genres) -> Vec<Resultat> {
    let id = match id {
        Some(Value::Number(n)) => n.to_string(),
        Some(Value::String(s)) => s.clone(),
        _ => "undefined".into(),
    };
    let (chemin_films, chemin_series) = (format!("/person/{id}/movie_credits"), format!("/person/{id}/tv_credits"));
    let (films, series) = tokio::join!(appel(&chemin_films), appel(&chemin_series));
    let (Ok(films), Ok(series)) = (films, series) else { return vec![] };
    let mut sortie = vec![];
    for (donnees, type_) in [(films, "Movie"), (series, "TV Series")] {
        let Some(donnees) = donnees else { continue };
        let equipe = tableau(donnees.get("crew"));
        let metier = |c: &&Value| c.get("job").and_then(Value::as_str).map(str::to_owned);
        let credit = |role: Role| Some(Credit { nom: nom.clone(), roles: vec![role] });
        sortie.extend(equipe.iter().filter(|c| metier(c).as_deref() == Some("Director")).filter_map(|c| resultat(c, type_, genres, credit("director"))));
        sortie.extend(equipe.iter().filter(|c| metier(c).is_some_and(|m| METIERS_PRODUCTION.contains(&m.as_str()))).filter_map(|c| resultat(c, type_, genres, credit("producer"))));
        sortie.extend(tableau(donnees.get("cast")).iter().filter_map(|c| resultat(c, type_, genres, credit("actor"))));
    }
    sortie
}

/// `searchMulti` : films et séries par titre, paginés ; sur la page 1, la filmographie des personnes
/// cherchées par leur nom (FR-8). `page` est le nombre que la route a lu (`Number(...) || 1`). Rend les
/// résultats et le nombre de pages (`total_pages`, 1 s'il manque) ; rien en cas d'erreur.
pub async fn rechercher(requete: &str, page: f64) -> (Vec<Resultat>, Value) {
    let vide = (vec![], json!(0));
    if requete.trim().is_empty() {
        return vide;
    }
    let chemin = format!("/search/multi?query={}&include_adult=false&page={}&language=fr-FR", encoder_composant(requete), texte_nombre_js(page));
    let (reponse, genres) = tokio::join!(appel(&chemin), genres());
    let Ok(Some(donnees)) = reponse else { return vide };
    let Some(lignes) = donnees.get("results").and_then(Value::as_array) else { return vide };
    let total_pages = donnees.get("total_pages").filter(|t| t.is_number()).cloned().unwrap_or(json!(1));

    let mut resultats: Vec<Resultat> = lignes.iter().filter_map(|r| resultat_recherche(r, genres)).collect();
    if page == 1.0 {
        // `Promise.all` : les filmographies en parallèle, gardées dans l'ordre des personnes.
        let taches: Vec<_> = personnes_a_suivre(lignes).into_iter().map(|(id, nom)| tokio::spawn(async move { filmographie(id.as_ref(), nom, genres).await })).collect();
        for tache in taches {
            resultats.extend(tache.await.unwrap_or_default());
        }
    }
    (fusionner(resultats), total_pages)
}

// ---------- fiche ----------

/// `TmdbDetails` : ce qu'il faut pour créer un titre (genres et réalisation en anglais, comme la base).
#[derive(Clone, Debug)]
pub struct Details {
    pub tmdb_id: i64,
    pub type_: &'static str,
    pub titre: String,
    pub annee: Option<String>,
    pub affiche: Option<String>,
    pub note: Option<Number>,
    pub votes: Option<Number>,
    pub imdb_id: Option<String>,
    /// Les noms des genres (`g.name`, `null` s'il manque).
    pub genres: Vec<Value>,
    pub realisation: Option<String>,
}

fn type_tmdb(type_: &str) -> (&'static str, &'static str) {
    if type_ == "Movie" { ("movie", "Movie") } else { ("tv", "TV Series") }
}

/// Texte d'une valeur comme `Array.prototype.join` l'écrit (`null` et absent : vide).
fn texte_join(v: Option<&Value>) -> String {
    match v {
        None | Some(Value::Null) => String::new(),
        Some(Value::String(s)) => s.clone(),
        Some(autre) => autre.to_string(),
    }
}

/// `getDetails` : `None` si TMDB échoue ou si le titre manque (EC-4).
pub async fn details(tmdb_id: i64, type_: &str) -> Option<Details> {
    let (chemin, type_) = type_tmdb(type_);
    let d = get(&format!("/{chemin}/{tmdb_id}?append_to_response=external_ids,credits")).await?;
    let est_film = type_ == "Movie";
    let titre = d.get(if est_film { "title" } else { "name" }).and_then(Value::as_str).filter(|t| !t.is_empty())?.to_owned();
    let realisation = if est_film {
        tableau(d.pointer("/credits/crew")).iter().find(|c| c.get("job").and_then(Value::as_str) == Some("Director")).and_then(|c| c.get("name")).and_then(Value::as_str).map(str::to_owned)
    } else {
        let noms = tableau(d.get("created_by")).iter().map(|c| texte_join(c.get("name"))).collect::<Vec<_>>().join(", ");
        (!noms.is_empty()).then_some(noms)
    };
    Some(Details {
        tmdb_id: d.get("id").and_then(Value::as_i64).unwrap_or(tmdb_id),
        type_,
        titre,
        annee: annee(d.get(if est_film { "release_date" } else { "first_air_date" })),
        affiche: d.get("poster_path").and_then(Value::as_str).map(str::to_owned),
        note: nombre(d.get("vote_average")),
        votes: nombre(d.get("vote_count")),
        imdb_id: d.pointer("/external_ids/imdb_id").and_then(Value::as_str).map(str::to_owned),
        genres: tableau(d.get("genres")).iter().map(|g| g.get("name").cloned().unwrap_or(Value::Null)).collect(),
        realisation,
    })
}

/// `TmdbDetailsFr` : titre et synopsis en français, note et nombre de votes du même appel.
#[derive(Clone, Debug)]
pub struct DetailsFr {
    /// Titre localisé, sinon d'origine ; vide s'il manque.
    pub titre: String,
    /// Vide si TMDB n'a pas de traduction (pas la peine de retenter).
    pub synopsis: String,
    pub note: Option<Number>,
    pub votes: Option<Number>,
}

/// `getDetailsFr` : `None` en cas d'échec réseau ou d'API (à retenter).
pub async fn details_fr(tmdb_id: i64, type_: &str) -> Option<DetailsFr> {
    let (chemin, type_) = type_tmdb(type_);
    let d = get(&format!("/{chemin}/{tmdb_id}?language=fr-FR")).await?;
    Some(DetailsFr {
        titre: d.get(if type_ == "Movie" { "title" } else { "name" }).and_then(Value::as_str).unwrap_or_default().to_owned(),
        synopsis: d.get("overview").and_then(Value::as_str).unwrap_or_default().to_owned(),
        note: nombre(d.get("vote_average")),
        votes: nombre(d.get("vote_count")),
    })
}

// ---------- caractéristiques du modèle de préférence ----------

/// `toPerson` : identifiant, nom et photo (une clé absente de TMDB reste absente, comme avec JSON.stringify).
fn personne(brut: &Value) -> Value {
    let mut m = Map::new();
    for (cle, source) in [("id", "id"), ("name", "name")] {
        if let Some(v) = brut.get(source) {
            m.insert(cle.into(), v.clone());
        }
    }
    m.insert("profilePath".into(), brut.get("profile_path").cloned().unwrap_or(Value::Null));
    Value::Object(m)
}

/// `x ?? null` : la valeur telle quelle, `null` si elle manque.
fn ou_null(v: Option<&Value>) -> Value {
    v.cloned().unwrap_or(Value::Null)
}

/// `parseFeatures` : tout ce que le modèle de préférence sait d'un titre (`TmdbFeatures`), lu dans une
/// fiche enrichie de `keywords` et des crédits (`credits` d'un film, `aggregate_credits` d'une série).
pub fn caracteristiques(d: &Value, est_film: bool) -> Value {
    let mots_cles = tableau(d.pointer(if est_film { "/keywords/keywords" } else { "/keywords/results" }));
    let credits = if est_film { d.get("credits") } else { d.get("aggregate_credits") };
    let distribution = tableau(credits.and_then(|c| c.get("cast")));
    let equipe = tableau(credits.and_then(|c| c.get("crew")));
    let metier = |c: &Value, m: &str| c.get("job").and_then(Value::as_str) == Some(m);
    let realisation: Vec<Value> = if est_film { equipe.iter().filter(|c| metier(c, "Director")).map(personne).collect() } else { tableau(d.get("created_by")).iter().map(personne).collect() };
    // Séries : les crédits agrégés listent les métiers dans `jobs`, sur toute la série.
    let production: Vec<Value> = if est_film {
        equipe.iter().filter(|c| metier(c, "Producer")).take(PRODUCTION_RETENUE).map(personne).collect()
    } else {
        equipe.iter().filter(|c| tableau(c.get("jobs")).iter().any(|j| metier(j, "Executive Producer"))).take(PRODUCTION_RETENUE).map(personne).collect()
    };
    let date = d.get(if est_film { "release_date" } else { "first_air_date" }).and_then(Value::as_str).filter(|s| !s.is_empty());
    let annee = date.map(|s| nombre_js(&s.chars().take(4).collect::<String>())).filter(|n| !n.is_nan() && *n != 0.0).map(json_nombre_js).unwrap_or(Value::Null);
    let duree = if est_film { ou_null(d.get("runtime")) } else { ou_null(tableau(d.get("episode_run_time")).first()) };
    let pays = if est_film {
        Value::Array(tableau(d.get("production_countries")).iter().map(|c| ou_null(c.get("iso_3166_1"))).collect())
    } else {
        d.get("origin_country").filter(|v| !v.is_null()).cloned().unwrap_or(json!([]))
    };
    json!({
        "genres": tableau(d.get("genres")).iter().map(|g| ou_null(g.get("name"))).collect::<Vec<_>>(),
        "keywords": mots_cles.iter().map(|k| ou_null(k.get("name"))).collect::<Vec<_>>(),
        "cast": distribution.iter().take(DISTRIBUTION_RETENUE).map(personne).collect::<Vec<_>>(),
        "directors": realisation,
        "producers": production,
        "year": annee,
        "runtime": duree,
        "language": ou_null(d.get("original_language")),
        "countries": pays,
        "voteAverage": nombre(d.get("vote_average")),
        "voteCount": nombre(d.get("vote_count")),
        "popularity": nombre(d.get("popularity")),
    })
}

/// `getTmdbFeatures` : les caractéristiques seules. `None` en cas d'échec : l'appelant garde ce qu'il avait.
pub async fn caracteristiques_seules(tmdb_id: i64, type_: &str) -> Option<Value> {
    let est_film = type_ == "Movie";
    let chemin = if est_film { format!("/movie/{tmdb_id}?append_to_response=keywords,credits") } else { format!("/tv/{tmdb_id}?append_to_response=keywords,aggregate_credits") };
    Some(caracteristiques(&get(&chemin).await?, est_film))
}

// ---------- disponibilité en France ----------

/// `toProviders` : identifiant, nom et logo de chaque service.
fn services(brut: Option<&Value>) -> Value {
    Value::Array(
        tableau(brut)
            .iter()
            .map(|p| {
                let mut m = Map::new();
                for (cle, source) in [("id", "provider_id"), ("name", "provider_name")] {
                    if let Some(v) = p.get(source) {
                        m.insert(cle.into(), v.clone());
                    }
                }
                m.insert("logoPath".into(), p.get("logo_path").cloned().unwrap_or(Value::Null));
                Value::Object(m)
            })
            .collect(),
    )
}

/// `parseAvailability` : où voir un titre en France, d'après le bloc `watch/providers` (source JustWatch).
pub fn disponibilite(bloc: Option<&Value>, maintenant: &str) -> Value {
    let fr = bloc.and_then(|b| b.get("results")).and_then(|r| r.get(REGION));
    let champ = |cle: &str| fr.and_then(|f| f.get(cle));
    json!({
        "link": champ("link").filter(|l| !l.is_null()).cloned().unwrap_or(Value::Null),
        "flatrate": services(champ("flatrate")),
        "free": services(champ("free")),
        "ads": services(champ("ads")),
        "rent": services(champ("rent")),
        "buy": services(champ("buy")),
        "fetchedAt": maintenant,
    })
}

/// `getAvailability` : la disponibilité seule. `None` si TMDB échoue (on garde la précédente, EC-3).
pub async fn disponibilite_seule(tmdb_id: i64, type_: &str) -> Option<Value> {
    let (chemin, _) = type_tmdb(type_);
    let d = get(&format!("/{chemin}/{tmdb_id}/watch/providers")).await?;
    Some(disponibilite(Some(&d), &temps::maintenant_iso()))
}

// ---------- tout un titre en un appel ----------

/// `TitleData` : caractéristiques, disponibilité, dates de sortie et bande-annonce (`TrailerInfo` :
/// `{ trailer, fetchedAt }`), d'un seul appel TMDB.
#[derive(Clone, Debug)]
pub struct DonneesTitre {
    pub caracteristiques: Value,
    pub disponibilite: Value,
    pub sortie: Value,
    pub bande_annonce: Value,
}

/// `getTitleData` : ce qui permet d'avoir tout cela à la création, au rafraîchissement et dans la
/// découverte sans requête de plus. `None` si TMDB échoue.
pub async fn donnees_titre(tmdb_id: i64, type_: &str) -> Option<DonneesTitre> {
    let est_film = type_ == "Movie";
    let videos = format!("include_video_language={}", bande_annonce::LANGUES_VIDEOS);
    let chemin = if est_film {
        format!("/movie/{tmdb_id}?append_to_response=keywords,credits,watch/providers,release_dates,videos&{videos}")
    } else {
        format!("/tv/{tmdb_id}?append_to_response=keywords,aggregate_credits,watch/providers,videos&{videos}")
    };
    let d = get(&chemin).await?;
    let caracteristiques = caracteristiques(&d, est_film);
    let disponibilite = disponibilite(d.get("watch/providers"), &temps::maintenant_iso());
    let sortie = sortie::depuis_tmdb(&d, est_film, &temps::maintenant_iso());
    // FR-8 : la meilleure bande-annonce que l'app peut lire elle-même.
    let choisie = bande_annonce::choisir(&bande_annonce::classer(d.pointer("/videos/results")), bande_annonce::verifier_youtube).await;
    Some(DonneesTitre { caracteristiques, disponibilite, sortie, bande_annonce: json!({ "trailer": choisie, "fetchedAt": temps::maintenant_iso() }) })
}

/// `getRelease` : les dates de sortie seules (rafraîchissement par lots du calendrier). `None` si TMDB échoue.
pub async fn sortie_seule(tmdb_id: i64, type_: &str) -> Option<Value> {
    let est_film = type_ == "Movie";
    let chemin = if est_film { format!("/movie/{tmdb_id}?append_to_response=release_dates") } else { format!("/tv/{tmdb_id}") };
    Some(sortie::depuis_tmdb(&get(&chemin).await?, est_film, &temps::maintenant_iso()))
}

// ---------- découvertes ----------

/// `listTmdb` (vitrine de l'accueil) : une liste TMDB telle que TMDB la classe, en français. `type_`
/// `None` : liste mêlant films et séries (`media_type` sur chaque ligne). Vide en cas d'échec.
pub async fn liste(chemin: &str, parametres: &[(&str, String)], type_: Option<&'static str>) -> Vec<Resultat> {
    let mut p: Vec<(&str, String)> = vec![("language", "fr-FR".into()), ("include_adult", "false".into())];
    p.extend(parametres.iter().cloned());
    let adresse = format!("{chemin}?{}", encoder_formulaire(&p));
    let (reponse, genres) = tokio::join!(get(&adresse), genres());
    let Some(lignes) = reponse.as_ref().and_then(|r| r.get("results")).and_then(Value::as_array) else { return vec![] };
    lignes
        .iter()
        .filter_map(|r| match type_ {
            Some(t) => resultat(r, t, genres, None),
            None => resultat_recherche(r, genres),
        })
        .collect()
}

/// `getRecommendedFor` : titres proches d'un titre selon TMDB (`/recommendations`), en français ; le type
/// de chaque ligne vient de son `media_type`. Vide en cas d'échec.
pub async fn recommandes_pour(tmdb_id: i64, type_: &str) -> Vec<Resultat> {
    let (chemin, _) = type_tmdb(type_);
    let adresse = format!("/{chemin}/{tmdb_id}/recommendations?language=fr-FR&page=1");
    let (reponse, genres) = tokio::join!(get(&adresse), genres());
    let Some(lignes) = reponse.as_ref().and_then(|r| r.get("results")).and_then(Value::as_array) else { return vec![] };
    lignes
        .iter()
        .filter_map(|r| resultat(r, if r.get("media_type").and_then(Value::as_str) == Some("tv") { "TV Series" } else { "Movie" }, genres, None))
        .collect()
}

/// `discoverReleases` : titres qui sortent sur une période, les plus populaires d'abord. Films : sorties
/// en salle en France ; séries : premières diffusions, ou (`en_diffusion`) séries qui diffusent sur la période.
pub async fn sorties_de(type_: &str, du: &str, au: &str, page: i64, en_diffusion: bool) -> Vec<Resultat> {
    let (chemin, type_) = type_tmdb(type_);
    let mut p: Vec<(&str, String)> = vec![("sort_by", "popularity.desc".into()), ("page", page.to_string()), ("include_adult", "false".into()), ("language", "fr-FR".into())];
    if type_ == "Movie" {
        p.extend([("region", REGION.into()), ("with_release_type", "2|3".into()), ("release_date.gte", du.into()), ("release_date.lte", au.into())]);
    } else if en_diffusion {
        p.extend([("air_date.gte", du.into()), ("air_date.lte", au.into())]);
    } else {
        p.extend([("first_air_date.gte", du.into()), ("first_air_date.lte", au.into()), ("include_null_first_air_dates", "false".into())]);
    }
    let adresse = format!("/discover/{chemin}?{}", encoder_formulaire(&p));
    let (reponse, genres) = tokio::join!(get(&adresse), genres());
    let Some(lignes) = reponse.as_ref().and_then(|r| r.get("results")).and_then(Value::as_array) else { return vec![] };
    lignes.iter().filter_map(|r| resultat(r, type_, genres, None)).collect()
}

/// Options de `discoverForTonight`.
pub struct OptionsCeSoir<'a> {
    /// Genres de l'envie (tous si `None`).
    pub genres: Option<&'a [String]>,
    pub duree_max: Option<i64>,
    /// Services où le titre doit être inclus en France (tous si `None`).
    pub services: Option<&'a [i64]>,
    pub page: i64,
}

/// `discoverForTonight` : titres populaires (au moins 150 votes) d'un des genres, d'une durée maximale
/// (films), inclus chez l'un des services. Le filtrage exact reste fait par l'appelant.
pub async fn decouvrir_ce_soir(type_: &str, options: OptionsCeSoir<'_>) -> Vec<Resultat> {
    let genres = genres().await;
    let (chemin, type_) = type_tmdb(type_);
    let mut p: Vec<(&str, String)> =
        vec![("sort_by", "popularity.desc".into()), ("page", options.page.to_string()), ("include_adult", "false".into()), ("language", "fr-FR".into()), ("vote_count.gte", "150".into())];
    if let Some(noms) = options.genres {
        let ids: Vec<String> = noms.iter().filter_map(|n| genres.identifiant(type_, n)).map(|i| i.to_string()).collect();
        // Aucun genre de cette envie n'existe pour ce média : rien à chercher de ce côté.
        if ids.is_empty() {
            return vec![];
        }
        p.push(("with_genres", ids.join("|")));
    }
    if let (true, Some(max)) = (type_ == "Movie", options.duree_max) {
        p.push(("with_runtime.lte", max.to_string()));
    }
    if let Some(ids) = options.services.filter(|s| !s.is_empty()) {
        p.push(("watch_region", REGION.into()));
        p.push(("with_watch_providers", ids.iter().map(i64::to_string).collect::<Vec<_>>().join("|")));
        p.push(("with_watch_monetization_types", "flatrate|free|ads".into()));
    }
    let Some(reponse) = get(&format!("/discover/{chemin}?{}", encoder_formulaire(&p))).await else { return vec![] };
    let Some(lignes) = reponse.get("results").and_then(Value::as_array) else { return vec![] };
    lignes.iter().filter_map(|r| resultat(r, type_, genres, None)).collect()
}

// ---------- services en France ----------

static FOURNISSEURS: tokio::sync::RwLock<Option<(Vec<Value>, std::time::Instant)>> = tokio::sync::RwLock::const_new(None);

/// `listFrenchProviders` : services disponibles en France, films et séries confondus, du plus au moins
/// populaire (ordre d'affichage TMDB pour la France), gardés en mémoire une journée.
pub async fn fournisseurs_fr() -> Vec<Value> {
    if let Some((liste, quand)) = FOURNISSEURS.read().await.as_ref()
        && quand.elapsed() < Duration::from_secs(24 * 60 * 60)
    {
        return liste.clone();
    }
    let (films, series) = tokio::join!(get("/watch/providers/movie?watch_region=FR&language=fr-FR"), get("/watch/providers/tv?watch_region=FR&language=fr-FR"));
    if films.is_none() && series.is_none() {
        return FOURNISSEURS.read().await.as_ref().map(|(l, _)| l.clone()).unwrap_or_default();
    }
    // id -> (fournisseur, priorité) ; on garde la meilleure priorité.
    let mut par_id: Vec<(i64, Value, i64)> = vec![];
    for brut in [films, series].into_iter().flatten().filter_map(|v| v.get("results").and_then(Value::as_array).cloned()).flatten() {
        let Some(id) = brut.get("provider_id").and_then(Value::as_i64) else { continue };
        let priorite = brut.pointer("/display_priorities/FR").and_then(Value::as_i64).or_else(|| brut.get("display_priority").and_then(Value::as_i64)).unwrap_or(999);
        let fournisseur = json!({ "id": id, "name": brut.get("provider_name").and_then(Value::as_str).unwrap_or_default(), "logoPath": brut.get("logo_path").cloned().filter(|v| !v.is_null()) });
        match par_id.iter_mut().find(|e| e.0 == id) {
            Some(e) if e.2 > priorite => {
                e.1 = fournisseur;
                e.2 = priorite;
            }
            Some(_) => {}
            None => par_id.push((id, fournisseur, priorite)),
        }
    }
    par_id.sort_by_key(|e| e.2); // tri stable, comme Array.prototype.sort
    let liste: Vec<Value> = par_id.into_iter().map(|e| e.1).collect();
    *FOURNISSEURS.write().await = Some((liste.clone(), std::time::Instant::now()));
    liste
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(type_: &'static str, tmdb_id: i64, roles: Option<&[Role]>) -> Resultat {
        Resultat {
            tmdb_id,
            type_,
            documentaire: false,
            genres: vec![],
            titre: format!("{type_} {tmdb_id}"),
            annee: None,
            affiche: None,
            note: None,
            votes: None,
            synopsis: String::new(),
            credit: roles.map(|r| Credit { nom: Some(json!("Clint Eastwood")), roles: r.to_vec() }),
        }
    }

    #[test]
    fn la_fusion_garde_la_premiere_place_et_tous_les_roles() {
        let fusion = fusionner(vec![
            r("Movie", 1, None),
            r("TV Series", 1, None),
            r("Movie", 2, Some(&["director"])),
            r("Movie", 1, Some(&["actor"])),
            r("Movie", 2, Some(&["producer"])),
            r("Movie", 2, Some(&["director"])),
        ]);
        assert_eq!(fusion.iter().map(|x| (x.type_, x.tmdb_id)).collect::<Vec<_>>(), [("Movie", 1), ("TV Series", 1), ("Movie", 2)]);
        assert_eq!(fusion[0].credit.as_ref().unwrap().roles, ["actor"]);
        assert_eq!(fusion[1].credit, None);
        assert_eq!(fusion[2].credit.as_ref().unwrap().roles, ["director", "producer"]);
    }

    #[test]
    fn une_personne_n_est_suivie_que_si_aucun_titre_ne_la_domine_deux_fois() {
        // « Fjord » (recherche-personne-v1 FR-8) : titre 8.0, personnes 0.6 : aucune filmographie.
        let fjord = vec![json!({ "media_type": "movie", "popularity": 8.0 }), json!({ "media_type": "person", "id": 1, "popularity": 0.6 })];
        assert!(personnes_a_suivre(&fjord).is_empty());
        // « Dupieux » : titre 1.24, personne 1.17 : la filmographie est gardée.
        let dupieux = vec![json!({ "media_type": "movie", "popularity": 1.24 }), json!({ "media_type": "person", "id": 2, "name": "Quentin Dupieux", "popularity": 1.17 })];
        assert_eq!(personnes_a_suivre(&dupieux), [(Some(json!(2)), Some(json!("Quentin Dupieux")))]);
        // Au plus trois homonymes, et pas une personne sans popularité.
        let foule: Vec<Value> = (0..5).map(|i| json!({ "media_type": "person", "id": i, "popularity": 1.0 })).chain([json!({ "media_type": "person", "id": 9 })]).collect();
        assert_eq!(personnes_a_suivre(&foule).len(), 3);
        // Exactement le double : la personne est encore suivie (>=).
        assert_eq!(personnes_a_suivre(&[json!({ "media_type": "tv", "popularity": 4.0 }), json!({ "media_type": "person", "id": 3, "popularity": 2.0 })]).len(), 1);
    }

    #[test]
    fn les_caracteristiques_ont_la_forme_de_la_v1() {
        let film = json!({
            "genres": [{ "name": "Action" }], "keywords": { "keywords": [{ "name": "simulated reality" }] },
            "credits": { "cast": (0..10).map(|i| json!({ "id": i, "name": format!("A{i}"), "profile_path": null })).collect::<Vec<_>>(),
                         "crew": [{ "id": 9340, "name": "Lana Wachowski", "job": "Director" }, { "id": 1, "name": "Joel Silver", "job": "Producer", "profile_path": "/j.jpg" }] },
            "release_date": "1999-03-30", "runtime": 136, "original_language": "en", "production_countries": [{ "iso_3166_1": "US" }],
            "vote_average": 8.2, "vote_count": 24000, "popularity": 80
        });
        let c = caracteristiques(&film, true);
        assert_eq!(c["cast"].as_array().unwrap().len(), 8);
        assert_eq!(c["directors"], json!([{ "id": 9340, "name": "Lana Wachowski", "profilePath": null }]));
        assert_eq!(c["producers"], json!([{ "id": 1, "name": "Joel Silver", "profilePath": "/j.jpg" }]));
        assert_eq!((&c["year"], &c["runtime"], &c["language"], &c["countries"]), (&json!(1999), &json!(136), &json!("en"), &json!(["US"])));
        let serie = json!({
            "created_by": [{ "id": 5, "name": "Vince Gilligan" }], "keywords": { "results": [{ "name": "drug" }] },
            "aggregate_credits": { "cast": [], "crew": [{ "id": 6, "name": "Exec", "jobs": [{ "job": "Executive Producer" }] }, { "id": 7, "name": "Prod", "jobs": [{ "job": "Producer" }] }] },
            "first_air_date": "", "episode_run_time": [], "origin_country": ["US"]
        });
        let c = caracteristiques(&serie, false);
        assert_eq!((&c["year"], &c["runtime"], &c["keywords"]), (&Value::Null, &Value::Null, &json!(["drug"])));
        assert_eq!(c["producers"], json!([{ "id": 6, "name": "Exec", "profilePath": null }]));
        assert_eq!(c["directors"][0]["name"], "Vince Gilligan");
        assert_eq!((&c["voteAverage"], &c["popularity"]), (&Value::Null, &Value::Null));
    }

    #[test]
    fn la_disponibilite_lit_la_france_seulement() {
        let bloc = json!({ "results": {
            "FR": { "link": "https://www.themoviedb.org/movie/603/watch?locale=FR", "flatrate": [{ "provider_id": 8, "provider_name": "Netflix", "logo_path": "/n.jpg" }], "rent": [{ "provider_id": 2, "provider_name": "Apple TV" }] },
            "US": { "flatrate": [{ "provider_id": 15, "provider_name": "Hulu" }] }
        } });
        let d = disponibilite(Some(&bloc), "2026-09-25T12:00:00.000Z");
        assert_eq!(d["flatrate"], json!([{ "id": 8, "name": "Netflix", "logoPath": "/n.jpg" }]));
        assert_eq!(d["rent"], json!([{ "id": 2, "name": "Apple TV", "logoPath": null }]));
        assert_eq!((&d["free"], &d["ads"], &d["buy"]), (&json!([]), &json!([]), &json!([])));
        let rien = disponibilite(None, "2026-09-25T12:00:00.000Z");
        assert_eq!((&rien["link"], &rien["flatrate"], &rien["fetchedAt"]), (&Value::Null, &json!([]), &json!("2026-09-25T12:00:00.000Z")));
    }

    #[test]
    fn les_nombres_et_adresses_se_lisent_comme_en_javascript() {
        assert_eq!(nombre_js("2"), 2.0);
        assert_eq!(nombre_js(" 3 "), 3.0);
        assert_eq!(nombre_js(""), 0.0);
        assert_eq!(nombre_js("0x10"), 16.0);
        assert_eq!(nombre_js("2.5"), 2.5);
        assert!(nombre_js("abc").is_nan() && nombre_js("inf").is_nan() && nombre_js("1_0").is_nan());
        assert_eq!(texte_nombre_js(2.0), "2");
        assert_eq!(texte_nombre_js(-2.0), "-2");
        assert_eq!(texte_nombre_js(2.5), "2.5");
        assert_eq!(json_nombre_js(2.0), json!(2));
        assert_eq!(encoder_composant("Brad Pitt (l'acteur)!"), "Brad%20Pitt%20(l'acteur)!");
        assert_eq!(encoder_composant("é"), "%C3%A9");
        assert_eq!(encoder_formulaire(&[("with_release_type", "2|3".into()), ("q", "a b".into())]), "with_release_type=2%7C3&q=a+b");
        assert_eq!(annee(Some(&json!("199"))), Some("199".into()));
        assert_eq!(annee(Some(&json!(""))), None);
        assert_eq!(adresse_affiche(Some("")), None);
        assert_eq!(adresse_affiche(Some("/a.jpg")).as_deref(), Some("https://image.tmdb.org/t/p/w500/a.jpg"));
    }
}
