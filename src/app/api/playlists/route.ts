import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { createPlaylist, listPlaylists, parseSource, playlistErrorStatus } from "@/lib/playlistService";

// spec: specs/playlists-v1.md (FR-1, FR-4, FR-10) — locales, rien vers Notion (NFR-1).

/** Tes playlists ; `?item=<id>` dit lesquelles contiennent ce titre (FR-4). */
export async function GET(request: Request) {
  const item = Number(new URL(request.url).searchParams.get("item"));
  const playlists = listPlaylists(getDb(), Number.isInteger(item) && item > 0 ? { itemId: item } : {});
  return NextResponse.json({ playlists });
}

/** `{ name, description?, itemId? }` : crée la playlist, avec un premier titre s'il est donné. */
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const itemId = typeof body?.itemId === "number" && Number.isInteger(body.itemId) ? body.itemId : undefined;
  const result = createPlaylist(getDb(), { name: body?.name, description: body?.description, itemId, source: parseSource(body?.source) });
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: playlistErrorStatus(result.error) });
  return NextResponse.json(result, { status: 201 });
}
