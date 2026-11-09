// Ce que montre un lien vers Catalog collé sur Reddit, Discord, WhatsApp ou X — docs/audit/landing-ux-marketing-
// 2026-11-09.md. Le titre, la description et l'aperçu (src/app/opengraph-image.tsx). L'aperçu est une image :
// il ne lit pas les variables CSS, d'où les valeurs des jetons ici (design/tokens.json : void-black, onyx,
// graphite, ash, pure-white, coral-pulse, cobalt-edge).

/** L'adresse publique : celle de production sur Vercel, sinon le serveur local. */
export const SITE = process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000";

export const PARTAGE = {
  titre: "Catalog · Balaie des titres, il te dit quoi regarder",
  accroche: "Balaie des titres. Catalog te dit quoi regarder.",
  description:
    "Films, séries et documentaires : à droite si ça te tente, à gauche sinon. Ta bibliothèque se remplit, Catalog apprend tes goûts et te dit quoi regarder. Gratuit pendant la bêta, sans inscription.",
  alt: "Catalog : balaie des films et des séries, il te dit quoi regarder.",
};

export const PALETTE_PARTAGE = {
  fond: "#040506",
  carte: "#0c0d0f",
  carte2: "#1b1c1e",
  texte: "#ffffff",
  gris: "#9c9c9d",
  marque: "#ff6363",
  bleu: "#143ca3",
  arete: "rgba(255, 255, 255, 0.12)",
  voile: "rgba(0, 0, 0, 0.55)",
  /** Les éclats du héros, en dégradé (une image d'aperçu ne floute pas) : le bleu en haut, le corail en bas. */
  degrade: "linear-gradient(150deg, #0d2a73 0%, #07122e 28%, #040506 55%, #2a0d10 85%, #4a1416 100%)",
};
