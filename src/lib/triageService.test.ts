import type Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestDb } from "./db";
import { countDismissals, dismiss, dismissedTmdbKeys, undismiss } from "./dismissalService";
import { acceptanceStats, logEvent } from "./journalService";
import { addTitleToLibrary, removeFromLibrary } from "./libraryActions";
import { getOpinions, setOpinion } from "./personOpinionService";
import { PERSON_BONUS, PERSON_BONUS_CAP, personBonus } from "./personPreference";
import { resetPreferenceModelCache } from "./preferenceService";
import { getRecommendations } from "./recommendationService";
import {
  answerTriage,
  getTriageBatch,
  parseTriageSubject,
  parseTriageUndo,
  SEEN_LIKE_RATING,
  undoTriage,
} from "./triageService";

// spec: specs/tri-rapide-v1.md (AC-1 à AC-5)

vi.mock("./tmdb", () => ({
  posterUrl: (path: string | null) => (path ? `https://image.tmdb.org/t/p/w500${path}` : null),
}));
// Ajouter ou retirer passe par Notion : jamais depuis les tests.
vi.mock("./libraryActions", () => ({
  addTitleToLibrary: vi.fn(),
  removeFromLibrary: vi.fn(),
}));
vi.mock("./discoveryService", () => ({ getDiscoveries: vi.fn() }));

const STARS = ["💩", "⭐️", "⭐️⭐️", "⭐️⭐️⭐️", "⭐️⭐️⭐️⭐️", "⭐️⭐️⭐️⭐️⭐️"];

function seed(
  db: Database.Database,
  item: {
    name: string;
    status: "Watched" | "Unwatched";
    stars?: number;
    keywords?: string[];
    cast?: number[];
    type?: "Movie" | "TV Series";
  }
): number {
  const now = new Date().toISOString();
  const features = {
    genres: ["Drama"],
    keywords: item.keywords ?? [],
    cast: (item.cast ?? []).map((id) => ({ id, name: `Personne ${id}`, profilePath: null })),
    directors: [],
    year: 2010,
    runtime: 110,
    language: "en",
    countries: ["US"],
    voteAverage: 7,
    voteCount: 5000,
    popularity: 20,
  };
  const result = db
    .prepare(
      `INSERT INTO items (notion_page_id, name, type, watch_status, rating, genre, tmdb_features, notion_last_edited, updated_at)
       VALUES (?, ?, ?, ?, ?, '["Drama"]', ?, ?, ?)`
    )
    .run(
      `page-${item.name}`,
      item.name,
      item.type ?? "Movie",
      item.status,
      item.stars === undefined ? null : STARS[item.stars],
      JSON.stringify(features),
      now,
      now
    );
  return Number(result.lastInsertRowid);
}

function ratingOf(db: Database.Database, id: number): string | null {
  return (db.prepare(`SELECT rating FROM items WHERE id = ?`).get(id) as { rating: string | null }).rating;
}

function countEvents(db: Database.Database, kind?: string): number {
  const sql = kind ? `SELECT COUNT(*) c FROM events WHERE kind = ?` : `SELECT COUNT(*) c FROM events`;
  return (db.prepare(sql).get(...(kind ? [kind] : [])) as { c: number }).c;
}

/** Assez de titres vus notés pour sortir du démarrage à froid (10). */
function seedWatchedHistory(db: Database.Database): void {
  for (let i = 0; i < 12; i++) {
    seed(db, { name: `Vu ${i}`, status: "Watched", stars: 3 + (i % 3), keywords: ["drama"] });
  }
}

let db: Database.Database;

beforeEach(() => {
  db = createTestDb();
  resetPreferenceModelCache();
  vi.mocked(addTitleToLibrary).mockReset();
  vi.mocked(removeFromLibrary).mockReset();
});

describe("Ne plus me proposer (AC-1)", () => {
  it("retire un item de la pile sans le retirer de la bibliothèque, et le rend à l'annulation", () => {
    seedWatchedHistory(db);
    const candidate = seed(db, { name: "Candidat", status: "Unwatched", keywords: ["drama"] });
    const names = () => {
      const result = getRecommendations(db);
      if ("error" in result) throw new Error("démarrage à froid inattendu");
      return result.items.map((i) => i.name);
    };

    expect(names()).toContain("Candidat");

    dismiss(db, { type: "item", id: candidate });
    expect(names()).not.toContain("Candidat");
    expect(db.prepare(`SELECT id FROM items WHERE id = ?`).get(candidate)).toBeDefined();
    expect(countDismissals(db)).toBe(1);

    undismiss(db, { type: "item", id: candidate });
    expect(names()).toContain("Candidat");
    expect(countDismissals(db)).toBe(0);
  });

  it("distingue un film d'une série qui partagent le même numéro TMDB", () => {
    dismiss(db, { type: "tmdb", mediaType: "Movie", tmdbId: 42 });
    expect(dismissedTmdbKeys(db)).toEqual(new Set(["movie:42"]));
  });

  it("n'écarte et ne journalise qu'une fois un même titre", () => {
    dismiss(db, { type: "tmdb", mediaType: "TV Series", tmdbId: 7 });
    dismiss(db, { type: "tmdb", mediaType: "TV Series", tmdbId: 7 });
    expect(countDismissals(db)).toBe(1);
    // Annuler un écartement inexistant ne laisse pas de trace.
    undismiss(db, { type: "tmdb", mediaType: "Movie", tmdbId: 7 });
    expect(countEvents(db, "undismissed")).toBe(0);
  });
});

describe("Tri rapide — réponses et annulation (AC-2, AC-3, FR-4, FR-6)", () => {
  it("« J'aime » sur un titre vu pose ⭐⭐⭐⭐, l'annulation le rend sans note (AC-2)", async () => {
    const id = seed(db, { name: "Vu sans note", status: "Watched" });

    const result = await answerTriage(db, { family: "seen", id }, "like");
    if ("error" in result) throw new Error(result.error);
    expect(ratingOf(db, id)).toBe(SEEN_LIKE_RATING);

    await undoTriage(db, result.undo);
    expect(ratingOf(db, id)).toBeNull();
  });

  it("une note de 0 à 5 sur un titre vu la pose telle quelle ; l'annulation la retire", async () => {
    const top = seed(db, { name: "Chef-d'œuvre", status: "Watched" });
    const bad = seed(db, { name: "Nul", status: "Watched" });

    const five = await answerTriage(db, { family: "seen", id: top }, "like", 5);
    if ("error" in five) throw new Error(five.error);
    expect(ratingOf(db, top)).toBe("⭐️⭐️⭐️⭐️⭐️");

    await answerTriage(db, { family: "seen", id: bad }, "like", 0);
    expect(ratingOf(db, bad)).toBe("💩");

    await undoTriage(db, five.undo);
    expect(ratingOf(db, top)).toBeNull();
  });

  it("« Je n'aime pas » sur un titre vu pose ⭐⭐", async () => {
    const id = seed(db, { name: "Vu sans note", status: "Watched" });
    await answerTriage(db, { family: "seen", id }, "dislike");
    expect(ratingOf(db, id)).toBe("⭐️⭐️");
  });

  it("« Passer » ne change rien, sinon le journal (AC-3)", async () => {
    const id = seed(db, { name: "Vu sans note", status: "Watched" });

    const result = await answerTriage(db, { family: "seen", id }, "skip");
    expect(result).toEqual({ undo: { kind: "none" } });
    expect(ratingOf(db, id)).toBeNull();
    expect(countEvents(db)).toBe(1);
    expect(countEvents(db, "triage")).toBe(1);
  });

  it("« Je n'aime pas » sur un titre à découvrir l'écarte, et l'annulation le rend", async () => {
    const card = { family: "unseen" as const, tmdbId: 99, mediaType: "Movie" as const };

    const result = await answerTriage(db, card, "dislike");
    if ("error" in result) throw new Error(result.error);
    expect(dismissedTmdbKeys(db).has("movie:99")).toBe(true);

    await undoTriage(db, result.undo);
    expect(dismissedTmdbKeys(db).has("movie:99")).toBe(false);
  });

  it("« J'aime » sur un titre à découvrir l'ajoute (origine : tri) ; l'annulation le retire", async () => {
    vi.mocked(addTitleToLibrary).mockResolvedValue({
      item: { id: 314 } as never,
      alreadyExists: false,
    });
    vi.mocked(removeFromLibrary).mockResolvedValue({ ok: true });

    const result = await answerTriage(db, { family: "unseen", tmdbId: 99, mediaType: "Movie" }, "like");
    if ("error" in result) throw new Error(result.error);
    expect(addTitleToLibrary).toHaveBeenCalledWith(db, 99, "Movie", "triage");

    await undoTriage(db, result.undo);
    expect(removeFromLibrary).toHaveBeenCalledWith(db, 314);
  });

  it("n'annule pas l'ajout d'un titre qui était déjà dans la bibliothèque", async () => {
    vi.mocked(addTitleToLibrary).mockResolvedValue({ item: { id: 1 } as never, alreadyExists: true });

    const result = await answerTriage(db, { family: "unseen", tmdbId: 5, mediaType: "Movie" }, "like");
    expect(result).toEqual({ undo: { kind: "none" } });
  });

  it("retient l'avis sur une personne, et l'annulation rétablit l'avis précédent", async () => {
    const person = { family: "person" as const, id: 287, name: "Brad Pitt" };

    const first = await answerTriage(db, person, "like");
    if ("error" in first) throw new Error(first.error);
    expect(getOpinions(db).get(287)).toBe(1);

    // Changer d'avis puis annuler : on revient à « aimé », pas à « aucun avis ».
    const second = await answerTriage(db, person, "dislike");
    if ("error" in second) throw new Error(second.error);
    expect(getOpinions(db).get(287)).toBe(-1);
    await undoTriage(db, second.undo);
    expect(getOpinions(db).get(287)).toBe(1);

    await undoTriage(db, first.undo);
    expect(getOpinions(db).has(287)).toBe(false);
  });
});

describe("Tri rapide — lots (FR-3)", () => {
  it("« Déjà vus » ne propose que des titres vus sans note, filtrables par catégorie", async () => {
    seed(db, { name: "Film vu sans note", status: "Watched" });
    seed(db, { name: "Série vue sans note", status: "Watched", type: "TV Series" });
    seed(db, { name: "Film vu noté", status: "Watched", stars: 4 });
    seed(db, { name: "Film à voir", status: "Unwatched" });

    const all = await getTriageBatch(db, "seen");
    expect(all.map((c) => (c.family === "seen" ? c.title : "")).sort()).toEqual([
      "Film vu sans note",
      "Série vue sans note",
    ]);

    const series = await getTriageBatch(db, "seen", { category: "TV Series" });
    expect(series.map((c) => (c.family === "seen" ? c.title : ""))).toEqual(["Série vue sans note"]);
  });

  it("ne rend pas une carte déjà montrée dans la session, même passée (EC-2)", async () => {
    const skipped = seed(db, { name: "Passé", status: "Watched" });
    seed(db, { name: "Pas encore montré", status: "Watched" });
    for (let i = 0; i < 3; i++) seed(db, { name: `Avec 1 — ${i}`, status: "Watched", cast: [1] });

    const seen = await getTriageBatch(db, "seen", { exclude: [`item:${skipped}`] });
    expect(seen.map((c) => (c.family === "seen" ? c.title : ""))).not.toContain("Passé");
    expect(seen.map((c) => (c.family === "seen" ? c.title : ""))).toContain("Pas encore montré");

    expect(await getTriageBatch(db, "person", { exclude: ["person:1"] })).toEqual([]);
  });

  it("« Personnes » exige 3 titres vus et saute celles qui ont déjà un avis", async () => {
    for (let i = 0; i < 3; i++) seed(db, { name: `Avec 1 et 2 — ${i}`, status: "Watched", cast: [1, 2] });
    seed(db, { name: "Avec 3", status: "Watched", cast: [3] });
    seed(db, { name: "À voir avec 3", status: "Unwatched", cast: [3] });
    seed(db, { name: "À voir avec 3 bis", status: "Unwatched", cast: [3] });

    const ids = async () => (await getTriageBatch(db, "person")).map((c) => (c.family === "person" ? c.id : 0));
    expect((await ids()).sort()).toEqual([1, 2]);

    setOpinion(db, { id: 1, name: "Personne 1" }, 1);
    expect(await ids()).toEqual([2]);
  });
});

describe("Avis sur les personnes → classement (AC-4, FR-7)", () => {
  it("donne un bonus borné pour une personne aimée, le malus symétrique sinon", () => {
    const opinions = new Map<number, 1 | -1>([
      [1, 1],
      [2, -1],
    ]);
    expect(personBonus([1, 99], opinions)).toBe(PERSON_BONUS);
    expect(personBonus([2], opinions)).toBe(-PERSON_BONUS);
    expect(personBonus([1, 2], opinions)).toBe(0);
    // Un même nom listé deux fois (acteur et producteur) ne compte qu'une fois.
    expect(personBonus([1, 1], opinions)).toBe(PERSON_BONUS);

    const many = new Map<number, 1 | -1>(Array.from({ length: 10 }, (_, i) => [i, 1] as [number, 1]));
    expect(personBonus([...many.keys()], many)).toBe(PERSON_BONUS_CAP);
  });

  it("fait passer devant le candidat où joue un acteur aimé, derrière s'il ne l'est pas", () => {
    seedWatchedHistory(db);
    // Deux candidats identiques, chacun avec un acteur inconnu du modèle : seul l'avis les départage.
    seed(db, { name: "Avec l'acteur", status: "Unwatched", keywords: ["drama"], cast: [42] });
    seed(db, { name: "Sans lui", status: "Unwatched", keywords: ["drama"], cast: [43] });
    const order = () => {
      const result = getRecommendations(db);
      if ("error" in result) throw new Error("démarrage à froid inattendu");
      return result.items.map((i) => i.name);
    };

    setOpinion(db, { id: 42, name: "Personne 42" }, 1);
    expect(order()).toEqual(["Avec l'acteur", "Sans lui"]);

    setOpinion(db, { id: 42, name: "Personne 42" }, -1);
    expect(order()).toEqual(["Sans lui", "Avec l'acteur"]);
  });
});

describe("Taux d'acceptation (AC-5, FR-8)", () => {
  it("vaut 80 % gardés et 50 % bien notés pour 4 ajouts, 1 écarté, 2 vus dont 1 à ⭐⭐⭐⭐⭐", () => {
    const loved = seed(db, { name: "Adoré", status: "Watched", stars: 5 });
    const meh = seed(db, { name: "Bof", status: "Watched", stars: 3 });
    const pending1 = seed(db, { name: "Pas encore vu", status: "Unwatched" });
    const pending2 = seed(db, { name: "Pas encore vu bis", status: "Unwatched" });
    const searched = seed(db, { name: "Cherché soi-même", status: "Watched", stars: 5 });

    logEvent(db, "added", "item", loved, { source: "discover" });
    logEvent(db, "added", "item", meh, { source: "triage" });
    logEvent(db, "added", "item", pending1, { source: "suggestions" });
    logEvent(db, "added", "item", pending2, { source: "discover" });
    // Un titre cherché soi-même n'est pas une proposition acceptée.
    logEvent(db, "added", "item", searched, { source: "search" });
    dismiss(db, { type: "tmdb", mediaType: "Movie", tmdbId: 1 });

    expect(acceptanceStats(db)).toEqual({ decided: 5, keptRate: 0.8, seen: 2, lovedRate: 0.5 });
  });

  it("ne mesure rien tant qu'aucune proposition n'a été tranchée", () => {
    expect(acceptanceStats(db)).toEqual({ decided: 0, keptRate: null, seen: 0, lovedRate: null });
  });
});

describe("Validation des requêtes", () => {
  it("n'accepte que des cartes et des annulations bien formées", () => {
    expect(parseTriageSubject({ family: "seen", id: 3 })).toEqual({ family: "seen", id: 3 });
    expect(parseTriageSubject({ family: "unseen", tmdbId: 3, mediaType: "Book" })).toBeNull();
    expect(parseTriageSubject({ family: "person", id: 3 })).toBeNull();
    expect(parseTriageSubject(null)).toBeNull();

    expect(parseTriageUndo({ kind: "rating", itemId: 3, previous: null })).toEqual({
      kind: "rating",
      itemId: 3,
      previous: null,
    });
    expect(parseTriageUndo({ kind: "rating", itemId: 3, previous: "10/10" })).toBeNull();
    expect(parseTriageUndo({ kind: "opinion", personId: 3, name: "X", previous: 2 })).toBeNull();
    expect(parseTriageUndo({ kind: "drop-table" })).toBeNull();
  });
});
