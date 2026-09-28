import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { resetOpinions } from "@/lib/personOpinionService";

// spec: specs/classement-v1.md (FR-12) — efface une liste d'avis et renvoie ce qui a été effacé,
// pour pouvoir l'annuler.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (body?.side !== "liked" && body?.side !== "disliked") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  return NextResponse.json({ removed: resetOpinions(getDb(), body.side) });
}
