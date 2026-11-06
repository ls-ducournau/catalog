//! Preuve du 1 pour 1 par les vecteurs de référence : `tests/vecteurs_v1.json` a été produit par les VRAIES
//! fonctions de la v1 (`pickPair`, `pickQuad`, `getTierStep`, `getRanking`, `submitBand`, `submitQuad`,
//! `undoRound`, `getPeopleWithOpinions`, `getNextPersonDuel`, `getPersonScope`) sur des scénarios tirés au
//! hasard, avec le générateur injecté des tests de la v1. Le générateur : `parite/vecteurs/groupe1.test.ts`.
//! Ici, les mêmes entrées passent par le code Rust ; les sorties doivent être identiques, flottants au bit près.
use crate::{
    classement::{self, Ligne},
    duels_personnes::{apparitions, choisir_paire, personne_duel},
    paliers::{self, Changement, Fiche, LigneTitre, Membre, Refus, tests::lehmer},
    personnes::{Avis, TitreCredite, vue_personnes},
};
use serde_json::{Value, json};
use std::collections::{HashMap, HashSet};

fn charger() -> Value {
    decoder(serde_json::from_str(include_str!("../tests/vecteurs_v1.json")).expect("vecteurs lisibles"))
}

/// `{"$f": "<bits IEEE en hexadécimal>"}` redevient le flottant exact.
fn decoder(v: Value) -> Value {
    match v {
        Value::Object(m) if m.len() == 1 && m.contains_key("$f") => {
            let bits = u64::from_str_radix(m["$f"].as_str().unwrap(), 16).unwrap();
            json!(f64::from_bits(bits))
        }
        Value::Object(m) => Value::Object(m.into_iter().map(|(k, v)| (k, decoder(v))).collect()),
        Value::Array(a) => Value::Array(a.into_iter().map(decoder).collect()),
        autre => autre,
    }
}

/// Le premier écart entre deux valeurs (nombres comparés au bit près, entiers et flottants confondus).
fn ecart(attendu: &Value, obtenu: &Value, chemin: &str) -> Option<String> {
    match (attendu, obtenu) {
        (Value::Number(a), Value::Number(b)) => {
            let (x, y) = (a.as_f64().unwrap(), b.as_f64().unwrap());
            (x.to_bits() != y.to_bits()).then(|| format!("{chemin} : v1 {x:?}, v2 {y:?}"))
        }
        (Value::Array(a), Value::Array(b)) => {
            if a.len() != b.len() {
                return Some(format!("{chemin} : v1 {} éléments, v2 {}", a.len(), b.len()));
            }
            a.iter().zip(b).enumerate().find_map(|(i, (x, y))| ecart(x, y, &format!("{chemin}[{i}]")))
        }
        (Value::Object(a), Value::Object(b)) => {
            let mut cles: Vec<&String> = a.keys().chain(b.keys()).collect();
            cles.sort();
            cles.dedup();
            cles.into_iter().find_map(|k| match (a.get(k), b.get(k)) {
                (Some(x), Some(y)) => ecart(x, y, &format!("{chemin}.{k}")),
                (x, y) => Some(format!("{chemin}.{k} : v1 {x:?}, v2 {y:?}")),
            })
        }
        (a, b) => (a != b).then(|| format!("{chemin} : v1 {a}, v2 {b}")),
    }
}

fn verifier(attendu: &Value, obtenu: &Value, contexte: &str) {
    if let Some(e) = ecart(attendu, obtenu, "$") {
        panic!("{contexte} : {e}");
    }
}

fn i(v: &Value) -> i64 {
    v.as_i64().unwrap_or_else(|| panic!("entier attendu : {v}"))
}
fn f(v: &Value) -> f64 {
    v.as_f64().unwrap_or_else(|| panic!("nombre attendu : {v}"))
}
fn oi(v: &Value) -> Option<i64> {
    v.as_i64()
}
fn os(v: &Value) -> Option<String> {
    v.as_str().map(str::to_owned)
}

#[test]
fn les_paires_sont_celles_de_pick_pair() {
    let v = charger();
    let mut n = 0;
    for (k, cas) in v["paires"].as_array().unwrap().iter().enumerate() {
        let eligibles: Vec<(i64, i32)> = cas["eligibles"].as_array().unwrap().iter().map(|e| (i(&e["id"]), i(&e["duelsCount"]) as i32)).collect();
        let recentes: HashSet<String> = cas["recentes"].as_array().unwrap().iter().map(|r| r.as_str().unwrap().to_owned()).collect();
        let mut rng = lehmer(i(&cas["graine"]));
        for (j, attendu) in cas["tirages"].as_array().unwrap().iter().enumerate() {
            let obtenu = choisir_paire(&eligibles, &recentes, &mut rng).map(|(a, b)| json!({ "itemAId": a, "itemBId": b })).unwrap_or(Value::Null);
            verifier(attendu, &obtenu, &format!("paire {k}, tirage {j}"));
            n += 1;
        }
    }
    assert!(n >= 500, "{n}");
}

#[test]
fn les_quatuors_sont_ceux_de_pick_quad() {
    let v = charger();
    let mut n = 0;
    for (k, cas) in v["quatuors"].as_array().unwrap().iter().enumerate() {
        let groupe: Vec<(i64, i32, f64)> = cas["groupe"].as_array().unwrap().iter().map(|m| (i(&m["id"]), i(&m["comparisons"]) as i32, f(&m["score"]))).collect();
        let mut rng = lehmer(i(&cas["graine"]));
        for (j, attendu) in cas["tirages"].as_array().unwrap().iter().enumerate() {
            let q = paliers::choisir_quatuor(&groupe, |m| m.1, |m| m.2, &mut rng, cas["seulement"].as_bool().unwrap(), i(&cas["taille"]) as usize);
            verifier(attendu, &json!(q.iter().map(|m| m.0).collect::<Vec<_>>()), &format!("quatuor {k}, tirage {j}"));
            n += 1;
        }
    }
    assert!(n >= 400, "{n}");
}

/// Une ligne `items` de la v1, notes en entiers.
struct Titre<'a>(&'a Value);

impl Titre<'_> {
    fn id(&self) -> i64 {
        i(&self.0["id"])
    }
    fn vu_et_note(&self) -> Option<i16> {
        (self.0["watch_status"] == "Watched").then(|| oi(&self.0["rating"]).map(|r| r as i16)).flatten()
    }
    fn valide(&self) -> bool {
        oi(&self.0["tier_rating"]).is_some() && self.0["tier_rating"] == self.0["rating"]
    }
}

#[test]
fn les_etapes_et_le_classement_sont_ceux_de_la_v1() {
    let v = charger();
    let (mut etapes, mut classements) = (0, 0);
    for (k, bib) in v["bibliotheques"].as_array().unwrap().iter().enumerate() {
        let titres: Vec<Titre> = bib["lignes"].as_array().unwrap().iter().map(Titre).collect();
        let dans = |cat: &str| -> HashSet<i64> { bib["categories"][cat].as_array().unwrap().iter().map(i).collect() };
        let fiches: HashMap<i64, Fiche> = titres
            .iter()
            .map(|t| (t.id(), Fiche { nom: os(&t.0["name"]).unwrap(), annee: os(&t.0["year"]), genres: Some(t.0["genre"].clone()).filter(|g| !g.is_null()), affiche: os(&t.0["poster_path"]) }))
            .collect();
        for (j, e) in bib["etapes"].as_array().unwrap().iter().enumerate() {
            let ids = dans(e["cat"].as_str().unwrap());
            let mut p: HashMap<i16, Vec<Membre>> = HashMap::new();
            for t in titres.iter().filter(|t| ids.contains(&t.id())) {
                let Some(note) = t.vu_et_note() else { continue };
                let valide = t.valide();
                p.entry(note).or_default().push(Membre {
                    id: t.id(),
                    comparaisons: if valide { i(&t.0["tier_duels_count"]) as i32 } else { 0 },
                    score: if valide { f(&t.0["tier_elo"]) } else { 1200.0 },
                    groupe: if valide { oi(&t.0["tier_band"]).map(|b| b as i16) } else { None },
                });
            }
            let etape = paliers::etape(&p, i(&e["stars"]) as i16, &mut lehmer(i(&e["graine"])), e["refine"].as_bool().unwrap());
            verifier(&e["attendu"], &paliers::etape_json(&etape, &fiches).unwrap(), &format!("bibliothèque {k}, étape {j}"));
            etapes += 1;
        }
        for c in bib["classements"].as_array().unwrap() {
            let ids = dans(c["cat"].as_str().unwrap());
            let mut lignes = vec![];
            let mut sans_note = 0;
            for t in titres.iter().filter(|t| ids.contains(&t.id()) && t.0["watch_status"] == "Watched") {
                let Some(note) = t.vu_et_note() else {
                    sans_note += 1;
                    continue;
                };
                let valide = t.valide();
                let comparaisons = i(&t.0["tier_duels_count"]) as i32;
                lignes.push(Ligne {
                    id: t.id(),
                    note,
                    nom: os(&t.0["name"]).unwrap(),
                    rang_nom: i(&bib["rangs"][t.0["name"].as_str().unwrap()]),
                    annee: os(&t.0["year"]),
                    affiche: os(&t.0["poster_path"]),
                    elo: f(&t.0["elo_score"]),
                    duels: i(&t.0["duels_count"]) as i32,
                    score: (valide && comparaisons > 0).then(|| f(&t.0["tier_elo"])),
                    comparaisons: if valide { comparaisons } else { 0 },
                    groupe: if valide { oi(&t.0["tier_band"]).map(|b| b as i16) } else { None },
                });
            }
            verifier(&c["attendu"], &classement::classement(&lignes, sans_note), &format!("bibliothèque {k}, classement {}", c["cat"]));
            classements += 1;
        }
    }
    assert!(etapes >= 200 && classements >= 70, "{etapes} étapes, {classements} classements");
}

fn ligne_titre(t: &Value) -> LigneTitre {
    LigneTitre {
        id: i(&t["id"]),
        note: oi(&t["rating"]).map(|r| r as i16),
        statut: os(&t["watch_status"]),
        note_palier: oi(&t["tier_rating"]).map(|r| r as i16),
        elo_palier: f(&t["tier_elo"]),
        comparaisons: i(&t["tier_duels_count"]) as i32,
        groupe: oi(&t["tier_band"]).map(|b| b as i16),
    }
}

#[test]
fn les_repartitions_quatuors_et_annulations_rendent_les_memes_etats() {
    let v = charger();
    let mut n = 0;
    for (k, cas) in v["manches"].as_array().unwrap().iter().enumerate() {
        let mut lignes: HashMap<i64, LigneTitre> = cas["avant"].as_array().unwrap().iter().map(|t| (i(&t["id"]), ligne_titre(t))).collect();
        let mut manches: Vec<(i64, Vec<Value>)> = vec![];
        let mut compteur = 0;
        // `writeRound` : les nouveaux états, puis la manche (identifiants croissants, jamais réutilisés).
        fn ecrire(lignes: &mut HashMap<i64, LigneTitre>, manches: &mut Vec<(i64, Vec<Value>)>, compteur: &mut i64, c: Vec<Changement>) -> Value {
            for ch in &c {
                let l = lignes.get_mut(&ch.id).unwrap();
                (l.elo_palier, l.comparaisons, l.groupe, l.note_palier) = (ch.apres.elo, ch.apres.count, ch.apres.band, ch.apres.rating);
            }
            *compteur += 1;
            let e = |s: &paliers::EtatPalier| json!({ "elo": s.elo, "count": s.count, "band": s.band, "rating": s.rating });
            let elements = c.iter().map(|ch| json!({ "id": ch.id, "before": e(&ch.avant), "after": e(&ch.apres) })).collect();
            manches.push((*compteur, elements));
            json!({ "roundId": *compteur })
        }
        let refus = |r: Refus| json!({ "error": if r == Refus::Perime { "stale" } else { "invalid" } });
        for (j, op) in cas["ops"].as_array().unwrap().iter().enumerate() {
            let obtenu = match op["kind"].as_str().unwrap() {
                "band" => match paliers::repartition(lignes.get(&i(&op["itemId"])), i(&op["stars"]) as i16, i(&op["band"]) as i16) {
                    Ok(c) => ecrire(&mut lignes, &mut manches, &mut compteur, vec![c]),
                    Err(r) => refus(r),
                },
                "quad" => {
                    let ids: Vec<f64> = op["itemIds"].as_array().unwrap().iter().map(f).collect();
                    let pire = op["worstId"].as_f64();
                    match paliers::quatuor(&ids, &lignes, i(&op["stars"]) as i16, f(&op["bestId"]), pire) {
                        Ok(c) => ecrire(&mut lignes, &mut manches, &mut compteur, c),
                        Err(r) => refus(r),
                    }
                }
                "undo" => {
                    let id = i(&op["roundId"]);
                    match manches.iter().position(|m| m.0 == id) {
                        None => json!({ "error": "not_found" }),
                        Some(p) => match paliers::defaire(&manches[p].1, &lignes).unwrap() {
                            None => json!({ "error": "conflict" }),
                            Some(etats) => {
                                for (t, e) in etats {
                                    let l = lignes.get_mut(&t).unwrap();
                                    (l.elo_palier, l.comparaisons, l.groupe, l.note_palier) = (e.elo, e.count, e.band, e.rating);
                                }
                                manches.remove(p);
                                json!({ "ok": true })
                            }
                        },
                    }
                }
                _ => {
                    let l = lignes.get_mut(&i(&op["id"])).unwrap();
                    if l.statut.as_deref() == Some("Watched") {
                        l.note = Some(i(&op["rating"]) as i16);
                    }
                    continue;
                }
            };
            verifier(&op["resultat"], &obtenu, &format!("manches {k}, opération {j}"));
            n += 1;
        }
        for t in cas["apres"].as_array().unwrap() {
            let attendu = ligne_titre(t);
            let obtenu = &lignes[&attendu.id];
            assert_eq!(
                (attendu.elo_palier.to_bits(), attendu.comparaisons, attendu.groupe, attendu.note_palier),
                (obtenu.elo_palier.to_bits(), obtenu.comparaisons, obtenu.groupe, obtenu.note_palier),
                "manches {k}, état final du titre {} ({} / {})",
                attendu.id,
                attendu.elo_palier,
                obtenu.elo_palier
            );
        }
    }
    assert!(n >= 600, "{n}");
}

#[test]
fn la_vue_personnes_le_duel_suivant_et_la_portee_sont_ceux_de_la_v1() {
    let v = charger();
    let mut paires = 0;
    for (k, cas) in v["personnes"].as_array().unwrap().iter().enumerate() {
        let lignes: Vec<&Value> = cas["lignes"].as_array().unwrap().iter().collect();
        let avec_traits: Vec<&&Value> = lignes.iter().filter(|t| t.get("tmdb_features").is_some()).collect();
        let people: Vec<&Value> = cas["people"].as_array().unwrap().iter().collect();

        // getPeopleWithOpinions
        let avis: Vec<Avis> = cas["opinions"]
            .as_array()
            .unwrap()
            .iter()
            .map(|o| Avis { id: i(&o["person_id"]), nom: os(&o["name"]).unwrap(), avis: i(&o["opinion"]) as i16, note: oi(&o["rating"]).map(|r| r as i16), modifie: os(&o["updated_at"]).unwrap() })
            .collect();
        let titres: Vec<TitreCredite> = avec_traits
            .iter()
            .map(|t| TitreCredite {
                id: i(&t["id"]),
                nom: os(&t["name"]).unwrap(),
                annee: os(&t["year"]),
                affiche: os(&t["poster_path"]),
                statut: os(&t["watch_status"]),
                etoiles: oi(&t["rating"]).map(|r| r as i32),
                traits: t["tmdb_features"].clone(),
            })
            .collect();
        let elos: HashMap<i64, f64> = people.iter().filter(|p| i(&p["duels_count"]) > 0).map(|p| (i(&p["id"]), f(&p["elo_score"]))).collect();
        verifier(&cas["vue"], &json!(vue_personnes(&avis, &titres, &elos)), &format!("personnes {k}, vue"));

        // getNextPersonDuel, Math.random remplacé par le générateur
        let vus: Vec<(String, Option<i32>, Value)> =
            avec_traits.iter().filter(|t| t["watch_status"] == "Watched").map(|t| (os(&t["name"]).unwrap(), oi(&t["rating"]).map(|r| r as i32), t["tmdb_features"].clone())).collect();
        let eligibles = apparitions(&vus);
        let score = |id: i64| people.iter().find(|p| i(&p["id"]) == id).map_or((1200.0, 0), |p| (f(&p["elo_score"]), i(&p["duels_count"]) as i32));
        let obtenu = if eligibles.len() < 2 {
            json!({ "error": "not_enough_people", "eligibleCount": eligibles.len() })
        } else {
            let mut lot: Vec<(i64, i32)> = eligibles.iter().map(|p| (p.id, score(p.id).1)).collect();
            lot.sort_by_key(|x| x.0); // `WHERE id IN (…)` de SQLite : par identifiant
            let duels = cas["duels"].as_array().unwrap();
            let recentes: HashSet<String> = duels.iter().rev().take(50).map(|d| crate::duels_personnes::cle_paire(i(&d[0]), i(&d[1]))).collect();
            let (a, b) = choisir_paire(&lot, &recentes, &mut lehmer(i(&cas["graine"]))).unwrap();
            let carte = |id: i64| personne_duel(eligibles.iter().find(|p| p.id == id).unwrap(), score(id).0, score(id).1);
            paires += 1;
            json!({ "personA": carte(a), "personB": carte(b) })
        };
        verifier(&cas["suivant"], &obtenu, &format!("personnes {k}, duel suivant"));

        // getPersonScope : les nouveaux inscrits partent de 1200 et 0 duel, ils ne comptent pas.
        let notes = people.iter().filter(|p| f(&p["elo_score"]) != 1200.0 || i(&p["duels_count"]) > 0).count();
        verifier(&cas["portee"], &json!({ "eligible": eligibles.len(), "scored": notes }), &format!("personnes {k}, portée"));
    }
    assert!(paires >= 10, "{paires}");
}
