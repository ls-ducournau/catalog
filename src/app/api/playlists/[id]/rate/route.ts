import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { playlistErrorStatus, rateFromPlaylist } from "@/lib/playlistService";

// spec: specs/playlists-v2.md (FR-7, FR-12) — `{ itemId, rating }`, de 0 (💩) à 5 étoiles.
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const itemId = body?.itemId;
  if (typeof itemId !== "number" || !Number.isInteger(itemId)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const result = rateFromPlaylist(getDb(), Number(id), itemId, body?.rating);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: playlistErrorStatus(result.error) });
  return NextResponse.json(result);
}
