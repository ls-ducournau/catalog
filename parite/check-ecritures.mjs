// Rejoue les scénarios d'écriture sur une COPIE JETABLE et compare au contrat.
//   node parite/check-ecritures.mjs http://localhost:PORT [--v2]
import fs from "node:fs";
import { makeRunner, scenarios } from "./ecritures.mjs";

const base = process.argv[2];
if (!base) throw new Error("usage : node parite/check-ecritures.mjs <url de la copie jetable> [--v2]");
if (/:(3000|3001)\b/.test(base)) throw new Error("jamais sur le serveur de travail (3000/3001) : ces scénarios écrivent");
const contract = JSON.parse(fs.readFileSync(new URL("./contrat-ecritures.json", import.meta.url), "utf8"));

const { call, results } = makeRunner(base, { contract, v2: process.argv.includes("--v2") });
await scenarios(base, call);
let failures = 0;
for (const [id, r] of Object.entries(results)) {
  console.log(r.problems.length ? "ÉCHEC" : "ok   ", id);
  for (const p of r.problems.slice(0, 6)) console.log("      ", p);
  if (r.problems.length) failures++;
}
console.log(failures ? `${failures} écart(s)` : "contrat d'écriture respecté");
process.exit(failures ? 1 : 0);
