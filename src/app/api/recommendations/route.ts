import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getRecommendations } from "@/lib/recommendationService";
import { getCoveredServiceIds } from "@/lib/settingsService";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category") ?? searchParams.get("type");
  const genre = searchParams.get("genre");
  const limit = searchParams.get("limit");
  const onMyServices = searchParams.get("onMyServices") === "1";

  const db = getDb();
  const result = getRecommendations(db, {
    category:
      category === "Movie" || category === "TV Series" || category === "Documentary"
        ? category
        : undefined,
    genre: genre || undefined,
    limit: limit ? Number(limit) : undefined,
    onServices: onMyServices ? await getCoveredServiceIds(db) : undefined,
  });

  return NextResponse.json(result);
}
