import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseCategory } from "@/lib/libraryItem";
import { getTriageBatch, type TriageFamily } from "@/lib/triageService";

// spec: specs/tri-rapide-v1.md (FR-3)
const FAMILIES: TriageFamily[] = ["unseen", "seen", "person"];

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const family = searchParams.get("family") as TriageFamily | null;
  if (!family || !FAMILIES.includes(family)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const limit = Number(searchParams.get("limit"));
  const cards = await getTriageBatch(getDb(), family, {
    category: parseCategory(searchParams.get("category")),
    limit: Number.isInteger(limit) && limit > 0 && limit <= 50 ? limit : undefined,
    // Clés des cartes déjà montrées (« item:12 », « person:287 », « Movie:603 »).
    exclude: (searchParams.get("exclude") ?? "").split(",").filter(Boolean).slice(0, 500),
  });
  return NextResponse.json({ cards });
}
