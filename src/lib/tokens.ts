// Généré par scripts/build-tokens.mjs depuis design/tokens.json : ne pas éditer à la main.
// Mouvement (spec design-system-v2 § 4.1), mêmes valeurs que les variables --dur-* et --ease-*.

/** Durées, en secondes. */
export const DURATION_TOKENS = {
  instant: 0.1,
  swap: 0.15,
  fast: 0.2,
  base: 0.3,
  slow: 0.4,
} as const;

/** Courbes, en points de contrôle (CustomEase). */
export const EASING_TOKENS = {
  out: "0.23,1,0.32,1",
  standard: "0.25,0.1,0.25,1",
} as const;

export const STAGGER_TOKEN = 0.03;
export const CASCADE_MAX_TOKEN = 8;
export const ENTER_Y_TOKEN = 8;
