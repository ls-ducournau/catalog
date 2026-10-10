import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { MAX_BATCH, parseSurface, recordImpressions } from "@/lib/impressionService";

// spec: specs/recommandations-fraicheur-v1.md (FR-2) — les titres montrés, envoyés par lots.
// Écriture par POST seulement : une page rendue, une capture ou un test n'enregistrent rien.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const surface = parseSurface(body?.surface);
  const subjects = body?.subjects;
  if (!surface || !Array.isArray(subjects) || subjects.length > MAX_BATCH) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  return NextResponse.json({ recorded: recordImpressions(getDb(), surface, subjects) });
}
