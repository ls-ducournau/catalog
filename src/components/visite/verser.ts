import { aGarder, type EtatVisite } from "@/lib/visite";

// Ce qu'on a fait sans compte (la visite, les cartes et les sections de la page d'arrivée) suit le visiteur
// quand il commence : la bienvenue le verse dans le compte à l'arrivée (specs/bienvenue-v1.md, FR-13).

const JSON_HEADERS = { "Content-Type": "application/json" };

export type Verse = { titres: number; notes: number; vusSansNote: number };

/**
 * Les titres (vus, envies), leurs notes, puis les duels entre titres versés. L'un après l'autre : en ligne,
 * la première écriture ouvre la session invitée. Rend ce qui est entré dans la bibliothèque.
 */
export async function verserVisite(etat: EtatVisite): Promise<Verse> {
  const bilan = aGarder(etat);
  const ids = new Map<string, number>();
  const verse: Verse = { titres: 0, notes: 0, vusSansNote: 0 };
  for (const cle of bilan.titres) {
    const i = cle.lastIndexOf(":");
    const [type, tmdbId] = [cle.slice(0, i), Number(cle.slice(i + 1))];
    const res = await fetch("/api/items", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ tmdbId, type, source: "home" }) });
    const corps = (await res.json().catch(() => null)) as { item?: { id: number } } | null;
    if (!res.ok || typeof corps?.item?.id !== "number") continue;
    ids.set(cle, corps.item.id);
    verse.titres += 1;
    if (etat.tri[cle] !== "vu") continue;
    const note = etat.notes[cle];
    await fetch(`/api/items/${corps.item.id}`, {
      method: "PATCH",
      headers: JSON_HEADERS,
      body: JSON.stringify(note === undefined ? { watchStatus: "Watched" } : { watchStatus: "Watched", rating: note === 0 ? "💩" : "⭐️".repeat(note) }),
    });
    if (note === undefined) verse.vusSansNote += 1;
    else verse.notes += 1;
  }
  for (const duel of etat.duels) {
    const [itemAId, itemBId] = [ids.get(duel.a), ids.get(duel.b)];
    if (itemAId === undefined || itemBId === undefined) continue;
    await fetch("/api/duels/result", { method: "POST", headers: JSON_HEADERS, body: JSON.stringify({ itemAId, itemBId, result: duel.gagnant }) });
  }
  return verse;
}
