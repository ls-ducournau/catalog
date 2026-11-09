import type { Availability } from "./availability";
import { DEMARRAGE_TITRES, NOTES_POUR_RECOS } from "./seuils";
import type { DiscoveredItem } from "./discoveryService";
import type { Category } from "./libraryItem";
import type { ShowcaseTitle } from "./showcase";
import type { Trailer } from "./trailer";
import type { Vitrine } from "./vitrine";

// Bienvenue, le « Tinder du titre » — spec: specs/bienvenue-v1.md. Logique pure : les cartes, l'ordre du
// paquet, la jauge de démarrage. Trois gestes : → ça me tente (dans ta pile), ← pas pour moi (écarté),
// ↑ déjà vu (sans note ; on note ensuite ses titres vus, dans le tri rapide).

/** La jauge : assez de titres pour que l'application ait de quoi choisir, assez de notes pour les recos. */
export const OBJECTIF_TITRES = DEMARRAGE_TITRES;
export const OBJECTIF_NOTES = NOTES_POUR_RECOS;

export type CarteSwipe = {
  /** « type:tmdbId », la clé de la bibliothèque et de la visite. */
  cle: string;
  tmdbId: number;
  type: "Movie" | "TV Series";
  category: Category;
  name: string;
  year: string | null;
  genres: string[];
  overview: string;
  posterUrl: string | null;
  /** Variable CSS `--tint` tirée de l'affiche. */
  tint?: string;
  voteAverage: number | null;
  /** Connue d'avance (découverte) ; sinon la fiche est demandée à /api/tmdb/title. */
  trailer?: Trailer | null;
  availability?: Availability | null;
  runtime?: number | null;
  /** « Parce que tu as aimé … » (découverte). */
  raison?: string | null;
};

export type ReponseSwipe = { kind: "envie" } | { kind: "non" } | { kind: "vu" };

/**
 * Ce qui ne donne pas envie dans une vitrine de films et de séries (audit 2026-11-09) : talk-shows,
 * actualités, téléréalité, feuilletons, jeunesse. Genres TMDB bruts.
 */
const GENRES_ECARTES = new Set(["Talk", "News", "Reality", "Soap", "Kids"]);
export const pourLaVitrine = (t: { genres: string[] }) => !t.genres.some((g) => GENRES_ECARTES.has(g));

/** La vitrine sans ces titres, onglets vides retirés. */
export function vitrineChoisie(v: Vitrine): Vitrine {
  const onglets = (l: Vitrine["moods"]) => l.map((o) => ({ ...o, titles: o.titles.filter(pourLaVitrine) })).filter((o) => o.titles.length > 0);
  return { moods: onglets(v.moods), picks: v.picks.filter(pourLaVitrine), lists: onglets(v.lists), rating: v.rating.filter(pourLaVitrine) };
}

export function carteDepuisVitrine(t: ShowcaseTitle): CarteSwipe {
  const tmdbId = t.suggestion?.tmdbId ?? t.id;
  return {
    cle: `${t.type}:${tmdbId}`,
    tmdbId,
    type: t.type,
    category: t.category,
    name: t.name,
    year: t.year,
    genres: t.genres,
    overview: t.overview,
    posterUrl: t.posterUrl,
    tint: t.tint,
    voteAverage: t.voteAverage,
  };
}

export function carteDepuisDecouverte(d: DiscoveredItem): CarteSwipe {
  return {
    cle: `${d.type}:${d.tmdbId}`,
    tmdbId: d.tmdbId,
    type: d.type,
    category: d.isDocumentary ? "Documentary" : d.type,
    name: d.title,
    year: d.year,
    genres: [],
    overview: d.overview,
    posterUrl: d.posterUrl,
    voteAverage: d.voteAverage,
    trailer: d.trailer,
    availability: d.availability,
    runtime: d.runtime,
    raison: d.seeds[0] ? `Parce que tu as aimé ${d.seeds[0]}` : null,
  };
}

function uniques(cartes: CarteSwipe[], exclues: ReadonlySet<string>): CarteSwipe[] {
  const vues = new Set(exclues);
  return cartes.filter((c) => {
    if (!c.posterUrl || vues.has(c.cle)) return false;
    vues.add(c.cle);
    return true;
  });
}

/**
 * Le paquet de départ, tiré de la vitrine : un titre que presque tout le monde a vu (à noter d'un geste),
 * puis un titre du moment (à garder pour plus tard), en alternance. Sans doublon, sans les clés exclues.
 */
export function composerPaquet(brute: Vitrine, exclues: ReadonlySet<string> = new Set()): CarteSwipe[] {
  const vitrine = vitrineChoisie(brute);
  const connus = uniques(vitrine.rating.map(carteDepuisVitrine), exclues);
  const frais = uniques(
    [...vitrine.picks, ...vitrine.lists.flatMap((t) => t.titles), ...vitrine.moods.flatMap((t) => t.titles)].map(carteDepuisVitrine),
    new Set([...exclues, ...connus.map((c) => c.cle)])
  );
  const paquet: CarteSwipe[] = [];
  for (let i = 0; i < Math.max(connus.length, frais.length); i++) {
    if (connus[i]) paquet.push(connus[i]);
    if (frais[i]) paquet.push(frais[i]);
  }
  return paquet;
}

/**
 * Des cartes plus personnelles (la découverte, à partir de tes titres bien notés) glissées dans la file :
 * la carte du dessus et la suivante ne bougent pas, puis une nouvelle sur deux.
 */
export function insererDansFile(file: CarteSwipe[], nouvelles: CarteSwipe[], exclues: ReadonlySet<string> = new Set()): CarteSwipe[] {
  const fraiches = uniques(nouvelles, new Set([...exclues, ...file.map((c) => c.cle)]));
  const tete = file.slice(0, 2);
  const reste = file.slice(2);
  const melange: CarteSwipe[] = [];
  for (let i = 0; i < Math.max(fraiches.length, reste.length); i++) {
    if (fraiches[i]) melange.push(fraiches[i]);
    if (reste[i]) melange.push(reste[i]);
  }
  return [...tete, ...melange];
}

/** La suite du paquet (page suivante de /api/welcome/cards), au bout de la file, sans doublon ni carte répondue. */
export function ajouterAuBout(file: CarteSwipe[], nouvelles: CarteSwipe[], exclues: ReadonlySet<string> = new Set()): CarteSwipe[] {
  return [...file, ...uniques(nouvelles, new Set([...exclues, ...file.map((c) => c.cle)]))];
}

export type Progression = {
  titres: number;
  notes: number;
  /** Titres vus pas encore notés : de quoi remplir la jauge des notes dans le tri rapide. */
  vusSansNote: number;
};

/** Ce qu'une réponse ajoute à la jauge : un titre gardé (vu ou à voir) ; un vu reste à noter. */
export function apresReponse(p: Progression, r: ReponseSwipe, sens: 1 | -1 = 1): Progression {
  if (r.kind === "non") return p;
  return {
    titres: Math.max(0, p.titres + sens),
    notes: p.notes,
    vusSansNote: Math.max(0, p.vusSansNote + (r.kind === "vu" ? sens : 0)),
  };
}

export const estPrete = (p: Progression) => p.titres >= OBJECTIF_TITRES && p.notes >= OBJECTIF_NOTES;

const pluriel = (n: number, un: string, plusieurs: string) => `${n} ${n > 1 ? plusieurs : un}`;

/** Le prochain palier de la jauge, en une phrase ; null quand la bibliothèque est prête. Les titres d'abord. */
export function prochainPalier(p: Progression): string | null {
  const titres = OBJECTIF_TITRES - p.titres;
  const notes = OBJECTIF_NOTES - p.notes;
  if (titres > 0) return `Encore ${pluriel(titres, "titre", "titres")} pour une bibliothèque bien remplie.`;
  if (notes > 0) return `Note encore ${pluriel(notes, "titre vu", "titres vus")} pour tes recommandations.`;
  return null;
}

/** Les notes manquent et des titres vus attendent la leur : le tri rapide les présente un par un. */
export const aNoter = (p: Progression) => p.notes < OBJECTIF_NOTES && p.vusSansNote > 0;
