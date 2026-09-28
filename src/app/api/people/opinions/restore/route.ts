import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { restoreOpinions, type OpinionRow } from "@/lib/personOpinionService";

// spec: specs/classement-v1.md (FR-12) — « Annuler » après une réinitialisation.
function isRow(r: unknown): r is OpinionRow {
  const o = r as Partial<OpinionRow> | null;
  return (
    typeof o?.personId === "number" &&
    typeof o.name === "string" &&
    (o.opinion === 1 || o.opinion === -1) &&
    typeof o.updatedAt === "string" &&
    (o.rating === null || typeof o.rating === "number")
  );
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!Array.isArray(body?.rows) || !body.rows.every(isRow)) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  restoreOpinions(getDb(), body.rows);
  return NextResponse.json({ ok: true });
}
