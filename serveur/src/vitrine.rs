//! Vitrine de l'accueil — spec: specs/accueil-vitrine-connexion-v1.md (§ 6). `GET /api/vitrine`, comme
//! `src/lib/vitrine.ts` et `src/lib/vitrineLocal.ts` : les titres tendances de TMDB (tendances de la
//! semaine, à l'affiche et à venir en France, les mieux notés, les plus vus), au format des aperçus de
//! l'accueil, sans les titres de la bibliothèque du compte. Publique : un visiteur sans jeton la reçoit
//! aussi, sans filtre. Gardée six heures en mémoire, pour tous (NFR-3).
//!
//! Écart connu, comme l'accueil : `tint` (teinte des affiches) n'est pas calculé ici ; l'interface le
//! calcule avec la même fonction que la v1 (`src/lib/teintes.ts`).

use crate::{accueil::ENVIES, auth, bd, erreur::Erreur, tmdb};
use axum::{Json, http::HeaderMap};
use serde_json::{Value, json};
use sqlx::Row;
use std::collections::HashSet;
use std::time::{Duration, Instant};
use tokio::sync::Mutex;

const PAR_ENVIE: usize = 8;
const PAR_LISTE: usize = 6;
const CHOIX: usize = 10;
const NOTATION: usize = 12;
/// Une note TMDB ne dit quelque chose qu'avec assez de votes (même seuil que la vitrine v1).
const VOTES_MIN: f64 = 300.0;
const DUREE: Duration = Duration::from_secs(6 * 60 * 60);
/// TMDB n'a pas répondu : on réessaie bientôt, sans attendre six heures.
const REESSAI: Duration = Duration::from_secs(5 * 60);

static CACHE: Mutex<Option<(Instant, Duration, Value)>> = Mutex::const_new(None);

/// `suggestionId` : négatif (jamais un titre de la bibliothèque), unique par film ou série.
pub fn identifiant_suggestion(type_: &str, tmdb_id: i64) -> i64 {
    -(tmdb_id * 2 + i64::from(type_ == "TV Series")) - 1
}

fn cle(type_: &str, tmdb_id: i64) -> String {
    format!("{type_}:{tmdb_id}")
}

fn nombre(n: &Option<serde_json::Number>) -> Value {
    n.as_ref().and_then(serde_json::Number::as_f64).map(tmdb::json_nombre_js).unwrap_or(Value::Null)
}

/// `toSuggestion` : les clés et les valeurs de `ShowcaseTitle`, plus `suggestion`.
fn suggestion(r: &tmdb::Resultat) -> Value {
    json!({
        "id": identifiant_suggestion(r.type_, r.tmdb_id),
        "name": r.titre,
        "year": r.annee,
        "type": r.type_,
        "category": if r.documentaire { "Documentary" } else { r.type_ },
        "genres": r.genres,
        "overview": r.synopsis,
        "posterUrl": tmdb::adresse_affiche(r.affiche.as_deref()),
        "compatibility": null,
        "reason": null,
        "watchStatus": null,
        "rating": null,
        "voteAverage": nombre(&r.note),
        "voteCount": nombre(&r.votes),
        "trailer": null,
        "availability": null,
        "neighbours": [],
        "runtime": null,
        "directors": [],
        "cast": [],
        "suggestion": { "tmdbId": r.tmdb_id },
    })
}

/// Une affiche et un synopsis, ou rien (comme `presentable` en v1).
fn presentable(r: &tmdb::Resultat) -> bool {
    r.affiche.as_deref().is_some_and(|a| !a.is_empty()) && !r.synopsis.trim().is_empty()
}

fn unique(lignes: Vec<tmdb::Resultat>) -> Vec<tmdb::Resultat> {
    let mut vus = HashSet::new();
    lignes.into_iter().filter(|r| vus.insert(cle(r.type_, r.tmdb_id))).collect()
}

/// `alternate` : [a0, b0, a1, b1, …].
fn alterner<T>(a: Vec<T>, b: Vec<T>) -> Vec<T> {
    let mut sortie = Vec::with_capacity(a.len() + b.len());
    let (mut a, mut b) = (a.into_iter(), b.into_iter());
    loop {
        match (a.next(), b.next()) {
            (None, None) => return sortie,
            (x, y) => sortie.extend(x.into_iter().chain(y)),
        }
    }
}

fn votes(r: &tmdb::Resultat) -> f64 {
    r.votes.as_ref().and_then(serde_json::Number::as_f64).unwrap_or(0.0)
}

/// `buildVitrine`.
fn construire(tendances: Vec<tmdb::Resultat>, cinema: Vec<tmdb::Resultat>, mieux_notes: Vec<tmdb::Resultat>, connus: Vec<tmdb::Resultat>) -> Value {
    let tendances: Vec<_> = unique(tendances).into_iter().filter(presentable).collect();
    let cinema: Vec<_> = unique(cinema).into_iter().filter(presentable).collect();
    let mieux_notes: Vec<_> = unique(mieux_notes).into_iter().filter(|r| presentable(r) && votes(r) >= VOTES_MIN).collect();
    let reserve = unique(tendances.iter().chain(&cinema).chain(&mieux_notes).cloned().collect());

    let envies: Vec<Value> = ENVIES
        .iter()
        .filter_map(|(valeur, nom, genres)| {
            let titres: Vec<Value> = reserve
                .iter()
                .filter(|r| (*valeur == "think" && r.documentaire) || r.genres.iter().any(|g| genres.contains(&g.as_str())))
                .take(PAR_ENVIE)
                .map(suggestion)
                .collect();
            (!titres.is_empty()).then(|| json!({ "value": valeur, "label": nom, "titles": titres }))
        })
        .collect();

    let onglet = |valeur: &str, nom: &str, lignes: &[tmdb::Resultat]| -> Option<Value> {
        let titres: Vec<Value> = lignes.iter().take(PAR_LISTE).map(suggestion).collect();
        (!titres.is_empty()).then(|| json!({ "value": valeur, "label": nom, "titles": titres }))
    };
    let listes: Vec<Value> = [onglet("trending", "Tendances", &tendances), onglet("cinema", "Au cinéma", &cinema), onglet("top", "Les mieux notés", &mieux_notes)]
        .into_iter()
        .flatten()
        .collect();

    let connus: Vec<Value> = unique(connus).iter().filter(|r| presentable(r)).take(NOTATION).map(suggestion).collect();
    json!({
        "moods": envies,
        "picks": tendances.iter().take(CHOIX).map(suggestion).collect::<Vec<_>>(),
        "lists": listes,
        "rating": connus,
    })
}

/// `fetchVitrine` : les mêmes listes TMDB que la v1, dans le même ordre.
async fn charger() -> Value {
    let page1 = [("page", "1".to_owned())];
    let page2 = [("page", "2".to_owned())];
    let france = [("region", "FR".to_owned()), ("page", "1".to_owned())];
    let connus = [("sort_by", "vote_count.desc".to_owned()), ("page", "1".to_owned())];
    let (t1, t2, affiche, a_venir, films, series, films_connus, series_connues) = tokio::join!(
        tmdb::liste("/trending/all/week", &page1, None),
        tmdb::liste("/trending/all/week", &page2, None),
        tmdb::liste("/movie/now_playing", &france, Some("Movie")),
        tmdb::liste("/movie/upcoming", &france, Some("Movie")),
        tmdb::liste("/movie/top_rated", &france, Some("Movie")),
        tmdb::liste("/tv/top_rated", &page1, Some("TV Series")),
        tmdb::liste("/discover/movie", &connus, Some("Movie")),
        tmdb::liste("/discover/tv", &connus, Some("TV Series")),
    );
    // Deux films pour une série : on a vu plus de films que de séries en entier.
    let mut series_connues = series_connues.into_iter();
    let mut melange = Vec::new();
    for (i, film) in films_connus.into_iter().enumerate() {
        melange.push(film);
        if i % 2 == 1
            && let Some(serie) = series_connues.next()
        {
            melange.push(serie);
        }
    }
    construire([t1, t2].concat(), alterner(affiche, a_venir), alterner(films, series), melange)
}

async fn vitrine() -> Value {
    let mut cache = CACHE.lock().await;
    if let Some((quand, duree, valeur)) = cache.as_ref()
        && quand.elapsed() < *duree
    {
        return valeur.clone();
    }
    let valeur = charger().await;
    let vide = valeur["picks"].as_array().is_none_or(Vec::is_empty) && valeur["lists"].as_array().is_none_or(Vec::is_empty);
    *cache = Some((Instant::now(), if vide { REESSAI } else { DUREE }, valeur.clone()));
    valeur
}

/// `withoutOwned` : ni les envies, ni les listes, ni la notation ne proposent un titre qu'on a.
fn sans_les_siens(mut v: Value, siens: &HashSet<String>) -> Value {
    if siens.is_empty() {
        return v;
    }
    let garder = |t: &Value| {
        let tmdb_id = t["suggestion"]["tmdbId"].as_i64().unwrap_or_default();
        !siens.contains(&cle(t["type"].as_str().unwrap_or_default(), tmdb_id))
    };
    for cle_liste in ["picks", "rating"] {
        if let Some(titres) = v[cle_liste].as_array_mut() {
            titres.retain(garder);
        }
    }
    for cle_onglets in ["moods", "lists"] {
        if let Some(onglets) = v[cle_onglets].as_array_mut() {
            for onglet in onglets.iter_mut() {
                if let Some(titres) = onglet["titles"].as_array_mut() {
                    titres.retain(garder);
                }
            }
            onglets.retain(|o| o["titles"].as_array().is_some_and(|t| !t.is_empty()));
        }
    }
    v
}

/// GET /api/vitrine
pub async fn lire(entetes: HeaderMap) -> Result<Json<Value>, Erreur> {
    let valeur = vitrine().await;
    // Un jeton valable : sans les titres du compte. Sans jeton (visiteur) ou jeton refusé : la vitrine seule.
    let jeton = entetes.get("authorization").and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer "));
    let Some(utilisateur) = (match jeton {
        Some(j) => auth::utilisateur(j).await.ok(),
        None => None,
    }) else {
        return Ok(Json(valeur));
    };
    let mut tx = bd::transaction(&utilisateur).await?;
    let lignes = sqlx::query("select type, tmdb_id from public.library_view").persistent(false).fetch_all(&mut **tx).await?;
    tx.valider().await?;
    let siens: HashSet<String> = lignes.iter().map(|l| cle(l.get::<String, _>("type").as_str(), i64::from(l.get::<i32, _>("tmdb_id")))).collect();
    Ok(Json(sans_les_siens(valeur, &siens)))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn r(tmdb_id: i64, genres: &[&str]) -> tmdb::Resultat {
        tmdb::Resultat {
            tmdb_id,
            type_: "Movie",
            documentaire: false,
            genres: genres.iter().map(|g| g.to_string()).collect(),
            titre: format!("Titre {tmdb_id}"),
            annee: Some("2026".into()),
            affiche: Some(format!("/p{tmdb_id}.jpg")),
            note: serde_json::Number::from_f64(7.5),
            votes: Some(1000.into()),
            synopsis: "Un synopsis.".into(),
            credit: None,
        }
    }

    #[test]
    fn identifiants_comme_la_v1() {
        // suggestionId(type, id) = -(id * 2 + (série ? 1 : 0)) - 1
        assert_eq!(identifiant_suggestion("Movie", 7), -15);
        assert_eq!(identifiant_suggestion("TV Series", 7), -16);
        assert_eq!(identifiant_suggestion("Movie", 0), -1);
    }

    #[test]
    fn alterne_sans_perdre() {
        assert_eq!(alterner(vec![1, 2, 3], vec![9]), vec![1, 9, 2, 3]);
    }

    #[test]
    fn construit_les_memes_sections() {
        let tendances: Vec<_> = (0..14).map(|i| r(100 + i, &["Comedy"])).collect();
        let v = construire(tendances, vec![r(200, &["Thriller"])], vec![r(300, &["Drama"])], (0..15).map(|i| r(400 + i, &["Drama"])).collect());
        assert_eq!(v["picks"].as_array().unwrap().len(), 10);
        assert_eq!(v["rating"].as_array().unwrap().len(), 12);
        assert_eq!(v["moods"][0]["label"], "Léger");
        assert_eq!(v["moods"][0]["titles"].as_array().unwrap().len(), 8);
        assert_eq!(v["lists"].as_array().unwrap().iter().map(|o| o["value"].as_str().unwrap()).collect::<Vec<_>>(), ["trending", "cinema", "top"]);
        assert_eq!(v["picks"][0]["suggestion"]["tmdbId"], 100);
        let siens = HashSet::from([cle("Movie", 100), cle("Movie", 200)]);
        let sans = sans_les_siens(v, &siens);
        assert_ne!(sans["picks"][0]["suggestion"]["tmdbId"], 100);
        assert!(sans["moods"].as_array().unwrap().iter().all(|o| o["value"] != "intense"));
    }
}
