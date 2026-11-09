import { NextResponse } from "next/server";
import { chargerPage, PAGES_MAX } from "@/lib/cartesBienvenue";
import { getDb } from "@/lib/db";
import { dismissedTmdbKeys, tmdbKey } from "@/lib/dismissalService";
import { titleKey } from "@/lib/vitrine";
import { ownedTitleKeys } from "@/lib/vitrineLocal";

// spec: specs/bienvenue-v1.md (FR-10) — la suite du paquet de cartes, page par page, sans les titres de la
// bibliothèque ni ceux qu'on a écartés. Lecture seule.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const page = Number(new URL(request.url).searchParams.get("page"));
  if (!Number.isInteger(page) || page < 1 || page > PAGES_MAX) return NextResponse.json({ error: "invalid" }, { status: 400 });
  const siens = ownedTitleKeys();
  const ecartes = dismissedTmdbKeys(getDb());
  const items = (await chargerPage(page)).filter((t) => {
    const tmdbId = t.suggestion?.tmdbId ?? t.id;
    return !siens.has(titleKey(t.type, tmdbId)) && !ecartes.has(tmdbKey(t.type, tmdbId));
  });
  return NextResponse.json({ items, page, more: page < PAGES_MAX });
}
