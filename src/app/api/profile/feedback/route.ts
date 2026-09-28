import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { countDismissals } from "@/lib/dismissalService";
import { acceptanceStats } from "@/lib/journalService";

// spec: specs/tri-rapide-v1.md (FR-2, FR-8) — ce que le profil de goûts affiche de la boucle.
export async function GET() {
  const db = getDb();
  return NextResponse.json({ acceptance: acceptanceStats(db), dismissed: countDismissals(db) });
}
