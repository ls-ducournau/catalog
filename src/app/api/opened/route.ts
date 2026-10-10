import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseOpenedSubject } from "@/lib/impressionService";
import { logEvent } from "@/lib/journalService";

// spec: specs/recommandations-fraicheur-v1.md (FR-4) — ouvrir la fiche d'un titre est un geste.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const subject = parseOpenedSubject(body?.subject);
  if (!subject) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  logEvent(getDb(), "opened", subject.type, subject.id);
  return NextResponse.json({ ok: true });
}
