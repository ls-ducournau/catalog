// Scénarios d'écriture du contrat. Chaque appel porte un identifiant : en enregistrement, on garde
// statut et forme ; en vérification, on les compare. Un scénario peut se servir des réponses
// précédentes (id d'une playlist créée, d'un duel…).
//
// RÈGLE : ces scénarios ÉCRIVENT. Ils ne tournent que sur une COPIE JETABLE de la base, neuve à
// chaque exécution (aucun retour à l'état initial n'est tenté). Les ports 3000 et 3001 sont refusés.
// Hors contrat v1 (elles passent par l'ancien service de notes) : ajout d'un titre depuis TMDB
// (POST /api/items, réponse « Oui » du tri rapide) et suppression d'un titre (DELETE /api/items/:id).
// Leur contrat est celui de la v2, à écrire avec elle.
// spec: specs/catalog-v2-rust-supabase.md (FR-7)
import { diff, shape } from "./shape.mjs";

/**
 * PARITE_SEULEMENT=duel-,palier- : ne joue que les appels dont l'identifiant commence ainsi (un serveur
 * en cours de portage). Un appel ignoré rend un statut 0 et aucune réponse.
 */
const SEULEMENT = process.env.PARITE_SEULEMENT?.split(",").filter(Boolean) ?? null;

export function makeRunner(base, { contract = null, v2 = false } = {}) {
  const results = {};
  async function call(id, method, path, body, { status } = {}) {
    if (SEULEMENT && !SEULEMENT.some((p) => id.startsWith(p))) return { status: 0, json: null };
    const res = await fetch(base + path, {
      method,
      headers: body === undefined ? undefined : { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => null);
    const entry = { method, path: path.replace(/\/\d+/g, "/:id"), status: res.status, shape: json === null ? "null" : shape(json) };
    const problems = [];
    if (status !== undefined && res.status !== status) problems.push(`statut ${res.status}, voulu ${status}`);
    if (contract) {
      const expected = contract[id];
      if (!expected) problems.push("absent du contrat");
      else if (res.status !== expected.status) problems.push(`statut ${res.status}, attendu ${expected.status}`);
      else problems.push(...diff(expected.shape, entry.shape, "$", { v2 }));
    }
    entry.problems = problems;
    results[id] = entry;
    return { status: res.status, json };
  }
  /** Une vérification de valeur (ce qu'une forme ne dit pas) : ok ou un message d'écart. */
  function controle(id, ok, message) {
    results[id] = { method: "-", path: "-", status: 0, shape: "null", problems: ok ? [] : [message] };
  }
  return { call, results, controle };
}

/** Une lecture d'exemple ; `{}` si la route n'existe pas encore (un serveur en cours de portage). */
const pick = async (base, path) => {
  try {
    return await (await fetch(base + path)).json();
  } catch {
    return {};
  }
};

/** Les scénarios, dans l'ordre. */
export async function scenarios(base, call) {
  const watched = (await pick(base, "/api/items?pageSize=4&watchStatus=Watched&sortBy=name")).items;
  const [a, b, c] = watched;

  // --- Notes et statuts
  const before = (await pick(base, `/api/items/${a.id}`)).rating ?? null;
  await call("note-poser", "PATCH", `/api/items/${a.id}`, { rating: "⭐️⭐️⭐️⭐️" });
  await call("statut-changer", "PATCH", `/api/items/${a.id}`, { watchStatus: "Unwatched" });
  await call("statut-rendre", "PATCH", `/api/items/${a.id}`, { watchStatus: "Watched", rating: before });
  await call("note-titre-inconnu", "PATCH", "/api/items/99999999", { rating: "⭐️⭐️" }, { status: 404 });

  // --- Titres écartés
  await call("ecarter", "POST", "/api/dismissals", { subject: { type: "item", id: b.id } });
  await call("ecarter-compte", "GET", "/api/dismissals");
  await call("ecarter-profil", "GET", "/api/profile/feedback");
  await call("ecarter-tmdb", "POST", "/api/dismissals", { subject: { type: "tmdb", tmdbId: 603, mediaType: "Movie" } });
  await call("ecarter-invalide", "POST", "/api/dismissals", { subject: { type: "autre" } }, { status: 400 });
  await call("reafficher", "DELETE", "/api/dismissals", { subject: { type: "item", id: b.id } });
  await call("reafficher-tout", "DELETE", "/api/dismissals", { all: true });

  // --- Abonnements
  const subs = (await pick(base, "/api/settings/subscriptions")).ids;
  await call("abonnements-ecrire", "PUT", "/api/settings/subscriptions", { ids: [8, 337] });
  await call("abonnements-invalide", "PUT", "/api/settings/subscriptions", { ids: "non" }, { status: 400 });
  await call("abonnements-rendre", "PUT", "/api/settings/subscriptions", { ids: subs });

  // --- Affichages et ouvertures (fraîcheur)
  await call("affichages", "POST", "/api/impressions", { surface: "pile", subjects: [`item:${a.id}`, `item:${b.id}`] });
  await call("affichages-invalide", "POST", "/api/impressions", { surface: "ailleurs", subjects: [] }, { status: 400 });
  await call("affichages-trop", "POST", "/api/impressions", { surface: "pile", subjects: Array.from({ length: 201 }, (_, i) => `item:${i + 1}`) }, { status: 400 });
  await call("ouverture", "POST", "/api/opened", { subject: `item:${a.id}` });
  await call("ouverture-tmdb", "POST", "/api/opened", { subject: "tmdb:movie:603" });
  await call("ouverture-invalide", "POST", "/api/opened", { subject: "n'importe quoi" }, { status: 400 });

  // --- Duels de titres
  const duel = await call("duel-resultat", "POST", "/api/duels/result", { itemAId: a.id, itemBId: b.id, result: "A" });
  await call("duel-resultat-invalide", "POST", "/api/duels/result", { itemAId: a.id, result: "?" }, { status: 400 });
  await call("duel-annuler", "POST", "/api/duels/undo", { mode: "titles", duelId: duel.json?.duelId ?? 1 });
  await call("duel-reinitialiser", "POST", "/api/duels/reset", { category: "Movie" });
  await call("duel-reinitialisation-annuler", "POST", "/api/duels/restore");

  // --- Duels de personnes et avis
  const pair = await pick(base, "/api/duels/people/next");
  if (pair.personA) {
    const duelPersonnes = await call("personnes-resultat", "POST", "/api/duels/people/result", { personAId: pair.personA.id, personBId: pair.personB.id, result: "B" });
    await call("personnes-resultat-invalide", "POST", "/api/duels/people/result", { personAId: pair.personA.id, result: "A" }, { status: 400 });
    await call("personnes-inconnue", "POST", "/api/duels/people/result", { personAId: pair.personA.id, personBId: 999999999, result: "A" }, { status: 404 });
    await call("personnes-reinitialiser", "POST", "/api/duels/people/reset", {});
    await call("personnes-reinitialisation-annuler", "POST", "/api/duels/people/restore");
    // Annuler un duel d'acteurs (classement-v1 FR-1), puis une seconde fois : il n'existe plus.
    await call("personnes-annuler", "POST", "/api/duels/undo", { mode: "people", duelId: duelPersonnes.json?.duelId ?? 1 });
    await call("personnes-annuler-absent", "POST", "/api/duels/undo", { mode: "people", duelId: duelPersonnes.json?.duelId ?? 1 }, { status: 404 });
    await call("avis-poser", "PUT", "/api/people/opinions", { id: pair.personA.id, name: pair.personA.name, opinion: 1, rating: 4 });
    await call("avis-invalide", "PUT", "/api/people/opinions", { id: "x" }, { status: 400 });
    await call("avis-retirer", "DELETE", "/api/people/opinions", { id: pair.personA.id });
    await call("avis-poser-encore", "PUT", "/api/people/opinions", { id: pair.personA.id, name: pair.personA.name, opinion: 1, rating: 4 });
    const reset = await call("avis-reinitialiser", "POST", "/api/people/opinions/reset", { side: "liked" });
    await call("avis-reinitialiser-invalide", "POST", "/api/people/opinions/reset", { side: "autre" }, { status: 400 });
    await call("avis-reinitialisation-annuler", "POST", "/api/people/opinions/restore", { rows: reset.json?.removed ?? [] });
    await call("avis-reinitialisation-annuler-invalide", "POST", "/api/people/opinions/restore", { rows: [{ personId: "x" }] }, { status: 400 });
  }

  // --- Paliers
  const [fours, fours2] = (await pick(base, "/api/items?pageSize=2&rating=4&watchStatus=Watched")).items ?? [];
  const tranche = await call("palier-tranche", "POST", "/api/duels/tier/band", { itemId: fours?.id, stars: 4, band: 1 });
  await call("palier-conflit", "POST", "/api/duels/tier/band", { itemId: a.id, stars: 1, band: 1 }, { status: 409 });
  await call("palier-invalide", "POST", "/api/duels/tier/band", { itemId: "x" }, { status: 400 });
  // Un duel de départage (« quatuor » de deux titres), ses refus, puis l'annulation des manches (mode `round`).
  const quatuor = await call("palier-quatuor", "POST", "/api/duels/tier/quad", { itemIds: [fours?.id, fours2?.id], stars: 4, bestId: fours2?.id, worstId: fours?.id });
  await call("palier-quatuor-invalide", "POST", "/api/duels/tier/quad", { itemIds: [fours?.id, fours?.id], stars: 4, bestId: fours?.id, worstId: null }, { status: 400 });
  await call("palier-quatuor-perime", "POST", "/api/duels/tier/quad", { itemIds: [fours?.id, fours2?.id], stars: 1, bestId: fours?.id, worstId: null }, { status: 409 });
  await call("palier-annuler-conflit", "POST", "/api/duels/undo", { mode: "round", duelId: tranche.json?.roundId ?? 1 }, { status: 409 });
  await call("palier-annuler-quatuor", "POST", "/api/duels/undo", { mode: "round", duelId: quatuor.json?.roundId ?? 1 });
  await call("palier-annuler-tranche", "POST", "/api/duels/undo", { mode: "round", duelId: tranche.json?.roundId ?? 1 });
  await call("palier-annuler-absent", "POST", "/api/duels/undo", { mode: "round", duelId: tranche.json?.roundId ?? 1 }, { status: 404 });

  // --- Tri rapide (sans ajout : il passerait par l'ancien service de notes)
  const undo = await call("tri-note", "POST", "/api/triage/answer", { card: { family: "seen", id: c.id }, answer: "like", rating: 3 });
  await call("tri-passer", "POST", "/api/triage/answer", { card: { family: "seen", id: c.id }, answer: "skip" });
  await call("tri-ecarter", "POST", "/api/triage/answer", { card: { family: "unseen", tmdbId: 603, mediaType: "Movie" }, answer: "dislike" });
  await call("tri-invalide", "POST", "/api/triage/answer", { card: { family: "seen", id: c.id }, answer: "peut-être" }, { status: 400 });
  await call("tri-annuler", "POST", "/api/triage/undo", { undo: undo.json?.undo ?? { kind: "none" } });

  // --- Playlists, de la création à la suppression et au rétablissement
  const created = await call("playlist-creer", "POST", "/api/playlists", { name: "Parité", source: "fiche" });
  const pid = created.json?.playlist?.id;
  await call("playlist-creer-invalide", "POST", "/api/playlists", { name: "   " }, { status: 400 });
  await call("playlist-ajouter", "POST", `/api/playlists/${pid}/items`, { itemId: a.id, source: "carte" });
  await call("playlist-ajouter-deja", "POST", `/api/playlists/${pid}/items`, { itemId: a.id });
  await call("playlist-ajouter-plusieurs", "POST", `/api/playlists/${pid}/items`, { itemIds: [b.id, c.id], source: "selection" });
  // Une playlist remplie (la seule playlist de la base de Louis est vide) : fiche, liste, suggestions.
  await call("playlist-lire", "GET", `/api/playlists/${pid}`);
  await call("playlist-lire-liste", "GET", `/api/playlists?item=${a.id}`);
  await call("playlist-suggestions", "GET", `/api/playlists/${pid}/suggestions`);
  await call("playlist-ordre", "PUT", `/api/playlists/${pid}/items`, { itemIds: [c.id, a.id, b.id] });
  await call("playlist-ordre-invalide", "PUT", `/api/playlists/${pid}/items`, { itemIds: [c.id] }, { status: 400 });
  await call("playlist-renommer", "PATCH", `/api/playlists/${pid}`, { name: "Parité 2", description: "Un essai." });
  await call("playlist-renommer-invalide", "PATCH", `/api/playlists/${pid}`, { name: "  " }, { status: 400 });
  await call("playlist-renommer-inconnue", "PATCH", "/api/playlists/99999999", { name: "X" }, { status: 404 });
  await call("playlist-voir", "POST", `/api/playlists/${pid}/watch`, { itemId: a.id, source: "playlist" });
  await call("playlist-voir-hors", "POST", `/api/playlists/${pid}/watch`, { itemId: 99999999 }, { status: 404 });
  await call("playlist-noter", "POST", `/api/playlists/${pid}/rate`, { itemId: a.id, rating: 5 });
  await call("playlist-noter-invalide", "POST", `/api/playlists/${pid}/rate`, { itemId: a.id, rating: 6 }, { status: 400 });
  await call("playlist-suggestion-ecarter", "POST", `/api/playlists/${pid}/suggestions`, { dismiss: b.id });
  await call("playlist-suggestion-ecarter-invalide", "POST", `/api/playlists/${pid}/suggestions`, { dismiss: "x" }, { status: 400 });
  await call("playlist-retirer", "DELETE", `/api/playlists/${pid}/items`, { itemId: b.id });
  await call("playlist-retirer-absent", "DELETE", `/api/playlists/${pid}/items`, { itemId: b.id });
  const deleted = await call("playlist-supprimer", "DELETE", `/api/playlists/${pid}`);
  await call("playlist-supprimer-inconnue", "DELETE", `/api/playlists/${pid}`, undefined, { status: 404 });
  await call("playlist-retablir", "POST", "/api/playlists/restore", { snapshot: deleted.json?.snapshot });
  await call("playlist-retablir-invalide", "POST", "/api/playlists/restore", { snapshot: { id: "x" } }, { status: 400 });
  await call("playlist-inconnue-ajout", "POST", "/api/playlists/99999999/items", { itemId: a.id }, { status: 404 });
}
