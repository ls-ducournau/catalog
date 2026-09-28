import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { actionErrorStatus } from "@/lib/libraryActions";
import { parseTriageUndo, undoTriage } from "@/lib/triageService";

// spec: specs/tri-rapide-v1.md (FR-6)
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const undo = parseTriageUndo(body?.undo);
  if (!undo) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }

  const result = await undoTriage(getDb(), undo);
  if ("error" in result) {
    return NextResponse.json({ error: result.error }, { status: actionErrorStatus(result.error) });
  }
  return NextResponse.json(result);
}
