//! TMDB pour la découverte, Ce soir et Sorties : portage des fonctions de `src/lib/tmdb.ts`
//! (`getRecommendedFor`, `getTitleData`, `getRelease`, `discoverReleases`, `discoverForTonight`, lecture des
//! caractéristiques, de la disponibilité), de `release.ts` (`releaseFromTmdb`), de `trailer.ts` (choix de
//! la bande-annonce) et de `youtube.ts` (vérification oEmbed). Fichier à part de `tmdb.rs` (autre portage).
//! Les objets rendus gardent la forme JSON de la v1 (`TmdbFeatures`, `Availability`, `ReleaseInfo`,
//! `TrailerInfo`).
use crate::js;
use serde_json::{Map, Value, json};
use std::{collections::HashMap, sync::Mutex, time::Duration};
use tokio::sync::OnceCell;

const BASE: &str = "https://api.themoviedb.org/3";
const DOCUMENTAIRE: i64 = 99;
const REGION: &str = "FR";
/// Vidéos françaises, anglaises et sans langue (un seul appel).
const LANGUES_VIDEOS: &str = "fr,en,null";

static CLIENT: OnceCell<reqwest::Client> = OnceCell::const_new();

async fn client() -> &'static reqwest::Client {
    CLIENT.get_or_init(|| async { reqwest::Client::builder().timeout(Duration::from_secs(15)).build().expect("client HTTP") }).await
}

/// Un GET sur TMDB ; `None` si la réponse n'est pas un succès, si le réseau échoue ou si le corps n'est pas du JSON.
async fn get(chemin: &str) -> Option<Value> {
    let jeton = std::env::var("TMDB_ACCESS_TOKEN").ok()?;
    let r = client().await.get(format!("{BASE}{chemin}")).bearer_auth(jeton).header("accept", "application/json").send().await.ok()?;
    if !r.status().is_success() {
        return None;
    }
    r.json().await.ok()
}

// ---------- genres ----------

pub struct Genres {
    pub films: HashMap<i64, String>,
    pub series: HashMap<i64, String>,
}

static GENRES: OnceCell<Genres> = OnceCell::const_new();

/// Dictionnaires identifiant → nom (anglais) des genres TMDB, gardés le temps du processus (comme la v1,
/// même vides si TMDB a échoué).
pub async fn genres() -> &'static Genres {
    GENRES
        .get_or_init(|| async {
            let liste = |v: Option<Value>| -> HashMap<i64, String> {
                v.and_then(|v| v.get("genres").and_then(Value::as_array).cloned())
                    .unwrap_or_default()
                    .iter()
                    .filter_map(|g| Some((g.get("id")?.as_i64()?, g.get("name")?.as_str()?.to_owned())))
                    .collect()
            };
            let (f, s) = tokio::join!(get("/genre/movie/list"), get("/genre/tv/list"));
            Genres { films: liste(f), series: liste(s) }
        })
        .await
}

impl Genres {
    fn dico(&self, film: bool) -> &HashMap<i64, String> {
        if film { &self.films } else { &self.series }
    }
    /// `genreIdByName` : le plus petit identifiant qui porte ce nom (ordre de `Object.entries`).
    pub fn id_par_nom(&self, film: bool, nom: &str) -> Option<i64> {
        self.dico(film).iter().filter(|(_, n)| *n == nom).map(|(i, _)| *i).min()
    }
}

// ---------- résultats de recherche / découverte (`TmdbSearchResult`) ----------

#[derive(Clone, Debug, PartialEq)]
pub struct Resultat {
    pub tmdb_id: i64,
    pub type_: &'static str,
    pub documentaire: bool,
    pub genres: Vec<String>,
    pub titre: String,
    pub annee: Option<String>,
    pub affiche: Option<String>,
    pub note_moyenne: Option<f64>,
    pub votes: Option<f64>,
    pub synopsis: String,
}

pub const AFFICHE: &str = "https://image.tmdb.org/t/p/w500";

pub fn url_affiche(chemin: Option<&str>) -> Option<String> {
    chemin.filter(|c| !c.is_empty()).map(|c| format!("{AFFICHE}{c}"))
}

/// `rowToResult` : une ligne brute (recommandations, discover) d'un type connu.
pub fn ligne_vers_resultat(r: &Value, film: bool, g: &Genres) -> Option<Resultat> {
    let titre = r.get(if film { "title" } else { "name" }).and_then(Value::as_str).filter(|t| !t.is_empty())?.to_owned();
    let date = r.get(if film { "release_date" } else { "first_air_date" }).and_then(Value::as_str).filter(|d| !d.is_empty());
    let ids: Vec<i64> = r.get("genre_ids").and_then(Value::as_array).map(|a| a.iter().filter_map(Value::as_i64).collect()).unwrap_or_default();
    Some(Resultat {
        tmdb_id: r.get("id").and_then(Value::as_f64)? as i64,
        type_: if film { "Movie" } else { "TV Series" },
        documentaire: ids.contains(&DOCUMENTAIRE),
        genres: ids.iter().filter_map(|i| g.dico(film).get(i).filter(|n| !n.is_empty()).cloned()).collect(),
        titre,
        annee: date.map(|d| d.chars().take(4).collect()),
        affiche: r.get("poster_path").and_then(Value::as_str).map(str::to_owned),
        note_moyenne: r.get("vote_average").and_then(Value::as_f64),
        votes: r.get("vote_count").and_then(Value::as_f64),
        synopsis: r.get("overview").and_then(Value::as_str).unwrap_or_default().to_owned(),
    })
}

fn lignes(v: Option<Value>) -> Vec<Value> {
    v.and_then(|v| v.get("results").and_then(Value::as_array).cloned()).unwrap_or_default()
}

/// FR-16 : titres proches d'un titre selon TMDB (`/recommendations`), en français ; le type de chaque
/// ligne vient de son `media_type`. Liste vide en cas d'échec.
pub async fn recommandes_pour(tmdb_id: i64, type_: &str) -> Vec<Resultat> {
    let genre = if type_ == "Movie" { "movie" } else { "tv" };
    let chemin = format!("/{genre}/{tmdb_id}/recommendations?language=fr-FR&page=1");
    let (reponse, g) = tokio::join!(get(&chemin), genres());
    let Some(reponse) = reponse.filter(|r| r.get("results").is_some_and(Value::is_array)) else { return vec![] };
    lignes(Some(reponse)).iter().filter_map(|r| ligne_vers_resultat(r, r.get("media_type").and_then(Value::as_str) != Some("tv"), g)).collect()
}

/// Encodage `application/x-www-form-urlencoded` de `URLSearchParams`.
fn encoder(texte: &str) -> String {
    texte
        .bytes()
        .map(|b| match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'*' | b'-' | b'.' | b'_' => (b as char).to_string(),
            b' ' => "+".into(),
            _ => format!("%{b:02X}"),
        })
        .collect()
}

fn requete(parametres: &[(&str, String)]) -> String {
    parametres.iter().map(|(k, v)| format!("{}={}", encoder(k), encoder(v))).collect::<Vec<_>>().join("&")
}

/// Nombre JavaScript en texte (`String(90)`, `String(90.5)`).
pub fn texte_nombre(x: f64) -> String {
    if x.is_infinite() {
        return if x > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if x.fract() == 0.0 && x.abs() < 1e21 { format!("{}", x as i64) } else { format!("{x}") }
}

/// FR-3 (Sorties) : titres qui sortent sur une période, les plus populaires d'abord.
pub async fn decouvrir_sorties(film: bool, de: &str, a: &str, page: i64, en_diffusion: bool) -> Vec<Resultat> {
    let mut p: Vec<(&str, String)> = vec![("sort_by", "popularity.desc".into()), ("page", page.to_string()), ("include_adult", "false".into()), ("language", "fr-FR".into())];
    if film {
        p.extend([("region", REGION.to_owned()), ("with_release_type", "2|3".into()), ("release_date.gte", de.into()), ("release_date.lte", a.into())]);
    } else if en_diffusion {
        p.extend([("air_date.gte", de.to_owned()), ("air_date.lte", a.into())]);
    } else {
        p.extend([("first_air_date.gte", de.to_owned()), ("first_air_date.lte", a.into()), ("include_null_first_air_dates", "false".into())]);
    }
    let chemin = format!("/discover/{}?{}", if film { "movie" } else { "tv" }, requete(&p));
    let (reponse, g) = tokio::join!(get(&chemin), genres());
    lignes(reponse).iter().filter_map(|r| ligne_vers_resultat(r, film, g)).collect()
}

/// Ce soir v2 (FR-5, « tout le catalogue ») : titres populaires d'un des genres, d'une durée maximale (films),
/// inclus chez l'un des services (France). Le filtrage exact reste local.
pub async fn decouvrir_pour_ce_soir(film: bool, genres_voulus: Option<&[String]>, minutes_max: Option<f64>, services: Option<&[i64]>, page: i64) -> Vec<Resultat> {
    let g = genres().await;
    let mut p: Vec<(&str, String)> =
        vec![("sort_by", "popularity.desc".into()), ("page", page.to_string()), ("include_adult", "false".into()), ("language", "fr-FR".into()), ("vote_count.gte", "150".into())];
    if let Some(noms) = genres_voulus {
        let ids: Vec<String> = noms.iter().filter_map(|n| g.id_par_nom(film, n)).map(|i| i.to_string()).collect();
        if ids.is_empty() {
            return vec![];
        }
        p.push(("with_genres", ids.join("|")));
    }
    if let (true, Some(m)) = (film, minutes_max) {
        p.push(("with_runtime.lte", texte_nombre(m)));
    }
    if let Some(s) = services.filter(|s| !s.is_empty()) {
        p.extend([
            ("watch_region", REGION.to_owned()),
            ("with_watch_providers", s.iter().map(i64::to_string).collect::<Vec<_>>().join("|")),
            ("with_watch_monetization_types", "flatrate|free|ads".into()),
        ]);
    }
    lignes(get(&format!("/discover/{}?{}", if film { "movie" } else { "tv" }, requete(&p))).await).iter().filter_map(|r| ligne_vers_resultat(r, film, g)).collect()
}

// ---------- caractéristiques (`parseFeatures`) ----------

const DISTRIBUTION_RETENUE: usize = 8;
const PRODUCTION_RETENUE: usize = 4;

fn personne(p: &Value) -> Value {
    let mut o = Map::new();
    if let Some(id) = p.get("id") {
        o.insert("id".into(), id.clone());
    }
    if let Some(n) = p.get("name") {
        o.insert("name".into(), n.clone());
    }
    o.insert("profilePath".into(), p.get("profile_path").cloned().unwrap_or(Value::Null));
    Value::Object(o)
}

fn tableau(v: Option<&Value>) -> Vec<&Value> {
    v.and_then(Value::as_array).map(|a| a.iter().collect()).unwrap_or_default()
}

fn nombre_ou_null(v: Option<&Value>) -> Value {
    v.filter(|x| x.is_number()).cloned().unwrap_or(Value::Null)
}

/// Les caractéristiques du modèle dans une fiche enrichie de `keywords` et des crédits.
pub fn analyser_caracteristiques(d: &Value, film: bool) -> Value {
    let mots = if film { d.pointer("/keywords/keywords") } else { d.pointer("/keywords/results") };
    let credits = if film { d.get("credits") } else { d.get("aggregate_credits") };
    let distribution = tableau(credits.and_then(|c| c.get("cast")));
    let equipe = tableau(credits.and_then(|c| c.get("crew")));
    let realisation: Vec<&Value> = if film { equipe.iter().copied().filter(|c| c.get("job").and_then(Value::as_str) == Some("Director")).collect() } else { tableau(d.get("created_by")) };
    let production: Vec<&Value> = if film {
        equipe.iter().copied().filter(|c| c.get("job").and_then(Value::as_str) == Some("Producer")).collect()
    } else {
        equipe.iter().copied().filter(|c| tableau(c.get("jobs")).iter().any(|j| j.get("job").and_then(Value::as_str) == Some("Executive Producer"))).collect()
    };
    let date = d.get(if film { "release_date" } else { "first_air_date" }).and_then(Value::as_str).filter(|x| !x.is_empty());
    let annee = date.map(|x| js::nombre_ou_nan(&x.chars().take(4).collect::<String>())).filter(|n| *n != 0.0 && !n.is_nan());
    let duree = if film { d.get("runtime").filter(|v| !v.is_null()).cloned().unwrap_or(Value::Null) } else { tableau(d.get("episode_run_time")).first().map(|v| (*v).clone()).unwrap_or(Value::Null) };
    let pays: Value = if film {
        json!(tableau(d.get("production_countries")).iter().map(|c| c.get("iso_3166_1").cloned().unwrap_or(Value::Null)).collect::<Vec<_>>())
    } else {
        d.get("origin_country").filter(|v| !v.is_null()).cloned().unwrap_or(json!([]))
    };
    json!({
        "genres": tableau(d.get("genres")).iter().map(|g| g.get("name").cloned().unwrap_or(Value::Null)).collect::<Vec<_>>(),
        "keywords": tableau(mots).iter().map(|k| k.get("name").cloned().unwrap_or(Value::Null)).collect::<Vec<_>>(),
        "cast": distribution.iter().take(DISTRIBUTION_RETENUE).map(|p| personne(p)).collect::<Vec<_>>(),
        "directors": realisation.iter().map(|p| personne(p)).collect::<Vec<_>>(),
        "producers": production.iter().take(PRODUCTION_RETENUE).map(|p| personne(p)).collect::<Vec<_>>(),
        "year": annee,
        "runtime": duree,
        "language": d.get("original_language").filter(|v| !v.is_null()).cloned().unwrap_or(Value::Null),
        "countries": pays,
        "voteAverage": nombre_ou_null(d.get("vote_average")),
        "voteCount": nombre_ou_null(d.get("vote_count")),
        "popularity": nombre_ou_null(d.get("popularity")),
    })
}

fn fournisseurs(v: Option<&Value>) -> Value {
    json!(tableau(v)
        .iter()
        .map(|p| {
            let mut o = Map::new();
            if let Some(id) = p.get("provider_id") {
                o.insert("id".into(), id.clone());
            }
            if let Some(n) = p.get("provider_name") {
                o.insert("name".into(), n.clone());
            }
            o.insert("logoPath".into(), p.get("logo_path").cloned().unwrap_or(Value::Null));
            Value::Object(o)
        })
        .collect::<Vec<_>>())
}

/// Disponibilité en France à partir du bloc `watch/providers` (`parseAvailability`).
pub fn analyser_disponibilite(bloc: Option<&Value>, maintenant: i64) -> Value {
    let fr = bloc.and_then(|b| b.get("results")).and_then(|r| r.get(REGION));
    let lien = fr.and_then(|f| f.get("link")).filter(|l| !l.is_null()).cloned().unwrap_or(Value::Null);
    json!({
        "link": lien,
        "flatrate": fournisseurs(fr.and_then(|f| f.get("flatrate"))),
        "free": fournisseurs(fr.and_then(|f| f.get("free"))),
        "ads": fournisseurs(fr.and_then(|f| f.get("ads"))),
        "rent": fournisseurs(fr.and_then(|f| f.get("rent"))),
        "buy": fournisseurs(fr.and_then(|f| f.get("buy"))),
        "fetchedAt": js::iso(maintenant),
    })
}

// ---------- dates de sortie (`releaseFromTmdb`) ----------

fn jour_valide(v: Option<&Value>) -> Option<String> {
    v.and_then(Value::as_str).filter(|s| js::commence_par_un_jour(s)).map(|s| s[..10].to_owned())
}

fn plus_ancienne(dates: &[&Value], types: &[i64]) -> Option<String> {
    for t in types {
        let mut jours: Vec<String> = dates.iter().filter(|d| d.get("type").and_then(Value::as_f64) == Some(*t as f64)).filter_map(|d| jour_valide(d.get("release_date"))).collect();
        jours.sort();
        if let Some(j) = jours.into_iter().next() {
            return Some(j);
        }
    }
    None
}

/// FR-1, AC-4 : les dates d'une fiche TMDB (France ; un film sans sortie française retombe sur sa date mondiale).
pub fn sortie_de_tmdb(brut: &Value, film: bool, maintenant: i64) -> Value {
    let statut = brut.get("status").filter(|s| s.is_string()).cloned().unwrap_or(Value::Null);
    if film {
        let france: Vec<&Value> = tableau(brut.pointer("/release_dates/results"))
            .into_iter()
            .find(|r| r.get("iso_3166_1").and_then(Value::as_str) == Some("FR"))
            .map(|r| tableau(r.get("release_dates")))
            .unwrap_or_default();
        return json!({
            "kind": "movie",
            "theatrical": plus_ancienne(&france, &[3, 2]).or_else(|| jour_valide(brut.get("release_date"))),
            "digital": plus_ancienne(&france, &[4]),
            "firstAir": null,
            "nextEpisode": null,
            "status": statut,
            "fetchedAt": js::iso(maintenant),
        });
    }
    let suivant = brut.get("next_episode_to_air").filter(|n| !n.is_null() && !matches!(n, Value::Bool(false)));
    let date = jour_valide(suivant.and_then(|n| n.get("air_date")));
    let episode = match (suivant, &date) {
        (Some(n), Some(d)) => match (n.get("season_number").filter(|v| v.is_number()), n.get("episode_number").filter(|v| v.is_number())) {
            (Some(s), Some(e)) => json!({ "date": d, "season": s, "episode": e }),
            _ => Value::Null,
        },
        _ => Value::Null,
    };
    json!({
        "kind": "tv",
        "theatrical": null,
        "digital": null,
        "firstAir": jour_valide(brut.get("first_air_date")),
        "nextEpisode": episode,
        "status": statut,
        "fetchedAt": js::iso(maintenant),
    })
}

/// Dates de sortie seules (`getRelease`), plus léger qu'une fiche complète.
pub async fn sortie(tmdb_id: i64, film: bool) -> Option<Value> {
    let chemin = if film { format!("/movie/{tmdb_id}?append_to_response=release_dates") } else { format!("/tv/{tmdb_id}") };
    Some(sortie_de_tmdb(&get(&chemin).await?, film, js::maintenant_ms()))
}

// ---------- bandes-annonces (bandes-annonces-v1 FR-1, FR-8) ----------

/// FR-1 : bande-annonce avant teaser, français, anglais, sans langue ; officielle ; la plus récente.
pub fn classer_bandes_annonces(videos: Option<&Value>) -> Vec<Value> {
    struct V {
        cle: String,
        genre: &'static str,
        langue: Option<String>,
        officielle: bool,
        nom: String,
        publiee: String,
    }
    let rang_langue = |l: &Option<String>| match l.as_deref() {
        Some("fr") => 0,
        Some("en") => 1,
        None => 2,
        _ => 3,
    };
    let mut v: Vec<V> = tableau(videos)
        .into_iter()
        .filter_map(|x| {
            let cle = x.get("key").and_then(Value::as_str).filter(|k| !k.is_empty())?;
            if x.get("site").and_then(Value::as_str) != Some("YouTube") {
                return None;
            }
            let genre = match x.get("type").and_then(Value::as_str) {
                Some("Trailer") => "Trailer",
                Some("Teaser") => "Teaser",
                _ => return None,
            };
            Some(V {
                cle: cle.to_owned(),
                genre,
                langue: x.get("iso_639_1").and_then(Value::as_str).filter(|l| !l.is_empty()).map(str::to_owned),
                officielle: x.get("official") == Some(&Value::Bool(true)),
                nom: x.get("name").and_then(Value::as_str).unwrap_or("Bande-annonce").to_owned(),
                publiee: x.get("published_at").and_then(Value::as_str).unwrap_or_default().to_owned(),
            })
        })
        .collect();
    v.sort_by(|a, b| {
        let genre = |g: &str| if g == "Trailer" { 0 } else { 1 };
        genre(a.genre).cmp(&genre(b.genre)).then(rang_langue(&a.langue).cmp(&rang_langue(&b.langue))).then(b.officielle.cmp(&a.officielle)).then(b.publiee.cmp(&a.publiee))
    });
    v.into_iter().map(|x| json!({ "key": x.cle, "name": x.nom, "language": x.langue, "kind": x.genre })).collect()
}

/// Ce que YouTube dit d'une vidéo (oEmbed).
#[derive(Clone, Debug, PartialEq)]
pub enum Verification {
    Integrable(Option<String>),
    Reservee,
    Retiree,
    Inconnue,
}

pub fn interpreter_oembed(statut: u16, corps: Option<&Value>) -> Verification {
    match statut {
        200 => Verification::Integrable(corps.and_then(|c| c.get("author_name")).and_then(Value::as_str).filter(|a| !a.is_empty()).map(str::to_owned)),
        401 | 403 => Verification::Reservee,
        404 | 400 => Verification::Retiree,
        _ => Verification::Inconnue,
    }
}

const VERIFICATIONS_MAX: usize = 4;

/// FR-8 : la première vidéo intégrable (avec sa chaîne) ; un doute garde la vidéo ; sinon la meilleure
/// réservée à YouTube, marquée comme telle ; `None` s'il n'y a rien.
pub async fn choisir_bande_annonce<F, Fut>(candidates: &[Value], verifier: F) -> Option<Value>
where
    F: Fn(String) -> Fut,
    Fut: std::future::Future<Output = Verification>,
{
    let mut reservee: Option<Value> = None;
    for c in candidates.iter().take(VERIFICATIONS_MAX) {
        let cle = c["key"].as_str().unwrap_or_default().to_owned();
        match verifier(cle).await {
            Verification::Integrable(chaine) => {
                let mut v = c.clone();
                v["embeddable"] = json!(true);
                v["channel"] = json!(chaine);
                return Some(v);
            }
            Verification::Inconnue => return Some(c.clone()),
            Verification::Reservee if reservee.is_none() => {
                let mut v = c.clone();
                v["embeddable"] = json!(false);
                reservee = Some(v);
            }
            _ => {}
        }
    }
    reservee
}

static OEMBED: Mutex<Option<HashMap<String, Verification>>> = Mutex::new(None);

/// Vérification oEmbed (sans clé, 3 s au plus), gardée le temps du processus sauf un doute.
pub async fn verifier_youtube(cle: String) -> Verification {
    if let Some(v) = OEMBED.lock().ok().and_then(|c| c.as_ref().and_then(|c| c.get(&cle).cloned())) {
        return v;
    }
    let cible = format!("https://www.youtube.com/watch?v={cle}");
    let encodee: String = cible
        .bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.!~*'()".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect();
    let url = format!("https://www.youtube.com/oembed?format=json&url={encodee}");
    let resultat = async {
        let r = client().await.get(url).timeout(Duration::from_secs(3)).send().await.ok()?;
        let statut = r.status().as_u16();
        if r.status().is_success() {
            let corps: Value = r.json().await.ok()?;
            Some(interpreter_oembed(statut, Some(&corps)))
        } else {
            Some(interpreter_oembed(statut, None))
        }
    }
    .await
    .unwrap_or(Verification::Inconnue);
    if resultat != Verification::Inconnue
        && let Ok(mut c) = OEMBED.lock() {
            c.get_or_insert_with(HashMap::new).insert(cle, resultat.clone());
        }
    resultat
}

// ---------- fiche complète (`getTitleData`) ----------

#[derive(Clone, Debug)]
pub struct DonneesTitre {
    pub caracteristiques: Value,
    pub disponibilite: Value,
    pub sortie: Value,
    /// `TrailerInfo` : `{ trailer, fetchedAt }`.
    pub bande_annonce: Value,
}

/// Caractéristiques, disponibilité, dates et bande-annonce en un appel. `None` si TMDB échoue.
pub async fn donnees_titre(tmdb_id: i64, film: bool) -> Option<DonneesTitre> {
    let videos = format!("include_video_language={LANGUES_VIDEOS}");
    let chemin = if film {
        format!("/movie/{tmdb_id}?append_to_response=keywords,credits,watch/providers,release_dates,videos&{videos}")
    } else {
        format!("/tv/{tmdb_id}?append_to_response=keywords,aggregate_credits,watch/providers,videos&{videos}")
    };
    let d = get(&chemin).await?;
    let maintenant = js::maintenant_ms();
    let caracteristiques = analyser_caracteristiques(&d, film);
    let disponibilite = analyser_disponibilite(d.get("watch/providers"), maintenant);
    let sortie = sortie_de_tmdb(&d, film, maintenant);
    let bande = choisir_bande_annonce(&classer_bandes_annonces(d.pointer("/videos/results")), verifier_youtube).await;
    Some(DonneesTitre { caracteristiques, disponibilite, sortie, bande_annonce: json!({ "trailer": bande, "fetchedAt": js::iso(js::maintenant_ms()) }) })
}

#[cfg(test)]
mod tests {
    //! Tests de src/lib/release.test.ts (releaseFromTmdb, AC-4) et de src/lib/trailer.test.ts (choix d'une
    //! bande-annonce, oEmbed : AC-1 à AC-3, AC-6, AC-7), mêmes cas, mêmes valeurs. Les fonctions de ces
    //! modules qui ne servent qu'à l'interface (badge, libellés, lecteur) restent en TypeScript.
    use super::*;

    const MAINTENANT: i64 = 1_790_000_000_000;

    #[test]
    fn retient_la_plus_ancienne_sortie_francaise_en_salle_et_la_numerique() {
        let brut = json!({
            "status": "Released",
            "release_date": "2026-09-01",
            "release_dates": { "results": [
                { "iso_3166_1": "US", "release_dates": [{ "type": 3, "release_date": "2026-08-01T00:00:00.000Z" }] },
                { "iso_3166_1": "FR", "release_dates": [
                    { "type": 3, "release_date": "2026-10-15T00:00:00.000Z" },
                    { "type": 3, "release_date": "2026-10-08T00:00:00.000Z" },
                    { "type": 4, "release_date": "2027-01-20T00:00:00.000Z" },
                    { "type": 2, "release_date": "2026-09-20T00:00:00.000Z" }
                ] }
            ] }
        });
        let r = sortie_de_tmdb(&brut, true, MAINTENANT);
        assert_eq!(r["kind"], "movie");
        assert_eq!(r["theatrical"], "2026-10-08");
        assert_eq!(r["digital"], "2027-01-20");
        assert_eq!(r["status"], "Released");
    }

    #[test]
    fn retombe_sur_la_date_mondiale_et_sur_la_sortie_limitee() {
        let sans_france = json!({ "release_date": "2026-11-05", "release_dates": { "results": [] } });
        assert_eq!(sortie_de_tmdb(&sans_france, true, MAINTENANT)["theatrical"], "2026-11-05");
        let limitee = json!({ "release_dates": { "results": [{ "iso_3166_1": "FR", "release_dates": [{ "type": 2, "release_date": "2026-12-01T00:00:00.000Z" }] }] } });
        assert_eq!(sortie_de_tmdb(&limitee, true, MAINTENANT)["theatrical"], "2026-12-01");
    }

    #[test]
    fn lit_la_premiere_diffusion_et_le_prochain_episode() {
        let serie = json!({ "status": "Returning Series", "first_air_date": "2019-07-26",
            "next_episode_to_air": { "air_date": "2026-10-08", "season_number": 5, "episode_number": 1 } });
        let r = sortie_de_tmdb(&serie, false, MAINTENANT);
        assert_eq!(r["kind"], "tv");
        assert_eq!(r["firstAir"], "2019-07-26");
        assert_eq!(r["nextEpisode"], json!({ "date": "2026-10-08", "season": 5, "episode": 1 }));
        assert_eq!(r["status"], "Returning Series");
    }

    #[test]
    fn ignore_une_date_vide_ou_mal_formee() {
        let r = sortie_de_tmdb(&json!({ "release_date": "", "release_dates": { "results": [{ "iso_3166_1": "FR", "release_dates": [{ "type": 3, "release_date": "bientôt" }] }] } }), true, MAINTENANT);
        assert_eq!(r["theatrical"], Value::Null);
        let s = sortie_de_tmdb(&json!({ "first_air_date": "2026", "next_episode_to_air": { "air_date": null, "season_number": 1, "episode_number": 1 } }), false, MAINTENANT);
        assert_eq!(s["firstAir"], Value::Null);
        assert_eq!(s["nextEpisode"], Value::Null);
    }

    fn video(cle: &str, genre: &str, langue: Option<&str>, officielle: bool, publiee: &str) -> Value {
        json!({ "key": cle, "site": "YouTube", "type": genre, "iso_639_1": langue, "official": officielle, "name": cle, "published_at": publiee })
    }
    fn cles(v: &[Value]) -> Vec<&str> {
        v.iter().map(|x| x["key"].as_str().unwrap()).collect()
    }

    #[test]
    fn prefere_une_bande_annonce_meme_en_anglais_ac1() {
        let v = json!([video("teaser-fr", "Teaser", Some("fr"), true, "2024-01-01"), video("ba-en", "Trailer", Some("en"), true, "2024-01-01"), video("extrait", "Clip", Some("fr"), true, "2024-01-01")]);
        assert_eq!(cles(&classer_bandes_annonces(Some(&v)))[0], "ba-en");
    }

    #[test]
    fn a_langue_egale_l_officielle_puis_la_plus_recente_ac2() {
        let v = json!([video("ancienne", "Trailer", Some("fr"), true, "2023-01-01"), video("non-officielle", "Trailer", Some("fr"), false, "2025-01-01"), video("recente", "Trailer", Some("fr"), true, "2024-06-01")]);
        assert_eq!(cles(&classer_bandes_annonces(Some(&v))), vec!["recente", "ancienne", "non-officielle"]);
    }

    #[test]
    fn ni_extrait_ni_making_of_ni_hors_youtube_ac3() {
        let mut vimeo = video("vimeo", "Trailer", Some("fr"), true, "2024-01-01");
        vimeo["site"] = json!("Vimeo");
        let v = json!([video("clip", "Clip", Some("fr"), true, ""), video("bts", "Behind the Scenes", Some("fr"), true, ""), vimeo]);
        assert!(classer_bandes_annonces(Some(&v)).is_empty());
        assert!(classer_bandes_annonces(None).is_empty());
    }

    #[test]
    fn le_francais_devant_l_anglais_devant_sans_langue() {
        let v = json!([video("sans", "Trailer", None, true, "2024-01-01"), video("en", "Trailer", Some("en"), true, "2024-01-01"), video("fr", "Trailer", Some("fr"), true, "2024-01-01")]);
        assert_eq!(cles(&classer_bandes_annonces(Some(&v))), vec!["fr", "en", "sans"]);
    }

    #[test]
    fn lit_la_reponse_d_oembed() {
        assert_eq!(interpreter_oembed(200, Some(&json!({ "author_name": "Pathé" }))), Verification::Integrable(Some("Pathé".into())));
        assert_eq!(interpreter_oembed(200, Some(&json!({ "author_name": "" }))), Verification::Integrable(None));
        assert_eq!(interpreter_oembed(401, None), Verification::Reservee);
        assert_eq!(interpreter_oembed(403, None), Verification::Reservee);
        assert_eq!(interpreter_oembed(404, None), Verification::Retiree);
        assert_eq!(interpreter_oembed(400, None), Verification::Retiree);
        assert_eq!(interpreter_oembed(500, None), Verification::Inconnue);
    }

    fn trois() -> Vec<Value> {
        vec![json!({ "key": "a", "name": "A", "language": "fr", "kind": "Trailer" }), json!({ "key": "b", "name": "B", "language": "en", "kind": "Trailer" }), json!({ "key": "c", "name": "C", "language": null, "kind": "Trailer" })]
    }

    #[tokio::test]
    async fn saute_une_video_reservee_ou_retiree_pour_la_suivante_lisible_ac6() {
        let choix = choisir_bande_annonce(&trois(), |k| async move {
            match k.as_str() {
                "a" => Verification::Reservee,
                "b" => Verification::Retiree,
                _ => Verification::Integrable(Some("Chaîne".into())),
            }
        })
        .await
        .unwrap();
        assert_eq!(choix["key"], "c");
        assert_eq!(choix["embeddable"], true);
        assert_eq!(choix["channel"], "Chaîne");
    }

    #[tokio::test]
    async fn sans_version_lisible_garde_la_meilleure_reservee_ac7() {
        let choix = choisir_bande_annonce(&trois(), |_| async { Verification::Reservee }).await.unwrap();
        assert_eq!(choix["key"], "a");
        assert_eq!(choix["embeddable"], false);
        assert!(choix.get("channel").is_none());
        assert!(choisir_bande_annonce(&trois(), |_| async { Verification::Retiree }).await.is_none());
    }

    #[tokio::test]
    async fn un_doute_ne_penalise_pas_la_video() {
        let choix = choisir_bande_annonce(&trois(), |_| async { Verification::Inconnue }).await.unwrap();
        assert_eq!(choix, trois()[0]);
    }

    #[test]
    fn genre_par_nom_et_ligne_brute() {
        let g = Genres { films: [(35, "Comedy".to_owned()), (99, "Documentary".to_owned())].into_iter().collect(), series: HashMap::new() };
        assert_eq!(g.id_par_nom(true, "Comedy"), Some(35));
        assert_eq!(g.id_par_nom(true, "Western"), None);
        let r = ligne_vers_resultat(&json!({ "id": 7, "title": "T", "release_date": "2021-05-01", "genre_ids": [99, 35, 1], "vote_count": 10 }), true, &g).unwrap();
        assert_eq!((r.documentaire, r.genres.clone(), r.annee.as_deref(), r.synopsis.as_str()), (true, vec!["Documentary".to_owned(), "Comedy".to_owned()], Some("2021"), ""));
        assert!(ligne_vers_resultat(&json!({ "id": 8, "title": "" }), true, &g).is_none());
    }
}
