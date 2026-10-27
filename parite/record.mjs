// Enregistre le contrat : appelle chaque cas en lecture sur un serveur de référence (la v1 sur une
// COPIE isolée) et garde le statut et la forme de la réponse dans parite/contrat.json.
//   node parite/record.mjs http://localhost:3002
import fs from "node:fs";
import { cases } from "./cases.mjs";
import { shape } from "./shape.mjs";

const base = process.argv[2];
if (!base) throw new Error("usage : node parite/record.mjs <url du serveur isolé>");
if (/:(3000|3001)\b/.test(base)) throw new Error("jamais sur le serveur de travail (3000/3001) : un serveur isolé seulement");

const contract = {};
for (const c of await cases(base)) {
  if (c.write) continue;
  const res = await fetch(base + c.path, { method: c.method });
  const body = await res.json().catch(() => null);
  contract[c.id] = { method: c.method, path: c.path, status: res.status, shape: body === null ? "null" : shape(body) };
  console.log(String(res.status).padEnd(4), c.id);
}
fs.writeFileSync(new URL("./contrat.json", import.meta.url), JSON.stringify(contract, null, 2) + "\n");
console.log(`${Object.keys(contract).length} cas enregistrés`);
