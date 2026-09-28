import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseBand, parseStars, submitBand } from "@/lib/tierDuelService";

// spec: specs/classement-v1.md (FR-9, EC-2)
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const stars = parseStars(body?.stars);
  const band = parseBand(body?.band);
  if (typeof body?.itemId !== "number" || stars === null || band === null) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const result = submitBand(getDb(), body.itemId, stars, band);
  if ("error" in result) return NextResponse.json(result, { status: 409 });
  return NextResponse.json(result);
}
