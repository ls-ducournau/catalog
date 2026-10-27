// Vérifie un serveur (v1 ou v2) contre le contrat : même statut, même forme.
//   node parite/check.mjs http://localhost:3002
import fs from "node:fs";
import { cases } from "./cases.mjs";
import { diff, shape } from "./shape.mjs";

const v2 = process.argv.includes("--v2"); // la v2 n'a plus les champs de l'ancien service de notes
const base = process.argv[2];
if (!base) throw new Error("usage : node parite/check.mjs <url du serveur>");
const contract = JSON.parse(fs.readFileSync(new URL("./contrat.json", import.meta.url), "utf8"));

let failures = 0;
for (const c of await cases(base)) {
  if (c.write) continue;
  const expected = contract[c.id];
  if (!expected) {
    console.log("??  ", c.id, "absent du contrat");
    failures++;
    continue;
  }
  const res = await fetch(base + c.path, { method: c.method });
  const body = await res.json().catch(() => null);
  const problems = [];
  if (res.status !== expected.status) problems.push(`statut ${res.status}, attendu ${expected.status}`);
  else problems.push(...diff(expected.shape, body === null ? "null" : shape(body), "$", { v2 }));
  console.log(problems.length ? "ÉCHEC" : "ok   ", c.id);
  for (const p of problems.slice(0, 6)) console.log("      ", p);
  if (problems.length) failures++;
}
console.log(failures ? `${failures} écart(s)` : "contrat respecté");
process.exit(failures ? 1 : 0);
