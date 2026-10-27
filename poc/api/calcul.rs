// POC (phase 0) : un calcul de la même famille que le modèle de recommandation, pour voir si le
// Rust tient la durée d'une fonction. C'est un SUBSTITUT : 1 100 titres décrits par ~30 traits parmi
// 3 000 (genres, mots-clés, distribution), comparés deux à deux par similarité cosinus creuse. Ce n'est
// pas le vrai modèle (`src/lib/preferenceService.ts`) : on mesure un ordre de grandeur, pas une parité.
// spec: specs/catalog-v2-rust-supabase.md (NFR-2)
use serde_json::{Value, json};
use std::time::Instant;
use vercel_runtime::{Error, Request, run, service_fn};

#[tokio::main]
async fn main() -> Result<(), Error> {
    run(service_fn(handler)).await
}

struct Alea(u64);
impl Alea {
    fn suivant(&mut self) -> u64 {
        self.0 ^= self.0 << 13;
        self.0 ^= self.0 >> 7;
        self.0 ^= self.0 << 17;
        self.0
    }
}

async fn handler(_req: Request) -> Result<Value, Error> {
    const TITRES: usize = 1100;
    const TRAITS: usize = 30;
    const UNIVERS: u64 = 3000;

    let t0 = Instant::now();
    let mut alea = Alea(0x9E37_79B9_7F4A_7C15);
    // Chaque titre : une liste triée de (trait, poids).
    let titres: Vec<Vec<(u32, f32)>> = (0..TITRES)
        .map(|_| {
            let mut v: Vec<(u32, f32)> = (0..TRAITS).map(|_| ((alea.suivant() % UNIVERS) as u32, 1.0 + (alea.suivant() % 4) as f32)).collect();
            v.sort_by_key(|t| t.0);
            v.dedup_by_key(|t| t.0);
            v
        })
        .collect();
    let normes: Vec<f32> = titres.iter().map(|t| t.iter().map(|(_, w)| w * w).sum::<f32>().sqrt()).collect();
    let t_prepa = t0.elapsed().as_millis() as u64;

    let t1 = Instant::now();
    let mut somme = 0.0f64;
    let mut paires = 0u64;
    for i in 0..TITRES {
        for j in (i + 1)..TITRES {
            let (a, b) = (&titres[i], &titres[j]);
            let (mut x, mut y, mut dot) = (0, 0, 0.0f32);
            while x < a.len() && y < b.len() {
                match a[x].0.cmp(&b[y].0) {
                    std::cmp::Ordering::Less => x += 1,
                    std::cmp::Ordering::Greater => y += 1,
                    std::cmp::Ordering::Equal => {
                        dot += a[x].1 * b[y].1;
                        x += 1;
                        y += 1;
                    }
                }
            }
            somme += (dot / (normes[i] * normes[j])) as f64;
            paires += 1;
        }
    }
    Ok(json!({
        "ok": true,
        "titres": TITRES,
        "paires": paires,
        "preparation_ms": t_prepa,
        "comparaisons_ms": t1.elapsed().as_millis() as u64,
        "total_ms": t0.elapsed().as_millis() as u64,
        "controle": somme
    }))
}
