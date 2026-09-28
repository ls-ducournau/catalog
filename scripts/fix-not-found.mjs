import { Client } from "@notionhq/client";
import { readFileSync } from "node:fs";

// Charge .env manuellement (pas de dépendance dotenv dans ce script ponctuel)
const envContent = readFileSync(new URL("../.env", import.meta.url), "utf-8");
for (const line of envContent.split("\n")) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].trim();
}

const client = new Client({ auth: process.env.NOTION_TOKEN });

// id local -> nouveau trigger Name (corrections d'année/titre/langue basées sur le titre réel connu)
const FIXES = {
  139: "Dreamland[m2024;",
  158: "Drogue et Cerveau;",
  171: "Le Cerveau et ses Automatismes;",
  176: "L'Invention de la Cuisine;",
  182: "L'Illusion du Temps;",
  188: "Le voyage d'Ulysse en Méditerranée;",
  384: "Sherlock Holmes: A Game of Shadows[m2011;",
  392: "Raoul Taburin[m;",
  469: "Les Etoiles Restantes[m;",
  479: "The Twelve Tasks of Asterix[m1976;",
  480: "Les Misérables[t2000;",
  531: "Le Comte de Monte-Cristo[t1998;",
  544: "La Tour 2 Contrôle Infernale[m2016;",
  563: "Knight of Cups[m2015;",
  574: "La Classe Américaine[m1993;",
  586: "Night at the Museum[m2006;",
  617: "Ghost in the Shell[m1995;",
  652: "Gangster Squad[m2013;",
  681: "Fourmiz[m1998;",
  694: "Enemy[m2013;",
  712: "Blanche-Neige et les Sept Nains[m1937;",
  739: "Bernie[m1996;",
  769: "Archimède Le Clochard[m;",
  770: "Hearts of Darkness: A Filmmaker's Apocalypse[m1991;",
  778: "Catch Me If You Can[m2002;",
  781: "Apocalypse Now[m1979;",
  791: "Baby Driver[m2017;",
  804: "127 Hours[m2010;",
  831: "10 Cloverfield Bunker Mentality[m;",
};

import Database from "better-sqlite3";
const db = new Database(new URL("../data/watchlist.db", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"));

let ok = 0;
let failed = 0;

for (const [localId, newName] of Object.entries(FIXES)) {
  const row = db.prepare("SELECT notion_page_id, name FROM items WHERE id = ?").get(Number(localId));
  if (!row) {
    console.log(`id ${localId}: introuvable en local, skip`);
    continue;
  }
  try {
    await client.pages.update({
      page_id: row.notion_page_id,
      properties: {
        Name: { title: [{ text: { content: newName } }] },
      },
    });
    console.log(`id ${localId} OK -> "${newName}"`);
    ok++;
  } catch (err) {
    console.log(`id ${localId} FAILED:`, err.message);
    failed++;
  }
}

console.log(`\nTotal: ${ok} ok, ${failed} failed`);
