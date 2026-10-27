// Enregistre les scénarios d'écriture sur une COPIE JETABLE (neuve à chaque exécution).
//   node parite/record-ecritures.mjs http://localhost:3002
import fs from "node:fs";
import { makeRunner, scenarios } from "./ecritures.mjs";

const base = process.argv[2];
if (!base) throw new Error("usage : node parite/record-ecritures.mjs <url de la copie jetable>");
if (/:(3000|3001)\b/.test(base)) throw new Error("jamais sur le serveur de travail (3000/3001) : ces scénarios écrivent");

const { call, results } = makeRunner(base);
await scenarios(base, call);
const wrong = Object.entries(results).filter(([, r]) => r.problems.length);
for (const [id, r] of Object.entries(results)) console.log(String(r.status).padEnd(4), id, r.problems.join("; "));
fs.writeFileSync(new URL("./contrat-ecritures.json", import.meta.url), JSON.stringify(results, null, 2) + "\n");
console.log(`${Object.keys(results).length} appels enregistrés, ${wrong.length} écart(s) avec le statut voulu`);
