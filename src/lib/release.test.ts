import { describe, expect, it } from "vitest";
import { releaseBadge, releaseFromTmdb, type ReleaseInfo } from "./release";

// spec: specs/sorties-v1.md (AC-1 à AC-4, EC-2)

const TODAY = new Date("2026-09-26T10:00:00Z");

function movie(overrides: Partial<ReleaseInfo> = {}): ReleaseInfo {
  return {
    kind: "movie",
    theatrical: null,
    digital: null,
    firstAir: null,
    nextEpisode: null,
    status: "Released",
    fetchedAt: TODAY.toISOString(),
    ...overrides,
  };
}

function series(overrides: Partial<ReleaseInfo> = {}): ReleaseInfo {
  return { ...movie(), kind: "tv", status: "Returning Series", ...overrides };
}

describe("releaseBadge", () => {
  it("dit « Au cinéma » dix jours après la sortie en salle, plus rien après la sortie numérique (AC-1)", () => {
    expect(releaseBadge(movie({ theatrical: "2026-09-16" }), TODAY)).toEqual({ kind: "in_theaters" });
    expect(releaseBadge(movie({ theatrical: "2026-09-16", digital: "2026-09-25" }), TODAY)).toBeNull();
  });

  it("n'est plus au cinéma après six semaines", () => {
    expect(releaseBadge(movie({ theatrical: "2026-08-01" }), TODAY)).toBeNull();
  });

  it("annonce une nouvelle saison avec sa date (AC-2)", () => {
    const badge = releaseBadge(
      series({ firstAir: "2021-03-01", nextEpisode: { date: "2026-10-08", season: 3, episode: 1 } }),
      TODAY
    );
    expect(badge).toEqual({ kind: "upcoming", date: "2026-10-08", label: "Saison 3 le 8 oct." });
  });

  it("ne signale pas un simple épisode de milieu de saison", () => {
    expect(
      releaseBadge(series({ firstAir: "2021-03-01", nextEpisode: { date: "2026-10-01", season: 3, episode: 4 } }), TODAY)
    ).toBeNull();
  });

  it("annonce un film à venir à sa date, avec l'année si elle change (AC-3)", () => {
    expect(releaseBadge(movie({ theatrical: "2026-10-16" }), TODAY)).toEqual({
      kind: "upcoming",
      date: "2026-10-16",
      label: "Au cinéma le 16 oct.",
    });
    expect(releaseBadge(movie({ theatrical: "2027-02-03" }), TODAY)?.kind).toBe("upcoming");
    expect(releaseBadge(movie({ theatrical: "2027-02-03" }), TODAY)).toMatchObject({
      label: "Au cinéma le 3 févr. 2027",
    });
  });

  it("annonce une série pas encore diffusée", () => {
    expect(releaseBadge(series({ firstAir: "2026-11-02", status: "Planned" }), TODAY)).toMatchObject({
      kind: "upcoming",
      label: "Nouvelle série le 2 nov.",
    });
  });

  it("ne dit « Prochainement » que pour un titre annoncé sans date (EC-2)", () => {
    expect(releaseBadge(movie({ status: "In Production" }), TODAY)).toEqual({
      kind: "upcoming",
      date: null,
      label: "Prochainement",
    });
    expect(releaseBadge(movie({ status: "Released" }), TODAY)).toBeNull();
    expect(releaseBadge(null, TODAY)).toBeNull();
  });
});

describe("releaseFromTmdb (AC-4)", () => {
  it("retient la plus ancienne sortie française en salle, et la sortie numérique", () => {
    const info = releaseFromTmdb(
      {
        status: "Released",
        release_date: "2026-08-20",
        release_dates: {
          results: [
            { iso_3166_1: "US", release_dates: [{ type: 3, release_date: "2026-08-20T00:00:00.000Z" }] },
            {
              iso_3166_1: "FR",
              release_dates: [
                { type: 1, release_date: "2026-05-18T00:00:00.000Z" },
                { type: 3, release_date: "2026-09-17T00:00:00.000Z" },
                { type: 3, release_date: "2026-09-10T00:00:00.000Z" },
                { type: 4, release_date: "2026-12-01T00:00:00.000Z" },
              ],
            },
          ],
        },
      },
      true,
      TODAY
    );
    expect(info).toMatchObject({ kind: "movie", theatrical: "2026-09-10", digital: "2026-12-01" });
  });

  it("retombe sur la date mondiale sans sortie française, et sur la sortie limitée sans sortie large", () => {
    expect(releaseFromTmdb({ release_date: "2026-10-30" }, true, TODAY).theatrical).toBe("2026-10-30");
    expect(
      releaseFromTmdb(
        {
          release_date: "2026-10-30",
          release_dates: { results: [{ iso_3166_1: "FR", release_dates: [{ type: 2, release_date: "2026-11-05" }] }] },
        },
        true,
        TODAY
      ).theatrical
    ).toBe("2026-11-05");
  });

  it("lit la première diffusion et le prochain épisode d'une série", () => {
    const info = releaseFromTmdb(
      {
        status: "Returning Series",
        first_air_date: "2019-07-26",
        next_episode_to_air: { air_date: "2026-10-08", season_number: 5, episode_number: 1 },
      },
      false,
      TODAY
    );
    expect(info).toMatchObject({
      kind: "tv",
      firstAir: "2019-07-26",
      nextEpisode: { date: "2026-10-08", season: 5, episode: 1 },
      status: "Returning Series",
    });
  });

  it("ignore une date vide ou mal formée", () => {
    const info = releaseFromTmdb({ first_air_date: "", next_episode_to_air: { air_date: null } }, false, TODAY);
    expect(info.firstAir).toBeNull();
    expect(info.nextEpisode).toBeNull();
  });
});
