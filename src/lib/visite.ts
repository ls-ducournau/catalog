import type { ShowcaseTitle } from "./showcase";
import { MOOD_GENRES, type Mood } from "./tonight";

// La visite interactive — spec: specs/visite-interactive-v1.md. Ce que le visiteur fait (tri, notes,
// duels) vit dans son navigateur ; rien n'est écrit avant « Garder ce que j'ai fait ». Logique pure,
// sans React : l'état, l'Elo, le choix des paires, le classement et les recommandations de la visite.

export type Tri = "vu" | "pasvu" | "envie";
export type Gagnant = "A" | "B";

export type EtatVisite = {
  tri: Record<string, Tri>;
  /** Note de 0 (💩) à 5 étoiles, des titres vus. */
  notes: Record<string, number>;
  duels: { a: string; b: string; gagnant: Gagnant }[];
  elo: Record<string, number>;
};

export const ETAT_VIDE: EtatVisite = { tri: {}, notes: {}, duels: [], elo: {} };

/** Les chapitres, dans l'ordre de la visite (ancres de /visite). */
export const CHAPITRES = [
  { id: "tri", nom: "Tri rapide" },
  { id: "notation", nom: "Notation" },
  { id: "duels", nom: "Duels" },
  { id: "classement", nom: "Classement" },
  { id: "recos", nom: "Recommandations" },
  { id: "ce-soir", nom: "Ce soir" },
  { id: "playlists", nom: "Playlists" },
  { id: "sorties", nom: "Sorties" },
] as const;

export type Chapitre = (typeof CHAPITRES)[number]["id"];

/** Clé d'un titre de la vitrine : « type:tmdbId » (la même que la bibliothèque). */
export function cleTitre(t: ShowcaseTitle): string {
  return `${t.type}:${t.suggestion?.tmdbId ?? t.id}`;
}

/** Une page de l'application vue par un visiteur : le chapitre de la visite qui la présente. */
export function versVisite(href: string): string {
  const [chemin, requete = ""] = href.split("?");
  if (chemin === "/tri") return requete.includes("famille=seen") || requete.includes("famille=person") ? "/visite#notation" : "/visite#tri";
  const ancres: Record<string, Chapitre> = {
    "/library": "tri",
    "/classement": "classement",
    "/playlists": "playlists",
    "/duels": "duels",
    "/recommendations": "recos",
    "/sorties": "sorties",
    "/ce-soir": "ce-soir",
  };
  return ancres[chemin] ? `/visite#${ancres[chemin]}` : href;
}

const ELO_DEPART = 1500;
const K = 32;

export const eloDe = (etat: EtatVisite, cle: string) => etat.elo[cle] ?? ELO_DEPART;

/** Elo classique : le gagnant prend ce que le perdant cède, selon l'écart attendu. */
export function apresDuel(etat: EtatVisite, a: string, b: string, gagnant: Gagnant): EtatVisite {
  const ra = eloDe(etat, a);
  const rb = eloDe(etat, b);
  const attenduA = 1 / (1 + 10 ** ((rb - ra) / 400));
  const scoreA = gagnant === "A" ? 1 : 0;
  const delta = K * (scoreA - attenduA);
  return {
    ...etat,
    duels: [...etat.duels, { a, b, gagnant }],
    elo: { ...etat.elo, [a]: ra + delta, [b]: rb - delta },
  };
}

/**
 * La prochaine paire : deux titres de même note d'abord (c'est là que l'ordre se joue), ceux qui ont le
 * moins combattu ; sinon deux notes voisines. `libres` : des titres sans note (démo de l'accueil).
 */
export function prochainePaire(etat: EtatVisite, libres?: string[]): [string, string] | null {
  const candidats = libres ?? Object.keys(etat.notes);
  if (candidats.length < 2) return null;
  const combats = (x: string, y: string) => etat.duels.filter((d) => (d.a === x && d.b === y) || (d.a === y && d.b === x)).length;
  const vus = (x: string) => etat.duels.filter((d) => d.a === x || d.b === x).length;
  let meilleure: [string, string] | null = null;
  let cout = Number.POSITIVE_INFINITY;
  for (let i = 0; i < candidats.length; i++) {
    for (let j = i + 1; j < candidats.length; j++) {
      const [x, y] = [candidats[i], candidats[j]];
      const ecartNote = libres ? 0 : Math.abs((etat.notes[x] ?? 0) - (etat.notes[y] ?? 0));
      const c = ecartNote * 100 + combats(x, y) * 10 + vus(x) + vus(y);
      if (c < cout) {
        cout = c;
        meilleure = [x, y];
      }
    }
  }
  return meilleure;
}

/** Les paliers, de 5 étoiles à 💩 ; dans un palier, l'Elo des duels départage. */
export function classement(etat: EtatVisite): { note: number; cles: string[] }[] {
  return [5, 4, 3, 2, 1, 0]
    .map((note) => ({
      note,
      cles: Object.keys(etat.notes)
        .filter((cle) => etat.notes[cle] === note)
        .sort((x, y) => eloDe(etat, y) - eloDe(etat, x) || x.localeCompare(y)),
    }))
    .filter((palier) => palier.cles.length > 0);
}

/**
 * Recommandations de la visite : les titres qui partagent le plus de genres avec ceux que tu as notés 4
 * ou 5 étoiles, en écartant ce que tu as déjà trié. Simple et honnête : l'application, elle, apprend un
 * modèle de tes notes.
 */
export function recommandations(etat: EtatVisite, pool: ShowcaseTitle[], titres: Map<string, ShowcaseTitle>, n = 6) {
  const aimes = Object.entries(etat.notes)
    .filter(([, note]) => note >= 4)
    .map(([cle, note]) => ({ titre: titres.get(cle), poids: note - 3 }))
    .filter((x): x is { titre: ShowcaseTitle; poids: number } => Boolean(x.titre));
  if (aimes.length === 0) return [];
  const vus = new Set<string>();
  return pool
    .filter((t) => {
      const cle = cleTitre(t);
      if (etat.tri[cle] || etat.notes[cle] !== undefined || vus.has(cle)) return false;
      vus.add(cle);
      return true;
    })
    .map((t) => {
      let score = 0;
      let parce: ShowcaseTitle | null = null;
      let meilleur = 0;
      for (const { titre, poids } of aimes) {
        const communs = t.genres.filter((g) => titre.genres.includes(g)).length * poids;
        score += communs;
        if (communs > meilleur) {
          meilleur = communs;
          parce = titre;
        }
      }
      return { titre: t, score, parce };
    })
    .filter((r): r is { titre: ShowcaseTitle; score: number; parce: ShowcaseTitle } => r.score > 0 && r.parce !== null)
    .sort((x, y) => y.score - x.score)
    .slice(0, n);
}

/** Ce soir, dans la visite : tes « ça me tente » d'abord, puis le reste, pour une envie. */
export function pourCeSoir(etat: EtatVisite, pool: ShowcaseTitle[], envie: Exclude<Mood, "any">, n = 3): ShowcaseTitle[] {
  const convient = (t: ShowcaseTitle) => (envie === "think" && t.category === "Documentary") || t.genres.some((g) => MOOD_GENRES[envie].includes(g));
  const deja = (t: ShowcaseTitle) => etat.tri[cleTitre(t)] === "vu" || etat.tri[cleTitre(t)] === "pasvu";
  const uniques = [...new Map(pool.map((t) => [cleTitre(t), t])).values()].filter((t) => convient(t) && !deja(t));
  return [...uniques.filter((t) => etat.tri[cleTitre(t)] === "envie"), ...uniques.filter((t) => etat.tri[cleTitre(t)] !== "envie")].slice(0, n);
}

/** Où en est le visiteur, chapitre par chapitre (les chapitres à regarder seulement n'ont pas de seuil). */
export function avancement(etat: EtatVisite): Partial<Record<Chapitre, boolean>> {
  return {
    tri: Object.keys(etat.tri).length >= 5,
    notation: Object.keys(etat.notes).length >= 3,
    duels: etat.duels.length >= 3,
  };
}

/** Ce que « Garder ce que j'ai fait » versera dans le compte. */
export function aGarder(etat: EtatVisite) {
  const titres = Object.keys(etat.tri).filter((cle) => etat.tri[cle] === "vu" || etat.tri[cle] === "envie");
  return {
    titres,
    vus: titres.filter((cle) => etat.tri[cle] === "vu").length,
    envies: titres.filter((cle) => etat.tri[cle] === "envie").length,
    notes: Object.keys(etat.notes).length,
    duels: etat.duels.filter((d) => etat.notes[d.a] !== undefined && etat.notes[d.b] !== undefined).length,
  };
}
