//! Dates de sortie : reprend la partie serveur de src/lib/release.ts (specs/sorties-v1.md FR-1, AC-4).
//! Le badge (« Au cinéma », « À venir ») se calcule dans l'interface, au jour d'affichage : il n'est pas ici.
use serde_json::{Value, json};

/// `validDay` : une date qui commence par « AAAA-MM-JJ », réduite à ces dix caractères.
fn jour_valide(valeur: Option<&Value>) -> Option<String> {
    let s = valeur?.as_str()?;
    let b = s.as_bytes();
    let chiffres = |de: usize, a: usize| b[de..a].iter().all(u8::is_ascii_digit);
    (b.len() >= 10 && chiffres(0, 4) && b[4] == b'-' && chiffres(5, 7) && b[7] == b'-' && chiffres(8, 10)).then(|| s[..10].to_owned())
}

/// `earliestOfType` : la plus ancienne date d'un des types demandés, dans l'ordre de préférence des types.
fn plus_ancienne(dates: &[Value], types: &[f64]) -> Option<String> {
    for t in types {
        let mut jours: Vec<String> =
            dates.iter().filter(|d| d.get("type").and_then(Value::as_f64) == Some(*t)).filter_map(|d| jour_valide(d.get("release_date"))).collect();
        jours.sort();
        if let Some(premier) = jours.into_iter().next() {
            return Some(premier);
        }
    }
    None
}

/// `releaseFromTmdb` : les dates d'une fiche TMDB (enrichie de `release_dates` pour un film). Films :
/// sortie en salle en France (type 3, sinon 2), à défaut la date mondiale ; sortie numérique (type 4).
/// Séries : première diffusion, prochain épisode annoncé, statut. `maintenant` : le `fetchedAt`.
pub fn depuis_tmdb(brut: &Value, est_film: bool, maintenant: &str) -> Value {
    let statut = brut.get("status").filter(|s| s.is_string()).cloned().unwrap_or(Value::Null);
    if est_film {
        let france = brut
            .pointer("/release_dates/results")
            .and_then(Value::as_array)
            .and_then(|r| r.iter().find(|p| p.get("iso_3166_1").and_then(Value::as_str) == Some("FR")))
            .and_then(|p| p.get("release_dates"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        return json!({
            "kind": "movie",
            "theatrical": plus_ancienne(&france, &[3.0, 2.0]).or_else(|| jour_valide(brut.get("release_date"))),
            "digital": plus_ancienne(&france, &[4.0]),
            "firstAir": null,
            "nextEpisode": null,
            "status": statut,
            "fetchedAt": maintenant,
        });
    }
    let suivant = brut.get("next_episode_to_air").filter(|n| n.is_object());
    let date = jour_valide(suivant.and_then(|n| n.get("air_date")));
    let nombre = |cle: &str| suivant.and_then(|n| n.get(cle)).filter(|v| v.is_number()).cloned();
    let prochain = match (date, nombre("season_number"), nombre("episode_number")) {
        (Some(date), Some(saison), Some(episode)) => json!({ "date": date, "season": saison, "episode": episode }),
        _ => Value::Null,
    };
    json!({
        "kind": "tv",
        "theatrical": null,
        "digital": null,
        "firstAir": jour_valide(brut.get("first_air_date")),
        "nextEpisode": prochain,
        "status": statut,
        "fetchedAt": maintenant,
    })
}

#[cfg(test)]
mod tests {
    // Cas de src/lib/release.test.ts, « releaseFromTmdb (AC-4) », mêmes entrées et mêmes valeurs attendues.
    use super::*;

    const AUJOURD_HUI: &str = "2026-09-26T10:00:00.000Z";

    #[test]
    fn retient_la_plus_ancienne_sortie_francaise_en_salle_et_la_sortie_numerique() {
        let info = depuis_tmdb(
            &json!({
                "status": "Released",
                "release_date": "2026-08-20",
                "release_dates": { "results": [
                    { "iso_3166_1": "US", "release_dates": [{ "type": 3, "release_date": "2026-08-20T00:00:00.000Z" }] },
                    { "iso_3166_1": "FR", "release_dates": [
                        { "type": 1, "release_date": "2026-05-18T00:00:00.000Z" },
                        { "type": 3, "release_date": "2026-09-17T00:00:00.000Z" },
                        { "type": 3, "release_date": "2026-09-10T00:00:00.000Z" },
                        { "type": 4, "release_date": "2026-12-01T00:00:00.000Z" }
                    ] }
                ] }
            }),
            true,
            AUJOURD_HUI,
        );
        assert_eq!(info["kind"], "movie");
        assert_eq!(info["theatrical"], "2026-09-10");
        assert_eq!(info["digital"], "2026-12-01");
    }

    #[test]
    fn retombe_sur_la_date_mondiale_sans_sortie_francaise_et_sur_la_sortie_limitee_sans_sortie_large() {
        assert_eq!(depuis_tmdb(&json!({ "release_date": "2026-10-30" }), true, AUJOURD_HUI)["theatrical"], "2026-10-30");
        let limitee = json!({
            "release_date": "2026-10-30",
            "release_dates": { "results": [{ "iso_3166_1": "FR", "release_dates": [{ "type": 2, "release_date": "2026-11-05" }] }] }
        });
        assert_eq!(depuis_tmdb(&limitee, true, AUJOURD_HUI)["theatrical"], "2026-11-05");
    }

    #[test]
    fn lit_la_premiere_diffusion_et_le_prochain_episode_d_une_serie() {
        let info = depuis_tmdb(
            &json!({
                "status": "Returning Series",
                "first_air_date": "2019-07-26",
                "next_episode_to_air": { "air_date": "2026-10-08", "season_number": 5, "episode_number": 1 }
            }),
            false,
            AUJOURD_HUI,
        );
        assert_eq!(info["kind"], "tv");
        assert_eq!(info["firstAir"], "2019-07-26");
        assert_eq!(info["nextEpisode"], json!({ "date": "2026-10-08", "season": 5, "episode": 1 }));
        assert_eq!(info["status"], "Returning Series");
    }

    #[test]
    fn ignore_une_date_vide_ou_mal_formee() {
        let info = depuis_tmdb(&json!({ "first_air_date": "", "next_episode_to_air": { "air_date": null } }), false, AUJOURD_HUI);
        assert_eq!(info["firstAir"], Value::Null);
        assert_eq!(info["nextEpisode"], Value::Null);
    }
}
