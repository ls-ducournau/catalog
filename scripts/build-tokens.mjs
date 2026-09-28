// Chaîne des jetons du système de design v2 (specs/design-system-v2-raycast.md § 8.1).
//
// design/tokens.json → src/styles/tokens.css (variables et @theme Tailwind)
//                    → src/lib/tokens.ts (mouvement, pour GSAP)
// puis vérifie les couples de contraste déclarés (AC-2.2). Idempotent : relancé, il ne change rien.
//
// Usage : node scripts/build-tokens.mjs [--check]
//   --check : n'écrit rien, échoue si les fichiers générés ne sont pas à jour.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "..");
const SOURCE = path.join(ROOT, "design", "tokens.json");
const CSS_OUT = path.join(ROOT, "src", "styles", "tokens.css");
const TS_OUT = path.join(ROOT, "src", "lib", "tokens.ts");
const check = process.argv.includes("--check");

const tokens = JSON.parse(readFileSync(SOURCE, "utf-8"));

/** Suit les références `{a.b.c}` jusqu'à une valeur. */
function resolve(value, seen = new Set()) {
  if (typeof value !== "string") return value;
  const m = value.match(/^\{([^}]+)\}$/);
  if (!m) return value;
  if (seen.has(m[1])) throw new Error(`Référence circulaire : ${m[1]}`);
  seen.add(m[1]);
  const node = m[1].split(".").reduce((o, k) => o?.[k], tokens);
  if (node === undefined) throw new Error(`Référence inconnue : ${m[1]}`);
  return resolve(node.$value, seen);
}

/** Nom de variable CSS pour une référence : primitive → --p-<nom>, rôle → --<nom>. */
function cssRef(value) {
  const m = typeof value === "string" && value.match(/^\{([^}]+)\}$/);
  if (!m) return value;
  const [groupe, , nom] = m[1].split(".");
  if (groupe === "primitive") return `var(--p-${nom})`;
  if (m[1].startsWith("role.color.")) return `var(--${nom})`;
  if (m[1].startsWith("role.shadow.")) return `var(--shadow-${nom})`;
  if (m[1].startsWith("role.radius.")) return `var(--r-${nom})`;
  return resolve(value);
}

const entries = (o) => Object.entries(o).filter(([k]) => !k.startsWith("$"));
const L = [];
L.push("/* Généré par scripts/build-tokens.mjs depuis design/tokens.json : ne pas éditer à la main.");
L.push("   Référence : docs/design-reference/raycast/DESIGN.md · spec : specs/design-system-v2-raycast.md § 3. */");
L.push("");
L.push(":root {");
L.push("  /* Primitives (noms de DESIGN.md) : jamais employées directement par une page. */");
for (const [nom, t] of entries(tokens.primitive.color)) L.push(`  --p-${nom}: ${t.$value};`);
L.push("");
L.push("  /* Rôles */");
for (const [nom, t] of entries(tokens.role.color)) L.push(`  --${nom}: ${cssRef(t.$value)};`);
L.push("");
L.push("  /* Relief */");
for (const [nom, t] of entries(tokens.role.shadow)) L.push(`  --shadow-${nom}: ${cssRef(t.$value)};`);
L.push("");
L.push("  /* Arrondis */");
for (const [nom, t] of entries(tokens.role.radius)) L.push(`  --r-${nom}: ${t.$value};`);
L.push("");
L.push("  /* Mise en page */");
for (const [nom, t] of entries(tokens.layout)) L.push(`  --${nom}: ${t.$value};`);
L.push(`  --font-features: ${tokens["font-features"].$value};`);
L.push("");
L.push("  /* Mouvement */");
for (const [nom, t] of entries(tokens.motion.duration)) L.push(`  --dur-${nom}: ${t.$value};`);
for (const [nom, t] of entries(tokens.motion.easing)) L.push(`  --ease-${nom}: cubic-bezier(${t.$value.join(", ")});`);
L.push("}");
L.push("");
L.push("@theme inline {");
for (const [nom] of entries(tokens.role.color)) {
  if (/^(chart-|logo-|p-)/.test(nom)) continue;
  L.push(`  --color-${nom}: var(--${nom});`);
}
L.push("  --color-line: var(--surface-border);");
L.push(`  --font-sans: ${tokens.tailwind.font.sans.$value};`);
L.push(`  --font-mono: ${tokens.tailwind.font.mono.$value};`);
L.push("}");
L.push("");
L.push("@theme {");
for (const [nom, t] of entries(tokens.tailwind.radius)) L.push(`  --radius-${nom}: ${resolve(t.$value)};`);
L.push("");
for (const [nom, t] of entries(tokens.tailwind.text)) {
  L.push(`  --text-${nom}: ${t.size};`);
  L.push(`  --text-${nom}--line-height: ${t["line-height"]};`);
  L.push(`  --text-${nom}--letter-spacing: ${t["letter-spacing"]};`);
}
L.push("");
for (const [nom, t] of entries(tokens.motion.easing)) L.push(`  --ease-${nom}: cubic-bezier(${t.$value.join(", ")});`);
L.push("}");
const css = `${L.join("\n")}\n`;

const seconds = (v) => Number.parseFloat(v) / 1000;
const T = [];
T.push("// Généré par scripts/build-tokens.mjs depuis design/tokens.json : ne pas éditer à la main.");
T.push("// Mouvement (spec design-system-v2 § 4.1), mêmes valeurs que les variables --dur-* et --ease-*.");
T.push("");
T.push("/** Durées, en secondes. */");
T.push(`export const DURATION_TOKENS = {`);
for (const [nom, t] of entries(tokens.motion.duration)) T.push(`  ${nom}: ${seconds(t.$value)},`);
T.push("} as const;");
T.push("");
T.push("/** Courbes, en points de contrôle (CustomEase). */");
T.push("export const EASING_TOKENS = {");
for (const [nom, t] of entries(tokens.motion.easing)) T.push(`  ${nom}: "${t.$value.join(",")}",`);
T.push("} as const;");
T.push("");
T.push(`export const STAGGER_TOKEN = ${tokens.motion.stagger.$value};`);
T.push(`export const CASCADE_MAX_TOKEN = ${tokens.motion["cascade-max"].$value};`);
T.push(`export const ENTER_Y_TOKEN = ${tokens.motion["enter-y"].$value};`);
const ts = `${T.join("\n")}\n`;

// Contraste (WCAG 2.2, luminance relative).
function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const f = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
function ratio(a, b) {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}
const role = (nom) => resolve(tokens.role.color[nom].$value);
let echec = false;
console.log("Contraste des couples déclarés :");
for (const couple of tokens.contrast.pairs) {
  for (const bg of couple.bg) {
    const r = ratio(role(couple.fg), role(bg));
    const ok = r >= couple.min;
    if (!ok && !couple.exception) echec = true;
    const note = ok ? "" : couple.exception ? "  (exception documentée)" : "  ✗";
    console.log(`  ${couple.fg.padEnd(18)} sur ${bg.padEnd(10)} ${r.toFixed(2)}:1${note}`);
  }
}

function sync(fichier, contenu) {
  const actuel = existsSync(fichier) ? readFileSync(fichier, "utf-8") : null;
  if (actuel === contenu) return false;
  if (check) {
    console.log(`Pas à jour : ${path.relative(ROOT, fichier)} (lancer npm run tokens)`);
    echec = true;
    return false;
  }
  mkdirSync(path.dirname(fichier), { recursive: true });
  writeFileSync(fichier, contenu);
  return true;
}
const ecrits = [sync(CSS_OUT, css) && CSS_OUT, sync(TS_OUT, ts) && TS_OUT].filter(Boolean);
console.log(ecrits.length ? `Écrit : ${ecrits.map((f) => path.relative(ROOT, f)).join(", ")}` : "Jetons à jour.");
if (echec) process.exit(1);
