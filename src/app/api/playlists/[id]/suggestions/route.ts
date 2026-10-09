import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { dismissSuggestion, playlistErrorStatus, suggestForPlaylist } from "@/lib/playlistService";

// spec: specs/playlists-v2.md (FR-5) — « Pour compléter » ; lecture seule, sauf « Pas celui-là ».

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  const { id } = await context.params;
  return NextResponse.json({ suggestions: suggestForPlaylist(getDb(), Number(id)) });
}

/** `{ dismiss: itemId }` : écarte ce titre des suggestions de la playlist. */
export async function POST(request: Request, context: Context) {
  const { id } = await context.params;
  const body = await request.json().catch(() => null);
  const itemId = body?.dismiss;
  if (typeof itemId !== "number" || !Number.isInteger(itemId)) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const result = dismissSuggestion(getDb(), Number(id), itemId);
  if ("error" in result) return NextResponse.json({ error: result.error }, { status: playlistErrorStatus(result.error) });
  return NextResponse.json(result);
}
