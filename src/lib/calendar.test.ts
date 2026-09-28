import { describe, expect, it } from "vitest";
import { calendarWindows, eventsOf, groupByWeek } from "./calendar";
import type { ReleaseInfo } from "./release";

// spec: specs/sorties-v1.md (FR-3, AC-5)

const TODAY = new Date("2026-09-26T10:00:00Z"); // un samedi
const FROM = "2026-08-27";
const TO = "2026-12-25";

const base: ReleaseInfo = {
  kind: "movie",
  theatrical: null,
  digital: null,
  firstAir: null,
  nextEpisode: null,
  status: null,
  fetchedAt: TODAY.toISOString(),
};

describe("eventsOf", () => {
  it("retient la sortie en salle d'un film dans la période, et sa sortie numérique sur demande", () => {
    const film = { ...base, theatrical: "2026-10-16", digital: "2026-12-20" };
    expect(eventsOf(film, FROM, TO)).toEqual([{ date: "2026-10-16", event: "theatrical", season: null }]);
    expect(eventsOf(film, FROM, TO, { withDigital: true }).map((e) => e.event)).toEqual(["theatrical", "digital"]);
  });

  it("ignore ce qui sort de la période", () => {
    expect(eventsOf({ ...base, theatrical: "2025-01-10" }, FROM, TO)).toEqual([]);
  });

  it("annonce une nouvelle saison, mais pas deux fois la première d'une série", () => {
    const returning: ReleaseInfo = {
      ...base,
      kind: "tv",
      firstAir: "2019-07-26",
      nextEpisode: { date: "2026-10-08", season: 5, episode: 1 },
    };
    expect(eventsOf(returning, FROM, TO)).toEqual([{ date: "2026-10-08", event: "season_premiere", season: 5 }]);

    const brandNew: ReleaseInfo = {
      ...base,
      kind: "tv",
      firstAir: "2026-11-02",
      nextEpisode: { date: "2026-11-02", season: 1, episode: 1 },
    };
    expect(eventsOf(brandNew, FROM, TO)).toEqual([{ date: "2026-11-02", event: "series_premiere", season: null }]);
  });

  it("ne compte pas un épisode de milieu de saison", () => {
    const airing: ReleaseInfo = {
      ...base,
      kind: "tv",
      firstAir: "2020-01-01",
      nextEpisode: { date: "2026-10-01", season: 3, episode: 6 },
    };
    expect(eventsOf(airing, FROM, TO)).toEqual([]);
  });
});

describe("groupByWeek (AC-5)", () => {
  const entry = (key: string, date: string, score = 0) => ({ key, date, score });

  it("groupe par semaine (du lundi au dimanche), dans l'ordre, sans doublon", () => {
    const weeks = groupByWeek(
      [
        entry("b", "2026-10-02"),
        entry("a", "2026-09-28"),
        entry("c", "2026-09-27"),
        entry("a", "2026-09-28"),
        entry("d", "2026-10-15"),
      ],
      TODAY
    );
    expect(weeks.map((w) => [w.start, w.label, w.entries.map((e) => e.key)])).toEqual([
      ["2026-09-21", "Cette semaine", ["c"]],
      ["2026-09-28", "La semaine prochaine", ["a", "b"]],
      ["2026-10-12", "Semaine du 12 oct.", ["d"]],
    ]);
  });

  it("à date égale, range le plus prometteur d'abord", () => {
    const [week] = groupByWeek(
      [entry("faible", "2026-09-29", 0.3), entry("fort", "2026-09-29", 0.8)],
      TODAY,
      (a, b) => b.score - a.score
    );
    expect(week.entries.map((e) => e.key)).toEqual(["fort", "faible"]);
  });

  it("nomme la semaine passée", () => {
    const [week] = groupByWeek([entry("x", "2026-09-16")], TODAY);
    expect(week.label).toBe("La semaine dernière");
  });
});

describe("calendarWindows (FR-6 ter)", () => {
  it("découpe la frise en tranches mensuelles jusqu'à l'horizon", () => {
    expect(calendarWindows(TODAY, 3)).toEqual([
      { from: "2026-08-27", to: "2026-09-30" },
      { from: "2026-10-01", to: "2026-10-31" },
      { from: "2026-11-01", to: "2026-11-30" },
      { from: "2026-12-01", to: "2026-12-26" },
    ]);
  });

  it("passe d'une année à l'autre", () => {
    const windows = calendarWindows(TODAY, 12);
    expect(windows).toHaveLength(13);
    expect(windows[4]).toEqual({ from: "2027-01-01", to: "2027-01-31" });
    expect(windows.at(-1)).toEqual({ from: "2027-09-01", to: "2027-09-26" });
  });
});
