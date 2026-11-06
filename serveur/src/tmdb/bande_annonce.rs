//! Bandes-annonces : reprend la partie serveur de src/lib/trailer.ts (choix de la vidéo) et
//! src/lib/youtube.ts (lecture permise hors de YouTube, d'après oEmbed). specs/bandes-annonces-v1.md
//! FR-1, FR-2, FR-8. Le lecteur, ses réglages et ses messages d'échec restent dans l'interface.
use serde_json::{Map, Value};
use std::{
    collections::HashMap,
    future::Future,
    sync::{LazyLock, Mutex},
    time::Duration,
};

/// Langues des vidéos demandées à TMDB, en un seul appel (`TRAILER_VIDEO_LANGUAGES`).
pub const LANGUES_VIDEOS: &str = "fr,en,null";
/// Au-delà, on s'arrête : quelques vidéos suffisent à trouver une version lisible (`MAX_CHECKS`).
const VERIFICATIONS_MAX: usize = 4;
const DELAI_OEMBED: Duration = Duration::from_millis(3000);

/// Une vidéo candidate (`Trailer` sans les champs de la vérification).
#[derive(Clone, Debug, PartialEq)]
pub struct Candidate {
    pub cle: String,
    pub nom: String,
    pub langue: Option<String>,
    /// « Trailer » ou « Teaser ».
    pub genre: &'static str,
}

impl Candidate {
    fn json(&self) -> Map<String, Value> {
        let mut m = Map::new();
        m.insert("key".into(), Value::String(self.cle.clone()));
        m.insert("name".into(), Value::String(self.nom.clone()));
        m.insert("language".into(), self.langue.clone().map(Value::String).unwrap_or(Value::Null));
        m.insert("kind".into(), Value::String(self.genre.into()));
        m
    }
}

fn rang_langue(langue: Option<&str>) -> u8 {
    match langue {
        Some("fr") => 0,
        Some("en") => 1,
        None => 2,
        Some(_) => 3,
    }
}

/// `rankTrailers` : bande-annonce avant teaser (jamais d'extrait ni de making-of), français, puis anglais,
/// puis sans langue ; officielle d'abord ; la plus récente. Seulement YouTube.
pub fn classer(videos: Option<&Value>) -> Vec<Candidate> {
    struct Brute {
        c: Candidate,
        officielle: bool,
        publiee: String,
    }
    let mut liste: Vec<Brute> = videos
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .filter_map(|v| {
            let cle = v.get("key").and_then(Value::as_str).filter(|k| !k.is_empty())?;
            let genre = match v.get("type").and_then(Value::as_str)? {
                "Trailer" => "Trailer",
                "Teaser" => "Teaser",
                _ => return None,
            };
            if v.get("site").and_then(Value::as_str) != Some("YouTube") {
                return None;
            }
            Some(Brute {
                c: Candidate {
                    cle: cle.to_owned(),
                    nom: v.get("name").and_then(Value::as_str).unwrap_or("Bande-annonce").to_owned(),
                    langue: v.get("iso_639_1").and_then(Value::as_str).filter(|l| !l.is_empty()).map(str::to_owned),
                    genre,
                },
                officielle: v.get("official") == Some(&Value::Bool(true)),
                publiee: v.get("published_at").and_then(Value::as_str).unwrap_or("").to_owned(),
            })
        })
        .collect();
    // Tri stable, comme Array.prototype.sort ; les dates ISO se comparent comme des chaînes (localeCompare).
    liste.sort_by(|a, b| {
        (a.c.genre != "Trailer")
            .cmp(&(b.c.genre != "Trailer"))
            .then(rang_langue(a.c.langue.as_deref()).cmp(&rang_langue(b.c.langue.as_deref())))
            .then(b.officielle.cmp(&a.officielle))
            .then(b.publiee.cmp(&a.publiee))
    });
    liste.into_iter().map(|b| b.c).collect()
}

/// Ce que YouTube dit d'une vidéo (`EmbedCheck`).
#[derive(Clone, Debug, PartialEq)]
pub enum Lecture {
    /// La chaîne autorise la lecture intégrée ; son nom quand on le connaît.
    Integrable(Option<String>),
    /// Réservée à YouTube par sa chaîne (oEmbed 401, 403).
    Reservee,
    /// Retirée ou privée (oEmbed 404, 400).
    Retiree,
    /// Réseau, délai, réponse inattendue : on ne sait pas, on ne pénalise pas.
    Inconnue,
}

/// `interpretOEmbed`.
pub fn lire_oembed(statut: u16, corps: Option<&Value>) -> Lecture {
    match statut {
        200 => Lecture::Integrable(corps.and_then(|c| c.get("author_name")).and_then(Value::as_str).filter(|n| !n.is_empty()).map(str::to_owned)),
        401 | 403 => Lecture::Reservee,
        404 | 400 => Lecture::Retiree,
        _ => Lecture::Inconnue,
    }
}

/// `chooseTrailer` : dans l'ordre de préférence, la première vidéo que sa chaîne autorise hors de YouTube
/// (les vidéos retirées sont sautées) ; à défaut, la meilleure réservée à YouTube, marquée
/// `embeddable: false`. Un doute (réseau) garde la vidéo telle quelle. `null` s'il n'y en a pas.
pub async fn choisir<F, Fut>(candidates: &[Candidate], verifier: F) -> Value
where
    F: Fn(String) -> Fut,
    Fut: Future<Output = Lecture>,
{
    let mut reservee: Option<Value> = None;
    for candidate in candidates.iter().take(VERIFICATIONS_MAX) {
        match verifier(candidate.cle.clone()).await {
            Lecture::Integrable(chaine) => {
                let mut m = candidate.json();
                m.insert("embeddable".into(), Value::Bool(true));
                m.insert("channel".into(), chaine.map(Value::String).unwrap_or(Value::Null));
                return Value::Object(m);
            }
            Lecture::Inconnue => return Value::Object(candidate.json()),
            Lecture::Reservee if reservee.is_none() => {
                let mut m = candidate.json();
                m.insert("embeddable".into(), Value::Bool(false));
                reservee = Some(Value::Object(m));
            }
            Lecture::Reservee | Lecture::Retiree => {}
        }
    }
    reservee.unwrap_or(Value::Null)
}

/// Réponses de YouTube déjà connues, le temps du processus ; un doute n'y reste pas (comme `youtube.ts`).
static VERIFIEES: LazyLock<Mutex<HashMap<String, Lecture>>> = LazyLock::new(|| Mutex::new(HashMap::new()));

/// `checkYouTubeVideo` : point d'accès public oEmbed, sans clé, 3 s au plus.
pub async fn verifier_youtube(cle: String) -> Lecture {
    if let Some(connue) = VERIFIEES.lock().ok().and_then(|c| c.get(&cle).cloned()) {
        return connue;
    }
    let adresse = format!("https://www.youtube.com/oembed?format=json&url={}", super::encoder_composant(&format!("https://www.youtube.com/watch?v={cle}")));
    let lecture = match super::client().await.get(adresse).timeout(DELAI_OEMBED).send().await {
        Err(_) => Lecture::Inconnue,
        Ok(reponse) => {
            let statut = reponse.status().as_u16();
            if reponse.status().is_success() {
                match reponse.json::<Value>().await {
                    Ok(corps) => lire_oembed(statut, Some(&corps)),
                    Err(_) => Lecture::Inconnue,
                }
            } else {
                lire_oembed(statut, None)
            }
        }
    };
    if lecture != Lecture::Inconnue
        && let Ok(mut cache) = VERIFIEES.lock()
    {
        cache.insert(cle, lecture.clone());
    }
    lecture
}

#[cfg(test)]
mod tests {
    // Cas de src/lib/trailer.test.ts (« pickTrailer », « choix d'une bande-annonce lisible (FR-8) »),
    // mêmes entrées et mêmes valeurs attendues. `pickTrailer` = le premier de `rankTrailers`.
    use super::*;
    use serde_json::json;

    fn video(surcharges: Value) -> Value {
        let mut v = json!({ "site": "YouTube", "key": "k", "type": "Trailer", "iso_639_1": "fr", "official": true,
            "name": "Bande-annonce", "published_at": "2024-01-01T00:00:00.000Z" });
        for (k, x) in surcharges.as_object().unwrap() {
            v[k] = x.clone();
        }
        v
    }
    fn premiere(videos: Value) -> Option<Candidate> {
        classer(Some(&videos)).into_iter().next()
    }

    #[test]
    fn prefere_une_bande_annonce_a_un_teaser_ou_un_extrait_meme_en_anglais() {
        let choisie = premiere(json!([video(json!({ "key": "clip-fr", "type": "Clip" })), video(json!({ "key": "teaser-fr", "type": "Teaser" })), video(json!({ "key": "trailer-en", "iso_639_1": "en" }))])).unwrap();
        assert_eq!((choisie.cle.as_str(), choisie.genre, choisie.langue.as_deref()), ("trailer-en", "Trailer", Some("en")));
    }

    #[test]
    fn a_langue_egale_l_officielle_puis_la_plus_recente() {
        assert_eq!(premiere(json!([video(json!({ "key": "fan", "official": false })), video(json!({ "key": "officielle", "official": true }))])).unwrap().cle, "officielle");
        assert_eq!(
            premiere(json!([video(json!({ "key": "ancienne", "published_at": "2020-01-01T00:00:00.000Z" })), video(json!({ "key": "récente", "published_at": "2023-05-01T00:00:00.000Z" }))])).unwrap().cle,
            "récente"
        );
    }

    #[test]
    fn ne_retient_ni_extrait_ni_making_of_ni_video_hors_youtube() {
        assert_eq!(premiere(json!([video(json!({ "type": "Clip" })), video(json!({ "type": "Featurette" })), video(json!({ "type": "Behind the Scenes" })), video(json!({ "site": "Vimeo" }))])), None);
        assert_eq!(classer(None).first(), None);
    }

    #[test]
    fn le_francais_passe_devant_l_anglais_l_anglais_devant_une_video_sans_langue() {
        assert_eq!(premiere(json!([video(json!({ "key": "sans", "iso_639_1": null })), video(json!({ "key": "en", "iso_639_1": "en" })), video(json!({ "key": "fr" }))])).unwrap().cle, "fr");
        assert_eq!(premiere(json!([video(json!({ "key": "sans", "iso_639_1": null })), video(json!({ "key": "en", "iso_639_1": "en" }))])).unwrap().cle, "en");
    }

    fn candidates() -> Vec<Candidate> {
        classer(Some(&json!([video(json!({ "key": "vf-officielle" })), video(json!({ "key": "vf-fan", "official": false })), video(json!({ "key": "vo", "iso_639_1": "en" }))])))
    }

    #[test]
    fn lit_la_reponse_d_oembed() {
        assert_eq!(lire_oembed(200, Some(&json!({ "author_name": "Gaumont" }))), Lecture::Integrable(Some("Gaumont".into())));
        assert_eq!(lire_oembed(401, None), Lecture::Reservee);
        assert_eq!(lire_oembed(404, None), Lecture::Retiree);
        assert_eq!(lire_oembed(500, None), Lecture::Inconnue);
    }

    #[test]
    fn garde_l_ordre_de_preference_et_prend_la_premiere() {
        assert_eq!(candidates().iter().map(|c| c.cle.as_str()).collect::<Vec<_>>(), ["vf-officielle", "vf-fan", "vo"]);
        assert_eq!(premiere(json!([video(json!({ "key": "vf-fan", "official": false })), video(json!({ "key": "vf-officielle" }))])).unwrap().cle, "vf-officielle");
    }

    #[tokio::test]
    async fn saute_une_video_reservee_ou_retiree_pour_la_suivante_lisible_avec_sa_chaine() {
        let choisie = choisir(&candidates(), |cle| async move {
            match cle.as_str() {
                "vf-officielle" => Lecture::Reservee,
                "vf-fan" => Lecture::Retiree,
                _ => Lecture::Integrable(Some("Pathé Cinémas".into())),
            }
        })
        .await;
        assert_eq!((&choisie["key"], &choisie["embeddable"], &choisie["channel"]), (&json!("vo"), &json!(true), &json!("Pathé Cinémas")));
    }

    #[tokio::test]
    async fn sans_version_lisible_garde_la_meilleure_reservee_a_youtube_marquee() {
        let choisie = choisir(&candidates(), |_| async { Lecture::Reservee }).await;
        assert_eq!((&choisie["key"], &choisie["embeddable"]), (&json!("vf-officielle"), &json!(false)));
    }

    #[tokio::test]
    async fn un_doute_reseau_ne_penalise_pas_la_video() {
        let choisie = choisir(&candidates(), |_| async { Lecture::Inconnue }).await;
        assert_eq!(choisie["key"], "vf-officielle");
        assert!(choisie.get("embeddable").is_none());
    }
}
