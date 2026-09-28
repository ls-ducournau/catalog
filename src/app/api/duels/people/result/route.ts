import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import type { DuelChoice } from "@/lib/duelService";
import { submitPersonDuelResult } from "@/lib/personDuelService";

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);

  if (
    typeof body?.personAId !== "number" ||
    typeof body?.personBId !== "number" ||
    !["A", "B", "skip"].includes(body?.result)
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = submitPersonDuelResult(getDb(), body.personAId, body.personBId, body.result as DuelChoice);
  if (!result) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json({ ok: true, duelId: result.duelId });
}
