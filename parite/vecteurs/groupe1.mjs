// Vecteurs de référence du groupe 1 : les VRAIES fonctions de la v1, sur des scénarios tirés au hasard,
// avec un générateur injecté. Le Rust doit rendre exactement la même chose (serveur/src/vecteurs_v1.rs).
//
// À lancer dans une COPIE isolée de la v1 (jamais dans src/ du dépôt) : copier ce fichier dans
// <copie>/src/lib/zz_vecteurs.test.ts, puis, depuis <copie> :
//   VECTEURS_SORTIE=<dépôt>/serveur/tests/vecteurs_v1.json npx vitest run src/lib/zz_vecteurs.test.ts
// Le hasard des scénarios est fixé (graine 20261028) : le fichier se reproduit à l'identique, sauf la date
// des avis (prise à l'horloge par setOpinion), qui n'est qu'une donnée recopiée.
import fs from "node:fs";
import { describe, it, vi } from "vitest";
import { createTestDb } from "./db";
import { categoryFilter } from "./itemService";
import { pickPair } from "./pairSelection";
import { getPeopleWithOpinions } from "./peopleService";
import { getNextPersonDuel, getPersonScope } from "./personDuelService";
import { setOpinion } from "./personOpinionService";
import { getRanking, getTierStep, pickQuad, submitBand, submitQuad, undoRound } from "./tierDuelService";
const SORTIE = process.env.VECTEURS_SORTIE;
/** Des noms qui piègent un tri : accents, casse, ligatures, ponctuation, chiffres, doublons exacts. */
const NOMS = [
    "Élise", "élise", "Elise", "Zorro", "zorro", "Æon Flux", "Œdipe roi", "L'Été meurtrier", "Le Parrain", "Le parrain",
    "À bout de souffle", "Amélie", "Ça", "1917", "2001 : l'odyssée de l'espace", "M", "Ma vie", "Mad Max", "Ōkami",
    "Über", "Saint-Ex", "Saint Ex", "Ñandú", "Lola", "lola", "Les Évadés", "Les evades", "Être et avoir", "Etre et avoir",
    "Kill Bill : Volume 1", "Kill Bill: Volume 1", "Wall·E", "WALL-E", "Brazil", "brazil", "Matrix", "Matrix", "The Matrix",
    "Ghost in the Shell", "Ghost in the Shell", "Ἀθῆναι", "東京物語", "Солярис", "Zoë", "Zoe", "Ångström", "Åsa", "Azur",
];
const STARS = ["💩", "⭐️", "⭐️⭐️", "⭐️⭐️⭐️", "⭐️⭐️⭐️⭐️", "⭐️⭐️⭐️⭐️⭐️"];
const etoile = (r) => (r === null ? null : STARS.indexOf(r));
const lehmer = (graine) => {
    let s = graine;
    return () => {
        s = (s * 16807) % 2147483647;
        return s / 2147483647;
    };
};
// Le hasard des SCÉNARIOS (pas celui des fonctions testées) : reproductible aussi.
const alea = lehmer(20261028);
const entier = (n) => Math.floor(alea() * n);
const un = (xs) => xs[entier(xs.length)];
function remplir(db, n, opts) {
    const insert = db.prepare(`INSERT INTO items (notion_page_id, name, type, year, watch_status, rating, genre, poster_path, elo_score, duels_count,
       tier_elo, tier_duels_count, tier_rating, tier_band, tmdb_features, notion_last_edited, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (let i = 0; i < n; i++) {
        const r = alea() < 0.15 ? null : opts.biais !== undefined && alea() < 0.7 ? opts.biais : entier(6);
        const tr = alea() < 0.6 ? r : alea() < 0.5 ? null : entier(6);
        const genres = un([["Drama"], ["Documentary"], ["Comedy", "Documentary"], [], null]);
        const cast = opts.personnes ? Array.from({ length: entier(5) }, () => un(opts.personnes)) : [];
        const directors = opts.personnes && alea() < 0.3 ? [un(opts.personnes)] : [];
        const producers = opts.personnes && alea() < 0.3 ? [un(opts.personnes)] : undefined;
        const features = opts.personnes && alea() < 0.9 ? JSON.stringify({ genres: [], keywords: [], cast, directors, ...(producers ? { producers } : {}) }) : null;
        insert.run(`p${i}-${alea()}`, un(NOMS), un(["Movie", "TV Series"]), un([null, "2001", "2019 - 2023", "2022 - ", "  ", "2010 - 2010"]), alea() < 0.85 ? "Watched" : "Unwatched", r === null ? null : STARS[r], genres === null ? null : JSON.stringify(genres), un([null, "", "/a.jpg", "/b.jpg"]), alea() < 0.3 ? 1200 : 1000 + alea() * 500, alea() < 0.4 ? 0 : entier(9), alea() < 0.2 ? 1200 : 1100 + alea() * 300, entier(8), tr === null ? null : STARS[tr], un([null, null, 0, 1, 2]), features, "x", "2026-10-01T00:00:00.000Z");
    }
}
/** Les colonnes utiles d'un titre ; `court` : seulement l'état de départage (manches). */
function lignes(db, court = false) {
    return db.prepare(`SELECT * FROM items ORDER BY id`).all().map((l) => ({
        id: l.id,
        watch_status: l.watch_status,
        rating: etoile(l.rating),
        tier_elo: l.tier_elo,
        tier_duels_count: l.tier_duels_count,
        tier_rating: etoile(l.tier_rating),
        tier_band: l.tier_band,
        ...(court
            ? {}
            : {
                name: l.name,
                type: l.type,
                year: l.year,
                genre: l.genre === null ? null : JSON.parse(l.genre),
                poster_path: l.poster_path,
                elo_score: l.elo_score,
                duels_count: l.duels_count,
                ...(l.tmdb_features === null ? {} : { tmdb_features: JSON.parse(l.tmdb_features) }),
            }),
    }));
}
/** Rang de chaque nom selon localeCompare("fr") : ce que la base calcule avec la collation ICU. */
function rangs(ls) {
    const noms = [...new Set(ls.map((l) => l.name))].sort((a, b) => a.localeCompare(b, "fr"));
    const r = {};
    let rang = 0;
    noms.forEach((n, i) => {
        if (i === 0 || n.localeCompare(noms[i - 1], "fr") !== 0)
            rang++;
        r[n] = rang;
    });
    return r;
}
const categorieIds = (db, cat) => {
    const f = categoryFilter(cat);
    return db.prepare(`SELECT id FROM items WHERE 1 = 1${f.sql}`).all(...f.params).map((x) => x.id);
};
describe("vecteurs du groupe 1", () => {
    it("génère", () => {
        const out = { paires: [], quatuors: [], bibliotheques: [], manches: [], personnes: [] };
        // pickPair
        for (let k = 0; k < 100; k++) {
            const n = entier(30);
            const eligibles = Array.from({ length: n }, (_, i) => ({ id: i * 3 + 1 + entier(3), duelsCount: entier(6) }));
            const recentes = Array.from({ length: entier(40) }, () => [un(eligibles)?.id ?? 1, un(eligibles)?.id ?? 2]).map(([a, b]) => (a < b ? `${a}:${b}` : `${b}:${a}`));
            const graine = 1 + entier(1_000_000);
            const rng = lehmer(graine);
            const tirages = Array.from({ length: 5 }, () => pickPair(eligibles, new Set(recentes), rng));
            out.paires.push({ eligibles, recentes, graine, tirages });
        }
        // pickQuad
        for (let k = 0; k < 100; k++) {
            const groupe = Array.from({ length: 1 + entier(25) }, (_, i) => ({ id: i + 1, comparisons: entier(9), score: alea() < 0.2 ? 1200 : 1100 + alea() * 300 }));
            const taille = un([2, 2, 3, 4]);
            const seulement = alea() < 0.7;
            const graine = 1 + entier(1_000_000);
            const rng = lehmer(graine);
            const tirages = Array.from({ length: 4 }, () => pickQuad(groupe, rng, { onlyUnsettled: seulement, size: taille }).map((m) => m.id));
            out.quatuors.push({ groupe, taille, seulement, graine, tirages });
        }
        // getTierStep et getRanking sur des bibliothèques tirées au hasard
        for (let k = 0; k < 36; k++) {
            const db = createTestDb();
            const biais = k % 4 === 0 ? un([3, 4, 5]) : un([undefined, 2, 4]);
            remplir(db, k % 4 === 0 ? 140 + entier(60) : 2 + entier(30), { biais });
            // Les gros paliers : tous répartis (quatuors par groupe), ou presque tous, ou départagés (fini).
            // (k % 16 === 12 : état au hasard, laissé tel quel.)
            if (k % 16 === 4)
                db.prepare(`UPDATE items SET tier_rating = rating, tier_band = id % 3`).run();
            if (k % 16 === 8)
                db.prepare(`UPDATE items SET tier_rating = rating, tier_band = id % 3 WHERE id % 9 <> 0`).run();
            if (k % 16 === 0)
                db.prepare(`UPDATE items SET tier_rating = rating, tier_band = id % 3, tier_duels_count = 6`).run();
            const ls = lignes(db);
            const cats = [undefined, "Movie", "TV Series", "Documentary"];
            const categories = {};
            for (const c of cats)
                categories[c ?? ""] = categorieIds(db, c);
            const etapes = [];
            for (let j = 0; j < 6; j++) {
                const stars = (biais !== undefined && alea() < 0.75 ? biais : entier(6));
                const cat = alea() < 0.6 ? undefined : un([...cats]);
                const refine = alea() < 0.3;
                const graine = 1 + entier(1_000_000);
                etapes.push({ stars, cat: cat ?? "", refine, graine, attendu: getTierStep(db, stars, cat, lehmer(graine), { refine }) });
            }
            const classements = [un([...cats]), un([...cats])].map((c) => ({ cat: c ?? "", attendu: getRanking(db, c) }));
            out.bibliotheques.push({ lignes: ls, rangs: rangs(ls), categories, etapes, classements });
            db.close();
        }
        // Répartitions, quatuors et annulations enchaînés
        for (let k = 0; k < 30; k++) {
            const db = createTestDb();
            remplir(db, 4 + entier(30), { biais: 4 });
            const avant = lignes(db, true);
            const ids = avant.map((l) => l.id);
            const manches = [];
            const ops = [];
            for (let j = 0; j < 25; j++) {
                const t = alea();
                if (t < 0.3) {
                    const itemId = alea() < 0.95 ? un(ids) : 9999;
                    const actuelle = db.prepare(`SELECT rating FROM items WHERE id = ?`).get(itemId)?.rating ?? null;
                    const stars = actuelle !== null && alea() < 0.75 ? STARS.indexOf(actuelle) : entier(6);
                    const op = { kind: "band", itemId, stars, band: entier(3) };
                    const r = submitBand(db, op.itemId, op.stars, op.band);
                    if ("roundId" in r)
                        manches.push(r.roundId);
                    ops.push({ ...op, resultat: r });
                }
                else if (t < 0.75) {
                    const stars = alea() < 0.7 ? 4 : entier(6);
                    const memePalier = db.prepare(`SELECT id FROM items WHERE watch_status = 'Watched' AND rating = ?`).all(STARS[stars]).map((x) => x.id);
                    const pool = memePalier.length >= 2 && alea() < 0.85 ? memePalier : ids;
                    const itemIds = [...new Set(Array.from({ length: 2 + entier(3) }, () => un(pool)))];
                    if (alea() < 0.05)
                        itemIds.push(itemIds[0]);
                    const bestId = alea() < 0.95 ? un(itemIds) : 9999;
                    const worstId = alea() < 0.4 ? null : un(itemIds);
                    const r = submitQuad(db, itemIds, stars, bestId, worstId);
                    if ("roundId" in r)
                        manches.push(r.roundId);
                    ops.push({ kind: "quad", itemIds, stars, bestId, worstId, resultat: r });
                }
                else if (t < 0.95) {
                    const roundId = manches.length && alea() < 0.9 ? un(manches) : 777;
                    ops.push({ kind: "undo", roundId, resultat: undoRound(db, roundId) });
                }
                else {
                    // La note d'un titre change entre deux réponses (EC-2) : updateItem ne touche que la note.
                    const id = un(ids);
                    const r = entier(6);
                    db.prepare(`UPDATE items SET rating = ? WHERE id = ? AND watch_status = 'Watched'`).run(STARS[r], id);
                    ops.push({ kind: "note", id, rating: r });
                }
            }
            out.manches.push({ avant, ops, apres: lignes(db, true) });
            db.close();
        }
        // Personnes : vue Personnes, duel suivant (Math.random injecté), portée
        const PERSONNES = Array.from({ length: 30 }, (_, i) => ({ id: 100 + i * 7, name: `${un(NOMS)}`, profilePath: un([null, "", `/p${i}.jpg`, `/q${i}.jpg`]) }));
        for (let k = 0; k < 30; k++) {
            const db = createTestDb();
            // Une même personne peut porter des photos différentes d'un titre à l'autre.
            const variantes = PERSONNES.flatMap((p) => [p, { ...p, profilePath: un([null, `/autre${p.id}.jpg`]) }]);
            remplir(db, 3 + entier(30), { personnes: variantes });
            const now = "2026-10-20T08:00:00.000Z";
            const people = [];
            for (const p of PERSONNES) {
                if (alea() < 0.5) {
                    const row = { id: p.id, name: p.name, profile_path: p.profilePath, elo_score: alea() < 0.3 ? 1200 : 1100 + alea() * 200, duels_count: alea() < 0.4 ? 0 : entier(5) };
                    db.prepare(`INSERT INTO people (id, name, profile_path, elo_score, duels_count, updated_at) VALUES (?, ?, ?, ?, ?, ?)`).run(row.id, row.name, row.profile_path, row.elo_score, row.duels_count, now);
                    people.push(row);
                }
            }
            const duels = [];
            for (let j = 0; j < entier(70) && people.length >= 2; j++) {
                const a = un(people).id;
                const b = un(people).id;
                db.prepare(`INSERT INTO person_duels (person_a_id, person_b_id, winner_id, elo_a_before, elo_b_before, elo_a_after, elo_b_after, created_at) VALUES (?, ?, NULL, 1200, 1200, 1200, 1200, ?)`).run(a, b, now);
                duels.push([a, b]);
            }
            const avis = [];
            for (const p of PERSONNES) {
                if (alea() < 0.4) {
                    const opinion = alea() < 0.7 ? 1 : -1;
                    const rating = alea() < 0.5 ? undefined : un([null, 0, 3, 5]);
                    setOpinion(db, { id: p.id, name: `${p.name} (avis)` }, opinion, rating);
                    avis.push(p.id);
                }
            }
            const opinions = db.prepare(`SELECT person_id, name, opinion, rating, updated_at FROM person_opinions ORDER BY person_id`).all();
            const vue = getPeopleWithOpinions(db);
            const graine = 1 + entier(1_000_000);
            const rng = lehmer(graine);
            const espion = vi.spyOn(Math, "random").mockImplementation(rng);
            const suivant = getNextPersonDuel(db);
            espion.mockRestore();
            const portee = getPersonScope(db);
            out.personnes.push({ lignes: lignes(db), people, duels, opinions, vue, graine, suivant, portee });
            db.close();
        }
        // Un flottant non entier voyage par ses bits IEEE ({"$f": "hex"}) : le Rust le relit au bit près.
        const bits = (x) => {
            const b = Buffer.alloc(8);
            b.writeDoubleBE(x);
            return b.toString("hex");
        };
        fs.writeFileSync(SORTIE, JSON.stringify(out, (_k, v) => (typeof v === "number" && !Number.isInteger(v) ? { $f: bits(v) } : v)));
    });
});
