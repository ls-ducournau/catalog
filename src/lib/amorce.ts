import type { HomeShowcase, ShowcaseTab, ShowcaseTitle } from "./showcase";
import { VITRINE_PER_LIST, VITRINE_PER_MOOD, VITRINE_PICKS, type Vitrine } from "./vitrine";

// Ce que montrent les sections de l'accueil — spec: specs/accueil-vitrine-connexion-v1.md (§ 2, § 3).
// Trois états, décidés section par section :
// - visiteur (pas de bibliothèque) : la vitrine, des titres tendances à ajouter ;
// - bibliothèque qui démarre : ses titres d'abord, complétés par des suggestions ;
// - bibliothèque garnie : l'accueil du compte, à l'identique (aucune suggestion), sauf une section
//   qui serait vide : elle se remplit de suggestions plutôt que de disparaître.

import { DEMARRAGE_TITRES } from "./seuils";

export { DEMARRAGE_TITRES, NOTES_POUR_RECOS } from "./seuils";

export type AccueilCompose = {
  moods: ShowcaseTab[];
  picks: ShowcaseTitle[];
  lists: ShowcaseTab[];
  /** Pas de bibliothèque : la vitrine seule. */
  visiteur: boolean;
  /** Bibliothèque qui démarre : sections complétées. */
  demarrage: boolean;
};

/** Ses titres d'abord ; tant qu'il en manque (bibliothèque qui démarre, ou rien), des suggestions. */
export function completer(own: ShowcaseTitle[], fill: ShowcaseTitle[], n: number, demarrage: boolean): ShowcaseTitle[] {
  if (own.length >= n || (!demarrage && own.length > 0)) return own;
  const taken = new Set(own.map((t) => t.id));
  return [...own, ...fill.filter((t) => !taken.has(t.id)).slice(0, n - own.length)];
}

/** Les envies dans l'ordre de la vitrine (celui de Ce soir), chacune complétée. */
function completerEnvies(own: ShowcaseTab[], vitrine: ShowcaseTab[], demarrage: boolean): ShowcaseTab[] {
  if (!demarrage && own.length > 0) return own;
  const order = [...new Set([...own.map((t) => t.value), ...vitrine.map((t) => t.value)])];
  const rank = (value: string) => {
    const i = vitrine.findIndex((t) => t.value === value);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return order
    .sort((a, b) => rank(a) - rank(b))
    .map((value) => {
      const mine = own.find((t) => t.value === value);
      const theirs = vitrine.find((t) => t.value === value);
      const label = mine?.label ?? theirs?.label ?? value;
      return { value, label, titles: completer(mine?.titles ?? [], theirs?.titles ?? [], VITRINE_PER_MOOD, true) };
    })
    .filter((tab) => tab.titles.length > 0);
}

export function composerAccueil(preview: HomeShowcase | null, vitrine: Vitrine, total: number | null): AccueilCompose {
  if (!preview || total === null) {
    // Les tendances sont déjà « À la une » : la liste du visiteur garde le cinéma et les mieux notés.
    const lists = vitrine.lists.filter((t) => t.value !== "trending");
    return { moods: vitrine.moods, picks: vitrine.picks, lists: lists.length > 0 ? lists : vitrine.lists, visiteur: true, demarrage: true };
  }
  const demarrage = total < DEMARRAGE_TITRES;
  const suggestions = vitrine.lists.find((t) => t.value === "trending")?.titles ?? vitrine.picks;
  const lists =
    preview.lists.length === 0
      ? vitrine.lists
      : demarrage && suggestions.length > 0
        ? [...preview.lists, { value: "suggestions", label: "Suggestions", titles: suggestions.slice(0, VITRINE_PER_LIST) }]
        : preview.lists;
  return {
    moods: completerEnvies(preview.moods, vitrine.moods, demarrage),
    picks: completer(preview.picks, vitrine.picks, VITRINE_PICKS, demarrage),
    lists,
    visiteur: false,
    demarrage,
  };
}

