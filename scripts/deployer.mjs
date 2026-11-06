// Mise en ligne de Catalog, en une commande : `npm run deploy`.
// 1. le serveur Rust (projet Vercel catalog-api, dossier serveur/) ;
// 2. l'interface (projet Vercel catalog-serveur, racine du dépôt) ;
// 3. un contrôle : le serveur répond, l'accueil en ligne s'affiche.
// S'arrête à la première étape qui échoue. Les secrets restent chez Vercel : rien n'est lu ni affiché ici.
import { spawnSync } from "node:child_process";
import path from "node:path";

const racine = path.join(import.meta.dirname, "..");
const surWindows = process.platform === "win32";

function vercel(dossier, args, { sortie = "inherit" } = {}) {
  const r = spawnSync("vercel", args, { cwd: dossier, stdio: sortie === "inherit" ? "inherit" : ["ignore", "pipe", "pipe"], shell: surWindows, encoding: "utf8" });
  return { ok: r.status === 0, texte: r.stdout ?? "" };
}

function etape(nom, dossier) {
  console.log(`\n▸ ${nom}`);
  if (!vercel(dossier, ["deploy", "--prod", "--yes"]).ok) {
    console.error(`✗ ${nom} : échec, rien d'autre n'est mis en ligne.`);
    process.exit(1);
  }
  console.log(`✓ ${nom} : en ligne`);
}

etape("Serveur (catalog-api)", path.join(racine, "serveur"));
etape("Interface (catalog-serveur)", racine);

console.log("\n▸ Contrôle");
const sante = vercel(path.join(racine, "serveur"), ["curl", "/api/sante"], { sortie: "pipe" });
console.log(sante.texte.includes('"ok":true') ? "✓ le serveur répond" : "✗ le serveur ne répond pas");
const accueil = vercel(racine, ["curl", "/"], { sortie: "pipe" });
console.log(accueil.texte.includes("Catalog") ? "✓ l'accueil s'affiche" : "✗ l'accueil ne s'affiche pas");
process.exit(sante.texte.includes('"ok":true') && accueil.texte.includes("Catalog") ? 0 : 1);
