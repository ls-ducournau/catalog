import { getDb } from "./db";
import { getVitrine, titleKey, withoutOwned, type Vitrine } from "./vitrine";

// La vitrine vue depuis la base locale (v1) : sans les titres que la bibliothèque contient déjà.
// En ligne (v2), le serveur Rust fait de même avec la bibliothèque du compte.

export function ownedTitleKeys(): Set<string> {
  const rows = getDb().prepare(`SELECT type, tmdb_id FROM items WHERE tmdb_id IS NOT NULL`).all() as {
    type: "Movie" | "TV Series";
    tmdb_id: number;
  }[];
  return new Set(rows.map((r) => titleKey(r.type, r.tmdb_id)));
}

export async function chargerVitrineLocale(): Promise<Vitrine> {
  return withoutOwned(await getVitrine(), ownedTitleKeys());
}
