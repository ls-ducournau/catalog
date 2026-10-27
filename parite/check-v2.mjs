// Vérifie un serveur v2 contre le contrat des routes propres à la v2 (ajouter, retirer un titre).
// COPIE JETABLE, compte vierge, accès à TMDB.
//   node parite/check-v2.mjs http://localhost:PORT
import { contratV2, scenariosV2 } from "./ecritures-v2.mjs";
import { makeRunner } from "./ecritures.mjs";

const base = process.argv[2];
if (!base) throw new Error("usage : node parite/check-v2.mjs <url de la copie jetable, compte vierge>");
if (/:(3000|3001)\b/.test(base)) throw new Error("jamais sur le serveur de travail (3000/3001) : ces scénarios écrivent");

const { call, results } = makeRunner(base, { contract: contratV2, v2: true });
await scenariosV2(base, call);
let failures = 0;
for (const [id, r] of Object.entries(results)) {
  console.log(r.problems.length ? "ÉCHEC" : "ok   ", id);
  for (const p of r.problems.slice(0, 6)) console.log("      ", p);
  if (r.problems.length) failures++;
}
console.log(failures ? `${failures} écart(s)` : "contrat v2 respecté");
process.exit(failures ? 1 : 0);
