// Favicons tirés du symbole de Catalog (src/app/icon.svg), à relancer si le symbole change :
//   node scripts/build-favicons.mjs
// - src/app/favicon.ico : 16, 32 et 48 px (navigateurs sans SVG, favoris, /favicon.ico demandé d'office) ;
// - src/app/apple-icon.png : 180 px (écran d'accueil de l'iPhone, Safari).
// Next.js pose lui-même les balises <link> de ces fichiers (convention des icônes de l'App Router).
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const app = path.join(import.meta.dirname, "..", "src", "app");
const svg = fs.readFileSync(path.join(app, "icon.svg"));
const png = (taille) => sharp(svg, { density: Math.ceil((72 * taille) / 128) * 4 }).resize(taille, taille).png().toBuffer();

// Un .ico qui contient des PNG (accepté par tous les navigateurs actuels) : en-tête, répertoire, images.
async function ico(tailles) {
  const images = await Promise.all(tailles.map(png));
  const entete = Buffer.alloc(6);
  entete.writeUInt16LE(0, 0);
  entete.writeUInt16LE(1, 2);
  entete.writeUInt16LE(images.length, 4);
  let decalage = 6 + 16 * images.length;
  const repertoire = images.map((image, i) => {
    const e = Buffer.alloc(16);
    e.writeUInt8(tailles[i] % 256, 0);
    e.writeUInt8(tailles[i] % 256, 1);
    e.writeUInt8(0, 2);
    e.writeUInt8(0, 3);
    e.writeUInt16LE(1, 4);
    e.writeUInt16LE(32, 6);
    e.writeUInt32LE(image.length, 8);
    e.writeUInt32LE(decalage, 12);
    decalage += image.length;
    return e;
  });
  return Buffer.concat([entete, ...repertoire, ...images]);
}

fs.writeFileSync(path.join(app, "favicon.ico"), await ico([16, 32, 48]));
fs.writeFileSync(path.join(app, "apple-icon.png"), await png(180));
console.log("favicon.ico (16, 32, 48) et apple-icon.png (180) écrits dans src/app");
