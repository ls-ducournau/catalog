// Garde-fou du système de design v2 (specs/design-system-v2-raycast.md § 8.4).
//
// Compte ce qui contourne le système dans src/ et compare à la ligne de base
// (design/audit-baseline.json) : un compte ne peut que baisser. Les graphiques Bklit, copiés tels
// quels du registre, sont exclus.
//
// Usage : node scripts/ds-audit.mjs [--update] [--details]
//   --update  : réécrit la ligne de base avec les comptes actuels (à la fin d'une phase).
//   --details : liste chaque occurrence (fichier:ligne).
import { readdirSync, readFileSync, writeFileSync, existsSync, mkdirSync, statSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SRC = path.join(ROOT, "src");
const BASELINE = path.join(ROOT, "design", "audit-baseline.json");
const EXCLUS = [path.join("src", "components", "charts")];
const update = process.argv.includes("--update");
const details = process.argv.includes("--details");

/** Durées permises : les jetons de mouvement (§ 4.1), et le fondu de changement de vue. */
const DUREES = new Set([100, 150, 200, 300, 400]);

function fichiers(dir) {
  const out = [];
  for (const nom of readdirSync(dir)) {
    const p = path.join(dir, nom);
    const rel = path.relative(ROOT, p);
    if (EXCLUS.some((e) => rel.startsWith(e))) continue;
    if (statSync(p).isDirectory()) out.push(...fichiers(p));
    else if (/\.(tsx?|css)$/.test(nom) && !/\.test\.ts$/.test(nom)) out.push(p);
  }
  return out;
}

/** Une courbe dépasse si l'ordonnée d'un point de contrôle sort de [0, 1]. */
function depasse(valeurs) {
  const [, y1, , y2] = valeurs.split(",").map((v) => parseFloat(v));
  return y1 > 1 || y1 < 0 || y2 > 1 || y2 < 0;
}

/** Remplace les commentaires par des espaces (les retours à la ligne restent : numéros intacts). */
function sansCommentaires(texte) {
  return texte
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, (m, avant) => avant + " ".repeat(m.length - avant.length));
}

const REGLES = [
  {
    id: "tailles-arbitraires",
    titre: "Tailles de texte arbitraires (text-[…])",
    fichiers: /\.tsx$/,
    test: (ligne) => ligne.match(/\btext-\[(?:\d|\.)[^\]]*\]/g) ?? [],
  },
  {
    id: "textes-sous-12px",
    titre: "Textes sous 12 px",
    fichiers: /\.(tsx|css)$/,
    test: (ligne) => {
      const trouves = [];
      for (const m of ligne.matchAll(/text-\[(\d+(?:\.\d+)?)px\]/g)) if (parseFloat(m[1]) < 12) trouves.push(m[0]);
      for (const m of ligne.matchAll(/text-\[(\d*\.\d+)rem\]/g)) if (parseFloat(m[1]) * 16 < 12) trouves.push(m[0]);
      for (const m of ligne.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)) if (parseFloat(m[1]) < 12) trouves.push(m[0]);
      for (const m of ligne.matchAll(/font-size:\s*(\d*\.\d+)rem/g)) if (parseFloat(m[1]) * 16 < 12) trouves.push(m[0]);
      return trouves;
    },
  },
  {
    id: "couleurs-en-dur",
    titre: "Couleurs codées en dur dans le TSX",
    fichiers: /\.tsx$/,
    test: (ligne) => ligne.match(/(?<![\w&])#[0-9a-fA-F]{3,8}\b|rgba?\(/g) ?? [],
  },
  {
    id: "durees-hors-jetons",
    titre: "Durées hors jetons (duration-…)",
    fichiers: /\.tsx$/,
    test: (ligne) =>
      [...ligne.matchAll(/\bduration-(\[[^\]]*\]|\d+)/g)]
        .filter((m) => m[1].startsWith("[") || !DUREES.has(Number(m[1])))
        .map((m) => m[0]),
  },
  {
    id: "courbes-hors-jetons",
    titre: "Courbes hors jetons (ease-in, ease-in-out, ease-linear, ease-[…])",
    fichiers: /\.tsx$/,
    test: (ligne) => ligne.match(/\bease-(?:in-out|in|linear|\[[^\]]*\])(?![\w-])/g) ?? [],
  },
  {
    id: "courbes-a-depassement",
    titre: "Courbes à dépassement, ressorts",
    fichiers: /\.(tsx?|css)$/,
    test: (ligne) => {
      const trouves = [];
      for (const m of ligne.matchAll(/cubic-bezier\(([^)]*)\)/g)) if (depasse(m[1])) trouves.push(m[0]);
      for (const m of ligne.matchAll(/CustomEase\.create\(\s*"[^"]+",\s*"([^"]+)"/g)) if (depasse(m[1])) trouves.push(m[0]);
      for (const m of ligne.matchAll(/\b(?:back|elastic)(?:\.(?:in|out|inOut))?\(|type:\s*"spring"|\bEASE\.bounce\b|--ease-bounce/g))
        trouves.push(m[0]);
      return trouves;
    },
  },
  {
    id: "boutons-hors-ui",
    titre: "Classes de bouton posées à la main (btn …) hors de components/ui",
    fichiers: /\.tsx$/,
    horsDe: path.join("src", "components", "ui"),
    test: (ligne) => ligne.match(/["'`\s]btn(?=[\s"'`])/g) ?? [],
  },
  {
    id: "tweens-hors-preselections",
    titre: "Tweens GSAP hors des préréglages (gsap.to/from/fromTo)",
    fichiers: /\.tsx?$/,
    horsDe: [path.join("src", "lib", "motion.ts"), path.join("src", "components", "motion")],
    test: (ligne) => ligne.match(/\bgsap\.(?:to|from|fromTo)\(/g) ?? [],
  },
  {
    id: "interlettrage-negatif",
    titre: "Interlettrage négatif (DESIGN.md : jamais, même en grand)",
    fichiers: /\.(tsx|css)$/,
    test: (ligne) => ligne.match(/tracking-\[-[^\]]*\]|\btracking-tight(?:er)?\b|letter-spacing:\s*-[\d.]/g) ?? [],
  },
  {
    id: "corail-hors-marque",
    titre: "Corail hors de la marque (DESIGN.md : logo, héros, badge IA seulement)",
    fichiers: /\.(tsx|css)$/,
    horsDe: [path.join("src", "components", "brand"), path.join("src", "styles", "tokens.css")],
    // Une recette de marque (le badge IA) porte le commentaire « marque » : elle est permise.
    test: (ligne) =>
      ligne.includes("/* marque */")
        ? []
        : (ligne.match(/\b(?:text|bg|border|ring|fill|stroke|from|via|to|outline|decoration|shadow)-brand(?![\w-])(?:\/\d+)?|var\(--brand\)/g) ?? []),
  },
  {
    id: "teintes-hors-jetons",
    titre: "Teintes de la palette Tailwind hors jetons (red-500, amber-400…)",
    fichiers: /\.tsx$/,
    test: (ligne) =>
      ligne.match(
        /(?:text|bg|border|fill|stroke|ring|from|via|to|outline|decoration|shadow|divide|accent|caret)-(?:red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone)-\d{2,3}/g
      ) ?? [],
  },
  {
    id: "tirets-cadratins",
    titre: "Tirets cadratins (—) dans un texte d'interface (hors commentaires)",
    fichiers: /\.tsx$/,
    sansCommentaires: true,
    test: (ligne) => ligne.match(/—/g) ?? [],
  },
  {
    id: "animations-css",
    titre: "Animations CSS (@keyframes), pour mémoire",
    fichiers: /\.css$/,
    test: (ligne) => ligne.match(/@keyframes\s+[\w-]+/g) ?? [],
  },
];

const comptes = {};
const occurrences = {};
for (const regle of REGLES) {
  comptes[regle.id] = 0;
  occurrences[regle.id] = [];
}

for (const fichier of fichiers(SRC)) {
  const rel = path.relative(ROOT, fichier);
  const texte = readFileSync(fichier, "utf-8");
  const lignes = texte.split("\n");
  const lignesCode = sansCommentaires(texte).split("\n");
  for (const regle of REGLES) {
    if (!regle.fichiers.test(fichier)) continue;
    const horsDe = [regle.horsDe ?? []].flat();
    if (horsDe.some((h) => rel.startsWith(h))) continue;
    (regle.sansCommentaires ? lignesCode : lignes).forEach((ligne, i) => {
      for (const t of regle.test(ligne)) {
        comptes[regle.id]++;
        occurrences[regle.id].push(`${rel.replaceAll("\\", "/")}:${i + 1}  ${t.trim()}`);
      }
    });
  }
}

const base = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf-8")).comptes : null;
let echec = false;
console.log("Système de design : écarts dans src/\n");
for (const regle of REGLES) {
  const n = comptes[regle.id];
  const ref = base?.[regle.id];
  const marque = ref === undefined ? "" : n > ref ? `  ✗ ligne de base ${ref}` : n < ref ? `  ↓ ligne de base ${ref}` : "";
  if (ref !== undefined && n > ref && regle.id !== "animations-css") echec = true;
  console.log(`${String(n).padStart(5)}  ${regle.titre}${marque}`);
  if (details || (ref !== undefined && n > ref)) for (const o of occurrences[regle.id]) console.log(`         ${o}`);
}

if (update) {
  mkdirSync(path.dirname(BASELINE), { recursive: true });
  writeFileSync(BASELINE, `${JSON.stringify({ date: new Date().toISOString().slice(0, 10), comptes }, null, 2)}\n`);
  console.log(`\nLigne de base écrite : ${path.relative(ROOT, BASELINE)}`);
} else if (echec) {
  console.log("\nÉchec : un compte dépasse la ligne de base (il ne peut que baisser).");
  process.exit(1);
}
