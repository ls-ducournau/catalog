import { beforeEach, describe, expect, it, vi } from "vitest";
import type Database from "better-sqlite3";
import { createTestDb } from "./db";
import { deleteItemLocally } from "./itemService";
import {
  addManyToPlaylist,
  addToPlaylist,
  createPlaylist,
  currentPlaylist,
  dismissSuggestion,
  deletePlaylist,
  getPlaylist,
  listPlaylists,
  parseName,
  rateFromPlaylist,
  removeFromPlaylist,
  reorderPlaylist,
  restorePlaylist,
  suggestForPlaylist,
  updatePlaylist,
  watchFromPlaylist,
} from "./playlistService";

// spec: specs/playlists-v1.md

vi.mock("./tmdb", () => ({
  posterUrl: (path: string | null) => (path ? `https://image.tmdb.org/t/p/w500${path}` : null),
  getDetailsFr: vi.fn(),
  getTitleData: vi.fn(async () => null),
}));

function seedItem(
  db: Database.Database,
  overrides: Partial<{
    name: string;
    type: string;
    watch_status: string;
    poster_path: string;
    runtime: number;
    genres: string[];
    keywords: string[];
    directors: string[];
    cast: string[];
  }> = {}
): number {
  const now = new Date().toISOString();
  const person = (name: string, i: number) => ({ id: name.length * 100 + i, name });
  const hasFeatures = ["runtime", "genres", "keywords", "directors", "cast"].some((k) => k in overrides);
  const features = hasFeatures
    ? JSON.stringify({
        genres: overrides.genres ?? [],
        keywords: overrides.keywords ?? [],
        cast: (overrides.cast ?? []).map(person),
        directors: (overrides.directors ?? []).map(person),
        year: null,
        runtime: overrides.runtime ?? null,
        language: null,
        countries: [],
        voteAverage: null,
        voteCount: null,
        popularity: null,
      })
    : null;
  return Number(
    db
      .prepare(
        `INSERT INTO items (notion_page_id, name, type, watch_status, poster_path, tmdb_features, notion_last_edited, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        `page-${Math.random()}`,
        overrides.name ?? "Titre",
        overrides.type ?? "Movie",
        overrides.watch_status ?? "Unwatched",
        overrides.poster_path ?? null,
        features,
        now,
        now
      ).lastInsertRowid
  );
}

function created(db: Database.Database, name: string, itemId?: number): number {
  const result = createPlaylist(db, { name, itemId });
  if ("error" in result) throw new Error(result.error);
  return result.playlist.id;
}

const order = (db: Database.Database, id: number) => getPlaylist(db, id)!.items.map((i) => i.name);

describe("playlists", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  it("AC-1 : une playlist créée apparaît, vide", () => {
    created(db, "Saga Alien");
    const list = listPlaylists(db);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ name: "Saga Alien", count: 0, watched: 0, covers: [] });
  });

  it("EC-1 : un nom vide ou trop long est refusé, les espaces superflus retirés", () => {
    expect(createPlaylist(db, { name: "   " })).toEqual({ error: "invalid_name" });
    expect(createPlaylist(db, { name: "x".repeat(61) })).toEqual({ error: "invalid_name" });
    expect(parseName("  Films   de  Noël ")).toBe("Films de Noël");
  });

  it("AC-2 : cocher ajoute en fin de liste, décocher retire", () => {
    const a = seedItem(db, { name: "Alien" });
    const b = seedItem(db, { name: "Aliens" });
    const id = created(db, "Saga Alien", b);
    addToPlaylist(db, id, a);
    expect(order(db, id)).toEqual(["Aliens", "Alien"]);
    expect(listPlaylists(db, { itemId: a })[0].contains).toBe(true);
    removeFromPlaylist(db, id, a);
    expect(order(db, id)).toEqual(["Aliens"]);
    expect(listPlaylists(db, { itemId: a })[0].contains).toBe(false);
  });

  it("AC-3 (FR-6) : un titre déjà présent n'est pas ajouté deux fois", () => {
    const a = seedItem(db, { name: "Alien" });
    const id = created(db, "Saga Alien", a);
    expect(addToPlaylist(db, id, a)).toEqual({ added: false });
    expect(order(db, id)).toEqual(["Alien"]);
  });

  it("AC-4, AC-5 (FR-7) : le nouvel ordre est gardé ; un ordre incomplet est refusé", () => {
    const id = created(db, "Trois");
    const [a, b, c] = ["A", "B", "C"].map((name) => seedItem(db, { name }));
    [a, b, c].forEach((item) => addToPlaylist(db, id, item));
    expect(reorderPlaylist(db, id, [c, a, b])).toEqual({ ok: true });
    expect(order(db, id)).toEqual(["C", "A", "B"]);
    expect(reorderPlaylist(db, id, [c, a])).toEqual({ error: "invalid_order" });
    expect(reorderPlaylist(db, id, [c, a, a])).toEqual({ error: "invalid_order" });
    expect(order(db, id)).toEqual(["C", "A", "B"]);
  });

  it("FR-8 : retirer rend la place du titre, que l'annulation réutilise", () => {
    const id = created(db, "Trois");
    const [a, b, c] = ["A", "B", "C"].map((name) => seedItem(db, { name }));
    [a, b, c].forEach((item) => addToPlaylist(db, id, item));
    const removed = removeFromPlaylist(db, id, b);
    expect(removed).toEqual({ removed: true, position: 1 });
    addToPlaylist(db, id, b, 1);
    expect(order(db, id)).toEqual(["A", "B", "C"]);
  });

  it("AC-6 (FR-3) : supprimer puis annuler rend la playlist, ses titres et leur ordre", () => {
    const id = created(db, "Saga Alien");
    const ids = ["Alien", "Aliens", "Alien 3", "Alien, la résurrection"].map((name) => seedItem(db, { name }));
    ids.forEach((item) => addToPlaylist(db, id, item));
    reorderPlaylist(db, id, [ids[3], ids[0], ids[1], ids[2]]);
    const snapshot = deletePlaylist(db, id)!;
    expect(listPlaylists(db)).toHaveLength(0);
    // Les titres restent dans la bibliothèque.
    expect((db.prepare(`SELECT COUNT(*) AS n FROM items`).get() as { n: number }).n).toBe(4);
    const restored = restorePlaylist(db, snapshot);
    expect(restored).toMatchObject({ playlist: { id, name: "Saga Alien" } });
    expect(order(db, id)).toEqual(["Alien, la résurrection", "Alien", "Aliens", "Alien 3"]);
  });

  it("AC-7 (FR-9) : un titre retiré de la bibliothèque quitte toutes les playlists", () => {
    const a = seedItem(db, { name: "Alien" });
    const keep = seedItem(db, { name: "Blade Runner" });
    const one = created(db, "Une", a);
    const two = created(db, "Deux", a);
    addToPlaylist(db, two, keep);
    deleteItemLocally(db, a);
    expect(order(db, one)).toEqual([]);
    expect(order(db, two)).toEqual(["Blade Runner"]);
  });

  it("AC-8 (FR-12) : le prochain à voir est le premier non vu, dans l'ordre", () => {
    const id = created(db, "Trois");
    const a = seedItem(db, { name: "A", watch_status: "Watched" });
    const b = seedItem(db, { name: "B" });
    const c = seedItem(db, { name: "C" });
    [a, b, c].forEach((item) => addToPlaylist(db, id, item));
    expect(getPlaylist(db, id)!.nextId).toBe(b);
    db.prepare(`UPDATE items SET watch_status = 'Watched' WHERE id = ?`).run(b);
    expect(getPlaylist(db, id)!.nextId).toBe(c);
    db.prepare(`UPDATE items SET watch_status = 'Watched' WHERE id = ?`).run(c);
    expect(getPlaylist(db, id)!.nextId).toBeNull();
    expect(listPlaylists(db)[0].watched).toBe(3);
  });

  it("AC-9, EC-3 : la durée totale additionne les durées connues", () => {
    const id = created(db, "Soirée");
    addToPlaylist(db, id, seedItem(db, { name: "Long", runtime: 120 }));
    addToPlaylist(db, id, seedItem(db, { name: "Court", runtime: 90 }));
    addToPlaylist(db, id, seedItem(db, { name: "Inconnu" }));
    expect(listPlaylists(db)[0].runtime).toEqual({ minutes: 210, known: 2, hasSeries: false });
  });

  it("FR-10, EC-2 : la couverture prend les affiches des quatre premiers titres", () => {
    const id = created(db, "Affiches");
    for (let i = 0; i < 5; i++) addToPlaylist(db, id, seedItem(db, { name: `T${i}`, poster_path: `/p${i}.jpg` }));
    addToPlaylist(db, id, seedItem(db, { name: "Sans affiche" }));
    expect(listPlaylists(db)[0].covers).toHaveLength(4);
  });

  it("FR-2 : renommer et décrire ; une playlist inconnue est signalée", () => {
    const id = created(db, "Brouillon");
    expect(updatePlaylist(db, id, { name: "Films de Noël", description: "  À revoir en décembre  " })).toMatchObject({
      playlist: { name: "Films de Noël", description: "À revoir en décembre" },
    });
    expect(updatePlaylist(db, id, { description: "" })).toMatchObject({ playlist: { description: null } });
    expect(updatePlaylist(db, 999, { name: "X" })).toEqual({ error: "not_found" });
    expect(addToPlaylist(db, 999, 1)).toEqual({ error: "not_found" });
  });
});

// spec: specs/playlists-v2.md
describe("playlists v2", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = createTestDb();
  });

  const events = (kind: string) =>
    db.prepare(`SELECT subject_id, context FROM events WHERE kind = ? ORDER BY id`).all(kind) as { subject_id: string; context: string }[];

  it("AC-3 (FR-4) : l'ajout groupé garde l'ordre et ignore les titres déjà présents", () => {
    const ids = Array.from({ length: 9 }, (_, i) => seedItem(db, { name: `T${i}` }));
    const id = created(db, "Lot");
    addToPlaylist(db, id, ids[2]);
    addToPlaylist(db, id, ids[5]);
    const result = addManyToPlaylist(db, id, ids, "selection");
    expect(result).toEqual({ added: ids.filter((_, i) => i !== 2 && i !== 5), already: [ids[2], ids[5]] });
    expect(order(db, id)).toEqual(["T2", "T5", "T0", "T1", "T3", "T4", "T6", "T7", "T8"]);
  });

  it("AC-4 (FR-5) : les suggestions préfèrent la même saga et la même réalisation, sans doublon", () => {
    const alien = seedItem(db, { name: "Alien", directors: ["Ridley Scott"], keywords: ["alien", "space"], genres: ["Horror", "Science Fiction"] });
    const aliens = seedItem(db, { name: "Aliens", directors: ["James Cameron"], keywords: ["alien", "marine"], genres: ["Action", "Science Fiction"] });
    seedItem(db, { name: "Prometheus", directors: ["Ridley Scott"], keywords: ["alien"], genres: ["Science Fiction"] });
    seedItem(db, { name: "Comédie sans lien", genres: ["Comedy"] });
    const sansTraits = seedItem(db, { name: "Inconnu" });
    const id = created(db, "Saga Alien", alien);
    addToPlaylist(db, id, aliens);
    const names = suggestForPlaylist(db, id).map((s) => s.name);
    expect(names[0]).toBe("Prometheus");
    expect(names).not.toContain("Alien");
    expect(names).not.toContain("Comédie sans lien");
    expect(names).not.toContain("Inconnu");
    expect(suggestForPlaylist(db, id)[0].reason).toBe("Même réalisation : Ridley Scott");
    dismissSuggestion(db, id, suggestForPlaylist(db, id)[0].id);
    expect(suggestForPlaylist(db, id).map((s) => s.name)).not.toContain("Prometheus");
    expect(sansTraits).toBeGreaterThan(0);
  });

  it("EC-3 : moins de deux titres, pas de suggestion", () => {
    const one = seedItem(db, { name: "Seul", genres: ["Drama"] });
    seedItem(db, { name: "Autre", genres: ["Drama"] });
    expect(suggestForPlaylist(db, created(db, "Un", one))).toEqual([]);
  });

  it("FR-9 : « Je regarde ça » depuis la playlist passe le titre à vu et rend le statut d'avant", () => {
    const a = seedItem(db, { name: "A" });
    const b = seedItem(db, { name: "B" });
    const id = created(db, "Deux", a);
    addToPlaylist(db, id, b);
    expect(watchFromPlaylist(db, id, a)).toEqual({ previous: "Unwatched" });
    expect(getPlaylist(db, id)!.nextId).toBe(b);
    expect(watchFromPlaylist(db, id, seedItem(db, { name: "Hors playlist" }))).toEqual({ error: "not_found" });
  });

  it("AC-5 (FR-7) : noter depuis la playlist pose la note et rend celle d'avant", () => {
    const a = seedItem(db, { name: "A", watch_status: "Watched" });
    const id = created(db, "Une", a);
    expect(rateFromPlaylist(db, id, a, 4)).toEqual({ previous: null, rating: "⭐️⭐️⭐️⭐️" });
    expect(getPlaylist(db, id)!.items[0].rating).toBe("⭐️⭐️⭐️⭐️");
    expect(rateFromPlaylist(db, id, a, 0)).toEqual({ previous: "⭐️⭐️⭐️⭐️", rating: "💩" });
    expect(getPlaylist(db, id)!.items[0].rating).toBe("💩");
    expect(rateFromPlaylist(db, id, a, 6)).toEqual({ error: "invalid_rating" });
  });

  it("AC-7 (FR-10) : la playlist en cours a un titre à voir et le geste le plus récent", () => {
    const vu = seedItem(db, { name: "Vu", watch_status: "Watched" });
    const aVoir = seedItem(db, { name: "À voir" });
    const finie = created(db, "Finie", vu);
    const enCours = created(db, "En cours", aVoir);
    // La playlist finie est touchée en dernier : elle reste écartée, faute de titre à voir.
    addToPlaylist(db, finie, seedItem(db, { name: "Vu aussi", watch_status: "Watched" }));
    expect(currentPlaylist(db)!.id).toBe(enCours);
    expect(currentPlaylist(db)!.next).toMatchObject({ id: aVoir, name: "À voir" });
    watchFromPlaylist(db, enCours, aVoir);
    expect(currentPlaylist(db)).toBeNull();
  });

  it("AC-8 (FR-12) : chaque geste est journalisé, avec sa source", () => {
    const a = seedItem(db, { name: "A" });
    const id = created(db, "Journal");
    addToPlaylist(db, id, a, undefined, "carte");
    watchFromPlaylist(db, id, a, "accueil");
    removeFromPlaylist(db, id, a);
    expect(events("playlist_created")).toHaveLength(1);
    expect(JSON.parse(events("playlist_item_added")[0].context)).toEqual({ playlistId: id, source: "carte" });
    expect(JSON.parse(events("playlist_watched")[0].context)).toEqual({ playlistId: id, source: "accueil" });
    expect(events("playlist_item_removed")).toHaveLength(1);
    deletePlaylist(db, id);
    expect(events("playlist_deleted")).toHaveLength(1);
  });
});
