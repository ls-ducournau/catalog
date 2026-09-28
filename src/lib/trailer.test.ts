import { describe, expect, it } from "vitest";
import {
  chooseTrailer,
  interpretOEmbed,
  pickTrailer,
  rankTrailers,
  trailerFailureCopy,
  trailerFailureFromCode,
  trailerPlayerVars,
  trailerSearchUrl,
} from "./trailer";

// spec: specs/bandes-annonces-v1.md (AC-1 à AC-3, AC-5 à AC-7, FR-4, NFR-1)

const video = (overrides: Record<string, unknown>) => ({
  site: "YouTube",
  key: "k",
  type: "Trailer",
  iso_639_1: "fr",
  official: true,
  name: "Bande-annonce",
  published_at: "2024-01-01T00:00:00.000Z",
  ...overrides,
});

describe("pickTrailer", () => {
  it("préfère une bande-annonce à un teaser ou un extrait, même en anglais (AC-1)", () => {
    const picked = pickTrailer([
      video({ key: "clip-fr", type: "Clip" }),
      video({ key: "teaser-fr", type: "Teaser" }),
      video({ key: "trailer-en", iso_639_1: "en" }),
    ]);
    expect(picked).toMatchObject({ key: "trailer-en", kind: "Trailer", language: "en" });
  });

  it("à langue égale, l'officielle ; à égalité, la plus récente (AC-2)", () => {
    expect(
      pickTrailer([video({ key: "fan", official: false }), video({ key: "officielle", official: true })])?.key
    ).toBe("officielle");
    expect(
      pickTrailer([
        video({ key: "ancienne", published_at: "2020-01-01T00:00:00.000Z" }),
        video({ key: "récente", published_at: "2023-05-01T00:00:00.000Z" }),
      ])?.key
    ).toBe("récente");
  });

  it("ne retient ni extrait, ni making-of, ni vidéo hors YouTube (AC-3)", () => {
    expect(
      pickTrailer([
        video({ type: "Clip" }),
        video({ type: "Featurette" }),
        video({ type: "Behind the Scenes" }),
        video({ site: "Vimeo" }),
      ])
    ).toBeNull();
    expect(pickTrailer(undefined)).toBeNull();
  });

  it("le français passe devant l'anglais, l'anglais devant une vidéo sans langue", () => {
    expect(
      pickTrailer([video({ key: "sans", iso_639_1: null }), video({ key: "en", iso_639_1: "en" }), video({ key: "fr" })])
        ?.key
    ).toBe("fr");
    expect(pickTrailer([video({ key: "sans", iso_639_1: null }), video({ key: "en", iso_639_1: "en" })])?.key).toBe("en");
  });
});

describe("échec de lecture (FR-6, AC-5)", () => {
  it("déduit la cause du code d'erreur de YouTube", () => {
    expect(trailerFailureFromCode(101)).toBe("blocked");
    expect(trailerFailureFromCode(150)).toBe("blocked");
    expect(trailerFailureFromCode(100)).toBe("removed");
    expect(trailerFailureFromCode(5)).toBe("player_error");
    expect(trailerFailureFromCode(153)).toBe("player_error");
  });

  it("ne met jamais l'app en cause, ni « les autres sites », ni « ici » (AC-5)", () => {
    for (const failure of ["blocked", "removed", "player_error", "player_unavailable"] as const) {
      for (const channel of [null, "Netflix France"]) {
        const copy = trailerFailureCopy(failure, channel);
        expect(`${copy.title} ${copy.detail}`).not.toMatch(/l'app|l'application|autres sites|\bici\b/i);
      }
    }
  });

  it("un blocage de YouTube (101, 150) cite le contexte de lecture, jamais la chaîne (AC-5)", () => {
    const copy = trailerFailureCopy("blocked", "Sky TV");
    expect(copy.title).toBe("YouTube a bloqué la lecture de cette bande-annonce.");
    expect(copy.detail).toMatch(/VPN/);
    expect(copy.detail).toMatch(/navigateur/);
    expect(`${copy.title} ${copy.detail}`).not.toMatch(/Sky TV|chaîne|réserve/);
    expect(copy.retry).toBe(true);
  });

  it("nomme la chaîne quand elle a retiré la vidéo (AC-5)", () => {
    expect(trailerFailureCopy("removed", "Gaumont").detail).toMatch(/^Gaumont l'a retirée/);
  });

  it("pour une vidéo retirée, propose de chercher une autre bande-annonce du titre", () => {
    expect(trailerFailureCopy("removed").action).toBe("search");
    expect(trailerSearchUrl("Dune : Deuxième partie")).toBe(
      "https://www.youtube.com/results?search_query=Dune%20%3A%20Deuxi%C3%A8me%20partie%20bande%20annonce"
    );
  });
});

describe("trailerPlayerVars", () => {
  it("passe l'origine au lecteur, et demande des sous-titres français en VO (FR-4)", () => {
    const vo = trailerPlayerVars({ key: "abc", name: "Trailer", language: "en", kind: "Trailer" }, "http://localhost:3000");
    expect(vo).toMatchObject({ autoplay: "1", origin: "http://localhost:3000", cc_load_policy: "1", cc_lang_pref: "fr" });
    const vf = trailerPlayerVars({ key: "abc", name: "Bande-annonce", language: "fr", kind: "Trailer" });
    expect(vf).not.toHaveProperty("cc_lang_pref");
    expect(vf).not.toHaveProperty("origin");
  });
});

describe("choix d'une bande-annonce lisible (FR-8)", () => {
  const candidates = rankTrailers([
    video({ key: "vf-officielle" }),
    video({ key: "vf-fan", official: false }),
    video({ key: "vo", iso_639_1: "en" }),
  ]);

  it("lit la réponse d'oEmbed", () => {
    expect(interpretOEmbed(200, { author_name: "Gaumont" })).toEqual({ state: "embeddable", channel: "Gaumont" });
    expect(interpretOEmbed(401)).toEqual({ state: "restricted" });
    expect(interpretOEmbed(404)).toEqual({ state: "removed" });
    expect(interpretOEmbed(500)).toEqual({ state: "unknown" });
  });

  it("garde l'ordre de préférence, et pickTrailer prend la première", () => {
    expect(candidates.map((c) => c.key)).toEqual(["vf-officielle", "vf-fan", "vo"]);
    expect(pickTrailer([video({ key: "vf-fan", official: false }), video({ key: "vf-officielle" })])?.key).toBe("vf-officielle");
  });

  it("saute une vidéo réservée à YouTube ou retirée pour la suivante lisible, avec sa chaîne (AC-6)", async () => {
    const states: Record<string, ReturnType<typeof interpretOEmbed>> = {
      "vf-officielle": { state: "restricted" },
      "vf-fan": { state: "removed" },
      vo: { state: "embeddable", channel: "Pathé Cinémas" },
    };
    const chosen = await chooseTrailer(candidates, async (key) => states[key]);
    expect(chosen).toMatchObject({ key: "vo", embeddable: true, channel: "Pathé Cinémas" });
  });

  it("sans version lisible, garde la meilleure réservée à YouTube, marquée comme telle (AC-7)", async () => {
    const chosen = await chooseTrailer(candidates, async () => ({ state: "restricted" }));
    expect(chosen).toMatchObject({ key: "vf-officielle", embeddable: false });
  });

  it("un doute (réseau) ne pénalise pas la vidéo", async () => {
    const chosen = await chooseTrailer(candidates, async () => ({ state: "unknown" }));
    expect(chosen?.key).toBe("vf-officielle");
    expect(chosen?.embeddable).toBeUndefined();
  });
});
