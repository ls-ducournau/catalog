import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseStars, submitQuad } from "@/lib/tierDuelService";

// spec: specs/classement-v1.md (FR-10, EC-2)
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const stars = parseStars(body?.stars);
  const ids = body?.itemIds;
  if (
    !Array.isArray(ids) ||
    !ids.every((id: unknown) => typeof id === "number") ||
    typeof body?.bestId !== "number" ||
    (body?.worstId !== null && typeof body?.worstId !== "number") ||
    stars === null
  ) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const result = submitQuad(getDb(), ids, stars, body.bestId, body.worstId);
  if ("error" in result) {
    return NextResponse.json(result, { status: result.error === "stale" ? 409 : 400 });
  }
  return NextResponse.json(result);
}
