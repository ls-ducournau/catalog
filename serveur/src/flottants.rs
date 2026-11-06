//! Les fonctions mathématiques de V8 (Node), pour que le modèle de préférence calcule les MÊMES flottants
//! que la v1, bit à bit. V8 implémente `Math.log`, `Math.log1p` et `Math.exp` avec fdlibm (Sun
//! Microsystems, via FreeBSD : src/base/ieee754.cc) ; la bibliothèque standard de Rust appelle celle du
//! système, qui arrondit parfois autrement (1 ulp sur ~5 % des logarithmes, mesuré). Un écart d'1 ulp
//! suffit à inverser deux titres à égalité apparente : le portage est donc exact, et vérifié contre V8
//! (800 000 cas tirés au hasard, aucun écart ; test `identique_a_v8_sur_un_oracle`).
//!
//! `**` n'est pas fdlibm dans V8 (76 écarts sur 451 avec un portage de e_pow.c) : la v1 ne s'en sert que
//! pour le poids d'un jour de lassitude, `0.5 ** ((jours - 1) / 7)` avec un nombre entier de jours ; ces
//! valeurs sont relevées dans V8 (`POIDS_LASSITUDE_V8`). `Math.sqrt` est exact (IEEE 754) : `f64::sqrt`
//! convient. `x ** 2` vaut exactement `x * x` dans V8 (vérifié sur un million de valeurs).
#![allow(clippy::excessive_precision, clippy::unreadable_literal)]

fn haut(x: f64) -> i32 {
    (x.to_bits() >> 32) as i32
}
fn bas(x: f64) -> u32 {
    x.to_bits() as u32
}
fn avec_haut(x: f64, h: i32) -> f64 {
    f64::from_bits(((h as u32 as u64) << 32) | (x.to_bits() & 0xffff_ffff))
}
fn de(bits: u64) -> f64 {
    f64::from_bits(bits)
}

const LN2_HI: u64 = 0x3fe62e42fee00000;
const LN2_LO: u64 = 0x3dea39ef35793c76;
const TWO54: u64 = 0x4350000000000000;
const LG: [u64; 7] = [
    0x3FE5555555555593,
    0x3FD999999997FA04,
    0x3FD2492494229359,
    0x3FCC71C51D8E78AF,
    0x3FC7466496CB03DE,
    0x3FC39A09D078C69F,
    0x3FC2F112DF3E5244,
];

/// `Math.log` (fdlibm e_log.c).
pub fn log(x: f64) -> f64 {
    let (ln2_hi, ln2_lo, two54) = (de(LN2_HI), de(LN2_LO), de(TWO54));
    let [lg1, lg2, lg3, lg4, lg5, lg6, lg7] = LG.map(de);
    let mut x = x;
    let mut hx = haut(x);
    let lx = bas(x);
    let mut k: i32 = 0;
    if hx < 0x00100000 {
        if ((hx & 0x7fffffff) as u32 | lx) == 0 {
            return f64::NEG_INFINITY;
        }
        if hx < 0 {
            return f64::NAN;
        }
        k -= 54;
        x *= two54;
        hx = haut(x);
    }
    if hx >= 0x7ff00000 {
        return x + x;
    }
    k += (hx >> 20) - 1023;
    hx &= 0x000fffff;
    let i = (hx + 0x95f64) & 0x100000;
    x = avec_haut(x, hx | (i ^ 0x3ff00000));
    k += i >> 20;
    let f = x - 1.0;
    if (0x000fffff & (2 + hx)) < 3 {
        if f == 0.0 {
            if k == 0 {
                return 0.0;
            }
            let dk = f64::from(k);
            return dk * ln2_hi + dk * ln2_lo;
        }
        let r = f * f * (0.5 - 0.33333333333333333 * f);
        if k == 0 {
            return f - r;
        }
        let dk = f64::from(k);
        return dk * ln2_hi - ((r - dk * ln2_lo) - f);
    }
    let s = f / (2.0 + f);
    let dk = f64::from(k);
    let z = s * s;
    let mut i = hx - 0x6147a;
    let w = z * z;
    let j = 0x6b851 - hx;
    let t1 = w * (lg2 + w * (lg4 + w * lg6));
    let t2 = z * (lg1 + w * (lg3 + w * (lg5 + w * lg7)));
    i |= j;
    let r = t2 + t1;
    if i > 0 {
        let hfsq = 0.5 * f * f;
        if k == 0 { f - (hfsq - s * (hfsq + r)) } else { dk * ln2_hi - ((hfsq - (s * (hfsq + r) + dk * ln2_lo)) - f) }
    } else if k == 0 {
        f - s * (f - r)
    } else {
        dk * ln2_hi - ((s * (f - r) - dk * ln2_lo) - f)
    }
}

/// `Math.log1p` (fdlibm s_log1p.c).
pub fn log1p(x: f64) -> f64 {
    let (ln2_hi, ln2_lo, two54) = (de(LN2_HI), de(LN2_LO), de(TWO54));
    let [lp1, lp2, lp3, lp4, lp5, lp6, lp7] = LG.map(de);
    let hx = haut(x);
    let ax = hx & 0x7fffffff;
    let mut k: i32 = 1;
    let mut f = 0.0;
    let mut hu: i32 = 0;
    let mut c = 0.0;
    if hx < 0x3FDA827A {
        if ax >= 0x3ff00000 {
            return if x == -1.0 { f64::NEG_INFINITY } else { f64::NAN };
        }
        if ax < 0x3e200000 {
            if two54 + x > 0.0 && ax < 0x3c900000 {
                return x;
            }
            return x - x * x * 0.5;
        }
        if hx > 0 || hx <= 0xbfd2bec3_u32 as i32 {
            k = 0;
            f = x;
            hu = 1;
        }
    }
    if hx >= 0x7ff00000 {
        return x + x;
    }
    if k != 0 {
        let mut u;
        if hx < 0x43400000 {
            u = 1.0 + x;
            hu = haut(u);
            k = (hu >> 20) - 1023;
            c = if k > 0 { 1.0 - (u - x) } else { x - (u - 1.0) };
            c /= u;
        } else {
            u = x;
            hu = haut(u);
            k = (hu >> 20) - 1023;
            c = 0.0;
        }
        hu &= 0x000fffff;
        if hu < 0x6a09e {
            u = avec_haut(u, hu | 0x3ff00000);
        } else {
            k += 1;
            u = avec_haut(u, hu | 0x3fe00000);
            hu = (0x00100000 - hu) >> 2;
        }
        f = u - 1.0;
    }
    let hfsq = 0.5 * f * f;
    let dk = f64::from(k);
    if hu == 0 {
        if f == 0.0 {
            if k == 0 {
                return 0.0;
            }
            c += dk * ln2_lo;
            return dk * ln2_hi + c;
        }
        let r = hfsq * (1.0 - 0.66666666666666666 * f);
        if k == 0 {
            return f - r;
        }
        return dk * ln2_hi - ((r - (dk * ln2_lo + c)) - f);
    }
    let s = f / (2.0 + f);
    let z = s * s;
    let r = z * (lp1 + z * (lp2 + z * (lp3 + z * (lp4 + z * (lp5 + z * (lp6 + z * lp7))))));
    if k == 0 { f - (hfsq - s * (hfsq + r)) } else { dk * ln2_hi - ((hfsq - (s * (hfsq + r) + (dk * ln2_lo + c))) - f) }
}

/// 2^n en flottant, n dans la plage des exposants normaux.
fn deux_puissance(n: i32) -> f64 {
    f64::from_bits(((0x3ff + n) as u64) << 52)
}

/// x · 2^n par multiplications exactes (comme `scalbn` pour notre usage).
fn scalbn(x: f64, n: i32) -> f64 {
    let mut y = x;
    let mut n = n;
    while n > 1023 {
        y *= deux_puissance(1023);
        n -= 1023;
    }
    while n < -1022 {
        y *= deux_puissance(-1022);
        n += 1022;
        if y == 0.0 {
            return y;
        }
    }
    y * deux_puissance(n)
}

/// `Math.exp` (fdlibm e_exp.c).
pub fn exp(x: f64) -> f64 {
    let ln2_hi = [de(LN2_HI), -de(LN2_HI)];
    let ln2_lo = [de(LN2_LO), -de(LN2_LO)];
    let half = [0.5, -0.5];
    let invln2 = de(0x3ff71547652b82fe);
    let o_threshold = de(0x40862E42FEFA39EF);
    let u_threshold = de(0xC0874910D52D3051);
    let [p1, p2, p3, p4, p5] = [0x3FC555555555553Eu64, 0xBF66C16C16BEBD93, 0x3F11566AAF25DE2C, 0xBEBBBD41C5D26BF1, 0x3E66376972BEA4D0].map(de);
    let mut x = x;
    let mut hx = haut(x) as u32;
    let xsb = ((hx >> 31) & 1) as usize;
    hx &= 0x7fffffff;
    if hx >= 0x40862E42 {
        if hx >= 0x7ff00000 {
            if ((hx & 0xfffff) | bas(x)) != 0 {
                return x + x;
            }
            return if xsb == 0 { x } else { 0.0 };
        }
        if x > o_threshold {
            return f64::INFINITY;
        }
        if x < u_threshold {
            return 0.0;
        }
    }
    let (mut hi, mut lo, mut k) = (0.0, 0.0, 0i32);
    if hx > 0x3fd62e42 {
        if hx < 0x3FF0A2B2 {
            // Propre à V8 : exp(1) rend la constante E exacte (fdlibm se trompait du dernier bit).
            if x == 1.0 {
                return de(0x4005bf0a8b145769);
            }
            hi = x - ln2_hi[xsb];
            lo = ln2_lo[xsb];
            k = 1 - xsb as i32 - xsb as i32;
        } else {
            k = (invln2 * x + half[xsb]) as i32;
            let t = f64::from(k);
            hi = x - t * ln2_hi[0];
            lo = t * ln2_lo[0];
        }
        x = hi - lo;
    } else if hx < 0x3e300000 {
        if 1.0e300 + x > 1.0 {
            return 1.0 + x;
        }
    } else {
        k = 0;
    }
    let t = x * x;
    let c = x - t * (p1 + t * (p2 + t * (p3 + t * (p4 + t * p5))));
    if k == 0 {
        return 1.0 - ((x * c) / (c - 2.0) - x);
    }
    let y = 1.0 - ((lo - (x * c) / (2.0 - c)) - hi);
    scalbn(y, k)
}

/// `0.5 ** (k / 7)` tel que V8 le calcule, pour k = 0 à 44 (relevé dans Node 24, bits IEEE 754).
const POIDS_LASSITUDE_V8: [u64; 45] = [
    0x3ff0000000000000, 0x3fecfbb031a741a5, 0x3fea402feeb9c533, 0x3fe7c6a1f29e2ce6, 0x3fe588cea3f093be, 0x3fe381147622f886,
    0x3fe1aa59c4115e7e, 0x3fe0000000000000, 0x3fdcfbb031a741a5, 0x3fda402feeb9c532, 0x3fd7c6a1f29e2ce6, 0x3fd588cea3f093be,
    0x3fd381147622f887, 0x3fd1aa59c4115e7d, 0x3fd0000000000000, 0x3fccfbb031a741a5, 0x3fca402feeb9c533, 0x3fc7c6a1f29e2ce7,
    0x3fc588cea3f093bd, 0x3fc381147622f886, 0x3fc1aa59c4115e7d, 0x3fc0000000000000, 0x3fbcfbb031a741a5, 0x3fba402feeb9c533,
    0x3fb7c6a1f29e2ce7, 0x3fb588cea3f093bd, 0x3fb381147622f886, 0x3fb1aa59c4115e7d, 0x3fb0000000000000, 0x3facfbb031a741a2,
    0x3faa402feeb9c533, 0x3fa7c6a1f29e2ce5, 0x3fa588cea3f093bf, 0x3fa381147622f886, 0x3fa1aa59c4115e7f, 0x3fa0000000000000,
    0x3f9cfbb031a741a2, 0x3f9a402feeb9c533, 0x3f97c6a1f29e2ce5, 0x3f9588cea3f093bf, 0x3f9381147622f886, 0x3f91aa59c4115e7f,
    0x3f90000000000000, 0x3f8cfbb031a741a2, 0x3f8a402feeb9c533,
];

/// `0.5 ** (k / 7)` : exact (valeur de V8) pour un k entier de 0 à 44, le seul cas de la v1 ; sinon
/// la bibliothèque du système (jamais atteint par l'application).
pub fn demi_puissance_septiemes(k: f64) -> f64 {
    if k.fract() == 0.0 && (0.0..45.0).contains(&k) {
        return f64::from_bits(POIDS_LASSITUDE_V8[k as usize]);
    }
    0.5f64.powf(k / 7.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bits(h: &str) -> f64 {
        f64::from_bits(u64::from_str_radix(h, 16).unwrap())
    }

    /// Quelques valeurs relevées dans Node 24 (V8), en bits IEEE 754.
    #[test]
    fn quelques_valeurs_de_v8() {
        assert_eq!(log(2.0).to_bits(), 0x3fe62e42fefa39ef);
        assert_eq!(log(10.0).to_bits(), 0x40026bb1bbb55516);
        assert_eq!(exp(1.0).to_bits(), 0x4005bf0a8b145769);
        assert_eq!(log1p(5000.0), log(5001.0));
        assert_eq!(demi_puissance_septiemes(7.0), 0.5);
        assert_eq!(demi_puissance_septiemes(1.0).to_bits(), 0x3fecfbb031a741a5);
    }

    #[test]
    fn cas_particuliers() {
        assert_eq!(log(1.0), 0.0);
        assert_eq!(log(0.0), f64::NEG_INFINITY);
        assert!(log(-1.0).is_nan());
        assert_eq!(log1p(0.0), 0.0);
        assert_eq!(exp(0.0), 1.0);
        assert_eq!(exp(-1000.0), 0.0);
    }

    /// Comparaison complète avec un fichier de valeurs produit par Node (`fonction entrée sortie` en hexadécimal) :
    /// `ORACLE_V8=<fichier> cargo test --release flottants -- --ignored`.
    #[test]
    #[ignore]
    fn identique_a_v8_sur_un_oracle() {
        let Ok(chemin) = std::env::var("ORACLE_V8") else { return };
        let texte = std::fs::read_to_string(chemin).unwrap();
        let mut ecarts = std::collections::BTreeMap::<String, (u32, u32)>::new();
        for ligne in texte.lines() {
            let p: Vec<&str> = ligne.split(' ').collect();
            let x = bits(p[1]);
            let calcule = match p[0] {
                "exp" => exp(x),
                "log" => log(x),
                "log1p" => log1p(x),
                _ => continue,
            };
            let e = ecarts.entry(p[0].to_owned()).or_default();
            e.0 += 1;
            if calcule.to_bits() != bits(p[2]).to_bits() {
                e.1 += 1;
            }
        }
        println!("cas et écarts par fonction : {ecarts:?}");
        assert!(ecarts.values().all(|e| e.1 == 0), "{ecarts:?}");
    }
}
