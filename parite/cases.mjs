// Les cas du contrat de parité : une requête, le statut attendu. Les GET se comparent par forme
// (parite/shape.mjs) ; les écritures ne tournent que sur un serveur isolé (voir parite/README.md).
// spec: specs/catalog-v2-rust-supabase.md (FR-7)

/** Date du jour (AAAA-MM-JJ) décalée de `plus` jours. */
const day = (plus) => new Date(Date.now() + plus * 86_400_000).toISOString().slice(0, 10);

/** Lit une valeur d'exemple sur le serveur visé (un id de titre, de playlist…). */
async function json(base, path) {
  const res = await fetch(base + path);
  if (!res.ok) throw new Error(`${path} : ${res.status}`);
  return res.json();
}

/**
 * @returns {Promise<{ id: string, method: string, path: string, body?: unknown, write?: boolean, status?: number }[]>}
 */
export async function cases(base) {
  // Un serveur en cours de portage n'a pas encore toutes les routes (ni, au début, de données) :
  // les identifiants d'exemple retombent alors sur des valeurs par défaut.
  const essayer = async (f, defaut) => {
    try {
      return await f();
    } catch {
      return defaut;
    }
  };
  const itemId = await essayer(async () => (await json(base, "/api/items?pageSize=1&watchStatus=Watched&sortBy=name")).items[0].id, 1);
  const playlistId = await essayer(async () => (await json(base, "/api/playlists")).playlists[0]?.id, undefined);

  const get = (id, path) => ({ id, method: "GET", path });
  return [
    // Bibliothèque
    get("items", "/api/items?pageSize=5"),
    get("items-filtres", "/api/items?pageSize=5&type=Movie&watchStatus=Watched&sortBy=tmdbRating&sortDir=desc&q=a"),
    get("items-note", "/api/items?pageSize=5&rating=5"),
    get("item", `/api/items/${itemId}`),
    get("genres", "/api/genres"),
    get("providers", "/api/providers"),
    get("classement", "/api/classement"),
    get("classement-documentaires", "/api/classement?category=Documentary"),
    get("classement-series", "/api/classement?category=TV%20Series"),
    // Duels
    get("duels-next", "/api/duels/next"),
    get("duels-scope", "/api/duels/scope"),
    get("duels-people-next", "/api/duels/people/next"),
    get("duels-people-scope", "/api/duels/people/scope"),
    get("duels-tier-next", "/api/duels/tier/next?stars=4"),
    { id: "duels-tier-sans-etoiles", method: "GET", path: "/api/duels/tier/next", status: 400 },
    get("duels-tier-affiner", "/api/duels/tier/next?stars=5&category=Movie&refine=1"),
    get("duels-tier-pas-assez", "/api/duels/tier/next?stars=0&category=Documentary"),
    { id: "duels-tier-etoiles-invalides", method: "GET", path: "/api/duels/tier/next?stars=6", status: 400 },
    // Recommandations, Ce soir, Sorties, Tri rapide
    get("recommandations", "/api/recommendations?limit=10"),
    get("recommandations-rangees", "/api/recommendations/rows"),
    get("decouvrir", "/api/recommendations/discover?limit=10"),
    get("ce-soir", "/api/tonight"),
    get("ce-soir-duree", "/api/tonight?maxMinutes=120"),
    get("sorties", `/api/calendar?from=${day(0)}&to=${day(14)}`),
    { id: "sorties-sans-fenetre", method: "GET", path: "/api/calendar", status: 400 },
    get("tri-decouvrir", "/api/triage/batch?family=unseen&limit=5"),
    // Groupe 3 (2026-11-06) : rangées de la découverte, Ce soir sur tout le catalogue, une catégorie, l'accueil
    // (route de la v2 : ce que chargerAccueilLocal() rend en v1, enregistré par une route de la copie de parité).
    get("decouvrir-rangees", "/api/recommendations/discover?rows=1&limit=24"),
    get("ce-soir-catalogue", "/api/tonight?source=catalog"),
    get("ce-soir-relacher", "/api/tonight?genre=Western&mood=light"),
    get("tri-decouvrir-documentaires", "/api/triage/batch?family=unseen&category=Documentary&limit=5"),
    get("accueil", "/api/accueil"),
    get("tri-vus", "/api/triage/batch?family=seen&limit=5"),
    get("tri-personnes", "/api/triage/batch?family=person&limit=5"),
    get("profil", "/api/profile/feedback"),
    // Personnes, écartés, réglages
    get("avis-personnes", "/api/people/opinions"),
    get("ecartes", "/api/dismissals"),
    get("abonnements", "/api/settings/subscriptions"),
    get("recherche-tmdb", "/api/tmdb/search?q=alien"),
    // Un nom de personne : sa filmographie, avec `personCredit` (recherche-personne-v1).
    get("recherche-tmdb-personne", "/api/tmdb/search?q=Quentin%20Dupieux"),
    // Playlists
    get("playlists", "/api/playlists"),
    ...(playlistId
      ? [get("playlist", `/api/playlists/${playlistId}`), get("playlist-suggestions", `/api/playlists/${playlistId}/suggestions`)]
      : []),
    get("playlists-contient", `/api/playlists?item=${itemId}`),
    // Introuvables : même statut, même forme d'erreur
    { id: "item-inconnu", method: "GET", path: "/api/items/99999999", status: 404 },
    { id: "playlist-inconnue", method: "GET", path: "/api/playlists/99999999", status: 404 },
    { id: "playlist-id-texte", method: "GET", path: "/api/playlists/abc", status: 404 },
    // Une playlist inconnue n'a pas de suggestion : 200 et une liste vide, pas de 404.
    get("suggestions-playlist-inconnue", "/api/playlists/99999999/suggestions"),
  ];
}
