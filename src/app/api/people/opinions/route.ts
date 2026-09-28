import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getPeopleWithOpinions } from "@/lib/peopleService";
import { clearOpinion, isRating, setOpinion } from "@/lib/personOpinionService";

// spec: specs/classement-v1.md (FR-6) — avis locaux, jamais envoyés à Notion.
export async function GET() {
  return NextResponse.json({ people: getPeopleWithOpinions(getDb()) });
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  if (
    typeof body?.id !== "number" ||
    typeof body?.name !== "string" ||
    (body?.opinion !== 1 && body?.opinion !== -1) ||
    // classement-v1 FR-13 : note de 1 à 5, ou null pour la retirer ; absente, inchangée.
    (body?.rating !== undefined && body.rating !== null && !isRating(body.rating))
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  setOpinion(getDb(), { id: body.id, name: body.name }, body.opinion, body.rating);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  if (typeof body?.id !== "number") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  clearOpinion(getDb(), body.id);
  return NextResponse.json({ ok: true });
}
