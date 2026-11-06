//! Équivalences de JavaScript, pour lire et rendre exactement ce que lisait et rendait la v1 (TypeScript) :
//! `Number(texte)` (un segment d'adresse), `Number.isInteger` (un champ JSON), les espaces de `\s` et de
//! `trim()`, la longueur d'une chaîne (en unités UTF-16) et l'écriture d'un nombre en JSON (`3`, pas `3.0`).

use serde_json::Value;

/// Un caractère de `\s` (et de `trim()`) en JavaScript : espaces blancs et fins de ligne. Diffère de
/// `char::is_whitespace` de Rust sur U+0085 (pas un espace en JS) et U+FEFF (un espace en JS).
pub fn espace(c: char) -> bool {
    matches!(c, '\u{9}'..='\u{D}' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}')
}

/// `texte.trim()`.
pub fn trim(texte: &str) -> &str {
    texte.trim_matches(espace)
}

/// `texte.length` : en unités UTF-16 (une émoji hors du plan de base compte 2).
pub fn longueur(texte: &str) -> usize {
    texte.encode_utf16().count()
}

/// `Number(texte)` ; `None` pour NaN. Chaîne vide (après `trim`) : 0 ; `0x`, `0o`, `0b` ; `Infinity` signé ;
/// décimal avec signe, point et exposant facultatifs (`1e3`, `.5`, `5.`).
pub fn nombre(texte: &str) -> Option<f64> {
    let t = trim(texte);
    if t.is_empty() {
        return Some(0.0);
    }
    for (prefixe, base) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
        if let Some(chiffres) = t.strip_prefix(prefixe) {
            if chiffres.is_empty() || !chiffres.chars().all(|c| c.is_digit(base)) {
                return None;
            }
            return Some(chiffres.chars().fold(0.0, |acc, c| acc * f64::from(base) + f64::from(c.to_digit(base).unwrap_or(0))));
        }
    }
    let (signe, corps) = match t.as_bytes()[0] {
        b'+' => (1.0, &t[1..]),
        b'-' => (-1.0, &t[1..]),
        _ => (1.0, t),
    };
    if corps == "Infinity" {
        return Some(signe * f64::INFINITY);
    }
    let octets = corps.as_bytes();
    let chiffres = |mut i: usize| {
        let debut = i;
        while i < octets.len() && octets[i].is_ascii_digit() {
            i += 1;
        }
        (i, i - debut)
    };
    let (mut i, avant) = chiffres(0);
    let mut apres = 0;
    if i < octets.len() && octets[i] == b'.' {
        (i, apres) = chiffres(i + 1);
    }
    if avant + apres == 0 {
        return None;
    }
    if i < octets.len() && (octets[i] == b'e' || octets[i] == b'E') {
        i += 1;
        if i < octets.len() && (octets[i] == b'+' || octets[i] == b'-') {
            i += 1;
        }
        let (fin, exposant) = chiffres(i);
        if exposant == 0 {
            return None;
        }
        i = fin;
    }
    if i != octets.len() {
        return None;
    }
    corps.parse::<f64>().ok().map(|v| signe * v)
}

/// Un identifiant lu comme `Number(segment)` : un entier, sinon `None` (aucune ligne ne peut correspondre).
/// Hors des bornes d'un `i64`, la valeur sature : elle ne désigne aucune ligne non plus.
pub fn identifiant(segment: &str) -> Option<i64> {
    nombre(segment).filter(|n| n.is_finite() && n.fract() == 0.0).map(|n| n as i64)
}

/// `typeof v === "number" && Number.isInteger(v)` : l'entier (saturé hors des bornes d'un `i64`).
pub fn entier(v: Option<&Value>) -> Option<i64> {
    let v = v?;
    if let Some(i) = v.as_i64() {
        return Some(i);
    }
    if let Some(u) = v.as_u64() {
        return Some(i64::try_from(u).unwrap_or(i64::MAX));
    }
    v.as_f64().filter(|f| f.is_finite() && f.fract() == 0.0).map(|f| f as i64)
}

/// `isId` de la v1 : un entier strictement positif.
pub fn est_id(v: Option<&Value>) -> Option<i64> {
    entier(v).filter(|n| *n > 0)
}

/// Un nombre écrit comme `JSON.stringify` : `3` pour un entier, `0.5` sinon, `null` pour NaN ou l'infini.
pub fn nombre_json(n: f64) -> Value {
    if n.is_finite() && n.fract() == 0.0 && n.abs() < 9_007_199_254_740_992.0 {
        Value::from(n as i64)
    } else {
        serde_json::Number::from_f64(n).map(Value::Number).unwrap_or(Value::Null)
    }
}

/// `String(v)` pour une valeur JSON simple (une chaîne reste telle quelle).
pub fn chaine(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        Value::Null => "null".into(),
        Value::Number(n) => n.as_f64().map(|f| nombre_json(f).to_string()).unwrap_or_else(|| n.to_string()),
        autre => autre.to_string(),
    }
}

// ---------------------------------------------------------------------------------------------
// Ajouts du groupe 3 (recommandations, découverte, Ce soir, Sorties, accueil)
// ---------------------------------------------------------------------------------------------

use crate::fraicheur::{date_civile, decalage_paris, jours_depuis_epoque};

/// `Number(texte)` avec NaN (pour les calculs qui le propagent, comme `Number("2013–2022")`).
pub fn nombre_ou_nan(texte: &str) -> f64 {
    nombre(texte).unwrap_or(f64::NAN)
}

/// Indice de fin de `tableau.slice(0, fin)` (fin : un nombre JavaScript, NaN compris).
pub fn fin_slice(fin: f64, longueur: usize) -> usize {
    let n = longueur as f64;
    let entier = if fin.is_nan() { 0.0 } else { fin.trunc() };
    (if entier < 0.0 { (n + entier).max(0.0) } else { entier.min(n) }) as usize
}

/// Indice de départ de `tableau.slice(debut)`.
pub fn debut_slice(debut: f64, longueur: usize) -> usize {
    fin_slice(debut, longueur)
}

pub const JOUR_MS: i64 = 24 * 60 * 60 * 1000;

pub fn maintenant_ms() -> i64 {
    crate::fraicheur::maintenant_ms()
}

/// `Date.UTC(annee, mois0, jour)` (mois de 0 à 11 ; débordements normalisés comme JavaScript).
pub fn date_utc(annee: i64, mois0: i64, jour: i64) -> i64 {
    jours_depuis_epoque(annee + mois0.div_euclid(12), mois0.rem_euclid(12) + 1, jour) * JOUR_MS
}

fn jour_texte(ms: i64) -> String {
    let (a, m, j) = date_civile(ms.div_euclid(JOUR_MS));
    format!("{a:04}-{m:02}-{j:02}")
}

/// `new Date(ms).toISOString()`.
pub fn iso(ms: i64) -> String {
    let d = ms.rem_euclid(JOUR_MS);
    format!("{}T{:02}:{:02}:{:02}.{:03}Z", jour_texte(ms), d / 3_600_000, d / 60_000 % 60, d / 1000 % 60, d % 1000)
}

/// `new Date(ms).toISOString().slice(0, 10)`.
pub fn jour_utc(ms: i64) -> String {
    jour_texte(ms)
}

/// Le jour local (Paris : la v1 tourne sur l'ordinateur de Louis) d'un instant, « AAAA-MM-JJ ».
pub fn jour_paris(ms: i64) -> String {
    jour_texte(ms + decalage_paris(ms))
}

/// `new Date().getFullYear()` à Paris.
pub fn annee_paris(ms: i64) -> i64 {
    date_civile((ms + decalage_paris(ms)).div_euclid(JOUR_MS)).0
}

/// `new Date("AAAA-MM-JJ").getTime()` : minuit UTC ; mois 01 à 12, jour 01 à 31 (un 30 février déborde sur
/// mars, comme V8) ; `None` = date invalide (NaN).
pub fn date_iso(texte: &str) -> Option<i64> {
    let o = texte.as_bytes();
    if o.len() != 10 || o[4] != b'-' || o[7] != b'-' {
        return None;
    }
    let num = |a: usize, b: usize| -> Option<i64> { texte.get(a..b).filter(|s| s.bytes().all(|c| c.is_ascii_digit()))?.parse().ok() };
    let (annee, mois, jour) = (num(0, 4)?, num(5, 7)?, num(8, 10)?);
    if !(1..=12).contains(&mois) || !(1..=31).contains(&jour) {
        return None;
    }
    Some(jours_depuis_epoque(annee, mois, jour) * JOUR_MS)
}

/// `/^\d{4}-\d{2}-\d{2}/`.
pub fn commence_par_un_jour(texte: &str) -> bool {
    let o = texte.as_bytes();
    o.len() >= 10 && o[..4].iter().all(u8::is_ascii_digit) && o[4] == b'-' && o[5..7].iter().all(u8::is_ascii_digit) && o[7] == b'-' && o[8..10].iter().all(u8::is_ascii_digit)
}

/// `closeTo` (src/lib/format.ts) : « Proche du Seigneur des anneaux », « Proche des Visiteurs », « Proche de La Haine ».
pub fn proche_de(titre: &str) -> String {
    let fin_de_ligne = |s: &str| s.contains(['\n', '\r', '\u{2028}', '\u{2029}']);
    for (article, contracte) in [("Le ", "du"), ("Les ", "des")] {
        if let Some(reste) = titre.strip_prefix(article)
            && !reste.is_empty() && !fin_de_ligne(reste) {
                return format!("Proche {contracte} {reste}");
            }
    }
    format!("Proche de {titre}")
}

#[cfg(test)]
mod tests_groupe3 {
    use super::*;

    #[test]
    fn slice_comme_javascript() {
        assert_eq!(fin_slice(10.0, 5), 5);
        assert_eq!(fin_slice(2.5, 5), 2);
        assert_eq!(fin_slice(-1.0, 5), 4);
        assert_eq!(fin_slice(f64::NAN, 5), 0);
        assert_eq!(fin_slice(f64::INFINITY, 5), 5);
        assert!(nombre_ou_nan("2013–2022").is_nan());
    }

    #[test]
    fn dates_comme_javascript() {
        // Valeurs relevées dans Node : new Date("…").getTime(), toISOString().
        assert_eq!(date_iso("2026-02-30"), Some(1772409600000));
        assert_eq!(date_iso("2026-04-31"), Some(1777593600000));
        assert_eq!(date_iso("2026-13-01"), None);
        assert_eq!(date_iso("2026-04-00"), None);
        assert_eq!(date_iso("0000-01-01"), Some(-62167219200000));
        assert_eq!(iso(1761660101409), "2025-10-28T14:01:41.409Z");
        assert_eq!(date_utc(2026, 12, 1), date_utc(2027, 0, 1));
        assert_eq!(jour_paris(date_utc(2026, 9, 9) + 23 * 3_600_000), "2026-10-10");
        assert_eq!(annee_paris(date_utc(2026, 11, 31) + 23 * 3_600_000 + 30 * 60_000), 2027);
    }

    #[test]
    fn proche_de_contracte_l_article() {
        assert_eq!(proche_de("Le Seigneur des anneaux"), "Proche du Seigneur des anneaux");
        assert_eq!(proche_de("Les Visiteurs"), "Proche des Visiteurs");
        assert_eq!(proche_de("La Haine"), "Proche de La Haine");
        assert_eq!(proche_de("Breaking Bad"), "Proche de Breaking Bad");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn number_lit_un_segment_comme_javascript() {
        assert_eq!(nombre("12"), Some(12.0));
        assert_eq!(nombre(" 12 "), Some(12.0));
        assert_eq!(nombre(""), Some(0.0));
        assert_eq!(nombre("0x10"), Some(16.0));
        assert_eq!(nombre("1e3"), Some(1000.0));
        assert_eq!(nombre("1.0"), Some(1.0));
        assert_eq!(nombre(".5"), Some(0.5));
        assert_eq!(nombre("5."), Some(5.0));
        assert_eq!(nombre("-Infinity"), Some(f64::NEG_INFINITY));
        for nan in ["abc", "1a", ".", "e5", "1e", "-0x10", "infinity", "1_000", "0x"] {
            assert_eq!(nombre(nan), None, "{nan}");
        }
        assert_eq!(identifiant("1.5"), None);
        assert_eq!(identifiant("7"), Some(7));
        assert_eq!(identifiant("abc"), None);
    }

    #[test]
    fn is_integer_accepte_un_entier_ecrit_en_flottant() {
        assert_eq!(entier(Some(&json!(5))), Some(5));
        assert_eq!(entier(Some(&json!(5.0))), Some(5));
        assert_eq!(entier(Some(&json!(5.5))), None);
        assert_eq!(entier(Some(&json!("5"))), None);
        assert_eq!(entier(None), None);
        assert_eq!(est_id(Some(&json!(0))), None);
        assert_eq!(est_id(Some(&json!(-3))), None);
    }

    #[test]
    fn trim_et_longueur_suivent_javascript() {
        assert_eq!(trim("\u{FEFF} a \u{A0}"), "a");
        assert_eq!(trim("\u{85}a"), "\u{85}a");
        assert_eq!(longueur("é"), 1);
        assert_eq!(longueur("🎬"), 2);
    }

    #[test]
    fn un_nombre_s_ecrit_comme_json_stringify() {
        assert_eq!(nombre_json(3.0).to_string(), "3");
        assert_eq!(nombre_json(0.5).to_string(), "0.5");
        assert_eq!(nombre_json(2.0 / 3.0).to_string(), "0.6666666666666666");
        assert_eq!(nombre_json(f64::NAN), Value::Null);
    }
}
