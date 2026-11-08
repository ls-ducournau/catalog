import { NextResponse } from "next/server";
import { externalTitleData } from "@/lib/discoveryService";
import { ficheCarte } from "@/lib/ficheCarte";

// spec: specs/bienvenue-v1.md (FR-4) — la fiche d'un titre hors bibliothèque, pour une carte de bienvenue :
// bande-annonce, où le voir, durée, réalisation, têtes d'affiche. Lecture seule, rien du compte.
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tmdbId = Number(searchParams.get("tmdbId"));
  const type = searchParams.get("type");
  if (!Number.isInteger(tmdbId) || tmdbId <= 0 || (type !== "Movie" && type !== "TV Series")) {
    return NextResponse.json({ error: "invalid" }, { status: 400 });
  }
  const data = await externalTitleData(tmdbId, type);
  if (!data) return NextResponse.json({ error: "tmdb_unavailable" }, { status: 502 });
  return NextResponse.json(ficheCarte(data));
}
