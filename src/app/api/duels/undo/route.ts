import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { undoDuel, type DuelMode } from "@/lib/duelUndo";
import { undoRound } from "@/lib/tierDuelService";

// spec: specs/classement-v1.md (FR-1)
// « round » : une répartition ou un quatuor de départage (classement-v1 v1.1).
const MODES: (DuelMode | "round")[] = ["titles", "people", "round"];

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  if (!MODES.includes(body?.mode) || typeof body?.duelId !== "number") {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result =
    body.mode === "round" ? undoRound(getDb(), body.duelId) : undoDuel(getDb(), body.mode as DuelMode, body.duelId);
  if ("error" in result) {
    return NextResponse.json(result, { status: result.error === "not_found" ? 404 : 409 });
  }
  return NextResponse.json(result);
}
