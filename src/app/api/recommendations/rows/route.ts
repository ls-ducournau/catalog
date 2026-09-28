import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseCategory } from "@/lib/libraryItem";
import { getRecommendationRows } from "@/lib/recommendationService";
import { getCoveredServiceIds } from "@/lib/settingsService";

// spec: specs/recommendations-v1.md — amendements v1.4 (FR-32)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const genre = searchParams.get("genre");
  const onMyServices = searchParams.get("onMyServices") === "1";

  const db = getDb();
  // Les abonnements servent toujours à la rangée « Disponible sur tes abonnements », et en plus
  // de filtre quand il est actif.
  const covered = await getCoveredServiceIds(db);

  return NextResponse.json(
    getRecommendationRows(db, {
      category: parseCategory(searchParams.get("category")),
      genre: genre || undefined,
      onServices: onMyServices ? covered : undefined,
      coveredServices: covered,
    })
  );
}
