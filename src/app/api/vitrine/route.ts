import { NextResponse } from "next/server";
import { chargerVitrineLocale } from "@/lib/vitrineLocal";

// spec: specs/accueil-vitrine-connexion-v1.md (§ 6) — titres tendances de TMDB, au format des
// aperçus de l'accueil, sans ceux de ta bibliothèque. Lecture seule.
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(await chargerVitrineLocale());
}
