import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { actionErrorStatus } from "@/lib/libraryActions";
import { answerTriage, parseTriageSubject, type TriageAnswer } from "@/lib/triageService";

// spec: specs/tri-rapide-v1.md (FR-4) — renvoie de quoi annuler la réponse (FR-6).
const ANSWERS: TriageAnswer[] = ["like", "dislike", "skip"];

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const card = parseTriageSubject(body?.card);
  if (!card || !ANSWERS.includes(body?.answer)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await answerTriage(getDb(), card, body.answer as TriageAnswer);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: actionErrorStatus(result.error) });
  }
  return NextResponse.json(result);
}
