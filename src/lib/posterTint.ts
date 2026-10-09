import sharp from "sharp";

// Teinte d'une affiche, pour colorer la carte qui la présente (la « couleur de marque » des cartes
// d'extension de Raycast ; fiche docs/design-reference/raycast/composants/vitrine.md).
// Serveur seulement : l'affiche est lue en miniature (w92), une fois par processus.

export type Tint = { r: number; g: number; b: number };

const cache = new Map<string, Tint | null>();
const TIMEOUT_MS = 2500;

function hsl({ r, g, b }: Tint): { s: number; l: number } {
  const max = Math.max(r, g, b) / 255;
  const min = Math.min(r, g, b) / 255;
  const l = (max + min) / 2;
  const s = max === min ? 0 : l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
  return { s, l };
}

/**
 * La couleur qui porte l'affiche : les pixels les plus saturés parmi ceux ni trop sombres ni trop
 * clairs (la couleur la plus fréquente serait souvent le noir d'un fond). Null pour une affiche
 * grise ou illisible : la carte reste neutre.
 */
export function pickTint(pixels: Tint[]): Tint | null {
  const scored = pixels
    .map((p) => {
      const { s, l } = hsl(p);
      const usable = l > 0.18 && l < 0.82;
      return { p, score: usable ? s * (1 - Math.abs(l - 0.5)) : 0 };
    })
    .filter((x) => x.score > 0.12)
    .sort((a, b) => b.score - a.score);
  if (scored.length === 0) return null;
  const top = scored.slice(0, Math.max(3, Math.round(scored.length * 0.2)));
  const sum = top.reduce((acc, { p }) => ({ r: acc.r + p.r, g: acc.g + p.g, b: acc.b + p.b }), { r: 0, g: 0, b: 0 });
  return { r: Math.round(sum.r / top.length), g: Math.round(sum.g / top.length), b: Math.round(sum.b / top.length) };
}

/** Teinte de l'affiche (URL TMDB), ou null ; jamais d'erreur. */
export async function posterTint(posterUrl: string | null): Promise<Tint | null> {
  if (!posterUrl) return null;
  const small = posterUrl.replace(/\/t\/p\/[^/]+\//, "/t/p/w92/");
  if (cache.has(small)) return cache.get(small) ?? null;
  let tint: Tint | null = null;
  try {
    const res = await fetch(small, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.ok) {
      const { data, info } = await sharp(Buffer.from(await res.arrayBuffer()))
        .resize(12, 18, { fit: "fill" })
        .removeAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      const pixels: Tint[] = [];
      for (let i = 0; i < data.length; i += info.channels) pixels.push({ r: data[i], g: data[i + 1], b: data[i + 2] });
      tint = pickTint(pixels);
    }
  } catch {
    tint = null;
  }
  cache.set(small, tint);
  return tint;
}

/** Valeur de la variable CSS `--tint` (« r g b ») ; la recette `.showcase-card` en tire ses fonds. */
export function tintVar(tint: Tint | null): string | undefined {
  return tint ? `${tint.r} ${tint.g} ${tint.b}` : undefined;
}
