// Genres des titres — stockés en anglais, comme TMDB les donne (le filtre et la catégorie
// Documentaire s'appuient sur ces noms) ; affichés en français partout avec `genreLabel`.

const GENRE_FR: Record<string, string> = {
  Action: "Action",
  "Action & Adventure": "Action et aventure",
  Adventure: "Aventure",
  Animation: "Animation",
  Comedy: "Comédie",
  Crime: "Policier",
  Documentary: "Documentaire",
  Drama: "Drame",
  Family: "Famille",
  Fantasy: "Fantastique",
  History: "Histoire",
  Horror: "Horreur",
  Kids: "Jeunesse",
  Music: "Musique",
  Mystery: "Mystère",
  News: "Actualités",
  Reality: "Télé-réalité",
  Romance: "Romance",
  "Science Fiction": "Science-fiction",
  "Sci-Fi & Fantasy": "Science-fiction et fantastique",
  Soap: "Feuilleton",
  Talk: "Talk-show",
  Thriller: "Thriller",
  "TV Movie": "Téléfilm",
  War: "Guerre",
  "War & Politics": "Guerre et politique",
  Western: "Western",
};

/** Nom français d'un genre TMDB ; le nom d'origine s'il n'est pas connu. */
export function genreLabel(name: string): string {
  return GENRE_FR[name] ?? name;
}

/** Les premiers genres d'un titre, en français : « Drame, Thriller ». Vide s'il n'y en a pas. */
export function genreLine(genres: readonly string[], max = 2): string {
  return genres.slice(0, max).map(genreLabel).join(", ");
}

/** Colonne `genre` de la base (tableau JSON) ; une liste vide si absente ou illisible. */
export function parseGenres(json: string | null): string[] {
  if (!json) return [];
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) ? value.filter((g): g is string => typeof g === "string") : [];
  } catch {
    return [];
  }
}
