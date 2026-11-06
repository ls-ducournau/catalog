import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { listItems, type SortBy, type SortDir } from "@/lib/itemService";
import type { AddSource } from "@/lib/journalService";
import { actionErrorStatus, addTitleToLibrary } from "@/lib/libraryActions";
import { getCoveredServiceIds } from "@/lib/settingsService";

const ADD_SOURCES: AddSource[] = ["search", "discover", "suggestions", "triage", "tonight", "calendar", "home"];

const SORT_BY_VALUES: SortBy[] = [
  "name",
  "year",
  "elo",
  "tmdbRating",
  "added",
  "rating",
  "status",
  "category",
  "genre",
];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const watchStatus = searchParams.get("watchStatus");
  const q = searchParams.get("q") ?? undefined;
  const genre = searchParams.get("genre") ?? undefined;
  const minRating = searchParams.get("minRating");
  const rating = searchParams.get("rating");
  const sortBy = searchParams.get("sortBy");
  const sortDir = searchParams.get("sortDir");
  const page = searchParams.get("page");
  const pageSize = searchParams.get("pageSize");
  const onMyServices = searchParams.get("onMyServices") === "1";

  const db = getDb();
  const result = listItems(db, {
    category:
      type === "Movie" || type === "TV Series" || type === "Documentary" ? type : undefined,
    watchStatus:
      watchStatus === "Watched" || watchStatus === "Unwatched" ? watchStatus : undefined,
    q,
    genre,
    minRating: minRating ? Number(minRating) : undefined,
    rating: rating !== null && rating !== "" ? Number(rating) : undefined,
    sortBy: SORT_BY_VALUES.includes(sortBy as SortBy) ? (sortBy as SortBy) : undefined,
    sortDir: sortDir === "asc" || sortDir === "desc" ? (sortDir as SortDir) : undefined,
    page: page ? Number(page) : undefined,
    pageSize: pageSize ? Number(pageSize) : undefined,
    onServices: onMyServices ? await getCoveredServiceIds(db) : undefined,
  });

  return NextResponse.json(result);
}

// spec: specs/ajout-item-v1.md (FR-3, FR-4, FR-5, EC-3, EC-4)
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const tmdbId = body?.tmdbId;
  const type = body?.type;

  if (typeof tmdbId !== "number" || (type !== "Movie" && type !== "TV Series")) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  // tri-rapide-v1 FR-1/FR-8 : l'origine de l'ajout sert au taux d'acceptation.
  const source: AddSource = ADD_SOURCES.includes(body?.source) ? body.source : "search";

  const result = await addTitleToLibrary(getDb(), tmdbId, type, source);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: actionErrorStatus(result.error) });
  }
  return NextResponse.json(result, { status: result.alreadyExists ? 200 : 201 });
}
