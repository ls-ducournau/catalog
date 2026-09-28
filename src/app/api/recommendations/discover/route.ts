import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { discoveryRows, getDiscoveries } from "@/lib/discoveryService";
import { getCoveredServiceIds } from "@/lib/settingsService";

// spec: specs/recommendations-v1.md — amendements v1.2 (FR-15 à FR-21)
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const category = searchParams.get("category");
  const limit = searchParams.get("limit");
  const onMyServices = searchParams.get("onMyServices") === "1";
  const withRows = searchParams.get("rows") === "1";

  const db = getDb();
  const covered = withRows || onMyServices ? await getCoveredServiceIds(db) : [];
  const result = await getDiscoveries(db, {
    category:
      category === "Movie" || category === "TV Series" || category === "Documentary"
        ? category
        : undefined,
    limit: limit ? Number(limit) : undefined,
    onServices: onMyServices ? covered : undefined,
  });

  // sorties-v1 FR-7 : les rangées désignent les titres de la liste par clé.
  if (withRows && "items" in result) {
    return NextResponse.json({
      ...result,
      rows: discoveryRows(result.items, { coveredServices: covered, currentYear: new Date().getFullYear() }),
    });
  }
  return NextResponse.json(result);
}
