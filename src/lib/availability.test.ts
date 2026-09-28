import { describe, expect, it } from "vitest";
import {
  coveredProviderIds,
  includedIn,
  isStale,
  serviceFamily,
  type Availability,
  type Provider,
} from "./availability";

// spec: specs/disponibilite-streaming-v1.md — AC-1, AC-2, AC-3

const NETFLIX: Provider = { id: 8, name: "Netflix", logoPath: "/netflix.jpg" };
const NETFLIX_ADS: Provider = { id: 1796, name: "Netflix Standard with Ads", logoPath: "/nf-ads.jpg" };
const PRIME: Provider = { id: 119, name: "Amazon Prime Video", logoPath: "/prime.jpg" };
const PARAMOUNT_CHANNEL: Provider = { id: 582, name: "Paramount+ Amazon Channel", logoPath: null };
const CATALOG = [NETFLIX, NETFLIX_ADS, PRIME, PARAMOUNT_CHANNEL];

function availability(overrides: Partial<Availability> = {}): Availability {
  return {
    link: "https://www.themoviedb.org/tv/1396/watch?locale=FR",
    flatrate: [],
    free: [],
    ads: [],
    rent: [],
    buy: [],
    fetchedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("serviceFamily", () => {
  it("assimile une formule avec publicité au service lui-même", () => {
    expect(serviceFamily("Netflix Standard with Ads")).toBe(serviceFamily("Netflix"));
  });

  it("garde distincte une chaîne vendue via un autre service", () => {
    expect(serviceFamily("Paramount+ Amazon Channel")).not.toBe(serviceFamily("Amazon Prime Video"));
  });
});

describe("includedIn", () => {
  it("retient un titre listé seulement sous la formule avec publicité de ton abonnement (AC-1)", () => {
    const covered = coveredProviderIds([NETFLIX.id], CATALOG);
    const onlyAds = availability({ flatrate: [NETFLIX_ADS] });

    expect(includedIn(onlyAds, covered).map((p) => p.id)).toEqual([NETFLIX_ADS.id]);
  });

  it("ne retient pas un titre seulement en location ou à l'achat (AC-2)", () => {
    const covered = coveredProviderIds([PRIME.id], CATALOG);
    expect(includedIn(availability({ rent: [PRIME], buy: [PRIME] }), covered)).toEqual([]);
  });

  it("ne confond pas Prime Video et une chaîne Amazon", () => {
    const covered = coveredProviderIds([PRIME.id], CATALOG);
    expect(includedIn(availability({ flatrate: [PARAMOUNT_CHANNEL] }), covered)).toEqual([]);
  });

  it("n'affiche qu'une fois un service présent sous deux formules", () => {
    const covered = coveredProviderIds([NETFLIX.id], CATALOG);
    const both = availability({ flatrate: [NETFLIX, NETFLIX_ADS] });
    expect(includedIn(both, covered).map((p) => p.id)).toEqual([NETFLIX.id]);
  });

  it("ne retient rien sans disponibilité connue", () => {
    expect(includedIn(null, coveredProviderIds([NETFLIX.id], CATALOG))).toEqual([]);
  });
});

describe("isStale (AC-3)", () => {
  const now = new Date("2026-09-25T12:00:00Z");
  const fetched = (daysAgo: number) =>
    availability({ fetchedAt: new Date(now.getTime() - daysAgo * 86_400_000).toISOString() });

  it("considère périmée une disponibilité de plus de 7 jours", () => {
    expect(isStale(fetched(8), now)).toBe(true);
  });

  it("garde une disponibilité récente", () => {
    expect(isStale(fetched(2), now)).toBe(false);
  });

  it("considère périmée une disponibilité jamais récupérée", () => {
    expect(isStale(null, now)).toBe(true);
  });
});
