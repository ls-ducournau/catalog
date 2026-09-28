// Bandes-annonces — spec: specs/bandes-annonces-v1.md (FR-1, FR-2)
//
// Module pur (aucun import) : partagé par le serveur, les composants, le rattrapage et les tests.

export type Trailer = {
  /** Clé YouTube : https://www.youtube.com/watch?v=<key>. */
  key: string;
  name: string;
  /** Langue de la vidéo (« fr », « en »…), null si TMDB ne la donne pas. */
  language: string | null;
  kind: "Trailer" | "Teaser";
  /** Chaîne YouTube qui publie la vidéo (oEmbed), quand on la connaît. */
  channel?: string | null;
  /**
   * FR-8 : la chaîne autorise-t-elle la lecture intégrée ? `false` : réservée à YouTube (le bouton
   * mène alors directement à YouTube) ; absent : pas encore vérifié.
   */
  embeddable?: boolean;
};

/** Ce que l'app garde : la vidéo retenue, ou `key: null` quand il n'y en a pas (FR-2). */
export type TrailerInfo = { trailer: Trailer | null; fetchedAt: string };

type RawVideo = {
  key?: unknown;
  site?: unknown;
  type?: unknown;
  iso_639_1?: unknown;
  official?: unknown;
  name?: unknown;
  published_at?: unknown;
};

const KIND_RANK: Record<string, number> = { Trailer: 0, Teaser: 1 };
const LANGUAGE_RANK = (language: string | null) => (language === "fr" ? 0 : language === "en" ? 1 : language === null ? 2 : 3);

/**
 * FR-1 : la meilleure vidéo pour décider. Bande-annonce avant teaser (jamais d'extrait ni de
 * making-of), français, puis anglais, puis sans langue ; officielle d'abord ; la plus récente.
 */
export function rankTrailers(videos: RawVideo[] | undefined | null): Trailer[] {
  return (videos ?? [])
    .filter(
      (v): v is RawVideo & { key: string; type: "Trailer" | "Teaser" } =>
        v.site === "YouTube" && typeof v.key === "string" && v.key.length > 0 && (v.type === "Trailer" || v.type === "Teaser")
    )
    .map((v) => ({
      key: v.key,
      kind: v.type,
      language: typeof v.iso_639_1 === "string" && v.iso_639_1 ? v.iso_639_1 : null,
      official: v.official === true,
      name: typeof v.name === "string" ? v.name : "Bande-annonce",
      published: typeof v.published_at === "string" ? v.published_at : "",
    }))
    .sort(
      (a, b) =>
        KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
        LANGUAGE_RANK(a.language) - LANGUAGE_RANK(b.language) ||
        Number(b.official) - Number(a.official) ||
        b.published.localeCompare(a.published)
    )
    .map((v) => ({ key: v.key, name: v.name, language: v.language, kind: v.kind }));
}

export function pickTrailer(videos: RawVideo[] | undefined | null): Trailer | null {
  return rankTrailers(videos)[0] ?? null;
}

// ---------- FR-8 : une bande-annonce qu'on peut lire dans l'app ----------

/** Ce que YouTube dit d'une vidéo (point d'accès public oEmbed, sans clé). */
export type EmbedCheck =
  | { state: "embeddable"; channel: string | null }
  /** La chaîne réserve la vidéo à YouTube (oEmbed 401/403). */
  | { state: "restricted" }
  /** Retirée ou privée (oEmbed 404/400). */
  | { state: "removed" }
  /** Réseau, délai, réponse inattendue : on ne sait pas, on ne pénalise pas. */
  | { state: "unknown" };

export function interpretOEmbed(status: number, body?: { author_name?: unknown } | null): EmbedCheck {
  if (status === 200) {
    return { state: "embeddable", channel: typeof body?.author_name === "string" && body.author_name ? body.author_name : null };
  }
  if (status === 401 || status === 403) return { state: "restricted" };
  if (status === 404 || status === 400) return { state: "removed" };
  return { state: "unknown" };
}

/** Au-delà, on s'arrête : quelques vidéos suffisent à trouver une version lisible. */
const MAX_CHECKS = 4;

/**
 * FR-8 : la meilleure vidéo que l'app peut lire elle-même. Dans l'ordre de préférence (FR-1),
 * la première que sa chaîne autorise ailleurs que sur YouTube ; les vidéos retirées sont sautées.
 * S'il n'y en a aucune, la meilleure réservée à YouTube, marquée comme telle. Un doute (réseau)
 * garde la vidéo telle quelle.
 */
export async function chooseTrailer(candidates: Trailer[], check: (key: string) => Promise<EmbedCheck>): Promise<Trailer | null> {
  let restricted: Trailer | null = null;
  for (const candidate of candidates.slice(0, MAX_CHECKS)) {
    const result = await check(candidate.key);
    if (result.state === "embeddable") return { ...candidate, embeddable: true, channel: result.channel };
    if (result.state === "unknown") return candidate;
    if (result.state === "restricted" && !restricted) restricted = { ...candidate, embeddable: false };
  }
  return restricted;
}

/** Paramètres TMDB : les vidéos françaises, anglaises et sans langue (NFR : un seul appel). */
export const TRAILER_VIDEO_LANGUAGES = "fr,en,null";

/**
 * Paramètres du lecteur YouTube standard, créé par son API officielle (qui suit la lecture, FR-6).
 * Le mode sans cookie (youtube-nocookie.com) ne voit pas la session YouTube du navigateur :
 * YouTube affichait alors « Connectez-vous pour confirmer que vous n'êtes pas un robot » au lieu de
 * la vidéo. NFR-1 tient toujours : le lecteur n'est créé qu'au clic. `origin` : YouTube le demande
 * pour ses lecteurs intégrés.
 */
export function trailerPlayerVars(trailer: Trailer, origin?: string): Record<string, string> {
  const vars: Record<string, string> = { autoplay: "1", rel: "0", modestbranding: "1", hl: "fr", playsinline: "1" };
  if (origin) vars.origin = origin;
  // FR-4 : en VO, sous-titres français demandés à YouTube.
  if (trailer.language !== "fr") {
    vars.cc_load_policy = "1";
    vars.cc_lang_pref = "fr";
  }
  return vars;
}

export function trailerWatchUrl(trailer: Trailer): string {
  return `https://www.youtube.com/watch?v=${encodeURIComponent(trailer.key)}`;
}

/** Pour une vidéo retirée : chercher une autre bande-annonce du titre. */
export function trailerSearchUrl(title: string): string {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(`${title} bande annonce`)}`;
}

/** FR-6 : pourquoi la vidéo ne se lit pas. */
export type TrailerFailure = "blocked" | "removed" | "player_error" | "player_unavailable";

/**
 * D'après le code d'erreur du lecteur YouTube : 101 et 150, YouTube bloque la lecture ; 100,
 * vidéo retirée ou privée ; le reste (2, 5, 153…), incident du lecteur. 101 et 150 ne viennent
 * pas de la chaîne : le lecteur ne reçoit que des vidéos qu'elle autorise hors de YouTube (FR-8,
 * vérifiées par oEmbed). YouTube les renvoie selon le contexte de lecture : VPN (pays),
 * navigateur, bloqueur (amendement FR-6 du 2026-09-27).
 */
export function trailerFailureFromCode(code: number): Exclude<TrailerFailure, "player_unavailable"> {
  if (code === 101 || code === 150) return "blocked";
  if (code === 100) return "removed";
  return "player_error";
}

/**
 * FR-6 : le message nomme la vraie cause (YouTube et le contexte de lecture, le retrait par la
 * chaîne, le lecteur), jamais l'app ni « les autres sites » : rien ne doit laisser croire que
 * l'app est en cause (remarques de l'utilisateur, 2026-09-26 et 2026-09-27).
 */
export function trailerFailureCopy(
  failure: TrailerFailure,
  channel?: string | null
): { title: string; detail: string; action: "watch" | "search"; retry: boolean } {
  const owner = channel || "La chaîne qui la publie";
  switch (failure) {
    case "blocked":
      return {
        title: "YouTube a bloqué la lecture de cette bande-annonce.",
        detail:
          "La vidéo est lisible, mais YouTube la bloque parfois derrière un VPN (il filtre selon le pays), dans certains navigateurs ou avec un bloqueur. Coupe le VPN et réessaie, ou regarde-la sur YouTube.",
        action: "watch",
        retry: true,
      };
    case "removed":
      return {
        title: "Cette bande-annonce n'est plus en ligne.",
        detail: `${owner} l'a retirée de YouTube ou rendue privée. Une autre version existe peut-être.`,
        action: "search",
        retry: false,
      };
    case "player_error":
      return {
        title: "YouTube n'a pas réussi à lire cette bande-annonce.",
        detail: "C'est souvent passager : réessaie, ou regarde-la directement sur YouTube.",
        action: "watch",
        retry: true,
      };
    case "player_unavailable":
      return {
        title: "Le lecteur de YouTube ne s'est pas chargé.",
        detail: "Un VPN ou un bloqueur de publicités l'en empêche souvent : coupe-le, puis réessaie.",
        action: "watch",
        retry: true,
      };
  }
}
