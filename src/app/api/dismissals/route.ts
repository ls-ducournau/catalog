import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  clearDismissals,
  countDismissals,
  dismiss,
  parseDismissalSubject,
  undismiss,
} from "@/lib/dismissalService";

// spec: specs/tri-rapide-v1.md (FR-2) — « Ne plus me proposer », local uniquement.
export async function GET() {
  return NextResponse.json({ count: countDismissals(getDb()) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const subject = parseDismissalSubject(body?.subject);
  if (!subject) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const db = getDb();
  dismiss(db, subject);
  return NextResponse.json({ count: countDismissals(db) });
}

/** `{ subject }` annule un écartement ; `{ all: true }` réaffiche tout. */
export async function DELETE(request: Request) {
  const body = await request.json().catch(() => null);
  const db = getDb();

  if (body?.all === true) {
    const cleared = clearDismissals(db);
    return NextResponse.json({ count: 0, cleared });
  }

  const subject = parseDismissalSubject(body?.subject);
  if (!subject) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  undismiss(db, subject);
  return NextResponse.json({ count: countDismissals(db) });
}
