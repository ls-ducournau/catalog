import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { parseSnapshot, playlistErrorStatus, restorePlaylist } from "@/lib/playlistService";

// spec: specs/playlists-v1.md (FR-3) — annule une suppression à partir de son instantané.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const snapshot = parseSnapshot(body?.snapshot);
  if (!snapshot) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const result = restorePlaylist(getDb(), snapshot);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: playlistErrorStatus(result.error) });
  return NextResponse.json(result);
}
