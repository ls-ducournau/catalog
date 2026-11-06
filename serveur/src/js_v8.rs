//! Ce que la v1 tient de JavaScript (moteur V8) et dont dépend le 1 pour 1 : la conversion `Number(…)` d'une
//! valeur reçue, le tri d'Array.prototype.sort de V8 (avec un comparateur au hasard, l'ordre obtenu
//! dépend de l'algorithme), `Math.random`, et `URLSearchParams.get` (la première occurrence).
use serde_json::Value;
use std::cmp::Ordering;

/// Un nombre au hasard dans [0, 1[, comme `Math.random` (xorshift64*, graine prise à l'horloge).
pub(crate) fn hasard() -> f64 {
    use std::sync::atomic::{AtomicU64, Ordering};
    static ETAT: AtomicU64 = AtomicU64::new(0);
    let mut x = ETAT.load(Ordering::Relaxed);
    if x == 0 {
        x = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_nanos() as u64).unwrap_or(0x9E37_79B9_7F4A_7C15) | 1;
    }
    x ^= x >> 12;
    x ^= x << 25;
    x ^= x >> 27;
    ETAT.store(x, Ordering::Relaxed);
    (x.wrapping_mul(0x2545_F491_4F6C_DD1D) >> 11) as f64 / (1u64 << 53) as f64
}

/// `URLSearchParams.get` : la première valeur d'un paramètre (Axum garde la dernière dans une table).
pub(crate) fn premier<'a>(p: &'a [(String, String)], cle: &str) -> Option<&'a str> {
    p.iter().find(|(k, _)| k == cle).map(|(_, v)| v.as_str())
}

/// Blancs retirés par `Number(" 4 ")` (WhiteSpace et LineTerminator de l'ECMAScript).
fn blanc_js(c: char) -> bool {
    matches!(c, '\u{9}' | '\u{A}' | '\u{B}' | '\u{C}' | '\u{D}' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}')
}

/// `Number(chaine)` (StringToNumber) : blancs autour ignorés, vide = 0, `Infinity`, décimal avec
/// exposant, `0x`, `0o`, `0b` ; tout le reste vaut NaN.
pub(crate) fn nombre_chaine(s: &str) -> f64 {
    let s = s.trim_matches(blanc_js);
    if s.is_empty() {
        return 0.0;
    }
    for (prefixe, base) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
        if let Some(chiffres) = s.strip_prefix(prefixe) {
            if chiffres.is_empty() || !chiffres.chars().all(|c| c.is_digit(base)) {
                return f64::NAN;
            }
            return chiffres.chars().fold(0.0, |n, c| n * f64::from(base) + f64::from(c.to_digit(base).unwrap_or(0)));
        }
    }
    let (signe, corps) = match s.as_bytes()[0] {
        b'+' => (1.0, &s[1..]),
        b'-' => (-1.0, &s[1..]),
        _ => (1.0, s),
    };
    if corps == "Infinity" {
        return signe * f64::INFINITY;
    }
    // StrUnsignedDecimalLiteral : chiffres [. chiffres] ou . chiffres, puis un exposant facultatif.
    let octets = corps.as_bytes();
    let mut i = 0;
    let entiers = octets.iter().take_while(|c| c.is_ascii_digit()).count();
    i += entiers;
    let mut decimales = 0;
    if i < octets.len() && octets[i] == b'.' {
        i += 1;
        decimales = octets[i..].iter().take_while(|c| c.is_ascii_digit()).count();
        i += decimales;
    }
    if entiers == 0 && decimales == 0 {
        return f64::NAN;
    }
    if i < octets.len() && (octets[i] == b'e' || octets[i] == b'E') {
        i += 1;
        if i < octets.len() && (octets[i] == b'+' || octets[i] == b'-') {
            i += 1;
        }
        let exposant = octets[i..].iter().take_while(|c| c.is_ascii_digit()).count();
        if exposant == 0 {
            return f64::NAN;
        }
        i += exposant;
    }
    if i != octets.len() {
        return f64::NAN;
    }
    // Rust lit « 5. » et « .5 » comme JavaScript ; l'arrondi est le même (au plus proche).
    corps.parse::<f64>().map(|n| signe * n).unwrap_or(f64::NAN)
}

/// `Number(valeur)` pour une valeur JSON (ToNumber) : booléen 0 ou 1, chaîne lue par `nombre_chaine`,
/// tableau d'abord joint par des virgules (`[]` vaut 0, `[3]` vaut 3), objet NaN.
pub(crate) fn nombre(v: &Value) -> f64 {
    match v {
        Value::Null => 0.0,
        Value::Bool(b) => f64::from(u8::from(*b)),
        Value::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Value::String(s) => nombre_chaine(s),
        Value::Array(_) => nombre_chaine(&chaine(v)),
        Value::Object(_) => f64::NAN,
    }
}

/// `String(valeur)` dans le seul usage qui compte ici (`Number([…])`) : un nombre y est écrit sous une
/// forme qui se relit à l'identique.
fn chaine(v: &Value) -> String {
    match v {
        Value::Null => String::new(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.as_f64().map(|f| format!("{f}")).unwrap_or_default(),
        Value::String(s) => s.clone(),
        Value::Array(a) => a.iter().map(chaine).collect::<Vec<_>>().join(","),
        Value::Object(_) => "[object Object]".into(),
    }
}

/// Un nombre JSON qui désigne une ligne (`WHERE id = ?`) : un entier exact, sinon aucune ligne ne
/// lui correspond (comme SQLite avec 3.5 ou 1e300).
pub(crate) fn identifiant(v: &Value) -> Option<i64> {
    let n = v.as_f64()?;
    (n.fract() == 0.0 && n.abs() < 9.0e15).then_some(n as i64)
}

/// Comme `identifiant`, pour une colonne `integer` (personnes TMDB).
pub(crate) fn identifiant_i32(v: &Value) -> Option<i32> {
    identifiant(v).and_then(|n| i32::try_from(n).ok())
}

/// Array.prototype.sort de V8 (TimSort) sur un tableau de moins de 64 éléments : une course initiale
/// (`CountAndMakeRun`), retournée si elle descend, puis le tri par insertion binaire. Avec un
/// comparateur au hasard (`() => rng() - 0.5`), c'est la seule façon d'obtenir le même ordre, appel
/// pour appel. Au-delà de 63 éléments, tri stable ordinaire (exact pour un comparateur cohérent).
pub(crate) fn tri_v8<T>(v: &mut [T], mut comparer: impl FnMut(&T, &T) -> f64) {
    let n = v.len();
    if n < 2 {
        return;
    }
    let mut cmp = |a: &T, b: &T| {
        let r = comparer(a, b);
        if r.is_nan() { 0.0 } else { r }
    };
    if n >= 64 {
        v.sort_by(|a, b| cmp(a, b).partial_cmp(&0.0).unwrap_or(Ordering::Equal));
        return;
    }
    // CountAndMakeRun(0, n)
    let mut course = 2;
    let descend = cmp(&v[1], &v[0]) < 0.0;
    for i in 2..n {
        let ordre = cmp(&v[i], &v[i - 1]);
        if (descend && ordre >= 0.0) || (!descend && ordre < 0.0) {
            break;
        }
        course += 1;
    }
    if descend {
        v[..course].reverse();
    }
    // BinaryInsertionSort(0, course, n)
    for debut in course..n {
        let (mut gauche, mut droite) = (0, debut);
        while gauche < droite {
            let milieu = gauche + ((droite - gauche) >> 1);
            if cmp(&v[debut], &v[milieu]) < 0.0 {
                droite = milieu;
            } else {
                gauche = milieu + 1;
            }
        }
        v[gauche..=debut].rotate_right(1);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn number_lit_comme_javascript() {
        assert_eq!(nombre_chaine("4"), 4.0);
        assert_eq!(nombre_chaine(" 4 \n"), 4.0);
        assert_eq!(nombre_chaine("  "), 0.0);
        assert_eq!(nombre_chaine("4.0"), 4.0);
        assert_eq!(nombre_chaine("0x3"), 3.0);
        assert_eq!(nombre_chaine("0b11"), 3.0);
        assert_eq!(nombre_chaine("3e0"), 3.0);
        assert_eq!(nombre_chaine("+2"), 2.0);
        assert_eq!(nombre_chaine(".5"), 0.5);
        assert_eq!(nombre_chaine("5."), 5.0);
        assert!(nombre_chaine("-0").is_sign_negative());
        assert_eq!(nombre_chaine("-Infinity"), f64::NEG_INFINITY);
        for nan in ["abc", "4a", "inf", "NaN", "infinity", "0x", "-0x3", "1e", "e3", ".", "1_0", "١"] {
            assert!(nombre_chaine(nan).is_nan(), "{nan}");
        }
        assert_eq!(nombre(&json!(true)), 1.0);
        assert_eq!(nombre(&json!([])), 0.0);
        assert_eq!(nombre(&json!([3])), 3.0);
        assert_eq!(nombre(&json!([["2"]])), 2.0);
        assert!(nombre(&json!([1, 2])).is_nan());
        assert!(nombre(&json!({})).is_nan());
    }

    #[test]
    fn identifiant_exige_un_entier() {
        assert_eq!(identifiant(&json!(3)), Some(3));
        assert_eq!(identifiant(&json!(3.0)), Some(3));
        assert_eq!(identifiant(&json!(3.5)), None);
        assert_eq!(identifiant(&json!(1e300)), None);
        assert_eq!(identifiant(&json!("3")), None);
        assert_eq!(identifiant_i32(&json!(3_000_000_000_i64)), None);
    }

    #[test]
    fn le_tri_v8_est_stable_et_suit_le_comparateur() {
        let mut v = vec![(3, 'a'), (1, 'b'), (3, 'c'), (2, 'd'), (1, 'e')];
        tri_v8(&mut v, |a, b| f64::from(a.0 - b.0));
        assert_eq!(v, vec![(1, 'b'), (1, 'e'), (2, 'd'), (3, 'a'), (3, 'c')]);
        // Une course descendante stricte est retournée d'un bloc.
        let mut w = vec![5, 4, 3, 2, 1];
        let mut appels = 0;
        tri_v8(&mut w, |a, b| {
            appels += 1;
            f64::from(*a - *b)
        });
        assert_eq!(w, vec![1, 2, 3, 4, 5]);
        assert_eq!(appels, 4);
    }
}
