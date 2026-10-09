import { describe, expect, it, beforeEach, vi } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./db";
import {
  listItems,
  updateItem,
  deleteItemLocally,
  getNotionPageId,
  listDistinctGenres,
  findByTmdbId,
  insertItem,
  getItemWithOverview,
} from "./itemService";
import { getDetailsFr, getTitleData } from "./tmdb";

vi.mock("./tmdb", () => ({
  posterUrl: (path: string | null) => (path ? `https://image.tmdb.org/t/p/w500${path}` : null),
  getDetailsFr: vi.fn(),
  getTitleData: vi.fn(async () => null),
}));

function seedItem(
  db: Database.Database,
  overrides: Partial<{
    notion_page_id: string;
    name: string;
    type: string;
    watch_status: string;
    elo_score: number;
    duels_count: number;
    year: string;
    genre: string[];
    rating: string;
    tmdb_rating: number;
    tmdb_id: number;
    overview: string;
  }> = {}
) {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO items (notion_page_id, name, type, watch_status, elo_score, duels_count, year, genre, rating, tmdb_rating, tmdb_id, overview, notion_last_edited, updated_at)
     VALUES (@notion_page_id, @name, @type, @watch_status, @elo_score, @duels_count, @year, @genre, @rating, @tmdb_rating, @tmdb_id, @overview, @now, @now)`
  ).run({
    notion_page_id: overrides.notion_page_id ?? `page-${Math.random()}`,
    name: overrides.name ?? "Item",
    type: overrides.type ?? "Movie",
    watch_status: overrides.watch_status ?? "Watched",
    elo_score: overrides.elo_score ?? 1200,
    duels_count: overrides.duels_count ?? 0,
    year: overrides.year ?? null,
    genre: overrides.genre ? JSON.stringify(overrides.genre) : null,
    rating: overrides.rating ?? null,
    tmdb_rating: overrides.tmdb_rating ?? null,
    tmdb_id: overrides.tmdb_id ?? null,
    overview: overrides.overview ?? null,
    now,
  });
}

describe("listItems", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  // AC-1: filtre Watch Status + recherche texte combinés
  it("combine filtre de statut et recherche texte", () => {
    seedItem(db, { name: "The Matrix", watch_status: "Watched" });
    seedItem(db, { name: "Matrix Reloaded", watch_status: "Unwatched" });
    seedItem(db, { name: "Inception", watch_status: "Watched" });

    const result = listItems(db, { watchStatus: "Watched", q: "matrix" });
    expect(result.items).toHaveLength(1);
    expect(result.items[0].name).toBe("The Matrix");
  });

  // AC-5: pagination
  it("pagine les résultats", () => {
    for (let i = 0; i < 30; i++) seedItem(db, { name: `Film ${String(i).padStart(2, "0")}` });

    const page1 = listItems(db, { page: 1, pageSize: 24 });
    expect(page1.items).toHaveLength(24);
    expect(page1.total).toBe(30);

    const page2 = listItems(db, { page: 2, pageSize: 24 });
    expect(page2.items).toHaveLength(6);
  });

  it("expose eloScore=null tant qu'aucun duel réel n'a eu lieu", () => {
    seedItem(db, { name: "Jamais dualisé", duels_count: 0, elo_score: 1200 });
    seedItem(db, { name: "Déjà dualisé", duels_count: 3, elo_score: 1330 });

    const result = listItems(db);
    const untested = result.items.find((i) => i.name === "Jamais dualisé")!;
    const tested = result.items.find((i) => i.name === "Déjà dualisé")!;

    expect(untested.eloScore).toBeNull();
    expect(tested.eloScore).toBe(1330);
  });

  it("distingue Documentary de Movie/TV Series via le genre (FR-9 bibliothèque)", () => {
    seedItem(db, { name: "Vrai Film", type: "Movie", genre: ["Action"] });
    seedItem(db, { name: "Doc Film", type: "Movie", genre: ["Documentary", "Histoire"] });
    seedItem(db, { name: "Doc Série", type: "TV Series", genre: ["Documentary"] });
    seedItem(db, { name: "Vraie Série", type: "TV Series", genre: ["Drame"] });

    const all = listItems(db);
    expect(all.items.find((i) => i.name === "Vrai Film")?.category).toBe("Movie");
    expect(all.items.find((i) => i.name === "Doc Film")?.category).toBe("Documentary");
    expect(all.items.find((i) => i.name === "Doc Série")?.category).toBe("Documentary");
    expect(all.items.find((i) => i.name === "Vraie Série")?.category).toBe("TV Series");

    const movies = listItems(db, { category: "Movie" });
    expect(movies.items.map((i) => i.name)).toEqual(["Vrai Film"]);

    const docs = listItems(db, { category: "Documentary" });
    expect(docs.items.map((i) => i.name).sort()).toEqual(["Doc Film", "Doc Série"]);
  });

  it("filtre par genre exact (json_each, pas de faux positif substring)", () => {
    seedItem(db, { name: "Film Action", genre: ["Action", "Aventure"] });
    seedItem(db, { name: "Film Drame", genre: ["Drame"] });
    // Genre partiellement homonyme ne doit pas matcher "Action" par erreur (ex: LIKE aurait pu).
    seedItem(db, { name: "Film Faux Ami", genre: ["Action & Aventure"] });

    const result = listItems(db, { genre: "Action" });
    expect(result.items.map((i) => i.name)).toEqual(["Film Action"]);
  });

  it("filtre par note personnelle minimale (au moins N étoiles, 💩 exclu)", () => {
    seedItem(db, { name: "Nul", rating: "💩" });
    seedItem(db, { name: "Moyen", rating: "⭐️⭐️" });
    seedItem(db, { name: "Excellent", rating: "⭐️⭐️⭐️⭐️⭐️" });
    seedItem(db, { name: "Sans note" });

    const result = listItems(db, { minRating: 3 });
    expect(result.items.map((i) => i.name)).toEqual(["Excellent"]);
  });

  it("filtre par note exacte, 💩 compris (histogramme de l'accueil)", () => {
    seedItem(db, { name: "Nul", rating: "💩" });
    seedItem(db, { name: "Moyen", rating: "⭐️⭐️" });
    seedItem(db, { name: "Moyen aussi", rating: "⭐️⭐️" });
    seedItem(db, { name: "Excellent", rating: "⭐️⭐️⭐️⭐️⭐️" });

    expect(listItems(db, { rating: 0 }).items.map((i) => i.name)).toEqual(["Nul"]);
    expect(listItems(db, { rating: 2 }).items.map((i) => i.name)).toEqual(["Moyen", "Moyen aussi"]);
    expect(listItems(db, { rating: 4 }).total).toBe(0);
  });

  it("trie par Elo décroissant (les items sans duel restent en fin de liste)", () => {
    seedItem(db, { name: "Haut Elo", elo_score: 1400, duels_count: 5 });
    seedItem(db, { name: "Bas Elo", elo_score: 1100, duels_count: 5 });
    seedItem(db, { name: "Jamais dualisé", elo_score: 1200, duels_count: 0 });

    const result = listItems(db, { sortBy: "elo" });
    expect(result.items.map((i) => i.name)).toEqual(["Haut Elo", "Bas Elo", "Jamais dualisé"]);
  });

  it("trie par nom croissant par défaut", () => {
    seedItem(db, { name: "Zèbre" });
    seedItem(db, { name: "Alpha" });

    const result = listItems(db);
    expect(result.items.map((i) => i.name)).toEqual(["Alpha", "Zèbre"]);
  });
});

describe("listDistinctGenres", () => {
  it("retourne les genres uniques triés, sans doublon", () => {
    const db = createTestDb();
    seedItem(db, { name: "A", genre: ["Drame", "Action"] });
    seedItem(db, { name: "B", genre: ["Action", "Comédie"] });

    expect(listDistinctGenres(db)).toEqual(["Action", "Comédie", "Drame"]);
  });
});

describe("updateItem", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  // AC-4: repasser à Unwatched ne doit pas effacer l'historique Elo
  it("préserve elo_score/duels_count en repassant à Unwatched", () => {
    seedItem(db, { name: "Historique", watch_status: "Watched", elo_score: 1350, duels_count: 12 });
    const id = (db.prepare(`SELECT id FROM items`).get() as { id: number }).id;

    const updated = updateItem(db, id, { watchStatus: "Unwatched" });

    expect(updated!.watchStatus).toBe("Unwatched");
    expect(updated!.eloScore).toBe(1350);
    expect(updated!.duelsCount).toBe(12);
  });

  // EC-2: effacer le ressenti (chaîne vide) doit être appliqué, pas ignoré
  it("applique un ressenti vidé plutôt que de l'ignorer", () => {
    seedItem(db, { name: "Avec ressenti" });
    const id = (db.prepare(`SELECT id FROM items`).get() as { id: number }).id;

    updateItem(db, id, { ressenti: "Super film" });
    const cleared = updateItem(db, id, { ressenti: "" });

    expect(cleared!.ressenti).toBe("");
  });

  // EC-3: seul l'état final compte, pas d'accumulation
  it("ne garde que l'état final après plusieurs changements successifs", () => {
    seedItem(db, { name: "Va-et-vient", watch_status: "Unwatched" });
    const id = (db.prepare(`SELECT id FROM items`).get() as { id: number }).id;

    updateItem(db, id, { watchStatus: "Watched" });
    const final = updateItem(db, id, { watchStatus: "Unwatched" });

    expect(final!.watchStatus).toBe("Unwatched");

    const row = db.prepare(`SELECT local_dirty FROM items WHERE id = ?`).get(id) as {
      local_dirty: number;
    };
    expect(row.local_dirty).toBe(1);
  });

  it("ignore une note posée sur un item Unwatched (pas encore vu)", () => {
    seedItem(db, { name: "Pas encore vu", watch_status: "Unwatched" });
    const id = (db.prepare(`SELECT id FROM items`).get() as { id: number }).id;

    const updated = updateItem(db, id, { rating: "⭐️⭐️⭐️" });
    expect(updated!.rating).toBeNull();
  });

  it("efface la note quand l'item repasse en Unwatched", () => {
    seedItem(db, { name: "Déjà noté", watch_status: "Watched", rating: "⭐️⭐️⭐️⭐️" });
    const id = (db.prepare(`SELECT id FROM items`).get() as { id: number }).id;

    const updated = updateItem(db, id, { watchStatus: "Unwatched" });
    expect(updated!.watchStatus).toBe("Unwatched");
    expect(updated!.rating).toBeNull();
  });

  it("autorise l'effacement d'une note même sur un item non vu", () => {
    seedItem(db, { name: "Note à effacer", watch_status: "Unwatched", rating: "⭐️⭐️" });
    const id = (db.prepare(`SELECT id FROM items`).get() as { id: number }).id;

    const updated = updateItem(db, id, { rating: null });
    expect(updated!.rating).toBeNull();
  });

  it("accepte une note quand le passage à Watched est fait dans le même appel", () => {
    seedItem(db, { name: "Vient de finir", watch_status: "Unwatched" });
    const id = (db.prepare(`SELECT id FROM items`).get() as { id: number }).id;

    const updated = updateItem(db, id, { watchStatus: "Watched", rating: "⭐️⭐️⭐️⭐️" });
    expect(updated!.watchStatus).toBe("Watched");
    expect(updated!.rating).toBe("⭐️⭐️⭐️⭐️");
  });

  it("marque local_dirty et retourne null pour un id inexistant", () => {
    seedItem(db, { name: "Seul item" });
    const result = updateItem(db, 99999, { watchStatus: "Watched" });
    expect(result).toBeNull();
  });
});

describe("deleteItemLocally", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("supprime l'item et retourne true", () => {
    seedItem(db, { name: "À supprimer" });
    const id = (db.prepare(`SELECT id FROM items`).get() as { id: number }).id;

    expect(deleteItemLocally(db, id)).toBe(true);
    expect(db.prepare(`SELECT * FROM items WHERE id = ?`).get(id)).toBeUndefined();
  });

  it("supprime aussi les duels qui référencent l'item (pas de ligne orpheline)", () => {
    seedItem(db, { name: "A" });
    seedItem(db, { name: "B" });
    const [a, b] = db.prepare(`SELECT id FROM items ORDER BY id`).all() as { id: number }[];

    db.prepare(
      `INSERT INTO duels (item_a_id, item_b_id, winner_id, elo_a_before, elo_b_before, elo_a_after, elo_b_after, created_at)
       VALUES (?, ?, ?, 1200, 1200, 1216, 1184, ?)`
    ).run(a.id, b.id, a.id, new Date().toISOString());

    deleteItemLocally(db, a.id);

    expect(db.prepare(`SELECT COUNT(*) c FROM duels`).get()).toEqual({ c: 0 });
  });

  it("retourne false pour un id inexistant", () => {
    expect(deleteItemLocally(db, 99999)).toBe(false);
  });
});

describe("getNotionPageId", () => {
  it("retourne le notion_page_id d'un item existant, null sinon", () => {
    const db = createTestDb();
    seedItem(db, { name: "X", notion_page_id: "page-abc" });
    const id = (db.prepare(`SELECT id FROM items`).get() as { id: number }).id;

    expect(getNotionPageId(db, id)).toBe("page-abc");
    expect(getNotionPageId(db, 99999)).toBeNull();
  });
});

describe("findByTmdbId", () => {
  it("retourne l'item correspondant, null si absent (AC-3 ajout-item)", () => {
    const db = createTestDb();
    seedItem(db, { name: "Déjà là", tmdb_id: 603 });

    expect(findByTmdbId(db, 603)?.name).toBe("Déjà là");
    expect(findByTmdbId(db, 999999)).toBeNull();
  });
});

describe("insertItem", () => {
  it("insère un item Unwatched avec les propriétés TMDB fournies (AC-2 ajout-item)", () => {
    const db = createTestDb();

    const item = insertItem(db, {
      notionPageId: "page-new",
      name: "The Matrix",
      type: "Movie",
      year: "1999",
      release: null,
      trailer: null,
      imdbId: "tt0133093",
      tmdbId: 603,
      posterPath: "/poster.jpg",
      genre: ["Action", "Science-Fiction"],
      director: "Lana Wachowski, Lilly Wachowski",
      tmdbRating: 8.2,
      voteCount: 24000,
      overview: "Un programmeur découvre que la réalité est une simulation.",
      tmdbFeatures: {
        genres: ["Action", "Science Fiction"],
        keywords: ["simulated reality"],
        cast: [{ id: 6384, name: "Keanu Reeves", profilePath: "/keanu.jpg" }],
        directors: [{ id: 9340, name: "Lana Wachowski", profilePath: null }],
        year: 1999,
        runtime: 136,
        language: "en",
        countries: ["US"],
        voteAverage: 8.2,
        voteCount: 24000,
        popularity: 80,
      },
      availability: {
        link: "https://www.themoviedb.org/movie/603/watch?locale=FR",
        flatrate: [{ id: 8, name: "Netflix", logoPath: "/netflix.jpg" }],
        free: [],
        ads: [],
        rent: [],
        buy: [],
        fetchedAt: "2026-09-25T12:00:00.000Z",
      },
    });

    // Disponibilité streaming : stockée à la création, relue au mapping.
    expect(item.availability?.flatrate[0].name).toBe("Netflix");

    // FR-23 : les caractéristiques sont stockées telles quelles, en JSON.
    const stored = db.prepare(`SELECT tmdb_features FROM items WHERE id = ?`).get(item.id) as {
      tmdb_features: string;
    };
    expect(JSON.parse(stored.tmdb_features).cast[0]).toEqual({
      id: 6384,
      name: "Keanu Reeves",
      profilePath: "/keanu.jpg",
    });

    expect(item.name).toBe("The Matrix");
    expect(item.watchStatus).toBe("Unwatched");
    expect(item.year).toBe("1999");
    expect(item.posterUrl).toContain("/poster.jpg");
    expect(item.rating).toBeNull();
    expect(item.overview).toBe("Un programmeur découvre que la réalité est une simulation.");
    expect(item.voteCount).toBe(24000);
    expect(findByTmdbId(db, 603)?.name).toBe("The Matrix");
  });
});

describe("getItemWithOverview", () => {
  beforeEach(() => {
    vi.mocked(getDetailsFr).mockReset();
  });

  it("récupère et met en cache le synopsis (en français) et le vote_count quand pas encore connus", async () => {
    const db = createTestDb();
    seedItem(db, { name: "Interstellar", tmdb_id: 157336 });
    const id = (db.prepare(`SELECT id FROM items`).get() as { id: number }).id;

    vi.mocked(getDetailsFr).mockResolvedValueOnce({
      title: "Interstellar",
      overview: "Des explorateurs voyagent à travers un trou de ver.",
      voteAverage: 8.4,
      voteCount: 16000,
    });

    const item = await getItemWithOverview(db, id);

    expect(item?.overview).toBe("Des explorateurs voyagent à travers un trou de ver.");
    expect(item?.voteCount).toBe(16000);
    expect(getDetailsFr).toHaveBeenCalledWith(157336, "Movie");
    // mis en cache : une seconde lecture ne redéclenche pas d'appel TMDB.
    await getItemWithOverview(db, id);
    expect(getDetailsFr).toHaveBeenCalledTimes(1);
  });

  it("ne rappelle pas TMDB si le synopsis est déjà en cache (même vide)", async () => {
    const db = createTestDb();
    seedItem(db, { name: "Sans synopsis connu", overview: "" });
    const id = (db.prepare(`SELECT id FROM items`).get() as { id: number }).id;

    const item = await getItemWithOverview(db, id);

    expect(item?.overview).toBe("");
    expect(getDetailsFr).not.toHaveBeenCalled();
  });

  it("met en cache une chaîne vide quand l'item n'a pas de tmdb_id (rien à récupérer)", async () => {
    const db = createTestDb();
    seedItem(db, { name: "Sans tmdb_id" });
    const id = (db.prepare(`SELECT id FROM items`).get() as { id: number }).id;

    const item = await getItemWithOverview(db, id);

    expect(item?.overview).toBe("");
    expect(getDetailsFr).not.toHaveBeenCalled();
  });

  it("retourne null pour un id inexistant", async () => {
    const db = createTestDb();
    expect(await getItemWithOverview(db, 99999)).toBeNull();
  });
});

describe("listItems — tris ajoutés", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("trie par date d'ajout, les plus récents d'abord par défaut", () => {
    seedItem(db, { name: "Ancien" });
    seedItem(db, { name: "Moyen" });
    seedItem(db, { name: "Récent" });

    const { items } = listItems(db, { sortBy: "added" });
    expect(items.map((i) => i.name)).toEqual(["Récent", "Moyen", "Ancien"]);
  });

  it("trie par note perso en respectant l'échelle 💩 < ⭐️ < … < ⭐️⭐️⭐️⭐️⭐️, non notés en dernier", () => {
    seedItem(db, { name: "Trois", rating: "⭐️⭐️⭐️" });
    seedItem(db, { name: "Nul", rating: "💩" });
    seedItem(db, { name: "Sans note" });
    seedItem(db, { name: "Cinq", rating: "⭐️⭐️⭐️⭐️⭐️" });

    const { items } = listItems(db, { sortBy: "rating" });
    expect(items.map((i) => i.name)).toEqual(["Cinq", "Trois", "Nul", "Sans note"]);
  });

  it("trie par statut, la pile à voir d'abord, puis par nom à l'intérieur de chaque groupe", () => {
    seedItem(db, { name: "Zorro", watch_status: "Watched" });
    seedItem(db, { name: "Batman", watch_status: "Unwatched" });
    seedItem(db, { name: "Alien", watch_status: "Watched" });

    const { items } = listItems(db, { sortBy: "status" });
    expect(items.map((i) => i.name)).toEqual(["Batman", "Alien", "Zorro"]);
  });

  it("trie par type avec la sémantique documentaire de la bibliothèque", () => {
    seedItem(db, { name: "Une série", type: "TV Series", genre: ["Drama"] });
    seedItem(db, { name: "Un film", type: "Movie", genre: ["Drama"] });
    seedItem(db, { name: "Un docu", type: "Movie", genre: ["Documentary"] });

    const { items } = listItems(db, { sortBy: "category" });
    expect(items.map((i) => i.name)).toEqual(["Un docu", "Un film", "Une série"]);
  });

  it("garde une pagination stable malgré les égalités : aucun titre répété ni sauté", () => {
    for (let n = 0; n < 30; n++) seedItem(db, { name: `Titre ${String(n).padStart(2, "0")}`, watch_status: "Watched" });

    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      seen.push(...listItems(db, { sortBy: "status", page, pageSize: 10 }).items.map((i) => i.name));
    }

    expect(seen).toHaveLength(30);
    expect(new Set(seen).size).toBe(30);
  });
});

describe("getItemWithOverview — disponibilité et dates (disponibilite-streaming AC-3, sorties FR-1)", () => {
  function seedWithAvailability(
    db: Database.Database,
    fetchedDaysAgo: number,
    releaseDaysAgo: number | null = fetchedDaysAgo,
    withTrailer = true
  ): number {
    const now = new Date().toISOString();
    const fetchedAt = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();
    const availability = { link: null, flatrate: [], free: [], ads: [], rent: [], buy: [], fetchedAt: fetchedAt(fetchedDaysAgo) };
    const release =
      releaseDaysAgo === null
        ? null
        : { kind: "movie", theatrical: "1999-03-31", digital: null, firstAir: null, nextEpisode: null, status: "Released", fetchedAt: fetchedAt(releaseDaysAgo) };
    return Number(
      db
        .prepare(
          `INSERT INTO items (notion_page_id, name, type, watch_status, tmdb_id, overview, watch_providers, release_info, trailer_info, notion_last_edited, updated_at)
           VALUES (?, 'Titre', 'Movie', 'Unwatched', 603, 'Synopsis déjà là', ?, ?, ?, ?, ?)`
        )
        .run(
          `page-${Math.random()}`,
          JSON.stringify(availability),
          release && JSON.stringify(release),
          withTrailer ? JSON.stringify({ trailer: null, fetchedAt: now }) : null,
          now,
          now
        )
        .lastInsertRowid
    );
  }

  beforeEach(() => {
    vi.mocked(getTitleData).mockClear();
    vi.mocked(getTitleData).mockResolvedValue({
      availability: {
        link: null,
        flatrate: [{ id: 8, name: "Netflix", logoPath: null }],
        free: [],
        ads: [],
        rent: [],
        buy: [],
        fetchedAt: new Date().toISOString(),
      },
      release: {
        kind: "movie",
        theatrical: "1999-06-23",
        digital: null,
        firstAir: null,
        nextEpisode: null,
        status: "Released",
        fetchedAt: new Date().toISOString(),
      },
      trailer: { trailer: null, fetchedAt: new Date().toISOString() },
      features: {
        genres: [],
        keywords: [],
        cast: [],
        directors: [],
        year: 1999,
        runtime: 136,
        language: "en",
        countries: ["US"],
        voteAverage: 8.2,
        voteCount: 25000,
        popularity: 80,
      },
    });
  });

  it("rafraîchit une disponibilité vieille de 8 jours à l'ouverture de la fiche, dates comprises", async () => {
    const db = createTestDb();
    const id = seedWithAvailability(db, 8);

    const item = await getItemWithOverview(db, id);
    expect(getTitleData).toHaveBeenCalledTimes(1);
    expect(item?.availability?.flatrate[0].name).toBe("Netflix");
    expect(item?.release?.theatrical).toBe("1999-06-23");
  });

  it("ne rappelle pas TMDB pour une disponibilité et des dates de 2 jours", async () => {
    const db = createTestDb();
    const id = seedWithAvailability(db, 2);

    await getItemWithOverview(db, id);
    expect(getTitleData).not.toHaveBeenCalled();
  });

  it("va chercher la bande-annonce d'un titre qui ne l'a jamais cherchée (bandes-annonces FR-2)", async () => {
    const db = createTestDb();
    const id = seedWithAvailability(db, 2, 2, false);

    await getItemWithOverview(db, id);
    expect(getTitleData).toHaveBeenCalledTimes(1);
  });

  it("va chercher les dates d'un titre qui n'en a pas encore (sorties FR-1)", async () => {
    const db = createTestDb();
    const id = seedWithAvailability(db, 2, null);

    const item = await getItemWithOverview(db, id);
    expect(getTitleData).toHaveBeenCalledTimes(1);
    expect(item?.release?.kind).toBe("movie");
  });
});

describe("listItems — sur mes abonnements (disponibilite-streaming-v1 AC-2, AC-4)", () => {
  const NETFLIX = { id: 8, name: "Netflix", logoPath: null };

  function seedAvailable(db: Database.Database, name: string, kind: "flatrate" | "rent" | "none") {
    const now = new Date().toISOString();
    const availability = {
      link: null,
      flatrate: kind === "flatrate" ? [NETFLIX] : [],
      free: [],
      ads: [],
      rent: kind === "rent" ? [NETFLIX] : [],
      buy: [],
      fetchedAt: now,
    };
    db.prepare(
      `INSERT INTO items (notion_page_id, name, type, watch_status, watch_providers, notion_last_edited, updated_at)
       VALUES (?, ?, 'Movie', 'Unwatched', ?, ?, ?)`
    ).run(`page-${name}`, name, kind === "none" ? null : JSON.stringify(availability), now, now);
  }

  it("pagine exactement les seuls titres inclus dans tes abonnements, location exclue", () => {
    const db = createTestDb();
    for (let i = 0; i < 12; i++) seedAvailable(db, `Inclus ${String(i).padStart(2, "0")}`, "flatrate");
    for (let i = 0; i < 5; i++) seedAvailable(db, `Location ${i}`, "rent");
    for (let i = 0; i < 8; i++) seedAvailable(db, `Absent ${i}`, "none");

    const seen: string[] = [];
    for (let page = 1; page <= 3; page++) {
      const result = listItems(db, { onServices: [NETFLIX.id], page, pageSize: 5 });
      expect(result.total).toBe(12);
      seen.push(...result.items.map((i) => i.name));
    }

    expect(seen).toHaveLength(12);
    expect(new Set(seen).size).toBe(12);
    expect(seen.every((name) => name.startsWith("Inclus"))).toBe(true);
  });

  it("ne retient rien quand aucun service n'est couvert", () => {
    const db = createTestDb();
    seedAvailable(db, "Inclus", "flatrate");
    expect(listItems(db, { onServices: [] }).total).toBe(0);
  });
});
