// Contrat des routes qui n'existent qu'en v2 : ajouter et retirer un titre SANS l'ancien service de
// notes (FR-1, AC-1). La v1 ne peut pas les passer (elle exige l'ancien service) : le contrat est
// écrit à la main, d'après ce que renvoyait la v1 (src/lib/libraryActions.ts) moins ce qui disparaît.
//
// À passer sur un compte VIERGE (bibliothèque vide) d'une COPIE JETABLE, avec un accès à TMDB.
// Même exécuteur que les autres écritures (ecritures.mjs). Ports 3000 et 3001 refusés.
//   node parite/check-v2.mjs http://localhost:PORT
// spec: specs/catalog-v2-rust-supabase.md (FR-1, FR-7, AC-1)
import fs from "node:fs";

const contrat = JSON.parse(fs.readFileSync(new URL("./contrat.json", import.meta.url), "utf8"));

/** Un titre de la bibliothèque, tel que la v1 le rend (GET /api/items/:id) ; la v2 y perd `notionPageId`. */
const titre = contrat.item.shape;

/** Contrat attendu, appel par appel. */
export const contratV2 = {
  "ajouter-titre": { status: 201, shape: { alreadyExists: "boolean", item: titre } },
  "titre-present": { status: 200, shape: titre },
  "ajouter-titre-deja-present": { status: 200, shape: { alreadyExists: "boolean", item: titre } },
  "ajouter-invalide": { status: 400, shape: { error: "string" } },
  "ajouter-tmdb-inconnu": { status: 404, shape: { error: "string" } },
  "retirer-titre": { status: 200, shape: { ok: "boolean" } },
  "titre-retire": { status: 404, shape: { error: "string" } },
  "retirer-inconnu": { status: 404, shape: { error: "string" } },
};

/**
 * Les scénarios. Ils vérifient aussi ce qu'une forme ne dit pas : le titre est bien là après
 * l'ajout, il n'y est plus après le retrait, et le retrait ne touche pas le catalogue partagé
 * (vérifié avec deux comptes, voir les tests d'étanchéité).
 */
export async function scenariosV2(base, call) {
  const ajout = await call("ajouter-titre", "POST", "/api/items", { tmdbId: 603, type: "Movie", source: "search" }, { status: 201 });
  const id = ajout.json?.item?.id;
  await call("titre-present", "GET", `/api/items/${id}`, undefined, { status: 200 });
  // Ajouter deux fois le même titre ne le duplique pas.
  await call("ajouter-titre-deja-present", "POST", "/api/items", { tmdbId: 603, type: "Movie", source: "search" }, { status: 200 });
  await call("ajouter-invalide", "POST", "/api/items", { tmdbId: "x", type: "Film" }, { status: 400 });
  await call("ajouter-tmdb-inconnu", "POST", "/api/items", { tmdbId: 999999999, type: "Movie" }, { status: 404 });
  await call("retirer-titre", "DELETE", `/api/items/${id}`, undefined, { status: 200 });
  await call("titre-retire", "GET", `/api/items/${id}`, undefined, { status: 404 });
  await call("retirer-inconnu", "DELETE", "/api/items/99999999", undefined, { status: 404 });
}
