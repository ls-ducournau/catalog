//! L'accueil : `GET /api/accueil` rend ce que `chargerAccueilLocal()` (src/lib/accueilLocal.ts) lit dans la
//! base locale, sous la même forme : `{ stats, showcase, features }`, `null` pour une partie qui échoue.
//! Reprend `counts()` (accueilLocal.ts), `getHomeShowcase` (showcase.ts) et `getHomeFeatures` (homeFeatures.ts).
//! L'interface en ligne l'appelle depuis `src/lib/accueilDonnees.ts`.
//!
//! Écart connu : `tint` (teinte d'une affiche, `posterTint`) n'est pas calculé ici. La v1 la tire de l'affiche
//! avec sharp (libvips) : décodage JPEG et réduction à 12 × 18 pixels qu'on ne peut pas reproduire au bit près
//! en Rust. La clé est absente, comme dans la v1 quand l'affiche est illisible (carte neutre). Correctif 1 pour 1
//! proposé : la calculer côté Next.js, avec la même fonction, après l'appel à cette route.
use crate::{
    auth::Utilisateur,
    bd::{self, Tx},
    erreur::Erreur,
    items::{COLONNES, NOTES, titre},
    js, playlists, preference, recommandations, tri,
};
use axum::{Json, extract::Query};
use serde_json::{Map, Value, json};
use std::collections::{HashMap, HashSet};

/// Un onglet d'aperçu : valeur, libellé, titres.
type Onglet = (String, String, Vec<Map<String, Value>>);

const PAR_ENVIE: usize = 8;
const PAR_LISTE: usize = 6;
const CHOIX: usize = 10;
const VOTES_MIN: f64 = 300.0;
const CARTES_NOTATION: i64 = 6;
const PALIER_DEPARTAGE: i32 = 5;

/// `MOOD_LABELS` et `MOOD_GENRES` (src/lib/tonight.ts), dans l'ordre des onglets.
pub const ENVIES: [(&str, &str, &[&str]); 5] = [
    ("light", "Léger", &["Comedy", "Animation", "Family", "Kids"]),
    ("intense", "Intense", &["Thriller", "Action", "Crime", "Horror", "Mystery", "Action & Adventure"]),
    ("moving", "Émouvant", &["Drama", "Romance"]),
    ("escape", "Évasion", &["Science Fiction", "Fantasy", "Adventure", "Sci-Fi & Fantasy", "Action & Adventure"]),
    ("think", "Réfléchir", &["Documentary", "History", "War", "War & Politics"]),
];

fn nocase(x: &str) -> String {
    format!("translate({x}, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz') collate \"C\"")
}

/// `listItems` réduit à ce que lit l'accueil : un filtre fixe, un tri décroissant, une page.
async fn lister(tx: &mut Tx, condition: &str, colonne: &str, taille: i64) -> Result<Vec<Value>, Erreur> {
    let nom = nocase("name");
    let sql = format!("select {COLONNES} from public.library_view where {condition} order by {colonne} is null, {colonne} desc, {nom} asc, id asc limit {taille}");
    let lignes = sqlx::query(&sql).persistent(false).fetch_all(&mut ***tx).await?;
    lignes.iter().map(titre).collect()
}

/// Une affiche et un synopsis : sinon le titre n'entre pas dans un aperçu (`presentable`).
fn presentable(item: &Value) -> bool {
    item["posterUrl"].as_str().is_some_and(|s| !s.is_empty()) && item["overview"].as_str().is_some_and(|s| !s.is_empty())
}

fn correspond_a_l_envie(item: &Value, genres: &[&str], envie: &str) -> bool {
    if envie == "think" && item["category"] == "Documentary" {
        return true;
    }
    item["genres"].as_array().is_some_and(|g| g.iter().any(|x| x.as_str().is_some_and(|s| genres.contains(&s))))
}

/// `toTitle` : un titre d'aperçu (`ShowcaseTitle`), sans teinte.
fn en_titre(item: &Value) -> Map<String, Value> {
    let recommande = item.get("compatibility").is_some();
    let voisin = item.get("neighbours").and_then(Value::as_array).and_then(|v| v.first()).filter(|_| recommande);
    let mut t = Map::new();
    for cle in ["id", "name", "year", "type", "category", "genres"] {
        t.insert(cle.into(), item[cle].clone());
    }
    t.insert("overview".into(), item["overview"].as_str().map(|s| json!(s)).unwrap_or(json!("")));
    t.insert("posterUrl".into(), item["posterUrl"].clone());
    t.insert("compatibility".into(), if recommande { item["compatibility"].clone() } else { Value::Null });
    t.insert("reason".into(), voisin.and_then(|v| v["name"].as_str()).map(|n| json!(js::proche_de(n))).unwrap_or(Value::Null));
    for cle in ["watchStatus", "rating", "voteAverage", "voteCount", "trailer", "availability"] {
        t.insert(cle.into(), item[cle].clone());
    }
    t.insert("neighbours".into(), json!([]));
    t.insert("runtime".into(), Value::Null);
    t.insert("directors".into(), json!([]));
    t.insert("cast".into(), json!([]));
    t
}

/// `withNeighbours` : les titres « proches », avec leur affiche.
fn avec_voisins(item: &Value, mut t: Map<String, Value>, affiches: &HashMap<i64, Value>) -> Map<String, Value> {
    let Some(voisins) = item.get("neighbours").and_then(Value::as_array).filter(|v| !v.is_empty()) else { return t };
    let v: Vec<Value> = voisins
        .iter()
        .take(4)
        .map(|n| json!({ "id": n["id"], "name": n["name"], "posterUrl": n["id"].as_i64().and_then(|i| affiches.get(&i)).cloned().unwrap_or(Value::Null) }))
        .collect();
    t.insert("neighbours".into(), json!(v));
    t
}

/// `counts()` de l'accueil : titres, titres notés, titres à voir.
async fn compteurs(utilisateur: &Utilisateur) -> Result<Value, Erreur> {
    let mut tx = bd::transaction(utilisateur).await?;
    let (total, notes, a_voir): (i64, i64, i64) =
        sqlx::query_as("select count(*), count(rating), count(*) filter (where watch_status = 'Unwatched') from public.library_view").persistent(false).fetch_one(&mut **tx).await?;
    tx.valider().await?;
    Ok(json!({ "total": total, "rated": notes, "toWatch": a_voir }))
}

/// `libraryStats` : ta collection en chiffres.
async fn statistiques(tx: &mut Tx) -> Result<Value, Erreur> {
    let doc = "coalesce(genres, '[]'::jsonb) @> '[\"Documentary\"]'::jsonb";
    let (total, vus, a_voir, films, series, docs): (i64, i64, i64, i64, i64, i64) = sqlx::query_as(&format!(
        "select count(*), count(*) filter (where watch_status = 'Watched'), count(*) filter (where watch_status = 'Unwatched'),
                count(*) filter (where type = 'Movie' and not {doc}), count(*) filter (where type = 'TV Series' and not {doc}), count(*) filter (where {doc})
           from public.library_view"
    ))
    .persistent(false)
    .fetch_one(&mut ***tx)
    .await?;
    let par_note: Vec<(i32, i64)> =
        sqlx::query_as("select rating::int, count(*) from public.library_view where watch_status = 'Watched' and rating is not null group by rating").persistent(false).fetch_all(&mut ***tx).await?;
    let notes: Vec<i64> = (0..NOTES.len() as i32).map(|n| par_note.iter().find(|r| r.0 == n).map(|r| r.1).unwrap_or(0)).collect();
    Ok(json!({
        "total": total, "watched": vus, "toWatch": a_voir,
        "categories": [{ "value": "Movie", "count": films }, { "value": "TV Series", "count": series }, { "value": "Documentary", "count": docs }],
        "ratings": notes,
    }))
}

/// `getHomeShowcase`.
pub async fn vitrine(utilisateur: &Utilisateur) -> Result<Value, Erreur> {
    let mut tx = bd::transaction(utilisateur).await?;
    // Ta pile classée et le profil qui la classe ; sans assez de notes, la pile par note TMDB (EC-5 : sans lassitude).
    let (pile, profil): (Vec<Value>, Option<Value>) = match recommandations::classer_la_pile(&mut tx, utilisateur, None, None, None, js::maintenant_ms()).await? {
        Ok(p) => {
            let fin = js::fin_slice(240.0, p.faconnee.len());
            (recommandations::titres_recommandes(&mut tx, &p.faconnee[..fin]).await?, Some(p.profil))
        }
        Err(_) => (lister(&mut tx, "watch_status = 'Unwatched'", "tmdb_rating", 240).await?, None),
    };
    let pile: Vec<Value> = pile.into_iter().filter(presentable).collect();

    // Les affiches des titres « proches » (une seule requête pour toutes les cartes qui en montrent).
    let mut ids_voisins: Vec<i64> = vec![];
    let mut montres: Vec<&Value> = pile.iter().take(CHOIX).collect();
    for (envie, _, genres) in ENVIES {
        montres.extend(pile.iter().filter(|i| correspond_a_l_envie(i, genres, envie)).take(PAR_ENVIE));
    }
    for item in &montres {
        for n in item.get("neighbours").and_then(Value::as_array).into_iter().flatten().take(4) {
            if let Some(i) = n["id"].as_i64() {
                ids_voisins.push(i);
            }
        }
    }
    let affiches: HashMap<i64, Value> = recommandations::titres_par_ids(&mut tx, &ids_voisins).await?.into_iter().map(|t| (t["id"].as_i64().unwrap_or_default(), t["posterUrl"].clone())).collect();
    let titrer = |item: &Value| avec_voisins(item, en_titre(item), &affiches);

    let mut envies: Vec<Onglet> = ENVIES
        .iter()
        .map(|(envie, libelle, genres)| ((*envie).to_owned(), (*libelle).to_owned(), pile.iter().filter(|i| correspond_a_l_envie(i, genres, envie)).take(PAR_ENVIE).map(titrer).collect::<Vec<_>>()))
        .filter(|(_, _, t)| !t.is_empty())
        .collect();
    let mut choix: Vec<Map<String, Value>> = pile.iter().take(CHOIX).map(titrer).collect();

    let liste = |items: Vec<Value>, garder: &dyn Fn(&Value) -> bool| -> Vec<Map<String, Value>> { items.iter().filter(|i| presentable(i) && garder(i)).take(PAR_LISTE).map(en_titre).collect() };
    let recents = liste(lister(&mut tx, "true", "id", 60).await?, &|_| true);
    let coups_de_coeur = liste(lister(&mut tx, "watch_status = 'Watched' and rating >= 5", "(case when duels_count >= 1 then elo_score end)", 60).await?, &|_| true);
    let acclames = liste(lister(&mut tx, "watch_status = 'Unwatched'", "tmdb_rating", 60).await?, &|i| i["voteCount"].as_f64().unwrap_or(0.0) >= VOTES_MIN);
    let mut listes: Vec<Onglet> =
        vec![("recent".into(), "Derniers ajouts".into(), recents), ("favorites".into(), "Tes coups de cœur".into(), coups_de_coeur), ("acclaimed".into(), "À voir, bien notés".into(), acclames)]
            .into_iter()
            .filter(|(_, _, t)| !t.is_empty())
            .collect();

    // `withCredits` : durée et générique, lus dans les caractéristiques TMDB en cache (aucun appel réseau).
    let mut ids: Vec<i64> = vec![];
    for t in envies.iter().flat_map(|e| e.2.iter()).chain(choix.iter()).chain(listes.iter().flat_map(|l| l.2.iter())) {
        if let Some(i) = t["id"].as_i64()
            && !ids.contains(&i) {
                ids.push(i);
            }
    }
    let modeles: HashMap<i64, crate::modele::TitreModele> = preference::charger_titres(&mut tx, "id = any($1)", Some(&ids)).await?.into_iter().map(|t| (t.id, t)).collect();
    let credits = |t: &mut Map<String, Value>| {
        let Some(m) = t["id"].as_i64().and_then(|i| modeles.get(&i)) else { return };
        t.insert("runtime".into(), m.duree.map(js::nombre_json).unwrap_or(Value::Null));
        t.insert("directors".into(), json!(m.realisation.iter().take(2).collect::<Vec<_>>()));
        t.insert("cast".into(), json!(m.distribution.iter().take(3).collect::<Vec<_>>()));
    };
    envies.iter_mut().flat_map(|e| e.2.iter_mut()).for_each(&credits);
    choix.iter_mut().for_each(&credits);
    listes.iter_mut().flat_map(|l| l.2.iter_mut()).for_each(&credits);
    let a_la_une: Vec<Map<String, Value>> = choix.iter().take(3).cloned().collect();

    let profil = profil.map(|mut p| {
        for (cle, n) in [("genres", 6), ("directors", 4)] {
            let tronque: Vec<Value> = p[cle].as_array().map(|a| a.iter().take(n).cloned().collect()).unwrap_or_default();
            p[cle] = json!(tronque);
        }
        p
    });

    // Titres de ta pile par genre (mêmes genres que le profil) : le second polygone du radar.
    let mut genres_pile: Map<String, Value> = Map::new();
    for t in preference::charger_titres(&mut tx, "watch_status = 'Unwatched'", None).await? {
        for g in t.genres {
            let n = genres_pile.get(&g).and_then(Value::as_i64).unwrap_or(0);
            genres_pile.insert(g, json!(n + 1));
        }
    }
    let stats = statistiques(&mut tx).await?;
    tx.valider().await?;

    let onglets = |v: Vec<Onglet>| -> Vec<Value> { v.into_iter().map(|(value, label, titles)| json!({ "value": value, "label": label, "titles": titles })).collect() };
    Ok(json!({
        "moods": onglets(envies),
        "featured": a_la_une,
        "picks": choix,
        "lists": onglets(listes),
        "profile": profil,
        "pileGenres": genres_pile,
        "stats": stats,
    }))
}

/// `getHomeFeatures` : notation, duels, playlists.
pub async fn fonctions(utilisateur: &Utilisateur) -> Result<Value, Erreur> {
    let cartes = tri::cartes_vues(utilisateur, None, CARTES_NOTATION, &HashSet::new()).await?;
    // `getNextDuel` : la paire est tirée au hasard, comme dans la v1.
    let copie = Utilisateur { id: utilisateur.id.clone(), revendications: utilisateur.revendications.clone(), anonyme: utilisateur.anonyme };
    let suivant = crate::duels::suivant(copie, Query(HashMap::new())).await?.0;
    let paire = match (suivant.get("itemA"), suivant.get("itemB")) {
        (Some(a), Some(b)) => json!({ "a": a, "b": b }),
        _ => Value::Null,
    };

    let mut tx = bd::transaction(utilisateur).await?;
    let (sans_note, personnes_sans_note): (i64, i64) = sqlx::query_as(
        "select (select count(*) from public.library_view where watch_status = 'Watched' and rating is null),
                (select count(*) from public.person_opinions where opinion = 1 and rating is null)",
    )
    .persistent(false)
    .fetch_one(&mut **tx)
    .await?;
    // `getRanking` : paliers non vides, titres classés, titres départagés (≥ 5 duels dans leur palier).
    let paliers: Vec<(i64, i64)> = sqlx::query_as(
        "select count(*), count(*) filter (where tier_rating = rating and tier_duels_count >= $1)
           from public.library_view where watch_status = 'Watched' and rating is not null group by rating",
    )
    .bind(PALIER_DEPARTAGE)
    .persistent(false)
    .fetch_all(&mut **tx)
    .await?;
    // `currentPlaylist() ?? latestPlaylist()` : la plus récente qui a un titre à voir, sinon la plus récente.
    let ids: Vec<i64> = sqlx::query_scalar("select id from public.playlists order by updated_at desc, id desc").persistent(false).fetch_all(&mut **tx).await?;
    let mut en_cours: Option<Value> = None;
    let mut derniere: Option<Value> = None;
    for (rang, id) in ids.iter().enumerate() {
        let Some(pl) = playlists::playlist(&mut tx, *id).await? else { continue };
        let dedans = playlists::ids_de(&mut tx, *id).await?;
        let connus = playlists::titres(&mut tx, &dedans).await?;
        let titres: Vec<(Value, Option<f64>, Option<String>)> = dedans.iter().filter_map(|i| connus.get(i).cloned()).collect();
        let detail = Value::Object(playlists::detailler(pl, &titres));
        if rang == 0 {
            derniere = Some(detail.clone());
        }
        if !detail["nextId"].is_null() {
            en_cours = Some(detail);
            break;
        }
    }
    tx.valider().await?;

    Ok(json!({
        "rating": { "cards": cartes, "unratedSeen": sans_note, "unratedPeople": personnes_sans_note },
        "duel": {
            "pair": paire,
            "ranked": paliers.iter().map(|p| p.0).sum::<i64>(),
            "tiers": paliers.len(),
            "settled": paliers.iter().map(|p| p.1).sum::<i64>(),
        },
        "playlist": { "current": en_cours.or(derniere), "count": ids.len() },
    }))
}

fn ou_null(partie: &str, r: Result<Value, Erreur>) -> Value {
    r.unwrap_or_else(|e| {
        eprintln!("accueil, {partie} : {e:?}");
        Value::Null
    })
}

/// GET /api/accueil : `{ stats, showcase, features }`, chaque partie à `null` si elle échoue (comme la v1).
pub async fn route(utilisateur: Utilisateur) -> Result<Json<Value>, Erreur> {
    let (stats, vitrine, fonctions) = tokio::join!(compteurs(&utilisateur), vitrine(&utilisateur), fonctions(&utilisateur));
    Ok(Json(json!({ "stats": ou_null("compteurs", stats), "showcase": ou_null("vitrine", vitrine), "features": ou_null("fonctions", fonctions) })))
}
