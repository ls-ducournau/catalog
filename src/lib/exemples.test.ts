import { describe, expect, it } from "vitest";
import { bibliothequeExemple, goutsExemple } from "./exemples";
import type { ShowcaseTitle } from "./showcase";

function titre(
  id: number,
  genres: string[],
  category: ShowcaseTitle["category"] = "Movie",
): ShowcaseTitle {
  return { id, name: `Titre ${id}`, genres, category } as ShowcaseTitle;
}

describe("goutsExemple", () => {
  it("prend les genres les plus présents, six au plus, et compte la pile", () => {
    const titres = [
      titre(1, ["Drama", "Crime"]),
      titre(2, ["Drama", "Comedy"]),
      titre(3, ["Drama", "Action", "Crime"]),
      titre(4, ["Animation", "Family", "Comedy"]),
      titre(5, ["Horror", "Thriller", "Mystery"]),
    ];
    const g = goutsExemple(titres);
    expect(g).not.toBeNull();
    expect(g!.profile.genres).toHaveLength(6);
    expect(g!.profile.genres[0]).toMatchObject({ name: "Drama", count: 3 });
    expect(g!.pileGenres.Crime).toBe(2);
    // Chaque genre du radar filtre la liste sans la vider.
    for (const e of g!.profile.genres)
      expect(titres.some((t) => t.genres.includes(e.name))).toBe(true);
  });

  it("laisse dehors les genres combinés des séries", () => {
    const g = goutsExemple([
      titre(1, ["Fantasy", "Sci-Fi & Fantasy"]),
      titre(2, ["Drama", "Sci-Fi & Fantasy"]),
      titre(3, ["Comedy"]),
    ]);
    expect(g!.profile.genres.map((e) => e.name)).not.toContain(
      "Sci-Fi & Fantasy",
    );
  });

  it("renonce sous trois genres", () => {
    expect(
      goutsExemple([titre(1, ["Drama"]), titre(2, ["Drama", "Crime"])]),
    ).toBeNull();
  });
});

describe("bibliothequeExemple", () => {
  it("compte les titres sans doublon, par type, et répartit les notes des vus", () => {
    const titres = [
      titre(1, []),
      titre(1, []),
      titre(2, [], "TV Series"),
      ...Array.from({ length: 18 }, (_, i) => titre(10 + i, [])),
    ];
    const s = bibliothequeExemple(titres);
    expect(s.total).toBe(20);
    expect(s.watched + s.toWatch).toBe(20);
    expect(s.ratings.reduce((a, n) => a + n, 0)).toBe(s.watched);
    expect(s.categories[0]).toEqual({ value: "Movie", count: 19 });
    expect(s.categories[1]).toEqual({ value: "TV Series", count: 1 });
  });
});
