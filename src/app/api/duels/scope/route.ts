import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getDuelScope } from "@/lib/duelService";
import { parseCategory } from "@/lib/libraryItem";

/** Ce que couvre une catégorie : affiché avant de confirmer une réinitialisation. */
export async function GET(request: Request) {
  const category = parseCategory(new URL(request.url).searchParams.get("category"));
  return NextResponse.json(getDuelScope(getDb(), category));
}
