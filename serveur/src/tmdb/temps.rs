//! Dates telles que JavaScript les écrit et les lit, sans dépendance : `new Date().toISOString()` pour les
//! `fetchedAt` des JSON stockés, `new Date(texte)` pour savoir s'ils sont périmés (`isStale`,
//! `isReleaseStale` de la v1).
use serde_json::Value;
use std::time::{SystemTime, UNIX_EPOCH};

/// Au-delà, la disponibilité et les dates de sortie sont redemandées à TMDB (`AVAILABILITY_TTL_MS`,
/// `RELEASE_TTL_MS` : 7 jours tous les deux).
pub const TTL_MS: f64 = 7.0 * 24.0 * 60.0 * 60.0 * 1000.0;

/// Millisecondes depuis l'époque Unix (`Date.now()`).
pub fn maintenant_ms() -> f64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as f64).unwrap_or(0.0)
}

/// `new Date().toISOString()`.
pub fn maintenant_iso() -> String {
    iso(maintenant_ms() as i64)
}

/// `new Date(ms).toISOString()` : « 2026-10-28T12:34:56.789Z ».
pub fn iso(ms: i64) -> String {
    let (jours, reste) = (ms.div_euclid(86_400_000), ms.rem_euclid(86_400_000));
    let (a, m, j) = civil(jours);
    format!("{a:04}-{m:02}-{j:02}T{:02}:{:02}:{:02}.{:03}Z", reste / 3_600_000, reste / 60_000 % 60, reste / 1000 % 60, reste % 1000)
}

/// Jour civil (année, mois, jour) d'un nombre de jours depuis le 1970-01-01 (algorithme de H. Hinnant).
fn civil(jours: i64) -> (i64, i64, i64) {
    let z = jours + 719_468;
    let ere = z.div_euclid(146_097);
    let jde = z.rem_euclid(146_097);
    let ade = (jde - jde / 1460 + jde / 36_524 - jde / 146_096) / 365;
    let jda = jde - (365 * ade + ade / 4 - ade / 100);
    let mp = (5 * jda + 2) / 153;
    let j = jda - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    (ade + ere * 400 + i64::from(m <= 2), m, j)
}

/// Nombre de jours depuis le 1970-01-01 d'un jour civil (inverse de `civil`).
fn jours_depuis(a: i64, m: i64, j: i64) -> i64 {
    let a = if m <= 2 { a - 1 } else { a };
    let ere = a.div_euclid(400);
    let ade = a.rem_euclid(400);
    let jda = (153 * (if m > 2 { m - 3 } else { m + 9 }) + 2) / 5 + j - 1;
    ere * 146_097 + ade * 365 + ade / 4 - ade / 100 + jda - 719_468
}

/// Lit une date ISO 8601 comme `new Date(texte)` : « AAAA-MM-JJ » (minuit UTC), et
/// « AAAA-MM-JJTHH:MM[:SS[.mmm]] » suivi de « Z » ou d'un décalage « ±HH:MM ». Sans décalage, l'heure est
/// lue en UTC (le serveur hébergé tourne en UTC). `None` là où JavaScript rend une date invalide.
pub fn lire_iso(texte: &str) -> Option<f64> {
    let b = texte.as_bytes();
    let chiffres = |de: usize, a: usize| -> Option<i64> {
        let s = texte.get(de..a)?;
        s.bytes().all(|c| c.is_ascii_digit()).then(|| s.parse().ok())?
    };
    if b.len() < 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let (a, m, j) = (chiffres(0, 4)?, chiffres(5, 7)?, chiffres(8, 10)?);
    if !(1..=12).contains(&m) || !(1..=31).contains(&j) {
        return None;
    }
    let mut ms = jours_depuis(a, m, j) * 86_400_000;
    if b.len() == 10 {
        return Some(ms as f64);
    }
    if b[10] != b'T' || b.len() < 16 || b[13] != b':' {
        return None;
    }
    let (h, mi) = (chiffres(11, 13)?, chiffres(14, 16)?);
    let mut i = 16;
    let mut s = 0;
    let mut milli = 0;
    if b.get(i) == Some(&b':') {
        s = chiffres(i + 1, i + 3)?;
        i += 3;
        if b.get(i) == Some(&b'.') {
            let debut = i + 1;
            let mut fin = debut;
            while b.get(fin).is_some_and(u8::is_ascii_digit) {
                fin += 1;
            }
            if fin == debut {
                return None;
            }
            // Les millièmes : les trois premiers chiffres, complétés de zéros.
            let frac = &texte[debut..fin];
            milli = format!("{:0<3}", &frac[..frac.len().min(3)]).parse::<i64>().ok()?;
            i = fin;
        }
    }
    if h > 24 || mi > 59 || s > 59 {
        return None;
    }
    ms += h * 3_600_000 + mi * 60_000 + s * 1000 + milli;
    match &texte[i..] {
        "" | "Z" => Some(ms as f64),
        decalage if decalage.len() == 6 && (decalage.starts_with('+') || decalage.starts_with('-')) && &decalage[3..4] == ":" => {
            let (dh, dm) = (chiffres(i + 1, i + 3)?, chiffres(i + 4, i + 6)?);
            let d = (dh * 60 + dm) * 60_000;
            Some((if decalage.starts_with('+') { ms - d } else { ms + d }) as f64)
        }
        _ => None,
    }
}

/// `new Date(valeur).getTime()` pour ce que contient un `fetchedAt` : un texte ISO ou un nombre de
/// millisecondes ; `None` (NaN) sinon.
fn date_ms(valeur: Option<&Value>) -> Option<f64> {
    match valeur? {
        Value::String(s) => lire_iso(s),
        Value::Number(n) => n.as_f64(),
        _ => None,
    }
}

/// `isStale` (disponibilité) et `isReleaseStale` (dates de sortie) de la v1 : périmé si absent, ou
/// récupéré il y a plus de 7 jours. Une date illisible donne NaN en JavaScript, et `NaN > TTL` est faux :
/// pas périmé.
pub fn perime(info: Option<&Value>, maintenant_ms: f64) -> bool {
    let Some(info) = info.filter(|v| !v.is_null()) else { return true };
    date_ms(info.get("fetchedAt")).is_some_and(|quand| maintenant_ms - quand > TTL_MS)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn la_date_s_ecrit_comme_to_iso_string() {
        assert_eq!(iso(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(iso(1_758_801_600_000), "2025-09-25T12:00:00.000Z");
        assert_eq!(iso(951_782_400_123), "2000-02-29T00:00:00.123Z");
        assert_eq!(iso(-1), "1969-12-31T23:59:59.999Z");
    }

    #[test]
    fn la_date_se_lit_comme_new_date() {
        assert_eq!(lire_iso("2026-09-25T12:00:00.000Z"), Some(1_790_337_600_000.0));
        assert_eq!(lire_iso("2026-09-25"), Some(1_790_294_400_000.0));
        assert_eq!(lire_iso("2026-09-25T14:00:00+02:00"), Some(1_790_337_600_000.0));
        assert_eq!(lire_iso("2026-09-25T12:00Z"), Some(1_790_337_600_000.0));
        assert_eq!(lire_iso("2026-09-25T12:00:00.5Z"), Some(1_790_337_600_500.0));
        for invalide in ["", "hier", "2026-13-01", "2026-09-25 12:00", "2026-09-25T12:00:00.000ZZ"] {
            assert_eq!(lire_iso(invalide), None, "{invalide}");
        }
        for ms in [0, 1_790_337_600_123, 4_102_444_800_000] {
            assert_eq!(lire_iso(&iso(ms)), Some(ms as f64));
        }
    }

    #[test]
    fn une_date_illisible_n_est_pas_perimee_comme_en_javascript() {
        let maintenant = lire_iso("2026-09-25T12:00:00Z").unwrap();
        assert!(perime(None, maintenant));
        assert!(perime(Some(&Value::Null), maintenant));
        assert!(!perime(Some(&json!({ "fetchedAt": "jamais" })), maintenant));
        assert!(!perime(Some(&json!({})), maintenant));
    }
}
